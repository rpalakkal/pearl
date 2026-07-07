import { useForm } from '@tanstack/react-form';
import { displayToFs } from '../../../../utils/filename-utils';
import {
  validateWalletNameAvailable,
  validateWalletNameFormat,
} from '../../lib/walletNameValidation';
import WalletSetupHeader from './WalletSetupHeader';
import WalletNameField from './WalletNameField';
import SecurityNotice from './SecurityNotice';
import ActionButtons from './ActionButtons';

type WalletSetupStepProps = {
  onCreate: (walletName: string) => Promise<void>;
  onBack: () => void;
};

// The wallet passphrase is generated and vaulted behind the app password, so
// wallet setup only needs a name.
export default function WalletSetupStep({ onCreate, onBack }: WalletSetupStepProps) {
  const form = useForm({
    defaultValues: {
      walletName: '',
    },
    onSubmit: async ({ value }) => onCreate(displayToFs(value.walletName)),
  });

  function validateWalletName(val: string) {
    return validateWalletNameFormat(val) ?? undefined;
  }

  async function validateWalletNameAsync(val: string) {
    return (await validateWalletNameAvailable(val)) ?? undefined;
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-md flex-col">
      <WalletSetupHeader />
      <form
        onSubmit={e => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="space-y-4 sm:space-y-6"
      >
        <form.Field
          name="walletName"
          validators={{
            onChange: ({ value }) => validateWalletName(value),
            onChangeAsync: async ({ value }) => validateWalletNameAsync(value),
            onBlurAsync: async ({ value }) => validateWalletNameAsync(value),
            onSubmit: ({ value }) => validateWalletName(value),
            onSubmitAsync: async ({ value }) => validateWalletNameAsync(value),
          }}
        >
          {field => (
            <WalletNameField
              onChange={v => field.handleChange(v)}
              onBlur={field.handleBlur}
              isChecking={Boolean(field.state.meta?.isValidating)}
              error={(field.state.meta?.errors ?? [])[0] ?? null}
            />
          )}
        </form.Field>

        <SecurityNotice />

        <form.Subscribe
          selector={s => ({
            isValid: s.isValid,
            isSubmitting: s.isSubmitting,
            isValidating: s.isValidating,
          })}
        >
          {({ isValid, isSubmitting, isValidating }) => (
            <ActionButtons
              onBack={onBack}
              isCreating={isSubmitting}
              isValidating={isValidating}
              isValid={isValid}
            />
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
