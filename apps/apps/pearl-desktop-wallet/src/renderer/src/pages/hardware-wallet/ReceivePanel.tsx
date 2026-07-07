import {CheckCircle2, Copy, Loader2} from 'lucide-react';
import {QrcodeCanvas} from 'react-qrcode-pretty';
import {Button} from '@/components/ui/button';
import {Bech32Address} from '@/components/ui/bech32-address';
import type {HardwareWalletReceiveModel, HardwareWalletViewActions} from './viewModel.ts';

export function ReceivePanel({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'copyToClipboard' | 'verifyReceiveAddress'>;
  model: HardwareWalletReceiveModel;
}) {
  return (
    <>
      <div className="flex justify-center">
        <QrcodeCanvas
          value={model.hardwareAddress.address}
          size={188}
          padding={10}
          margin={10}
          bgColor="#ffffff"
          bgRounded
          level="M"
          variant="fluid"
          divider
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-gray-700">Receive Address</div>
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900">
            <Bech32Address address={model.hardwareAddress.address} />
          </div>
          <button
            type="button"
            onClick={() => actions.copyToClipboard(model.hardwareAddress.address)}
            className="flex-shrink-0 rounded-md p-1.5 transition-colors hover:bg-gray-100"
          >
            {model.copiedAddress ? (
              <CheckCircle2 className="text-brand-green h-5 w-5" />
            ) : (
              <Copy className="h-5 w-5 text-gray-600" />
            )}
          </button>
        </div>
        {model.receiveDeviceDisplayAddress && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="mb-1 font-medium">Expected device display address</div>
            <div className="break-all font-mono">
              <Bech32Address address={model.receiveDeviceDisplayAddress} />
            </div>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={actions.verifyReceiveAddress}
          disabled={model.hasPendingDeviceOperation}
        >
          {model.isVerifyingAddress ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifying
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Verify on {model.connectedLabel}
            </>
          )}
        </Button>
        {model.verifiedDeviceAddress && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            <div className="mb-1 font-medium">Verified device display address</div>
            <div className="break-all font-mono">
              <Bech32Address address={model.verifiedDeviceAddress} />
            </div>
          </div>
        )}
        {model.verifyError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {model.verifyError}
          </div>
        )}
      </div>
    </>
  );
}
