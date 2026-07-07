// Last-known balances per account id, for display in the account switcher.
// Live queries are wrong here: only the active software wallet has a running
// process, and hardware balance reads spin up the chain host — far too heavy
// for opening a dropdown. Values refresh whenever an account is active.

export interface CachedBalance {
  balancePrl: number;
  updatedAt: number;
}

function cacheKey(network: string): string {
  return `pearl.accountBalances.v1.${network}`;
}

export function readCachedBalances(network: string): Record<string, CachedBalance> {
  try {
    const raw = localStorage.getItem(cacheKey(network));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, CachedBalance>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCachedBalance(network: string, accountId: string, balancePrl: number): void {
  if (!Number.isFinite(balancePrl)) {
    return;
  }
  try {
    const balances = readCachedBalances(network);
    balances[accountId] = {balancePrl, updatedAt: Date.now()};
    localStorage.setItem(cacheKey(network), JSON.stringify(balances));
  } catch (error) {
    console.warn('Failed to cache account balance:', error);
  }
}
