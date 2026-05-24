import { AlertMessage } from './AlertMessage.tsx';
import { ConnectHardwareWalletButton } from './ConnectHardwareWalletButton.tsx';
import { HardwareAddressSelector } from './HardwareAddressSelector.tsx';
import { HardwareBalancePanel } from './HardwareBalancePanel.tsx';
import { HardwareDetailsPanel } from './HardwareDetailsPanel.tsx';
import { HardwareSendPanel } from './HardwareSendPanel.tsx';
import { HardwareWalletHeader } from './HardwareWalletHeader.tsx';
import { HardwareWalletInfoNotice } from './HardwareWalletInfoNotice.tsx';
import { ReceivePanel } from './ReceivePanel.tsx';
import { VendorSelector } from './VendorSelector.tsx';
import type { HardwareWalletViewProps } from './viewModel.ts';

export function HardwareWalletView({ actions, model }: HardwareWalletViewProps) {
  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <HardwareWalletHeader actions={actions} model={model.header} />

      <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-lg space-y-6">
          <VendorSelector actions={actions} model={model.vendor} />
          <HardwareAddressSelector actions={actions} model={model.addressSelector} />
          <HardwareWalletInfoNotice />
          <ConnectHardwareWalletButton
            actions={actions}
            connection={model.connection}
            vendor={model.vendor}
          />

          {model.connection.errorMessage && (
            <AlertMessage tone="error">{model.connection.errorMessage}</AlertMessage>
          )}

          {model.connectedWallet && (
            <div className="space-y-5">
              <HardwareBalancePanel actions={actions} model={model.connectedWallet.balance} />
              <ReceivePanel actions={actions} model={model.connectedWallet.receive} />
              <HardwareDetailsPanel
                actions={actions}
                hasPendingDeviceOperation={model.connectedWallet.balance.hasPendingDeviceOperation}
                model={model.connectedWallet.details}
              />
              <HardwareSendPanel actions={actions} model={model.connectedWallet.send} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
