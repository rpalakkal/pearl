import {getCurrentNetwork} from '../config/network-config';
import {
  getBlockbookBaseUrl,
  normalizeBlockbookFeeRate,
  normalizeBlockbookFeeTarget,
  type BlockbookNetwork,
} from './blockbook-normalizers';

export type {BlockbookAddressInfo, BlockbookNetwork, BlockbookUtxo} from './blockbook-normalizers';

async function fetchBlockbookJson<T>(
  network: BlockbookNetwork | undefined,
  path: string
): Promise<T> {
  const response = await fetch(`${getBlockbookBaseUrl(network ?? getCurrentNetwork())}${path}`);

  if (!response.ok) {
    throw new Error(`Blockbook request failed with ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * The only remaining external-indexer call: fee estimation. The SPV node has
 * no mempool, so there is no local data source for congestion-based fee
 * estimates; callers fall back to static tiers when this is unreachable.
 * Everything else (balances, UTXOs, history, broadcasts, confirmations) is
 * served by the local wallet.
 */
export const BlockbookClient = {
  async estimateFee(numBlocks: number, network?: BlockbookNetwork): Promise<number> {
    const normalizedNumBlocks = normalizeBlockbookFeeTarget(numBlocks);
    const data = await fetchBlockbookJson<{result: string | number}>(
      network,
      `/api/v1/estimatefee/${normalizedNumBlocks}`
    );
    return normalizeBlockbookFeeRate(data.result);
  },
};
