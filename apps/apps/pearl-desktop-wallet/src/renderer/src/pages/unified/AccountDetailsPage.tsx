import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Key, Loader2, PenLine, ShieldCheck, Wallet} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {CopyButton} from '@/components/ui/copy-button';
import {Bech32Address} from '@/components/ui/bech32-address';
import SendHeader from '../send-transaction/SendHeader';
import {HardwareDetailsPanel} from '../hardware-wallet/HardwareDetailsPanel';
import {AlertMessage} from '../hardware-wallet/AlertMessage';
import {useHardwareAccount} from '../../hooks/hardware/useHardwareAccount';
import {useAccountsStore, useActiveAccount} from '../../store/accountsStore';
import {
  forgetStoredHardwareAccount,
  renameStoredHardwareAccount,
  HARDWARE_ACCOUNT_LABEL_MAX_LENGTH,
} from '../../lib/hardwareWalletStorage';
import {
  accountDisplayName,
  defaultHardwareAccountName,
  resolveActiveAccount,
  type WalletAccount,
} from '../../lib/accounts';
import {getHardwareWalletProviderName} from '../../lib/hardwareWallet';
import {useWalletStore} from '../../store/walletStore';

// The /account route: details for the active account. Hardware accounts get
// name/path/pubkey/verify/forget; software wallets a summary card.
export default function AccountDetailsPage() {
  const active = useActiveAccount();

  if (active?.kind === 'hardware') {
    return <HardwareAccountDetails key={active.id} account={active} />;
  }
  if (active?.kind === 'software') {
    return <SoftwareAccountDetails account={active} />;
  }
  return null;
}

function HardwareAccountDetails({account}: {account: WalletAccount & {kind: 'hardware'}}) {
  const navigate = useNavigate();
  const hardware = useHardwareAccount(account);
  const {refreshAccounts, setActiveAccount} = useAccountsStore();

  async function forgetAccount() {
    forgetStoredHardwareAccount(account.network, account.vendor, account.address);
    const accounts = await refreshAccounts();
    const fallback = resolveActiveAccount(
      accounts.filter(candidate => candidate.id !== account.id),
      null
    );
    if (fallback) {
      await setActiveAccount(fallback.id);
    }
    navigate('/wallet');
  }

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <SendHeader title={accountDisplayName(account)} onBack={() => navigate('/wallet')} />
      <div className="flex-1 overflow-y-auto px-8 py-12">
        <div className="mx-auto w-full max-w-xl space-y-4">
          <HardwareAccountNameCard account={account} />

          <HardwareDetailsPanel
            actions={{forgetHardwareAccount: () => void forgetAccount()}}
            hasPendingDeviceOperation={hardware.hasPendingDeviceOperation}
            model={{
              connectedLabel: getHardwareWalletProviderName(account.vendor),
              hardwareAddress: account,
              isRememberedAccount: true,
            }}
          />

          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-medium text-gray-700">Verify on device</div>
            <p className="text-xs text-gray-500">
              Show this account's address on your {getHardwareWalletProviderName(account.vendor)}{' '}
              and compare it with the receive address in the app. The device shows the same key
              with a different network prefix and checksum — only the highlighted parts differ.
            </p>
            {hardware.receive?.verifiedDeviceAddress && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                <div className="mb-1 font-medium">Device displayed</div>
                <div className="break-all font-mono">
                  <Bech32Address address={hardware.receive.verifiedDeviceAddress} />
                </div>
              </div>
            )}
            {hardware.receive?.verifyError && (
              <AlertMessage tone="error">{hardware.receive.verifyError}</AlertMessage>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={hardware.actions.verifyReceiveAddress}
              disabled={hardware.hasPendingDeviceOperation}
            >
              {hardware.receive?.isVerifyingAddress ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirm on device
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Verify address on device
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HardwareAccountNameCard({account}: {account: WalletAccount & {kind: 'hardware'}}) {
  const {refreshAccounts} = useAccountsStore();
  const [draft, setDraft] = useState(account.label ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const savedLabel = account.label ?? '';
  const isDirty = draft.trim() !== savedLabel;

  async function save() {
    setIsSaving(true);
    try {
      renameStoredHardwareAccount(
        account.network,
        account.vendor,
        account.address,
        draft.trim() || null
      );
      await refreshAccounts();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="text-sm font-medium text-gray-700">Account name</div>
      <p className="text-xs text-gray-500">
        Give this device's account a name so it stays recognizable — even with several{' '}
        {getHardwareWalletProviderName(account.vendor)} devices. Leave blank to use{' '}
        {defaultHardwareAccountName(account)}.
      </p>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={defaultHardwareAccountName(account)}
          maxLength={HARDWARE_ACCOUNT_LABEL_MAX_LENGTH}
          className="bg-white"
        />
        <Button type="button" onClick={() => void save()} disabled={!isDirty || isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function SoftwareAccountDetails({account}: {account: WalletAccount & {kind: 'software'}}) {
  const navigate = useNavigate();
  const {walletName} = useWalletStore();
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.appBridge.wallet
      .getNewAddress()
      .then(address => {
        if (!cancelled) {
          setReceiveAddress(address);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReceiveAddress(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <SendHeader title={account.name} onBack={() => navigate('/wallet')} />
      <div className="flex-1 overflow-y-auto px-8 py-12">
        <div className="mx-auto w-full max-w-xl space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="rounded-full bg-gray-200 p-2">
              <Wallet className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{walletName || account.name}</div>
              <div className="text-xs text-gray-500">Seed-based wallet on this device</div>
            </div>
          </div>

          {receiveAddress && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 text-sm font-medium text-gray-700">Receive address</div>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 break-all font-mono text-xs text-gray-900">
                  <Bech32Address address={receiveAddress} />
                </div>
                <CopyButton value={receiveAddress} className="p-1" iconClassName="h-4 w-4" />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            This wallet's passphrase is generated and stored in the encrypted vault behind your
            app password. Your recovery phrase is the backup — keep it safe.
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate('/change-password')}
          >
            <Key className="h-4 w-4" />
            Change app password
          </Button>
        </div>
      </div>
    </div>
  );
}
