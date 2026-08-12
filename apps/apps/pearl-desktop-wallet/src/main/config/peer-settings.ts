/**
 * Peer settings management.
 *
 * By default the wallet relies on the oyster daemon's built-in DNS seeding
 * — no --addpeer flag is passed. Users can optionally configure a custom peer
 * (IPv4 or CNAME) that is forwarded to the daemon via --addpeer.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {getCurrentNetwork} from './network-config.ts';
import {LEGACY_MAINNET_PEER_ADDRESSES, LEGACY_TESTNET_PEER_ADDRESSES} from './consts.ts';

interface NetworkPeerSettings {
  customPeerAddress?: string;
  customPeerPort?: number;
}

interface AllNetworksPeerSettings {
  mainnet: NetworkPeerSettings;
  testnet: NetworkPeerSettings;
}

// PEARL_WALLET_SETTINGS_DIR is a test-only override so settings tests can run
// against a temp directory instead of the user's real wallet settings.
function settingsDir(): string {
  return (
    process.env.PEARL_WALLET_SETTINGS_DIR ?? path.join(os.homedir(), '.pearl-wallet', 'settings')
  );
}

function settingsFile(): string {
  return path.join(settingsDir(), 'peer-settings.json');
}

// Ensure settings directory exists
function ensureSettingsDir() {
  const dir = settingsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
}

// Returns true when the saved custom peer is one of the legacy hardcoded
// hosts. Those addresses are no longer valid defaults, so stale
// peer-settings.json entries are cleared on load (migration).
function isLegacyPeer(address: string): boolean {
  const network = getCurrentNetwork();
  const legacy =
    network === 'mainnet' ? LEGACY_MAINNET_PEER_ADDRESSES : LEGACY_TESTNET_PEER_ADDRESSES;
  return legacy.includes(address);
}

function loadAllNetworksPeerSettings(): AllNetworksPeerSettings {
  ensureSettingsDir();
  const file = settingsFile();

  if (fs.existsSync(file)) {
    try {
      const data = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        mainnet: parsed.mainnet ?? {},
        testnet: parsed.testnet ?? {},
      };
    } catch (error) {
      console.error('Failed to load peer settings:', error);
    }
  }

  return {mainnet: {}, testnet: {}};
}

// Load peer settings for the current network, migrating stale legacy entries.
function loadPeerSettings(): NetworkPeerSettings {
  const allSettings = loadAllNetworksPeerSettings();
  const settings = allSettings[getCurrentNetwork()] ?? {};

  // Runtime migration: ignore a saved legacy hardcoded host so the wallet
  // falls back to DNS seeding. The file is rewritten only when the user later
  // saves or resets peer settings.
  if (settings.customPeerAddress && isLegacyPeer(settings.customPeerAddress)) {
    delete settings.customPeerAddress;
    delete settings.customPeerPort;
  }

  return settings;
}

// Save peer settings for the current network
function savePeerSettings(settings: NetworkPeerSettings) {
  ensureSettingsDir();

  const peerSettings = loadAllNetworksPeerSettings();
  peerSettings[getCurrentNetwork()] = settings;

  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(peerSettings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save peer settings:', error);
  }
}

export interface CustomPeer {
  address: string;
  port: number;
}

// Get the user-configured custom peer, or null when none is set (in which case
// the daemon falls back to DNS seeding).
export function getCustomPeer(): CustomPeer | null {
  const settings = loadPeerSettings();
  const address = settings.customPeerAddress?.trim();
  const port = settings.customPeerPort;

  if (!address || !port) {
    return null;
  }

  return {address, port};
}

// Set custom peer address for the active network only
export function setCustomPeer(address: string, port: number) {
  const settings = loadPeerSettings();
  settings.customPeerAddress = address;
  settings.customPeerPort = port;
  savePeerSettings(settings);
}

// Reset to default (DNS seeders) for the active network only
export function resetToDefaultPeer() {
  const settings = loadPeerSettings();
  delete settings.customPeerAddress;
  delete settings.customPeerPort;
  savePeerSettings(settings);
}

// Get peer settings info for the active network
export function getPeerSettings() {
  const network = getCurrentNetwork();
  const customPeer = getCustomPeer();

  return {
    network,
    customPeerAddress: customPeer?.address ?? '',
    customPeerPort: customPeer?.port,
    isCustom: customPeer !== null,
  };
}
