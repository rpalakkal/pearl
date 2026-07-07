import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpCircle, BookUser, Key, Network, RefreshCw, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';
import { PeerSettingsModal } from './PeerSettingsModal';
import { useUpdateStatus, openReleasePage } from '../hooks/useUpdateStatus';
import { useActiveAccount } from '../store/accountsStore';

// Routes outside the app lock, where navigation targets like /contacts and
// /change-password (which live inside the shell) are unavailable.
const LOCKED_ROUTES = ['/', '/unlock', '/setup'];

export function SettingsButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [isPeerModalOpen, setIsPeerModalOpen] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const updateStatus = useUpdateStatus();
  const active = useActiveAccount();
  const isLockedContext = LOCKED_ROUTES.includes(pathname);

  useEffect(() => {
    Promise.resolve(window.appBridge.window.getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  async function checkForUpdates() {
    setIsCheckingUpdates(true);
    try {
      const status = await window.appBridge.update.checkForUpdates();
      if (status.severity === 'none') {
        toast({ title: "You're up to date", description: `Pearl Wallet v${status.localVersion}` });
      } else {
        toast({
          title: `Update available: v${status.latestVersion}`,
          description: 'Open the release page from the settings menu to upgrade.',
        });
      }
    } catch (error) {
      console.error('Manual update check failed:', error);
      toast({ title: 'Update check failed', description: 'Try again later.' });
    } finally {
      setIsCheckingUpdates(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-white">
          <DropdownMenuItem onSelect={() => setIsPeerModalOpen(true)}>
            <Network className="h-4 w-4" />
            Peer settings
          </DropdownMenuItem>
          {!isLockedContext && (
            <DropdownMenuItem onSelect={() => navigate('/contacts')}>
              <BookUser className="h-4 w-4" />
              Contacts
            </DropdownMenuItem>
          )}
          {!isLockedContext && active?.kind === 'software' && (
            <DropdownMenuItem onSelect={() => navigate('/change-password')}>
              <Key className="h-4 w-4" />
              Change app password
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isCheckingUpdates} onSelect={() => void checkForUpdates()}>
            <RefreshCw className={`h-4 w-4 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
            Check for updates
          </DropdownMenuItem>
          {updateStatus && updateStatus.severity !== 'none' && (
            <DropdownMenuItem onSelect={() => void openReleasePage()}>
              <ArrowUpCircle className="h-4 w-4 text-green-600" />
              Upgrade to v{updateStatus.latestVersion}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-gray-400">
            Pearl Wallet {version ? `v${version}` : ''}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      <PeerSettingsModal isOpen={isPeerModalOpen} onClose={() => setIsPeerModalOpen(false)} />
    </>
  );
}
