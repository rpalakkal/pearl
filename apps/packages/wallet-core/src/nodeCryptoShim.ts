import { gcm } from '@noble/ciphers/aes.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

type BinaryLike = string | ArrayBuffer | ArrayBufferView | ArrayLike<number>;
type HashEncoding = BufferEncoding | 'buffer';
type AnyBuffer = Buffer<ArrayBufferLike>;
type RandomBytesCallback = (error: Error | null, bytes: AnyBuffer) => void;

const GCM_AUTH_TAG_BYTES = 16;
const MAX_GET_RANDOM_VALUES_BYTES = 65_536;

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random values are not available in this renderer.');
  }
  return globalThis.crypto;
}

function toBuffer(input: BinaryLike, encoding: BufferEncoding = 'utf8'): AnyBuffer {
  if (typeof input === 'string') {
    return Buffer.from(input, encoding);
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  return Buffer.from(input);
}

function encodeBuffer(buffer: AnyBuffer, encoding?: BufferEncoding): AnyBuffer | string {
  return encoding ? buffer.toString(encoding) : buffer;
}

function normalizeHashAlgorithm(algorithm: string): 'sha256' | 'sha512' {
  const normalized = algorithm.toLowerCase().replace(/-/g, '');
  if (normalized === 'sha256') {
    return 'sha256';
  }
  if (normalized === 'sha512') {
    return 'sha512';
  }
  throw new Error(`Unsupported hash algorithm: ${algorithm}`);
}

class BrowserHash {
  private readonly hash: ReturnType<typeof sha256.create> | ReturnType<typeof sha512.create>;

  constructor(algorithm: string) {
    this.hash = normalizeHashAlgorithm(algorithm) === 'sha256'
      ? sha256.create()
      : sha512.create();
  }

  update(data: BinaryLike, inputEncoding?: BufferEncoding): this {
    this.hash.update(toBuffer(data, inputEncoding));
    return this;
  }

  digest(): AnyBuffer;
  digest(encoding: Exclude<HashEncoding, 'buffer'>): string;
  digest(encoding?: HashEncoding): AnyBuffer | string {
    const digest = Buffer.from(this.hash.digest());
    return encoding && encoding !== 'buffer' ? digest.toString(encoding) : digest;
  }
}

function validateAesGcmInputs(
  algorithm: string,
  key: BinaryLike,
  authTagLength?: number
): AnyBuffer {
  if (algorithm.toLowerCase() !== 'aes-256-gcm') {
    throw new Error(`Unsupported cipher algorithm: ${algorithm}`);
  }

  if (authTagLength !== undefined && authTagLength !== GCM_AUTH_TAG_BYTES) {
    throw new Error(`Unsupported AES-GCM auth tag length: ${authTagLength}`);
  }

  const keyBytes = toBuffer(key);
  if (keyBytes.length !== 32) {
    throw new Error(`AES-256-GCM requires a 32-byte key, received ${keyBytes.length} bytes.`);
  }
  return keyBytes;
}

class BrowserAesGcmCipher {
  private aad: AnyBuffer = Buffer.alloc(0);
  private authTag?: AnyBuffer;
  private readonly key: AnyBuffer;
  private readonly iv: AnyBuffer;
  private updated = false;

  constructor(key: AnyBuffer, iv: AnyBuffer) {
    this.key = key;
    this.iv = iv;
  }

  setAAD(buffer: BinaryLike): this {
    if (this.updated) {
      throw new Error('setAAD must be called before update.');
    }
    this.aad = toBuffer(buffer);
    return this;
  }

  update(data: BinaryLike, inputEncoding?: BufferEncoding, outputEncoding?: BufferEncoding): AnyBuffer | string {
    if (this.updated) {
      throw new Error('AES-GCM shim supports one update call per cipher.');
    }
    this.updated = true;

    const encrypted = Buffer.from(gcm(this.key, this.iv, this.aad).encrypt(toBuffer(data, inputEncoding)));
    this.authTag = encrypted.subarray(encrypted.length - GCM_AUTH_TAG_BYTES);
    return encodeBuffer(encrypted.subarray(0, -GCM_AUTH_TAG_BYTES), outputEncoding);
  }

  final(outputEncoding?: BufferEncoding): AnyBuffer | string {
    return encodeBuffer(Buffer.alloc(0), outputEncoding);
  }

  getAuthTag(): AnyBuffer {
    if (!this.authTag) {
      throw new Error('Authentication tag is not available until update has been called.');
    }
    return Buffer.from(this.authTag);
  }
}

class BrowserAesGcmDecipher {
  private aad: AnyBuffer = Buffer.alloc(0);
  private authTag?: AnyBuffer;
  private readonly key: AnyBuffer;
  private readonly iv: AnyBuffer;
  private updated = false;

  constructor(key: AnyBuffer, iv: AnyBuffer) {
    this.key = key;
    this.iv = iv;
  }

  setAAD(buffer: BinaryLike): this {
    if (this.updated) {
      throw new Error('setAAD must be called before update.');
    }
    this.aad = toBuffer(buffer);
    return this;
  }

  setAuthTag(tag: BinaryLike): this {
    this.authTag = toBuffer(tag);
    if (this.authTag.length !== GCM_AUTH_TAG_BYTES) {
      throw new Error(`AES-GCM auth tag must be ${GCM_AUTH_TAG_BYTES} bytes.`);
    }
    return this;
  }

  update(data: BinaryLike, inputEncoding?: BufferEncoding, outputEncoding?: BufferEncoding): AnyBuffer | string {
    if (this.updated) {
      throw new Error('AES-GCM shim supports one update call per decipher.');
    }
    if (!this.authTag) {
      throw new Error('setAuthTag must be called before update.');
    }
    this.updated = true;

    const ciphertext = toBuffer(data, inputEncoding);
    const plaintext = Buffer.from(
      gcm(this.key, this.iv, this.aad).decrypt(Buffer.concat([ciphertext, this.authTag]))
    );
    return encodeBuffer(plaintext, outputEncoding);
  }

  final(outputEncoding?: BufferEncoding): AnyBuffer | string {
    return encodeBuffer(Buffer.alloc(0), outputEncoding);
  }
}

export function createHash(algorithm: string): BrowserHash {
  return new BrowserHash(algorithm);
}

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  return getWebCrypto().getRandomValues(array) as T;
}

