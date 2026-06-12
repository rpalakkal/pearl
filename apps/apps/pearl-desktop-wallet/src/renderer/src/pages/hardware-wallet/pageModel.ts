import {
  formatSatsAsPearl,
  getBitcoinDeviceDisplayAddress,
  isConfirmedHardwareUtxo,
  type HardwarePearlSendPreview,
  type HardwareWalletAddress,
} from '../../lib/hardwareWallet.ts';
import {getErrorMessage} from '../../lib/utils.ts';
import type {BlockbookAddressInfo, BlockbookUtxo} from '../../../../types/app-bridge.ts';

type HardwareWalletLogLevel = 'info' | 'warn' | 'error';
type HardwareWalletLogDetails = Record<string, string | number | boolean | null | undefined>;

export function isPendingHardwareUtxo(utxo: BlockbookUtxo): boolean {
  return !isConfirmedHardwareUtxo(utxo);
}

export function hasPendingOutgoingHardwareTransaction(
  info: BlockbookAddressInfo | null | undefined
): boolean {
  if (!info) {
    return false;
  }

  try {
    return BigInt(info.unconfirmedBalance) < 0n;
  } catch {
    return false;
  }
}

export function getSpendableHardwareUtxoValue(utxo: BlockbookUtxo): bigint {
  if (isPendingHardwareUtxo(utxo)) {
    return 0n;
  }

  return getHardwareUtxoValue(utxo);
}

export function getHardwareUtxoValue(utxo: BlockbookUtxo): bigint {
  try {
    const value = BigInt(utxo.value);
    return value > 0n ? value : 0n;
  } catch {
    return 0n;
  }
}

export function getHardwareBalanceSats(value: string | number | undefined): bigint {
  if (value === undefined) {
    return 0n;
  }

  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function logHardwareWalletEvent(
  event: string,
  details: HardwareWalletLogDetails = {},
  level: HardwareWalletLogLevel = 'info'
): void {
  const serializedDetails = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  const message = serializedDetails
    ? `[HardwareWallet] ${event} ${serializedDetails}`
    : `[HardwareWallet] ${event}`;

  if (level === 'error') {
    console.error(message);
    return;
  }

  if (level === 'warn') {
    console.warn(message);
    return;
  }

  console.info(message);
}

export function hardwareAccountLogContext(
  account: HardwareWalletAddress
): HardwareWalletLogDetails {
  return {
    vendor: account.vendor,
    network: account.network,
    addressIndex: account.addressIndex,
    path: account.path,
    address: compactHardwareAddress(account.address),
    deviceDisplayAddress: compactHardwareAddress(
      getBitcoinDeviceDisplayAddress(account.address, account.network)
    ),
  };
}

export function hardwareBalanceLogContext(
  info: BlockbookAddressInfo,
  addressUtxos: BlockbookUtxo[]
): HardwareWalletLogDetails {
  const hasPendingOutgoingSpend = hasPendingOutgoingHardwareTransaction(info);
  const pendingUtxos = addressUtxos.filter(isPendingHardwareUtxo);
  let spendableSats = 0n;
  let spendableUtxoCount = 0;

  if (!hasPendingOutgoingSpend) {
    for (const utxo of addressUtxos) {
      const value = getSpendableHardwareUtxoValue(utxo);
      if (value > 0n) {
        spendableSats += value;
        spendableUtxoCount += 1;
      }
    }
  }

  return {
    balance: formatSatsAsPearl(info.balance),
    unconfirmed: formatSatsAsPearl(info.unconfirmedBalance),
    spendable: formatSatsAsPearl(spendableSats),
    utxos: addressUtxos.length,
    spendableUtxos: spendableUtxoCount,
    pendingUtxos: pendingUtxos.length,
    pendingOutgoing: hasPendingOutgoingSpend,
  };
}

export function hardwareSendPreviewLogContext(
  preview: HardwarePearlSendPreview
): HardwareWalletLogDetails {
  return {
    amountSats: preview.amountSats.toString(),
    feeSats: preview.feeSats.toString(),
    changeSats: preview.changeSats.toString(),
    inputs: preview.inputCount,
    deviceDisplayAddress: compactHardwareAddress(preview.deviceDisplayAddress),
    outpoints: preview.selectedOutpoints
      .map(outpoint => `${outpoint.txid.slice(0, 8)}:${outpoint.vout}`)
      .join(','),
  };
}

export function compactHardwareAddress(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function getErrorLogMessage(error: unknown): string {
  return getErrorMessage(error, 'Unknown error');
}

export function sendPreviewsEqual(
  left: HardwarePearlSendPreview,
  right: HardwarePearlSendPreview
): boolean {
  return (
    left.amountSats === right.amountSats &&
    left.feeSats === right.feeSats &&
    left.changeSats === right.changeSats &&
    left.inputCount === right.inputCount &&
    left.selectedOutpoints.length === right.selectedOutpoints.length &&
    left.selectedOutpoints.every((outpoint, index) => {
      const other = right.selectedOutpoints[index];
      if (!other) {
        return false;
      }

      return (
        outpoint.txid === other.txid &&
        outpoint.vout === other.vout &&
        outpoint.valueSats === other.valueSats
      );
    }) &&
    left.deviceDisplayAddress === right.deviceDisplayAddress
  );
}

export function hardwareAccountKey(account: HardwareWalletAddress): string {
  return `${account.network}.${account.vendor}.${account.addressIndex}.${account.path}.${account.address}.${account.publicKey}`;
}
