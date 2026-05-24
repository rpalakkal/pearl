import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { HardwareWalletAddress } from './hardwareWallet.ts';

export const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
export const mainnetAddress = 'prl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sse9xfq3';
export const testnetAddress = 'tprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssj2zhly';

export const account: HardwareWalletAddress = {
  vendor: 'ledger',
  address: mainnetAddress,
  path: "m/86'/0'/0'/0/0",
  publicKey,
  network: 'mainnet',
  addressIndex: 0,
};

export const trezorAccount: HardwareWalletAddress = {
  ...account,
  vendor: 'trezor',
};

const secp256k1Order = secp256k1.Point.Fn.ORDER;

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function tweakPrivateKeyForBip86(secretScalar: bigint): Uint8Array {
  const internalPoint = secp256k1.Point.BASE.multiply(secretScalar);
  const internalPubkey = internalPoint.toBytes(true);
  const internalXOnly = internalPubkey.slice(1);
  const effectiveSecret = internalPubkey[0] === 0x03
    ? secp256k1Order - secretScalar
    : secretScalar;
  const tag = sha256(new TextEncoder().encode('TapTweak'));
  const tweak = bytesToBigInt(sha256(concatBytes(tag, tag, internalXOnly)));
  const tweakedSecret = (effectiveSecret + tweak) % secp256k1Order;

  if (tweakedSecret === 0n) {
    throw new Error('Test fixture produced an invalid tweaked private key.');
  }

  return secp256k1.Point.Fn.toBytes(tweakedSecret);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.reduce((value, byte) => (value << 8n) + BigInt(byte), 0n);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}
