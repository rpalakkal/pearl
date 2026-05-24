import type {HardwareWalletVendor, PearlNetwork} from './types.ts';

export const networkConfig: Record<
  PearlNetwork,
  {
    hrp: string;
    deviceHrp: string;
    coinTypes: Record<HardwareWalletVendor, string>;
  }
> = {
  mainnet: {
    hrp: 'prl',
    deviceHrp: 'bc',
    coinTypes: {
      ledger: '0',
      trezor: '0',
    },
  },
  testnet: {
    hrp: 'tprl',
    deviceHrp: 'tb',
    coinTypes: {
      ledger: '1',
      trezor: '1',
    },
  },
};

export const SATS_PER_PEARL = 100_000_000n;
export const TAPROOT_DUST_SATS = 330n;
export const MIN_FEE_RATE_SATS_PER_VBYTE = 1;
export const FEE_RATE_EPSILON = 1e-9;
export const HARDWARE_TRANSACTION_VERSION = 2;
export const HARDWARE_TRANSACTION_LOCKTIME = 0;
export const HARDWARE_TRANSACTION_SEQUENCE = 0xffffffff;
export const DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX = 0;
export const MAX_HARDWARE_WALLET_ADDRESS_INDEX = 999;
