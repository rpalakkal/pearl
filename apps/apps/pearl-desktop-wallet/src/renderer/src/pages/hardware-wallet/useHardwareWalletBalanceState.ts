import {useRef, useState} from 'react';
import {getErrorMessage} from '../../lib/utils.ts';
import type {HardwareWalletAddress} from '../../lib/hardwareWallet.ts';
import type {
  BlockbookAddressInfo,
  BlockbookUtxo,
  HardwareBalanceSource,
} from '../../../../types/app-bridge.ts';
import {
  getErrorLogMessage,
  hardwareAccountLogContext,
  hardwareBalanceLogContext,
  logHardwareWalletEvent,
} from './pageModel.ts';
import type {HardwareWalletBalanceData} from './balanceData.ts';

type FetchHardwareWalletBalanceData = (
  account: HardwareWalletAddress
) => Promise<HardwareWalletBalanceData>;

export function useHardwareWalletBalanceState(fetchBalanceData: FetchHardwareWalletBalanceData) {
  const balanceRequestIdRef = useRef(0);
  const [addressInfo, setAddressInfo] = useState<BlockbookAddressInfo | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceSource, setBalanceSource] = useState<HardwareBalanceSource | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [utxos, setUtxos] = useState<BlockbookUtxo[]>([]);

  const setHardwareBalanceData = ({
    info,
    utxos: addressUtxos,
    source,
  }: HardwareWalletBalanceData) => {
    setAddressInfo(info);
    setUtxos(addressUtxos);
    setBalanceSource(source);
  };

  const clearHardwareBalance = () => {
    setAddressInfo(null);
    setUtxos([]);
    setBalanceSource(null);
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
      const balance = await fetchBalanceData(account);

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
      logHardwareWalletEvent(
        'balance:error',
        {
          ...hardwareAccountLogContext(account),
          error: getErrorLogMessage(error),
        },
        'error'
      );
      setBalanceError(getErrorMessage(error, 'Unable to load hardware wallet balance.'));
    } finally {
      if (requestId === balanceRequestIdRef.current) {
        setIsLoadingBalance(false);
      }
    }
  };

  return {
    addressInfo,
    balanceError,
    balanceSource,
    clearHardwareBalance,
    invalidateBalanceRequests,
    isLoadingBalance,
    loadHardwareWalletBalance,
    setBalanceError,
    setHardwareBalanceData,
    utxos,
  };
}
