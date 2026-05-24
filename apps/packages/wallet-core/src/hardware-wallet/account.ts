import { derivePearlTaprootAddress, getBitcoinDeviceDisplayAddress } from './address.ts';
import { getHardwareWalletAddressIndexFromPath, getPearlHardwareWalletPath, normalizeHardwareWalletAddressIndex } from './paths.ts';
import type { HardwareWalletAddress } from './types.ts';

export function validateHardwareWalletAccount(account: HardwareWalletAddress): void {
  if (account.vendor !== 'ledger' && account.vendor !== 'trezor') {
    throw new Error('Unsupported hardware wallet provider.');
  }

  if (account.network !== 'mainnet' && account.network !== 'testnet') {
    throw new Error('Unsupported hardware wallet network.');
  }

  const pathAddressIndex = getHardwareWalletAddressIndexFromPath(
    account.path,
    account.network,
    account.vendor
  );
  const addressIndex = normalizeHardwareWalletAddressIndex(account.addressIndex ?? pathAddressIndex);

  if (pathAddressIndex !== addressIndex) {
    throw new Error('Hardware wallet account uses an unsupported derivation path.');
  }

  const expectedPath = getPearlHardwareWalletPath(account.network, account.vendor, addressIndex);
  if (account.path !== expectedPath) {
    throw new Error('Hardware wallet account uses an unsupported derivation path.');
  }

  const expectedAddress = derivePearlTaprootAddress(account.publicKey, account.network);
  if (account.address !== expectedAddress) {
    throw new Error('Hardware wallet account address does not match its public key.');
  }
}

export function validateHardwareWalletDeviceAccount(
  account: HardwareWalletAddress,
  devicePublicKey: string,
  deviceDisplayAddress?: string
): void {
  validateHardwareWalletAccount(account);

  const devicePearlAddress = derivePearlTaprootAddress(devicePublicKey, account.network);
  if (devicePearlAddress !== account.address) {
    throw new Error(`The connected ${getHardwareWalletProviderName(account.vendor)} does not match this Pearl hardware account.`);
  }

  if (deviceDisplayAddress) {
    const expectedDeviceAddress = getBitcoinDeviceDisplayAddress(account.address, account.network);

    if (deviceDisplayAddress !== expectedDeviceAddress) {
      throw new Error(`The connected ${getHardwareWalletProviderName(account.vendor)} returned a different address than this Pearl hardware account.`);
    }
  }
}

export function getHardwareWalletProviderName(vendor: HardwareWalletAddress['vendor']): string {
  return vendor === 'ledger' ? 'Ledger' : 'Trezor';
}
