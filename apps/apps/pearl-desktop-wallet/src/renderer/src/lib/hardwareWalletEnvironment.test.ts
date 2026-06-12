import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from '@pearl/wallet-core/nodeCryptoShim';
import {
  getTrustedHardwareWalletAppOrigins,
  isHardwareWalletDevice,
  isHardwareWalletFrameUrl,
  isHardwareWalletOrigin,
  isTrezorConnectUrl,
} from '../../../../src/main/services/window-service/hardware-wallet-permissions.ts';

test('allows Trezor Connect origins in the renderer content security policy', () => {
  const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  assert.match(indexHtml, /frame-src[^;]*https:\/\/connect\.trezor\.io/);
  assert.match(indexHtml, /frame-src[^;]*https:\/\/suite\.trezor\.io/);
  assert.match(indexHtml, /connect-src[^;]*https:\/\/connect\.trezor\.io/);
  assert.match(indexHtml, /connect-src[^;]*http:\/\/127\.0\.0\.1:21325/);
  assert.match(indexHtml, /connect-src[^;]*http:\/\/127\.0\.0\.1:21328/);
  assert.match(indexHtml, /connect-src[^;]*ws:\/\/127\.0\.0\.1:21335/);
});

test('keeps macOS signing entitlements compatible with hardware wallets', () => {
  const entitlements = readFileSync(
    new URL('../../../../build/entitlements.mac.plist', import.meta.url),
    'utf8'
  );

  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(entitlements, /com\.apple\.security\.device\.usb/);
});

test('keeps macOS package signing wired to hardware wallet entitlements', () => {
  const builderConfig = JSON.parse(
    readFileSync(new URL('../../../../electron-builder.json', import.meta.url), 'utf8')
  ) as {
    mac?: {
      hardenedRuntime?: boolean;
      entitlements?: string;
      entitlementsInherit?: string;
      extendInfo?: {
        NSLocalNetworkUsageDescription?: string;
      };
    };
  };

  assert.equal(builderConfig.mac?.hardenedRuntime, true);
  assert.equal(builderConfig.mac?.entitlements, 'build/entitlements.mac.plist');
  assert.equal(builderConfig.mac?.entitlementsInherit, 'build/entitlements.mac.plist');
  assert.match(
    builderConfig.mac?.extendInfo?.NSLocalNetworkUsageDescription ?? '',
    /Trezor Bridge or Trezor Suite/
  );
});

test('keeps renderer Node polyfills available for hardware signing dependencies', () => {
  const viteConfig = readFileSync(
    new URL('../../../../electron.vite.config.ts', import.meta.url),
    'utf8'
  );
  const packageJson = JSON.parse(
    readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
  ) as {
    dependencies?: Record<string, string>;
  };

  assert.match(
    viteConfig,
    /crypto:\s*resolve\(__dirname,\s*'\.\.\/\.\.\/packages\/wallet-core\/src\/nodeCryptoShim\.ts'\)/
  );
  assert.match(viteConfig, /events:\s*resolve\(__dirname,\s*'node_modules\/events'\)/);
  assert.match(viteConfig, /stream:\s*resolve\(__dirname,\s*'node_modules\/stream-browserify'\)/);
  assert.match(viteConfig, /util:\s*resolve\(__dirname,\s*'node_modules\/util'\)/);
  assert.match(viteConfig, /process:\s*'globalThis\.process'/);
  assert.match(viteConfig, /global:\s*'globalThis'/);
  assert.ok(packageJson.dependencies?.['@pearl/wallet-core']);
  assert.ok(packageJson.dependencies?.events);
  assert.ok(packageJson.dependencies?.['stream-browserify']);
  assert.ok(packageJson.dependencies?.util);
});

test('preloads hardware wallet modules before user-triggered device prompts', () => {
  const hardwareWalletSource = readFileSync(
    new URL('./hardwareWallet.ts', import.meta.url),
    'utf8'
  );
  const browserSource = readFileSync(
    new URL(
      '../../../../../../packages/wallet-core/src/hardware-wallet/browser.ts',
      import.meta.url
    ),
    'utf8'
  );
  const hardwareWalletController = readFileSync(
    new URL('../pages/hardware-wallet/useHardwareWalletController.tsx', import.meta.url),
    'utf8'
  );

  assert.match(hardwareWalletSource, /@pearl\/wallet-core\/hardware/);
  assert.match(browserSource, /export function preloadHardwareWalletSupport/);
  assert.match(browserSource, /ensureHardwareWalletBrowserGlobals\(\)\s*\.then/);
  assert.match(browserSource, /Promise\.allSettled/);
  assert.match(browserSource, /import\('@ledgerhq\/hw-transport-webhid'\)/);
  assert.match(browserSource, /import\('@ledgerhq\/hw-app-btc'\)/);
  assert.match(browserSource, /import\('@trezor\/connect-web'\)/);
  assert.match(hardwareWalletController, /preloadHardwareWalletSupport\(\)/);
});

