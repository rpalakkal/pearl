import {useState} from 'react';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {ContactBookPanel, type ContactBookView} from './ContactBookPanel';

export {deriveBtcDisplayAddress, truncateAddress} from './ContactBookPanel';

interface AddressBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (address: string) => void;
  initialMode?: 'list' | 'add';
  initialAddress?: string;
}

// Thin dialog wrapper around ContactBookPanel, used as the picker in the
// send flows. Radix portals the content to <body>, so it never nests inside
// a send <form>. Unmounting on close resets the panel's state.
export function AddressBookDialog({
  isOpen,
  onClose,
  onSelect,
  initialMode = 'list',
  initialAddress = '',
}: AddressBookDialogProps) {
  const [view, setView] = useState<ContactBookView>(initialMode);

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col gap-0 bg-white p-0">
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <DialogTitle className="text-xl font-bold text-gray-900">
            {view === 'add' ? 'Add Contact' : view === 'edit' ? 'Edit Contact' : 'Address Book'}
          </DialogTitle>
        </DialogHeader>

        <ContactBookPanel
          onSelect={
            onSelect
              ? address => {
                  onSelect(address);
                  onClose();
                }
              : undefined
          }
          initialMode={initialMode}
          initialAddress={initialAddress}
          onViewChange={setView}
        />
      </DialogContent>
    </Dialog>
  );
}
