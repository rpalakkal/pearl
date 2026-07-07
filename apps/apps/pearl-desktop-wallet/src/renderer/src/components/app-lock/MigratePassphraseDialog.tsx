import {useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle, KeyRound, Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {getErrorMessage} from '@/lib/utils';

/**
 * One-time migration prompt for wallets created before the app-lock vault:
 * asks for the wallet's legacy passphrase, which main verifies against the
 * running wallet and stores in the vault so it is never asked again.
 */
export function MigratePassphraseDialog({
  walletName,
  onDone,
}: {
  walletName: string;
  onDone: (saved: boolean) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!passphrase) {
      setError('Enter the wallet passphrase');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await window.appBridge.appLock.storeWalletPassphrase(walletName, passphrase);
      onDone(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to verify the passphrase'));
    } finally {
      setIsSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-300 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-full bg-amber-100 p-2">
            <KeyRound className="h-5 w-5 text-amber-700" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">One-time passphrase migration</h2>
        </div>

        <p className="mb-4 text-sm text-gray-600">
          The wallet <span className="font-semibold">{walletName}</span> was created before the
          app password existed. Enter its passphrase once so the app can unlock it for you from
          now on.
        </p>

        <form
          onSubmit={e => {
            e.preventDefault();
            void handleSave();
          }}
          className="space-y-4"
        >
          <input
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            placeholder={`Passphrase for ${walletName}`}
            autoFocus
            disabled={isSaving}
            className="focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2"
          />

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={isSaving}
              onClick={() => onDone(false)}
            >
              Skip for now
            </Button>
            <Button type="submit" className="flex-1" disabled={isSaving || !passphrase}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying
                </>
              ) : (
                'Save passphrase'
              )}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-gray-500">
          Skipping keeps the wallet locked for sending until the passphrase is provided.
        </p>
      </div>
    </div>,
    document.body
  );
}
