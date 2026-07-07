import {useEffect, useMemo, useRef, useState} from 'react';
import {
  formatSatsAsPearl,
  getBitcoinDeviceDisplayAddress,
  getHardwareWalletErrorMessage,
  getHardwareWalletProviderName,
  parsePearlAmountToSats,
  preloadHardwareWalletSupport,
  previewHardwarePearlSend,
  verifyHardwareWalletAddress,
  type HardwareWalletAddress,
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
} from '../../pages/hardware-wallet/pageModel.ts';
import {
  broadcastApprovedHardwareSend,
  prepareHardwareSendReview,
  signHardwareSendFromReview,
  PENDING_OUTGOING_HARDWARE_SEND_MESSAGE,
} from '../../pages/hardware-wallet/sendWorkflow.ts';
import {
  useHardwareSendFormState,
  type RecipientContext,
} from '../../pages/hardware-wallet/useHardwareSendFormState.ts';
import {useHardwareWalletBalanceState} from '../../pages/hardware-wallet/useHardwareWalletBalanceState.ts';
import type {HardwareWalletBalanceData} from '../../pages/hardware-wallet/balanceData.ts';
import type {
  HardwareWalletBalanceModel,
  HardwareWalletReceiveModel,
  HardwareWalletSendModel,
  SendPreviewState,
} from '../../pages/hardware-wallet/viewModel.ts';
import {evaluateSendGate, satsToPearlInput} from '../../lib/sendGate.ts';
import {useAddressBook} from '../../components/contact-book/useAddressBook.ts';
import {useContactsStore} from '../../store/contactsStore.ts';
import {getErrorMessage} from '../../lib/utils.ts';
import type {AddressBackfillStatus, RecipientSendStatus} from '../../../../types/app-bridge.ts';

async function fetchHardwareWalletBalanceData(
  account: HardwareWalletAddress
): Promise<HardwareWalletBalanceData> {
  return window.appBridge.hardwareWallet.getBalance({
    address: account.address,
    publicKey: account.publicKey,
    network: account.network,
  });
}

export interface HardwareAccountActions {
  applyTestAmount: () => void;
  approveBroadcast: () => void;
  backfillHardwareAddress: () => void;
  beginSendReview: () => void;
  cancelSendStage: () => void;
  confirmSignTransaction: () => void;
  copyToClipboard: (text: string) => void;
  loadHardwareWalletBalance: (account: HardwareWalletAddress) => void;
  setSendAddress: (value: string) => void;
  setSendAmount: (value: string) => void;
  verifyReceiveAddress: () => void;
}

export interface HardwareAccountState {
  balance: HardwareWalletBalanceModel | null;
  receive: HardwareWalletReceiveModel | null;
  send: HardwareWalletSendModel | null;
  actions: HardwareAccountActions;
  hasPendingDeviceOperation: boolean;
  isSending: boolean;
  // Refreshes balance + fee rate for the current account.
  refresh: () => void;
}

/**
 * Account-scoped hardware wallet state: balance, staged send, verify, and
 * backfill for one HardwareWalletAddress. Owns no vendor/index selection —
 * the account comes in as a prop (from the account switcher or the legacy
 * hardware page). Passing a different account resets all per-account state.
 *
 * `externalDeviceBusy` folds page-level device operations (the onboarding
 * connect ceremony) into hasPendingDeviceOperation.
 */
