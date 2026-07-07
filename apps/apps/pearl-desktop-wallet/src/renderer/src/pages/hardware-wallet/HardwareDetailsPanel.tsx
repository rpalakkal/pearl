import {Button} from '@/components/ui/button';
import {CopyButton} from '@/components/ui/copy-button';
import {Bech32Address} from '@/components/ui/bech32-address';
import type {HardwareWalletDetailsModel, HardwareWalletViewActions} from './viewModel.ts';

export function HardwareDetailsPanel({
  actions,
  hasPendingDeviceOperation,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'forgetHardwareAccount'>;
  hasPendingDeviceOperation: boolean;
  model: HardwareWalletDetailsModel;
}) {
  return (
    <>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <HardwareDetail
          label="Provider"
          value={
            model.isRememberedAccount
              ? `${model.connectedLabel} (remembered)`
              : model.connectedLabel
          }
        />
        <HardwareDetail label="Network" value={model.hardwareAddress.network} />
        <HardwareDetail label="Address Index" value={String(model.hardwareAddress.addressIndex)} />
        <HardwareDetail label="Path" value={model.hardwareAddress.path} />
        <HardwareDetail label="Public Key" value={model.hardwareAddress.publicKey} copyable />
        <HardwareDetail label="Address" value={model.hardwareAddress.address} copyable bech32 />
      </div>

      {model.isRememberedAccount && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          This hardware account was restored from this computer. The device is still required for
          address verification and signing.
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={actions.forgetHardwareAccount}
        disabled={hasPendingDeviceOperation}
      >
        Forget {model.connectedLabel} Account
      </Button>
    </>
  );
}

function HardwareDetail({
  label,
  value,
  copyable = false,
  bech32 = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  bech32?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 text-xs font-medium uppercase text-gray-500">{label}</div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 break-all font-mono text-xs text-gray-900">
          {bech32 ? <Bech32Address address={value} /> : value}
        </div>
        {copyable && <CopyButton value={value} className="p-1" iconClassName="h-4 w-4" />}
      </div>
    </div>
  );
}
