interface WalletProcessArgsConfig {
  dataDir: string;
  rpcUser: string;
  rpcPassword: string;
  peerAddress?: string;
  peerPort?: number;
}

interface WalletProcessNetworkConfig {
  rpcPort: number;
  walletFlag: string;
}

export function buildWalletArgs(
  config: WalletProcessArgsConfig,
  networkConfig: WalletProcessNetworkConfig
): string[] {
  const args = [
    '--usespv',
    `--appdata=${config.dataDir}`,
    `--username=${config.rpcUser}`,
    `--password=${config.rpcPassword}`,
    `--rpclisten=127.0.0.1:${networkConfig.rpcPort}`,
    '--noservertls',
  ];

  // Only pass --addpeer when the user has configured a complete custom peer.
  // Otherwise the daemon falls back to its built-in DNS seeding.
  if (config.peerAddress && config.peerPort) {
    args.push(`--addpeer=${config.peerAddress}:${config.peerPort}`);
  }

  if (networkConfig.walletFlag) {
    args.splice(1, 0, networkConfig.walletFlag);
  }

  return args;
}
