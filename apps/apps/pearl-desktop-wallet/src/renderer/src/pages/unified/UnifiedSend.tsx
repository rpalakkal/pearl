import {useNavigate} from 'react-router-dom';
import SendTransaction from '../send-transaction/SendTransaction';
import SendHeader from '../send-transaction/SendHeader';
import {HardwareSendPanel} from '../hardware-wallet/HardwareSendPanel';
import {useHardwareAccount} from '../../hooks/hardware/useHardwareAccount';
import {useActiveAccount} from '../../store/accountsStore';
import type {WalletAccount} from '../../lib/accounts';

// The /send route: software wallet form or the staged hardware send flow,
// depending on the active account.
export default function UnifiedSend() {
  const active = useActiveAccount();

  if (active?.kind === 'hardware') {
    return <HardwareSendPage key={active.id} account={active} />;
  }

  return <SendTransaction />;
}

function HardwareSendPage({account}: {account: WalletAccount & {kind: 'hardware'}}) {
  const navigate = useNavigate();
  const hardware = useHardwareAccount(account);

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <SendHeader title="Send Pearl" onBack={() => navigate('/wallet')} />
      <div className="flex-1 overflow-y-auto px-8 py-12">
        <div className="flex justify-center">
          <div className="w-full max-w-xl space-y-4">
            {hardware.send && (
              <HardwareSendPanel actions={hardware.actions} model={hardware.send} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
