import { useState, useEffect } from 'react';
import { ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWalletStore } from '../store/walletStore';
import { useAccountsStore } from '../store/accountsStore';
import { QrcodeCanvas } from 'react-qrcode-pretty';
import { CopyButton } from '@/components/ui/copy-button';
import { Bech32Address } from '@/components/ui/bech32-address';
import { getStableReceiveAddress, generateNewReceiveAddress } from '../lib/receiveAddress';

export default function ReceiveTransaction() {
  const navigate = useNavigate();
  const { walletName } = useWalletStore();
  const network = useAccountsStore(state => state.network);
  const [receiveAddress, setReceiveAddress] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchReceiveAddress = async (rotate = false) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const address = rotate
        ? await generateNewReceiveAddress(network, walletName)
        : await getStableReceiveAddress(network, walletName);
      setReceiveAddress(address);
    } catch (err) {
      console.error('Exception while fetching receive address:', err);
      const message = err instanceof Error ? err.message : 'Unable to generate address';
      setReceiveAddress('');
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReceiveAddress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
        <button
          onClick={() => navigate('/wallet')}
          className="rounded-lg p-2 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft className="h-5 w-5 text-gray-700" />
        </button>
        <h1 className="text-xl font-semibold text-gray-900">Receive Pearl</h1>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto px-8 py-12">
        <div className="mx-auto flex max-w-md flex-col items-center">
          {/* Wallet Info */}
          <div className="mb-8 text-center">
            <h2 className="mb-2 text-2xl font-bold text-gray-900">Receive to {walletName}</h2>
            <p className="text-gray-600">Share this address or QR code to receive Pearl tokens</p>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-gray-600">
              <div className="border-brand-green mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
              <p>Generating receive address...</p>
            </div>
          ) : errorMessage || !receiveAddress ? (
            <div className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-600" />
              <p className="mb-1 text-base font-semibold text-red-900">
                Unable to generate an address
              </p>
              <p className="mb-4 text-sm text-red-800">
                {errorMessage ?? 'The wallet did not return an address.'}
              </p>
              <p className="mb-4 text-xs text-red-700">
                This often happens while the wallet is scanning blocks for your transactions.
                Please try again once that step finishes.
              </p>
              <button
                type="button"
                onClick={() => void fetchReceiveAddress()}
                className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <QrcodeCanvas
                value={receiveAddress}
                size={200}
                padding={10}
                margin={10}
                bgColor="#ffffff"
                bgRounded
                level="M"
                variant="fluid"
                divider
              />

              {/* Address Display */}
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm text-gray-600">Your Receive Address</div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Bech32Address address={receiveAddress} className="text-sm text-gray-900" />
                  </div>
                  <CopyButton value={receiveAddress} className="rounded-lg p-2" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <span className="text-xs text-gray-500">
                    This address stays the same until it receives funds.
                  </span>
                  <button
                    type="button"
                    onClick={() => void fetchReceiveAddress(true)}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                    title="Generate a fresh address (improves privacy)"
                  >
                    <RefreshCw className="h-3 w-3" />
                    New address
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="border-brand-summer-sky/30 bg-brand-summer-sky/10 mt-4 rounded-lg border p-4">
                <div className="text-sm">
                  <p className="mb-2 font-medium text-gray-900">How to receive Pearl Tokens:</p>
                  <ul className="space-y-1 text-gray-700">
                    <li>• Share this address with the sender</li>
                    <li>• Or let them scan the QR code</li>
                    <li>• Transactions will appear in your Activity</li>
                    <li>• Wait for confirmations before considering funds received</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
