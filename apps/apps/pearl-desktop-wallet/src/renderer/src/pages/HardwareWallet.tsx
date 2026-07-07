import {HardwareWalletView} from './hardware-wallet/HardwareWalletView.tsx';
import {useHardwareWalletController} from './hardware-wallet/useHardwareWalletController.tsx';
import {useAppLockGuard} from '../hooks/useAppLockGuard';

export default function HardwareWallet() {
  useAppLockGuard();
  return <HardwareWalletView {...useHardwareWalletController()} />;
}
