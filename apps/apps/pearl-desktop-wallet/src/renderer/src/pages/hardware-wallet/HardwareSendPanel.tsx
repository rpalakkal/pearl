import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSatsAsPearl } from '../../lib/hardwareWallet.ts';
import { AlertMessage } from './AlertMessage.tsx';
import type { HardwareWalletSendModel, HardwareWalletViewActions } from './viewModel.ts';

export function HardwareSendPanel({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'sendHardwareTransaction' | 'setSendAddress' | 'setSendAmount'>;
  model: HardwareWalletSendModel;
}) {
  return (
    <>
      <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-700">Send Pearl</div>
            <div className="text-xs text-gray-500">
              Fee rate {model.feeRate.toFixed(8)} PRL/kB
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Amount
            <input
              value={model.sendAmount}
              onChange={event => actions.setSendAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              disabled={model.hasPendingDeviceOperation}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-brand-green"
            />
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Recipient
            <input
              value={model.sendAddress}
              onChange={event => actions.setSendAddress(event.target.value)}
              placeholder={model.activeSendNetwork === 'testnet' ? 'tprl1...' : 'prl1...'}
              disabled={model.hasPendingDeviceOperation}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none transition-colors focus:border-brand-green"
            />
          </label>

          {model.deviceDisplayAddress && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="mb-1 font-medium">Device display address</div>
              <div className="break-all font-mono">{model.deviceDisplayAddress}</div>
            </div>
          )}

          {model.sendPreview.preview && (
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <SendPreviewMetric
                label="Network Fee"
                value={formatSatsAsPearl(model.sendPreview.preview.feeSats)}
              />
              <SendPreviewMetric
                label="Change"
                value={formatSatsAsPearl(model.sendPreview.preview.changeSats)}
              />
              <SendPreviewMetric
                label="Inputs"
                value={String(model.sendPreview.preview.inputCount)}
              />
            </div>
          )}
        </div>

        {model.sendPreview.error && !model.sendError && (
          <AlertMessage tone="warning">{model.sendPreview.error}</AlertMessage>
        )}
        {model.sendError && <AlertMessage tone="error">{model.sendError}</AlertMessage>}

        {model.sendSuccess && (
          <div className="min-w-0 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            <div>Broadcast transaction</div>
            <div className="mt-1 break-all font-mono text-xs sm:text-sm">{model.sendSuccess}</div>
            {model.lastSendFee && <div className="mt-1">Fee {model.lastSendFee}</div>}
          </div>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={actions.sendHardwareTransaction}
          disabled={model.hasPendingDeviceOperation || !model.sendPreview.preview}
        >
          {model.isSending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Send with {model.connectedLabel}
            </>
          )}
        </Button>
      </div>
      {!model.deviceDisplayAddress && model.sendAddress && (
        <AlertMessage tone="warning">
          Enter a valid Pearl Taproot recipient to preview the address shown on the device.
        </AlertMessage>
      )}
    </>
  );
}

function SendPreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-white p-2">
      <div className="mb-1 font-medium uppercase text-gray-500">{label}</div>
      <div className="break-all font-mono text-gray-900">{value}</div>
    </div>
  );
}
