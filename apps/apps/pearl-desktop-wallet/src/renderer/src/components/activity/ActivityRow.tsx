import {ArrowDownLeft, ArrowUpRight, ExternalLink, UserRoundPlus} from 'lucide-react';
import {CopyButton} from '@/components/ui/copy-button';
import {KnownAddressBadge} from '../contact-book/AddressBookControl';
import {explorerTxUrl} from '../../lib/explorer';
import type {KnownAddress} from '../contact-book/useAddressBook';
import type {Transaction} from '../../../../types/transaction';
import type {AppNetwork} from '../../../../types/app-bridge';

// Whether tx.address is the other party or one of our own addresses:
// hardware/indexer rows always carry the counterparty; software rows carry
// the counterparty only for sends (received rows hold our receiving address).
export type ActivityAddressRole = 'counterparty' | 'own';

const formatTimeAgo = (timestamp: number): string => {
  const diff = Math.max(0, Date.now() - timestamp);

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else {
    return `${days}d ago`;
  }
};

const formatFullDate = (timestamp: number): string => new Date(timestamp).toLocaleString();

const truncateTxId = (txid: string): string => {
  if (txid.length <= 16) return txid;
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
};

const truncateAddress = (address: string): string => {
  if (address.length <= 24) return address;
  return `${address.slice(0, 14)}…${address.slice(-8)}`;
};

export function ActivityRow({
  tx,
  network,
  addressRole,
  resolved,
  onAddContact,
}: {
  tx: Transaction;
  network: AppNetwork;
  addressRole: ActivityAddressRole;
  resolved: KnownAddress | null;
  onAddContact: (address: string) => void;
}) {
  const isPending = tx.confirmations === 0;
  const addressLabel =
    addressRole === 'own' ? 'Received at' : tx.type === 'received' ? 'From' : 'To';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
            {tx.type === 'received' ? (
              <ArrowDownLeft className="text-brand-green h-6 w-6" />
            ) : (
              <ArrowUpRight className="h-6 w-6 text-red-500" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-gray-900">
                {tx.selfTransfer ? 'Sent to self' : tx.type === 'received' ? 'Received' : 'Sent'}
              </span>
              {isPending && (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Pending
                </span>
              )}
            </div>
            <div className="text-sm text-gray-600">
              {formatTimeAgo(tx.time)} • {formatFullDate(tx.time)}
            </div>
            {tx.address && !tx.selfTransfer && (
              <div className="mt-1 flex items-center gap-2">
                <span className="truncate font-mono text-xs text-gray-500">
                  {addressLabel}: {truncateAddress(tx.address)}
                </span>
                <CopyButton
                  value={tx.address}
                  className="rounded p-1"
                  iconClassName="h-3 w-3"
                  title="Copy address"
                />
                {resolved ? (
                  <KnownAddressBadge entry={resolved} />
                ) : addressRole === 'counterparty' ? (
                  <button
                    type="button"
                    onClick={() => onAddContact(tx.address)}
                    className="inline-flex flex-shrink-0 items-center gap-1 text-xs text-gray-400 underline-offset-2 transition-colors hover:text-green-700 hover:underline"
                    title="Save this address as a contact"
                  >
                    <UserRoundPlus className="h-3 w-3" />
                    Save
                  </button>
                ) : null}
              </div>
            )}
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-gray-500">Tx ID: {truncateTxId(tx.txid)}</span>
              <CopyButton
                value={tx.txid}
                className="rounded p-1"
                iconClassName="h-3 w-3"
                title="Copy transaction ID"
              />
              <button
                onClick={() =>
                  window.appBridge.window.openExternal(explorerTxUrl(tx.txid, network))
                }
                className="rounded p-1 transition-colors hover:bg-gray-100"
                title="View on prlscan.com"
              >
                <ExternalLink className="h-3 w-3 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div
            className={`text-lg font-bold ${
              tx.type === 'received' ? 'text-green-700' : 'text-red-500'
            }`}
          >
            {tx.type === 'received' ? '+' : '-'}
            {tx.amount} PRL
          </div>
          <div className="text-sm text-gray-600">
            {isPending ? 'unconfirmed' : `${tx.confirmations} confirmations`}
          </div>
          {tx.fee > 0 && <div className="text-xs text-gray-500">Fee: {tx.fee.toFixed(8)} PRL</div>}
        </div>
      </div>
    </div>
  );
}
