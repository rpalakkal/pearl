import { useState, useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from 'react-router-dom';
import { useWalletStore } from '../../store/walletStore';
import SendHeader from './SendHeader';
import WalletInfo from './WalletInfo';
import AmountInput from './AmountInput';
import AddressInput from './AddressInput';
import FeeSelector from './FeeSelector';
import ErrorAlert from './ErrorAlert';
import SuccessBanner from './SuccessBanner';
import TransactionPreview from './TransactionPreview';
import SendButton from './SendButton';
import { SendConfirmDialog, type SendConfirmState } from './SendConfirmDialog';
import { formatTxid } from '@/lib/crypto';
import { getErrorMessage } from '@/lib/utils';
import { maxSpendableSoftwareSats, spendableUtxoSats } from '../../lib/softwareSendEstimate';
import { satsToPearlInput } from '../../lib/sendGate';

type FeeLevel = 'fast' | 'medium' | 'slow';
const MEMPOOL_MIN_FEE_PER_VBYTE = 0.00001;

export default function SendTransaction() {
  const navigate = useNavigate();
  const { walletName, availableBalance, validateAddress, syncWalletData } = useWalletStore();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [isMaxSelected, setIsMaxSelected] = useState(false);
  const [confirmState, setConfirmState] = useState<SendConfirmState | null>(null);
  const [isSendingTx, setIsSendingTx] = useState(false);

  // Fee-related state
  const [feeLevel, setFeeLevel] = useState<FeeLevel>('fast');
  const [estimatedFees, setEstimatedFees] = useState<Record<FeeLevel, number>>({
    fast: 0.0001,
    medium: 0.00005,
    slow: 0.00001,
  });
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [utxoSats, setUtxoSats] = useState<bigint[] | null>(null);

  const currentFee = estimatedFees[feeLevel];
  // Spendable = confirmed UTXOs minus an estimated fee for spending all of
  // them. Falls back to deducting the raw fee rate (a rough over-estimate for
  // small sends) only when the UTXO set can't be fetched.
  const spendableAmount =
    utxoSats !== null
      ? parseFloat(satsToPearlInput(maxSpendableSoftwareSats(utxoSats, currentFee)))
      : Math.max(0, (availableBalance ?? 0) - currentFee);

  async function refreshUtxos() {
    try {
      const utxos = await window.appBridge.wallet.listUnspent(1);
      setUtxoSats(spendableUtxoSats(utxos));
    } catch (err) {
      console.error('Failed to list unspent outputs:', err);
      setUtxoSats(null);
    }
  }

  const form = useForm({
    defaultValues: {
      amount: '',
      address: '',
    },
    // Field validators have passed by the time onSubmit fires; instead of
    // sending immediately, open the confirmation dialog. The actual send
    // happens in performSend after explicit confirmation.
    onSubmit: async ({ value }: { value: { amount: string; address: string } }) => {
      setError(null);
      setSuccess(null);
      setConfirmState({
        amount: value.amount.trim(),
        address: value.address.trim(),
        feeRate: estimatedFees[feeLevel],
      });
    },
  });

  async function performSend(confirm: SendConfirmState) {
    setIsSendingTx(true);
    setError(null);
    setSuccess(null);
    try {
      const txId = await window.appBridge.wallet.sendFromDefaultAccount(
        confirm.address,
        parseFloat(confirm.amount),
        confirm.feeRate,
      );
      setTxid(txId);
      syncWalletData();
      void refreshUtxos();
      setSuccess('Transaction sent successfully!');
      setConfirmState(null);
      form.reset();
    } catch (err) {
      setConfirmState(null);
      const errorMessage = getErrorMessage(err, 'Failed to send transaction');
      // Check if wallet is locked (multiple possible error messages)
      const isWalletLocked =
        errorMessage.includes('walletpassphrase') ||
        (errorMessage.includes('wallet') && errorMessage.includes('lock')) ||
        errorMessage.includes('wallet is locked');

      if (isWalletLocked) {
        setError('Wallet is locked. Redirecting to unlock screen...');
        setTimeout(() => {
          navigate('/unlock');
        }, 3000);
      } else if (errorMessage.includes('mempool min fee not met')) {
        setError('Seems like the transaction fee is too low. This often means that the transaction is too large. Try setting up smaller transactions.')
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSendingTx(false);
    }
  }

  // A validator that throws (e.g. address validation while the wallet
  // service is down) puts the raw Error into the field's errors; rendering
  // that object as a React child crashes the page, so coerce to a string.
  function firstFieldError(rawErrors: unknown[]): string | null {
    const first = rawErrors.find(Boolean);
    if (!first) {
      return null;
    }
    return typeof first === 'string' ? first : getErrorMessage(first, 'Validation failed');
  }

  function useTestAmount(amount: string) {
    setConfirmState(null);
    form.setFieldValue('amount', amount);
    setIsMaxSelected(false);
    // Re-run submission so the dialog reopens with the test amount.
    void form.handleSubmit();
  }

  // Fetch fee estimates
  async function fetchEstimatedFees() {
    setIsLoadingFees(true);
    try {
      const [fastFee, mediumFee, slowFee] = await Promise.all([
        window.appBridge.wallet.estimateFee(1),
        window.appBridge.wallet.estimateFee(10),
        window.appBridge.wallet.estimateFee(25),
      ]);


      const fastFeeEstimate = isNaN(Number(fastFee)) ? 0 : Number(fastFee);
      const mediumFeeEstimate = isNaN(Number(mediumFee)) ? 0 : Number(mediumFee);
      const slowFeeEstimate = isNaN(Number(slowFee)) ? 0 : Number(slowFee);

      console.log('fees:', fastFeeEstimate, mediumFeeEstimate, slowFeeEstimate);

      setEstimatedFees({
        fast: Math.max(fastFeeEstimate, MEMPOOL_MIN_FEE_PER_VBYTE),
        medium: Math.max(mediumFeeEstimate, MEMPOOL_MIN_FEE_PER_VBYTE),
        slow: Math.max(slowFeeEstimate, MEMPOOL_MIN_FEE_PER_VBYTE),
      });
    } catch (error) {
      console.error('Failed to fetch fee estimates:', error);
    } finally {
      setIsLoadingFees(false);
    }
  }

  useEffect(() => {
    fetchEstimatedFees();
    void refreshUtxos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update amount when fee changes if MAX was selected
  useEffect(() => {
    if (isMaxSelected) {
      const currentAmount = form.getFieldValue('amount');
      const currentAmountNum = parseFloat(currentAmount);

      // Only update if the current amount would exceed spendable after fee change
      if (!isNaN(currentAmountNum) && currentAmountNum > spendableAmount) {
        form.setFieldValue('amount', spendableAmount.toString());
      }
    }
  }, [currentFee, spendableAmount, isMaxSelected]);

  // Field validators
  function validateAmount(val: string) {
    if (!val || isNaN(parseFloat(val)) || parseFloat(val) <= 0) {
      return 'Please enter a valid amount';
    }
    if (parseFloat(val) > (spendableAmount ?? 0)) {
      return `Insufficient spendable balance. Available after fees: ${spendableAmount ?? 'Unknown'} PRL`;
    }
    return undefined;
  }

  async function validateAddressField(val: string) {
    if (!val?.trim()) {
      return 'Please enter a recipient address';
    }
    const { isValid } = await validateAddress(val);
    if (!isValid) {
      return 'Invalid Pearl address format';
    }
    return undefined;
  }

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <SendHeader title="Send Pearl" onBack={() => navigate('/wallet')} />

      <div className="flex-1 overflow-y-auto px-8 py-12">
        <div className="flex justify-center">
          <div className="w-full max-w-md">
            <form
              className="space-y-6"
              onSubmit={e => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              <WalletInfo walletName={walletName} balance={availableBalance} />

              <form.Field
                name="amount"
                validators={{
                  onSubmit: ({ value }) => {
                    setSuccess(null);
                    return validateAmount(value)
                  },
                }}
              >
                {field => {
                  const firstError = firstFieldError(field.state.meta?.errors ?? []);
                  return (
                    <AmountInput
                      amount={field.state.value}
                      onChange={v => {
                        field.handleChange(v);
                        setIsMaxSelected(false); // User is manually changing amount
                        setError(null); // Clear submission error when form changes
                      }}
                      spendableAmount={spendableAmount}
                      currentFee={currentFee}
                      onMax={() => {
                        field.handleChange(spendableAmount?.toString());
                        setIsMaxSelected(true); // Track that MAX was selected
                        setError(null); // Clear submission error when form changes
                      }}
                      error={firstError}
                    />
                  );
                }}
              </form.Field>

              <form.Field
                name="address"
                validators={{
                  onSubmitAsync: async ({ value }) => validateAddressField(value),
                }}
              >
                {field => {
                  const firstError = firstFieldError(field.state.meta?.errors ?? []);
                  return (
                    <AddressInput
                      address={field.state.value}
                      onChange={v => {
                        field.handleChange(v);
                        setError(null); // Clear submission error when form changes
                      }}
                      onBlur={field.handleBlur}
                      error={firstError}
                    />
                  );
                }}
              </form.Field>

              <FeeSelector
                feeLevel={feeLevel}
                isLoadingFees={isLoadingFees}
                currentFee={currentFee}
                onSelect={level => {
                  setFeeLevel(level);
                  setError(null); // Clear submission error when fee changes
                }}
              />

              {error && <ErrorAlert message={error} />}

              {success && txid && (
                <SuccessBanner message={success} txid={txid} formatTxid={formatTxid} />
              )}

              <form.Subscribe
                selector={s => ({
                  amount: s.values.amount ?? '',
                  address: s.values.address ?? '',
                  isSubmitting: s.isSubmitting,
                  isValid: s.isValid,
                })}
              >
                {({ amount, address, isSubmitting, isValid }) => (
                  <>
                    {amount && address && !error && (
                      <TransactionPreview
                        amount={amount}
                        address={address}
                        currentFee={currentFee}
                      />
                    )}
                    <SendButton
                      onClick={() => form.handleSubmit()}
                      isLoading={isSubmitting || isSendingTx}
                      disabled={isSubmitting || isSendingTx || !amount || !address || !!error || !isValid}
                    />
                  </>
                )}
              </form.Subscribe>
            </form>
          </div>
        </div>
      </div>

      {confirmState && (
        <SendConfirmDialog
          confirm={confirmState}
          spendableAmount={spendableAmount}
          isSending={isSendingTx}
          onCancel={() => {
            if (!isSendingTx) {
              setConfirmState(null);
            }
          }}
          onConfirm={() => {
            if (confirmState) {
              void performSend(confirmState);
            }
          }}
          onUseTestAmount={useTestAmount}
        />
      )}
    </div>
  );
}