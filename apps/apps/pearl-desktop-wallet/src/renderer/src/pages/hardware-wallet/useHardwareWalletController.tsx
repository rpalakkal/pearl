import {useEffect, useMemo, useRef, useState} from 'react';
import {HardDrive, Usb} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {
  connectHardwareWallet,
  DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX,
  getHardwareWalletErrorMessage,
  getPearlHardwareWalletPath,
  normalizeHardwareWalletAddressIndex,
  normalizePearlNetwork,
  preloadHardwareWalletSupport,
  type HardwareWalletAddress,
  type HardwareWalletVendor,
  type PearlNetwork,
} from '../../lib/hardwareWallet';
import {
  compactHardwareAddress,
  getErrorLogMessage,
  hardwareAccountLogContext,
  logHardwareWalletEvent,
} from './pageModel.ts';
import {
  forgetStoredHardwareAccount,
  getHardwareAddressSelectorOptions,
  getNextHardwareWalletAddressIndex,
  listStoredHardwareAccounts,
  readStoredHardwareAccount,
  saveLastHardwareWalletSelection,
  saveStoredHardwareAccount,
} from '../../lib/hardwareWalletStorage';
import type {
  HardwareWalletVendorOption,
  HardwareWalletViewActions,
  HardwareWalletViewProps,
} from './viewModel.ts';
import {useHardwareAccount} from '../../hooks/hardware/useHardwareAccount.ts';

interface NetworkInfo {
  currentNetwork: string;
  networkConfig: {
    displayName: string;
  };
}

const vendors: HardwareWalletVendorOption[] = [
  {vendor: 'ledger', label: 'Ledger', icon: Usb},
  {vendor: 'trezor', label: 'Trezor', icon: HardDrive},
];

/**
 * Legacy hardware page controller: owns vendor/address-index selection, the
 * connect ceremony, and remembered-account bookkeeping. All account-scoped
 * state (balance, staged send, verify, backfill) lives in useHardwareAccount.
 */
