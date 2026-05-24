import { BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { isTrezorConnectUrl } from './hardware-wallet-permissions';
import { configureHardwareWalletPermissions } from './hardware-wallet-session.ts';

const hardwareWalletRendererLogPrefix = '[HardwareWallet]';

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    maxWidth: 2000,
    maxHeight: 2000,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
    useContentSize: false,
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(details => {
    if (isTrezorConnectUrl(details.url)) {
      console.info(`[HardwareWallet] Trezor Connect popup allowed url=${compactLogUrl(details.url)}`);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          modal: true,
          frame: true,
          titleBarStyle: 'default',
          width: 420,
          height: 720,
          minWidth: 360,
          minHeight: 520,
          resizable: true,
          closable: true,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          title: 'Trezor Connect',
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        },
      };
    }

    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    if (!isTrezorConnectUrl(details.url)) {
      return;
    }

    childWindow.setWindowButtonVisibility?.(true);
    childWindow.webContents.on('before-input-event', (event, input) => {
      const shouldClose =
        input.type === 'keyDown' &&
        (input.key === 'Escape' || (input.key.toLowerCase() === 'w' && input.meta));

      if (!shouldClose) {
        return;
      }

      event.preventDefault();
      childWindow.close();
    });
  });

  configureHardwareWalletPermissions(
    mainWindow,
    is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  );

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    console.error('[Main] Renderer failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('render-process-gone', () => {
    console.error('[Main] Renderer process crashed');
  });

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    if (!message.startsWith(hardwareWalletRendererLogPrefix)) {
      return;
    }

    const prefix = `[Renderer:${getRendererConsoleLevelName(level)}]`;
    const source = sourceId ? `${sourceId}:${line}` : `line ${line}`;
    const formattedMessage = `${prefix} ${message} (${source})`;

    if (level >= 3) {
      console.error(formattedMessage);
      return;
    }

    if (level === 2) {
      console.warn(formattedMessage);
      return;
    }

    console.info(formattedMessage);
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(htmlPath);
  }

  return mainWindow;
}

function getRendererConsoleLevelName(level: number): string {
  if (level >= 3) {
    return 'error';
  }

  if (level === 2) {
    return 'warn';
  }

  if (level === 1) {
    return 'info';
  }

  return 'verbose';
}

function compactLogUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export { createMainWindow };
