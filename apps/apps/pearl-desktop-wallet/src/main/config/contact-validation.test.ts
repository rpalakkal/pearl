import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isContact, isValidContactPublicKey, sanitizeContact} from './contact-validation.ts';
import type {Contact} from '../../types/app-bridge.ts';

const legacyContact = {
  id: 'a',
  name: 'Alice',
  address: 'prl1qalice',
  createdAt: 1,
  updatedAt: 2,
};

test('legacy contact without new fields passes validation unchanged', () => {
  assert.equal(isContact(legacyContact), true);
  assert.deepEqual(sanitizeContact(legacyContact as Contact), legacyContact);
});

test('isContact rejects malformed records', () => {
  assert.equal(isContact(null), false);
  assert.equal(isContact('x'), false);
  assert.equal(isContact({id: 'a', name: 'Alice'}), false);
});

test('sanitizeContact drops wrong-typed optional fields', () => {
  const raw = {
    ...legacyContact,
    notes: 42,
    publicKey: 'not-hex',
    firstVerifiedAt: 'yesterday',
  } as unknown as Contact;

  const sanitized = sanitizeContact(raw);
  assert.equal('notes' in sanitized, false);
  assert.equal('publicKey' in sanitized, false);
  assert.equal('firstVerifiedAt' in sanitized, false);
});

test('sanitizeContact keeps valid optional fields', () => {
  const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const raw = {
    ...legacyContact,
    notes: 'cold storage',
    publicKey,
    firstVerifiedAt: 1234,
  } as Contact;

  const sanitized = sanitizeContact(raw);
  assert.equal(sanitized.notes, 'cold storage');
  assert.equal(sanitized.publicKey, publicKey);
  assert.equal(sanitized.firstVerifiedAt, 1234);
});

test('public key validation accepts x-only, compressed, and uncompressed hex', () => {
  assert.equal(isValidContactPublicKey('a'.repeat(64)), true);
  assert.equal(isValidContactPublicKey('a'.repeat(66)), true);
  assert.equal(isValidContactPublicKey('a'.repeat(130)), true);
  assert.equal(isValidContactPublicKey('a'.repeat(65)), false);
  assert.equal(isValidContactPublicKey('z'.repeat(64)), false);
  assert.equal(isValidContactPublicKey(''), false);
});
