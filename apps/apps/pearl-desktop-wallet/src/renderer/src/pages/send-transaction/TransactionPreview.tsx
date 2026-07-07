type TransactionPreviewProps = {
  amount: string;
  address: string;
  currentFee: number | string;
  // Client-side fee estimate for this exact send; null when unavailable.
  estimate?: { fee: string; total: string } | null;
};

export default function TransactionPreview({
  amount,
  address,
  currentFee,
  estimate = null,
}: TransactionPreviewProps) {
  return (
    <div className="space-y-2 rounded-lg border border-gray-300 bg-white p-4 shadow-sm">
      <div className="text-sm text-neutral-400">Transaction Preview</div>
      <div className="flex justify-between">
        <span className="text-neutral-400">Amount:</span>
        <span className="font-medium text-gray-900">{amount} PRL</span>
      </div>
      <div className="flex justify-between">
        <span className="text-neutral-400">To:</span>
        <span className="font-mono text-sm text-gray-900">
          {address.slice(0, 8)}...{address.slice(-6)}
        </span>
      </div>
      {estimate && (
        <>
          <div className="flex justify-between">
            <span className="text-neutral-400">Estimated network fee:</span>
            <span className="text-gray-900">{estimate.fee}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Total:</span>
            <span className="font-medium text-gray-900">{estimate.total}</span>
          </div>
        </>
      )}
      <div className="flex justify-between text-xs">
        <span className="text-neutral-400">Fee rate:</span>
        <span className="text-gray-500">{currentFee} PRL/kB</span>
      </div>
    </div>
  );
}
