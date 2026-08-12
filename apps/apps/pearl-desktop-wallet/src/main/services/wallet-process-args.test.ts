import assert from 'node:assert/strict';
import test from 'node:test';
import {buildWalletArgs} from './wallet-process-args.ts';

const baseConfig = {
  dataDir: '/wallet-data',
  rpcUser: 'rpc-user',
  rpcPassword: 'rpc-password',
};

test('builds mainnet arguments without pinning a peer', () => {
  assert.deepEqual(buildWalletArgs(baseConfig, {rpcPort: 8335, walletFlag: ''}), [
    '--usespv',
    '--appdata=/wallet-data',
    '--username=rpc-user',
    '--password=rpc-password',
    '--rpclisten=127.0.0.1:8335',
    '--noservertls',
  ]);
});

test('inserts the testnet wallet flag immediately after SPV mode', () => {
  assert.deepEqual(buildWalletArgs(baseConfig, {rpcPort: 8335, walletFlag: '--testnet2'}), [
    '--usespv',
    '--testnet2',
    '--appdata=/wallet-data',
    '--username=rpc-user',
    '--password=rpc-password',
    '--rpclisten=127.0.0.1:8335',
    '--noservertls',
  ]);
});

test('adds only a complete custom peer', () => {
  const networkConfig = {rpcPort: 8335, walletFlag: ''};

  assert.deepEqual(
    buildWalletArgs(
      {...baseConfig, peerAddress: 'node.example.com', peerPort: 44108},
      networkConfig
    ),
    [
      '--usespv',
      '--appdata=/wallet-data',
      '--username=rpc-user',
      '--password=rpc-password',
      '--rpclisten=127.0.0.1:8335',
      '--noservertls',
      '--addpeer=node.example.com:44108',
    ]
  );

  assert.equal(
    buildWalletArgs({...baseConfig, peerAddress: 'node.example.com'}, networkConfig).some(arg =>
      arg.startsWith('--addpeer=')
    ),
    false
  );
  assert.equal(
    buildWalletArgs({...baseConfig, peerPort: 44108}, networkConfig).some(arg =>
      arg.startsWith('--addpeer=')
    ),
    false
  );
});
