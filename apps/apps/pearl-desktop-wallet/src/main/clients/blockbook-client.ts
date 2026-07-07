import {getCurrentNetwork} from '../config/network-config';
import {
  getBlockbookBaseUrl,
  normalizeBlockbookAddress,
  normalizeBlockbookAddressTransactions,
  normalizeBlockbookFeeRate,
  normalizeBlockbookFeeTarget,
  type BlockbookAddressHistory,
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
 * Remaining external-indexer calls: fee estimation (the SPV node has no
 * mempool, so there is no local data source; callers fall back to static
 * tiers) and address transaction history (display data where the indexer's
 * global view avoids per-wallet store gaps; the local wallet view is the
 * fallback). Balances, UTXOs, broadcasts, and confirmations are all served
 * by the local wallet.
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

  async getAddressTransactions(
    address: string,
    network?: BlockbookNetwork,
    page: number = 1,
    pageSize: number = 25
  ): Promise<BlockbookAddressHistory> {
    const normalizedAddress = normalizeBlockbookAddress(address);
    const data = await fetchBlockbookJson<unknown>(
      network,
      `/api/v2/address/${encodeURIComponent(normalizedAddress)}?details=txs&page=${page}&pageSize=${pageSize}`
    );

    return normalizeBlockbookAddressTransactions(data, normalizedAddress);
  },
};
