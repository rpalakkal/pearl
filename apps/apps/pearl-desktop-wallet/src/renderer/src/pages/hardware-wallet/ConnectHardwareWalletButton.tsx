import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {
  HardwareWalletConnectionModel,
  HardwareWalletVendorModel,
  HardwareWalletViewActions,
} from './viewModel.ts';

export function ConnectHardwareWalletButton({
  actions,
  connection,
  vendor,
}: {
  actions: Pick<HardwareWalletViewActions, 'connectDevice'>;
  connection: HardwareWalletConnectionModel;
  vendor: HardwareWalletVendorModel;
}) {
  const SelectedVendorIcon =
    vendor.vendors.find(option => option.vendor === vendor.selectedVendor)?.icon ??
    vendor.vendors[0].icon;

  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      onClick={actions.connectDevice}
      disabled={vendor.hasPendingDeviceOperation}
    >
      {connection.isConnecting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting
        </>
      ) : (
        <>
          <SelectedVendorIcon className="h-4 w-4" />
          Connect {vendor.selectedLabel}
        </>
      )}
    </Button>
  );
}
