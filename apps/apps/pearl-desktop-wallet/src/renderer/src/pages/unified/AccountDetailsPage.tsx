import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {AlertTriangle, Eye, Key, Loader2, PenLine, ShieldCheck, Trash2, Wallet} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {CopyButton} from '@/components/ui/copy-button';
import {Bech32Address} from '@/components/ui/bech32-address';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {PasswordInput} from '../../components/PasswordInput';
import {getErrorMessage} from '@/lib/utils';
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
  persistActiveAccountId,
  resolveActiveAccount,
  softwareAccountId,
  type WalletAccount,
} from '../../lib/accounts';
import {getHardwareWalletProviderName} from '../../lib/hardwareWallet';
import {getStableReceiveAddress} from '../../lib/receiveAddress';
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
  const {refreshAccounts, setActiveAccount, clearActiveAccount} = useAccountsStore();

  async function forgetAccount() {
    forgetStoredHardwareAccount(account.network, account.vendor, account.address);
    const accounts = await refreshAccounts();
    const fallback = resolveActiveAccount(
      accounts.filter(candidate => candidate.id !== account.id),
      null
    );
    if (fallback) {
      await setActiveAccount(fallback.id);
    } else {
      // No accounts remain; drop the stale selection so /wallet shows the
      // add-your-first-account state instead of a broken dashboard.
      clearActiveAccount();
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
  const network = useAccountsStore(state => state.network);
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStableReceiveAddress(network, account.name)
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
  }, [network, account.name]);

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

          <SoftwareWalletNameCard account={account} />

          <RecoveryPhraseCard walletName={account.name} />

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

          <RemoveWalletCard account={account} />
        </div>
      </div>
    </div>
  );
}

function SoftwareWalletNameCard({account}: {account: WalletAccount & {kind: 'software'}}) {
  const {refreshAccounts, setActiveAccount, network, switchState} = useAccountsStore();
  const [draft, setDraft] = useState(account.name);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const isDirty = trimmed !== '' && trimmed !== account.name;

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      const {name} = await window.appBridge.manager.renameWallet(account.name, trimmed);
      // The wallet process stopped under the old name; persist and re-select
      // under the new one (restarts the process).
      persistActiveAccountId(network, softwareAccountId(name));
      await refreshAccounts();
      await setActiveAccount(softwareAccountId(name));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to rename the wallet'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="text-sm font-medium text-gray-700">Wallet name</div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={account.name}
          maxLength={64}
          className="bg-white"
        />
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!isDirty || isSaving || switchState !== 'idle'}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
          Save
        </Button>
      </div>
      {error && <AlertMessage tone="error">{error}</AlertMessage>}
      <p className="text-xs text-gray-500">
        Renaming restarts the wallet under its new name; funds and history are unaffected.
      </p>
    </div>
  );
}

function RecoveryPhraseCard({walletName}: {walletName: string}) {
  const [hasMnemonic, setHasMnemonic] = useState<boolean | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.appBridge.appLock
      .hasWalletMnemonic(walletName)
      .then(has => {
        if (!cancelled) {
          setHasMnemonic(has);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasMnemonic(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [walletName]);

  function closeDialog() {
    // Never keep the phrase in component state longer than the dialog.
    setIsDialogOpen(false);
    setPassword('');
    setPhrase(null);
    setError(null);
  }

  async function reveal() {
    setIsRevealing(true);
    setError(null);
    try {
      const mnemonic = await window.appBridge.appLock.revealWalletMnemonic(walletName, password);
      if (mnemonic === null) {
        setError('No recovery phrase is stored for this wallet.');
      } else {
        setPhrase(mnemonic);
        setPassword('');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Incorrect password'));
    } finally {
      setIsRevealing(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="text-sm font-medium text-gray-700">Recovery phrase</div>
      {hasMnemonic === false ? (
        <p className="text-xs text-gray-500">
          This wallet was created before recovery-phrase backup was added; its phrase was shown
          only at creation and cannot be displayed again.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            The 12-word phrase is the only backup of this wallet. Revealing it requires your app
            password.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={hasMnemonic === null}
            onClick={() => setIsDialogOpen(true)}
          >
            <Eye className="h-4 w-4" />
            Reveal recovery phrase
          </Button>
        </>
      )}

      <Dialog open={isDialogOpen} onOpenChange={open => !open && closeDialog()}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Reveal recovery phrase</DialogTitle>
          </DialogHeader>
          {phrase === null ? (
            <form
              className="space-y-3"
              onSubmit={event => {
                event.preventDefault();
                if (password && !isRevealing) {
                  void reveal();
                }
              }}
            >
              <p className="text-sm text-gray-600">
                Enter your app password. Make sure nobody can see your screen.
              </p>
              <PasswordInput value={password} onChange={setPassword} autoFocus />
              {error && <AlertMessage tone="error">{error}</AlertMessage>}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={!password || isRevealing}>
                  {isRevealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  Reveal
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                Anyone with these words can take this wallet's funds. Never share them.
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="min-w-0 flex-1 break-words font-mono text-sm text-gray-900">
                  {phrase}
                </div>
                <CopyButton value={phrase} className="p-1" iconClassName="h-4 w-4" />
              </div>
              <Button type="button" className="w-full" onClick={closeDialog}>
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveWalletCard({account}: {account: WalletAccount & {kind: 'software'}}) {
  const navigate = useNavigate();
  const {refreshAccounts, setActiveAccount, clearActiveAccount} = useAccountsStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function closeDialog() {
    if (!isDeleting) {
      setIsDialogOpen(false);
      setPassword('');
      setError(null);
    }
  }

  async function removeWallet() {
    setIsDeleting(true);
    setError(null);
    try {
      await window.appBridge.manager.deleteWallet(account.name, password);
      const accounts = await refreshAccounts();
      const fallback = resolveActiveAccount(
        accounts.filter(candidate => candidate.id !== account.id),
        null
      );
      if (fallback) {
        await setActiveAccount(fallback.id);
      } else {
        clearActiveAccount();
      }
      navigate('/wallet');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to remove the wallet'));
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-4">
      <div className="text-sm font-medium text-red-800">Remove wallet from this device</div>
      <p className="text-xs text-red-700">
        Deletes this wallet's local data. Funds stay on the blockchain; the only way to restore
        this wallet is its recovery phrase.
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full border-red-300 text-red-700 hover:bg-red-100"
        onClick={() => setIsDialogOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        Remove wallet
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={open => !open && closeDialog()}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Remove "{account.name}"?
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              if (password && !isDeleting) {
                void removeWallet();
              }
            }}
          >
            <p className="text-sm text-gray-600">
              This deletes the wallet's data on this device. Without its recovery phrase the
              wallet cannot be restored. Enter your app password to confirm.
            </p>
            <PasswordInput value={password} onChange={setPassword} autoFocus />
            {error && <AlertMessage tone="error">{error}</AlertMessage>}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeDialog}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-red-600 text-white hover:bg-red-700"
                disabled={!password || isDeleting}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remove wallet
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
