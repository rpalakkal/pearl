import { installBrowserNodeGlobals } from '../browserNodeGlobals.ts';

export type BufferConstructor = typeof import('buffer').Buffer;

export function preloadHardwareWalletSupport(): void {
  void ensureHardwareWalletBrowserGlobals()
    .then(() => Promise.allSettled([
      import('@ledgerhq/hw-app-btc'),
      import('@ledgerhq/hw-transport-webhid'),
      import('@trezor/connect-web'),
      import('bitcoinjs-lib'),
    ]));
}

export async function loadBitcoinJs() {
  await ensureHardwareWalletBrowserGlobals();
  return import('bitcoinjs-lib');
}

export async function ensureHardwareWalletBuffer(): Promise<BufferConstructor> {
  return installBrowserNodeGlobals();
}

export async function ensureHardwareWalletBrowserGlobals(): Promise<BufferConstructor> {
  return installBrowserNodeGlobals();
}
