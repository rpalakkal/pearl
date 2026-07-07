import {useEffect, useMemo, useRef, useState} from 'react';
import {HardDrive, Usb} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {
  connectHardwareWallet,
  DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX,
  formatSatsAsPearl,
  getBitcoinDeviceDisplayAddress,
  getHardwareWalletErrorMessage,
  getPearlHardwareWalletPath,
  normalizeHardwareWalletAddressIndex,
  normalizePearlNetwork,
  parsePearlAmountToSats,
  preloadHardwareWalletSupport,
  previewHardwarePearlSend,
  verifyHardwareWalletAddress,
  type HardwareWalletAddress,
  type HardwareWalletVendor,
  type PearlNetwork,
} from '../../lib/hardwareWallet';
import {
  compactHardwareAddress,
  getErrorLogMessage,
  getHardwareBalanceSats,
  getHardwareUtxoValue,
  getSpendableHardwareUtxoValue,
  hardwareAccountKey,
  hardwareAccountLogContext,
  hardwareBalanceLogContext,
  hasPendingOutgoingHardwareTransaction,
  isPendingHardwareUtxo,
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
  SendPreviewState,
} from './viewModel.ts';
import type {AddressBackfillStatus} from '../../../../types/app-bridge.ts';
import {getErrorMessage} from '../../lib/utils.ts';
import {
  broadcastApprovedHardwareSend,
  prepareHardwareSendReview,
  signHardwareSendFromReview,
  PENDING_OUTGOING_HARDWARE_SEND_MESSAGE,
} from './sendWorkflow.ts';
import {useHardwareSendFormState, type RecipientContext} from './useHardwareSendFormState.ts';
import {evaluateSendGate, satsToPearlInput} from '../../lib/sendGate.ts';
import {useAddressBook} from '../../components/contact-book/useAddressBook.ts';
import {useContactsStore} from '../../store/contactsStore.ts';
import type {RecipientSendStatus} from '../../../../types/app-bridge.ts';
import {useHardwareWalletBalanceState} from './useHardwareWalletBalanceState.ts';
import {useHardwareWalletOperationState} from './useHardwareWalletOperationState.ts';
import type {HardwareWalletBalanceData} from './balanceData.ts';

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

