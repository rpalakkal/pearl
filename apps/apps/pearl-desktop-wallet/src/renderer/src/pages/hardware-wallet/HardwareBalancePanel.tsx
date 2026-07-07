import {History, Loader2, RefreshCw} from 'lucide-react';
import {formatSatsAsPearl} from '../../lib/hardwareWallet.ts';
import type {HardwareWalletBalanceModel, HardwareWalletViewActions} from './viewModel.ts';

function backfillPercent(model: HardwareWalletBalanceModel): number {
  const backfill = model.backfill;
  if (!backfill || backfill.targetHeight <= backfill.startHeight) {
    return 0;
  }
  const scanned = backfill.currentHeight - backfill.startHeight;
  const total = backfill.targetHeight - backfill.startHeight;
  return Math.max(0, Math.min(100, Math.round((scanned / total) * 100)));
}

export function HardwareBalancePanel({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'loadHardwareWalletBalance' | 'backfillHardwareAddress'>;
  model: HardwareWalletBalanceModel;
}) {
  const backfill = model.backfill;
  const isBackfillInFlight =
    backfill !== null && (backfill.status === 'queued' || backfill.status === 'running');
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-700">Hardware Balance</div>
          <div className="text-xs text-gray-500">Read from local Oyster</div>
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

      {model.walletSyncing && !model.balanceError && (
        <div className="mb-3 flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
          <span>
            The local wallet is still syncing the chain — balances may be incomplete until it
            finishes.
          </span>
        </div>
      )}

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

      {model.canBackfill && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              Missing history? Backfill rescans the chain from genesis for this address.
            </div>
            <button
              type="button"
              onClick={actions.backfillHardwareAddress}
              disabled={isBackfillInFlight || model.hasPendingDeviceOperation}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBackfillInFlight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <History className="h-3.5 w-3.5" />
              )}
              Backfill history
            </button>
          </div>

          {isBackfillInFlight && backfill && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <div className="mb-1 flex items-center justify-between">
                <span>Backfill in progress — balance may be incomplete until it finishes.</span>
                {/* The scan target is resolved only once the chain is synced;
                    until then the job is queued, not stuck. */}
                <span className="font-mono">
                  {backfill.targetHeight > 0
                    ? `${backfill.currentHeight.toLocaleString()} / ${backfill.targetHeight.toLocaleString()}`
                    : 'waiting for chain sync'}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-100">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{width: `${backfillPercent(model)}%`}}
                />
              </div>
              {model.backfillStalled && (
                <div className="mt-2 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
                  <span>
                    Waiting for network peers — filter downloads are slow right now. The backfill
                    resumes automatically; restarting the wallet cancels it.
                  </span>
                </div>
              )}
            </div>
          )}

          {backfill?.status === 'complete' && (
            <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800">
              Backfill complete through block {backfill.targetHeight.toLocaleString()}.
            </div>
          )}

          {backfill?.status === 'failed' && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              Backfill failed{backfill.error ? `: ${backfill.error}` : '.'}
            </div>
          )}

          {model.backfillError && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {model.backfillError}
            </div>
          )}
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
