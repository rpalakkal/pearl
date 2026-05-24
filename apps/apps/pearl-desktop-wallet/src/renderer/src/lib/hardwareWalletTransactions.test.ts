import assert from 'node:assert/strict';
import test from 'node:test';
import {schnorr} from '@noble/curves/secp256k1.js';
import {
  buildLedgerSignPsbtOptions,
  buildPearlSendPlan,
  buildTrezorSignTransactionPayload,
  getBitcoinDeviceDisplayAddress,
  isConfirmedHardwareUtxo,
  pearlTaprootScriptFromAddress,
  previewHardwarePearlSend,
  validateSignedHardwareTransaction,
  type HardwareWalletAddress,
  type HardwareWalletUtxo,
} from './hardwareWallet.ts';
import {
  account,
  hex,
  mainnetAddress,
  publicKey,
  trezorAccount,
  tweakPrivateKeyForBip86,
} from './hardwareWalletTestFixtures.ts';

test('previews and builds the same one-input Pearl Taproot PSBT plan', async () => {
  const utxos: HardwareWalletUtxo[] = [
    {txid: '11'.repeat(32), vout: 0, value: '100000', confirmations: 1},
  ];
  const request = {
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos,
  };
  const preview = previewHardwarePearlSend(request);
  const plan = await buildPearlSendPlan(request);
  const bitcoin = await import('bitcoinjs-lib');

  assert.equal(preview.feeSats, 154n);
  assert.equal(preview.changeSats, 49_846n);
  assert.equal(preview.inputCount, 1);
  assert.deepEqual(preview.selectedOutpoints, [
    {
      txid: '11'.repeat(32),
      vout: 0,
      valueSats: 100_000n,
    },
  ]);
  assert.equal(
    preview.deviceDisplayAddress,
    getBitcoinDeviceDisplayAddress(mainnetAddress, 'mainnet')
  );
  assert.equal(plan.feeSats, preview.feeSats);
  assert.equal(plan.changeSats, preview.changeSats);
  assert.equal(plan.selectedUtxos.length, preview.inputCount);

  const psbt = bitcoin.Psbt.fromBuffer(Buffer.from(plan.psbtBuffer), {
    network: bitcoin.networks.bitcoin,
  });
  const sourceScript = pearlTaprootScriptFromAddress(account.address, account.network);
  const destinationScript = pearlTaprootScriptFromAddress(mainnetAddress, account.network);

  assert.equal(psbt.version, 2);
  assert.equal(psbt.locktime, 0);
  assert.equal(psbt.txInputs[0].sequence, 0xffffffff);
  assert.equal(hex(plan.sourceOutputKey), hex(sourceScript.slice(2)));
  assert.equal(psbt.inputCount, 1);
  assert.equal(psbt.txOutputs.length, 2);
  assert.deepEqual(
    psbt.txOutputs.map(output => output.value),
    [50_000, 49_846]
  );
  assert.deepEqual(
    psbt.txOutputs.map(output => output.script.toString('hex')),
    [hex(destinationScript), hex(sourceScript)]
  );
});

test('tracks selected outpoints in previews so refreshed input changes require review', () => {
  const left = previewHardwarePearlSend({
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{txid: '11'.repeat(32), vout: 0, value: '100000', confirmations: 1}],
  });
  const right = previewHardwarePearlSend({
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{txid: '22'.repeat(32), vout: 0, value: '100000', confirmations: 1}],
  });

  assert.equal(left.inputCount, right.inputCount);
  assert.equal(left.feeSats, right.feeSats);
  assert.equal(left.changeSats, right.changeSats);
  assert.notDeepEqual(left.selectedOutpoints, right.selectedOutpoints);
});

