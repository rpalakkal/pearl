import type { LucideIcon } from 'lucide-react';
import type {
  HardwarePearlSendPreview,
  HardwareWalletAddress,
  HardwareWalletVendor,
  PearlNetwork,
} from '../../lib/hardwareWallet.ts';
import type { HardwareAddressSelectorOption } from '../../lib/hardwareWalletStorage.ts';

export type SendPreviewState =
  | { preview: HardwarePearlSendPreview; error: null }
  | { preview: null; error: string | null };

export interface HardwareWalletVendorOption {
  vendor: HardwareWalletVendor;
  label: string;
  icon: LucideIcon;
}

export interface HardwareWalletHeaderModel {
  derivationPath: string;
  hasPendingDeviceOperation: boolean;
  networkDisplayName: string;
}

export interface HardwareWalletVendorModel {
  hasPendingDeviceOperation: boolean;
  selectedLabel: string;
  selectedVendor: HardwareWalletVendor;
  vendors: HardwareWalletVendorOption[];
}

export interface HardwareWalletAddressSelectorModel {
  hasPendingDeviceOperation: boolean;
  nextAddressIndex: number | null;
  options: HardwareAddressSelectorOption[];
  selectedAddressIndex: number;
  selectedAddressPath: string;
  selectedAddressSummary: string;
}

export interface HardwareWalletConnectionModel {
  errorMessage: string | null;
  isConnecting: boolean;
}

export interface HardwareWalletBalanceModel {
  balanceError: string | null;
  hardwareAddress: HardwareWalletAddress;
  hasPendingDeviceOperation: boolean;
  isLoadingBalance: boolean;
  pendingBalanceIsOutgoing: boolean;
  pendingBalanceLabel: string;
  pendingBalanceNotice: string | null;
  pendingBalanceValue: string;
  spendableBalanceSats: bigint;
  spendableUtxoCount: number;
}

export interface HardwareWalletReceiveModel {
  connectedLabel: string;
  copiedAddress: boolean;
  hardwareAddress: HardwareWalletAddress;
  hasPendingDeviceOperation: boolean;
  isVerifyingAddress: boolean;
  receiveDeviceDisplayAddress: string | null;
  verifiedDeviceAddress: string | null;
  verifyError: string | null;
}

export interface HardwareWalletDetailsModel {
  connectedLabel: string;
  hardwareAddress: HardwareWalletAddress;
  isRememberedAccount: boolean;
}

export interface HardwareWalletSendModel {
  activeSendNetwork: PearlNetwork;
  connectedLabel: string;
  deviceDisplayAddress: string | null;
  feeRate: number;
  hasPendingDeviceOperation: boolean;
  isSending: boolean;
  lastSendFee: string | null;
  sendAddress: string;
  sendAmount: string;
  sendError: string | null;
  sendPreview: SendPreviewState;
  sendSuccess: string | null;
}

export interface ConnectedHardwareWalletModel {
  balance: HardwareWalletBalanceModel;
  details: HardwareWalletDetailsModel;
  receive: HardwareWalletReceiveModel;
  send: HardwareWalletSendModel;
}

export interface HardwareWalletViewModel {
  addressSelector: HardwareWalletAddressSelectorModel;
  connectedWallet: ConnectedHardwareWalletModel | null;
  connection: HardwareWalletConnectionModel;
  header: HardwareWalletHeaderModel;
  vendor: HardwareWalletVendorModel;
}

export interface HardwareWalletViewActions {
  addHardwareAddress: () => void;
  connectDevice: () => void;
  copyToClipboard: (text: string) => void;
  forgetHardwareAccount: () => void;
  goBack: () => void;
  loadHardwareWalletBalance: (account: HardwareWalletAddress) => void;
  selectAddressIndex: (addressIndex: number) => void;
  selectVendor: (vendor: HardwareWalletVendor) => void;
  sendHardwareTransaction: () => void;
  setSendAddress: (value: string) => void;
  setSendAmount: (value: string) => void;
  verifyReceiveAddress: () => void;
}

export interface HardwareWalletViewProps {
  actions: HardwareWalletViewActions;
  model: HardwareWalletViewModel;
}
