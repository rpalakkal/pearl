import {create} from 'zustand';
import {
  buildAccountList,
  enumerateHardwareAccounts,
  persistActiveAccountId,
  readPersistedActiveAccountId,
  resolveActiveAccount,
  type WalletAccount,
} from '../lib/accounts';
import {normalizePearlNetwork, type PearlNetwork} from '../lib/hardwareWallet';
import {useWalletStore} from './walletStore';
import {getErrorMessage} from '../lib/utils';

interface AccountsState {
  accounts: WalletAccount[];
  activeAccountId: string | null;
  network: PearlNetwork;
  switchState: 'idle' | 'starting-wallet';
  switchError: string | null;
  // Software wallet awaiting the one-time passphrase migration prompt.
  migrateWalletName: string | null;
  refreshAccounts: () => Promise<WalletAccount[]>;
  setActiveAccount: (id: string) => Promise<void>;
  activateInitialAccount: () => Promise<WalletAccount | null>;
  clearMigration: () => void;
  clearSwitchError: () => void;
}

export const useAccountsStore = create<AccountsState>()((set, get) => ({
  accounts: [],
  activeAccountId: null,
  network: 'mainnet',
  switchState: 'idle',
  switchError: null,
  migrateWalletName: null,

  async refreshAccounts() {
    let network: PearlNetwork = get().network;
    try {
      const info = await window.appBridge.manager.getNetworkInfo();
      network = normalizePearlNetwork(info.currentNetwork);
    } catch {
      // keep the previous network on lookup failure
    }

    let walletNames: string[] = [];
    try {
      walletNames = (await window.appBridge.manager.getExistingWallets()).walletNames;
    } catch (error) {
      console.error('Failed to enumerate software wallets:', error);
    }

    const accounts = buildAccountList(walletNames, enumerateHardwareAccounts(network));
    set({accounts, network});
    return accounts;
  },

  // Boot/unlock path: pick the persisted (or fallback) account and activate
  // it. Returns the activated account so callers can route accordingly.
  async activateInitialAccount() {
    const accounts = await get().refreshAccounts();
    const account = resolveActiveAccount(
      accounts,
      readPersistedActiveAccountId(get().network)
    );
    if (account) {
      await get().setActiveAccount(account.id);
    }
    return account;
  },

  async setActiveAccount(id: string) {
    const {accounts, network, activeAccountId, switchState} = get();
    if (switchState !== 'idle') {
      return;
    }
    const account = accounts.find(a => a.id === id);
    if (!account) {
      return;
    }

    set({switchError: null});

    if (account.kind === 'hardware') {
      // Instant: no process change. Any running software wallet keeps serving
      // local reads for the hardware address.
      persistActiveAccountId(network, id);
      set({activeAccountId: id});
      return;
    }

    // Software wallet: restart the wallet process (seconds).
    if (activeAccountId === id && window.appBridge.manager) {
      // Re-selecting the already-active software wallet is a no-op when its
      // process is the current one.
      try {
        const stats = await window.appBridge.manager.getWalletsStats();
        if (stats.name === account.name) {
          persistActiveAccountId(network, id);
          return;
        }
      } catch {
        // fall through to a full select
      }
    }

    set({switchState: 'starting-wallet'});
    useWalletStore.getState().clearWalletData();

    try {
      const {passphraseAvailable} = await window.appBridge.manager.selectWallet(account.name);
      persistActiveAccountId(network, id);
      set({
        activeAccountId: id,
        migrateWalletName: passphraseAvailable ? null : account.name,
      });
    } catch (error) {
      console.error('Failed to switch wallet:', error);
      set({switchError: getErrorMessage(error, 'Failed to start the wallet')});
    } finally {
      set({switchState: 'idle'});
    }
  },

  clearMigration() {
    set({migrateWalletName: null});
  },

  clearSwitchError() {
    set({switchError: null});
  },
}));

// The active account object (or null before enumeration / with no accounts).
export function useActiveAccount(): WalletAccount | null {
  return useAccountsStore(
    state => state.accounts.find(account => account.id === state.activeAccountId) ?? null
  );
}