test('installs the Buffer polyfill before loading browser hardware dependencies', () => {
  const browserSource = readFileSync(
    new URL(
      '../../../../../../packages/wallet-core/src/hardware-wallet/browser.ts',
      import.meta.url
    ),
    'utf8'
  );
  const ledgerSource = readFileSync(
    new URL(
      '../../../../../../packages/wallet-core/src/hardware-wallet/ledger.ts',
      import.meta.url
    ),
    'utf8'
  );
  const trezorSource = readFileSync(
    new URL(
      '../../../../../../packages/wallet-core/src/hardware-wallet/trezor.ts',
      import.meta.url
    ),
    'utf8'
  );
  const browserGlobalsSource = readFileSync(
    new URL('../../../../../../packages/wallet-core/src/browserNodeGlobals.ts', import.meta.url),
    'utf8'
  );
  const rendererEntrySource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');

  assert.match(browserSource, /type BufferConstructor = typeof import\('buffer'\)\.Buffer/);
  assert.match(
    browserSource,
    /async function ensureHardwareWalletBrowserGlobals\(\): Promise<BufferConstructor>/
  );
  assert.match(browserSource, /installBrowserNodeGlobals\(\)/);
  assert.match(browserGlobalsSource, /type BrowserProcessShim =/);
  assert.match(browserGlobalsSource, /export function installBrowserNodeProcess\(\): void/);
  assert.match(
    browserGlobalsSource,
    /export async function installBrowserNodeGlobals\(\): Promise<BufferConstructor>/
  );
  assert.match(browserGlobalsSource, /process\?: BrowserProcessShim/);
  assert.match(browserGlobalsSource, /browser: true/);
  assert.match(browserGlobalsSource, /nextTick\(callback, \.\.\.args\)/);
  assert.match(browserGlobalsSource, /stdout: undefined/);
  assert.doesNotMatch(rendererEntrySource, /installBrowserNodeProcess\(\)/);
  assert.doesNotMatch(rendererEntrySource, /void import\('\.\/App'\)/);
  assert.match(
    ledgerSource,
    /await ensureHardwareWalletBrowserGlobals\(\);\s*const \{\s*default:\s*TransportWebHID\s*\} = await import\('@ledgerhq\/hw-transport-webhid'\)/
  );
  assert.match(
    trezorSource,
    /await ensureHardwareWalletBrowserGlobals\(\);\s*const \{\s*default:\s*TrezorConnect\s*\} = await import\('@trezor\/connect-web'\)/
  );
});

test('implements the renderer crypto shim surface used by Trezor Connect', () => {
  const key = Buffer.alloc(32, 1);
  const iv = Buffer.alloc(12, 2);
  const aad = Buffer.from('pearl');
  const plaintext = Buffer.from('hardware-wallet');
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  cipher.setAAD(aad);
  const ciphertext = cipher.update(plaintext);
  assert.ok(Buffer.isBuffer(ciphertext));
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const decrypted = decipher.update(ciphertext);
  const finalChunk = decipher.final();
  assert.ok(Buffer.isBuffer(decrypted));
  assert.ok(Buffer.isBuffer(finalChunk));

  assert.equal(createHash('sha256').update('pearl').digest('hex').length, 64);
  assert.equal(createHash('sha512').update('pearl').digest().length, 64);
  assert.equal(Buffer.concat([decrypted, finalChunk]).toString(), 'hardware-wallet');
  assert.equal(randomBytes(32).length, 32);
  assert.ok(randomInt(10, 20) >= 10);
  assert.ok(randomInt(10, 20) < 20);

  const emptyCipher = createCipheriv('aes-256-gcm', key, iv);
  emptyCipher.setAAD(aad);
  const emptyCiphertext = emptyCipher.update(Buffer.alloc(0));
  const emptyTag = emptyCipher.getAuthTag();
  const emptyDecipher = createDecipheriv('aes-256-gcm', key, iv);
  emptyDecipher.setAAD(aad);
  emptyDecipher.setAuthTag(emptyTag);
  assert.ok(Buffer.isBuffer(emptyCiphertext));
  assert.equal(emptyCiphertext.length, 0);
  assert.equal(emptyDecipher.update(emptyCiphertext).length, 0);
});

