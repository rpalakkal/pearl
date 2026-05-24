import { CheckCircle2, ChevronDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  HardwareWalletAddressSelectorModel,
  HardwareWalletViewActions,
} from './viewModel.ts';

export function HardwareAddressSelector({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'addHardwareAddress' | 'selectAddressIndex'>;
  model: HardwareWalletAddressSelectorModel;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-700">Hardware Address</div>
          <div className="mt-1 break-all font-mono text-xs text-gray-500">
            {model.selectedAddressPath}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={model.hasPendingDeviceOperation}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">
                  Address {model.selectedAddressIndex}
                </span>
                <span className="block truncate font-mono text-xs text-gray-500">
                  {model.selectedAddressSummary}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-500" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {model.options.map(option => (
              <DropdownMenuItem
                key={option.addressIndex}
                onSelect={() => actions.selectAddressIndex(option.addressIndex)}
                className="items-start gap-3"
              >
                <CheckCircle2
                  className={`mt-0.5 h-4 w-4 ${
                    option.addressIndex === model.selectedAddressIndex
                      ? 'text-brand-green'
                      : 'text-transparent'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    Address {option.addressIndex}
                  </span>
                  <span className="block truncate font-mono text-xs text-gray-500">
                    {option.account
                      ? compactHardwareAddress(option.account.address)
                      : 'Not connected'}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={actions.addHardwareAddress}
              disabled={model.nextAddressIndex === null}
              className="gap-3"
            >
              <Plus className="h-4 w-4 text-gray-700" />
              <span>Add Address</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function compactHardwareAddress(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}...${value.slice(-8)}`;
}
