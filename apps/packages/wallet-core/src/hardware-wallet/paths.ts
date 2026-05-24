import {
  DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX,
  MAX_HARDWARE_WALLET_ADDRESS_INDEX,
  networkConfig,
} from './constants.ts';
import type { HardwareWalletVendor, PearlNetwork } from './types.ts';

export function normalizePearlNetwork(network: string): PearlNetwork {
  return network === 'testnet' ? 'testnet' : 'mainnet';
}

export function getPearlHardwareWalletPath(
  network: PearlNetwork,
  vendor: HardwareWalletVendor = 'trezor',
  addressIndex = DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
): string {
  return `m/86'/${networkConfig[network].coinTypes[vendor]}'/0'/0/${normalizeHardwareWalletAddressIndex(addressIndex)}`;
}

export function getPearlBip86Path(
  network: PearlNetwork,
  addressIndex = DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
): string {
  return `m/86'/${networkConfig[network].coinTypes.ledger}'/0'/0/${normalizeHardwareWalletAddressIndex(addressIndex)}`;
}

export function getPearlHardwareWalletAccountPath(
  network: PearlNetwork,
  vendor: HardwareWalletVendor = 'trezor'
): string {
  return `m/86'/${networkConfig[network].coinTypes[vendor]}'/0'`;
}

export function normalizeHardwareWalletAddressIndex(addressIndex: unknown): number {
  const value = typeof addressIndex === 'string'
    ? Number(addressIndex.trim())
    : Number(addressIndex);

  if (
    !Number.isSafeInteger(value) ||
    value < DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX ||
    value > MAX_HARDWARE_WALLET_ADDRESS_INDEX
  ) {
    throw new Error(`Hardware wallet address index must be between ${DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX} and ${MAX_HARDWARE_WALLET_ADDRESS_INDEX}.`);
  }

  return value;
}

export function getHardwareWalletAddressIndexFromPath(
  path: string,
  network: PearlNetwork,
  vendor: HardwareWalletVendor
): number {
  const match = /^m\/86'\/(\d+)'\/0'\/0\/(\d+)$/.exec(path);

  if (!match) {
    throw new Error('Hardware wallet account uses an unsupported derivation path.');
  }

  const [, coinType, addressIndex] = match;

  if (coinType !== networkConfig[network].coinTypes[vendor]) {
    throw new Error('Hardware wallet account uses an unsupported derivation path.');
  }

  return normalizeHardwareWalletAddressIndex(addressIndex);
}

export function parseBip32Path(path: string): number[] {
  return path
    .replace(/^m\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(segment => {
      const hardened = segment.endsWith("'");
      const valueText = hardened ? segment.slice(0, -1) : segment;
      const value = Number(valueText);

      if (!Number.isInteger(value) || value < 0 || value >= 0x80000000) {
        throw new Error(`Invalid hardware wallet derivation path segment: ${segment}`);
      }

      return hardened ? value + 0x80000000 : value;
    });
}

export function getAccountPathFromAddressPath(path: string): string {
  const segments = path.split('/').filter(Boolean);

  if (segments.length < 4 || segments[0] !== 'm') {
    throw new Error('Invalid hardware wallet account path.');
  }

  return segments.slice(0, 4).join('/');
}

export function getLedgerCurrency(network: PearlNetwork): string {
  return network === 'testnet' ? 'bitcoin_testnet' : 'bitcoin';
}

export function getTrezorCoin(network: PearlNetwork): string {
  return network === 'testnet' ? 'test' : 'btc';
}
