import type {AppNetwork} from '../../../types/app-bridge';

// TODO(config): confirm the real testnet explorer host.
export const EXPLORER_BASE_URLS: Record<AppNetwork, string> = {
  mainnet: 'https://prlscan.com',
  testnet: 'https://testnet.prlscan.com',
};

export function explorerTxUrl(txid: string, network: AppNetwork = 'mainnet'): string {
  return `${EXPLORER_BASE_URLS[network]}/tx/${txid}`;
}
