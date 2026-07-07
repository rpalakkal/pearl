import {type ReactNode} from 'react';
import {ArrowDownLeft, ArrowUpRight, Info} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {formatSatsAsPearl} from '../../lib/hardwareWallet';
import {useHardwareAccount} from '../../hooks/hardware/useHardwareAccount';
import {useHardwareActivity} from '../../hooks/hardware/useHardwareActivity';
import {HardwareBalancePanel} from '../hardware-wallet/HardwareBalancePanel';
import {compactHardwareAddress} from '../hardware-wallet/pageModel';
import {accountDisplayName, type WalletAccount} from '../../lib/accounts';

/**
 * Dashboard for an active hardware account: balance (local Oyster or
 * indexer), backfill, and the same action layout as the software dashboard.
 */
export function HardwareDashboard({account}: {account: WalletAccount & {kind: 'hardware'}}) {
  const navigate = useNavigate();
  const hardware = useHardwareAccount(account);
  const activity = useHardwareActivity(account);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-transparent">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:px-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{accountDisplayName(account)}</h1>
          <div className="mt-1 font-mono text-sm text-gray-500">
            {compactHardwareAddress(account.address)}
          </div>
          <div className="mt-6 text-sm text-gray-500">Spendable Balance</div>
          <div className="text-5xl font-bold text-gray-900">
            {hardware.balance?.isLoadingBalance
              ? '…'
              : formatSatsAsPearl(hardware.balance?.spendableBalanceSats ?? 0n)}
          </div>
        </div>

        {hardware.balance && (
          <HardwareBalancePanel actions={hardware.actions} model={hardware.balance} />
        )}

        <div className="grid w-full grid-cols-3 gap-3 sm:gap-4">
          <ActionTile
            onClick={() => navigate('/send')}
            icon={<ArrowUpRight className="h-4 w-4 text-white sm:h-5 sm:w-5" />}
            label="Send"
          />
          <ActionTile
            onClick={() => navigate('/receive')}
            icon={<ArrowDownLeft className="h-4 w-4 text-white sm:h-5 sm:w-5" />}
            label="Receive"
          />
          <ActionTile
            onClick={() => navigate('/account')}
            icon={<Info className="h-4 w-4 text-white sm:h-5 sm:w-5" />}
            label="Details"
          />
        </div>

        <div className="w-full">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Activity</h3>
            <button
              onClick={() => navigate('/activity')}
              className="text-brand-green hover:text-brand-green/80 text-sm transition-colors"
            >
              View All
            </button>
          </div>
          {activity.error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {activity.error}
            </div>
          ) : activity.loading && activity.activities.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white py-8 text-center shadow-sm">
              <p className="text-sm text-gray-500">Loading activity…</p>
            </div>
          ) : activity.activities.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white py-8 text-center shadow-sm">
              <p className="text-sm text-gray-500">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activity.activities.slice(0, 3).map((tx, index) => (
                <div
                  key={`${tx.txid}_${index}`}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                      {tx.type === 'received' ? (
                        <ArrowDownLeft className="text-brand-green h-5 w-5" />
                      ) : (
                        <ArrowUpRight className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {tx.type === 'received' ? 'Received' : 'Sent'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {tx.confirmations} confirmations
                      </div>
                    </div>
                  </div>
                  <div
                    className={`font-bold ${tx.type === 'received' ? 'text-green-700' : 'text-red-500'}`}
                  >
                    {tx.type === 'received' ? '+' : '-'}
                    {tx.amount} PRL
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionTile({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 sm:h-10 sm:w-10">
        {icon}
      </div>
      <span className="text-sm font-medium text-gray-900">{label}</span>
    </button>
  );
}
