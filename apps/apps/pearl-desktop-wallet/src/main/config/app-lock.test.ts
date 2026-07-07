import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as appLock from './app-lock.ts';

// Point the vault at a fresh temp dir for every test; app-lock resolves the
// settings dir lazily via this env override.
beforeEach(() => {
  appLock.lock();
  process.env.PEARL_WALLET_SETTINGS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-vault-'));
});

function vaultFile(): string {
  return path.join(process.env.PEARL_WALLET_SETTINGS_DIR!, 'vault.json');
}

test('status starts uninitialized, setup unlocks, lock locks', async () => {
  assert.equal(appLock.getStatus(), 'uninitialized');
  await appLock.setup('correct horse battery');
  assert.equal(appLock.getStatus(), 'unlocked');
  assert.ok(fs.existsSync(vaultFile()));

  appLock.lock();
  assert.equal(appLock.getStatus(), 'locked');
});

test('unlock round-trips stored wallet passphrases', async () => {
  await appLock.setup('correct horse battery');
  appLock.storeWalletPassphrase('main-wallet', 'legacy-pass-123');
  appLock.lock();

  await appLock.unlock('correct horse battery');
  assert.equal(appLock.hasWalletPassphrase('main-wallet'), true);
  assert.equal(appLock.getWalletPassphrase('main-wallet'), 'legacy-pass-123');
  assert.equal(appLock.getWalletPassphrase('other'), null);
});

test('wrong password is rejected uniformly', async () => {
  await appLock.setup('correct horse battery');
  appLock.lock();

  await assert.rejects(appLock.unlock('wrong password!'), /Incorrect password/);
  assert.equal(appLock.getStatus(), 'locked');
});

test('short passwords are rejected at setup and change', async () => {
  await assert.rejects(appLock.setup('short'), /at least 8/);
  await appLock.setup('long enough password');
  await assert.rejects(appLock.changePassword('long enough password', 'tiny'), /at least 8/);
});

test('vault access requires unlock', async () => {
  await appLock.setup('correct horse battery');
  appLock.lock();
  assert.throws(() => appLock.storeWalletPassphrase('w', 'p'), /App is locked/);
  assert.throws(() => appLock.getWalletPassphrase('w'), /App is locked/);
});

test('changePassword re-encrypts and keeps the payload', async () => {
  await appLock.setup('old password 123');
  appLock.storeWalletPassphrase('w1', 'p1');

  const before = JSON.parse(fs.readFileSync(vaultFile(), 'utf-8'));
  await appLock.changePassword('old password 123', 'new password 456');
  const after = JSON.parse(fs.readFileSync(vaultFile(), 'utf-8'));

  assert.notEqual(before.kdf.salt, after.kdf.salt);
  assert.notEqual(before.ciphertext, after.ciphertext);

  appLock.lock();
  await assert.rejects(appLock.unlock('old password 123'), /Incorrect password/);
  await appLock.unlock('new password 456');
  assert.equal(appLock.getWalletPassphrase('w1'), 'p1');
});

test('changePassword verifies the current password', async () => {
  await appLock.setup('old password 123');
  await assert.rejects(
    appLock.changePassword('not the password', 'new password 456'),
    /Incorrect password/
  );
});

test('tampered vault fails to unlock', async () => {
  await appLock.setup('correct horse battery');
  appLock.storeWalletPassphrase('w1', 'p1');
  appLock.lock();

  const file = JSON.parse(fs.readFileSync(vaultFile(), 'utf-8'));
  const bytes = Buffer.from(file.ciphertext, 'base64');
  bytes[0] ^= 0xff;
  file.ciphertext = bytes.toString('base64');
  fs.writeFileSync(vaultFile(), JSON.stringify(file));

  await assert.rejects(appLock.unlock('correct horse battery'), /Incorrect password/);
});

test('every write uses a fresh IV and leaves a backup', async () => {
  await appLock.setup('correct horse battery');
  const iv1 = JSON.parse(fs.readFileSync(vaultFile(), 'utf-8')).iv;

  appLock.storeWalletPassphrase('w1', 'p1');
  const iv2 = JSON.parse(fs.readFileSync(vaultFile(), 'utf-8')).iv;
  appLock.storeWalletPassphrase('w2', 'p2');
  const iv3 = JSON.parse(fs.readFileSync(vaultFile(), 'utf-8')).iv;

  assert.equal(new Set([iv1, iv2, iv3]).size, 3);
  assert.ok(fs.existsSync(`${vaultFile()}.bak`));
});

test('generateWalletPassphrase returns unique 64-char hex', () => {
  const a = appLock.generateWalletPassphrase();
  const b = appLock.generateWalletPassphrase();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('setup refuses to overwrite an existing vault', async () => {
  await appLock.setup('correct horse battery');
  appLock.lock();
  await assert.rejects(appLock.setup('another password'), /already set up/);
});
