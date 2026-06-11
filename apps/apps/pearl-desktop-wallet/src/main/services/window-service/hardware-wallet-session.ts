import {type BrowserWindow, type WebFrameMain} from 'electron';
import {
  getTrustedHardwareWalletAppOrigins,
  isHardwareWalletDevice,
  isHardwareWalletFrameUrl,
  isHardwareWalletOrigin,
  type HardwareWalletDeviceIdentity,
} from './hardware-wallet-permissions.ts';

function configureHardwareWalletPermissions(
  mainWindow: BrowserWindow,
  rendererUrl: string | undefined
): void {
  const walletSession = mainWindow.webContents.session;
  const allowedAppOrigins = getTrustedHardwareWalletAppOrigins(rendererUrl);
  console.info(
    `[HardwareWallet] permissions:configured rendererUrl=${rendererUrl ?? 'packaged-file'} allowedOrigins=${allowedAppOrigins.join(',') || 'none'}`
  );

  walletSession.setPermissionCheckHandler((_, permission, requestingOrigin, details) => {
    if (permission !== 'hid' && permission !== 'usb') {
      return false;
    }

    if (details.requestingUrl) {
      const allowed = isHardwareWalletFrameUrl(details.requestingUrl, {allowedAppOrigins});
      logHardwareWalletPermissionCheck(permission, allowed, requestingOrigin, details.requestingUrl);
      return allowed;
    }

    const allowed = isHardwareWalletOrigin(requestingOrigin, {
      allowFileOrigin: true,
      allowedAppOrigins,
    });
    logHardwareWalletPermissionCheck(permission, allowed, requestingOrigin);
    return allowed;
  });

  walletSession.setDevicePermissionHandler(details => {
    if (details.deviceType !== 'hid' && details.deviceType !== 'usb') {
      return false;
    }

    const allowed =
      isHardwareWalletOrigin(details.origin, {allowFileOrigin: true, allowedAppOrigins}) &&
      isHardwareWalletDevice(details.device as HardwareWalletDeviceIdentity);
    console.info(
      `[HardwareWallet] device-permission type=${details.deviceType} origin=${details.origin} device=${getHardwareWalletDeviceLogName(details.device as HardwareWalletDeviceIdentity)} allowed=${allowed}`
    );
    return allowed;
  });

  walletSession.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    if (!isHardwareWalletFrame(details.frame, allowedAppOrigins)) {
      callback();
      return;
    }

    const device = details.deviceList.find(isHardwareWalletDevice);
    console.info(
      `[HardwareWallet] HID device picker candidates=${details.deviceList.length} selected=${Boolean(device)}`
    );
    callback(device?.deviceId);
  });

  walletSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    if (!isHardwareWalletFrame(details.frame, allowedAppOrigins)) {
      callback();
      return;
    }

    const device = details.deviceList.find(isHardwareWalletDevice);
    console.info(
      `[HardwareWallet] USB device picker candidates=${details.deviceList.length} selected=${Boolean(device)}`
    );
    callback(device?.deviceId);
  });
}

function isHardwareWalletFrame(frame: WebFrameMain, allowedAppOrigins: readonly string[]): boolean {
  return isHardwareWalletFrameUrl(frame.url, {allowedAppOrigins});
}

function logHardwareWalletPermissionCheck(
  permission: string,
  allowed: boolean,
  requestingOrigin: string,
  requestingUrl?: string
): void {
  console.info(
    `[HardwareWallet] permission-check permission=${permission} origin=${requestingOrigin || 'none'} requestingUrl=${requestingUrl ?? 'none'} allowed=${allowed}`
  );
}

function getHardwareWalletDeviceLogName(device: HardwareWalletDeviceIdentity): string {
  const name = device.name ?? `${device.manufacturerName ?? ''} ${device.productName ?? ''}`.trim();
  return `${name || 'unknown'} vendor=${device.vendorId} product=${device.productId}`;
}

export {configureHardwareWalletPermissions};
