import type { HardwareWalletVendorModel, HardwareWalletViewActions } from './viewModel.ts';

export function VendorSelector({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'selectVendor'>;
  model: HardwareWalletVendorModel;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {model.vendors.map(option => {
        const Icon = option.icon;
        const selected = model.selectedVendor === option.vendor;

        return (
          <button
            key={option.vendor}
            type="button"
            onClick={() => actions.selectVendor(option.vendor)}
            disabled={model.hasPendingDeviceOperation}
            className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? 'border-brand-green bg-brand-light-green/20 text-gray-900'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon className={selected ? 'text-brand-green h-4 w-4' : 'h-4 w-4'} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
