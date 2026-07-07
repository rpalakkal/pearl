import { useState, useEffect } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@pearl/ui/components/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface NetworkInfo {
    currentNetwork: string;
    availableNetworks: string[];
    networkConfig: {
        name: string;
        displayName: string;
        addressPrefix: string;
    };
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export function NetworkSelector() {
    const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
    // Selection awaiting confirmation. The Select stays controlled by
    // currentNetwork, so cancelling simply snaps it back.
    const [pendingNetwork, setPendingNetwork] = useState<string | null>(null);
    const [isChanging, setIsChanging] = useState(false);

    useEffect(() => {
        loadNetworkInfo();
    }, []);

    const loadNetworkInfo = async () => {
        try {
            const info = await window.appBridge.manager.getNetworkInfo();
            setNetworkInfo(info);
        } catch (error) {
            console.error('Failed to load network info:', error);
        }
    };

    const confirmNetworkChange = async () => {
        if (!pendingNetwork || isChanging) return;

        setIsChanging(true);
        try {
            await window.appBridge.manager.setNetwork(pendingNetwork);

            window.location.hash = '#/';
            window.location.reload();
        } catch (error) {
            console.error('Failed to change network:', error);
            setIsChanging(false);
            setPendingNetwork(null);
        }
    };

    if (!networkInfo) {
        return null;
    }

    const isTestnet = networkInfo.currentNetwork === 'testnet';

    return (
        <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Network:</span>
            <Select
                value={networkInfo.currentNetwork}
                onValueChange={network => {
                    if (network !== networkInfo.currentNetwork) {
                        setPendingNetwork(network);
                    }
                }}
                disabled={isChanging}
            >
                <SelectTrigger
                    className={`w-[140px] ${isTestnet ? 'border-amber-400 bg-amber-50 text-amber-800' : ''}`}
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {networkInfo.availableNetworks.map((network) => (
                        <SelectItem key={network} value={network}>
                            {capitalize(network)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <AlertDialog
                open={pendingNetwork !== null}
                onOpenChange={open => {
                    if (!open && !isChanging) {
                        setPendingNetwork(null);
                    }
                }}
            >
                <AlertDialogContent className="bg-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Switch to {pendingNetwork ? capitalize(pendingNetwork) : ''}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            The app will reload and reconnect on {pendingNetwork}. Your accounts on{' '}
                            {networkInfo.currentNetwork} stay saved and reappear when you switch back.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isChanging}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void confirmNetworkChange()} disabled={isChanging}>
                            {isChanging ? 'Switching…' : 'Switch network'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