test('builds the Taproot-only Trezor Connect signing payload for Pearl sends', async () => {
  const request = {
    account: trezorAccount,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{txid: '99'.repeat(32), vout: 2, value: '100000', confirmations: 1}],
  };
  const plan = await buildPearlSendPlan(request);
  const payload = buildTrezorSignTransactionPayload(request, plan);

  assert.deepEqual(payload, {
    coin: 'btc',
    serialize: true,
    version: 2,
    locktime: 0,
    inputs: [
      {
        address_n: [0x80000056, 0x80000000, 0x80000000, 0, 0],
        prev_hash: '99'.repeat(32),
        prev_index: 2,
        amount: '100000',
        script_type: 'SPENDTAPROOT',
        sequence: 0xffffffff,
      },
    ],
    outputs: [
      {
        address: getBitcoinDeviceDisplayAddress(mainnetAddress, 'mainnet'),
        amount: '50000',
        script_type: 'PAYTOADDRESS',
      },
      {
        address_n: [0x80000056, 0x80000000, 0x80000000, 0, 0],
        amount: '49846',
        script_type: 'PAYTOTAPROOT',
      },
    ],
  });

  assert.throws(
    () => buildTrezorSignTransactionPayload({...request, account}, plan),
    /non-Trezor account/
  );
});

test('builds Ledger PSBT signing options with known Pearl Taproot derivation data', async () => {
  const indexedAccount: HardwareWalletAddress = {
    ...account,
    path: "m/86'/0'/0'/0/2",
    addressIndex: 2,
  };
  const request = {
    account: indexedAccount,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{txid: 'aa'.repeat(32), vout: 1, value: '100000', confirmations: 1}],
  };
  const plan = await buildPearlSendPlan(request);
  const options = await buildLedgerSignPsbtOptions(indexedAccount, plan);
  const derivations = [...options.knownAddressDerivations.entries()];

  assert.equal(options.finalizePsbt, true);
  assert.equal(options.accountPath, "m/86'/0'/0'");
  assert.equal(options.addressFormat, 'bech32m');
  assert.equal(derivations.length, 1);
  assert.equal(derivations[0][0], hex(plan.sourceOutputKey));
  assert.equal(derivations[0][1].pubkey.toString('hex'), publicKey);
  assert.deepEqual(derivations[0][1].path, [0x80000056, 0x80000000, 0x80000000, 0, 2]);

  await assert.rejects(() => buildLedgerSignPsbtOptions(trezorAccount, plan), /non-Ledger account/);
});

test('validates Taproot key-path signatures returned by a hardware wallet', async () => {
  const request = {
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{txid: '55'.repeat(32), vout: 0, value: '100000', confirmations: 1}],
  };
  const plan = await buildPearlSendPlan(request);
  const bitcoin = await import('bitcoinjs-lib');
  const sourceScript = Buffer.from(pearlTaprootScriptFromAddress(account.address, account.network));
  const destinationScript = Buffer.from(
    pearlTaprootScriptFromAddress(mainnetAddress, account.network)
  );
  const tx = new bitcoin.Transaction();

  tx.version = 2;
  tx.addInput(Buffer.from(request.utxos[0].txid, 'hex').reverse(), request.utxos[0].vout);
  tx.addOutput(destinationScript, Number(request.amountSats));
  tx.addOutput(sourceScript, Number(plan.changeSats));

  const sighash = tx.hashForWitnessV1(
    0,
    [sourceScript],
    [Number(request.utxos[0].value)],
    bitcoin.Transaction.SIGHASH_DEFAULT
  );
  const signature = Buffer.from(schnorr.sign(sighash, tweakPrivateKeyForBip86(1n)));
  tx.setWitness(0, [signature]);

  await assert.doesNotReject(() => validateSignedHardwareTransaction(tx.toHex(), request, plan));

  tx.version = 1;
  await assert.rejects(
    () => validateSignedHardwareTransaction(tx.toHex(), request, plan),
    /version does not match/
  );
  tx.version = 2;

  tx.locktime = 1;
  await assert.rejects(
    () => validateSignedHardwareTransaction(tx.toHex(), request, plan),
    /locktime does not match/
  );
  tx.locktime = 0;

  tx.ins[0].sequence = 0xfffffffd;
  await assert.rejects(
    () => validateSignedHardwareTransaction(tx.toHex(), request, plan),
    /sequence does not match/
  );
  tx.ins[0].sequence = 0xffffffff;

  tx.ins[0].script = Buffer.from([0x51]);
  await assert.rejects(
    () => validateSignedHardwareTransaction(tx.toHex(), request, plan),
    /invalid Taproot scriptSig/
  );
  tx.ins[0].script = Buffer.alloc(0);

  const allSighash = tx.hashForWitnessV1(
    0,
    [sourceScript],
    [Number(request.utxos[0].value)],
    bitcoin.Transaction.SIGHASH_ALL
  );
  tx.setWitness(0, [
    Buffer.concat([
      Buffer.from(schnorr.sign(allSighash, tweakPrivateKeyForBip86(1n))),
      Buffer.from([bitcoin.Transaction.SIGHASH_ALL]),
    ]),
  ]);

  await assert.doesNotReject(() => validateSignedHardwareTransaction(tx.toHex(), request, plan));

  tx.setWitness(0, [
    Buffer.concat([signature, Buffer.from([bitcoin.Transaction.SIGHASH_DEFAULT])]),
  ]);

  await assert.rejects(
    () => validateSignedHardwareTransaction(tx.toHex(), request, plan),
    /invalid Taproot signature hash type/
  );

  const tamperedSignature = Buffer.from(signature);
  tamperedSignature[0] ^= 0x01;
  tx.setWitness(0, [tamperedSignature]);

  await assert.rejects(
    () => validateSignedHardwareTransaction(tx.toHex(), request, plan),
    /Taproot signature does not match/
  );
});

