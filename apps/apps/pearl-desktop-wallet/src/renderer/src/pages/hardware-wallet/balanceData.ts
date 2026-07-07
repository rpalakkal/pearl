import type {
  BlockbookAddressInfo,
  BlockbookUtxo,
  HardwareBalanceSource,
} from '../../../../types/app-bridge.ts';

export interface HardwareWalletBalanceData {
  info: BlockbookAddressInfo;
  utxos: BlockbookUtxo[];
  source: HardwareBalanceSource;
  walletSyncing: boolean;
}
