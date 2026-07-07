import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  hardwareSendFormReducer,
  initialHardwareSendFormState,
  type HardwareSendFormAction,
  type RecipientContext,
} from './useHardwareSendFormState.ts';
import {account} from '../../lib/hardwareWalletTestFixtures.ts';
import type {
  HardwareSendReviewSnapshot,
  HardwareSendSignedSnapshot,
} from './sendWorkflow.ts';

const review: HardwareSendReviewSnapshot = {
  account,
  destinationAddress: 'prl1qdest',
  amountSats: 10_000_000n,
  feeRatePrlPerKb: 0.0001,
  preview: {
    amountSats: 10_000_000n,
    feeSats: 250n,
    changeSats: 89_999_750n,
    inputCount: 1,
    selectedOutpoints: [{txid: '11'.repeat(32), vout: 0, valueSats: 100_000_000n}],
    deviceDisplayAddress: 'bc1p...',
  },
  utxos: [],
  createdAt: 1,
};

const recipient: RecipientContext = {
  known: null,
  history: null,
  gate: {blocked: false, isLargeSend: false},
};

const snapshot: HardwareSendSignedSnapshot = {
  review,
  signed: {rawTransactionHex: 'aa', feeSats: 250n, changeSats: 89_999_750n, inputCount: 1},
};

function run(...actions: HardwareSendFormAction[]) {
  return actions.reduce(hardwareSendFormReducer, initialHardwareSendFormState);
}

test('happy path walks edit → review → signing → signed → broadcast success', () => {
  let state = run(
    {type: 'edit-address', value: 'prl1qdest'},
    {type: 'edit-amount', value: '0.1'},
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'sign-started'},
    {type: 'sign-completed', snapshot},
    {type: 'broadcast-started'}
  );
  assert.equal(state.stage.step, 'broadcasting');

  state = hardwareSendFormReducer(state, {type: 'broadcast-succeeded', txid: 'tx'});
  assert.equal(state.stage.step, 'edit');
  assert.equal(state.success, 'tx');
  assert.equal(state.address, '');
  assert.equal(state.amount, '');
});

test('field edits are ignored outside the edit stage', () => {
  const state = run(
    {type: 'edit-amount', value: '0.1'},
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'edit-amount', value: '999'}
  );
  assert.equal(state.amount, '0.1');
  assert.equal(state.stage.step, 'review');
});

test('device failure during signing returns to review with the error', () => {
  const state = run(
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'sign-started'},
    {type: 'sign-failed', message: 'rejected on device'}
  );
  assert.equal(state.stage.step, 'review');
  assert.equal(state.error, 'rejected on device');
});

test('broadcast failure stays on the signed transaction for retry', () => {
  const state = run(
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'sign-started'},
    {type: 'sign-completed', snapshot},
    {type: 'broadcast-started'},
    {type: 'broadcast-failed', message: 'network down'}
  );
  assert.equal(state.stage.step, 'signed');
  assert.equal(state.error, 'network down');
});

test('invalidation from any stage lands in edit with the message', () => {
  const state = run(
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'sign-started'},
    {type: 'stage-invalidated', message: 'state changed'}
  );
  assert.equal(state.stage.step, 'edit');
  assert.equal(state.error, 'state changed');
});

test('cancel from signed abandons back to edit, fields intact', () => {
  const state = run(
    {type: 'edit-amount', value: '0.1'},
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'sign-started'},
    {type: 'sign-completed', snapshot},
    {type: 'stage-cancelled'}
  );
  assert.equal(state.stage.step, 'edit');
  assert.equal(state.amount, '0.1');
  assert.equal(state.error, null);
});

test('reset (account switch) collapses any stage to edit', () => {
  const state = run(
    {type: 'review-preparing'},
    {type: 'review-prepared', review, recipient},
    {type: 'sign-started'},
    {type: 'sign-completed', snapshot},
    {type: 'reset', clearFields: true}
  );
  assert.equal(state.stage.step, 'edit');
  assert.equal(state.address, '');
});

test('out-of-order stage actions are ignored', () => {
  const state = run({type: 'sign-completed', snapshot});
  assert.equal(state.stage.step, 'edit');

  const state2 = run({type: 'broadcast-started'});
  assert.equal(state2.stage.step, 'edit');
});
