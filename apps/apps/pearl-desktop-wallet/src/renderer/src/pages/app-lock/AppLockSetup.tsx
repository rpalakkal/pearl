import {useEffect, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {AlertCircle, CheckCircle2, Loader2, ShieldCheck, XCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {getErrorMessage} from '@/lib/utils';
import PasswordStrength from '../create-wallet/PasswordStrength';

/**
 * First-run (or migration) screen that creates the app-wide password. One
 * password gates the whole app; software wallet passphrases live in the
 * encrypted vault behind it.
 */
export default function AppLockSetup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/unlock';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Already set up? Nothing to do here.
    window.appBridge.appLock.getStatus().then(status => {
      if (status === 'locked') {
        navigate('/unlock', {replace: true});
      } else if (status === 'unlocked') {
        navigate(next, {replace: true});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passwordsMatch = confirm.length > 0 && password === confirm;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await window.appBridge.appLock.setup(password);
      navigate(next, {replace: true});
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to set the app password'));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-transparent px-4 py-8 sm:px-8 sm:py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
            <ShieldCheck className="h-8 w-8 text-gray-600" />
          </div>
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Create App Password</h1>
          <p className="text-gray-600">
            One password protects the whole app — your wallets, contacts, and settings. You will
            enter it every time you open Pearl Wallet.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">App Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              disabled={isSubmitting}
              className="focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2"
            />
            <PasswordStrength password={password} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat the password"
              disabled={isSubmitting}
              className="focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2"
            />
            {confirm && (
              <div
                className={`flex items-center gap-1 text-xs ${passwordsMatch ? 'text-green-500' : 'text-red-400'}`}
              >
                {passwordsMatch ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                <span>{passwordsMatch ? 'Passwords match' : 'Passwords do not match'}</span>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
              <span className="text-red-700">{error}</span>
            </div>
          )}

          <Button
            type="submit"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold"
            disabled={isSubmitting || !password || !confirm}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Setting up
              </>
            ) : (
              'Set App Password'
            )}
          </Button>
        </form>

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="mb-1 font-medium text-amber-800">Important</p>
          <p className="text-amber-700">
            This password cannot be recovered. If you forget it, you will need your wallets'
            recovery phrases to restore access to your funds.
          </p>
        </div>
      </div>
    </div>
  );
}
