import {ArrowLeft} from 'lucide-react';
import type {HardwareWalletHeaderModel, HardwareWalletViewActions} from './viewModel.ts';

export function HardwareWalletHeader({
  actions,
  model,
}: {
  actions: Pick<HardwareWalletViewActions, 'goBack'>;
  model: HardwareWalletHeaderModel;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={actions.goBack}
        disabled={model.hasPendingDeviceOperation}
        className="rounded-lg p-2 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowLeft className="h-5 w-5 text-gray-700" />
      </button>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Hardware Wallet</h1>
        <p className="text-sm text-gray-500">
          {model.networkDisplayName} · {model.derivationPath}
        </p>
      </div>
    </div>
  );
}
