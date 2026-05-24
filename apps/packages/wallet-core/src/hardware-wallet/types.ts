export type HardwareWalletVendor = 'ledger' | 'trezor';
export type PearlNetwork = 'mainnet' | 'testnet';

export interface HardwareWalletAddress {
  vendor: HardwareWalletVendor;
  address: string;
  path: string;
  publicKey: string;
  network: PearlNetwork;
  addressIndex: number;
}

export interface HardwareWalletAddressVerification {
  pearlAddress: string;
  deviceDisplayAddress: string;
  path: string;
}

export interface HardwareWalletUtxo {
  txid: string;
  vout: number;
  value: string | number;
  height?: number;
  confirmations?: number;
}

export interface HardwarePearlSendRequest {
  account: HardwareWalletAddress;
  destinationAddress: string;
  amountSats: bigint;
  feeRatePrlPerKb: number;
  utxos: HardwareWalletUtxo[];
}

export interface HardwarePearlSendPlan {
  psbtBuffer: Uint8Array;
  feeSats: bigint;
  changeSats: bigint;
  selectedUtxos: HardwareWalletUtxo[];
  sourceOutputKey: Uint8Array;
}

export interface HardwarePearlSendPreview {
  amountSats: bigint;
  feeSats: bigint;
  changeSats: bigint;
  inputCount: number;
  selectedOutpoints: HardwarePearlSendPreviewOutpoint[];
  deviceDisplayAddress: string;
}

export interface HardwarePearlSendPreviewOutpoint {
  txid: string;
  vout: number;
  valueSats: bigint;
}

export interface HardwarePearlSignedTransaction {
  rawTransactionHex: string;
  feeSats: bigint;
  changeSats: bigint;
  inputCount: number;
}

export interface TrezorPearlSignTransactionPayload {
  coin: string;
  serialize: true;
  version: number;
  locktime: number;
  inputs: Array<{
    address_n: number[];
    prev_hash: string;
    prev_index: number;
    amount: string;
    script_type: 'SPENDTAPROOT';
    sequence: number;
  }>;
  outputs: Array<
    | {
        address: string;
        amount: string;
        script_type: 'PAYTOADDRESS';
      }
    | {
        address_n: number[];
        amount: string;
        script_type: 'PAYTOTAPROOT';
      }
  >;
}

export type HardwareWalletBuffer = import('buffer').Buffer;

export interface LedgerPearlSignPsbtOptions {
  finalizePsbt: true;
  accountPath: string;
  addressFormat: 'bech32m';
  knownAddressDerivations: Map<
    string,
    {
      pubkey: HardwareWalletBuffer;
      path: number[];
    }
  >;
}
