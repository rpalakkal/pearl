import WalletDashboard from '../WalletDashboard';
import {HardwareDashboard} from './HardwareDashboard';
import {useActiveAccount} from '../../store/accountsStore';

// The /wallet route: renders the software dashboard or the hardware account
// dashboard depending on the active account.
export default function UnifiedDashboard() {
  const active = useActiveAccount();

  if (active?.kind === 'hardware') {
    return <HardwareDashboard key={active.id} account={active} />;
  }

  return <WalletDashboard />;
}
