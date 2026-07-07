import assert from 'node:assert/strict';
import {test} from 'node:test';
import {account} from '../../lib/hardwareWalletTestFixtures.ts';
import {
  broadcastApprovedHardwareSend,
  prepareHardwareSendReview,
  signHardwareSendFromReview,
  PENDING_OUTGOING_HARDWARE_SEND_MESSAGE,
  type HardwareSendReviewSnapshot,
  type HardwareSendSignedSnapshot,
} from './sendWorkflow.ts';
import type {HardwareWalletBalanceData} from './balanceData.ts';
import type {
  BlockbookUtxo,
  HardwareWalletBroadcastRequest,
} from '../../../../types/app-bridge.ts';

const UTXOS: BlockbookUtxo[] = [
  {txid: '11'.repeat(32), vout: 0, value: '100000000', confirmations: 3},
];

function balance(overrides: Partial<HardwareWalletBalanceData> = {}): HardwareWalletBalanceData {
  return {
    info: {
      address: account.address,
      balance: '100000000',
      totalReceived: '100000000',
      totalSent: '0',
      unconfirmedBalance: '0',
      unconfirmedTxs: 0,
      txs: 1,
    },
    utxos: UTXOS,
    source: 'oyster',
    walletSyncing: false,
    ...overrides,
  };
}

function pendingOutgoingBalance(): HardwareWalletBalanceData {
  const b = balance();
  return {...b, info: {...b.info, unconfirmedBalance: '-100000'}};
}

const RECIPIENT = 'prl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sse9xfq3';

const activeAccount = () => true;

async function makeReview(): Promise<HardwareSendReviewSnapshot> {
  const result = await prepareHardwareSendReview({
    account,
    amountInput: '0.1',
    recipientInput: RECIPIENT,
    feeRatePrlPerKb: 0.0001,
    utxos: UTXOS,
    estimateFeeRate: async () => 0.0001,
    fetchBalanceData: async () => balance(),
    isActiveHardwareAccount: activeAccount,
  });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error('unreachable');
  return result.review;
}

const FAKE_SIGNED = {
  rawTransactionHex: 'aa'.repeat(64),
  feeSats: 250n,
  changeSats: 89_999_750n,
  inputCount: 1,
};

test('prepare produces a review snapshot with preview and refreshed fee rate', async () => {
  const review = await makeReview();
  assert.equal(review.destinationAddress, RECIPIENT);
  assert.equal(review.amountSats, 10_000_000n);
  assert.equal(review.preview.inputCount, 1);
  assert.equal(review.preview.selectedOutpoints.length, 1);
  assert.ok(review.preview.deviceDisplayAddress.startsWith('bc1p'));
});

test('prepare rejects when an outgoing transaction is pending', async () => {
  const result = await prepareHardwareSendReview({
    account,
    amountInput: '0.1',
    recipientInput: RECIPIENT,
    feeRatePrlPerKb: 0.0001,
    utxos: UTXOS,
    estimateFeeRate: async () => 0.0001,
    fetchBalanceData: async () => pendingOutgoingBalance(),
    isActiveHardwareAccount: activeAccount,
  });
  assert.equal(result.status, 'error');
  if (result.status === 'error') {
    assert.equal(result.message, PENDING_OUTGOING_HARDWARE_SEND_MESSAGE);
  }
});

test('prepare returns stale when the account switched mid-flight', async () => {
  const result = await prepareHardwareSendReview({
    account,
    amountInput: '0.1',
    recipientInput: RECIPIENT,
    feeRatePrlPerKb: 0.0001,
    utxos: UTXOS,
    estimateFeeRate: async () => 0.0001,
    fetchBalanceData: async () => balance(),
    isActiveHardwareAccount: () => false,
  });
  assert.equal(result.status, 'stale');
});

test('sign re-validates and signs with the injected signer', async () => {
  const review = await makeReview();
  let signedWith: unknown = null;
  const result = await signHardwareSendFromReview({
    review,
    fetchBalanceData: async () => balance(),
    isActiveHardwareAccount: activeAccount,
    signTransaction: async request => {
      signedWith = request;
      return FAKE_SIGNED;
    },
  });
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.snapshot.signed, FAKE_SIGNED);
    assert.equal(result.snapshot.review, review);
  }
  assert.ok(signedWith);
});

