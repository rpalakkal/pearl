import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Socket } from 'net';
import { promisify } from 'util';
import dns from 'dns';
import { ManagerApi } from '../../types/app-bridge.ts';
import { WalletService } from './wallet-service/wallet-service.ts';
import { WalletProcess } from './wallet-process.ts';
import { displayToFs, fsToDisplay } from '../../utils/filename-utils.ts';
import { getCurrentNetworkConfig, getCurrentNetwork, setCurrentNetwork, getAllNetworks, type Network } from '../config/network-config';
import { getPeerAddress, getPeerPort, getPeerSettings as getConfigPeerSettings, setCustomPeer, resetToDefaultPeer } from '../config/peer-settings';
import * as appLock from '../config/app-lock';
import { randomBytes } from 'crypto';


let sessionRpcCreds: { rpcUser: string; rpcPassword: string } | null = null;
function getSessionRpcCreds() {
  if (!sessionRpcCreds) {
    sessionRpcCreds = {
      rpcUser: randomBytes(16).toString('hex'),
      rpcPassword: randomBytes(32).toString('hex'),
    };
  }
  return sessionRpcCreds;
}


const dnsLookup = promisify(dns.lookup);
interface WalletData {
  name: string;
}

const baseWalletDir = path.join(os.homedir(), '.pearl-wallet', 'wallet-data');

// Reserved name (fs-form) for the hidden chain-host wallet: an auto-created
// wallet with a discarded random seed, used purely as a local chain backend
// for hardware accounts when no user wallet is running. Never listed, never
// selectable, and user wallets may not take its name — the create path's
// leftover-dir handling would otherwise delete its wallet.db.
const CHAIN_HOST_NAME = '.chain-host';

function isReservedWalletName(name: string): boolean {
  return displayToFs(name) === CHAIN_HOST_NAME;
}

// Chain-level SPV state files that are wallet-independent and safe to copy
// between wallet data dirs (same set the create/import flow preserves).
const CHAIN_STATE_FILES = [
  'block_headers.bin',
  'reg_filter_headers.bin',
  'neutrino.db',
  'peers.json',
];

function getBaseConfig() {
  const networkConfig = getCurrentNetworkConfig();
  return {
    rpcHost: 'http://127.0.0.1',
    ...getSessionRpcCreds(),
    rpcPort: networkConfig.rpcPort,
    network: networkConfig.name,
    peerAddress: getPeerAddress(),
    peerPort: getPeerPort(),
  };
}

class ManagerService implements ManagerApi {
  // Long RPC unlock window; main re-arms it from the vault on demand, so the
  // renderer never deals with silent wallet re-locks.
  static readonly WALLET_UNLOCK_TIMEOUT_SECONDS = 7 * 24 * 3600;

  private walletService: WalletService | null = null;
  private currentWallet: WalletData | null = null;
  private walletProcess: WalletProcess | null = null;
  private chainHostActive = false;
  private chainHostStartPromise: Promise<WalletService> | null = null;

  // Serializes every wallet-process lifecycle change. Hardware IPC calls can
  // race the account switcher for port 8335; each lifecycle method queues
  // behind whatever transition is in flight.
  private transition: Promise<unknown> = Promise.resolve();

  private runTransition<T>(work: () => Promise<T>): Promise<T> {
    const next = this.transition.catch(() => {}).then(work);
    this.transition = next;
    return next;
  }

