import { useRef, useState } from 'react';
import type { HardwareWalletAddress, PearlNetwork } from '../../lib/hardwareWallet.ts';
import type { BlockbookAddressInfo, BlockbookUtxo } from '../../../../types/app-bridge.ts';
import {
  getErrorLogMessage,
  hardwareAccountLogContext,
  hardwareBalanceLogContext,
  logHardwareWalletEvent,
} from './pageModel.ts';
import type { HardwareWalletBalanceData } from './balanceData.ts';

type FetchHardwareWalletBalanceData = (
  address: string,
  network: PearlNetwork
) => Promise<HardwareWalletBalanceData>;

export function useHardwareWalletBalanceState(fetchBalanceData: FetchHardwareWalletBalanceData) {
  const balanceRequestIdRef = useRef(0);
  const [addressInfo, setAddressInfo] = useState<BlockbookAddressInfo | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [utxos, setUtxos] = useState<BlockbookUtxo[]>([]);

  const setHardwareBalanceData = ({ info, utxos: addressUtxos }: HardwareWalletBalanceData) => {
    setAddressInfo(info);
    setUtxos(addressUtxos);
  };

  const clearHardwareBalance = () => {
    setAddressInfo(null);
    setUtxos([]);
  };

  const invalidateBalanceRequests = () => {
    balanceRequestIdRef.current += 1;
    setIsLoadingBalance(false);
  };

  const loadHardwareWalletBalance = async (account: HardwareWalletAddress) => {
    const requestId = balanceRequestIdRef.current + 1;
    balanceRequestIdRef.current = requestId;
    setIsLoadingBalance(true);
    setBalanceError(null);
    logHardwareWalletEvent('balance:start', hardwareAccountLogContext(account));

    try {
      const balance = await fetchBalanceData(account.address, account.network);

      if (requestId !== balanceRequestIdRef.current) {
        return;
      }

      setHardwareBalanceData(balance);
      logHardwareWalletEvent('balance:loaded', {
        ...hardwareAccountLogContext(account),
        ...hardwareBalanceLogContext(balance.info, balance.utxos),
      });
    } catch (error) {
      if (requestId !== balanceRequestIdRef.current) {
        return;
      }

      console.error('Failed to load hardware wallet balance:', error);
      logHardwareWalletEvent('balance:error', {
        ...hardwareAccountLogContext(account),
        error: getErrorLogMessage(error),
      }, 'error');
      setBalanceError(error instanceof Error ? error.message : 'Unable to load hardware wallet balance.');
    } finally {
      if (requestId === balanceRequestIdRef.current) {
        setIsLoadingBalance(false);
      }
    }
  };

  return {
    addressInfo,
    balanceError,
    clearHardwareBalance,
    invalidateBalanceRequests,
    isLoadingBalance,
    loadHardwareWalletBalance,
    setBalanceError,
    setHardwareBalanceData,
    utxos,
  };
}
