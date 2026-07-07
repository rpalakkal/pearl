import {useEffect} from 'react';
import {Outlet, useNavigate} from 'react-router-dom';
import {AlertCircle, Lock, X} from 'lucide-react';
import {AccountSwitcher} from './AccountSwitcher';
import {SyncStatusChip} from './SyncStatusChip';
import {NetworkSelector} from '../NetworkSelector';
import {SettingsButton} from '../SettingsButton';
import {MigratePassphraseDialog} from '../app-lock/MigratePassphraseDialog';
import {useAccountsStore, useActiveAccount} from '../../store/accountsStore';
import {useWalletStore} from '../../store/walletStore';
import {useAppLockGuard} from '../../hooks/useAppLockGuard';
import {accountDisplayName} from '../../lib/accounts';

/**
 * Persistent chrome for everything behind the app lock: account switcher,
 * network selector, settings, and the app-wide Lock button.
 */
export default function AppShell() {
  useAppLockGuard();
  const navigate = useNavigate();
  const {refreshAccounts, migrateWalletName, clearMigration, switchError, clearSwitchError} =
    useAccountsStore();
  const network = useAccountsStore(state => state.network);
  const active = useActiveAccount();
  const {syncPhase, clearWalletData} = useWalletStore();
  const isTestnet = network === 'testnet';

  useEffect(() => {
    void refreshAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const name = active ? accountDisplayName(active) : null;
    const net = isTestnet ? 'Testnet' : 'Mainnet';
    document.title = name ? `${name} — ${net} — Pearl Wallet` : 'Pearl Wallet';
    return () => {
      document.title = 'Pearl Wallet';
    };
  }, [active, isTestnet]);

  async function handleLock() {
    clearWalletData();
    try {
      // Force (SIGKILL) during block recovery: the polite walletlock RPC can
      // hang for up to a minute there; bbolt replays the batch on next open.
      await window.appBridge.appLock.lock({force: syncPhase === 'blocks'});
    } catch (error) {
      console.error('Failed to lock the app:', error);
    } finally {
      navigate('/unlock');
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header
        className={`flex flex-shrink-0 items-center justify-between border-b px-4 py-2 shadow-sm backdrop-blur-sm sm:px-6 ${
          isTestnet ? 'border-amber-200 bg-amber-50/80' : 'border-gray-200 bg-white/80'
        }`}
      >
        <div className="flex items-center gap-3">
          <AccountSwitcher />
          {isTestnet && (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              TESTNET
            </span>
          )}
          <SyncStatusChip />
        </div>
        <div className="flex items-center gap-3">
          <NetworkSelector />
          <SettingsButton />
          <button
            type="button"
            onClick={() => void handleLock()}
            title="Lock the app"
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50"
          >
            <Lock className="h-4 w-4" />
            Lock
          </button>
        </div>
      </header>

      {switchError && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{switchError}</span>
          <button type="button" onClick={clearSwitchError} className="p-1 hover:text-red-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      {migrateWalletName && (
        <MigratePassphraseDialog
          walletName={migrateWalletName}
          onDone={() => clearMigration()}
        />
      )}
    </div>
  );
}
