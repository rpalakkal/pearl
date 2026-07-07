import {contextBridge, ipcRenderer} from 'electron';
import {
  AppBridge,
  AppLockApi,
  ContactsApi,
  SendHistoryApi,
  HardwareWalletApi,
  Ipc,
  WindowApi,
  WalletApi,
  ManagerApi,
  SyncApi,
  UpdateApi,
  UpdateStatus,
} from '../types/app-bridge';

const windowIpc: Ipc<WindowApi> = {
  getVersion: () => ipcRenderer.invoke('app-version'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  showMessageBox: options => ipcRenderer.invoke('show-message-box', options),
  showOpenDialog: options => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: options => ipcRenderer.invoke('show-save-dialog', options),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  relaunch: () => ipcRenderer.invoke('app-relaunch'),
};

const walletIpc: Ipc<WalletApi> = {
  getNewAddress: () => ipcRenderer.invoke('wallet-get-new-address'),
  unlockWallet: (passphrase, timeout) => ipcRenderer.invoke('wallet-unlock', passphrase, timeout),
  lockWallet: () => ipcRenderer.invoke('wallet-lock'),
  forceLockWallet: () => ipcRenderer.invoke('wallet-force-lock'),
  changeWalletPassphrase: (currentPassword, newPassword) =>
    ipcRenderer.invoke('wallet-change-password', currentPassword, newPassword),
  sendFromDefaultAccount: (toAddress: string, amount: number, feeRate: number) =>
    ipcRenderer.invoke('wallet-send-from-default-account', toAddress, amount, feeRate),
  listAllTransactions: () => ipcRenderer.invoke('wallet-list-all-transactions'),
  listTransactions: (count, from) => ipcRenderer.invoke('wallet-list-transactions', count, from),
  getBalance: (account, minconf) => ipcRenderer.invoke('wallet-get-balance', account, minconf),
  listUnspent: (minconf, maxconf) => ipcRenderer.invoke('wallet-list-unspent', minconf, maxconf),
  getReceivedByAddress: address => ipcRenderer.invoke('wallet-get-received-by-address', address),
  validateAddress: address => ipcRenderer.invoke('wallet-validate-address', address),
  getAddressesByAccount: account => ipcRenderer.invoke('wallet-get-addresses-by-account', account),
  estimateFee: (numBlocks, network) =>
    ipcRenderer.invoke('wallet-estimate-fee', numBlocks, network),
  rescanAddress: (address, startHeight, publicKey) =>
    ipcRenderer.invoke('wallet-rescan-address', address, startHeight, publicKey),
  getRescanStatus: address => ipcRenderer.invoke('wallet-rescan-status', address),
};

const hardwareWalletIpc: Ipc<HardwareWalletApi> = {
  getBalance: request =>
    ipcRenderer.invoke('hardware-wallet-get-balance', request),
  getTransactions: request =>
    ipcRenderer.invoke('hardware-wallet-get-transactions', request),
  broadcastTransaction: request =>
    ipcRenderer.invoke('hardware-wallet-broadcast-transaction', request),
};

const contactsIpc: Ipc<ContactsApi> = {
  list: () => ipcRenderer.invoke('contacts-list'),
  add: (name, address, extras) => ipcRenderer.invoke('contacts-add', name, address, extras),
  update: (id, updates) => ipcRenderer.invoke('contacts-update', id, updates),
  remove: id => ipcRenderer.invoke('contacts-remove', id),
};

const sendHistoryIpc: Ipc<SendHistoryApi> = {
  getRecipientStatus: (address, network) =>
    ipcRenderer.invoke('send-history-recipient-status', address, network),
};

const appLockIpc: Ipc<AppLockApi> = {
  getStatus: () => ipcRenderer.invoke('app-lock-status'),
  setup: password => ipcRenderer.invoke('app-lock-setup', password),
  unlock: password => ipcRenderer.invoke('app-lock-unlock', password),
  lock: options => ipcRenderer.invoke('app-lock-lock', options),
  changePassword: (current, next) => ipcRenderer.invoke('app-lock-change-password', current, next),
  hasWalletPassphrase: walletName =>
    ipcRenderer.invoke('app-lock-has-wallet-passphrase', walletName),
  storeWalletPassphrase: (walletName, passphrase) =>
    ipcRenderer.invoke('app-lock-store-wallet-passphrase', walletName, passphrase),
  hasWalletMnemonic: walletName =>
    ipcRenderer.invoke('app-lock-has-wallet-mnemonic', walletName),
  revealWalletMnemonic: (walletName, password) =>
    ipcRenderer.invoke('app-lock-reveal-wallet-mnemonic', walletName, password),
  reset: () => ipcRenderer.invoke('app-lock-reset'),
};

const managerIpc: Ipc<ManagerApi> = {
  getWalletsStats: () => ipcRenderer.invoke('get-wallets-stats'),
  selectWallet: walletName => ipcRenderer.invoke('select-wallet', walletName),
  create: options => ipcRenderer.invoke('wallet-create', options),
  import: options => ipcRenderer.invoke('wallet-import', options),
  renameWallet: (oldName, newName) => ipcRenderer.invoke('wallet-rename', oldName, newName),
  deleteWallet: (name, password) => ipcRenderer.invoke('wallet-delete', name, password),
  getExistingWallets: () => ipcRenderer.invoke('get-existing-wallets'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  setNetwork: network => ipcRenderer.invoke('set-network', network),
  getPeerSettings: () => ipcRenderer.invoke('get-peer-settings'),
  validatePeerAddress: (address, port) => ipcRenderer.invoke('validate-peer', address, port),
  setCustomPeerAddress: (address, port) => ipcRenderer.invoke('set-custom-peer', address, port),
  resetPeerToDefault: () => ipcRenderer.invoke('reset-peer-to-default'),
};

const syncIpc: Ipc<SyncApi> = {
  getSyncProgress: () => ipcRenderer.invoke('sync-get-progress'),
  isSyncing: () => ipcRenderer.invoke('sync-is-syncing'),
  waitForSync: () => ipcRenderer.invoke('sync-wait-for-sync'),
};

const updateIpc: UpdateApi = {
  getStatus: () => ipcRenderer.invoke('update-get-status'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  openReleasePage: () => ipcRenderer.invoke('update-open-release-page'),
  onStatusChanged: listener => {
    const handler = (_event: unknown, status: UpdateStatus) => listener(status);
    ipcRenderer.on('update-status-changed', handler);
    return () => {
      ipcRenderer.removeListener('update-status-changed', handler);
    };
  },
};

const appBridge: AppBridge = {
  window: windowIpc,
  wallet: walletIpc,
  hardwareWallet: hardwareWalletIpc,
  contacts: contactsIpc,
  sendHistory: sendHistoryIpc,
  appLock: appLockIpc,
  manager: managerIpc,
  sync: syncIpc,
  update: updateIpc,
};

contextBridge.exposeInMainWorld('appBridge', appBridge);
