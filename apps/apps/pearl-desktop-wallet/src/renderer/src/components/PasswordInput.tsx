import {useState} from 'react';
import {Eye, EyeOff} from 'lucide-react';
import {cn} from '@/lib/utils';

// Password field with a show/hide toggle — the pattern previously duplicated
// across the lock, setup, and change-password screens.
export function PasswordInput({
  value,
  onChange,
  placeholder = 'Password',
  autoFocus = false,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn(
          'focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white py-3 pl-4 pr-12 text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 disabled:opacity-50',
          className
        )}
      />
      <button
        type="button"
        onClick={() => setVisible(current => !current)}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 transition-colors hover:text-gray-600"
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