  private async loadWallet(walletName: string, mode: 'create' | 'open') {
    const walletDataDir = path.join(baseWalletDir, displayToFs(walletName));
    const existingWallets = await this.getExistingWallets();
    const isValidWalletExist = existingWallets.walletNames.includes(walletName);
    const isInvalidSeedWalletCreated = fs.existsSync(walletDataDir) && !isValidWalletExist;

    if (isValidWalletExist && mode === 'create') {
      throw new Error('Wallet data directory already exist, please use a different wallet name');
    } else if (!isValidWalletExist && mode === 'open') {
      throw new Error('Wallet data directory does not exist, please use a different wallet name');
    }

    try {
      fs.mkdirSync(walletDataDir, { recursive: true });
    } catch (error) {
      if (isInvalidSeedWalletCreated) {
        console.log(
          'A wallet with invalid seed was created previously - hence only the wallet name dir was created - we should not throw'
        );
      } else {
        throw new Error(
          `Failed to create wallet data directory: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    const config = {
      ...getBaseConfig(),
      dataDir: walletDataDir,
    };

    this.walletService = new WalletService(config);
    this.walletProcess = new WalletProcess(config, this.walletService);
  }

  async stopWalletProcess(options: { force?: boolean } = {}) {
    if (this.walletProcess && this.walletProcess.getStatus().isRunning) {
      await this.walletProcess.stop(options);
    }
    this.chainHostActive = false;
  }

  // Returns a running wallet service for hardware account reads/broadcasts,
  // starting the hidden chain-host wallet when no user wallet is running.
  // Single-flight: concurrent hardware IPC calls share one startup.
  async ensureChainHost(): Promise<WalletService> {
    const running = this.getWalletServiceIfRunning();
    if (running) {
      return running;
    }

    if (!this.chainHostStartPromise) {
      this.chainHostStartPromise = this.runTransition(() => this.startChainHost()).finally(() => {
        this.chainHostStartPromise = null;
      });
    }
    return this.chainHostStartPromise;
  }

  private async startChainHost(): Promise<WalletService> {
    // A user wallet may have started while we queued behind the transition.
    const running = this.getWalletServiceIfRunning();
    if (running) {
      return running;
    }

    const walletDataDir = path.join(baseWalletDir, CHAIN_HOST_NAME);
    const networkConfig = getCurrentNetworkConfig();
    const walletDbPath = path.join(walletDataDir, networkConfig.dataSubdir, 'wallet.db');
    const config = { ...getBaseConfig(), dataDir: walletDataDir };

    this.walletService = new WalletService(config);
    this.walletProcess = new WalletProcess(config, this.walletService);
    // The chain host is not a user wallet: getWalletsStats() keeps reporting
    // no selected wallet while it runs.
    this.currentWallet = null;

    if (!fs.existsSync(walletDbPath)) {
      if (appLock.getStatus() !== 'unlocked') {
        throw new Error('Unlock the app before using hardware accounts');
      }

      fs.mkdirSync(path.dirname(walletDbPath), { recursive: true });
      this.seedChainStateFrom(path.dirname(walletDbPath), networkConfig.dataSubdir);

      // Reuse an existing vaulted passphrase (a second network's create must
      // not clobber the first's entry); otherwise generate and store one.
      // The seed printed by wallet creation is deliberately discarded — this
      // wallet holds no user funds, only watch-only hardware imports.
      let passphrase = appLock.getWalletPassphrase(CHAIN_HOST_NAME);
      if (!passphrase) {
        passphrase = appLock.generateWalletPassphrase();
        appLock.storeWalletPassphrase(CHAIN_HOST_NAME, passphrase);
      }

      const createResult = await this.walletProcess.createWalletAndGetSeed(passphrase);
      if (!createResult.success) {
        throw new Error(
          `Failed to create chain host wallet: ${'error' in createResult ? createResult.error : 'Unknown error'}`
        );
      }
      console.log('[ManagerService] Chain host wallet created');
    }

    await this.startWalletProcess();
    this.chainHostActive = true;
    console.log('[ManagerService] Chain host running');

    return this.ensureWalletService();
  }

  // Copies wallet-independent chain state (headers, filter headers, peers)
  // from the most recently synced wallet into a fresh chain-host dir so the
  // host doesn't re-download the whole header chain. Only runs while no
  // wallet process is up, so the source files are cold.
  private seedChainStateFrom(targetNetworkDir: string, dataSubdir: string) {
    try {
      let newestDir: string | null = null;
      let newestMtime = 0;

      for (const entry of fs.readdirSync(baseWalletDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === CHAIN_HOST_NAME) {
          continue;
        }
        const headersPath = path.join(baseWalletDir, entry.name, dataSubdir, 'block_headers.bin');
        if (!fs.existsSync(headersPath)) {
          continue;
        }
        const mtime = fs.statSync(headersPath).mtimeMs;
        if (mtime > newestMtime) {
          newestMtime = mtime;
          newestDir = path.join(baseWalletDir, entry.name, dataSubdir);
        }
      }

      if (!newestDir) {
        return;
      }

      for (const file of CHAIN_STATE_FILES) {
        const source = path.join(newestDir, file);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(targetNetworkDir, file));
        }
      }
      console.log(`[ManagerService] Seeded chain host headers from ${newestDir}`);
    } catch (error) {
      // Seeding is an optimization; a fresh header sync is the fallback.
      console.error('Failed to seed chain host headers:', error);
    }
  }

  async startWalletProcess() {
    if (!this.walletProcess) {
      throw new Error('Wallet process not initialized');
    }

    if (this.walletProcess.getStatus().isRunning === false) {
      const startResult = await this.walletProcess.start();
      if (!startResult.success) {
        throw new Error(`Failed to start wallet service: ${startResult.message}`);
      }
    }
  }

  async lockWallet() {
    return this.runTransition(async () => {
      if (this.walletService && !this.chainHostActive) {
        await this.walletService.lockWallet();
      }
      await this.stopWalletProcess();
      this.currentWallet = null;
    });
  }

  // Fast path for the Lock button while the wallet is mid-block-recovery. The
  // `walletlock` RPC would sit on Wallet.walletLocker -> `<-endRecovery()` for
  // up to a minute, so we skip it entirely and SIGKILL the child. Safe because
  // bbolt write txns are atomic at commit; a mid-batch kill just replays that
  // batch on the next open.
  async forceLockWallet() {
    return this.runTransition(async () => {
      await this.stopWalletProcess({ force: true });
      this.currentWallet = null;
    });
  }

  ensureWalletService() {
    const ws = this.walletService;
    if (!ws) {
      throw new Error('Wallet service not initialized');
    }
    return ws;
  }

  // Returns the running wallet service (a user wallet or the chain host), or
  // null when no oyster process is up.
  getWalletServiceIfRunning(): WalletService | null {
    if (!this.walletService || !this.walletProcess?.getStatus().isRunning) {
      return null;
    }
    return this.walletService;
  }

  getWalletsStats() {
    return {
      name: this.currentWallet?.name,
    };
  }

  async selectWallet(walletName: string): Promise<{ passphraseAvailable: boolean }> {
    if (isReservedWalletName(walletName)) {
      throw new Error(`"${walletName}" is a reserved wallet name`);
    }

    // Validate peer before starting wallet
    const peerAddress = getPeerAddress();
    const peerPort = getPeerPort();

    console.log(`[ManagerService] Validating peer before starting wallet: ${peerAddress}:${peerPort}`);
    const validation = await this.validatePeerAddress(peerAddress, peerPort);

    if (!validation.valid) {
      console.error(`[ManagerService] ❌ Peer validation failed: ${validation.error}`);
      throw new Error(validation.error || 'Cannot connect to peer node');
    }

    console.log(`[ManagerService] ✅ Peer validation passed, starting wallet...`);

    return this.runTransition(async () => {
      try {
        await this.stopWalletProcess();
      } catch (error) {
        console.log('Failed to stop wallet process:', error);
      }

      // Load/start failures now propagate so the renderer can show a real
      // error instead of retrying against a dead service.
      await this.loadWallet(walletName, 'open');
      await this.startWalletProcess();

      this.currentWallet = { name: walletName };

      return { passphraseAvailable: await this.unlockFromVault(walletName) };
    });
  }

  // Unlocks the running wallet with its vaulted passphrase, when the app is
  // unlocked and a passphrase is stored. Returns whether that succeeded so
  // the renderer knows to run the one-time migration prompt.
  private async unlockFromVault(walletName: string): Promise<boolean> {
    if (appLock.getStatus() !== 'unlocked' || !this.walletService) {
      return false;
    }

    const passphrase = appLock.getWalletPassphrase(walletName);
    if (!passphrase) {
      return false;
    }

    try {
      await this.walletService.unlockWallet(
        passphrase,
        ManagerService.WALLET_UNLOCK_TIMEOUT_SECONDS
      );
      return true;
    } catch (error) {
      // A stale vault entry behaves like a missing one: the UI re-prompts.
      console.error('Vaulted passphrase failed to unlock wallet:', error);
      return false;
    }
  }

  // Runs a wallet operation, re-arming the wallet passphrase from the vault
  // once if the wallet reports it re-locked (the RPC unlock has a timeout).
  async withWalletAutoUnlock<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const looksLocked = /wallet is locked|walletpassphrase|unlock/i.test(message);
      const walletName = this.currentWallet?.name;

      if (!looksLocked || !walletName || !(await this.unlockFromVault(walletName))) {
        throw error;
      }

      return fn();
    }
  }

  // Wallet passphrases are generated randomly and stored in the app-lock
  // vault; the seed phrase is the recovery path. The legacy `password`
  // option is ignored.
  async create(options: { name: string; password?: string }) {
    const { name } = options;

    if (isReservedWalletName(name)) {
      throw new Error(`"${name}" is a reserved wallet name`);
    }
    if (appLock.getStatus() !== 'unlocked') {
      throw new Error('Unlock the app before creating a wallet');
    }

    return this.runTransition(async () => {
      await this.stopWalletProcess();

      await this.loadWallet(name, 'create');

      const passphrase = appLock.generateWalletPassphrase();
      const createResult = await this.walletProcess?.createWalletAndGetSeed(passphrase);
      if (!createResult || !createResult.success || !createResult.seed) {
        throw new Error(
          `Failed to create wallet${createResult && 'error' in createResult ? `: ${createResult.error}` : ''}`
        );
      }

      appLock.storeWalletPassphrase(name, passphrase);

      const generatedSeed = createResult.seed;

      await this.startWalletProcess();

      this.currentWallet = { name };

      await this.unlockFromVault(name);

      return { seed: generatedSeed };
    });
  }

  async import(options: { name: string; seed: string; password?: string }) {
    const { name, seed } = options;

    if (!name) {
      throw new Error('Wallet name is required');
    }
    if (!seed) {
      throw new Error('Seed phrase is required');
    }
    if (isReservedWalletName(name)) {
      throw new Error(`"${name}" is a reserved wallet name`);
    }
    if (appLock.getStatus() !== 'unlocked') {
      throw new Error('Unlock the app before importing a wallet');
    }

    return this.runTransition(async () => {
      await this.stopWalletProcess();

      await this.loadWallet(name, 'create');

      const passphrase = appLock.generateWalletPassphrase();
      const importResult = await this.walletProcess?.importWalletFromSeed(seed, passphrase);
      if (!importResult || !importResult.success) {
        throw new Error(
          `Failed to import wallet: ${importResult && 'error' in importResult ? importResult.error : 'Unknown error'}`
        );
      }

      appLock.storeWalletPassphrase(name, passphrase);

      try {
        await this.startWalletProcess();
      } catch (error) {
        console.log('Failed to start wallet process:', error);
      }

      this.currentWallet = { name };

      await this.unlockFromVault(name);

      return { name, seed };
    });
  }

  async getExistingWallets() {
    let walletNames: string[] = [];
    const networkConfig = getCurrentNetworkConfig();

    if (fs.existsSync(baseWalletDir)) {
      const entries = await fs.promises.readdir(baseWalletDir, { withFileTypes: true });
      walletNames = entries
        .filter(entry => entry.isDirectory() && entry.name !== CHAIN_HOST_NAME)
        .map(entry => fsToDisplay(entry.name))
        .filter(name => {
          const walletDbPath = path.join(baseWalletDir, name, networkConfig.dataSubdir, 'wallet.db');
          return fs.existsSync(walletDbPath);
        })
        // readdir order is filesystem-dependent; sort so defaultWallet is
        // stable across launches instead of flip-flopping between wallets.
        .sort((left, right) => left.localeCompare(right));
    }

    return { walletNames, defaultWallet: walletNames.length > 0 ? walletNames[0] : undefined };
  }

  // Network management methods
  async getNetworkInfo() {
    const current = getCurrentNetwork();
    const networks = getAllNetworks();
    const config = getCurrentNetworkConfig();

    return {
      currentNetwork: current,
      availableNetworks: networks,
      networkConfig: config,
    };
  }

  async setNetwork(network: string) {
    // Validate network
    if (network !== 'mainnet' && network !== 'testnet') {
      throw new Error(`Invalid network: ${network}`);
    }

    // Stop wallet if running
    await this.stopWalletProcess();

    // Update network
    setCurrentNetwork(network as Network);

    return { success: true, network };
  }

  // Peer settings management
  async getPeerSettings() {
    return getConfigPeerSettings();
  }

  async validatePeerAddress(address: string, port: number): Promise<{ valid: boolean; error?: string }> {
    try {
      // Step 1: Check if host resolves via DNS
      console.log(`[ManagerService] Validating peer: ${address}:${port}`);

      try {
        await dnsLookup(address);
        console.log(`[ManagerService] ✅ DNS lookup successful for ${address}`);
      } catch (dnsError) {
        console.error(`[ManagerService] ❌ DNS lookup failed for ${address}:`, dnsError);
        return {
          valid: false,
          error: `Please make sure your internet connection is stable and that ${address} is responsive`
        };
      }

      // Step 2: Try to connect to the port
      return new Promise((resolve) => {
        const socket = new Socket();
        const timeout = 5000; // 5 second timeout

        const cleanup = () => {
          socket.destroy();
        };

        socket.setTimeout(timeout);

        socket.on('connect', () => {
          console.log(`[ManagerService] ✅ Successfully connected to ${address}:${port}`);
          cleanup();
          resolve({ valid: true });
        });

        socket.on('timeout', () => {
          console.error(`[ManagerService] ❌ Connection timeout for ${address}:${port}`);
          cleanup();
          resolve({
            valid: false,
            error: `Connection timeout: ${address}:${port} is not responding. Please verify the address and port.`
          });
        });

        socket.on('error', (err) => {
          console.error(`[ManagerService] ❌ Connection error for ${address}:${port}:`, err.message);
          cleanup();
          resolve({
            valid: false,
            error: `Cannot connect to ${address}:${port}. Error: ${err.message}`
          });
        });

        socket.connect(port, address);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[ManagerService] ❌ Peer validation failed:`, errorMessage);
      return { valid: false, error: `Validation failed: ${errorMessage}` };
    }
  }

  async setCustomPeerAddress(address: string, port: number) {
    // Stop wallet if running
    await this.stopWalletProcess();

    // Update peer settings (don't validate here - validate when unlocking)
    setCustomPeer(address, port);

    return { success: true };
  }

  async resetPeerToDefault() {
    // Stop wallet if running
    await this.stopWalletProcess();

    // Reset to default
    resetToDefaultPeer();

    return { success: true };
  }
}

export { ManagerService };
