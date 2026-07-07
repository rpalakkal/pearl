export interface Transaction {
  txid: string;
  type: 'received' | 'sent';
  // For self-transfers this is the net cost (the fee), not the recycled
  // balance — every output returned to the sender.
  amount: number;
  fee: number;
  confirmations: number;
  time: number;
  address: string;
  account: string;
  blockhash: string;
  trusted: boolean;
  generated: boolean;
  // Every output paid the sending address itself (e.g. a test send to your
  // own address or a UTXO consolidation).
  selfTransfer?: boolean;
}