test('sign invalidates on pending outgoing without touching the device', async () => {
  const review = await makeReview();
  let deviceTouched = false;
  const result = await signHardwareSendFromReview({
    review,
    fetchBalanceData: async () => pendingOutgoingBalance(),
    isActiveHardwareAccount: activeAccount,
    signTransaction: async () => {
      deviceTouched = true;
      return FAKE_SIGNED;
    },
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(deviceTouched, false);
});

test('sign invalidates when the preview drifts from the review snapshot', async () => {
  const review = await makeReview();
  const driftedUtxos: BlockbookUtxo[] = [
    {txid: '22'.repeat(32), vout: 1, value: '100000000', confirmations: 3},
  ];
  let deviceTouched = false;
  const result = await signHardwareSendFromReview({
    review,
    fetchBalanceData: async () => balance({utxos: driftedUtxos}),
    isActiveHardwareAccount: activeAccount,
    signTransaction: async () => {
      deviceTouched = true;
      return FAKE_SIGNED;
    },
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(deviceTouched, false);
});

test('device rejection surfaces as an error, not an invalidation', async () => {
  const review = await makeReview();
  const result = await signHardwareSendFromReview({
    review,
    fetchBalanceData: async () => balance(),
    isActiveHardwareAccount: activeAccount,
    signTransaction: async () => {
      throw new Error('user rejected on device');
    },
  });
  assert.equal(result.status, 'error');
});

async function makeSignedSnapshot(): Promise<HardwareSendSignedSnapshot> {
  const review = await makeReview();
  return {review, signed: FAKE_SIGNED};
}

test('approve broadcasts with send-history metadata attached', async () => {
  const snapshot = await makeSignedSnapshot();
  let request: HardwareWalletBroadcastRequest | null = null;
  const result = await broadcastApprovedHardwareSend({
    snapshot,
    broadcastHardwareTransaction: async req => {
      request = req;
      return {txid: 'cc'.repeat(32), balance: balance()};
    },
    fetchBalanceData: async () => balance(),
    isActiveHardwareAccount: activeAccount,
  });
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.txid, 'cc'.repeat(32));
    assert.equal(result.feeSats, FAKE_SIGNED.feeSats);
  }
  assert.ok(request);
  const broadcastRequest = request as unknown as HardwareWalletBroadcastRequest;
  assert.equal(broadcastRequest.recipientAddress, RECIPIENT);
  assert.equal(broadcastRequest.amountSats, '10000000');
  assert.equal(broadcastRequest.rawTransactionHex, FAKE_SIGNED.rawTransactionHex);
});

test('approve invalidates when a signed input vanished', async () => {
  const snapshot = await makeSignedSnapshot();
  let broadcasted = false;
  const result = await broadcastApprovedHardwareSend({
    snapshot,
    broadcastHardwareTransaction: async () => {
      broadcasted = true;
      return {txid: 'cc'.repeat(32), balance: null};
    },
    fetchBalanceData: async () =>
      balance({utxos: [{txid: '99'.repeat(32), vout: 0, value: '100000000', confirmations: 1}]}),
    isActiveHardwareAccount: activeAccount,
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(broadcasted, false);
});

test('approve invalidates when a new outgoing transaction is pending', async () => {
  const snapshot = await makeSignedSnapshot();
  const result = await broadcastApprovedHardwareSend({
    snapshot,
    broadcastHardwareTransaction: async () => {
      throw new Error('should not broadcast');
    },
    fetchBalanceData: async () => pendingOutgoingBalance(),
    isActiveHardwareAccount: activeAccount,
  });
  assert.equal(result.status, 'invalidated');
});

test('approve broadcast failure is an error and stays retryable', async () => {
  const snapshot = await makeSignedSnapshot();
  const result = await broadcastApprovedHardwareSend({
    snapshot,
    broadcastHardwareTransaction: async () => {
      throw new Error('network down');
    },
    fetchBalanceData: async () => balance(),
    isActiveHardwareAccount: activeAccount,
  });
  assert.equal(result.status, 'error');
});
