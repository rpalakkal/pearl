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
import {recordSend} from '../../config/send-history.ts';
import type {WalletService} from '../wallet-service/wallet-service.ts';
import type {ListUnspentResult} from '../wallet-service/wallet-rpc-methods.ts';
import type {
  HardwareWalletAccountRequest,
  HardwareWalletBalance,
  HardwareWalletBroadcastRequest,
  HardwareWalletBroadcastResult,
  HardwareWalletTransactionsRequest,
  HardwareWalletTransactionsResult,
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

// Whether the wallet backing hardware reads is still syncing headers/blocks.
// Threaded to the renderer so a fresh chain host shows "syncing" instead of
// a misleading zero balance / empty history.
async function isWalletSyncing(walletService: WalletService): Promise<boolean> {
  try {
    const progress = await walletService.getSyncProgress();
    return !progress.synced;
  } catch {
    return false;
  }
}

// Reads hardware account state through the local Oyster wallet. The public
// key import requests a rescan (now a fast batched backfill) so UTXOs
// received before the key was first imported are discovered; repeat imports
// are idempotent and skip the rescan.
async function getHardwareWalletBalance(
  request: HardwareWalletAccountRequest,
  walletService: WalletService
): Promise<HardwareWalletBalance> {
  const account = normalizeHardwareAccount(request);

  await walletService.importPublicKey(account.publicKey, true);
  const [localUtxos, walletSyncing] = await Promise.all([
    walletService.listUnspent(0),
    isWalletSyncing(walletService),
  ]);
  const utxos = localUtxos
    .filter(utxo => utxo.address === account.address)
    .map(normalizeOysterUtxo);
  const info = buildAddressInfo(account.address, utxos);
  return {info, utxos, source: 'oyster', walletSyncing};
}

export const HardwareWalletService = {
  async getBalance(
    request: HardwareWalletAccountRequest,
    walletService: WalletService
  ): Promise<HardwareWalletBalance> {
    return getHardwareWalletBalance(request, walletService);
  },

  // Transaction history for a hardware address. The indexer is the primary
  // source: its global view avoids per-wallet transaction-store gaps (each
  // wallet only knows what its own scans covered). The local wallet's
  // getaddresshistory view — classified from the address's perspective — is
  // the offline fallback.
  async getTransactions(
    request: HardwareWalletTransactionsRequest,
    walletService: WalletService | null
  ): Promise<HardwareWalletTransactionsResult> {
    const account = normalizeHardwareAccount(request);
    const page = Math.max(1, request.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, request.pageSize ?? 25));

    try {
      const history = await BlockbookClient.getAddressTransactions(
        account.address,
        account.network,
        page,
        pageSize
      );
      return {...history, source: 'indexer', walletSyncing: false};
    } catch (error) {
      console.error('Indexer history lookup failed, falling back to wallet:', error);
    }

    if (!walletService) {
      throw new Error('Transaction history is unavailable: indexer unreachable and no wallet running');
    }

    await walletService.importPublicKey(account.publicKey, true);
    const [history, walletSyncing] = await Promise.all([
      walletService.getAddressHistory(account.address),
      isWalletSyncing(walletService),
    ]);

    const transactions = history.map(entry => ({
      txid: entry.txid,
      type: entry.category === 'send' ? ('sent' as const) : ('received' as const),
      amount: Math.abs(entry.amount),
      fee: Math.abs(entry.fee ?? 0),
      confirmations: entry.confirmations,
      time: entry.time * 1000,
      address: entry.counterparty || account.address,
      account: '',
      blockhash: entry.blockhash ?? '',
      trusted: false,
      generated: false,
      selfTransfer: entry.selfTransfer === true,
    }));

    const start = (page - 1) * pageSize;
    return {
      transactions: transactions.slice(start, start + pageSize),
      hasMore: start + pageSize < transactions.length,
      source: 'oyster',
      walletSyncing,
    };
  },

  async broadcastTransaction(
    {
      network,
      rawTransactionHex,
      sourceAddress,
      sourcePublicKey,
      recipientAddress,
      amountSats,
    }: HardwareWalletBroadcastRequest,
    walletService: WalletService
  ): Promise<HardwareWalletBroadcastResult> {
    const account = normalizeHardwareAccount({
      address: sourceAddress,
      publicKey: sourcePublicKey,
      network,
    });
    const normalizedTransaction = normalizeRawTransactionHex(rawTransactionHex);

    await walletService.importPublicKey(account.publicKey, true);
    const rawTxid = await walletService.sendRawTransaction(normalizedTransaction);

    const txid = normalizeBlockbookTxid(rawTxid, 'broadcast transaction id');

    // Record for the large-send gate when the renderer supplied metadata; the
    // transaction already broadcast, so bookkeeping failures are only logged.
    if (recipientAddress) {
      try {
        recordSend({
          recipientAddress,
          txid,
          amountSats: amountSats ?? '0',
          network: account.network,
          source: 'hardware',
        });
      } catch (error) {
        console.error('Failed to record hardware send history:', error);
      }
    }

    let balance: HardwareWalletBalance | null = null;

    try {
      balance = await getHardwareWalletBalance(account, walletService);
    } catch {
      balance = null;
    }

    return {balance, txid};
  },
};
