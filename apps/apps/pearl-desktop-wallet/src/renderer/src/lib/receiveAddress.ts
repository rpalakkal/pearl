// A stable receive address: the wallet RPC only mints fresh addresses
// (getnewaddress), so the last shown address is cached per wallet+network and
// reused until it actually receives funds. Rotation stays available through
// an explicit "generate new address" action.

function cacheKey(network: string, walletName: string): string {
  return `pearl.lastReceiveAddress.v1.${network}.${walletName}`;
}

export async function getStableReceiveAddress(
  network: string,
  walletName: string
): Promise<string> {
  const key = cacheKey(network, walletName);
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(key);
  } catch {
    // fall through to minting
  }

  if (cached) {
    try {
      const received = await window.appBridge.wallet.getReceivedByAddress(cached);
      if (received === 0) {
        return cached;
      }
    } catch (error) {
      // Prefer stability over rotation when the received-check itself fails.
      console.warn('Failed to check receive address usage:', error);
      return cached;
    }
  }

  return generateNewReceiveAddress(network, walletName);
}

export async function generateNewReceiveAddress(
  network: string,
  walletName: string
): Promise<string> {
  const address = await window.appBridge.wallet.getNewAddress();
  try {
    localStorage.setItem(cacheKey(network, walletName), address);
  } catch {
    // caching is best-effort
  }
  return address;
}
