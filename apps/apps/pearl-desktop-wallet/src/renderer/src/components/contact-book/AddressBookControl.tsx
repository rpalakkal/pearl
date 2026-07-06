import {useState} from 'react';
import {BookUser, UserRound, UserRoundPlus, Wallet} from 'lucide-react';
import {AddressBookDialog} from './AddressBookDialog';
import {useAddressBook, type KnownAddress} from './useAddressBook';

function KnownAddressBadge({entry}: {entry: KnownAddress}) {
  const isContact = entry.source === 'contact';
  const Icon = isContact ? UserRound : Wallet;
  const text = isContact ? `Contact: ${entry.label}` : entry.label;
  return (
    <div
      className={`inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-xs ${
        isContact
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-blue-200 bg-blue-50 text-blue-800'
      }`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  );
}

/**
 * Row rendered under a recipient address input: opens the address book to pick
 * a saved recipient, recognizes known addresses (contacts, the wallet's own
 * addresses, and remembered hardware wallet accounts) and offers to save
 * unknown ones.
 */
export function AddressBookControl({
  address,
  onSelect,
  disabled,
}: {
  address: string;
  onSelect: (address: string) => void;
  disabled?: boolean;
}) {
  const [dialogMode, setDialogMode] = useState<'list' | 'add' | null>(null);
  const {resolveAddress} = useAddressBook();

  const trimmedAddress = address.trim();
  const resolved = resolveAddress(trimmedAddress);

  return (
    <>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {resolved ? (
            <KnownAddressBadge entry={resolved} />
          ) : trimmedAddress ? (
            <button
              type="button"
              onClick={() => setDialogMode('add')}
              disabled={disabled}
              className="inline-flex items-center gap-1 text-xs text-gray-500 underline-offset-2 transition-colors hover:text-green-700 hover:underline disabled:opacity-50"
            >
              <UserRoundPlus className="h-3 w-3" />
              Save to contacts
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setDialogMode('list')}
          disabled={disabled}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
        >
          <BookUser className="h-3.5 w-3.5" />
          Address book
        </button>
      </div>

      <AddressBookDialog
        isOpen={dialogMode !== null}
        onClose={() => setDialogMode(null)}
        onSelect={onSelect}
        initialMode={dialogMode ?? 'list'}
        initialAddress={trimmedAddress}
      />
    </>
  );
}
