import {Loader2} from 'lucide-react';
import WalletDashboard from '../WalletDashboard';
import {HardwareDashboard} from './HardwareDashboard';
import {EmptyAccountsState} from './EmptyAccountsState';
import {useAccountsStore, useActiveAccount} from '../../store/accountsStore';

// The /wallet route: renders the software dashboard or the hardware account
// dashboard depending on the active account.
export default function UnifiedDashboard() {
  const active = useActiveAccount();
  const accounts = useAccountsStore(state => state.accounts);
  const accountsLoaded = useAccountsStore(state => state.accountsLoaded);

  if (active?.kind === 'hardware') {
    return <HardwareDashboard key={active.id} account={active} />;
  }
  if (active?.kind === 'software') {
    return <WalletDashboard />;
  }

  if (!accountsLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }
  if (accounts.length === 0) {
    return <EmptyAccountsState />;
  }

  // Accounts exist but none is active (e.g. the last selection was just
  // forgotten): fall back to the software dashboard as before.
  return <WalletDashboard />;
}
