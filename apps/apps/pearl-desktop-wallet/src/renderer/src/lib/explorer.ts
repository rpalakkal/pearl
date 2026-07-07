export const EXPLORER_BASE_URL = 'https://prlscan.com';

export function explorerTxUrl(txid: string): string {
  return `${EXPLORER_BASE_URL}/tx/${txid}`;
}
