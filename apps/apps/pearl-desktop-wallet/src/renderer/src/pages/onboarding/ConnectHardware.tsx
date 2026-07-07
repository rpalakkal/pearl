import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, HardDrive, Loader2, Usb} from 'lucide-react';
import {Link, useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {
  connectHardwareWallet,
  getHardwareWalletErrorMessage,
  getPearlHardwareWalletPath,
  normalizePearlNetwork,
  preloadHardwareWalletSupport,
  type HardwareWalletVendor,
  type PearlNetwork,
} from '../../lib/hardwareWallet';
import {
  getNextHardwareWalletAddressIndex,
  listStoredHardwareAccounts,
  saveStoredHardwareAccount,
} from '../../lib/hardwareWalletStorage';
import {hardwareAccountLogContext, logHardwareWalletEvent, getErrorLogMessage} from '../hardware-wallet/pageModel';
import {useAccountsStore} from '../../store/accountsStore';
import {hardwareAccountId} from '../../lib/accounts';
import {useAppLockGuard} from '../../hooks/useAppLockGuard';

const vendors: Array<{vendor: HardwareWalletVendor; label: string; icon: typeof Usb}> = [
  {vendor: 'ledger', label: 'Ledger', icon: Usb},
  {vendor: 'trezor', label: 'Trezor', icon: HardDrive},
];

/**
 * Onboarding flow for hardware accounts: pick vendor + address index, run the
 * device discovery ceremony once, remember the account, and activate it. The
 * device is only needed again at signing/verification time.
 */
export default function ConnectHardware() {
  useAppLockGuard();
  const navigate = useNavigate();
  const {refreshAccounts, setActiveAccount} = useAccountsStore();

  const [network, setNetwork] = useState<PearlNetwork>('mainnet');
  const [vendor, setVendor] = useState<HardwareWalletVendor>('ledger');
  const [addressIndex, setAddressIndex] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    preloadHardwareWalletSupport();
    window.appBridge.manager
      .getNetworkInfo()
      .then(info => setNetwork(normalizePearlNetwork(info.currentNetwork)))
      .catch(() => setNetwork('mainnet'));
  }, []);

  const rememberedIndexes = useMemo(
    () => new Set(listStoredHardwareAccounts(network, vendor).map(a => a.addressIndex)),
    [network, vendor, isConnecting]
  );

  useEffect(() => {
    const next = getNextHardwareWalletAddressIndex(listStoredHardwareAccounts(network, vendor));
    setAddressIndex(next ?? 0);
  }, [network, vendor]);

  const derivationPath = getPearlHardwareWalletPath(network, vendor, addressIndex);

  async function connect() {
    setIsConnecting(true);
    setError(null);
    logHardwareWalletEvent('connect:start', {vendor, network, addressIndex, path: derivationPath});

    try {
      const account = await connectHardwareWallet(vendor, network, addressIndex);
      saveStoredHardwareAccount(account);
      logHardwareWalletEvent('connect:success', hardwareAccountLogContext(account));

      await refreshAccounts();
      await setActiveAccount(hardwareAccountId(account));
      navigate('/wallet');
    } catch (err) {
      console.error('Failed to connect hardware wallet:', err);
      logHardwareWalletEvent(
        'connect:error',
        {vendor, network, error: getErrorLogMessage(err)},
        'error'
      );
      setError(getHardwareWalletErrorMessage(err, vendor));
      setIsConnecting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent text-gray-900">
      <div className="flex flex-shrink-0 items-center gap-4 px-4 py-4 sm:px-8 sm:py-6">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          <Link to="/wallet">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Connect Hardware Wallet</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-8 sm:px-8">
        <div className="mx-auto w-full max-w-md space-y-6 py-4 sm:py-8">
          <div className="text-center">
            <div className="bg-brand-green mb-4 inline-flex rounded-2xl p-4">
              <Usb className="h-10 w-10 text-white" />
            </div>
            <p className="text-sm text-gray-600">
              Plug in and unlock your device, open its Bitcoin app, then connect. The device is
              only needed again when you sign or verify.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">Device</div>
            <div className="grid grid-cols-2 gap-3">
              {vendors.map(option => {
                const Icon = option.icon;
                const selected = vendor === option.vendor;
                return (
                  <button
                    key={option.vendor}
                    type="button"
                    onClick={() => setVendor(option.vendor)}
                    disabled={isConnecting}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                      selected
                        ? 'border-brand-green bg-brand-light-green/20 text-gray-900'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className={selected ? 'text-brand-green h-4 w-4' : 'h-4 w-4'} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">Address Index</div>
            <input
              type="number"
              min={0}
              value={addressIndex}
              onChange={e => setAddressIndex(Math.max(0, Number(e.target.value) || 0))}
              disabled={isConnecting}
              className="focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2"
            />
            <div className="text-xs text-gray-500">
              Derivation path <span className="font-mono">{derivationPath}</span>
              {rememberedIndexes.has(addressIndex) && (
                <span className="ml-1 text-amber-700">
                  — this index is already added; connecting re-verifies it.
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button type="button" className="h-12 w-full" onClick={() => void connect()} disabled={isConnecting}>
            {isConnecting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Approve on your {vendors.find(v => v.vendor === vendor)?.label}…
              </>
            ) : (
              <>
                <Usb className="h-5 w-5" />
                Connect
              </>
            )}
          </Button>

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            Hardware wallet funds are shown separately from software wallet balances. The device
            may display the equivalent Bitcoin-format address during confirmation.
          </div>
        </div>
      </div>
    </div>
  );
}
