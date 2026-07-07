import { RpcClient } from '../rpc-client';
import type { AddressBackfillStatus, SyncProgress } from '../../../types/app-bridge';

interface RawBackfillStatus {
  address: string;
  status: AddressBackfillStatus['status'];
  start_height: number;
  current_height: number;
  target_height: number;
  error?: string;
}

function normalizeBackfillStatus(raw: RawBackfillStatus): AddressBackfillStatus {
  return {
    address: raw.address,
    status: raw.status,
    startHeight: raw.start_height,
    currentHeight: raw.current_height,
    targetHeight: raw.target_height,
    error: raw.error,
  };
}

export interface ListUnspentResult {
  txid: string;
  vout: number;
  address?: string;
  account?: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
}

class WalletRpcMethods {
  constructor(private readonly rpc: RpcClient) { }

  getInfo() {
    return this.rpc.call<any>('getinfo', []);
  }

  getSyncProgress(): Promise<SyncProgress> {
    return this.rpc
      .call<{
        header_height: number;
        filter_header_height: number;
        block_height: number;
        best_peer_height: number;
        synced: boolean;
      }>('getsyncprogress', [])
      .then(r => ({
        headerHeight: r.header_height,
        filterHeaderHeight: r.filter_header_height,
        blockHeight: r.block_height,
        bestPeerHeight: r.best_peer_height,
        synced: r.synced,
      }));
  }

  chainSynced() {
    return this.rpc.call<boolean>('chainsynced', []);
  }

  getAddressesByAccount(account: string = 'default') {
    return this.rpc.call<string[]>('getaddressesbyaccount', [account]);
  }

  importPrivateKey(privateKey: string, label: string = '', rescan: boolean = false) {
    return this.rpc.call<void>('importprivkey', [privateKey, label, rescan]);
  }

  importPublicKey(publicKey: string, rescan: boolean = false) {
    return this.rpc.call<void>('importpubkey', [publicKey, rescan]);
  }

  getNewAddress(account: string = 'default') {
    return this.rpc.call<string>('getnewaddress', [account]);
  }

  getBalance(account: string = 'default', minconf: number = 1) {
    return this.rpc.call<number>('getbalance', [account, minconf]);
  }

  getReceivedByAddress(address: string) {
    return this.rpc.call<number>('getreceivedbyaddress', [address]);
  }

  listAllTransactions() {
    return this.rpc.call<any>('listalltransactions', []);
  }

  listTransactions(count: number = 10, from: number = 0) {
    // Passing account gives an error: Transactions are not yet grouped by account
    return this.rpc.call<any>('listtransactions', [undefined, count, from]);
  }

  listUnspent(minconf: number = 0, maxconf: number = 9999999) {
    return this.rpc.call<ListUnspentResult[]>('listunspent', [minconf, maxconf]);
  }

  unlockWallet(passphrase: string, timeout: number = 3600) {
    return this.rpc.call<void>('walletpassphrase', [passphrase, timeout]);
  }

  lockWallet() {
    return this.rpc.call<void>('walletlock', []);
  }

  changeWalletPassphrase(oldPassphrase: string, newPassphrase: string) {
    return this.rpc.call<void>('walletpassphrasechange', [oldPassphrase, newPassphrase]);
  }

  sendFromDefaultAccount(toAddress: string, amount: number, feeRate: number, minconf: number = 0) {
    const outputs = { [toAddress]: amount };
    return this.rpc.call<string>('sendmany', ['default', outputs, feeRate, minconf]);
  }

  sendRawTransaction(rawTransactionHex: string) {
    return this.rpc.call<string>('sendrawtransaction', [rawTransactionHex]);
  }

  // Transactions involving one address, classified from that address's
  // perspective (listtransactions categories are wallet-relative and read
  // backwards for watch-only imports).
  getAddressHistory(address: string) {
    return this.rpc.call<
      Array<{
        txid: string;
        category: 'send' | 'receive';
        amount: number;
        fee: number;
        selfTransfer?: boolean;
        counterparty?: string;
        confirmations: number;
        time: number;
        blockhash?: string;
      }>
    >('getaddresshistory', [address]);
  }

  rescanAddress(address: string, startHeight: number = 0, publicKey?: string) {
    const params: (string | number)[] = [address, startHeight];
    if (publicKey) {
      params.push(publicKey);
    }
    return this.rpc
      .call<RawBackfillStatus>('rescanaddress', params)
      .then(normalizeBackfillStatus);
  }

  getRescanStatus(address: string) {
    return this.rpc
      .call<RawBackfillStatus>('getrescanstatus', [address])
      .then(normalizeBackfillStatus);
  }

  async validateAddress(address: string) {
    const validationResult = await this.rpc.call<{ isvalid: boolean }>('validateaddress', [address]);
    return { isValid: validationResult.isvalid };
  }
}

export { WalletRpcMethods };
