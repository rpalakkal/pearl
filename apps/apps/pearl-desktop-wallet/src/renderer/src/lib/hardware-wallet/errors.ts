import { getHardwareWalletProviderName } from './account.ts';
import type { HardwareWalletVendor } from './types.ts';

export function getHardwareWalletErrorMessage(
  error: unknown,
  vendor: HardwareWalletVendor
): string {
  const provider = getHardwareWalletProviderName(vendor);
  const message = error instanceof Error ? error.message : String(error || '');
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes('webhid') ||
    normalizedMessage.includes('webusb') ||
    normalizedMessage.includes('hidnotsupported') ||
    normalizedMessage.includes('usbnotsupported') ||
    normalizedMessage.includes('navigator.hid') ||
    normalizedMessage.includes('navigator.usb')
  ) {
    return `${provider} device access is not available in this Electron runtime.`;
  }

  if (
    vendor === 'ledger' &&
    isLedgerUnsupportedTaprootAddressError(error)
  ) {
    return 'Update the Ledger Bitcoin app in Ledger Live to a Taproot-capable version, then quit Ledger Live, reopen the Bitcoin app on the device, and try again.';
  }

  if (
    vendor === 'ledger' &&
    (
      normalizedMessage.includes('unknown_error (0x6d09)') ||
      normalizedMessage.includes('0x6d09')
    )
  ) {
    return 'Ledger returned a transient connection error. Keep the Bitcoin app open, reconnect the Ledger if needed, and try again.';
  }

  if (
    vendor === 'trezor' &&
    (
      normalizedMessage.includes('iframe') ||
      normalizedMessage.includes('popup connection') ||
      normalizedMessage.includes('connect popup')
    )
  ) {
    return 'Trezor Connect did not load. Check your internet connection and try again.';
  }

  if (
    vendor === 'trezor' &&
    (
      normalizedMessage.includes("reading 'trim'") ||
      normalizedMessage.includes('failure_actioncancelled') ||
      normalizedMessage.includes('action cancelled') ||
      normalizedMessage.includes('actioncancelled')
    )
  ) {
    return 'Trezor signing was cancelled or did not complete. Close the popup and try again.';
  }

  if (vendor === 'trezor' && normalizedMessage.includes('localnetworkpermission')) {
    return 'Trezor Connect needs local network access to reach Trezor Suite or Trezor Bridge.';
  }

  if (
    normalizedMessage.includes('access denied') ||
    normalizedMessage.includes('cancel') ||
    normalizedMessage.includes('no device') ||
    normalizedMessage.includes('user gesture')
  ) {
    return vendor === 'ledger'
      ? 'No Ledger was selected. Connect and unlock the device, open the Bitcoin app, then try again.'
      : 'No Trezor was selected. Connect and unlock the device, then try again.';
  }

  if (normalizedMessage.includes('locked')) {
    return `Unlock your ${provider} and try again.`;
  }

  return message || `Unable to communicate with ${provider}.`;
}

export function isLedgerUnsupportedTaprootAddressError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes('unsupported address format bech32m') ||
    normalizedMessage.includes('signpsbtbuffer is not supported') ||
    normalizedMessage.includes('legacy bitcoin app')
  );
}
