import { type BrowserWindow, type WebFrameMain } from 'electron';
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

  walletSession.setPermissionCheckHandler((_, permission, requestingOrigin, details) => {
    if (permission !== 'hid' && permission !== 'usb') {
      return false;
    }

    if (details.requestingUrl) {
      return isHardwareWalletFrameUrl(details.requestingUrl, { allowedAppOrigins });
    }

    return isHardwareWalletOrigin(requestingOrigin, { allowedAppOrigins });
  });

  walletSession.setDevicePermissionHandler(details => {
    if (details.deviceType !== 'hid' && details.deviceType !== 'usb') {
      return false;
    }

    return (
      isHardwareWalletOrigin(details.origin, { allowFileOrigin: true, allowedAppOrigins }) &&
      isHardwareWalletDevice(details.device as HardwareWalletDeviceIdentity)
    );
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
  return isHardwareWalletFrameUrl(frame.url, { allowedAppOrigins });
}

export { configureHardwareWalletPermissions };
