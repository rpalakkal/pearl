import type {
  HardwareWalletAddress,
  HardwareWalletVendor,
  PearlNetwork,
} from '../../lib/hardwareWallet.ts';
import type {HardwareAddressSelectorOption} from '../../lib/hardwareWalletStorage.ts';
import type {
  HardwareWalletVendorOption,
  HardwareWalletViewActions,
  HardwareWalletViewProps,
  SendPreviewState,
} from './viewModel.ts';

interface BuildHardwareWalletViewPropsParams {
  actions: HardwareWalletViewActions;
  activeSendNetwork: PearlNetwork;
  addressSelectorOptions: HardwareAddressSelectorOption[];
  balanceError: string | null;
  connectedLabel: string;
  copiedAddress: boolean;
  derivationPath: string;
  deviceDisplayAddress: string | null;
  errorMessage: string | null;
  feeRate: number;
  hardwareAddress: HardwareWalletAddress | null;
  hasPendingDeviceOperation: boolean;
  isConnecting: boolean;
  isLoadingBalance: boolean;
  isRememberedAccount: boolean;
  isSending: boolean;
  isVerifyingAddress: boolean;
  lastSendFee: string | null;
  networkDisplayName: string;
  nextAddressIndex: number | null;
  pendingBalanceIsOutgoing: boolean;
  pendingBalanceLabel: string;
  pendingBalanceNotice: string | null;
  pendingBalanceValue: string;
  receiveDeviceDisplayAddress: string | null;
  selectedAddressIndex: number;
  selectedAddressPath: string;
  selectedAddressSummary: string;
  selectedLabel: string;
  selectedVendor: HardwareWalletVendor;
  sendAddress: string;
  sendAmount: string;
  sendError: string | null;
  sendPreview: SendPreviewState;
  sendSuccess: string | null;
  spendableBalanceSats: bigint;
  spendableUtxoCount: number;
  vendors: HardwareWalletVendorOption[];
  verifiedDeviceAddress: string | null;
  verifyError: string | null;
}

export function buildHardwareWalletViewProps({
  actions,
  activeSendNetwork,
  addressSelectorOptions,
  balanceError,
  connectedLabel,
  copiedAddress,
  derivationPath,
  deviceDisplayAddress,
  errorMessage,
  feeRate,
  hardwareAddress,
  hasPendingDeviceOperation,
  isConnecting,
  isLoadingBalance,
  isRememberedAccount,
  isSending,
  isVerifyingAddress,
  lastSendFee,
  networkDisplayName,
  nextAddressIndex,
  pendingBalanceIsOutgoing,
  pendingBalanceLabel,
  pendingBalanceNotice,
  pendingBalanceValue,
  receiveDeviceDisplayAddress,
  selectedAddressIndex,
  selectedAddressPath,
  selectedAddressSummary,
  selectedLabel,
  selectedVendor,
  sendAddress,
  sendAmount,
  sendError,
  sendPreview,
  sendSuccess,
  spendableBalanceSats,
  spendableUtxoCount,
  vendors,
  verifiedDeviceAddress,
  verifyError,
}: BuildHardwareWalletViewPropsParams): HardwareWalletViewProps {
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
              balanceError,
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
        networkDisplayName,
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
