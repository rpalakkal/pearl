import {useEffect, useState} from 'react';
import {History, Loader2, Send, UserRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {useAddressBook} from '../../components/contact-book/useAddressBook';
import {evaluateSendGate, satsToPearlInput, type SendGateDecision} from '../../lib/sendGate';
import {formatSatsAsPearl, parsePearlAmountToSats} from '../../lib/hardwareWallet.ts';
import type {AppNetwork, RecipientSendStatus} from '../../../../types/app-bridge';

export interface SendConfirmState {
  amount: string;
  address: string;
  feeRate: number;
  // Client-side estimate from the live UTXO set; null when it couldn't be
  // computed. The wallet does its own coin selection at broadcast.
  estimatedFeeSats: bigint | null;
  totalDebitSats: bigint | null;
}

// PRL float → sats. The software wallet page works in floats; fixed 8-decimal
// formatting avoids float multiplication drift.
function pearlToSats(value: number): bigint {
  const [whole, fraction = ''] = Math.max(0, value).toFixed(8).split('.');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}

type HistoryState =
  | {phase: 'loading'}
  | {phase: 'ready'; status: RecipientSendStatus | null};

export function SendConfirmDialog({
  confirm,
  spendableAmount,
  isSending,
  onCancel,
  onConfirm,
  onUseTestAmount,
}: {
  confirm: SendConfirmState;
  spendableAmount: number;
  isSending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onUseTestAmount: (amount: string) => void;
}) {
  const {resolveAddress} = useAddressBook();
  const [historyState, setHistoryState] = useState<HistoryState>({phase: 'loading'});
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHistoryState({phase: 'loading'});

    (async () => {
      let status: RecipientSendStatus | null = null;
      try {
        const info = await window.appBridge.manager.getNetworkInfo();
        const network: AppNetwork =
          info.currentNetwork === 'testnet' ? 'testnet' : 'mainnet';
        status = await window.appBridge.sendHistory.getRecipientStatus(
          confirm.address,
          network
        );
      } catch (error) {
        console.error('Failed to look up recipient send history:', error);
      }
      if (!cancelled) {
        setHistoryState({phase: 'ready', status});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [confirm.address, retryNonce]);

  const known = resolveAddress(confirm.address);

  // Fail closed: while history is loading, or when the gate can't be
  // evaluated (unparseable amount), confirming stays disabled.
  let gate: SendGateDecision | null = null;
  let gateUnavailable = false;
  if (historyState.phase === 'ready') {
    try {
      gate = evaluateSendGate({
        amountSats: parsePearlAmountToSats(confirm.amount),
        spendableBalanceSats: pearlToSats(spendableAmount),
        recipient: {hasConfirmedSend: historyState.status?.hasConfirmedSend ?? false},
      });
    } catch {
      gateUnavailable = true;
    }
  }

  const isBlocked = gate?.blocked ?? false;
  const canConfirm = gate !== null && !isBlocked && !isSending;

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !isSending) {
          onCancel();
        }
      }}
    >
      <DialogContent
        className="max-w-md gap-0 bg-white p-0"
        onEscapeKeyDown={event => {
          if (isSending) {
            event.preventDefault();
          }
        }}
        onInteractOutside={event => {
          if (isSending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <DialogTitle className="text-xl font-bold text-gray-900">Confirm Send</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4 p-6"
          onSubmit={event => {
            event.preventDefault();
            if (canConfirm) {
              onConfirm();
            }
          }}
        >
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-gray-500">Recipient</div>
            <div className="break-all font-mono text-sm text-gray-900">{confirm.address}</div>
            {known ? (
              <div
                className={`mt-1 inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-xs ${
                  known.source === 'contact'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
                }`}
              >
                <UserRound className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {known.source === 'contact' ? `Contact: ${known.label}` : known.label}
                </span>
              </div>
            ) : (
              <div className="mt-1 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Not in your contacts — double-check this address.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
              <div className="mb-1 font-medium uppercase text-gray-500">Amount</div>
              <div className="break-all font-mono text-sm text-gray-900">
                {confirm.amount} PRL
              </div>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
              <div className="mb-1 font-medium uppercase text-gray-500">Estimated Fee</div>
              <div className="break-all font-mono text-sm text-gray-900">
                {confirm.estimatedFeeSats !== null
                  ? formatSatsAsPearl(confirm.estimatedFeeSats)
                  : 'estimated at broadcast'}
              </div>
            </div>
            <div className="col-span-2 rounded-md border border-gray-200 bg-gray-50 p-2">
              <div className="mb-1 font-medium uppercase text-gray-500">Total Debit</div>
              <div className="break-all font-mono text-sm text-gray-900">
                {confirm.totalDebitSats !== null
                  ? formatSatsAsPearl(confirm.totalDebitSats)
                  : `${confirm.amount} PRL + network fee`}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-400">
                Fee rate {confirm.feeRate.toFixed(8)} PRL/kB
              </div>
            </div>
          </div>

          {historyState.phase === 'loading' && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking send history for this address…
            </div>
          )}
          {historyState.phase === 'ready' &&
            (historyState.status === null ? (
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <span>Send history unavailable — treated as a first send.</span>
                <button
                  type="button"
                  onClick={() => setRetryNonce(nonce => nonce + 1)}
                  disabled={isSending}
                  className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            ) : historyState.status.hasConfirmedSend ? (
              <div className="text-xs text-gray-500">
                You have sent to this address before (confirmed).
              </div>
            ) : historyState.status.hasAnySend ? (
              <div className="text-xs text-gray-500">
                A previous send to this address is still unconfirmed.
              </div>
            ) : (
              <div className="text-xs text-amber-700">First send to this address.</div>
            ))}

          {gateUnavailable && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              Safety check unavailable — this send can't be verified right now. Cancel and
              re-enter the amount.
            </div>
          )}

          {gate?.blocked && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <div className="font-medium">Large send blocked</div>
              <div>{gate.reason}</div>
              <button
                type="button"
                onClick={() => onUseTestAmount(satsToPearlInput(gate.suggestedTestAmountSats))}
                disabled={isSending}
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
              onClick={onCancel}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              autoFocus
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={!canConfirm}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Confirm and send
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
