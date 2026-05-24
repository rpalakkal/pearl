import type { BlockbookAddressInfo, BlockbookUtxo } from '../../../../types/app-bridge.ts';

export interface HardwareWalletBalanceData {
  info: BlockbookAddressInfo;
  utxos: BlockbookUtxo[];
}
