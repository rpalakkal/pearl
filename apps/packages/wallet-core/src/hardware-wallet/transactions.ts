import {schnorr} from '@noble/curves/secp256k1.js';
import {
  FEE_RATE_EPSILON,
  HARDWARE_TRANSACTION_LOCKTIME,
  HARDWARE_TRANSACTION_SEQUENCE,
  HARDWARE_TRANSACTION_VERSION,
  MIN_FEE_RATE_SATS_PER_VBYTE,
  SATS_PER_PEARL,
  TAPROOT_DUST_SATS,
} from './constants.ts';
import {bigintToSafeNumber, parseSatsValue} from './amounts.ts';
import {
  buffersEqual,
  bytesToHex,
  compressedPublicKeyFromHex,
  derivePearlTaprootOutputKey,
  getBitcoinDeviceDisplayAddress,
  pearlTaprootOutputKeyFromAddress,
  pearlTaprootScriptFromAddress,
  xOnlyPublicKeyFromHex,
} from './address.ts';
import {validateHardwareWalletAccount} from './account.ts';
import {ensureHardwareWalletBrowserGlobals, loadBitcoinJs} from './browser.ts';
import {getAccountPathFromAddressPath, getTrezorCoin, parseBip32Path} from './paths.ts';
import type {
  HardwarePearlSendPlan,
  HardwarePearlSendPreview,
  HardwarePearlSendRequest,
  HardwareWalletAddress,
  HardwareWalletUtxo,
  LedgerPearlSignPsbtOptions,
  TrezorPearlSignTransactionPayload,
} from './types.ts';

interface ExpectedTransactionOutput {
  script: Uint8Array;
  valueSats: bigint;
}

export function previewHardwarePearlSend(
  request: HardwarePearlSendRequest
): HardwarePearlSendPreview {
  validateHardwareWalletAccount(request.account);
  pearlTaprootOutputKeyFromAddress(request.destinationAddress, request.account.network);
  const {selectedUtxos, feeSats, changeSats} = selectUtxosForSend(
    request.utxos,
    request.amountSats,
    request.feeRatePrlPerKb
  );

  return {
    amountSats: request.amountSats,
    feeSats,
    changeSats,
    inputCount: selectedUtxos.length,
    selectedOutpoints: selectedUtxos.map(utxo => ({
      txid: utxo.txid.toLowerCase(),
      vout: utxo.vout,
      valueSats: parseUtxoValue(utxo),
    })),
    deviceDisplayAddress: getBitcoinDeviceDisplayAddress(
      request.destinationAddress,
      request.account.network
    ),
  };
}

export async function buildPearlSendPlan(
  request: HardwarePearlSendRequest
): Promise<HardwarePearlSendPlan> {
  validateHardwareWalletAccount(request.account);

  if (request.amountSats <= 0n) {
    throw new Error('Enter an amount greater than 0 PRL.');
  }

  const sourceScript = Uint8Array.from([
    0x51,
    0x20,
    ...derivePearlTaprootOutputKey(request.account.publicKey),
  ]);
  const sourceOutputKey = sourceScript.slice(2);
  const destinationScript = pearlTaprootScriptFromAddress(
    request.destinationAddress,
    request.account.network
  );
  const {selectedUtxos, feeSats, changeSats} = selectUtxosForSend(
    request.utxos,
    request.amountSats,
    request.feeRatePrlPerKb
  );
  const Buffer = await ensureHardwareWalletBrowserGlobals();
  const bitcoin = await loadBitcoinJs();
  const psbt = new bitcoin.Psbt({network: bitcoin.networks.bitcoin});
  psbt.setVersion(HARDWARE_TRANSACTION_VERSION);
  psbt.setLocktime(HARDWARE_TRANSACTION_LOCKTIME);
  const internalPubkey = xOnlyPublicKeyFromHex(request.account.publicKey);

  for (const utxo of selectedUtxos) {
    validateUtxo(utxo);
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: HARDWARE_TRANSACTION_SEQUENCE,
      witnessUtxo: {
        script: Buffer.from(sourceScript),
        value: bigintToSafeNumber(parseUtxoValue(utxo), 'UTXO value'),
      },
      tapInternalKey: Buffer.from(internalPubkey),
    });
  }

  psbt.addOutput({
    script: Buffer.from(destinationScript),
    value: bigintToSafeNumber(request.amountSats, 'Send amount'),
  });

  if (changeSats > 0n) {
    psbt.addOutput({
      script: Buffer.from(sourceScript),
      value: bigintToSafeNumber(changeSats, 'Change amount'),
    });
  }

  return {
    psbtBuffer: psbt.toBuffer(),
    feeSats,
    changeSats,
    selectedUtxos,
    sourceOutputKey,
  };
}