export function randomBytes(size: number): AnyBuffer;
export function randomBytes(size: number, callback: RandomBytesCallback): void;
export function randomBytes(size: number, callback?: RandomBytesCallback): AnyBuffer | void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError(`The "size" argument must be a non-negative safe integer. Received ${size}.`);
  }

  const bytes = Buffer.allocUnsafe(size);
  const crypto = getWebCrypto();
  for (let offset = 0; offset < size; offset += MAX_GET_RANDOM_VALUES_BYTES) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + MAX_GET_RANDOM_VALUES_BYTES, size)));
  }

  if (callback) {
    queueMicrotask(() => callback(null, bytes));
    return;
  }
  return bytes;
}

export function randomInt(min: number, max?: number): number {
  const lower = max === undefined ? 0 : min;
  const upper = max === undefined ? min : max;

  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || lower >= upper) {
    throw new RangeError('randomInt requires safe integer bounds with max greater than min.');
  }

  const range = upper - lower;
  if (range > 0x1_0000_0000) {
    throw new RangeError('randomInt range must be less than or equal to 2^32.');
  }

  const maxRange = 0x1_0000_0000 - (0x1_0000_0000 % range);
  const value = new Uint32Array(1);
  do {
    getRandomValues(value);
  } while (value[0] >= maxRange);
  return lower + (value[0] % range);
}

export function createCipheriv(
  algorithm: string,
  key: BinaryLike,
  iv: BinaryLike,
  options?: { authTagLength?: number }
): BrowserAesGcmCipher {
  return new BrowserAesGcmCipher(
    validateAesGcmInputs(algorithm, key, options?.authTagLength),
    toBuffer(iv)
  );
}

export function createDecipheriv(
  algorithm: string,
  key: BinaryLike,
  iv: BinaryLike,
  options?: { authTagLength?: number }
): BrowserAesGcmDecipher {
  return new BrowserAesGcmDecipher(
    validateAesGcmInputs(algorithm, key, options?.authTagLength),
    toBuffer(iv)
  );
}

export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto?.subtle;

export default {
  createCipheriv,
  createDecipheriv,
  createHash,
  getRandomValues,
  randomBytes,
  randomInt,
  subtle,
  webcrypto,
};
