import { AlertTriangle } from 'lucide-react';

export function HardwareWalletInfoNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <p>
          Hardware wallet funds are shown separately from the local wallet balance.
          Ledger uses the Bitcoin app, and Trezor uses Bitcoin signing. Either device may show
          the equivalent Bitcoin-format address during confirmation.
        </p>
      </div>
    </div>
  );
}
