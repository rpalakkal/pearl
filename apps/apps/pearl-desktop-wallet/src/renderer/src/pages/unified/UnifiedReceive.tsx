import {useNavigate} from 'react-router-dom';
import ReceiveTransaction from '../ReceiveTransaction';
import SendHeader from '../send-transaction/SendHeader';
import {ReceivePanel} from '../hardware-wallet/ReceivePanel';
import {useHardwareAccount} from '../../hooks/hardware/useHardwareAccount';
import {useActiveAccount} from '../../store/accountsStore';
import type {WalletAccount} from '../../lib/accounts';

// The /receive route: a fresh software address, or the hardware account's
// fixed address with verify-on-device.
export default function UnifiedReceive() {
  const active = useActiveAccount();

  if (active?.kind === 'hardware') {
    return <HardwareReceivePage key={active.id} account={active} />;
  }

  return <ReceiveTransaction />;
}

function HardwareReceivePage({account}: {account: WalletAccount & {kind: 'hardware'}}) {
  const navigate = useNavigate();
  const hardware = useHardwareAccount(account);

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <SendHeader title="Receive Pearl" onBack={() => navigate('/wallet')} />
      <div className="flex-1 overflow-y-auto px-8 py-12">
        <div className="flex justify-center">
          <div className="w-full max-w-xl space-y-4">
            {hardware.receive && (
              <ReceivePanel actions={hardware.actions} model={hardware.receive} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
