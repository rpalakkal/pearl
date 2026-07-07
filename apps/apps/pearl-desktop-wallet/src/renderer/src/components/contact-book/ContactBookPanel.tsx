import {useEffect, useState} from 'react';
import {AlertCircle, Pencil, Search, Trash2, UserPlus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {CopyButton} from '@/components/ui/copy-button';
import {getErrorMessage} from '@/lib/utils';
import {getBitcoinDeviceDisplayAddress} from '../../lib/hardwareWallet.ts';
import {useContactsStore} from '../../store/contactsStore';
import {useAddressBook, validatePearlAddress, type KnownAddress} from './useAddressBook';
import type {Contact} from '../../../../types/app-bridge';

export type ContactBookView = 'list' | 'add' | 'edit';

type PanelView = {mode: 'list'} | {mode: 'add'} | {mode: 'edit'; contact: Contact};

export function truncateAddress(address: string): string {
  if (address.length <= 24) {
    return address;
  }
  return `${address.slice(0, 14)}…${address.slice(-8)}`;
}

// The BTC-form address a hardware device would display for this Pearl
// address. Derived, never stored; null when the address is not a valid
// Pearl Taproot address on either network.
export function deriveBtcDisplayAddress(address: string): string | null {
  for (const network of ['mainnet', 'testnet'] as const) {
    try {
      return getBitcoinDeviceDisplayAddress(address.trim(), network);
    } catch {
      // try the next network
    }
  }
  return null;
}

// The contact book's full management surface: search, list, add/edit forms.
// Shared by the AddressBookDialog (picker in the send flows) and the
// standalone /contacts page.
export function ContactBookPanel({
  onSelect,
  initialMode = 'list',
  initialAddress = '',
  showMyAddresses = true,
  onViewChange,
}: {
  onSelect?: (address: string) => void;
  initialMode?: 'list' | 'add';
  initialAddress?: string;
  showMyAddresses?: boolean;
  onViewChange?: (mode: ContactBookView) => void;
}) {
  const {addContact, updateContact, removeContact} = useContactsStore();
  const {contactEntries, myAddressEntries} = useAddressBook();

  const [view, setView] = useState<PanelView>(
    initialMode === 'add' ? {mode: 'add'} : {mode: 'list'}
  );
  const [search, setSearch] = useState('');
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState(initialMode === 'add' ? initialAddress : '');
  const [formNotes, setFormNotes] = useState('');
  const [formPublicKey, setFormPublicKey] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    onViewChange?.(view.mode);
  }, [view.mode, onViewChange]);

  const searchText = search.trim().toLowerCase();
  const matchesSearch = (entry: KnownAddress) =>
    !searchText ||
    entry.label.toLowerCase().includes(searchText) ||
    entry.address.toLowerCase().includes(searchText);

  const filteredContacts = contactEntries.filter(matchesSearch);
  const filteredMyAddresses = showMyAddresses ? myAddressEntries.filter(matchesSearch) : [];

  function openAddForm() {
    setView({mode: 'add'});
    setFormName('');
    setFormAddress('');
    setFormNotes('');
    setFormPublicKey('');
    setFormError(null);
  }

  function openEditForm(contact: Contact) {
    setView({mode: 'edit', contact});
    setFormName(contact.name);
    setFormAddress(contact.address);
    setFormNotes(contact.notes ?? '');
    setFormPublicKey(contact.publicKey ?? '');
    setFormError(null);
  }

  function selectAddress(address: string) {
    onSelect?.(address);
  }

  async function handleDelete(contactId: string) {
    if (pendingDeleteId !== contactId) {
      setPendingDeleteId(contactId);
      return;
    }
    try {
      await removeContact(contactId);
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to delete contact'));
    } finally {
      setPendingDeleteId(null);
    }
  }

  async function handleSave() {
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Please enter a name for this contact');
      return;
    }
    if (!formAddress.trim()) {
      setFormError('Please enter an address');
      return;
    }

    setIsSaving(true);
    try {
      const isValid = await validatePearlAddress(formAddress);
      if (!isValid) {
        setFormError('Invalid Pearl address format');
        return;
      }

      if (view.mode === 'edit') {
        await updateContact(view.contact.id, {
          name: formName,
          address: formAddress,
          notes: formNotes,
          publicKey: formPublicKey,
        });
      } else {
        await addContact(formName, formAddress, {notes: formNotes, publicKey: formPublicKey});
      }
      setView({mode: 'list'});
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to save contact'));
    } finally {
      setIsSaving(false);
    }
  }

  const isFormView = view.mode === 'add' || view.mode === 'edit';

  if (isFormView) {
    return (
      <form
        className="space-y-4 p-6"
        onSubmit={event => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input
            type="text"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="e.g. Alice"
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Pearl Address</label>
          <input
            type="text"
            value={formAddress}
            onChange={e => setFormAddress(e.target.value)}
            placeholder="prl1..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
          {(() => {
            const btcDisplayAddress = formAddress.trim()
              ? deriveBtcDisplayAddress(formAddress)
              : null;
            return btcDisplayAddress ? (
              <div className="mt-1 text-xs text-gray-500">
                Hardware devices display this as{' '}
                <span className="break-all font-mono">{btcDisplayAddress}</span>
              </div>
            ) : null;
          })()}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Notes <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            value={formNotes}
            onChange={e => setFormNotes(e.target.value)}
            placeholder="e.g. cold storage, exchange deposit…"
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Public Key <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={formPublicKey}
            onChange={e => setFormPublicKey(e.target.value)}
            placeholder="hex encoded secp256k1 key"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>

        {view.mode === 'edit' && view.contact.firstVerifiedAt && (
          <div className="text-xs text-gray-500">
            First verified on a hardware send:{' '}
            {new Date(view.contact.firstVerifiedAt).toLocaleDateString()}
          </div>
        )}

        {formError && (
          <div className="flex items-center gap-1 rounded border border-red-700/30 px-2 py-1 text-xs text-red-500">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={isSaving}
            onClick={() => setView({mode: 'list'})}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1 bg-green-600 hover:bg-green-700"
            disabled={isSaving || !formName.trim() || !formAddress.trim()}
          >
            {isSaving ? 'Saving...' : 'Save Contact'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-6 pt-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or address"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </div>
        <Button type="button" className="bg-green-600 hover:bg-green-700" onClick={openAddForm}>
          <UserPlus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {formError && (
        <div className="mx-6 mt-3 flex items-center gap-1 rounded border border-red-700/30 px-2 py-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Contacts
          </h3>
          {filteredContacts.length === 0 ? (
            <p className="text-sm text-gray-500">
              {contactEntries.length === 0
                ? 'No contacts yet. Add one to reuse addresses when sending Pearl.'
                : 'No contacts match your search.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredContacts.map(entry => {
                const contact = entry.contact!;
                return (
                  <li
                    key={contact.id}
                    className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-gray-200 hover:bg-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => selectAddress(contact.address)}
                      className={`min-w-0 flex-1 text-left ${onSelect ? '' : 'cursor-default'}`}
                      title={contact.address}
                    >
                      <div className="truncate text-sm font-medium text-gray-900">
                        {contact.name}
                      </div>
                      <div className="truncate font-mono text-xs text-gray-500">
                        {truncateAddress(contact.address)}
                      </div>
                    </button>
                    <CopyButton
                      value={contact.address}
                      className="p-1.5"
                      iconClassName="h-4 w-4"
                      title="Copy address"
                    />
                    <button
                      type="button"
                      onClick={() => openEditForm(contact)}
                      title="Edit contact"
                      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(contact.id)}
                      title={
                        pendingDeleteId === contact.id
                          ? 'Click again to confirm'
                          : 'Delete contact'
                      }
                      className={`rounded p-1.5 transition-colors ${
                        pendingDeleteId === contact.id
                          ? 'bg-red-100 text-red-600 hover:bg-red-200'
                          : 'text-gray-400 hover:bg-gray-200 hover:text-red-600'
                      }`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {filteredMyAddresses.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              My Addresses
            </h3>
            <ul className="space-y-1">
              {filteredMyAddresses.map(entry => (
                <li key={entry.address} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => selectAddress(entry.address)}
                    className={`min-w-0 flex-1 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-gray-200 hover:bg-gray-50 ${onSelect ? '' : 'cursor-default'}`}
                    title={entry.address}
                  >
                    <div className="truncate text-sm font-medium text-gray-900">
                      {entry.label}
                    </div>
                    <div className="truncate font-mono text-xs text-gray-500">
                      {truncateAddress(entry.address)}
                    </div>
                  </button>
                  <CopyButton
                    value={entry.address}
                    className="p-1.5"
                    iconClassName="h-4 w-4"
                    title="Copy address"
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
