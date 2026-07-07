import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, KeyRound, AlertTriangle, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useWalletStore } from '../store/walletStore';
import { getErrorMessage } from '../lib/utils';
import { parseSeedInput } from '../lib/seed-input';
import { useAppLockGuard } from '../hooks/useAppLockGuard';

// The wallet passphrase is generated and vaulted behind the app password, so
// importing a wallet only needs a name and the recovery phrase.
export default function ImportAccount() {
  useAppLockGuard();
  const [seed, setSeed] = useState('');
  const [walletName, setWalletName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState('');
  const [existingWallets, setExistingWallets] = useState<string[]>([]);
  const [isCheckingWalletName, setIsCheckingWalletName] = useState(false);
  const [walletNameError, setWalletNameError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { clearWalletData } = useWalletStore();

  useEffect(() => {
    const fetchExistingWallets = async () => {
      try {
        const result = await window.appBridge.manager.getExistingWallets();
        setExistingWallets(result.walletNames);
      } catch (error) {
        console.error('Failed to fetch existing wallets:', error);
      }
    };

    fetchExistingWallets();
  }, []);

  useEffect(() => {
    const validateWalletName = async () => {
      if (!walletName.trim()) {
        setWalletNameError(null);
        return;
      }

      setIsCheckingWalletName(true);
      setWalletNameError(null);

      const timeoutId = setTimeout(() => {
        if (existingWallets.map(wallet => wallet.toLowerCase()).includes(walletName.trim().toLowerCase())) {
          setWalletNameError(
            `A wallet named "${walletName.trim()}" already exists. Please choose a different name.`
          );
        } else {
          setWalletNameError(null);
        }
        setIsCheckingWalletName(false);
      }, 300);

      return () => clearTimeout(timeoutId);
    };

    validateWalletName();
  }, [walletName, existingWallets]);

  const handleImport = async () => {
    if (!walletName.trim()) {
      setError('Please enter a wallet name');
      return;
    }

    if (walletNameError) {
      setError(walletNameError);
      return;
    }

    if (isCheckingWalletName) {
      setError('Please wait while we check the wallet name...');
      return;
    }

    const parsed = await parseSeedInput(seed);
    if (parsed.kind === 'invalid') {
      setError(parsed.reason);
      return;
    }

    setError('');
    setIsImporting(true);
    clearWalletData();

    try {
      await window.appBridge.manager.import({
        name: walletName,
        seed: parsed.normalized || seed.trim(),
      });

      navigate('/wallet');
    } catch (error) {
      console.error('Import error:', error);
      setError(getErrorMessage(error, 'An unexpected error occurred'));
      setIsImporting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent text-gray-900">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-4 px-4 py-4 sm:px-8 sm:py-6">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Import Wallet</h1>
      </div>

      {/* Main Content with Scroll */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 sm:px-8 sm:pb-8">
        <div className="mx-auto flex w-full max-w-md flex-shrink-0 flex-col items-center py-4 sm:py-8">
          {/* Add top spacing for small screens */}
          <div className="h-4 flex-shrink-0 sm:h-8"></div>
          <div className="bg-brand-green mb-6 rounded-2xl p-4">
            <KeyRound className="h-10 w-10" />
          </div>

          <h2 className="mb-2 text-center text-xl font-bold text-gray-900 sm:text-2xl">
            Enter Your recovery phrase
          </h2>
          <p className="mb-6 text-center text-sm text-gray-600 sm:mb-8 sm:text-base">
            Enter your 12- or 24-word BIP39 mnemonic (15/18/21 also supported), or a hex seed,
            to restore your wallet
          </p>

          <div className="w-full space-y-4">
            <div>
              <Label htmlFor="walletName" className="text-gray-900">
                Wallet Name
              </Label>
              <div className="relative">
                <Input
                  id="walletName"
                  placeholder="My Pearl Wallet"
                  value={walletName}
                  onChange={e => setWalletName(e.target.value)}
                  className={`focus:border-brand-green focus:ring-brand-green/20 mt-2 border-gray-300 bg-white text-gray-900 placeholder-gray-400 shadow-sm focus:ring-2 ${walletNameError
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                    : ''
                    }`}
                />
                {isCheckingWalletName && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500/30 border-t-blue-500" />
                  </div>
                )}
              </div>

              {/* Wallet Name Error */}
              {walletNameError && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                  <span className="text-sm text-red-500">{walletNameError}</span>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="seed" className="text-gray-900">
                Recovery Phrase (12 or 24 words) or Hex Seed
              </Label>
              <textarea
                id="seed"
                placeholder="Enter your recovery phrase here..."
                value={seed}
                onChange={e => setSeed(e.target.value)}
                className="focus:border-brand-green focus:ring-brand-green/20 mt-2 h-32 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2"
                rows={4}
              />
            </div>

            {error && <div className="text-center text-sm text-red-400">{error}</div>}

            <Button
              onClick={handleImport}
              className="h-12 w-full"
              disabled={
                isImporting ||
                !seed.trim() ||
                !walletName.trim() ||
                !!walletNameError ||
                isCheckingWalletName
              }
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : isCheckingWalletName ? (
                'Checking wallet name...'
              ) : (
                'Import Wallet'
              )}
            </Button>
          </div>

          {/* Add bottom spacing */}
          <div className="h-4 flex-shrink-0 sm:h-8"></div>
        </div>
      </div>
    </div>
  );
}