export async function buildLedgerSignPsbtOptions(
  account: HardwareWalletAddress,
  plan: HardwarePearlSendPlan
): Promise<LedgerPearlSignPsbtOptions> {
  if (account.vendor !== 'ledger') {
    throw new Error('Ledger signing requested for a non-Ledger account.');
  }

  const Buffer = await ensureHardwareWalletBrowserGlobals();

  return {
    finalizePsbt: true,
    accountPath: getAccountPathFromAddressPath(account.path),
    addressFormat: 'bech32m',
    knownAddressDerivations: new Map([
      [
        bytesToHex(plan.sourceOutputKey),
        {
          pubkey: Buffer.from(compressedPublicKeyFromHex(account.publicKey)),
          path: parseBip32Path(account.path),
        },
      ],
    ]),
  };
}

export function buildTrezorSignTransactionPayload(
  request: HardwarePearlSendRequest,
  plan: HardwarePearlSendPlan
): TrezorPearlSignTransactionPayload {
  if (request.account.vendor !== 'trezor') {
    throw new Error('Trezor signing requested for a non-Trezor account.');
  }

  const addressPath = parseBip32Path(request.account.path);

  return {
    coin: getTrezorCoin(request.account.network),
    serialize: true,
    version: HARDWARE_TRANSACTION_VERSION,
    locktime: HARDWARE_TRANSACTION_LOCKTIME,
    inputs: plan.selectedUtxos.map(utxo => ({
      address_n: addressPath,
      prev_hash: utxo.txid,
      prev_index: utxo.vout,
      amount: parseUtxoValue(utxo).toString(),
      script_type: 'SPENDTAPROOT',
      sequence: HARDWARE_TRANSACTION_SEQUENCE,
    })),
    outputs: [
      {
        address: getBitcoinDeviceDisplayAddress(
          request.destinationAddress,
          request.account.network
        ),
        amount: request.amountSats.toString(),
        script_type: 'PAYTOADDRESS',
      },
      ...(plan.changeSats > 0n
        ? [
            {
              address_n: addressPath,
              amount: plan.changeSats.toString(),
              script_type: 'PAYTOTAPROOT' as const,
            },
          ]
        : []),
    ],
  };
}

