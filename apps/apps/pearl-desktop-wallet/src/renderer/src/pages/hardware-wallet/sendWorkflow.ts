import {
  getHardwareWalletErrorMessage,
  parsePearlAmountToSats,
  previewHardwarePearlSend,
  signHardwarePearlTransaction,
  type HardwarePearlSendPreview,
  type HardwarePearlSignedTransaction,
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

const PREVIEW_CHANGED_MESSAGE =
  'Balance or fee estimate changed. Review the updated preview before signing.';

const STATE_CHANGED_SINCE_SIGNING_MESSAGE =
  'Wallet state changed since signing. The signed transaction was discarded; start a new send.';

// Everything the Review step showed the user, frozen so the later stages can
// verify nothing drifted before the transaction is signed and broadcast.
export interface HardwareSendReviewSnapshot {
  account: HardwareWalletAddress;
  destinationAddress: string;
  amountSats: bigint;
  feeRatePrlPerKb: number;
  preview: HardwarePearlSendPreview;
  utxos: BlockbookUtxo[];
  createdAt: number;
}

export interface HardwareSendSignedSnapshot {
  review: HardwareSendReviewSnapshot;
  // Held in renderer memory only and never persisted: the signature remains
  // valid for its inputs until those coins move.
  signed: HardwarePearlSignedTransaction;
}

interface WorkflowDeps {
  fetchBalanceData: (account: HardwareWalletAddress) => Promise<HardwareWalletBalanceData>;
  isActiveHardwareAccount: (account: HardwareWalletAddress) => boolean;
}

export type PrepareHardwareSendReviewResult =
  | {status: 'ok'; review: HardwareSendReviewSnapshot; balance: HardwareWalletBalanceData}
  | {
      status: 'error';
      message: string;
      balance?: HardwareWalletBalanceData;
      feeRate?: number;
    }
  | {status: 'stale'};

// Stage A: builds the Review snapshot. Runs the same safety pipeline the
// one-shot send used: preview on current utxos, fresh balance fetch,
// pending-outgoing guard, fee-rate refresh, and a preview-equality check.
export async function prepareHardwareSendReview(
  params: WorkflowDeps & {
    account: HardwareWalletAddress;
    amountInput: string;
    recipientInput: string;
    feeRatePrlPerKb: number;
    utxos: BlockbookUtxo[];
    estimateFeeRate: (network: PearlNetwork) => Promise<number | null>;
  }
): Promise<PrepareHardwareSendReviewResult> {
  const {account, isActiveHardwareAccount} = params;

  try {
    const amountSats = parsePearlAmountToSats(params.amountInput);
    const destinationAddress = params.recipientInput.trim();
    logHardwareWalletEvent('send:review', {
      ...hardwareAccountLogContext(account),
      amountSats: amountSats.toString(),
      recipient: compactHardwareAddress(destinationAddress),
      feeRatePrlPerKb: params.feeRatePrlPerKb.toFixed(8),
    });

    const initialPreview = previewHardwarePearlSend({
      account,
      destinationAddress,
      amountSats,
      feeRatePrlPerKb: params.feeRatePrlPerKb,
      utxos: params.utxos,
    });

    const latestBalance = await params.fetchBalanceData(account);
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    if (hasPendingOutgoingHardwareTransaction(latestBalance.info)) {
      logHardwareWalletEvent(
        'send:pending-outgoing',
        {
          ...hardwareAccountLogContext(account),
          ...hardwareBalanceLogContext(latestBalance.info, latestBalance.utxos),
        },
        'warn'
      );
      return {
        status: 'error',
        message: PENDING_OUTGOING_HARDWARE_SEND_MESSAGE,
        balance: latestBalance,
      };
    }

    const refreshedFeeRate = await params.estimateFeeRate(account.network);
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    const nextFeeRate = refreshedFeeRate ?? params.feeRatePrlPerKb;
    const latestPreview = previewHardwarePearlSend({
      account,
      destinationAddress,
      amountSats,
      feeRatePrlPerKb: nextFeeRate,
      utxos: latestBalance.utxos,
    });

    if (!sendPreviewsEqual(initialPreview, latestPreview)) {
      logHardwareWalletEvent(
        'send:preview-changed',
        {
          beforeFeeSats: initialPreview.feeSats.toString(),
          afterFeeSats: latestPreview.feeSats.toString(),
          beforeInputs: initialPreview.inputCount,
          afterInputs: latestPreview.inputCount,
        },
        'warn'
      );
      return {
        status: 'error',
        message: PREVIEW_CHANGED_MESSAGE,
        balance: latestBalance,
        feeRate: nextFeeRate,
      };
    }

    return {
      status: 'ok',
      balance: latestBalance,
      review: {
        account,
        destinationAddress,
        amountSats,
        feeRatePrlPerKb: nextFeeRate,
        preview: latestPreview,
        utxos: latestBalance.utxos,
        createdAt: Date.now(),
      },
    };
  } catch (error) {
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    console.error('Failed to prepare hardware send review:', error);
    logHardwareWalletEvent(
      'send:review-error',
      {
        ...hardwareAccountLogContext(account),
        error: getErrorLogMessage(error),
      },
      'error'
    );
    return {status: 'error', message: getHardwareWalletErrorMessage(error, account.vendor)};
  }
}

export type SignHardwareSendResult =
  | {status: 'ok'; snapshot: HardwareSendSignedSnapshot}
  | {status: 'invalidated'; message: string; balance?: HardwareWalletBalanceData}
  | {status: 'error'; message: string}
  | {status: 'stale'};

// Stage B: re-validates the Review snapshot against fresh wallet state
// immediately before asking the device to sign, then signs. Does NOT
// broadcast.
export async function signHardwareSendFromReview(
  params: WorkflowDeps & {
    review: HardwareSendReviewSnapshot;
    signTransaction?: typeof signHardwarePearlTransaction;
  }
): Promise<SignHardwareSendResult> {
  const {review, isActiveHardwareAccount} = params;
  const {account} = review;

  try {
    const latestBalance = await params.fetchBalanceData(account);
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    if (hasPendingOutgoingHardwareTransaction(latestBalance.info)) {
      logHardwareWalletEvent(
        'send:sign-invalidated',
        {...hardwareAccountLogContext(account), reason: 'pending-outgoing'},
        'warn'
      );
      return {
        status: 'invalidated',
        message: PENDING_OUTGOING_HARDWARE_SEND_MESSAGE,
        balance: latestBalance,
      };
    }

    const freshPreview = previewHardwarePearlSend({
      account,
      destinationAddress: review.destinationAddress,
      amountSats: review.amountSats,
      feeRatePrlPerKb: review.feeRatePrlPerKb,
      utxos: latestBalance.utxos,
    });

    if (!sendPreviewsEqual(review.preview, freshPreview)) {
      logHardwareWalletEvent(
        'send:sign-invalidated',
        {
          ...hardwareAccountLogContext(account),
          reason: 'preview-drift',
          beforeFeeSats: review.preview.feeSats.toString(),
          afterFeeSats: freshPreview.feeSats.toString(),
        },
        'warn'
      );
      return {status: 'invalidated', message: PREVIEW_CHANGED_MESSAGE, balance: latestBalance};
    }

    logHardwareWalletEvent(
      'send:signature-request',
      hardwareSendPreviewLogContext(review.preview)
    );
    const signTransaction = params.signTransaction ?? signHardwarePearlTransaction;
    const signed = await signTransaction({
      account,
      destinationAddress: review.destinationAddress,
      amountSats: review.amountSats,
      feeRatePrlPerKb: review.feeRatePrlPerKb,
      utxos: latestBalance.utxos,
    });

    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    logHardwareWalletEvent('send:signed', {
      ...hardwareAccountLogContext(account),
      feeSats: signed.feeSats.toString(),
      changeSats: signed.changeSats.toString(),
      inputs: signed.inputCount,
    });

    return {status: 'ok', snapshot: {review, signed}};
  } catch (error) {
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    console.error('Failed to sign hardware wallet transaction:', error);
    logHardwareWalletEvent(
      'send:error',
      {
        ...hardwareAccountLogContext(account),
        error: getErrorLogMessage(error),
      },
      'error'
    );
    return {status: 'error', message: getHardwareWalletErrorMessage(error, account.vendor)};
  }
}

export type BroadcastApprovedSendResult =
  | {
      status: 'ok';
      txid: string;
      feeSats: bigint;
      balance: HardwareWalletBalanceData | null;
    }
  | {status: 'invalidated'; message: string; balance?: HardwareWalletBalanceData}
  | {status: 'error'; message: string}
  | {status: 'stale'};

// Stage C: after explicit user approval, re-checks that the wallet state the
// transaction was signed against still holds (no new pending outgoing tx,
// every selected input still unspent), then broadcasts.
export async function broadcastApprovedHardwareSend(
  params: WorkflowDeps & {
    snapshot: HardwareSendSignedSnapshot;
    broadcastHardwareTransaction: (
      request: HardwareWalletBroadcastRequest
    ) => Promise<HardwareWalletBroadcastResult>;
  }
): Promise<BroadcastApprovedSendResult> {
  const {snapshot, isActiveHardwareAccount} = params;
  const {review, signed} = snapshot;
  const {account} = review;

  try {
    const latestBalance = await params.fetchBalanceData(account);
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    const freshOutpoints = new Set(
      latestBalance.utxos.map(utxo => `${utxo.txid}:${utxo.vout}`)
    );
    const inputsStillPresent = review.preview.selectedOutpoints.every(outpoint =>
      freshOutpoints.has(`${outpoint.txid}:${outpoint.vout}`)
    );

    if (hasPendingOutgoingHardwareTransaction(latestBalance.info) || !inputsStillPresent) {
      logHardwareWalletEvent(
        'send:approve-invalidated',
        {
          ...hardwareAccountLogContext(account),
          reason: inputsStillPresent ? 'pending-outgoing' : 'inputs-missing',
        },
        'warn'
      );
      return {
        status: 'invalidated',
        message: STATE_CHANGED_SINCE_SIGNING_MESSAGE,
        balance: latestBalance,
      };
    }

    const broadcastResult = await params.broadcastHardwareTransaction({
      network: account.network,
      rawTransactionHex: signed.rawTransactionHex,
      sourceAddress: account.address,
      sourcePublicKey: account.publicKey,
      recipientAddress: review.destinationAddress,
      amountSats: review.amountSats.toString(),
    });

    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    logHardwareWalletEvent('send:broadcast', {
      ...hardwareAccountLogContext(account),
      txid: broadcastResult.txid,
      feeSats: signed.feeSats.toString(),
    });

    return {
      status: 'ok',
      txid: broadcastResult.txid,
      feeSats: signed.feeSats,
      balance: broadcastResult.balance,
    };
  } catch (error) {
    if (!isActiveHardwareAccount(account)) {
      return {status: 'stale'};
    }

    console.error('Failed to broadcast hardware wallet transaction:', error);
    logHardwareWalletEvent(
      'send:error',
      {
        ...hardwareAccountLogContext(account),
        error: getErrorLogMessage(error),
      },
      'error'
    );
    return {status: 'error', message: getHardwareWalletErrorMessage(error, account.vendor)};
  }
}
