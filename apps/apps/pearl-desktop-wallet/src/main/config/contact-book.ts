/**
 * Contact book management - persists named recipient addresses so users can
 * pick them when sending Pearl from the software or hardware wallet.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { Contact, ContactExtras, ContactUpdates } from '../../types/app-bridge';
import { isContact, isValidContactPublicKey, sanitizeContact } from './contact-validation';

const SETTINGS_DIR = path.join(os.homedir(), '.pearl-wallet', 'settings');
const CONTACTS_FILE = path.join(SETTINGS_DIR, 'contacts.json');

function ensureSettingsDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

function loadContacts(): Contact[] {
  ensureSettingsDir();

  if (fs.existsSync(CONTACTS_FILE)) {
    try {
      const data = fs.readFileSync(CONTACTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter(isContact).map(sanitizeContact);
      }
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  }

  return [];
}

function saveContacts(contacts: Contact[]) {
  ensureSettingsDir();

  try {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save contacts:', error);
    throw new Error('Failed to save contacts');
  }
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function assertValidContactInput(name: string, address: string) {
  if (!name.trim()) {
    throw new Error('Contact name is required');
  }
  if (!address.trim()) {
    throw new Error('Contact address is required');
  }
}

// Applies optional contact fields to a record. Empty strings clear a field;
// undefined leaves it untouched.
function applyContactExtras(contact: Contact, extras: ContactUpdates) {
  if (extras.notes !== undefined) {
    const notes = extras.notes.trim();
    if (notes) {
      contact.notes = notes;
    } else {
      delete contact.notes;
    }
  }

  if (extras.publicKey !== undefined) {
    const publicKey = extras.publicKey.trim();
    if (publicKey) {
      if (!isValidContactPublicKey(publicKey)) {
        throw new Error('Invalid public key: expected a hex encoded secp256k1 key');
      }
      contact.publicKey = publicKey;
    } else {
      delete contact.publicKey;
    }
  }

  if (extras.firstVerifiedAt !== undefined) {
    contact.firstVerifiedAt = extras.firstVerifiedAt;
  }
}

export function listContacts(): Contact[] {
  return loadContacts().sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  );
}

export function addContact(name: string, address: string, extras: ContactExtras = {}): Contact {
  assertValidContactInput(name, address);

  const contacts = loadContacts();
  if (contacts.some(contact => normalizeAddress(contact.address) === normalizeAddress(address))) {
    throw new Error('A contact with this address already exists');
  }

  const now = Date.now();
  const contact: Contact = {
    id: randomUUID(),
    name: name.trim(),
    address: address.trim(),
    createdAt: now,
    updatedAt: now,
  };
  applyContactExtras(contact, extras);

  contacts.push(contact);
  saveContacts(contacts);
  return contact;
}

export function updateContact(id: string, updates: ContactUpdates): Contact {
  const contacts = loadContacts();
  const existing = contacts.find(contact => contact.id === id);
  if (!existing) {
    throw new Error('Contact not found');
  }

  const name = updates.name ?? existing.name;
  const address = updates.address ?? existing.address;
  assertValidContactInput(name, address);

  if (
    contacts.some(
      contact =>
        contact.id !== id && normalizeAddress(contact.address) === normalizeAddress(address)
    )
  ) {
    throw new Error('A contact with this address already exists');
  }

  existing.name = name.trim();
  existing.address = address.trim();
  applyContactExtras(existing, updates);
  existing.updatedAt = Date.now();

  saveContacts(contacts);
  return existing;
}

export function removeContact(id: string) {
  const contacts = loadContacts();
  const remaining = contacts.filter(contact => contact.id !== id);
  if (remaining.length === contacts.length) {
    throw new Error('Contact not found');
  }
  saveContacts(remaining);
}