export async function validateSignedHardwareTransaction(
  rawTransactionHex: string,
  request: HardwarePearlSendRequest,
  plan: HardwarePearlSendPlan
): Promise<void> {
  if (!/^[0-9a-fA-F]+$/.test(rawTransactionHex) || rawTransactionHex.length % 2 !== 0) {
    throw new Error('Hardware wallet returned a malformed signed transaction.');
  }

  const bitcoin = await loadBitcoinJs();
  let transaction: InstanceType<typeof bitcoin.Transaction>;

  try {
    transaction = bitcoin.Transaction.fromHex(rawTransactionHex);
  } catch {
    throw new Error('Hardware wallet returned an invalid signed transaction.');
  }

  if (transaction.version !== HARDWARE_TRANSACTION_VERSION) {
    throw new Error('Signed transaction version does not match the send plan.');
  }

  if (transaction.locktime !== HARDWARE_TRANSACTION_LOCKTIME) {
    throw new Error('Signed transaction locktime does not match the send plan.');
  }

  if (transaction.ins.length !== plan.selectedUtxos.length) {
    throw new Error('Signed transaction input count does not match the send plan.');
  }

  for (let index = 0; index < plan.selectedUtxos.length; index += 1) {
    const expectedUtxo = plan.selectedUtxos[index];
    const actualInput = transaction.ins[index];
    const actualTxid = bytesToHex(Uint8Array.from([...actualInput.hash].reverse()));

    if (actualTxid !== expectedUtxo.txid.toLowerCase() || actualInput.index !== expectedUtxo.vout) {
      throw new Error('Signed transaction spends different inputs than the send plan.');
    }

    if (actualInput.sequence !== HARDWARE_TRANSACTION_SEQUENCE) {
      throw new Error('Signed transaction input sequence does not match the send plan.');
    }

    if (actualInput.script.length !== 0) {
      throw new Error('Signed transaction contains an invalid Taproot scriptSig.');
    }
  }

  const sourceScript = Uint8Array.from([
    0x51,
    0x20,
    ...derivePearlTaprootOutputKey(request.account.publicKey),
  ]);
  const expectedOutputs: ExpectedTransactionOutput[] = [
    {
      script: pearlTaprootScriptFromAddress(request.destinationAddress, request.account.network),
      valueSats: request.amountSats,
    },
  ];

  if (plan.changeSats > 0n) {
    expectedOutputs.push({
      script: sourceScript,
      valueSats: plan.changeSats,
    });
  }

  if (transaction.outs.length !== expectedOutputs.length) {
    throw new Error('Signed transaction output count does not match the send plan.');
  }

  const unmatchedOutputs = [...transaction.outs];

  for (const expectedOutput of expectedOutputs) {
    const outputIndex = unmatchedOutputs.findIndex(
      output =>
        BigInt(output.value) === expectedOutput.valueSats &&
        buffersEqual(output.script, expectedOutput.script)
    );

    if (outputIndex === -1) {
      throw new Error('Signed transaction outputs do not match the intended Pearl send.');
    }

    unmatchedOutputs.splice(outputIndex, 1);
  }

  const selectedInputSats = plan.selectedUtxos.reduce(
    (total, utxo) => total + parseUtxoValue(utxo),
    0n
  );
  const outputSats = transaction.outs.reduce((total, output) => total + BigInt(output.value), 0n);

  if (selectedInputSats - outputSats !== plan.feeSats) {
    throw new Error('Signed transaction fee does not match the send plan.');
  }

  const Buffer = await ensureHardwareWalletBrowserGlobals();
  const prevOutScripts = plan.selectedUtxos.map(() => Buffer.from(sourceScript));
  const prevOutValues = plan.selectedUtxos.map((utxo, index) =>
    bigintToSafeNumber(parseUtxoValue(utxo), `UTXO ${index} value`)
  );
  const sourceOutputKey = Buffer.from(plan.sourceOutputKey);

  for (let index = 0; index < transaction.ins.length; index += 1) {
    const witness = transaction.ins[index].witness;

    if (witness.length !== 1) {
      throw new Error('Signed transaction does not use a Taproot key-path witness.');
    }

    const signature = witness[0];

    if (signature.length !== 64 && signature.length !== 65) {
      throw new Error('Signed transaction contains an invalid Taproot signature.');
    }

    if (signature.length === 65 && signature[64] === bitcoin.Transaction.SIGHASH_DEFAULT) {
      throw new Error('Signed transaction contains an invalid Taproot signature hash type.');
    }

    const sighashType =
      signature.length === 65 ? signature[64] : bitcoin.Transaction.SIGHASH_DEFAULT;

    if (
      sighashType !== bitcoin.Transaction.SIGHASH_DEFAULT &&
      sighashType !== bitcoin.Transaction.SIGHASH_ALL
    ) {
      throw new Error('Signed transaction uses an unsupported Taproot signature hash type.');
    }

    const sighash = transaction.hashForWitnessV1(index, prevOutScripts, prevOutValues, sighashType);

    let signatureMatches = false;

    try {
      signatureMatches = schnorr.verify(signature.subarray(0, 64), sighash, sourceOutputKey);
    } catch {
      throw new Error('Signed transaction contains an invalid Taproot signature.');
    }

    if (!signatureMatches) {
      throw new Error('Signed transaction Taproot signature does not match this hardware account.');
    }
  }
}

export function isConfirmedHardwareUtxo(utxo: HardwareWalletUtxo): boolean {
  if (utxo.confirmations === 0 || utxo.height === 0) {
    return false;
  }

  if (utxo.confirmations !== undefined) {
    return utxo.confirmations > 0;
  }

  if (utxo.height !== undefined) {
    return utxo.height > 0;
  }

  return false;
}

export function parseUtxoValue(utxo: HardwareWalletUtxo): bigint {
  return parseSatsValue(utxo.value, 'UTXO value');
}

// Upper bound on a single send: every confirmed spendable UTXO as an input
// and one output (no change). Returns 0n when the fee would eat the balance.
export function maxSpendableHardwareSendSats(
  utxos: HardwareWalletUtxo[],
  feeRatePrlPerKb: number
): bigint {
  if (!Number.isFinite(feeRatePrlPerKb) || feeRatePrlPerKb <= 0) {
    return 0n;
  }

  const spendable = utxos.filter(utxo => {
    try {
      validateUtxo(utxo);
    } catch {
      return false;
    }
    return isConfirmedHardwareUtxo(utxo) && parseUtxoValue(utxo) > 0n;
  });

  if (spendable.length === 0) {
    return 0n;
  }

  const totalSats = spendable.reduce((total, utxo) => total + parseUtxoValue(utxo), 0n);
  const feeSats = estimateTaprootFeeSats(spendable.length, 1, feeRatePrlPerKb);
  return totalSats > feeSats ? totalSats - feeSats : 0n;
}

