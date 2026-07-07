import {useEffect, useRef, useState} from 'react';
import {CheckCircle2, Copy} from 'lucide-react';
import {cn} from '@/lib/utils';

export function CopyButton({
  value,
  className,
  iconClassName = 'h-5 w-5',
  title = 'Copy to clipboard',
}: {
  value: string;
  className?: string;
  iconClassName?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={title}
      className={cn(
        'flex-shrink-0 rounded-md p-1.5 transition-colors hover:bg-gray-100',
        className
      )}
    >
      {copied ? (
        <CheckCircle2 className={cn('text-brand-green', iconClassName)} />
      ) : (
        <Copy className={cn('text-gray-600', iconClassName)} />
      )}
    </button>
  );
}