export function useHardwareAccount(
  account: HardwareWalletAddress | null,
  options: {externalDeviceBusy?: boolean} = {}
): HardwareAccountState {
  const accountKey = account ? hardwareAccountKey(account) : null;
  const accountKeyRef = useRef<string | null>(accountKey);
  accountKeyRef.current = accountKey;

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

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedDeviceAddress, setVerifiedDeviceAddress] = useState<string | null>(null);
  const [isVerifyingAddress, setIsVerifyingAddress] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<AddressBackfillStatus | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillStalled, setBackfillStalled] = useState(false);
  const backfillProgressRef = useRef<{height: number; changedAt: number} | null>(null);
  const [feeRate, setFeeRate] = useState(0.0001);

  const hasPendingDeviceOperation =
    isSending || isVerifyingAddress || (options.externalDeviceBusy ?? false);

  const isActiveHardwareAccount = (candidate: HardwareWalletAddress): boolean =>
    accountKeyRef.current === hardwareAccountKey(candidate);

  // Warm up the device transport modules so the first sign/verify prompt is
  // fast.
  useEffect(() => {
    preloadHardwareWalletSupport();
  }, []);

  // Account switched (or cleared): drop all per-account state and load fresh.
  useEffect(() => {
    invalidateBalanceRequests();
    clearHardwareBalance();
    resetSendState(true);
    setVerifyError(null);
    setVerifiedDeviceAddress(null);
    setBackfillStatus(null);
    setBackfillError(null);
    setBackfillStalled(false);
    backfillProgressRef.current = null;
    setCopiedAddress(false);

    if (account) {
      void loadHardwareWalletBalance(account);
      void loadFeeRate(account.network);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

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
        {network, error: getErrorLogMessage(error)},
        'warn'
      );
    }
  };

  const refreshFeeRateForSend = async (
    forAccount: HardwareWalletAddress
  ): Promise<number | null> => {
    try {
      const estimatedFeeRate = Number(
        await window.appBridge.wallet.estimateFee(1, forAccount.network)
      );
      if (Number.isFinite(estimatedFeeRate) && estimatedFeeRate > 0) {
        logHardwareWalletEvent('send:fee-rate-refreshed', {
          network: forAccount.network,
          feeRatePrlPerKb: estimatedFeeRate.toFixed(8),
        });
        return estimatedFeeRate;
      }
    } catch (error) {
      console.error('Failed to refresh hardware wallet fee rate:', error);
      logHardwareWalletEvent(
        'send:fee-rate-refresh-error',
        {...hardwareAccountLogContext(forAccount), error: getErrorLogMessage(error)},
        'warn'
      );
    }
    return null;
  };

  // ---- Derived balance model ----

  const hasPendingOutgoingHardwareSpend = useMemo(
    () => hasPendingOutgoingHardwareTransaction(addressInfo),
    [addressInfo]
  );
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
  const pendingBalanceSats = useMemo(
    () => getHardwareBalanceSats(addressInfo?.unconfirmedBalance),
    [addressInfo?.unconfirmedBalance]
  );
  const pendingBalanceIsOutgoing = pendingBalanceSats < 0n;
  const hasPendingUtxos = useMemo(
    () => utxos.some(utxo => isPendingHardwareUtxo(utxo) && getHardwareUtxoValue(utxo) > 0n),
    [utxos]
  );

  const connectedLabel = account ? getHardwareWalletProviderName(account.vendor) : 'Device';
  const activeSendNetwork: PearlNetwork = account?.network ?? 'mainnet';

  const receiveDeviceDisplayAddress = useMemo(() => {
    if (!account) {
      return null;
    }
    return getBitcoinDeviceDisplayAddress(account.address, account.network);
  }, [account]);

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
    if (!account || !sendAmount.trim() || !sendAddress.trim()) {
      return {preview: null, error: null};
    }
    if (hasPendingOutgoingHardwareSpend) {
      return {preview: null, error: PENDING_OUTGOING_HARDWARE_SEND_MESSAGE};
    }
    try {
      return {
        preview: previewHardwarePearlSend({
          account,
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
  }, [account, feeRate, hasPendingOutgoingHardwareSpend, sendAddress, sendAmount, utxos]);

  // ---- Backfill ----

  const isBackfillInFlight =
    backfillStatus !== null &&
    (backfillStatus.status === 'queued' || backfillStatus.status === 'running');

  useEffect(() => {
    if (!isBackfillInFlight || !backfillStatus) {
      return;
    }

    const address = backfillStatus.address;
    const STALL_AFTER_MS = 20_000;
    const interval = setInterval(async () => {
      try {
        const status = await window.appBridge.wallet.getRescanStatus(address);
        setBackfillStatus(status);

        // A genesis rescan downloads compact filters from network peers; when
        // peers are flaky the height stops moving. Surface that instead of
        // showing a silently frozen progress bar.
        const progress = backfillProgressRef.current;
        if (!progress || progress.height !== status.currentHeight) {
          backfillProgressRef.current = {height: status.currentHeight, changedAt: Date.now()};
          setBackfillStalled(false);
        } else if (status.status === 'running' && Date.now() - progress.changedAt > STALL_AFTER_MS) {
          setBackfillStalled(true);
        }

        if (status.status === 'complete' && account?.address === address) {
          void loadHardwareWalletBalance(account);
        }
      } catch (error) {
        setBackfillStatus(null);
        setBackfillStalled(false);
        setBackfillError(
          getErrorMessage(error, 'Lost track of the backfill; it can be restarted.')
        );
      }
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBackfillInFlight, backfillStatus?.address, accountKey]);

  const backfillHardwareAddress = async () => {
    if (!account || hasPendingDeviceOperation || isBackfillInFlight) {
      return;
    }

    setBackfillError(null);
    setBackfillStalled(false);
    backfillProgressRef.current = null;
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
        {...hardwareAccountLogContext(account), error: getErrorLogMessage(error)},
        'error'
      );
      setBackfillError(getErrorMessage(error, 'Failed to start backfill.'));
    }
  };

  // ---- Verify on device ----

  const verifyReceiveAddress = async () => {
    if (!account) {
      return;
    }

    setIsVerifyingAddress(true);
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
        {...hardwareAccountLogContext(account), error: getErrorLogMessage(error)},
        'error'
      );
      setVerifyError(getHardwareWalletErrorMessage(error, account.vendor));
    } finally {
      setIsVerifyingAddress(false);
    }
  };

  // ---- Staged send ----

  const beginSendReview = async (amountOverride?: string) => {
    if (!account || hasPendingDeviceOperation) {
      return;
    }
    if (sendStage.step !== 'edit' && amountOverride === undefined) {
      return;
    }

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
    if (!account || sendStage.step !== 'review' || sendStage.recipient.gate.blocked) {
      return;
    }

    const {review, recipient} = sendStage;
    dispatchSendStage({type: 'sign-started'});
    setIsSending(true);

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

      const contact = recipient.known?.contact;
      if (contact && !contact.firstVerifiedAt) {
        updateContact(contact.id, {firstVerifiedAt: Date.now()}).catch(error => {
          console.error('Failed to record contact verification date:', error);
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const approveBroadcast = async () => {
    if (!account || sendStage.step !== 'signed') {
      return;
    }

    const {snapshot} = sendStage;
    dispatchSendStage({type: 'broadcast-started'});
    setIsSending(true);

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
      setIsSending(false);
    }
  };

  const cancelSendStage = () => {
    if (sendStage.step === 'signed') {
      logHardwareWalletEvent(
        'send:abandoned-signed',
        account ? hardwareAccountLogContext(account) : {},
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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (error) {
      console.error('Failed to copy hardware wallet address:', error);
    }
  };

  // ---- Models (existing panel prop shapes) ----

  const balance: HardwareWalletBalanceModel | null = account
    ? {
        backfill: backfillStatus,
        backfillError,
        backfillStalled,
        balanceError,
        balanceSource,
        canBackfill: balanceSource === 'oyster',
        hardwareAddress: account,
        hasPendingDeviceOperation,
        isLoadingBalance,
        pendingBalanceIsOutgoing,
        pendingBalanceLabel: pendingBalanceIsOutgoing ? 'Pending Send' : 'Pending',
        pendingBalanceNotice: hasPendingOutgoingHardwareSpend
          ? PENDING_OUTGOING_HARDWARE_SEND_MESSAGE
          : hasPendingUtxos
            ? 'UTXOs are excluded from hardware wallet sends until local Oyster reports them confirmed.'
            : null,
        pendingBalanceValue: isLoadingBalance
          ? 'Loading'
          : formatSatsAsPearl(pendingBalanceIsOutgoing ? -pendingBalanceSats : pendingBalanceSats),
        spendableBalanceSats,
        spendableUtxoCount,
      }
    : null;

  const receive: HardwareWalletReceiveModel | null = account
    ? {
        connectedLabel,
        copiedAddress,
        hardwareAddress: account,
        hasPendingDeviceOperation,
        isVerifyingAddress,
        receiveDeviceDisplayAddress,
        verifiedDeviceAddress,
        verifyError,
      }
    : null;

  const send: HardwareWalletSendModel | null = account
    ? {
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
      }
    : null;

  return {
    balance,
    receive,
    send,
    hasPendingDeviceOperation,
    isSending,
    refresh: () => {
      if (account) {
        void loadHardwareWalletBalance(account);
        void loadFeeRate(account.network);
      }
    },
    actions: {
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
      copyToClipboard: text => {
        void copyToClipboard(text);
      },
      loadHardwareWalletBalance: target => {
        void loadHardwareWalletBalance(target);
      },
      setSendAddress,
      setSendAmount,
      verifyReceiveAddress: () => {
        void verifyReceiveAddress();
      },
    },
  };
}
