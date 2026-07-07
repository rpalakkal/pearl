import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Download,
  HardDrive,
  Loader2,
  Plus,
  Usb,
  Wallet,
} from 'lucide-react';
import {useAccountsStore} from '../../store/accountsStore';
import {accountDisplayName, type WalletAccount} from '../../lib/accounts';

function truncateAddress(address: string): string {
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 9)}…${address.slice(-5)}`;
}

function AccountIcon({account}: {account: WalletAccount}) {
  if (account.kind === 'software') {
    return <Wallet className="h-4 w-4 flex-shrink-0 text-gray-500" />;
  }
  return account.vendor === 'ledger' ? (
    <Usb className="h-4 w-4 flex-shrink-0 text-gray-500" />
  ) : (
    <HardDrive className="h-4 w-4 flex-shrink-0 text-gray-500" />
  );
}

export function AccountSwitcher() {
  const navigate = useNavigate();
  const {accounts, activeAccountId, switchState, setActiveAccount} = useAccountsStore();
  const [isOpen, setIsOpen] = useState(false);

  const active = accounts.find(account => account.id === activeAccountId) ?? null;
  const softwareAccounts = accounts.filter(account => account.kind === 'software');
  const hardwareAccounts = accounts.filter(account => account.kind === 'hardware');
  const isSwitching = switchState !== 'idle';

  async function selectAccount(account: WalletAccount) {
    setIsOpen(false);
    await setActiveAccount(account.id);
    navigate('/wallet');
  }

  function addAccount(path: string) {
    setIsOpen(false);
    navigate(path);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60"
      >
        {isSwitching ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
        ) : active ? (
          <AccountIcon account={active} />
        ) : (
          <Wallet className="h-4 w-4 text-gray-400" />
        )}
        <span className="max-w-[180px] truncate font-medium text-gray-900">
          {isSwitching ? 'Starting wallet…' : active ? accountDisplayName(active) : 'No account'}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-500" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border border-gray-300 bg-white py-2 shadow-lg">
            {softwareAccounts.length > 0 && (
              <div>
                <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Wallets
                </div>
                {softwareAccounts.map(account => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => void selectAccount(account)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-gray-100"
                  >
                    <AccountIcon account={account} />
                    <span className="flex-1 truncate text-gray-900">
                      {accountDisplayName(account)}
                    </span>
                    {account.id === activeAccountId && (
                      <Check className="h-4 w-4 text-green-600" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {hardwareAccounts.length > 0 && (
              <div>
                <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Hardware
                </div>
                {hardwareAccounts.map(account => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => void selectAccount(account)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-gray-100"
                  >
                    <AccountIcon account={account} />
                    <span className="truncate text-gray-900">{accountDisplayName(account)}</span>
                    {account.kind === 'hardware' && (
                      <span className="flex-1 truncate font-mono text-xs text-gray-400">
                        {truncateAddress(account.address)}
                      </span>
                    )}
                    {account.id === activeAccountId && (
                      <Check className="h-4 w-4 flex-shrink-0 text-green-600" />
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-1 border-t border-gray-200 pt-1">
              <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Add account
              </div>
              <button
                type="button"
                onClick={() => addAccount('/onboarding/create')}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-900 transition-colors hover:bg-gray-100"
              >
                <Plus className="h-4 w-4 text-gray-500" />
                Create new wallet
              </button>
              <button
                type="button"
                onClick={() => addAccount('/import-account')}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-900 transition-colors hover:bg-gray-100"
              >
                <Download className="h-4 w-4 text-gray-500" />
                Import from recovery phrase
              </button>
              <button
                type="button"
                onClick={() => addAccount('/onboarding/connect-hardware')}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-900 transition-colors hover:bg-gray-100"
              >
                <Usb className="h-4 w-4 text-gray-500" />
                Connect hardware wallet
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