test('identifies only Ledger and Trezor HID/USB devices for Electron permissions', () => {
  assert.equal(isHardwareWalletDevice({vendorId: 0x2c97, productId: 0x5011}), true);
  assert.equal(isHardwareWalletDevice({vendorId: 0x534c, productId: 0x0001}), true);
  assert.equal(isHardwareWalletDevice({vendorId: 0x1209, productId: 0x53c0}), true);
  assert.equal(isHardwareWalletDevice({vendorId: 0x1209, productId: 0x53c1}), true);
  assert.equal(isHardwareWalletDevice({vendorId: 0x1209, productId: 0x0001}), false);
  assert.equal(isHardwareWalletDevice({vendorId: 0x1234, productId: 0x0001}), false);
  assert.equal(
    isHardwareWalletDevice({vendorId: 0x1234, productId: 0x0001, name: 'Ledger Nano X'}),
    true
  );
  assert.equal(
    isHardwareWalletDevice({
      vendorId: 0x1234,
      productId: 0x0001,
      manufacturerName: 'SatoshiLabs',
      productName: 'Trezor',
    }),
    true
  );
});

test('keeps Electron HID and USB permissions scoped to hardware wallet frames and origins', () => {
  const localhostOrigins = getTrustedHardwareWalletAppOrigins(
    'http://localhost:5173/#/hardware-wallet'
  );
  const loopbackOrigins = getTrustedHardwareWalletAppOrigins(
    'http://127.0.0.1:5173/#/hardware-wallet'
  );

  assert.equal(
    isHardwareWalletFrameUrl(
      'file:///Applications/Pearl.app/Contents/Resources/app.asar/out/renderer/index.html'
    ),
    true
  );
  assert.equal(isHardwareWalletFrameUrl('file:///tmp/other.html'), false);
  assert.equal(isHardwareWalletOrigin('file://'), false);
  assert.equal(isHardwareWalletOrigin('file://', {allowFileOrigin: true}), true);
  assert.deepEqual(localhostOrigins, ['http://localhost:5173']);
  assert.equal(
    isHardwareWalletOrigin('http://localhost:5173', {allowedAppOrigins: localhostOrigins}),
    true
  );
  assert.equal(
    isHardwareWalletOrigin('http://127.0.0.1:5173', {allowedAppOrigins: localhostOrigins}),
    false
  );
  assert.equal(
    isHardwareWalletOrigin('http://127.0.0.1:5173', {allowedAppOrigins: loopbackOrigins}),
    true
  );
  assert.equal(
    isHardwareWalletFrameUrl('http://localhost:5173/#/hardware-wallet', {
      allowedAppOrigins: localhostOrigins,
    }),
    true
  );
  assert.equal(isHardwareWalletOrigin('https://connect.trezor.io/9/iframe.html'), true);
  assert.equal(isHardwareWalletOrigin('https://suite.trezor.io/webusb'), true);
  assert.equal(isTrezorConnectUrl('https://connect.trezor.io/9/iframe.html'), true);
  assert.equal(
    isTrezorConnectUrl('https://connect.trezor.io/9/popup.html?version=9.7.3&env=web'),
    true
  );
  assert.equal(isTrezorConnectUrl('https://connect.trezor.io/9/webusb.html'), true);
  assert.equal(isTrezorConnectUrl('https://suite.trezor.io/webusb'), true);
  assert.equal(isHardwareWalletOrigin('https://example.com'), false);
  assert.equal(isTrezorConnectUrl('https://connect.trezor.io.evil.example'), false);
});

test('wires Electron HID and USB permission handlers for hardware wallets', () => {
  const createWindowSource = readFileSync(
    new URL('../../../../src/main/services/window-service/create-window.ts', import.meta.url),
    'utf8'
  );
  const hardwareWalletSessionSource = readFileSync(
    new URL(
      '../../../../src/main/services/window-service/hardware-wallet-session.ts',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(createWindowSource, /configureHardwareWalletPermissions/);
  assert.match(hardwareWalletSessionSource, /hardware-wallet-permissions/);
  assert.match(hardwareWalletSessionSource, /setPermissionCheckHandler/);
  assert.match(hardwareWalletSessionSource, /permission !== 'hid' && permission !== 'usb'/);
  assert.match(
    hardwareWalletSessionSource,
    /isHardwareWalletFrameUrl\(details\.requestingUrl,\s*\{\s*allowedAppOrigins\s*\}\)/
  );
  assert.match(
    hardwareWalletSessionSource,
    /isHardwareWalletOrigin\(requestingOrigin,\s*\{\s*allowFileOrigin:\s*true,\s*allowedAppOrigins/
  );
  assert.match(hardwareWalletSessionSource, /setDevicePermissionHandler/);
  assert.match(hardwareWalletSessionSource, /allowFileOrigin: true/);
  assert.match(hardwareWalletSessionSource, /select-hid-device/);
  assert.match(hardwareWalletSessionSource, /select-usb-device/);
});
