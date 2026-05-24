import { derivePearlTaprootAddress, getBitcoinDeviceDisplayAddress } from './address.ts';
import { validateHardwareWalletDeviceAccount } from './account.ts';
import { ensureHardwareWalletBuffer, ensureHardwareWalletBrowserGlobals } from './browser.ts';
import { isLedgerUnsupportedTaprootAddressError } from './errors.ts';
import { getLedgerCurrency } from './paths.ts';
import {
  buildLedgerSignPsbtOptions,
  buildPearlSendPlan,
  validateSignedHardwareTransaction,
} from './transactions.ts';
import type {
  HardwarePearlSignedTransaction,
  HardwarePearlSendRequest,
  HardwareWalletAddress,
  HardwareWalletAddressVerification,
  PearlNetwork,
} from './types.ts';

type LedgerWalletPublicKeyFormat = 'bech32m' | 'legacy';
type LedgerWalletPublicKeyResponse = {
  publicKey: string;
  bitcoinAddress: string;
};
type LedgerWalletPublicKeyReader = (
  format: LedgerWalletPublicKeyFormat
) => Promise<LedgerWalletPublicKeyResponse>;
type LedgerTransportWebHID = typeof import('@ledgerhq/hw-transport-webhid').default;

export async function getLedgerPublicKey(path: string, network: PearlNetwork): Promise<string> {
  const response = await getLedgerWalletPublicKey(path, network, false, false);
  return response.publicKey;
}

export async function verifyLedgerWalletAddress(
  account: HardwareWalletAddress
): Promise<HardwareWalletAddressVerification> {
  const expectedDeviceAddress = getBitcoinDeviceDisplayAddress(account.address, account.network);
  const response = await getLedgerWalletPublicKey(account.path, account.network, true, true);
  const pearlAddress = derivePearlTaprootAddress(response.publicKey, account.network);

  if (pearlAddress !== account.address || response.bitcoinAddress !== expectedDeviceAddress) {
    throw new Error('Ledger returned a different address than the connected hardware account.');
  }

  return {
    pearlAddress,
    deviceDisplayAddress: response.bitcoinAddress,
    path: account.path,
  };
}

export async function signLedgerPearlTransaction(
  request: HardwarePearlSendRequest
): Promise<HardwarePearlSignedTransaction> {
  if (request.account.vendor !== 'ledger') {
    throw new Error('Ledger signing requested for a non-Ledger account.');
  }

  const Buffer = await ensureHardwareWalletBuffer();
  const TransportWebHID = await getLedgerTransportWebHID();
  const transport = await openLedgerTransport(TransportWebHID, true);
  try {
    const plan = await buildPearlSendPlan(request);
    const { default: Btc } = await import('@ledgerhq/hw-app-btc');
    const app = new Btc({
      transport,
      currency: getLedgerCurrency(request.account.network),
    });
    const deviceAccount = await readLedgerTaprootWalletPublicKey(
      async format => {
        const response = await app.getWalletPublicKey(request.account.path.replace(/^m\//, ''), {
          format,
          verify: false,
        });

        return {
          publicKey: response.publicKey,
          bitcoinAddress: response.bitcoinAddress,
        };
      },
      false
    );
    validateHardwareWalletDeviceAccount(
      request.account,
      deviceAccount.publicKey,
      deviceAccount.bitcoinAddress
    );
    const signed = await app.signPsbtBuffer(
      Buffer.from(plan.psbtBuffer),
      await buildLedgerSignPsbtOptions(request.account, plan)
    );

    if (!signed.tx) {
      throw new Error('Ledger did not return a finalized transaction.');
    }

    await validateSignedHardwareTransaction(signed.tx, request, plan);

    return {
      rawTransactionHex: signed.tx,
      feeSats: plan.feeSats,
      changeSats: plan.changeSats,
      inputCount: plan.selectedUtxos.length,
    };
  } finally {
    await transport.close();
  }
}

export async function readLedgerTaprootWalletPublicKey(
  readWalletPublicKey: LedgerWalletPublicKeyReader,
  verify: boolean
): Promise<LedgerWalletPublicKeyResponse> {
  try {
    return await readWalletPublicKey('bech32m');
  } catch (error) {
    if (verify || !isLedgerUnsupportedTaprootAddressError(error)) {
      throw error;
    }

    const response = await readWalletPublicKey('legacy');

    return {
      publicKey: response.publicKey,
      bitcoinAddress: '',
    };
  }
}

async function getLedgerWalletPublicKey(
  path: string,
  network: PearlNetwork,
  verify: boolean,
  preferConnected: boolean
): Promise<{ publicKey: string; bitcoinAddress: string }> {
  const TransportWebHID = await getLedgerTransportWebHID();
  const transport = await openLedgerTransport(TransportWebHID, preferConnected);

  try {
    const { default: Btc } = await import('@ledgerhq/hw-app-btc');
    const app = new Btc({ transport, currency: getLedgerCurrency(network) });
    return await readLedgerTaprootWalletPublicKey(
      async format => {
        const response = await app.getWalletPublicKey(path.replace(/^m\//, ''), {
          format,
          verify,
        });

        return {
          publicKey: response.publicKey,
          bitcoinAddress: response.bitcoinAddress,
        };
      },
      verify
    );
  } finally {
    await transport.close();
  }
}

async function getLedgerTransportWebHID(): Promise<LedgerTransportWebHID> {
  await ensureHardwareWalletBrowserGlobals();
  const { default: TransportWebHID } = await import('@ledgerhq/hw-transport-webhid');
  const supported = await TransportWebHID.isSupported();

  if (!supported) {
    throw new Error('Ledger WebHID is not available in this Electron runtime.');
  }

  return TransportWebHID;
}

async function openLedgerTransport(
  TransportWebHID: LedgerTransportWebHID,
  preferConnected: boolean
): Promise<InstanceType<LedgerTransportWebHID>> {
  if (preferConnected) {
    try {
      const connectedTransport = await TransportWebHID.openConnected();

      if (connectedTransport) {
        return connectedTransport;
      }
    } catch {
      // Fall back to the explicit device picker below.
    }
  }

  return TransportWebHID.request();
}
