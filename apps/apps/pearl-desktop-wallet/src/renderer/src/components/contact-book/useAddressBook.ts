import {useCallback, useEffect, useMemo, useState} from 'react';
import {useContactsStore} from '../../store/contactsStore';
import {useWalletStore} from '../../store/walletStore';
import {
  getHardwareWalletProviderName,
  normalizePearlNetwork,
  pearlTaprootScriptFromAddress,
  type HardwareWalletVendor,
  type PearlNetwork,
} from '../../lib/hardwareWallet.ts';
import {listStoredHardwareAccounts} from '../../lib/hardwareWalletStorage.ts';
import type {Contact} from '../../../../types/app-bridge';

export type KnownAddressSource = 'contact' | 'wallet' | 'hardware';

export interface KnownAddress {
  address: string;
  label: string;
  source: KnownAddressSource;
  contact?: Contact;
}

const PEARL_NETWORKS: PearlNetwork[] = ['mainnet', 'testnet'];
const HARDWARE_VENDORS: HardwareWalletVendor[] = ['ledger', 'trezor'];

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function listKnownHardwareAddresses(): KnownAddress[] {
  const entries: KnownAddress[] = [];

  for (const network of PEARL_NETWORKS) {
    for (const vendor of HARDWARE_VENDORS) {
      for (const account of listStoredHardwareAccounts(normalizePearlNetwork(network), vendor)) {
        const networkSuffix = account.network === 'testnet' ? ' (testnet)' : '';
        const accountName =
          account.label?.trim() ||
          `${getHardwareWalletProviderName(vendor)} #${account.addressIndex}`;
        // Ownership is marked by the badge/section, not baked into the name.
        entries.push({
          address: account.address,
          label: `${accountName}${networkSuffix}`,
          source: 'hardware',
        });
      }
    }
  }

  return entries;
}

// Validates a contact address. Prefers the wallet RPC when it is running and
// falls back to an offline Taproot decode so contacts can still be managed
// from the hardware wallet page without a running software wallet.
export async function validatePearlAddress(address: string): Promise<boolean> {
  try {
    const {isValid} = await window.appBridge.wallet.validateAddress(address.trim());
    return isValid;
  } catch {
    return PEARL_NETWORKS.some(network => {
      try {
        pearlTaprootScriptFromAddress(address.trim(), network);
        return true;
      } catch {
        return false;
      }
    });
  }
}

export function useAddressBook() {
  const {contacts, hasLoadedContacts, loadContacts} = useContactsStore();
  const [walletAddresses, setWalletAddresses] = useState<string[]>([]);
  const [hardwareAddresses, setHardwareAddresses] = useState<KnownAddress[]>([]);

  useEffect(() => {
    if (!hasLoadedContacts) {
      loadContacts();
    }
  }, [hasLoadedContacts, loadContacts]);

  useEffect(() => {
    let cancelled = false;

    window.appBridge.wallet
      .getAddressesByAccount('default')
      .then(addresses => {
        if (!cancelled && Array.isArray(addresses)) {
          setWalletAddresses(addresses);
        }
      })
      .catch(() => {
        // Wallet service is not running (e.g. hardware wallet page before
        // unlocking); own-address recognition is simply unavailable then.
      });

    setHardwareAddresses(listKnownHardwareAddresses());

    return () => {
      cancelled = true;
    };
  }, []);

  const contactEntries = useMemo<KnownAddress[]>(
    () =>
      contacts.map(contact => ({
        address: contact.address,
        label: contact.name,
        source: 'contact' as const,
        contact,
      })),
    [contacts]
  );

  // Every receive address the software wallet has handed out; labeled by
  // wallet name so the "My Addresses" list explains itself.
  const walletName = useWalletStore(state => state.walletName);
  const myAddressEntries = useMemo<KnownAddress[]>(() => {
    const walletLabel =
      walletName && walletName !== 'Pearl Wallet'
        ? `${walletName} · receive address`
        : 'Wallet receive address';
    const entries: KnownAddress[] = walletAddresses.map(address => ({
      address,
      label: walletLabel,
      source: 'wallet',
    }));
    const seen = new Set(entries.map(entry => normalizeAddress(entry.address)));
    for (const entry of hardwareAddresses) {
      if (!seen.has(normalizeAddress(entry.address))) {
        seen.add(normalizeAddress(entry.address));
        entries.push(entry);
      }
    }
    return entries;
  }, [walletAddresses, hardwareAddresses, walletName]);

  // Contacts take precedence over own addresses when both match, so a named
  // entry always wins in recognition.
  const resolveAddress = useCallback(
    (input: string): KnownAddress | null => {
      const normalized = normalizeAddress(input);
      if (!normalized) {
        return null;
      }
      return (
        contactEntries.find(entry => normalizeAddress(entry.address) === normalized) ??
        myAddressEntries.find(entry => normalizeAddress(entry.address) === normalized) ??
        null
      );
    },
    [contactEntries, myAddressEntries]
  );

  return {
    contacts,
    contactEntries,
    myAddressEntries,
    resolveAddress,
  };
}
