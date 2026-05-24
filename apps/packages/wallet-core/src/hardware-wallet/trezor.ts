import { getBitcoinDeviceDisplayAddress } from './address.ts';
import { ensureHardwareWalletBrowserGlobals } from './browser.ts';
import { getTrezorCoin } from './paths.ts';
import {
  buildPearlSendPlan,
  buildTrezorSignTransactionPayload,
  validateSignedHardwareTransaction,
} from './transactions.ts';
import type {
  HardwarePearlSignedTransaction,
  HardwarePearlSendRequest,
  HardwareWalletAddress,
  HardwareWalletAddressVerification,
  PearlNetwork,
} from './types.ts';

let trezorConnectPromise: Promise<typeof import('@trezor/connect-web').default> | null = null;

export async function getTrezorPublicKey(path: string, network: PearlNetwork): Promise<string> {
  const TrezorConnect = await getTrezorConnect();
  const response = await runTrezorAction(() => TrezorConnect.getPublicKey({
    path,
    coin: getTrezorCoin(network),
    crossChain: true,
    scriptType: 'SPENDTAPROOT',
  }));

  return response.payload.publicKey;
}

export async function verifyTrezorWalletAddress(
  account: HardwareWalletAddress
): Promise<HardwareWalletAddressVerification> {
  const expectedDeviceAddress = getBitcoinDeviceDisplayAddress(account.address, account.network);
  const TrezorConnect = await getTrezorConnect();
  const response = await runTrezorAction(() => TrezorConnect.getAddress({
    path: account.path,
    coin: getTrezorCoin(account.network),
    crossChain: true,
    scriptType: 'SPENDTAPROOT',
    showOnTrezor: true,
  }));

  if (response.payload.address !== expectedDeviceAddress) {
    throw new Error('Trezor returned a different address than the connected hardware account.');
  }

  return {
    pearlAddress: account.address,
    deviceDisplayAddress: response.payload.address,
    path: account.path,
  };
}

export async function signTrezorPearlTransaction(
  request: HardwarePearlSendRequest
): Promise<HardwarePearlSignedTransaction> {
  if (request.account.vendor !== 'trezor') {
    throw new Error('Trezor signing requested for a non-Trezor account.');
  }

  const plan = await buildPearlSendPlan(request);
  const TrezorConnect = await getTrezorConnect();
  const response = await runTrezorAction(() => TrezorConnect.signTransaction(
    buildTrezorSignTransactionPayload(request, plan)
  ));
  const rawTransactionHex = getTrezorSerializedTransaction(response.payload);
  await validateSignedHardwareTransaction(rawTransactionHex, request, plan);

  return {
    rawTransactionHex,
    feeSats: plan.feeSats,
    changeSats: plan.changeSats,
    inputCount: plan.selectedUtxos.length,
  };
}

export function resetTrezorConnectSession(): void {
  trezorConnectPromise = null;
}

async function getTrezorConnect() {
  if (!trezorConnectPromise) {
    trezorConnectPromise = initializeTrezorConnect().catch(error => {
      resetTrezorConnectSession();
      throw error;
    });
  }

  return trezorConnectPromise;
}

async function initializeTrezorConnect() {
  await ensureHardwareWalletBrowserGlobals();
  const { default: TrezorConnect } = await import('@trezor/connect-web');

  await TrezorConnect.init({
    manifest: {
      appName: 'Pearl Wallet',
      appUrl: 'https://pearlresearch.ai',
      email: 'support@pearlresearch.ai',
    },
    lazyLoad: true,
    popup: true,
    trustedHost: true,
  });

  return TrezorConnect;
}

async function runTrezorAction<T extends { success: boolean; payload: unknown }>(
  action: () => Promise<T>
): Promise<T & { success: true }> {
  try {
    const response = await action();

    if (!response.success) {
      throw new Error(getTrezorPayloadError(response.payload));
    }

    return response as T & { success: true };
  } catch (error) {
    if (isRecoverableTrezorSessionError(error)) {
      resetTrezorConnectSession();
    }

    throw error;
  }
}

function getTrezorPayloadError(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    return String(payload.error);
  }

  return 'Trezor action did not complete.';
}

function getTrezorSerializedTransaction(payload: { serializedTx?: unknown }): string {
  if (typeof payload.serializedTx !== 'string' || payload.serializedTx.trim() === '') {
    throw new Error('Trezor did not return a signed transaction.');
  }

  return payload.serializedTx;
}

function isRecoverableTrezorSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();

  return (
    message.includes('failure_actioncancelled') ||
    message.includes('action cancelled') ||
    message.includes('actioncancelled') ||
    message.includes("reading 'trim'") ||
    message.includes('popup') ||
    message.includes('iframe')
  );
}
