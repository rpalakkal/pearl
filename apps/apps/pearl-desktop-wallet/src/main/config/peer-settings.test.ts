import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {setCurrentNetwork, type Network} from './network-config.ts';
import {
  getCustomPeer,
  getPeerSettings,
  resetToDefaultPeer,
  setCustomPeer,
} from './peer-settings.ts';

let tempSettingsDir = '';

beforeEach(() => {
  tempSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-peer-settings-'));
  process.env.PEARL_WALLET_SETTINGS_DIR = tempSettingsDir;
  setCurrentNetwork('mainnet');
});

afterEach(() => {
  delete process.env.PEARL_WALLET_SETTINGS_DIR;
  setCurrentNetwork('mainnet');
  fs.rmSync(tempSettingsDir, {recursive: true, force: true});
});

function peerSettingsFile(): string {
  return path.join(tempSettingsDir, 'peer-settings.json');
}

test('defaults to automatic DNS peer discovery', () => {
  assert.equal(getCustomPeer(), null);
  assert.deepEqual(getPeerSettings(), {
    network: 'mainnet',
    customPeerAddress: '',
    customPeerPort: undefined,
    isCustom: false,
  });
});

test('stores custom peers per network and resets only the active network', () => {
  setCustomPeer('  mainnet-node.example.com  ', 44108);
  assert.deepEqual(getCustomPeer(), {address: 'mainnet-node.example.com', port: 44108});

  setCurrentNetwork('testnet');
  assert.equal(getCustomPeer(), null);
  setCustomPeer('testnet-node.example.com', 44109);
  assert.deepEqual(getCustomPeer(), {address: 'testnet-node.example.com', port: 44109});

  setCurrentNetwork('mainnet');
  assert.deepEqual(getCustomPeer(), {address: 'mainnet-node.example.com', port: 44108});
  resetToDefaultPeer();
  assert.equal(getCustomPeer(), null);

  setCurrentNetwork('testnet');
  assert.deepEqual(getCustomPeer(), {address: 'testnet-node.example.com', port: 44109});
});

test('ignores legacy hardcoded peers and falls back to DNS discovery', () => {
  const legacyPeers: Array<{network: Network; address: string}> = [
    {network: 'mainnet', address: 'wallet-node0.pearlresearch.ai'},
    {network: 'testnet', address: 'node1.testnet.pearlresearch.ai'},
  ];

  for (const {network, address} of legacyPeers) {
    fs.writeFileSync(
      peerSettingsFile(),
      JSON.stringify({
        mainnet: {},
        testnet: {},
        [network]: {customPeerAddress: address, customPeerPort: 44108},
      })
    );
    setCurrentNetwork(network);

    assert.equal(getCustomPeer(), null, `${network} legacy peer should be ignored`);
    assert.equal(getPeerSettings().isCustom, false);
  }
});

test('keeps a nonlegacy saved peer as a custom connection', () => {
  fs.writeFileSync(
    peerSettingsFile(),
    JSON.stringify({
      mainnet: {customPeerAddress: 'node.example.com', customPeerPort: 44108},
      testnet: {},
    })
  );

  assert.deepEqual(getCustomPeer(), {address: 'node.example.com', port: 44108});
  assert.equal(getPeerSettings().isCustom, true);
});
