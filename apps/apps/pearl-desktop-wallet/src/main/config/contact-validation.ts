/**
 * Pure contact record validation, kept dependency-free so it can run under
 * node --test alongside the other model tests.
 */
import type { Contact } from '../../types/app-bridge';

export function isContact(value: unknown): value is Contact {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const contact = value as Partial<Contact>;
  return (
    typeof contact.id === 'string' &&
    typeof contact.name === 'string' &&
    typeof contact.address === 'string'
  );
}

// Matches the hardware wallet service's public key normalization: hex encoded
// x-only (64), compressed (66), or uncompressed (130) secp256k1 keys.
export function isValidContactPublicKey(publicKey: string): boolean {
  const normalized = publicKey.trim();
  return /^[0-9a-fA-F]+$/.test(normalized) && [64, 66, 130].includes(normalized.length);
}

// Drops wrong-typed or invalid optional fields from a loaded contact so older
// or hand-edited contacts.json files never propagate bad data. Required
// fields are assumed to have passed isContact already.
export function sanitizeContact(raw: Contact): Contact {
  const contact: Contact = {
    id: raw.id,
    name: raw.name,
    address: raw.address,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };

  if (typeof raw.notes === 'string' && raw.notes.trim()) {
    contact.notes = raw.notes;
  }
  if (typeof raw.publicKey === 'string' && isValidContactPublicKey(raw.publicKey)) {
    contact.publicKey = raw.publicKey.trim();
  }
  if (typeof raw.firstVerifiedAt === 'number' && Number.isFinite(raw.firstVerifiedAt)) {
    contact.firstVerifiedAt = raw.firstVerifiedAt;
  }

  return contact;
}
