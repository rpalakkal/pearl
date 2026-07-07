import {History, Loader2, PenLine, Send, UserRound, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Bech32Address} from '@/components/ui/bech32-address';
import {formatSatsAsPearl} from '../../lib/hardwareWallet.ts';
import {satsToPearlInput} from '../../lib/sendGate.ts';
import {AddressBookControl} from '../../components/contact-book/AddressBookControl.tsx';
import {AlertMessage} from './AlertMessage.tsx';
import type {HardwareWalletSendModel, HardwareWalletViewActions} from './viewModel.ts';
import type {RecipientContext} from './useHardwareSendFormState.ts';
import type {HardwareSendReviewSnapshot, HardwareSendSignedSnapshot} from './sendWorkflow.ts';

type SendPanelActions = Pick<
  HardwareWalletViewActions,
  | 'applyTestAmount'
  | 'approveBroadcast'
  | 'beginSendReview'
  | 'cancelSendStage'
  | 'confirmSignTransaction'
  | 'setSendAddress'
  | 'setSendAmount'
>;

export function HardwareSendPanel({
  actions,
  model,
}: {
  actions: SendPanelActions;
  model: HardwareWalletSendModel;
}) {
  const stage = model.sendStage;

  return (
    <>
      <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-700">Send Pearl</div>
            <div className="text-xs text-gray-500">Fee rate {model.feeRate.toFixed(8)} PRL/kB</div>
          </div>
          {stage.step !== 'edit' && stage.step !== 'preparing-review' && (
            <div className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
              {stage.step === 'review' && 'Step 2 of 3 · Review'}
              {stage.step === 'signing' && 'Step 2 of 3 · Signing'}
              {(stage.step === 'signed' || stage.step === 'broadcasting') &&
                'Step 3 of 3 · Approve'}
            </div>
          )}
        </div>

        {(stage.step === 'edit' || stage.step === 'preparing-review') && (
          <EditStage actions={actions} model={model} />
        )}

        {(stage.step === 'review' || stage.step === 'signing') && (
          <ReviewStage
            actions={actions}
            connectedLabel={model.connectedLabel}
            isSigning={stage.step === 'signing'}
            recipient={stage.recipient}
            review={stage.review}
          />
        )}

        {(stage.step === 'signed' || stage.step === 'broadcasting') && (
          <SignedStage
            actions={actions}
            isBroadcasting={stage.step === 'broadcasting'}
            recipient={stage.recipient}
            snapshot={stage.snapshot}
          />
        )}

        {model.sendError && <AlertMessage tone="error">{model.sendError}</AlertMessage>}

        {model.sendSuccess && (
          <div className="min-w-0 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            <div>Broadcast transaction</div>
            <div className="mt-1 break-all font-mono text-xs sm:text-sm">{model.sendSuccess}</div>
            {model.lastSendFee && <div className="mt-1">Fee {model.lastSendFee}</div>}
          </div>
        )}
      </div>
      {stage.step === 'edit' && !model.deviceDisplayAddress && model.sendAddress && (
        <AlertMessage tone="warning">
          Enter a valid Pearl Taproot recipient to preview the address shown on the device.
        </AlertMessage>
      )}
    </>
  );
}

