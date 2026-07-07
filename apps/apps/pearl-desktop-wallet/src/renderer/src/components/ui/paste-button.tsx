import {useEffect, useRef, useState} from 'react';
import {AlertCircle, ClipboardPaste} from 'lucide-react';
import {cn} from '@/lib/utils';

export function PasteButton({
  onPaste,
  className,
  disabled = false,
}: {
  onPaste: (text: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        onPaste(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      setFailed(true);
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setFailed(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void paste()}
      disabled={disabled}
      title="Paste from clipboard"
      className={cn(
        'flex-shrink-0 rounded-md p-1.5 transition-colors hover:bg-gray-100 disabled:opacity-50',
        className
      )}
    >
      {failed ? (
        <AlertCircle className="h-4 w-4 text-red-500" />
      ) : (
        <ClipboardPaste className="h-4 w-4 text-gray-600" />
      )}
    </button>
  );
}
