import {useEffect, useState} from 'react';
import {AlertCircle, Eye, EyeOff, Lock} from 'lucide-react';
import {useLocation, useNavigate} from 'react-router-dom';
import {getErrorMessage} from '../../lib/utils';
import {NetworkSelector} from '../../components/NetworkSelector';
import {SettingsButton} from '../../components/SettingsButton';
import {UpgradeCta} from '../../components/UpgradeCta';
import {useAccountsStore} from '../../store/accountsStore';
import {Button} from '@pearl/ui';

type Phase = 'checking' | 'idle' | 'unlocking' | 'starting-wallet';

/**
 * App-wide lock screen: one password unlocks the vault, then the persisted
 * active account is activated (a software wallet starts and auto-unlocks
 * from the vault; hardware accounts activate instantly).
 */
export default function AppLockScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as {returnTo?: string} | null)?.returnTo ?? null;
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const status = await window.appBridge.appLock.getStatus();
      if (cancelled) {
        return;
      }
      if (status === 'uninitialized') {
        navigate('/', {replace: true});
        return;
      }

      if (status === 'unlocked') {
        // Vault key survives renderer reloads in main memory; go straight to
        // account activation without re-prompting.
        void activateAndEnter();
        return;
      }

      setPhase('idle');
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activateAndEnter() {
    setPhase('starting-wallet');
    setError(null);

    const accountsStore = useAccountsStore.getState();
    const account = await accountsStore.activateInitialAccount();

    const switchError = useAccountsStore.getState().switchError;
    if (switchError) {
      setError(switchError);
      accountsStore.clearSwitchError();
      setPhase('idle');
      return;
    }

    if (!account) {
      // Vault exists but no accounts yet: offer onboarding.
      navigate('/?skipCheck=true');
      return;
    }

    // Migration prompts render inside the app shell after navigation.
    navigate(returnTo ?? '/wallet');
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError('Enter your app password');
      return;
    }

    setPhase('unlocking');
    setError(null);
    try {
      await window.appBridge.appLock.unlock(password);
    } catch (err) {
      setError(getErrorMessage(err, 'Incorrect password'));
      setPhase('idle');
      return;
    }

    await activateAndEnter();
  }

  const isBusy = phase === 'unlocking' || phase === 'starting-wallet';

  if (phase === 'checking') {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="border-brand-green h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-transparent">
      <div className="absolute right-8 top-8 z-10 flex items-center gap-3">
        <NetworkSelector />
        <SettingsButton />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
        <div className="min-h-fit w-full max-w-md flex-shrink-0 space-y-6 sm:space-y-8">
          <div className="h-4 flex-shrink-0 sm:h-8"></div>
          <div className="text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gray-200 sm:mb-6">
              <Lock className="h-8 w-8 text-gray-600" />
            </div>

            <h1 className="mb-2 text-3xl font-bold text-gray-900">Pearl Wallet</h1>
            <p className="text-gray-600">Enter your app password to unlock</p>

            <div className="mt-4 flex justify-center">
              <UpgradeCta />
            </div>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4 sm:space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">App Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your app password"
                  className="focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 pr-12 text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2"
                  disabled={isBusy}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 transition-colors hover:text-gray-700"
                  disabled={isBusy}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
                <span className="text-red-700">{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="default"
              disabled={isBusy || !password}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold disabled:bg-gray-300 disabled:text-gray-500"
            >
              {isBusy ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {phase === 'starting-wallet' ? 'Starting Wallet...' : 'Unlocking...'}
                </>
              ) : (
                <>
                  <Lock className="h-5 w-5" />
                  Unlock
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            Adding or restoring wallets is available after unlocking. If you forgot your app
            password, you will need your recovery phrases to restore your wallets.
          </p>

          <div className="h-4 flex-shrink-0 sm:h-8"></div>
        </div>
      </div>
    </div>
  );
}
