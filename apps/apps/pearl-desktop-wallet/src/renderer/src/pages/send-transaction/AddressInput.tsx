import { AlertCircle } from 'lucide-react';
import { PasteButton } from '@/components/ui/paste-button';
import { AddressBookControl } from '../../components/contact-book/AddressBookControl';

type AddressInputProps = {
  address: string;
  onChange: (value: string) => void;
  error?: string | null;
  onBlur?: () => void;
};

export default function AddressInput({ address, onChange, error, onBlur }: AddressInputProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-neutral-400">Recipient Address</label>
      <div className="relative">
        {/* A wrapping textarea (kept newline-free) so the whole address is
            visible at once; Enter still submits like a plain input. */}
        <textarea
          value={address}
          rows={address.length > 40 ? 2 : 1}
          onChange={e => onChange(e.target.value.replace(/\s+/g, ''))}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          onBlur={onBlur}
          placeholder="Insert a recipient address"
          className="focus:border-brand-green focus:ring-brand-green/20 w-full resize-none break-all rounded-lg border border-gray-300 bg-white py-3 pl-4 pr-11 font-mono text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2"
        />
        <PasteButton
          className="absolute right-2 top-2.5"
          onPaste={text => {
            onChange(text);
            onBlur?.(); // fire blur validation on the pasted value
          }}
        />
      </div>
      <AddressBookControl address={address} onSelect={onChange} />
      {error && (
        <div className="mt-1 flex items-center gap-1 rounded border border-red-700/30 px-2 py-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
