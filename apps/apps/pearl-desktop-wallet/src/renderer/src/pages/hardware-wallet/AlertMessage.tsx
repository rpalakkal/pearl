import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

export function AlertMessage({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'warning';
}) {
  const className = tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-amber-200 bg-amber-50 text-amber-900';
  const iconClassName = tone === 'error'
    ? 'text-red-600'
    : 'text-amber-600';

  return (
    <div className={`rounded-lg border p-3 text-sm ${className}`}>
      <div className="flex gap-3">
        <AlertTriangle className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconClassName}`} />
        <p>{children}</p>
      </div>
    </div>
  );
}
