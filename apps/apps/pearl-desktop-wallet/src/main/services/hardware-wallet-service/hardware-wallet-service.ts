import {
  derivePearlTaprootAddress,
  type PearlNetwork,
} from '@pearl/wallet-core/hardware';
import {
  normalizeBlockbookAddress,
  normalizeBlockbookTxid,
  normalizeRawTransactionHex,
  type BlockbookAddressInfo,
  type BlockbookUtxo,
} from '../../clients/blockbook-normalizers.ts';
import {BlockbookClient} from '../../clients/blockbook-client.ts';
import type {WalletService} from '../wallet-service/wallet-service.ts';
import type {ListUnspentResult} from '../wallet-service/wallet-rpc-methods.ts';
import type {
  HardwareWalletAccountRequest,
  HardwareWalletBalance,
  HardwareWalletBroadcastRequest,
  HardwareWalletBroadcastResult,
} from '../../../types/app-bridge.ts';

const SATS_PER_PEARL = 100_000_000n;

interface NormalizedHardwareAccount {
  address: string;
  publicKey: string;
  network: PearlNetwork;
}

function normalizeHardwarePublicKey(publicKey: string): string {
  const normalized = publicKey.trim();
  if (!/^[0-9a-fA-F]+$/.test(normalized) || ![64, 66, 130].includes(normalized.length)) {
    throw new Error('Invalid hardware wallet public key.');
  }

  return normalized;
}

function normalizeHardwareAccount(request: HardwareWalletAccountRequest): NormalizedHardwareAccount {
  const address = normalizeBlockbookAddress(request.address);
  const publicKey = normalizeHardwarePublicKey(request.publicKey);
  const network = request.network ?? 'mainnet';
  const expectedAddress = derivePearlTaprootAddress(publicKey, network);

  if (address !== expectedAddress) {
    throw new Error('Hardware wallet address does not match its public key.');
  }

  return {address, publicKey, network};
}

function pearlAmountToSats(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Oyster returned an invalid UTXO amount.');
  }

  const [wholePart, fractionalPart = ''] = value.toFixed(8).split('.');
  const paddedFractionalPart = `${fractionalPart}00000000`.slice(0, 8);
  const sats = BigInt(wholePart) * SATS_PER_PEARL + BigInt(paddedFractionalPart);
  return sats.toString();
}

function normalizeOysterUtxo(utxo: ListUnspentResult): BlockbookUtxo {
  if (
    typeof utxo.txid !== 'string' ||
    !Number.isSafeInteger(utxo.vout) ||
    typeof utxo.amount !== 'number' ||
    !Number.isSafeInteger(utxo.confirmations)
  ) {
    throw new Error('Oyster returned an invalid UTXO.');
  }

  return {
    txid: normalizeBlockbookTxid(utxo.txid, 'Oyster UTXO transaction id'),
    vout: utxo.vout,
    value: pearlAmountToSats(utxo.amount),
    confirmations: utxo.confirmations,
  };
}

function buildAddressInfo(address: string, utxos: BlockbookUtxo[]): BlockbookAddressInfo {
  let confirmedBalance = 0n;
  let unconfirmedBalance = 0n;
  const txids = new Set<string>();
  const unconfirmedTxids = new Set<string>();

  for (const utxo of utxos) {
    const value = BigInt(utxo.value);
    txids.add(utxo.txid);

    if ((utxo.confirmations ?? 0) > 0) {
      confirmedBalance += value;
    } else {
      unconfirmedBalance += value;
      unconfirmedTxids.add(utxo.txid);
    }
  }

  const balance = confirmedBalance + unconfirmedBalance;

  return {
    address,
    balance: balance.toString(),
    totalReceived: balance.toString(),
    totalSent: '0',
    unconfirmedBalance: unconfirmedBalance.toString(),
    unconfirmedTxs: unconfirmedTxids.size,
    txs: txids.size,
  };
}

// Reads hardware account state through the local Oyster wallet. The public
// key import requests a rescan so UTXOs received before the key was first
// imported are discovered; repeat imports are idempotent and skip the rescan.
async function getLocalHardwareWalletBalance(
  account: NormalizedHardwareAccount,
  walletService: WalletService
): Promise<HardwareWalletBalance> {
  await walletService.importPublicKey(account.publicKey, true);
  const localUtxos = await walletService.listUnspent(0);
  const utxos = localUtxos
    .filter(utxo => utxo.address === account.address)
    .map(normalizeOysterUtxo);
  const info = buildAddressInfo(account.address, utxos);
  return {info, utxos, source: 'oyster'};
}

// Hardware-only mode: no software wallet is loaded, so read balance and UTXOs
// from the external indexer instead of local Oyster.
async function getIndexerHardwareWalletBalance(
  account: NormalizedHardwareAccount
): Promise<HardwareWalletBalance> {
  const [info, utxos] = await Promise.all([
    BlockbookClient.getAddressInfo(account.address, account.network),
    BlockbookClient.getUtxos(account.address, account.network),
  ]);
  return {info, utxos, source: 'indexer'};
}

async function getHardwareWalletBalance(
  request: HardwareWalletAccountRequest,
  walletService: WalletService | null
): Promise<HardwareWalletBalance> {
  const account = normalizeHardwareAccount(request);

  if (walletService) {
    return getLocalHardwareWalletBalance(account, walletService);
  }

  return getIndexerHardwareWalletBalance(account);
}

export const HardwareWalletService = {
  async getBalance(
    request: HardwareWalletAccountRequest,
    walletService: WalletService | null
  ): Promise<HardwareWalletBalance> {
    return getHardwareWalletBalance(request, walletService);
  },

  async broadcastTransaction(
    {
      network,
      rawTransactionHex,
      sourceAddress,
      sourcePublicKey,
    }: HardwareWalletBroadcastRequest,
    walletService: WalletService | null
  ): Promise<HardwareWalletBroadcastResult> {
    const account = normalizeHardwareAccount({
      address: sourceAddress,
      publicKey: sourcePublicKey,
      network,
    });
    const normalizedTransaction = normalizeRawTransactionHex(rawTransactionHex);
    let rawTxid: string;

    if (walletService) {
      await walletService.importPublicKey(account.publicKey, true);
      rawTxid = await walletService.sendRawTransaction(normalizedTransaction);
    } else {
      rawTxid = await BlockbookClient.sendTransaction(normalizedTransaction, account.network);
    }

    const txid = normalizeBlockbookTxid(rawTxid, 'broadcast transaction id');
    let balance: HardwareWalletBalance | null = null;

    try {
      balance = await getHardwareWalletBalance(account, walletService);
    } catch {
      balance = null;
    }

    return {balance, txid};
  },
};
