import type {LucideIcon} from 'lucide-react';
import type {
  HardwarePearlSendPreview,
  HardwareWalletAddress,
  HardwareWalletVendor,
  PearlNetwork,
} from '../../lib/hardwareWallet.ts';
import type {HardwareAddressSelectorOption} from '../../lib/hardwareWalletStorage.ts';
import type {AddressBackfillStatus} from '../../../../types/app-bridge.ts';
import type {HardwareSendStage} from './useHardwareSendFormState.ts';

export type SendPreviewState =
  | {preview: HardwarePearlSendPreview; error: null}
  | {preview: null; error: string | null};

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
  backfill: AddressBackfillStatus | null;
  backfillError: string | null;
  // Progress height hasn't moved recently: the rescan is waiting on network
  // peers for compact filters, not frozen.
  backfillStalled: boolean;
  balanceError: string | null;
  balanceSource: 'oyster' | null;
  // The local wallet backing the reads is still syncing the chain.
  walletSyncing: boolean;
  canBackfill: boolean;
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
  sendStage: HardwareSendStage;
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
  applyTestAmount: () => void;
  approveBroadcast: () => void;
  backfillHardwareAddress: () => void;
  beginSendReview: () => void;
  cancelSendStage: () => void;
  confirmSignTransaction: () => void;
  connectDevice: () => void;
  copyToClipboard: (text: string) => void;
  forgetHardwareAccount: () => void;
  goBack: () => void;
  loadHardwareWalletBalance: (account: HardwareWalletAddress) => void;
  selectAddressIndex: (addressIndex: number) => void;
  selectVendor: (vendor: HardwareWalletVendor) => void;
  setSendAddress: (value: string) => void;
  setSendAmount: (value: string) => void;
  verifyReceiveAddress: () => void;
}

export interface HardwareWalletViewProps {
  actions: HardwareWalletViewActions;
  model: HardwareWalletViewModel;
}
