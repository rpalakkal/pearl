import {ipcMain} from 'electron';
import {ManagerService} from '../services/manager-service';
import {BlockbookClient} from '../clients/blockbook-client';
import {HardwareWalletService} from '../services/hardware-wallet-service/hardware-wallet-service.ts';
import {getCurrentNetwork} from '../config/network-config';
import {recordSend} from '../config/send-history';
import {pearlAmountToSatsString} from '../config/send-history-model';
import type {
  HardwareWalletAccountRequest,
  HardwareWalletBroadcastRequest,
  HardwareWalletTransactionsRequest,
} from '../../types/app-bridge.ts';

function registerWalletIpc(ms: ManagerService) {
  ipcMain.handle('wallet-unlock', (_event, passphrase: string, timeout: number = 60) =>
    ms.ensureWalletService().unlockWallet(passphrase, timeout)
  );
  ipcMain.handle('wallet-lock', _event => ms.lockWallet());
  ipcMain.handle('wallet-force-lock', _event => ms.forceLockWallet());
  ipcMain.handle('wallet-change-password', (_event, currentPassword: string, newPassword: string) =>
    ms.ensureWalletService().changeWalletPassphrase(currentPassword, newPassword)
  );
  ipcMain.handle(
    'wallet-send-from-default-account',
    async (_event, toAddress: string, amount: number, feeRate: number) => {
      // Re-arms the wallet passphrase from the vault if the RPC unlock
      // window expired since the wallet was selected.
      const txid = await ms.withWalletAutoUnlock(() =>
        ms.ensureWalletService().sendFromDefaultAccount(toAddress, amount, feeRate)
      );

      // Record for the large-send gate; the transaction already broadcast, so
      // a bookkeeping failure must never fail the send.
      try {
        recordSend({
          recipientAddress: toAddress,
          txid,
          amountSats: pearlAmountToSatsString(amount),
          network: getCurrentNetwork(),
          source: 'software',
        });
      } catch (error) {
        console.error('Failed to record send history:', error);
      }

      return txid;
    }
  );
  ipcMain.handle('wallet-list-all-transactions', _event =>
    ms.ensureWalletService().listAllTransactions()
  );
  ipcMain.handle('wallet-list-transactions', (_event, count: number = 10, from: number = 0) =>
    ms.ensureWalletService().listTransactions(count, from)
  );
  ipcMain.handle('wallet-get-balance', (_event, account: string, minconf: number = 1) =>
    ms.ensureWalletService().getBalance(account, minconf)
  );
  ipcMain.handle('wallet-validate-address', (_event, address: string) =>
    ms.ensureWalletService().validateAddress(address)
  );
  ipcMain.handle('wallet-get-new-address', _event => ms.ensureWalletService().getNewAddress());
  ipcMain.handle('wallet-get-addresses-by-account', (_event, account: string = 'default') =>
    ms.ensureWalletService().getAddressesByAccount(account)
  );
  ipcMain.handle(
    'wallet-rescan-address',
    (_event, address: string, startHeight: number = 0, publicKey?: string) =>
      ms.ensureWalletService().rescanAddress(address, startHeight, publicKey)
  );
  ipcMain.handle('wallet-rescan-status', (_event, address: string) =>
    ms.ensureWalletService().getRescanStatus(address)
  );
  ipcMain.handle(
    'wallet-estimate-fee',
    (_event, numBlocks: number, network?: 'mainnet' | 'testnet') =>
      BlockbookClient.estimateFee(numBlocks, network)
  );
  // Hardware wallet handlers always run against a local wallet: the running
  // user wallet when there is one, otherwise the hidden chain-host wallet.
  ipcMain.handle(
    'hardware-wallet-get-balance',
    async (_event, request: HardwareWalletAccountRequest) =>
      HardwareWalletService.getBalance(request, await ms.ensureChainHost())
  );
  // History is indexer-first and must not force a chain-host startup; the
  // local wallet (when one runs) is only its fallback.
  ipcMain.handle(
    'hardware-wallet-get-transactions',
    (_event, request: HardwareWalletTransactionsRequest) =>
      HardwareWalletService.getTransactions(request, ms.getWalletServiceIfRunning())
  );
  ipcMain.handle(
    'hardware-wallet-broadcast-transaction',
    async (_event, request: HardwareWalletBroadcastRequest) =>
      HardwareWalletService.broadcastTransaction(request, await ms.ensureChainHost())
  );
}

export {registerWalletIpc};
