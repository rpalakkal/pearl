import { CheckCircle2, ExternalLink, UserRoundPlus } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { useAddressBook } from '../../components/contact-book/useAddressBook';
import { AddressBookDialog } from '../../components/contact-book/AddressBookDialog';

type SuccessBannerProps = {
  message: string;
  txid: string;
  formatTxid: (txid: string) => string;
  explorerUrl?: string | null;
  recipientAddress?: string | null;
};

export default function SuccessBanner({
  message,
  txid,
  formatTxid,
  explorerUrl = null,
  recipientAddress = null,
}: SuccessBannerProps) {
  const { resolveAddress } = useAddressBook();
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);

  const canSaveRecipient =
    recipientAddress !== null && resolveAddress(recipientAddress) === null;

  return (
    <div className="rounded-lg border-2 border-green-500 bg-green-50 p-4 shadow-md">
      <div className="mb-3 flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-600" />
        <span className="text-lg font-semibold text-green-900">{message}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 flex-col">
          <span className="mb-1 text-xs text-gray-600">Transaction ID</span>
          <span className="font-mono text-sm text-gray-900">{formatTxid(txid)}</span>
        </div>
        <CopyButton value={txid} className="ml-3 rounded-lg p-2" title="Copy transaction ID" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {explorerUrl && (
          <button
            type="button"
            onClick={() => window.appBridge.window.openExternal(explorerUrl)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-800 shadow-sm transition-colors hover:bg-green-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on prlscan
          </button>
        )}
        {canSaveRecipient && (
          <button
            type="button"
            onClick={() => setIsAddContactOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-800 shadow-sm transition-colors hover:bg-green-100"
          >
            <UserRoundPlus className="h-3.5 w-3.5" />
            Save recipient to contacts
          </button>
        )}
      </div>
      {recipientAddress && (
        <AddressBookDialog
          isOpen={isAddContactOpen}
          onClose={() => setIsAddContactOpen(false)}
          initialMode="add"
          initialAddress={recipientAddress}
        />
      )}
    </div>
  );
}