function EditStage({
  actions,
  model,
}: {
  actions: SendPanelActions;
  model: HardwareWalletSendModel;
}) {
  const isPreparing = model.sendStage.step === 'preparing-review';

  return (
    <>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Amount
          <input
            value={model.sendAmount}
            onChange={event => actions.setSendAmount(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            disabled={model.hasPendingDeviceOperation || isPreparing}
            className="focus:border-brand-green mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors"
          />
        </label>

        <label className="block text-sm font-medium text-gray-700">
          Recipient
          <input
            value={model.sendAddress}
            onChange={event => actions.setSendAddress(event.target.value)}
            placeholder={model.activeSendNetwork === 'testnet' ? 'tprl1...' : 'prl1...'}
            disabled={model.hasPendingDeviceOperation || isPreparing}
            className="focus:border-brand-green mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none transition-colors"
          />
        </label>

        <AddressBookControl
          address={model.sendAddress}
          onSelect={actions.setSendAddress}
          disabled={model.hasPendingDeviceOperation || isPreparing}
        />

        {model.sendPreview.preview && (
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <SendPreviewMetric
              label="Network Fee"
              value={formatSatsAsPearl(model.sendPreview.preview.feeSats)}
            />
            <SendPreviewMetric
              label="Change"
              value={formatSatsAsPearl(model.sendPreview.preview.changeSats)}
            />
            <SendPreviewMetric label="Inputs" value={String(model.sendPreview.preview.inputCount)} />
          </div>
        )}
      </div>

      {model.sendPreview.error && !model.sendError && (
        <AlertMessage tone="warning">{model.sendPreview.error}</AlertMessage>
      )}

      <Button
        type="button"
        className="w-full"
        onClick={actions.beginSendReview}
        disabled={model.hasPendingDeviceOperation || isPreparing || !model.sendPreview.preview}
      >
        {isPreparing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing review
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Review send
          </>
        )}
      </Button>
    </>
  );
}

function RecipientRecognition({recipient}: {recipient: RecipientContext}) {
  if (recipient.known) {
    const isContact = recipient.known.source === 'contact';
    return (
      <div
        className={`mt-1 inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-xs ${
          isContact
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-blue-200 bg-blue-50 text-blue-800'
        }`}
      >
        <UserRound className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">
          {isContact ? `Contact: ${recipient.known.label}` : recipient.known.label}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-1 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      Not in your contacts — double-check this address.
    </div>
  );
}

function RecipientHistoryLine({recipient}: {recipient: RecipientContext}) {
  if (!recipient.history) {
    return (
      <div className="text-xs text-gray-500">Send history for this address is unavailable.</div>
    );
  }
  if (recipient.history.hasConfirmedSend) {
    return (
      <div className="text-xs text-gray-500">
        You have sent to this address before (confirmed).
      </div>
    );
  }
  if (recipient.history.hasAnySend) {
    return (
      <div className="text-xs text-gray-500">
        A previous send to this address is still unconfirmed.
      </div>
    );
  }
  return <div className="text-xs text-amber-700">First send to this address.</div>;
}

function ReviewStage({
  actions,
  connectedLabel,
  isSigning,
  recipient,
  review,
}: {
  actions: SendPanelActions;
  connectedLabel: string;
  isSigning: boolean;
  recipient: RecipientContext;
  review: HardwareSendReviewSnapshot;
}) {
  const gate = recipient.gate;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-1 text-xs font-medium uppercase text-gray-500">Recipient</div>
        <div className="break-all font-mono text-sm text-gray-900">
          <Bech32Address address={review.destinationAddress} />
        </div>
        <RecipientRecognition recipient={recipient} />
        <div className="mt-2">
          <RecipientHistoryLine recipient={recipient} />
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <div className="mb-1 font-medium">Your {connectedLabel} will display this address</div>
        <div className="break-all font-mono">
          <Bech32Address address={review.preview.deviceDisplayAddress} />
        </div>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <SendPreviewMetric label="Amount" value={formatSatsAsPearl(review.amountSats)} />
        <SendPreviewMetric label="Network Fee" value={formatSatsAsPearl(review.preview.feeSats)} />
        <SendPreviewMetric
          label="Change"
          value={formatSatsAsPearl(review.preview.changeSats)}
          hint="Returns to your hardware address"
        />
        <SendPreviewMetric label="Inputs" value={String(review.preview.inputCount)} />
      </div>

      <details className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700">
        <summary className="cursor-pointer font-medium">
          Inputs being spent ({review.preview.selectedOutpoints.length})
        </summary>
        <ul className="mt-2 space-y-1">
          {review.preview.selectedOutpoints.map(outpoint => (
            <li key={`${outpoint.txid}:${outpoint.vout}`} className="break-all font-mono">
              {outpoint.txid}:{outpoint.vout} · {formatSatsAsPearl(outpoint.valueSats)}
            </li>
          ))}
        </ul>
      </details>

      {gate.blocked && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div className="font-medium">Large send blocked</div>
          <div>{gate.reason}</div>
          <button
            type="button"
            onClick={actions.applyTestAmount}
            disabled={isSigning}
            className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-2 py-1 text-xs text-red-700 shadow-sm transition-all hover:bg-red-100 disabled:opacity-50"
          >
            <History className="h-3.5 w-3.5" />
            Send {satsToPearlInput(gate.suggestedTestAmountSats)} PRL test first
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={actions.cancelSendStage}
          disabled={isSigning}
        >
          <X className="h-4 w-4" />
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={actions.confirmSignTransaction}
          disabled={isSigning || gate.blocked}
        >
          {isSigning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirm on {connectedLabel}
            </>
          ) : (
            <>
              <PenLine className="h-4 w-4" />
              Sign on {connectedLabel}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function SignedStage({
  actions,
  isBroadcasting,
  recipient,
  snapshot,
}: {
  actions: SendPanelActions;
  isBroadcasting: boolean;
  recipient: RecipientContext;
  snapshot: HardwareSendSignedSnapshot;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <div className="font-medium">Signed — not yet broadcast</div>
        <div className="mt-1 text-xs">
          Nothing has been sent yet. Review the final details below and broadcast when ready.
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-1 text-xs font-medium uppercase text-gray-500">Recipient</div>
        <div className="break-all font-mono text-sm text-gray-900">
          <Bech32Address address={snapshot.review.destinationAddress} />
        </div>
        <RecipientRecognition recipient={recipient} />
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <SendPreviewMetric label="Amount" value={formatSatsAsPearl(snapshot.review.amountSats)} />
        <SendPreviewMetric label="Network Fee" value={formatSatsAsPearl(snapshot.signed.feeSats)} />
        <SendPreviewMetric
          label="Change"
          value={formatSatsAsPearl(snapshot.signed.changeSats)}
          hint="Returns to your hardware address"
        />
        <SendPreviewMetric label="Inputs" value={String(snapshot.signed.inputCount)} />
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={actions.cancelSendStage}
          disabled={isBroadcasting}
          title="The discarded transaction stays technically valid until its coins move"
        >
          <X className="h-4 w-4" />
          Discard
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={actions.approveBroadcast}
          disabled={isBroadcasting}
        >
          {isBroadcasting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Broadcasting
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Broadcast transaction
            </>
          )}
        </Button>
      </div>
      <div className="text-xs text-gray-500">
        Discarding does not revoke the signature; it remains technically valid until those coins
        move.
      </div>
    </div>
  );
}

function SendPreviewMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-white p-2">
      <div className="mb-1 font-medium uppercase text-gray-500">{label}</div>
      <div className="break-all font-mono text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}
