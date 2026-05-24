import {HardwareWalletView} from './hardware-wallet/HardwareWalletView.tsx';
import {useHardwareWalletController} from './hardware-wallet/useHardwareWalletController.tsx';

export default function HardwareWallet() {
  return <HardwareWalletView {...useHardwareWalletController()} />;
}
