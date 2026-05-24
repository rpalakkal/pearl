import {derivePearlTaprootAddress} from './hardware-wallet/address.ts';
import {validateHardwareWalletAccount} from './hardware-wallet/account.ts';
import {DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX} from './hardware-wallet/constants.ts';
import {
  getLedgerPublicKey,
  signLedgerPearlTransaction,
  verifyLedgerWalletAddress,
} from './hardware-wallet/ledger.ts';
import {
  getPearlHardwareWalletPath,
  normalizeHardwareWalletAddressIndex,
} from './hardware-wallet/paths.ts';
import {
  getTrezorPublicKey,
  signTrezorPearlTransaction,
  verifyTrezorWalletAddress,
} from './hardware-wallet/trezor.ts';
import type {
  HardwarePearlSendRequest,
  HardwarePearlSignedTransaction,
  HardwareWalletAddress,
  HardwareWalletAddressVerification,
  HardwareWalletVendor,
  PearlNetwork,
} from './hardware-wallet/types.ts';

export {
  DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX,
  MAX_HARDWARE_WALLET_ADDRESS_INDEX,
} from './hardware-wallet/constants.ts';
export {preloadHardwareWalletSupport} from './hardware-wallet/browser.ts';
export {parsePearlAmountToSats, formatSatsAsPearl} from './hardware-wallet/amounts.ts';
export {
  derivePearlTaprootAddress,
  getBitcoinDeviceDisplayAddress,
  pearlTaprootScriptFromAddress,
} from './hardware-wallet/address.ts';
export {
  getHardwareWalletProviderName,
  validateHardwareWalletAccount,
  validateHardwareWalletDeviceAccount,
} from './hardware-wallet/account.ts';
export {
  getHardwareWalletErrorMessage,
  isLedgerUnsupportedTaprootAddressError,
} from './hardware-wallet/errors.ts';
export {readLedgerTaprootWalletPublicKey} from './hardware-wallet/ledger.ts';
export {
  getHardwareWalletAddressIndexFromPath,
  getPearlBip86Path,
  getPearlHardwareWalletAccountPath,
  getPearlHardwareWalletPath,
  normalizeHardwareWalletAddressIndex,
  normalizePearlNetwork,
} from './hardware-wallet/paths.ts';
export {
  buildLedgerSignPsbtOptions,
  buildPearlSendPlan,
  buildTrezorSignTransactionPayload,
  isConfirmedHardwareUtxo,
  previewHardwarePearlSend,
  validateSignedHardwareTransaction,
} from './hardware-wallet/transactions.ts';
export type {
  HardwarePearlSendPlan,
  HardwarePearlSendPreview,
  HardwarePearlSendPreviewOutpoint,
  HardwarePearlSendRequest,
  HardwarePearlSignedTransaction,
  HardwareWalletAddress,
  HardwareWalletAddressVerification,
  HardwareWalletUtxo,
  HardwareWalletVendor,
  LedgerPearlSignPsbtOptions,
  PearlNetwork,
  TrezorPearlSignTransactionPayload,
} from './hardware-wallet/types.ts';

export async function connectHardwareWallet(
  vendor: HardwareWalletVendor,
  network: PearlNetwork,
  addressIndex = DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
): Promise<HardwareWalletAddress> {
  const normalizedAddressIndex = normalizeHardwareWalletAddressIndex(addressIndex);
  const path = getPearlHardwareWalletPath(network, vendor, normalizedAddressIndex);
  const publicKey =
    vendor === 'ledger'
      ? await getLedgerPublicKey(path, network)
      : await getTrezorPublicKey(path, network);

  return {
    vendor,
    address: derivePearlTaprootAddress(publicKey, network),
    path,
    publicKey,
    network,
    addressIndex: normalizedAddressIndex,
  };
}

export async function verifyHardwareWalletAddress(
  account: HardwareWalletAddress
): Promise<HardwareWalletAddressVerification> {
  validateHardwareWalletAccount(account);

  return account.vendor === 'ledger'
    ? verifyLedgerWalletAddress(account)
    : verifyTrezorWalletAddress(account);
}

export async function signHardwarePearlTransaction(
  request: HardwarePearlSendRequest
): Promise<HardwarePearlSignedTransaction> {
  validateHardwareWalletAccount(request.account);

  return request.account.vendor === 'ledger'
    ? signLedgerPearlTransaction(request)
    : signTrezorPearlTransaction(request);
}
