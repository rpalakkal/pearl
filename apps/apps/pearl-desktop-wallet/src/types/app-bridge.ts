import {
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';
import type {Transaction} from './transaction';
import type {
  BlockbookAddressInfo,
  BlockbookUtxo,
} from '../main/clients/blockbook-normalizers.ts';

type PromisifyInterface<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

type Ipc<T> = PromisifyInterface<T>;
type AppNetwork = 'mainnet' | 'testnet';

interface WindowApi {
  getVersion: () => string;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  isMaximized: () => boolean;
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  openExternal: (url: string) => void;
}

// Progress of an explicit address backfill rescan (rescanaddress RPC). Job
// state lives in the wallet process; discovered UTXOs persist in the wallet
// database.
interface AddressBackfillStatus {
  address: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  startHeight: number;
  currentHeight: number;
  targetHeight: number;
  error?: string;
}

interface WalletApi {
  getNewAddress: () => Promise<string>;

  unlockWallet: (passphrase: string, timeout?: number) => Promise<void>;

  lockWallet: () => Promise<void>;

  forceLockWallet: () => Promise<void>;

  changeWalletPassphrase: (currentPassword: string, newPassword: string) => Promise<void>;

  sendFromDefaultAccount: (toAddress: string, amount: number, feeRate: number) => Promise<string>;

  listAllTransactions: () => Promise<Transaction[]>;

  listTransactions: (count?: number, from?: number) => Promise<Transaction[]>;

  getBalance: (account?: string, minconf?: number) => Promise<number>;

  validateAddress: (address: string) => Promise<{isValid: boolean}>;

  getAddressesByAccount: (account?: string) => Promise<string[]>;

  estimateFee: (numBlocks: number, network?: AppNetwork) => Promise<number>;

  rescanAddress: (
    address: string,
    startHeight?: number,
    publicKey?: string
  ) => Promise<AddressBackfillStatus>;

  getRescanStatus: (address: string) => Promise<AddressBackfillStatus>;
}

interface Contact {
  id: string;
  name: string;
  address: string;
  notes?: string;
  publicKey?: string;
  // Set the first time a hardware send to this contact passed review and was
  // signed on a device; not user-editable.
  firstVerifiedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface ContactExtras {
  notes?: string;
  publicKey?: string;
}

interface ContactUpdates extends ContactExtras {
  name?: string;
  address?: string;
  firstVerifiedAt?: number;
}

interface ContactsApi {
  list: () => Promise<Contact[]>;

  add: (name: string, address: string, extras?: ContactExtras) => Promise<Contact>;

  update: (id: string, updates: ContactUpdates) => Promise<Contact>;

  remove: (id: string) => Promise<void>;
}

// Hardware reads are always served by a local wallet (the running user
// wallet or the hidden chain host). The field survives for wire-shape
// stability.
type HardwareBalanceSource = 'oyster';

interface HardwareWalletBalance {
  info: BlockbookAddressInfo;
  utxos: BlockbookUtxo[];
  source: HardwareBalanceSource;
  // The backing wallet is still syncing headers/blocks; balances and history
  // may be incomplete until it finishes.
  walletSyncing: boolean;
}

interface HardwareWalletAccountRequest {
  address: string;
  publicKey: string;
  network?: AppNetwork;
}

interface HardwareWalletBroadcastRequest {
  network?: AppNetwork;
  rawTransactionHex: string;
  sourceAddress: string;
  sourcePublicKey: string;
  // Send-history metadata: main cannot cheaply decode the raw transaction, so
  // the renderer supplies recipient and amount from its review snapshot.
  recipientAddress?: string;
  amountSats?: string;
}

interface HardwareWalletBroadcastResult {
  balance: HardwareWalletBalance | null;
  txid: string;
}

interface HardwareWalletTransactionsRequest extends HardwareWalletAccountRequest {
  page?: number;
  pageSize?: number;
}

interface HardwareWalletTransactionsResult {
  transactions: Transaction[];
  hasMore: boolean;
  // History is indexer-first (global view, no per-wallet store gaps) with
  // the local wallet as offline fallback.
  source: 'indexer' | 'oyster';
  walletSyncing: boolean;
}

interface HardwareWalletApi {
  getBalance: (request: HardwareWalletAccountRequest) => Promise<HardwareWalletBalance>;

  getTransactions: (
    request: HardwareWalletTransactionsRequest
  ) => Promise<HardwareWalletTransactionsResult>;

  broadcastTransaction: (
    request: HardwareWalletBroadcastRequest
  ) => Promise<HardwareWalletBroadcastResult>;
}

// Whether (and how) the user has previously sent to a recipient address.
// Backs the large-send test-transaction gate.
interface RecipientSendStatus {
  hasAnySend: boolean;
  hasConfirmedSend: boolean;
  hasPendingSend: boolean;
  lastSendAt: number | null;
}

interface SendHistoryApi {
  getRecipientStatus: (address: string, network: AppNetwork) => Promise<RecipientSendStatus>;
}

// App-wide lock: one password gates the app; software wallet passphrases are
// stored in an encrypted vault held by the main process.
type AppLockStatus = 'uninitialized' | 'locked' | 'unlocked';

interface AppLockApi {
  getStatus: () => Promise<AppLockStatus>;

  setup: (password: string) => Promise<void>;

  unlock: (password: string) => Promise<void>;

  lock: (options?: {force?: boolean}) => Promise<void>;

  changePassword: (current: string, next: string) => Promise<void>;

  hasWalletPassphrase: (walletName: string) => Promise<boolean>;

  // Migration: stores a legacy wallet passphrase the user just typed, after
  // main verifies it against the running wallet.
  storeWalletPassphrase: (walletName: string, passphrase: string) => Promise<void>;
}

interface ManagerApi {
  getWalletsStats: () => {name?: string};

  // Starts the wallet process and auto-unlocks it from the app-lock vault;
  // passphraseAvailable=false means the one-time migration prompt is needed.
  selectWallet: (walletName: string) => Promise<{passphraseAvailable: boolean}>;

  create: (options: {name: string; password?: string}) => Promise<{seed: string}>;

  import: (options: {
    name: string;
    seed: string;
    password?: string;
  }) => Promise<{name: string; seed: string}>;

  getExistingWallets: () => Promise<{
    walletNames: string[];
    defaultWallet: string | undefined;
  }>;

  // Network management
  getNetworkInfo: () => Promise<{
    currentNetwork: string;
    availableNetworks: string[];
    networkConfig: {
      name: string;
      displayName: string;
      addressPrefix: string;
    };
  }>;

  setNetwork: (network: string) => Promise<{success: boolean; network: string}>;

  getPeerSettings: () => Promise<{
    network: string;
    currentAddress: string;
    currentPort: number;
    defaultAddress: string;
    defaultPort: number;
    isCustom: boolean;
  }>;

  validatePeerAddress: (address: string, port: number) => Promise<{valid: boolean; error?: string}>;

  setCustomPeerAddress: (address: string, port: number) => Promise<{success: boolean}>;

  resetPeerToDefault: () => Promise<{success: boolean}>;
}

type UpdateSeverity = 'none' | 'patch' | 'minor' | 'major';

interface UpdateStatus {
  severity: UpdateSeverity;
  localVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAt: number | null;
  error: string | null;
}

interface UpdateApi {
  getStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  openReleasePage: () => Promise<void>;
  onStatusChanged: (listener: (status: UpdateStatus) => void) => () => void;
}

type SyncPhase = 'idle' | 'headers' | 'filters' | 'blocks' | 'synced';

interface SyncProgress {
  headerHeight: number;
  filterHeaderHeight: number;
  blockHeight: number;
  bestPeerHeight: number;
  synced: boolean;
}

interface SyncApi {
  getSyncProgress: () => Promise<SyncProgress>;

  isSyncing: () => Promise<{
    syncing: boolean;
    walletHeight?: number;
    networkHeight?: number;
    error?: string;
  }>;

  waitForSync: () => Promise<
    | {
        success: true;
        synced: boolean;
        error?: undefined;
      }
    | {
        success: true;
        synced: boolean;
        error: string;
      }
  >;
}

interface AppBridge {
  window: Ipc<WindowApi>;
  wallet: Ipc<WalletApi>;
  hardwareWallet: Ipc<HardwareWalletApi>;
  contacts: Ipc<ContactsApi>;
  sendHistory: Ipc<SendHistoryApi>;
  appLock: Ipc<AppLockApi>;
  manager: Ipc<ManagerApi>;
  sync: Ipc<SyncApi>;
  update: UpdateApi;
}

export type {
  AppBridge,
  WindowApi,
  WalletApi,
  AddressBackfillStatus,
  HardwareWalletApi,
  HardwareBalanceSource,
  HardwareWalletBalance,
  HardwareWalletAccountRequest,
  HardwareWalletBroadcastRequest,
  HardwareWalletBroadcastResult,
  HardwareWalletTransactionsRequest,
  HardwareWalletTransactionsResult,
  Contact,
  ContactExtras,
  ContactUpdates,
  ContactsApi,
  RecipientSendStatus,
  SendHistoryApi,
  AppLockApi,
  AppLockStatus,
  ManagerApi,
  SyncApi,
  SyncProgress,
  SyncPhase,
  UpdateApi,
  UpdateStatus,
  UpdateSeverity,
  BlockbookAddressInfo,
  BlockbookUtxo,
  AppNetwork,
  Ipc,
};
