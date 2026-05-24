type HardwareWalletDeviceIdentity = {
  vendorId: number;
  productId: number;
  name?: string;
  manufacturerName?: string;
  productName?: string;
};

type HardwareWalletOriginOptions = {
  allowFileOrigin?: boolean;
  allowedAppOrigins?: readonly string[];
};

const ledgerVendorId = 0x2c97;
const trezorHidVendorId = 0x534c;
const trezorWebUsbVendorId = 0x1209;

const trezorProductIdsByVendor = new Map<number, ReadonlySet<number>>([
  [trezorHidVendorId, new Set([0x0001])],
  [trezorWebUsbVendorId, new Set([0x53c0, 0x53c1])],
]);

function isHardwareWalletDevice(device: HardwareWalletDeviceIdentity): boolean {
  const name = getDeviceName(device).toLowerCase();

  // Some Electron device picker payloads omit reliable product IDs; keep this as a compatibility fallback.
  return (
    isKnownHardwareWalletUsbIdentifier(device) ||
    name.includes('ledger') ||
    name.includes('trezor') ||
    name.includes('satoshilabs')
  );
}

function isKnownHardwareWalletUsbIdentifier(device: HardwareWalletDeviceIdentity): boolean {
  if (device.vendorId === ledgerVendorId) {
    return true;
  }

  return trezorProductIdsByVendor.get(device.vendorId)?.has(device.productId) === true;
}

function getDeviceName(device: HardwareWalletDeviceIdentity): string {
  if (device.name) {
    return device.name;
  }

  return `${device.manufacturerName ?? ''} ${device.productName ?? ''}`;
}

function isHardwareWalletOrigin(
  origin: string,
  options: HardwareWalletOriginOptions = {}
): boolean {
  if (origin.startsWith('file://')) {
    return options.allowFileOrigin === true;
  }

  try {
    const url = new URL(origin);
    return (options.allowedAppOrigins ?? []).includes(url.origin) || isTrezorConnectUrl(origin);
  } catch {
    return false;
  }
}

function isHardwareWalletFrameUrl(url: string, options: HardwareWalletOriginOptions = {}): boolean {
  return isTrustedAppFileUrl(url) || isHardwareWalletOrigin(url, options);
}

function isTrustedAppFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'file:') {
      return false;
    }

    return decodeURIComponent(parsed.pathname).endsWith('/out/renderer/index.html');
  } catch {
    return false;
  }
}

function isTrezorConnectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === 'https://connect.trezor.io' || parsed.origin === 'https://suite.trezor.io'
    );
  } catch {
    return false;
  }
}

function getTrustedHardwareWalletAppOrigins(rendererUrl?: string): string[] {
  if (!rendererUrl) {
    return [];
  }

  try {
    return [new URL(rendererUrl).origin];
  } catch {
    return [];
  }
}

export {
  getTrustedHardwareWalletAppOrigins,
  isHardwareWalletDevice,
  isHardwareWalletFrameUrl,
  isHardwareWalletOrigin,
  isTrezorConnectUrl,
  type HardwareWalletDeviceIdentity,
};
