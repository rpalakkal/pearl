import {displayToFs, isValidFilename} from '../../../utils/filename-utils';

// Shared by wallet create and import so both flows validate names the same
// way (format + fresh availability check against the wallet directory).

export function validateWalletNameFormat(name: string): string | null {
  if (!name?.trim()) {
    return 'Please enter a wallet name';
  }
  if (!isValidFilename(name)) {
    return 'Invalid wallet name';
  }
  return null;
}

export async function validateWalletNameAvailable(name: string): Promise<string | null> {
  const normalized = displayToFs(name.trim());
  const {walletNames} = await window.appBridge.manager.getExistingWallets();
  const equivalent = walletNames.find(
    wallet => displayToFs(wallet).toLowerCase() === normalized.toLowerCase()
  );
  if (equivalent) {
    return `A wallet named "${equivalent}" exists. Please choose a different name.`;
  }
  return null;
}
