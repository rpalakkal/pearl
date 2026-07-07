import {useNavigate} from 'react-router-dom';
import {Download, Plus, Usb, Wallet} from 'lucide-react';
import {Button} from '@/components/ui/button';

// Rendered at /wallet when account enumeration finished with zero accounts
// (e.g. after forgetting the last hardware account). Staying inside the app
// shell keeps the switcher, network selector, and settings reachable.
export function EmptyAccountsState() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto inline-flex rounded-2xl bg-gray-200 p-4">
          <Wallet className="h-10 w-10 text-gray-500" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Add your first account</h1>
          <p className="mt-1 text-sm text-gray-600">
            Create a new wallet, restore one from its recovery phrase, or connect a hardware
            device.
          </p>
        </div>
        <div className="space-y-2">
          <Button type="button" className="w-full" onClick={() => navigate('/onboarding/create')}>
            <Plus className="h-4 w-4" />
            Create new wallet
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate('/import-account')}
          >
            <Download className="h-4 w-4" />
            Import from recovery phrase
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate('/onboarding/connect-hardware')}
          >
            <Usb className="h-4 w-4" />
            Connect hardware wallet
          </Button>
        </div>
      </div>
    </div>
  );
}