function selectUtxosForSend(
  utxos: HardwareWalletUtxo[],
  amountSats: bigint,
  feeRatePrlPerKb: number
): {selectedUtxos: HardwareWalletUtxo[]; feeSats: bigint; changeSats: bigint} {
  if (amountSats <= 0n) {
    throw new Error('Enter an amount greater than 0 PRL.');
  }

  if (!Number.isFinite(feeRatePrlPerKb) || feeRatePrlPerKb <= 0) {
    throw new Error('Unable to load a valid network fee estimate.');
  }

  const normalizedUtxos = utxos.map(utxo => {
    validateUtxo(utxo);
    return {
      utxo,
      valueSats: parseUtxoValue(utxo),
    };
  });
  const pendingValueSats = normalizedUtxos
    .filter(({utxo, valueSats}) => valueSats > 0n && !isConfirmedHardwareUtxo(utxo))
    .reduce((total, {valueSats}) => total + valueSats, 0n);
  const sortedUtxos = normalizedUtxos
    .filter(({valueSats}) => valueSats > 0n)
    .filter(({utxo}) => isConfirmedHardwareUtxo(utxo))
    .sort((a, b) => {
      return b.valueSats > a.valueSats ? 1 : b.valueSats < a.valueSats ? -1 : 0;
    });
  const selectedUtxos: HardwareWalletUtxo[] = [];
  let selectedValue = 0n;

  for (const {utxo, valueSats} of sortedUtxos) {
    selectedUtxos.push(utxo);
    selectedValue += valueSats;

    const noChangeFee = estimateTaprootFeeSats(selectedUtxos.length, 1, feeRatePrlPerKb);

    if (selectedValue < amountSats + noChangeFee) {
      continue;
    }

    const withChangeFee = estimateTaprootFeeSats(selectedUtxos.length, 2, feeRatePrlPerKb);
    const changeAfterChangeOutput = selectedValue - amountSats - withChangeFee;

    if (changeAfterChangeOutput >= TAPROOT_DUST_SATS) {
      return {
        selectedUtxos,
        feeSats: withChangeFee,
        changeSats: changeAfterChangeOutput,
      };
    }

    return {
      selectedUtxos,
      feeSats: selectedValue - amountSats,
      changeSats: 0n,
    };
  }

  if (pendingValueSats > 0n) {
    throw new Error(
      'Insufficient confirmed hardware wallet balance for amount plus network fee. Pending or unverified funds cannot be spent until Blockbook reports them confirmed.'
    );
  }

  throw new Error('Insufficient hardware wallet balance for amount plus network fee.');
}

export function estimateTaprootFeeSats(
  inputCount: number,
  outputCount: number,
  feeRatePrlPerKb: number
): bigint {
  const estimatedFeeRate = (feeRatePrlPerKb * Number(SATS_PER_PEARL)) / 1000;
  const feeRateSatsPerVbyte = Math.max(
    MIN_FEE_RATE_SATS_PER_VBYTE,
    Math.ceil(estimatedFeeRate - FEE_RATE_EPSILON)
  );
  const estimatedVbytes = 10 + inputCount * 58 + outputCount * 43;
  return BigInt(estimatedVbytes * feeRateSatsPerVbyte);
}

function validateTxid(txid: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error('Blockbook returned an invalid UTXO transaction id.');
  }
}

function validateUtxo(utxo: HardwareWalletUtxo): void {
  validateTxid(utxo.txid);

  if (!Number.isSafeInteger(utxo.vout) || utxo.vout < 0) {
    throw new Error('Blockbook returned an invalid UTXO output index.');
  }

  if (utxo.height !== undefined && (!Number.isSafeInteger(utxo.height) || utxo.height < 0)) {
    throw new Error('Blockbook returned an invalid UTXO height.');
  }

  if (
    utxo.confirmations !== undefined &&
    (!Number.isSafeInteger(utxo.confirmations) || utxo.confirmations < 0)
  ) {
    throw new Error('Blockbook returned an invalid UTXO confirmation count.');
  }

  parseUtxoValue(utxo);
}