test('folds dust change into the transaction fee', async () => {
  const request = {
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{txid: '22'.repeat(32), vout: 0, value: '50120', confirmations: 1}],
  };
  const preview = previewHardwarePearlSend(request);
  const plan = await buildPearlSendPlan(request);
  const bitcoin = await import('bitcoinjs-lib');
  const psbt = bitcoin.Psbt.fromBuffer(Buffer.from(plan.psbtBuffer), {
    network: bitcoin.networks.bitcoin,
  });

  assert.equal(preview.feeSats, 120n);
  assert.equal(preview.changeSats, 0n);
  assert.equal(plan.feeSats, 120n);
  assert.equal(plan.changeSats, 0n);
  assert.equal(psbt.txOutputs.length, 1);
  assert.equal(psbt.txOutputs[0].value, 50_000);
});

test('excludes unconfirmed hardware wallet UTXOs from send plans', async () => {
  const confirmedTxid = '33'.repeat(32);
  const request = {
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [
      {txid: '44'.repeat(32), vout: 0, value: '1000000', confirmations: 0},
      {txid: confirmedTxid, vout: 0, value: '100000', confirmations: 1},
    ],
  };
  const preview = previewHardwarePearlSend(request);
  const plan = await buildPearlSendPlan(request);

  assert.equal(preview.inputCount, 1);
  assert.equal(plan.selectedUtxos.length, 1);
  assert.equal(plan.selectedUtxos[0].txid, confirmedTxid);
});

test('requires Blockbook confirmation metadata before spending hardware wallet UTXOs', async () => {
  const confirmedTxid = '77'.repeat(32);
  const request = {
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [
      {txid: '66'.repeat(32), vout: 0, value: '1000000'},
      {txid: confirmedTxid, vout: 0, value: '100000', height: 1},
    ],
  };
  const preview = previewHardwarePearlSend(request);
  const plan = await buildPearlSendPlan(request);

  assert.equal(isConfirmedHardwareUtxo(request.utxos[0]), false);
  assert.equal(isConfirmedHardwareUtxo(request.utxos[1]), true);
  assert.equal(preview.inputCount, 1);
  assert.equal(plan.selectedUtxos.length, 1);
  assert.equal(plan.selectedUtxos[0].txid, confirmedTxid);
});

test('explains when only pending hardware wallet funds can cover a send', () => {
  assert.throws(
    () =>
      previewHardwarePearlSend({
        account,
        destinationAddress: mainnetAddress,
        amountSats: 50_000n,
        feeRatePrlPerKb: 0.00001,
        utxos: [{txid: '55'.repeat(32), vout: 0, value: '1000000', confirmations: 0}],
      }),
    /Insufficient confirmed hardware wallet balance/
  );
});
