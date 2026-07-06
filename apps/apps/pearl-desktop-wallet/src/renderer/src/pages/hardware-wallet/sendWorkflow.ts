import {
  formatSatsAsPearl,
  getHardwareWalletErrorMessage,
  parsePearlAmountToSats,
  previewHardwarePearlSend,
  signHardwarePearlTransaction,
  type HardwareWalletAddress,
  type PearlNetwork,
} from '../../lib/hardwareWallet.ts';
import type {
  BlockbookUtxo,
  HardwareWalletBroadcastRequest,
  HardwareWalletBroadcastResult,
} from '../../../../types/app-bridge.ts';
import {
  compactHardwareAddress,
  getErrorLogMessage,
  hardwareAccountLogContext,
  hardwareBalanceLogContext,
  hardwareSendPreviewLogContext,
  hasPendingOutgoingHardwareTransaction,
  logHardwareWalletEvent,
  sendPreviewsEqual,
} from './pageModel.ts';
import type {HardwareWalletBalanceData} from './balanceData.ts';

export const PENDING_OUTGOING_HARDWARE_SEND_MESSAGE =
  'A hardware wallet transaction is pending. Wait for it to confirm before sending again.';

export interface SendHardwareTransactionWorkflowParams {
  account: HardwareWalletAddress;
  amountInput: string;
  broadcastHardwareTransaction: (
    request: HardwareWalletBroadcastRequest
  ) => Promise<HardwareWalletBroadcastResult>;
  estimateFeeRate: (network: PearlNetwork) => Promise<number | null>;
  feeRatePrlPerKb: number;
  fetchBalanceData: (account: HardwareWalletAddress) => Promise<HardwareWalletBalanceData>;
  isActiveHardwareAccount: (account: HardwareWalletAddress) => boolean;
  recipientInput: string;
  setBalanceData: (balance: HardwareWalletBalanceData) => void;
  setBalanceError: (message: string) => void;
  setFeeRate: (feeRate: number) => void;
  setLastSendFee: (fee: string) => void;
  setSendAddress: (value: string) => void;
  setSendAmount: (value: string) => void;
  setSendError: (message: string) => void;
  setSendSuccess: (txid: string) => void;
  utxos: BlockbookUtxo[];
}

export async function sendHardwareTransactionWorkflow({
  account,
  amountInput,
  broadcastHardwareTransaction,
  estimateFeeRate,
  feeRatePrlPerKb,
  fetchBalanceData,
  isActiveHardwareAccount,
  recipientInput,
  setBalanceData,
  setBalanceError,
  setFeeRate,
  setLastSendFee,
  setSendAddress,
  setSendAmount,
  setSendError,
  setSendSuccess,
  utxos,
}: SendHardwareTransactionWorkflowParams): Promise<void> {
  try {
    const amountSats = parsePearlAmountToSats(amountInput);
    const destinationAddress = recipientInput.trim();
    logHardwareWalletEvent('send:start', {
      ...hardwareAccountLogContext(account),
      amountSats: amountSats.toString(),
      recipient: compactHardwareAddress(destinationAddress),
      feeRatePrlPerKb: feeRatePrlPerKb.toFixed(8),
    });
    const currentPreview = previewHardwarePearlSend({
      account,
      destinationAddress,
      amountSats,
      feeRatePrlPerKb,
      utxos,
    });
    logHardwareWalletEvent('send:preview', hardwareSendPreviewLogContext(currentPreview));
    const latestBalance = await fetchBalanceData(account);

    if (!isActiveHardwareAccount(account)) {
      return;
    }

    if (hasPendingOutgoingHardwareTransaction(latestBalance.info)) {
      setBalanceData(latestBalance);
      logHardwareWalletEvent(
        'send:pending-outgoing',
        {
          ...hardwareAccountLogContext(account),
          ...hardwareBalanceLogContext(latestBalance.info, latestBalance.utxos),
        },
        'warn'
      );
      throw new Error(PENDING_OUTGOING_HARDWARE_SEND_MESSAGE);
    }

    const refreshedFeeRate = await estimateFeeRate(account.network);
    const nextFeeRate = refreshedFeeRate ?? feeRatePrlPerKb;
    const latestPreview = previewHardwarePearlSend({
      account,
      destinationAddress,
      amountSats,
      feeRatePrlPerKb: nextFeeRate,
      utxos: latestBalance.utxos,
    });
    logHardwareWalletEvent('send:refreshed-preview', {
      ...hardwareSendPreviewLogContext(latestPreview),
      ...hardwareBalanceLogContext(latestBalance.info, latestBalance.utxos),
    });

    if (!isActiveHardwareAccount(account)) {
      return;
    }

    setBalanceData(latestBalance);
    setFeeRate(nextFeeRate);

    if (!sendPreviewsEqual(currentPreview, latestPreview)) {
      logHardwareWalletEvent(
        'send:preview-changed',
        {
          beforeFeeSats: currentPreview.feeSats.toString(),
          afterFeeSats: latestPreview.feeSats.toString(),
          beforeInputs: currentPreview.inputCount,
          afterInputs: latestPreview.inputCount,
        },
        'warn'
      );
      throw new Error(
        'Balance or fee estimate changed. Review the updated preview before signing.'
      );
    }

    logHardwareWalletEvent('send:signature-request', hardwareSendPreviewLogContext(latestPreview));
    const signedTransaction = await signHardwarePearlTransaction({
      account,
      destinationAddress,
      amountSats,
      feeRatePrlPerKb: nextFeeRate,
      utxos: latestBalance.utxos,
    });

    if (!isActiveHardwareAccount(account)) {
      return;
    }

    logHardwareWalletEvent('send:signed', {
      ...hardwareAccountLogContext(account),
      feeSats: signedTransaction.feeSats.toString(),
      changeSats: signedTransaction.changeSats.toString(),
      inputs: signedTransaction.inputCount,
    });

    const broadcastResult = await broadcastHardwareTransaction({
      network: account.network,
      rawTransactionHex: signedTransaction.rawTransactionHex,
      sourceAddress: account.address,
      sourcePublicKey: account.publicKey,
    });

    if (!isActiveHardwareAccount(account)) {
      return;
    }

    setSendAmount('');
    setSendAddress('');
    setSendSuccess(broadcastResult.txid);
    setLastSendFee(formatSatsAsPearl(signedTransaction.feeSats));
    logHardwareWalletEvent('send:broadcast', {
      ...hardwareAccountLogContext(account),
      txid: broadcastResult.txid,
      feeSats: signedTransaction.feeSats.toString(),
    });

    if (broadcastResult.balance) {
      setBalanceData(broadcastResult.balance);
      logHardwareWalletEvent('send:balance-refreshed', {
        ...hardwareAccountLogContext(account),
        ...hardwareBalanceLogContext(broadcastResult.balance.info, broadcastResult.balance.utxos),
      });
      return;
    }

    logHardwareWalletEvent(
      'send:balance-refresh-error',
      {
        ...hardwareAccountLogContext(account),
        error: 'Local Oyster balance refresh unavailable after broadcast',
      },
      'warn'
    );
    setBalanceError('Transaction broadcast. Refresh balance to update local Oyster status.');
  } catch (error) {
    if (!isActiveHardwareAccount(account)) {
      return;
    }

    console.error('Failed to send hardware wallet transaction:', error);
    logHardwareWalletEvent(
      'send:error',
      {
        ...hardwareAccountLogContext(account),
        error: getErrorLogMessage(error),
      },
      'error'
    );
    setSendError(getHardwareWalletErrorMessage(error, account.vendor));
  }
}
