/**
 * App-wide lock backed by an encrypted vault of per-wallet passphrases.
 *
 * One password gates the whole app (MetaMask-style). The vault file
 * (~/.pearl-wallet/settings/vault.json) holds the passphrases of the
 * software wallets, encrypted with a key derived from the app password:
 * scrypt for key derivation, AES-256-GCM for the payload. The decrypted
 * key and payload live only in the main process's memory; renderers only
 * see lock status. A wrong password surfaces as a GCM auth failure and is
 * reported uniformly as "incorrect password".
 *
 * Best-effort zeroization: the derived key buffer is zeroed on lock.
 * Passphrase strings themselves cannot be reliably zeroed in JS; this is a
 * known limitation shared with similar wallets.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'crypto';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const KDF_PARAMS = { N: 32768, r: 8, p: 1, keyLen: 32 };
// scrypt needs 128*N*r bytes; leave generous headroom above the ~32MB required.
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 8;

interface VaultData {
  walletPassphrases: Record<string, string>;
  // Recovery phrases, stored at wallet create/import so they can be revealed
  // later (password-gated). Wallets created before this field existed have no
  // entry and can never be revealed retroactively.
  walletMnemonics?: Record<string, string>;
  updatedAt: number;
}

interface VaultFile {
  version: 1;
  kdf: { algo: 'scrypt'; N: number; r: number; p: number; keyLen: number; salt: string };
  cipher: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface UnlockedVault {
  key: Buffer;
  salt: Buffer;
  data: VaultData;
}

let unlockedVault: UnlockedVault | null = null;

// PEARL_WALLET_SETTINGS_DIR is a test-only override so vault tests can run
// against a temp directory instead of the real settings dir.
function settingsDir(): string {
  return (
    process.env.PEARL_WALLET_SETTINGS_DIR ?? path.join(os.homedir(), '.pearl-wallet', 'settings')
  );
}

function vaultPath(): string {
  return path.join(settingsDir(), 'vault.json');
}

function ensureSettingsDir() {
  const dir = settingsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export type AppLockStatus = 'uninitialized' | 'locked' | 'unlocked';

export function getStatus(): AppLockStatus {
  if (unlockedVault) {
    return 'unlocked';
  }
  return fs.existsSync(vaultPath()) ? 'locked' : 'uninitialized';
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, KDF_PARAMS.keyLen, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

function encryptVault(key: Buffer, salt: Buffer, data: VaultData): VaultFile {
  // Fresh random IV on every write: GCM nonce reuse under the same key is
  // catastrophic.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);

  return {
    version: 1,
    kdf: { algo: 'scrypt', ...KDF_PARAMS, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptVault(file: VaultFile, key: Buffer): VaultData {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(file.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(file.ciphertext, 'base64')),
    decipher.final(), // throws on wrong key or tampered file
  ]).toString('utf8');

  const parsed = JSON.parse(plaintext) as VaultData;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.walletPassphrases !== 'object') {
    throw new Error('Vault payload is malformed');
  }
  return parsed;
}

function isVaultFile(value: unknown): value is VaultFile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const file = value as Partial<VaultFile>;
  return (
    file.version === 1 &&
    file.cipher === 'aes-256-gcm' &&
    typeof file.iv === 'string' &&
    typeof file.authTag === 'string' &&
    typeof file.ciphertext === 'string' &&
    !!file.kdf &&
    file.kdf.algo === 'scrypt' &&
    typeof file.kdf.salt === 'string'
  );
}

function readVaultFile(): VaultFile | null {
  if (!fs.existsSync(vaultPath())) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(vaultPath(), 'utf-8'));
  if (!isVaultFile(parsed)) {
    throw new Error('Vault file is malformed');
  }
  return parsed;
}

function writeVaultFile(file: VaultFile) {
  ensureSettingsDir();
  const target = vaultPath();
  const tmp = `${target}.tmp`;

  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: 'utf-8', mode: 0o600 });
  if (fs.existsSync(target)) {
    fs.copyFileSync(target, `${target}.bak`);
  }
  fs.renameSync(tmp, target);
}

function requireUnlocked(): UnlockedVault {
  if (!unlockedVault) {
    throw new Error('App is locked');
  }
  return unlockedVault;
}

function persist() {
  const vault = requireUnlocked();
  vault.data.updatedAt = Date.now();
  writeVaultFile(encryptVault(vault.key, vault.salt, vault.data));
}

function assertValidPassword(password: string) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export async function setup(password: string): Promise<void> {
  if (getStatus() !== 'uninitialized') {
    throw new Error('App lock is already set up');
  }
  assertValidPassword(password);

  const salt = randomBytes(32);
  const key = await deriveKey(password, salt);
  const data: VaultData = { walletPassphrases: {}, updatedAt: Date.now() };

  unlockedVault = { key, salt, data };
  persist();
}

export async function unlock(password: string): Promise<void> {
  const file = readVaultFile();
  if (!file) {
    throw new Error('App lock has not been set up');
  }

  const salt = Buffer.from(file.kdf.salt, 'base64');
  const key = await deriveKey(password, salt);

  let data: VaultData;
  try {
    data = decryptVault(file, key);
  } catch {
    key.fill(0);
    throw new Error('Incorrect password');
  }

  unlockedVault = { key, salt, data };
}

export function lock(): void {
  if (unlockedVault) {
    unlockedVault.key.fill(0);
    unlockedVault = null;
  }
}

// Verifies against the file even while unlocked, so password-gated actions
// (reveal seed, delete wallet) always re-prompt meaningfully.
export async function verifyPassword(password: string): Promise<void> {
  await unlock(password);
}

export async function changePassword(currentPassword: string, nextPassword: string): Promise<void> {
  assertValidPassword(nextPassword);

  // Always verify the current password against the file, even if unlocked.
  await verifyPassword(currentPassword);
  const { data } = requireUnlocked();

  const salt = randomBytes(32);
  const key = await deriveKey(nextPassword, salt);
  unlockedVault = { key, salt, data };
  persist();
}

export function hasWalletPassphrase(walletName: string): boolean {
  return requireUnlocked().data.walletPassphrases[walletName] !== undefined;
}

// Main-process use only; never exposed over IPC.
export function getWalletPassphrase(walletName: string): string | null {
  return requireUnlocked().data.walletPassphrases[walletName] ?? null;
}

export function storeWalletPassphrase(walletName: string, passphrase: string): void {
  if (!walletName || !passphrase) {
    throw new Error('Wallet name and passphrase are required');
  }
  const vault = requireUnlocked();
  vault.data.walletPassphrases[walletName] = passphrase;
  persist();
}

// Random passphrase for wallets created after the vault exists; the seed
// phrase is the recovery path if the vault is ever lost.
export function generateWalletPassphrase(): string {
  return randomBytes(32).toString('hex');
}

export function storeWalletMnemonic(walletName: string, mnemonic: string): void {
  if (!walletName || !mnemonic) {
    throw new Error('Wallet name and mnemonic are required');
  }
  const vault = requireUnlocked();
  vault.data.walletMnemonics = {
    ...vault.data.walletMnemonics,
    [walletName]: mnemonic,
  };
  persist();
}

export function hasWalletMnemonic(walletName: string): boolean {
  return requireUnlocked().data.walletMnemonics?.[walletName] !== undefined;
}

// Password-gated even while unlocked: revealing the seed is the most
// sensitive read the app offers.
export async function revealWalletMnemonic(
  walletName: string,
  password: string
): Promise<string | null> {
  await verifyPassword(password);
  return requireUnlocked().data.walletMnemonics?.[walletName] ?? null;
}

// Moves the passphrase and mnemonic entries to a new wallet name in one
// persisted write. Missing entries are skipped silently.
export function renameWalletEntries(oldName: string, newName: string): void {
  const vault = requireUnlocked();
  let changed = false;

  const passphrase = vault.data.walletPassphrases[oldName];
  if (passphrase !== undefined) {
    vault.data.walletPassphrases[newName] = passphrase;
    delete vault.data.walletPassphrases[oldName];
    changed = true;
  }

  const mnemonic = vault.data.walletMnemonics?.[oldName];
  if (mnemonic !== undefined) {
    vault.data.walletMnemonics![newName] = mnemonic;
    delete vault.data.walletMnemonics![oldName];
    changed = true;
  }

  if (changed) {
    persist();
  }
}

export function removeWalletEntries(walletName: string): void {
  const vault = requireUnlocked();
  let changed = false;

  if (vault.data.walletPassphrases[walletName] !== undefined) {
    delete vault.data.walletPassphrases[walletName];
    changed = true;
  }
  if (vault.data.walletMnemonics?.[walletName] !== undefined) {
    delete vault.data.walletMnemonics[walletName];
    changed = true;
  }

  if (changed) {
    persist();
  }
}

// Full reset for the forgot-password path: locks and deletes the vault file
// (and its backup/temp artifacts). Without the vault the random wallet
// passphrases are gone, so callers must also delete the wallet data.
export function resetVault(): void {
  lock();
  for (const suffix of ['', '.bak', '.tmp']) {
    const target = `${vaultPath()}${suffix}`;
    try {
      fs.rmSync(target, { force: true });
    } catch (error) {
      console.warn(`Failed to remove vault artifact ${target}:`, error);
    }
  }
}
