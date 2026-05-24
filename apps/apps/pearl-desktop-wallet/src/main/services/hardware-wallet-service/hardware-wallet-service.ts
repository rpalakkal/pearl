import { BlockbookClient } from '../../clients/blockbook-client.ts';
import { normalizeBlockbookAddress } from '../../clients/blockbook-normalizers.ts';
import type {
  AppNetwork,
  HardwareWalletBalance,
  HardwareWalletBroadcastRequest,
  HardwareWalletBroadcastResult,
} from '../../../types/app-bridge.ts';

async function getHardwareWalletBalance(
  address: string,
  network?: AppNetwork
): Promise<HardwareWalletBalance> {
  const normalizedAddress = normalizeBlockbookAddress(address);
  const [info, utxos] = await Promise.all([
    BlockbookClient.getAddressInfo(normalizedAddress, network),
    BlockbookClient.getUtxos(normalizedAddress, network),
  ]);

  return { info, utxos };
}

export const HardwareWalletService = {
  async getBalance(address: string, network?: AppNetwork): Promise<HardwareWalletBalance> {
    return getHardwareWalletBalance(address, network);
  },

  async broadcastTransaction({
    network,
    rawTransactionHex,
    sourceAddress,
  }: HardwareWalletBroadcastRequest): Promise<HardwareWalletBroadcastResult> {
    const normalizedSourceAddress = normalizeBlockbookAddress(sourceAddress);
    const txid = await BlockbookClient.sendTransaction(rawTransactionHex, network);
    let balance: HardwareWalletBalance | null = null;

    try {
      balance = await getHardwareWalletBalance(normalizedSourceAddress, network);
    } catch {
      balance = null;
    }

    return { balance, txid };
  },
};