export function useHardwareWalletController(): HardwareWalletViewProps {
  const navigate = useNavigate();
  const activeHardwareAccountKeyRef = useRef<string | null>(null);
  const hasRestoredInitialHardwareAccountRef = useRef(false);
  const [selectedVendor, setSelectedVendor] = useState<HardwareWalletVendor>('ledger');
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(
    DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
  );
  const [storedAccountsVersion, setStoredAccountsVersion] = useState(0);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [hardwareAddress, setHardwareAddress] = useState<HardwareWalletAddress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {
    addressInfo,
    balanceError,
    balanceSource,
    clearHardwareBalance,
    invalidateBalanceRequests,
    isLoadingBalance,
    loadHardwareWalletBalance,
    setBalanceError,
    setHardwareBalanceData,
    utxos,
  } = useHardwareWalletBalanceState(fetchHardwareWalletBalanceData);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const {
    dispatchSendStage,
    lastSendFee,
    resetSendState,
    sendAddress,
    sendAmount,
    sendError,
    sendStage,
    sendSuccess,
    setLastSendFee,
    setSendAddress,
    setSendAmount,
  } = useHardwareSendFormState();
  const {resolveAddress} = useAddressBook();
  const updateContact = useContactsStore(state => state.updateContact);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedDeviceAddress, setVerifiedDeviceAddress] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<AddressBackfillStatus | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [isRememberedAccount, setIsRememberedAccount] = useState(false);
  const [feeRate, setFeeRate] = useState(0.0001);
  const {
    finishConnecting,
    finishSending,
    finishVerifyingAddress,
    hasPendingDeviceOperation,
    isConnecting,
    isSending,
    isVerifyingAddress,
    startConnecting,
    startSending,
    startVerifyingAddress,
  } = useHardwareWalletOperationState();

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
  const activeSendNetwork = hardwareAddress?.network ?? pearlNetwork;
  const selectedLabel = vendors.find(option => option.vendor === selectedVendor)?.label ?? 'Device';
  const connectedLabel =
    vendors.find(option => option.vendor === hardwareAddress?.vendor)?.label ?? selectedLabel;
  const receiveDeviceDisplayAddress = useMemo(() => {
    if (!hardwareAddress) {
      return null;
    }

    return getBitcoinDeviceDisplayAddress(hardwareAddress.address, hardwareAddress.network);
  }, [hardwareAddress]);
  const hasPendingOutgoingHardwareSpend = useMemo(() => {
    return hasPendingOutgoingHardwareTransaction(addressInfo);
  }, [addressInfo]);
  const {spendableBalanceSats, spendableUtxoCount} = useMemo(() => {
    let balance = 0n;
    let count = 0;

    if (!hasPendingOutgoingHardwareSpend) {
      for (const utxo of utxos) {
        const value = getSpendableHardwareUtxoValue(utxo);
        if (value > 0n) {
          balance += value;
          count += 1;
        }
      }
    }

    return {spendableBalanceSats: balance, spendableUtxoCount: count};
  }, [hasPendingOutgoingHardwareSpend, utxos]);
  const pendingBalanceSats = useMemo(() => {
    return getHardwareBalanceSats(addressInfo?.unconfirmedBalance);
  }, [addressInfo?.unconfirmedBalance]);
  const pendingBalanceIsOutgoing = pendingBalanceSats < 0n;
  const pendingBalanceLabel = pendingBalanceIsOutgoing ? 'Pending Send' : 'Pending';
  const pendingBalanceValue = isLoadingBalance
    ? 'Loading'
    : formatSatsAsPearl(pendingBalanceIsOutgoing ? -pendingBalanceSats : pendingBalanceSats);
  const hasPendingUtxos = useMemo(() => {
    return utxos.some(utxo => isPendingHardwareUtxo(utxo) && getHardwareUtxoValue(utxo) > 0n);
  }, [utxos]);
  const pendingBalanceNotice = hasPendingOutgoingHardwareSpend
    ? PENDING_OUTGOING_HARDWARE_SEND_MESSAGE
    : hasPendingUtxos
      ? 'UTXOs are excluded from hardware wallet sends until local Oyster reports them confirmed.'
      : null;
  const deviceDisplayAddress = useMemo(() => {
    if (!sendAddress.trim()) {
      return null;
    }

    try {
      return getBitcoinDeviceDisplayAddress(sendAddress.trim(), activeSendNetwork);
    } catch {
      return null;
    }
  }, [activeSendNetwork, sendAddress]);
  const sendPreview = useMemo<SendPreviewState>(() => {
    if (!hardwareAddress || !sendAmount.trim() || !sendAddress.trim()) {
      return {preview: null, error: null};
    }

    if (hasPendingOutgoingHardwareSpend) {
      return {preview: null, error: PENDING_OUTGOING_HARDWARE_SEND_MESSAGE};
    }

    try {
      return {
        preview: previewHardwarePearlSend({
          account: hardwareAddress,
          destinationAddress: sendAddress.trim(),
          amountSats: parsePearlAmountToSats(sendAmount),
          feeRatePrlPerKb: feeRate,
          utxos,
        }),
        error: null,
      };
    } catch (error) {
      return {
        preview: null,
        error: error instanceof Error ? error.message : 'Unable to prepare transaction preview.',
      };
    }
  }, [feeRate, hardwareAddress, hasPendingOutgoingHardwareSpend, sendAddress, sendAmount, utxos]);

  const updateHardwareAddress = (account: HardwareWalletAddress | null) => {
    activeHardwareAccountKeyRef.current = account ? hardwareAccountKey(account) : null;
    setHardwareAddress(account);
  };

  const refreshStoredHardwareAccounts = () => {
    setStoredAccountsVersion(version => version + 1);
  };

  const clearDeviceFeedback = () => {
    setErrorMessage(null);
    setBalanceError(null);
    resetSendState(true);
    setVerifyError(null);
    setVerifiedDeviceAddress(null);
    setBackfillStatus(null);
    setBackfillError(null);
  };

  const resetActiveHardwareAccount = () => {
    invalidateBalanceRequests();
    updateHardwareAddress(null);
    clearHardwareBalance();
    clearDeviceFeedback();
    setIsRememberedAccount(false);
  };

  const activateHardwareAccount = (
    account: HardwareWalletAddress,
    options: {
      rememberSelection?: boolean;
      selectAccount?: boolean;
      source: 'connected' | 'remembered';
    }
  ): Promise<void> => {
    if (options.selectAccount ?? true) {
      setSelectedVendor(account.vendor);
      setSelectedAddressIndex(account.addressIndex);
    }

    updateHardwareAddress(account);
    setIsRememberedAccount(options.source === 'remembered');
    clearDeviceFeedback();

    if (options.rememberSelection) {
      saveLastHardwareWalletSelection(account.network, account.vendor, account.addressIndex);
      refreshStoredHardwareAccounts();
    }

    if (options.source === 'remembered') {
      logHardwareWalletEvent('account:restored', hardwareAccountLogContext(account));
    }

    return loadHardwareWalletBalance(account);
  };

  const activateStoredHardwareAccount = (
    network: PearlNetwork,
    vendor: HardwareWalletVendor,
    addressIndex: number
  ) => {
    const rememberedAccount = readStoredHardwareAccount(network, vendor, addressIndex);

    if (!rememberedAccount) {
      resetActiveHardwareAccount();
      return;
    }

    void activateHardwareAccount(rememberedAccount, {
      rememberSelection: true,
      selectAccount: false,
      source: 'remembered',
    });
  };

  const isActiveHardwareAccount = (account: HardwareWalletAddress): boolean => {
    return activeHardwareAccountKeyRef.current === hardwareAccountKey(account);
  };

  useEffect(() => {
    activeHardwareAccountKeyRef.current = hardwareAddress
      ? hardwareAccountKey(hardwareAddress)
      : null;
  }, [hardwareAddress]);

  useEffect(() => {
    logHardwareWalletEvent('page:mounted');
    preloadHardwareWalletSupport();
    void loadNetworkInfo();
  }, []);

  useEffect(() => {
    void loadFeeRate(pearlNetwork);
  }, [pearlNetwork]);

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

      void activateHardwareAccount(rememberedAccount, {source: 'remembered'});
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
      resetActiveHardwareAccount();
      return;
    }

    void activateHardwareAccount(rememberedAccount, {source: 'remembered'});
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

    startConnecting();
    resetActiveHardwareAccount();
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
      await activateHardwareAccount(address, {source: 'connected'});
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
      finishConnecting();
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

  const isBackfillInFlight =
    backfillStatus !== null &&
    (backfillStatus.status === 'queued' || backfillStatus.status === 'running');

  // Poll a queued/running backfill and refresh the balance when it completes
  // so newly discovered UTXOs show up.
  useEffect(() => {
    if (!isBackfillInFlight || !backfillStatus) {
      return;
    }

    const address = backfillStatus.address;
    const interval = setInterval(async () => {
      try {
        const status = await window.appBridge.wallet.getRescanStatus(address);
        setBackfillStatus(status);

        if (status.status === 'complete' && hardwareAddress?.address === address) {
          void loadHardwareWalletBalance(hardwareAddress);
        }
      } catch (error) {
        // The wallet stopped or restarted; job state lives in the wallet
        // process, so the backfill can simply be started again.
        setBackfillStatus(null);
        setBackfillError(
          getErrorMessage(error, 'Lost track of the backfill; it can be restarted.')
        );
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isBackfillInFlight, backfillStatus?.address, hardwareAddress]);

  const backfillHardwareAddress = async () => {
    if (!hardwareAddress || hasPendingDeviceOperation || isBackfillInFlight) {
      return;
    }

    const account = hardwareAddress;
    setBackfillError(null);
    logHardwareWalletEvent('backfill:start', hardwareAccountLogContext(account));

    try {
      const status = await window.appBridge.wallet.rescanAddress(
        account.address,
        0,
        account.publicKey
      );

      if (!isActiveHardwareAccount(account)) {
        return;
      }

      setBackfillStatus(status);
    } catch (error) {
      if (!isActiveHardwareAccount(account)) {
        return;
      }

      console.error('Failed to start hardware address backfill:', error);
      logHardwareWalletEvent(
        'backfill:error',
        {
          ...hardwareAccountLogContext(account),
          error: getErrorLogMessage(error),
        },
        'error'
      );
      setBackfillError(getErrorMessage(error, 'Failed to start backfill.'));
    }
  };

  const loadFeeRate = async (network: PearlNetwork) => {
    try {
      const nextFeeRate = Number(await window.appBridge.wallet.estimateFee(1, network));

      if (Number.isFinite(nextFeeRate) && nextFeeRate > 0) {
        setFeeRate(nextFeeRate);
        logHardwareWalletEvent('fee-rate:loaded', {
          network,
          feeRatePrlPerKb: nextFeeRate.toFixed(8),
        });
      }
    } catch (error) {
      console.error('Failed to load hardware wallet fee rate:', error);
      logHardwareWalletEvent(
        'fee-rate:error',
        {
          network,
          error: getErrorLogMessage(error),
        },
        'warn'
      );
    }
  };

  async function fetchHardwareWalletBalanceData(
    account: HardwareWalletAddress
  ): Promise<HardwareWalletBalanceData> {
    return window.appBridge.hardwareWallet.getBalance({
      address: account.address,
      publicKey: account.publicKey,
      network: account.network,
    });
  }

  const refreshFeeRateForSend = async (account: HardwareWalletAddress): Promise<number | null> => {
    try {
      const estimatedFeeRate = Number(
        await window.appBridge.wallet.estimateFee(1, account.network)
      );

      if (Number.isFinite(estimatedFeeRate) && estimatedFeeRate > 0) {
        logHardwareWalletEvent('send:fee-rate-refreshed', {
          network: account.network,
          feeRatePrlPerKb: estimatedFeeRate.toFixed(8),
        });
        return estimatedFeeRate;
      }
    } catch (error) {
      console.error('Failed to refresh hardware wallet fee rate:', error);
      logHardwareWalletEvent(
        'send:fee-rate-refresh-error',
        {
          ...hardwareAccountLogContext(account),
          error: getErrorLogMessage(error),
        },
        'warn'
      );
    }

    return null;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (error) {
      console.error('Failed to copy hardware wallet address:', error);
    }
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

    resetActiveHardwareAccount();
  };

  const verifyReceiveAddress = async () => {
    if (!hardwareAddress) {
      return;
    }

    const account = hardwareAddress;
    startVerifyingAddress();
    setVerifyError(null);
    setVerifiedDeviceAddress(null);
    logHardwareWalletEvent('verify:start', hardwareAccountLogContext(account));

    try {
      const verification = await verifyHardwareWalletAddress(account);
      if (!isActiveHardwareAccount(account)) {
        return;
      }

      setVerifiedDeviceAddress(verification.deviceDisplayAddress);
      logHardwareWalletEvent('verify:success', {
        ...hardwareAccountLogContext(account),
        deviceDisplayAddress: compactHardwareAddress(verification.deviceDisplayAddress),
      });
    } catch (error) {
      if (!isActiveHardwareAccount(account)) {
        return;
      }

      console.error('Failed to verify hardware wallet address:', error);
      logHardwareWalletEvent(
        'verify:error',
        {
          ...hardwareAccountLogContext(account),
          error: getErrorLogMessage(error),
        },
        'error'
      );
      setVerifyError(getHardwareWalletErrorMessage(error, account.vendor));
    } finally {
      finishVerifyingAddress();
    }
  };

  const beginSendReview = async (amountOverride?: string) => {
    if (!hardwareAddress || hasPendingDeviceOperation) {
      return;
    }
    // With an override amount (the test-send shortcut) the closure may still
    // see the pre-cancel stage; the reducer's own guards keep transitions
    // legal in that case.
    if (sendStage.step !== 'edit' && amountOverride === undefined) {
      return;
    }

    const account = hardwareAddress;
    dispatchSendStage({type: 'review-preparing'});

    const result = await prepareHardwareSendReview({
      account,
      amountInput: amountOverride ?? sendAmount,
      recipientInput: sendAddress,
      feeRatePrlPerKb: feeRate,
      utxos,
      estimateFeeRate: () => refreshFeeRateForSend(account),
      fetchBalanceData: fetchHardwareWalletBalanceData,
      isActiveHardwareAccount,
    });

    if (result.status === 'stale') {
      return;
    }

    if (result.status === 'error') {
      if (result.balance) {
        setHardwareBalanceData(result.balance);
      }
      if (result.feeRate) {
        setFeeRate(result.feeRate);
      }
      dispatchSendStage({type: 'stage-invalidated', message: result.message});
      return;
    }

    setHardwareBalanceData(result.balance);
    setFeeRate(result.review.feeRatePrlPerKb);

    // Recipient context: recognition, prior send history, and the gate. A
    // failed history lookup counts as no history so the gate fails closed.
    let history: RecipientSendStatus | null = null;
    try {
      history = await window.appBridge.sendHistory.getRecipientStatus(
        result.review.destinationAddress,
        account.network
      );
    } catch (error) {
      console.error('Failed to look up recipient send history:', error);
    }

    if (!isActiveHardwareAccount(account)) {
      return;
    }

    // Spendable balance from the same snapshot the preview was built on.
    let spendableSats = 0n;
    for (const utxo of result.review.utxos) {
      spendableSats += getSpendableHardwareUtxoValue(utxo);
    }

    const recipient: RecipientContext = {
      known: resolveAddress(result.review.destinationAddress),
      history,
      gate: evaluateSendGate({
        amountSats: result.review.amountSats,
        spendableBalanceSats: spendableSats,
        recipient: {hasConfirmedSend: history?.hasConfirmedSend ?? false},
      }),
    };

    if (recipient.gate.blocked) {
      logHardwareWalletEvent(
        'send:gate-blocked',
        {
          ...hardwareAccountLogContext(account),
          amountSats: result.review.amountSats.toString(),
          recipient: compactHardwareAddress(result.review.destinationAddress),
        },
        'warn'
      );
    }

    dispatchSendStage({type: 'review-prepared', review: result.review, recipient});
  };

  const confirmSignTransaction = async () => {
    if (!hardwareAddress || sendStage.step !== 'review' || sendStage.recipient.gate.blocked) {
      return;
    }

    const {review, recipient} = sendStage;
    dispatchSendStage({type: 'sign-started'});
    startSending();

    try {
      const result = await signHardwareSendFromReview({
        review,
        fetchBalanceData: fetchHardwareWalletBalanceData,
        isActiveHardwareAccount,
      });

      if (result.status === 'stale') {
        return;
      }

      if (result.status === 'invalidated') {
        if (result.balance) {
          setHardwareBalanceData(result.balance);
        }
        dispatchSendStage({type: 'stage-invalidated', message: result.message});
        return;
      }

      if (result.status === 'error') {
        dispatchSendStage({type: 'sign-failed', message: result.message});
        return;
      }

      dispatchSendStage({type: 'sign-completed', snapshot: result.snapshot});

      // First device-verified send to this contact: remember when.
      const contact = recipient.known?.contact;
      if (contact && !contact.firstVerifiedAt) {
        updateContact(contact.id, {firstVerifiedAt: Date.now()}).catch(error => {
          console.error('Failed to record contact verification date:', error);
        });
      }
    } finally {
      finishSending();
    }
  };

  const approveBroadcast = async () => {
    if (!hardwareAddress || sendStage.step !== 'signed') {
      return;
    }

    const {snapshot} = sendStage;
    dispatchSendStage({type: 'broadcast-started'});
    startSending();

    try {
      const result = await broadcastApprovedHardwareSend({
        snapshot,
        broadcastHardwareTransaction: request =>
          window.appBridge.hardwareWallet.broadcastTransaction(request),
        fetchBalanceData: fetchHardwareWalletBalanceData,
        isActiveHardwareAccount,
      });

      if (result.status === 'stale') {
        return;
      }

      if (result.status === 'invalidated') {
        if (result.balance) {
          setHardwareBalanceData(result.balance);
        }
        dispatchSendStage({type: 'stage-invalidated', message: result.message});
        return;
      }

      if (result.status === 'error') {
        dispatchSendStage({type: 'broadcast-failed', message: result.message});
        return;
      }

      setLastSendFee(formatSatsAsPearl(result.feeSats));
      dispatchSendStage({type: 'broadcast-succeeded', txid: result.txid});

      if (result.balance) {
        setHardwareBalanceData(result.balance);
        logHardwareWalletEvent('send:balance-refreshed', {
          ...hardwareAccountLogContext(snapshot.review.account),
          ...hardwareBalanceLogContext(result.balance.info, result.balance.utxos),
        });
      } else {
        setBalanceError('Transaction broadcast. Refresh balance to update local Oyster status.');
      }
    } finally {
      finishSending();
    }
  };

  const cancelSendStage = () => {
    if (sendStage.step === 'signed') {
      // The signed transaction is discarded from memory, but the signature
      // remains technically valid until its inputs move on-chain.
      logHardwareWalletEvent(
        'send:abandoned-signed',
        hardwareAddress ? hardwareAccountLogContext(hardwareAddress) : {},
        'warn'
      );
    }
    dispatchSendStage({type: 'stage-cancelled'});
  };

  const applyTestAmount = () => {
    if (sendStage.step !== 'review' || !sendStage.recipient.gate.blocked) {
      return;
    }

    const testAmount = satsToPearlInput(sendStage.recipient.gate.suggestedTestAmountSats);
    logHardwareWalletEvent('send:gate-test-amount', {amount: testAmount});
    dispatchSendStage({type: 'stage-cancelled'});
    setSendAmount(testAmount);
    void beginSendReview(testAmount);
  };

  const actions: HardwareWalletViewActions = {
    addHardwareAddress,
    applyTestAmount,
    approveBroadcast: () => {
      void approveBroadcast();
    },
    backfillHardwareAddress: () => {
      void backfillHardwareAddress();
    },
    beginSendReview: () => {
      void beginSendReview();
    },
    cancelSendStage,
    confirmSignTransaction: () => {
      void confirmSignTransaction();
    },
    connectDevice: () => {
      void connectDevice();
    },
    copyToClipboard: text => {
      void copyToClipboard(text);
    },
    forgetHardwareAccount,
    goBack,
    loadHardwareWalletBalance: account => {
      void loadHardwareWalletBalance(account);
    },
    selectAddressIndex,
    selectVendor,
    setSendAddress,
    setSendAmount,
    verifyReceiveAddress: () => {
      void verifyReceiveAddress();
    },
  };

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
      connectedWallet: hardwareAddress
        ? {
            balance: {
              backfill: backfillStatus,
              backfillError,
              balanceError,
              balanceSource,
              canBackfill: balanceSource === 'oyster',
              hardwareAddress,
              hasPendingDeviceOperation,
              isLoadingBalance,
              pendingBalanceIsOutgoing,
              pendingBalanceLabel,
              pendingBalanceNotice,
              pendingBalanceValue,
              spendableBalanceSats,
              spendableUtxoCount,
            },
            details: {
              connectedLabel,
              hardwareAddress,
              isRememberedAccount,
            },
            receive: {
              connectedLabel,
              copiedAddress,
              hardwareAddress,
              hasPendingDeviceOperation,
              isVerifyingAddress,
              receiveDeviceDisplayAddress,
              verifiedDeviceAddress,
              verifyError,
            },
            send: {
              activeSendNetwork,
              connectedLabel,
              deviceDisplayAddress,
              feeRate,
              hasPendingDeviceOperation,
              isSending,
              lastSendFee,
              sendAddress,
              sendAmount,
              sendError,
              sendPreview,
              sendStage,
              sendSuccess,
            },
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
