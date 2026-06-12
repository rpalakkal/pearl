import {secp256k1, schnorr} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {concatBytes} from '@noble/hashes/utils.js';
import {bech32m} from 'bech32';
import {networkConfig} from './constants.ts';
import type {PearlNetwork} from './types.ts';

const textEncoder = new TextEncoder();
const tapTweakTag = sha256(textEncoder.encode('TapTweak'));

export function derivePearlTaprootAddress(publicKeyHex: string, network: PearlNetwork): string {
  const outputKey = derivePearlTaprootOutputKey(publicKeyHex);

  const words = bech32m.toWords(outputKey);
  return bech32m.encode(networkConfig[network].hrp, [1, ...words]);
}

export function derivePearlTaprootOutputKey(publicKeyHex: string): Uint8Array {
  const internalPubkey = xOnlyPublicKeyFromHex(publicKeyHex);
  const tweak = taggedHash(tapTweakTag, internalPubkey);
  return taprootOutputKey(internalPubkey, tweak);
}

export function pearlTaprootScriptFromAddress(address: string, network: PearlNetwork): Uint8Array {
  const outputKey = pearlTaprootOutputKeyFromAddress(address, network);
  return Uint8Array.from([0x51, 0x20, ...outputKey]);
}

export function pearlTaprootOutputKeyFromAddress(
  address: string,
  network: PearlNetwork
): Uint8Array {
  let decoded: ReturnType<typeof bech32m.decode>;

  try {
    decoded = bech32m.decode(address);
  } catch {
    throw new Error('Recipient must be a valid Pearl Taproot address.');
  }

  if (decoded.prefix !== networkConfig[network].hrp) {
    throw new Error(`Recipient address must use the ${networkConfig[network].hrp} network prefix.`);
  }

  const [version, ...programWords] = decoded.words;
  const program = Uint8Array.from(bech32m.fromWords(programWords));

  if (version !== 1 || program.length !== 32) {
    throw new Error('Hardware wallet sends currently support Pearl Taproot addresses only.');
  }

  return program;
}

export function getBitcoinDeviceDisplayAddress(address: string, network: PearlNetwork): string {
  const outputKey = pearlTaprootOutputKeyFromAddress(address, network);
  const words = bech32m.toWords(outputKey);
  return bech32m.encode(networkConfig[network].deviceHrp, [1, ...words]);
}

export function xOnlyPublicKeyFromHex(publicKeyHex: string): Uint8Array {
  const publicKey = hexToBytes(publicKeyHex);

  if (publicKey.length === 32) {
    try {
      const point = schnorr.utils.lift_x(bytesToBigInt(publicKey));
      return schnorr.utils.pointToBytes(point);
    } catch {
      throw new Error('The device returned an invalid x-only public key.');
    }
  }

  if (publicKey.length === 33 || publicKey.length === 65) {
    try {
      const point = secp256k1.Point.fromBytes(publicKey);
      return schnorr.utils.pointToBytes(point);
    } catch {
      throw new Error('The device returned an invalid public key.');
    }
  }

  throw new Error('The device returned an unsupported public key format.');
}

export function compressedPublicKeyFromHex(publicKeyHex: string): Uint8Array {
  const publicKey = hexToBytes(publicKeyHex);

  if (publicKey.length === 32) {
    try {
      const point = schnorr.utils.lift_x(bytesToBigInt(publicKey));
      return point.toBytes(true);
    } catch {
      throw new Error('The device returned an invalid x-only public key.');
    }
  }

  if (publicKey.length === 33 || publicKey.length === 65) {
    try {
      return secp256k1.Point.fromBytes(publicKey).toBytes(true);
    } catch {
      throw new Error('The device returned an invalid public key.');
    }
  }

  throw new Error('The device returned an unsupported public key format.');
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();

  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('The device returned a malformed public key.');
  }

  const result = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < result.length; i += 1) {
    result[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }

  return result;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function buffersEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((byte, index) => byte === right[index]);
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  return value;
}

function taprootOutputKey(internalPubkey: Uint8Array, tweakBytes: Uint8Array): Uint8Array {
  const tweak = bytesToBigInt(tweakBytes);

  if (!secp256k1.Point.Fn.isValid(tweak)) {
    throw new Error('Unable to derive a valid Taproot tweak from the device public key.');
  }

  const internalPoint = schnorr.utils.lift_x(bytesToBigInt(internalPubkey));
  const tweakPoint = tweak === 0n ? secp256k1.Point.ZERO : secp256k1.Point.BASE.multiply(tweak);
  const tweakedPoint = internalPoint.add(tweakPoint);

  if (tweakedPoint.equals(secp256k1.Point.ZERO)) {
    throw new Error('Unable to derive a Taproot output key from the device public key.');
  }

  return schnorr.utils.pointToBytes(tweakedPoint);
}

function taggedHash(tagHash: Uint8Array, message: Uint8Array): Uint8Array {
  return sha256(concatBytes(tagHash, tagHash, message));
}
