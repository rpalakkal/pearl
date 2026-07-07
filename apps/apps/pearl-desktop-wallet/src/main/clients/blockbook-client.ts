import {getCurrentNetwork} from '../config/network-config';
import {
  getBlockbookBaseUrl,
  normalizeBlockbookAddress,
  normalizeBlockbookAddressInfo,
  normalizeBlockbookAddressTransactions,
  normalizeBlockbookFeeRate,
  normalizeBlockbookFeeTarget,
  normalizeBlockbookTransactionConfirmations,
  normalizeBlockbookTxid,
  normalizeBlockbookUtxoList,
  normalizeRawTransactionHex,
  type BlockbookAddressHistory,
  type BlockbookAddressInfo,
  type BlockbookNetwork,
  type BlockbookUtxo,
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

async function postBlockbookText(
  network: BlockbookNetwork | undefined,
  path: string,
  body: string
): Promise<string> {
  const response = await fetch(`${getBlockbookBaseUrl(network ?? getCurrentNetwork())}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body,
  });
  const text = await response.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const error =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String(parsed.error)
        : `${response.status} ${response.statusText}`;
    throw new Error(`Blockbook request failed: ${error}`);
  }

  if (typeof parsed === 'object' && parsed !== null) {
    if ('result' in parsed) {
      return String(parsed.result);
    }

    if ('txid' in parsed) {
      return String(parsed.txid);
    }
  }

  return String(parsed);
}

async function getBlockbookTransactionConfirmations(
  txid: string,
  network?: BlockbookNetwork
): Promise<number> {
  const data = await fetchBlockbookJson<unknown>(network, `/api/v2/tx/${encodeURIComponent(txid)}`);

  return normalizeBlockbookTransactionConfirmations(data, txid);
}

async function hydrateUtxoConfirmations(
  utxos: BlockbookUtxo[],
  network?: BlockbookNetwork
): Promise<BlockbookUtxo[]> {
  const confirmationRequests = new Map<string, Promise<number>>();

  return Promise.all(
    utxos.map(async utxo => {
      if ((utxo.confirmations ?? 0) > 0) {
        return utxo;
      }

      let confirmationRequest = confirmationRequests.get(utxo.txid);
      if (!confirmationRequest) {
        confirmationRequest = getBlockbookTransactionConfirmations(utxo.txid, network);
        confirmationRequests.set(utxo.txid, confirmationRequest);
      }

      try {
        const confirmations = await confirmationRequest;
        return confirmations > (utxo.confirmations ?? 0) ? {...utxo, confirmations} : utxo;
      } catch {
        return utxo;
      }
    })
  );
}

export const BlockbookClient = {
  getTransactionConfirmations: getBlockbookTransactionConfirmations,

  async estimateFee(numBlocks: number, network?: BlockbookNetwork): Promise<number> {
    const normalizedNumBlocks = normalizeBlockbookFeeTarget(numBlocks);
    const data = await fetchBlockbookJson<{result: string | number}>(
      network,
      `/api/v1/estimatefee/${normalizedNumBlocks}`
    );
    return normalizeBlockbookFeeRate(data.result);
  },

  async getAddressInfo(address: string, network?: BlockbookNetwork): Promise<BlockbookAddressInfo> {
    const normalizedAddress = normalizeBlockbookAddress(address);
    const data = await fetchBlockbookJson<unknown>(
      network,
      `/api/v2/address/${encodeURIComponent(normalizedAddress)}?details=basic`
    );

    return normalizeBlockbookAddressInfo(data, normalizedAddress);
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

  async getUtxos(address: string, network?: BlockbookNetwork): Promise<BlockbookUtxo[]> {
    const normalizedAddress = normalizeBlockbookAddress(address);
    const data = await fetchBlockbookJson<unknown>(
      network,
      `/api/v2/utxo/${encodeURIComponent(normalizedAddress)}`
    );

    return hydrateUtxoConfirmations(normalizeBlockbookUtxoList(data), network);
  },

  async sendTransaction(rawTransactionHex: string, network?: BlockbookNetwork): Promise<string> {
    const normalizedTransaction = normalizeRawTransactionHex(rawTransactionHex);
    const txid = await postBlockbookText(network, '/api/v2/sendtx/', normalizedTransaction);
    return normalizeBlockbookTxid(txid, 'broadcast transaction id');
  },
};