export function useHardwareWalletController(): HardwareWalletViewProps {
  const navigate = useNavigate();
  const hasRestoredInitialHardwareAccountRef = useRef(false);
  const [selectedVendor, setSelectedVendor] = useState<HardwareWalletVendor>('ledger');
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(
    DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
  );
  const [storedAccountsVersion, setStoredAccountsVersion] = useState(0);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [hardwareAddress, setHardwareAddress] = useState<HardwareWalletAddress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRememberedAccount, setIsRememberedAccount] = useState(false);

  const hardwareAccount = useHardwareAccount(hardwareAddress, {
    externalDeviceBusy: isConnecting,
  });
  const {hasPendingDeviceOperation} = hardwareAccount;

  const pearlNetwork = normalizePearlNetwork(networkInfo?.currentNetwork ?? 'mainnet');
  const derivationPath = useMemo(
    () => getPearlHardwareWalletPath(pearlNetwork, selectedVendor, selectedAddressIndex),
    [pearlNetwork, selectedAddressIndex, selectedVendor]
  );
  const rememberedHardwareAccounts = useMemo(() => {
    return listStoredHardwareAccounts(pearlNetwork, selectedVendor);
  }, [pearlNetwork, selectedVendor, storedAccountsVersion]);
  const addressSelectorOptions = useMemo(() => {
    return getHardwareAddressSelectorOptions(
      rememberedHardwareAccounts,
      hardwareAddress,
      selectedVendor,
      pearlNetwork,
      selectedAddressIndex
    );
  }, [
    hardwareAddress,
    pearlNetwork,
    rememberedHardwareAccounts,
    selectedAddressIndex,
    selectedVendor,
  ]);
  const selectedAddressOption =
    addressSelectorOptions.find(option => option.addressIndex === selectedAddressIndex) ?? null;
  const selectedAddressSummary = selectedAddressOption?.account
    ? compactHardwareAddress(selectedAddressOption.account.address)
    : 'Not connected';
  const selectedAddressPath = selectedAddressOption?.account?.path ?? derivationPath;
  const nextAddressIndex = useMemo(() => {
    return getNextHardwareWalletAddressIndex(rememberedHardwareAccounts);
  }, [rememberedHardwareAccounts]);
  const selectedLabel = vendors.find(option => option.vendor === selectedVendor)?.label ?? 'Device';

  const refreshStoredHardwareAccounts = () => {
    setStoredAccountsVersion(version => version + 1);
  };

  // Account-scoped state resets inside useHardwareAccount when the account
  // prop changes; activation here is just selection bookkeeping.
  const activateHardwareAccount = (
    account: HardwareWalletAddress,
    options: {
      rememberSelection?: boolean;
      selectAccount?: boolean;
      source: 'connected' | 'remembered';
    }
  ) => {
    if (options.selectAccount ?? true) {
      setSelectedVendor(account.vendor);
      setSelectedAddressIndex(account.addressIndex);
    }

    setHardwareAddress(account);
    setIsRememberedAccount(options.source === 'remembered');
    setErrorMessage(null);

    if (options.rememberSelection) {
      saveLastHardwareWalletSelection(account.network, account.vendor, account.addressIndex);
      refreshStoredHardwareAccounts();
    }

    if (options.source === 'remembered') {
      logHardwareWalletEvent('account:restored', hardwareAccountLogContext(account));
    }
  };

  const activateStoredHardwareAccount = (
    network: PearlNetwork,
    vendor: HardwareWalletVendor,
    addressIndex: number
  ) => {
    const rememberedAccount = readStoredHardwareAccount(network, vendor, addressIndex);

    if (!rememberedAccount) {
      setHardwareAddress(null);
      setIsRememberedAccount(false);
      setErrorMessage(null);
      return;
    }

    activateHardwareAccount(rememberedAccount, {
      rememberSelection: true,
      selectAccount: false,
      source: 'remembered',
    });
  };

  useEffect(() => {
    logHardwareWalletEvent('page:mounted');
    preloadHardwareWalletSupport();
    void loadNetworkInfo();
  }, []);

  useEffect(() => {
    if (!networkInfo) {
      return;
    }

    if (!hasRestoredInitialHardwareAccountRef.current) {
      hasRestoredInitialHardwareAccountRef.current = true;
      const rememberedAccount = readStoredHardwareAccount(pearlNetwork);

      if (!rememberedAccount) {
        return;
      }

      activateHardwareAccount(rememberedAccount, {source: 'remembered'});
      return;
    }

    if (!hardwareAddress || hardwareAddress.network === pearlNetwork) {
      return;
    }

    const rememberedAccount = readStoredHardwareAccount(
      pearlNetwork,
      selectedVendor,
      selectedAddressIndex
    );

    if (!rememberedAccount) {
      setHardwareAddress(null);
      setIsRememberedAccount(false);
      return;
    }

    activateHardwareAccount(rememberedAccount, {source: 'remembered'});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareAddress, networkInfo, pearlNetwork, selectedAddressIndex, selectedVendor]);

  const loadNetworkInfo = async () => {
    try {
      const info = await window.appBridge.manager.getNetworkInfo();
      setNetworkInfo(info);
      logHardwareWalletEvent('network:loaded', {
        network: normalizePearlNetwork(info.currentNetwork),
      });
    } catch (error) {
      console.error('Failed to load network info:', error);
      logHardwareWalletEvent('network:fallback', {network: 'mainnet'}, 'warn');
      setNetworkInfo({
        currentNetwork: 'mainnet',
        networkConfig: {displayName: 'Mainnet'},
      });
    }
  };

  const connectDevice = async () => {
    const vendor = selectedVendor;
    const network = pearlNetwork;
    const addressIndex = selectedAddressIndex;

    setIsConnecting(true);
    setHardwareAddress(null);
    setIsRememberedAccount(false);
    setErrorMessage(null);
    logHardwareWalletEvent('connect:start', {
      vendor,
      network,
      addressIndex,
      path: getPearlHardwareWalletPath(network, vendor, addressIndex),
    });

    try {
      const address = await connectHardwareWallet(vendor, network, addressIndex);
      saveStoredHardwareAccount(address);
      refreshStoredHardwareAccounts();
      logHardwareWalletEvent('connect:success', hardwareAccountLogContext(address));
      activateHardwareAccount(address, {source: 'connected'});
    } catch (error) {
      console.error('Failed to connect hardware wallet:', error);
      logHardwareWalletEvent(
        'connect:error',
        {
          vendor,
          network,
          error: getErrorLogMessage(error),
        },
        'error'
      );
      setErrorMessage(getHardwareWalletErrorMessage(error, vendor));
    } finally {
      setIsConnecting(false);
    }
  };

  const selectVendor = (vendor: HardwareWalletVendor) => {
    if (hasPendingDeviceOperation) {
      return;
    }

    setSelectedVendor(vendor);
    logHardwareWalletEvent('vendor:selected', {
      vendor,
      network: pearlNetwork,
      addressIndex: selectedAddressIndex,
      path: getPearlHardwareWalletPath(pearlNetwork, vendor, selectedAddressIndex),
    });
    activateStoredHardwareAccount(pearlNetwork, vendor, selectedAddressIndex);
  };

  const selectAddressIndex = (addressIndexValue: number) => {
    if (hasPendingDeviceOperation) {
      return;
    }

    let addressIndex: number;

    try {
      addressIndex = normalizeHardwareWalletAddressIndex(addressIndexValue);
    } catch {
      return;
    }

    if (addressIndex === selectedAddressIndex) {
      return;
    }

    setSelectedAddressIndex(addressIndex);
    logHardwareWalletEvent('address-index:selected', {
      vendor: selectedVendor,
      network: pearlNetwork,
      addressIndex,
      path: getPearlHardwareWalletPath(pearlNetwork, selectedVendor, addressIndex),
    });
    activateStoredHardwareAccount(pearlNetwork, selectedVendor, addressIndex);
  };

  const addHardwareAddress = () => {
    if (hasPendingDeviceOperation || nextAddressIndex === null) {
      return;
    }

    selectAddressIndex(nextAddressIndex);
  };

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  const forgetHardwareAccount = () => {
    if (hardwareAddress) {
      logHardwareWalletEvent('account:forgotten', hardwareAccountLogContext(hardwareAddress));
      forgetStoredHardwareAccount(
        hardwareAddress.network,
        hardwareAddress.vendor,
        hardwareAddress.addressIndex
      );
      refreshStoredHardwareAccounts();
    }

    setHardwareAddress(null);
    setIsRememberedAccount(false);
    setErrorMessage(null);
  };

  const actions: HardwareWalletViewActions = {
    ...hardwareAccount.actions,
    addHardwareAddress,
    connectDevice: () => {
      void connectDevice();
    },
    forgetHardwareAccount,
    goBack,
    selectAddressIndex,
    selectVendor,
  };

  const connectedLabel =
    vendors.find(option => option.vendor === hardwareAddress?.vendor)?.label ?? selectedLabel;

  return {
    actions,
    model: {
      addressSelector: {
        hasPendingDeviceOperation,
        nextAddressIndex,
        options: addressSelectorOptions,
        selectedAddressIndex,
        selectedAddressPath,
        selectedAddressSummary,
      },
      connectedWallet:
        hardwareAddress && hardwareAccount.balance && hardwareAccount.receive && hardwareAccount.send
          ? {
              balance: hardwareAccount.balance,
              details: {
                connectedLabel,
                hardwareAddress,
                isRememberedAccount,
              },
              receive: hardwareAccount.receive,
              send: hardwareAccount.send,
            }
          : null,
      connection: {
        errorMessage,
        isConnecting,
      },
      header: {
        derivationPath,
        hasPendingDeviceOperation,
        networkDisplayName: networkInfo?.networkConfig.displayName ?? 'Mainnet',
      },
      vendor: {
        hasPendingDeviceOperation,
        selectedLabel,
        selectedVendor,
        vendors,
      },
    },
  };
}
