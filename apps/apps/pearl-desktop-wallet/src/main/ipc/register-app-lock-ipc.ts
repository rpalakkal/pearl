import {ipcMain} from 'electron';
import {ManagerService} from '../services/manager-service';
import * as appLock from '../config/app-lock';

function registerAppLockIpc(ms: ManagerService) {
  ipcMain.handle('app-lock-status', _event => appLock.getStatus());
  ipcMain.handle('app-lock-setup', (_event, password: string) => appLock.setup(password));
  ipcMain.handle('app-lock-unlock', (_event, password: string) => appLock.unlock(password));
  ipcMain.handle('app-lock-lock', async (_event, options?: {force?: boolean}) => {
    // Stop the wallet process first so no RPC surface stays unlocked, then
    // drop the vault key from memory.
    if (options?.force) {
      await ms.forceLockWallet();
    } else {
      await ms.lockWallet();
    }
    appLock.lock();
  });
  ipcMain.handle('app-lock-change-password', (_event, current: string, next: string) =>
    appLock.changePassword(current, next)
  );
  ipcMain.handle('app-lock-has-wallet-passphrase', (_event, walletName: string) =>
    appLock.hasWalletPassphrase(walletName)
  );
  ipcMain.handle('app-lock-has-wallet-mnemonic', (_event, walletName: string) =>
    appLock.hasWalletMnemonic(walletName)
  );
  ipcMain.handle(
    'app-lock-reveal-wallet-mnemonic',
    (_event, walletName: string, password: string) =>
      appLock.revealWalletMnemonic(walletName, password)
  );
  // Forgot-password reset: usable while locked by design — physical access to
  // this machine already equals control of the local data being deleted.
  ipcMain.handle('app-lock-reset', () => ms.resetApp());
  ipcMain.handle(
    'app-lock-store-wallet-passphrase',
    async (_event, walletName: string, passphrase: string) => {
      // Migration path: the user just typed the wallet's legacy passphrase.
      // Verify it against the running wallet before persisting it.
      if (ms.getWalletsStats().name !== walletName) {
        throw new Error('Wallet is not the active wallet');
      }
      const walletService = ms.getWalletServiceIfRunning();
      if (!walletService) {
        throw new Error('Wallet is not running');
      }
      await walletService.unlockWallet(passphrase, ManagerService.WALLET_UNLOCK_TIMEOUT_SECONDS);
      appLock.storeWalletPassphrase(walletName, passphrase);
    }
  );
}

export {registerAppLockIpc};
