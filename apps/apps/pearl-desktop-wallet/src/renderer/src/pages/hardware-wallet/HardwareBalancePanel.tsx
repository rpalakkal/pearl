import {RefreshCw} from 'lucide-react';
import {formatSatsAsPearl} from '../../lib/hardwareWallet.ts';
import type {HardwareWalletBalanceModel, HardwareWalletViewActions} from './viewModel.ts';

export function HardwareBalancePanel({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'loadHardwareWalletBalance'>;
  model: HardwareWalletBalanceModel;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-700">Hardware Balance</div>
          <div className="text-xs text-gray-500">
            {model.balanceSource === 'indexer'
              ? 'Read from network indexer (no local wallet running)'
              : 'Read from local Oyster'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => actions.loadHardwareWalletBalance(model.hardwareAddress)}
          disabled={model.isLoadingBalance || model.hasPendingDeviceOperation}
          className="rounded-md p-1.5 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 text-gray-600 ${model.isLoadingBalance ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {model.balanceError ? (
        <div className="text-sm text-red-700">{model.balanceError}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <BalanceMetric
            label="Spendable"
            value={
              model.isLoadingBalance ? 'Loading' : formatSatsAsPearl(model.spendableBalanceSats)
            }
          />
          <BalanceMetric
            label={model.pendingBalanceLabel}
            value={model.pendingBalanceValue}
            tone={model.pendingBalanceIsOutgoing ? 'warning' : 'default'}
          />
          <BalanceMetric
            label="Spendable UTXOs"
            value={model.isLoadingBalance ? 'Loading' : String(model.spendableUtxoCount)}
          />
        </div>
      )}
      {model.pendingBalanceNotice && !model.balanceError && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {model.pendingBalanceNotice}
        </div>
      )}
    </div>
  );
}

function BalanceMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning';
}) {
  const valueClassName = tone === 'warning' ? 'text-amber-900' : 'text-gray-900';

  return (
    <div className="min-w-0 rounded-md bg-white p-3">
      <div className="mb-1 text-xs font-medium uppercase text-gray-500">{label}</div>
      <div
        className={`whitespace-normal break-words font-mono text-xs leading-5 sm:text-[13px] ${valueClassName}`}
      >
        {value}
      </div>
    </div>
  );
}
