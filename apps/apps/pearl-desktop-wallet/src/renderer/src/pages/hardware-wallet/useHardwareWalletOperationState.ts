import { useState } from 'react';

type HardwareWalletOperation = 'connecting' | 'idle' | 'sending' | 'verifying-address';

export function useHardwareWalletOperationState() {
  const [operation, setOperation] = useState<HardwareWalletOperation>('idle');

  const finishOperation = (completedOperation: HardwareWalletOperation) => {
    setOperation(currentOperation => (
      currentOperation === completedOperation ? 'idle' : currentOperation
    ));
  };

  return {
    finishConnecting: () => finishOperation('connecting'),
    finishSending: () => finishOperation('sending'),
    finishVerifyingAddress: () => finishOperation('verifying-address'),
    hasPendingDeviceOperation: operation !== 'idle',
    isConnecting: operation === 'connecting',
    isSending: operation === 'sending',
    isVerifyingAddress: operation === 'verifying-address',
    startConnecting: () => { setOperation('connecting'); },
    startSending: () => { setOperation('sending'); },
    startVerifyingAddress: () => { setOperation('verifying-address'); },
  };
}
