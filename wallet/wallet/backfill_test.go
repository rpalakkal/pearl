// Copyright (c) 2025-2026 The Pearl Research Labs
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package wallet

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
	"github.com/pearl-research-labs/pearl/node/txscript"
	"github.com/pearl-research-labs/pearl/node/wire"
	"github.com/pearl-research-labs/pearl/wallet/chain"
	"github.com/pearl-research-labs/pearl/wallet/waddrmgr"
	"github.com/pearl-research-labs/pearl/wallet/walletdb"
	"github.com/pearl-research-labs/pearl/wallet/wtxmgr"
	"github.com/stretchr/testify/require"
)

// scriptedChainClient extends the basic mock with scriptable behavior for
// the backfill engine: a controllable current flag, deterministic
// hash/header lookups, recorded FilterBlocks requests, and scripted
// responses.
type scriptedChainClient struct {
	mockChainClient

	mtx sync.Mutex

	current        bool
	bestHeight     int32
	notifyReceived [][]btcutil.Address
	notifyErr      error

	// filterScript is consumed one entry per FilterBlocks call; nil entries
	// mean "no match in this batch". filterRequests records every request.
	filterScript   []*chain.FilterBlocksResponse
	filterErrs     []error
	filterRequests []*chain.FilterBlocksRequest

	// Order tracking for the NotifyReceived-before-target invariant.
	events []string
}

func hashForHeight(height int32) chainhash.Hash {
	var h chainhash.Hash
	h[0] = byte(height)
	h[1] = byte(height >> 8)
	h[2] = byte(height >> 16)
	return h
}

func (s *scriptedChainClient) IsCurrent() bool {
	s.mtx.Lock()
	defer s.mtx.Unlock()
	return s.current
}

func (s *scriptedChainClient) GetBestBlock() (*chainhash.Hash, int32, error) {
	s.mtx.Lock()
	defer s.mtx.Unlock()
	s.events = append(s.events, "GetBestBlock")
	h := hashForHeight(s.bestHeight)
	return &h, s.bestHeight, nil
}

func (s *scriptedChainClient) GetBlockHash(height int64) (*chainhash.Hash, error) {
	h := hashForHeight(int32(height))
	return &h, nil
}

func (s *scriptedChainClient) GetBlockHeader(*chainhash.Hash) (*wire.BlockHeader, error) {
	return &wire.BlockHeader{Timestamp: time.Unix(1234, 0)}, nil
}

func (s *scriptedChainClient) NotifyReceived(addrs []btcutil.Address) error {
	s.mtx.Lock()
	defer s.mtx.Unlock()
	s.events = append(s.events, "NotifyReceived")
	if s.notifyErr != nil {
		return s.notifyErr
	}
	s.notifyReceived = append(s.notifyReceived, addrs)
	return nil
}

func (s *scriptedChainClient) FilterBlocks(req *chain.FilterBlocksRequest) (
	*chain.FilterBlocksResponse, error) {

	s.mtx.Lock()
	defer s.mtx.Unlock()

	// Snapshot the request (WatchedOutPoints map mutates between calls).
	snapshot := &chain.FilterBlocksRequest{
		Blocks:           req.Blocks,
		ExternalAddrs:    req.ExternalAddrs,
		WatchedOutPoints: make(map[wire.OutPoint]btcutil.Address, len(req.WatchedOutPoints)),
	}
	for op, addr := range req.WatchedOutPoints {
		snapshot.WatchedOutPoints[op] = addr
	}
	s.filterRequests = append(s.filterRequests, snapshot)

	if len(s.filterErrs) > 0 {
		err := s.filterErrs[0]
		s.filterErrs = s.filterErrs[1:]
		if err != nil {
			return nil, err
		}
	}

	if len(s.filterScript) == 0 {
		return nil, nil
	}
	resp := s.filterScript[0]
	s.filterScript = s.filterScript[1:]
	return resp, nil
}

func testAddress(t *testing.T, w *Wallet) btcutil.Address {
	t.Helper()
	// Derive an address; requires the chain client to be set first.
	addr, err := w.CurrentAddress(0, waddrmgr.KeyScopeBIP0086)
	require.NoError(t, err)
	return addr
}

func waitForJob(t *testing.T, w *Wallet, address string,
	wantStatus string) BackfillJobStatus {

	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		status, ok := w.BackfillStatus(address)
		if ok && status.Status == wantStatus {
			return status
		}
		if ok && status.Status == BackfillStatusFailed &&
			wantStatus != BackfillStatusFailed {
			t.Fatalf("job failed unexpectedly: %s", status.Error)
		}
		time.Sleep(10 * time.Millisecond)
	}
	status, _ := w.BackfillStatus(address)
	t.Fatalf("job never reached %q; last: %+v", wantStatus, status)
	return BackfillJobStatus{}
}

func TestBackfillCompletesAndReportsProgress(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	chainClient := &scriptedChainClient{current: true, bestHeight: 4999}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	syncedBefore := w.Manager.SyncedTo()

	status, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)
	require.Equal(t, BackfillStatusQueued, status.Status)
	require.Equal(t, int32(0), status.TargetHeight) // resolved later

	final := waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)
	require.Equal(t, int32(4999), final.TargetHeight)
	require.Equal(t, int32(4999), final.CurrentHeight)

	// 5000 blocks => 3 batches of <=2000, no matches => 3 FilterBlocks calls.
	chainClient.mtx.Lock()
	defer chainClient.mtx.Unlock()
	require.Len(t, chainClient.filterRequests, 3)
	require.Len(t, chainClient.filterRequests[0].Blocks, 2000)
	require.Len(t, chainClient.filterRequests[2].Blocks, 1000)

	// The wallet's sync tip must be untouched by a backfill.
	require.Equal(t, syncedBefore, w.Manager.SyncedTo())
}

func TestBackfillNotifiesBeforeResolvingTarget(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	chainClient := &scriptedChainClient{current: true, bestHeight: 10}
	w.chainClient = chainClient

	addr := testAddress(t, w)

	// Address derivation itself calls NotifyReceived; reset the recorder so
	// we only observe the backfill's own calls.
	chainClient.mtx.Lock()
	chainClient.notifyReceived = nil
	chainClient.events = nil
	chainClient.mtx.Unlock()

	_, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)
	waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)

	chainClient.mtx.Lock()
	defer chainClient.mtx.Unlock()
	require.Len(t, chainClient.notifyReceived, 1)
	require.Equal(t, []string{"NotifyReceived", "GetBestBlock"},
		chainClient.events[:2],
		"live subscription must precede target resolution")
}

func TestBackfillWaitsUntilChainIsCurrent(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	chainClient := &scriptedChainClient{current: false, bestHeight: 10}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	_, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)

	// Stays queued while the chain reports not-current.
	time.Sleep(300 * time.Millisecond)
	status, ok := w.BackfillStatus(addr.EncodeAddress())
	require.True(t, ok)
	require.Equal(t, BackfillStatusQueued, status.Status)

	chainClient.mtx.Lock()
	chainClient.current = true
	chainClient.mtx.Unlock()

	waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)
}

func TestBackfillAccumulatesFoundOutpointsAcrossBatches(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	addrScript := hashForHeight(7)
	outPoint := wire.OutPoint{Hash: addrScript, Index: 1}

	// Script: first batch reports a found outpoint (no txns to keep the
	// wallet db out of it); subsequent calls report no match.
	chainClient := &scriptedChainClient{
		current:    true,
		bestHeight: 3999, // two batches
	}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	chainClient.filterScript = []*chain.FilterBlocksResponse{
		{
			BatchIndex:     1999, // last block of batch 1
			BlockMeta:      blockMetaAt(1999),
			FoundOutPoints: map[wire.OutPoint]btcutil.Address{outPoint: addr},
		},
	}

	_, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)
	waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)

	chainClient.mtx.Lock()
	defer chainClient.mtx.Unlock()
	// Calls: batch1 (match at end, trim leaves empty), batch2.
	require.GreaterOrEqual(t, len(chainClient.filterRequests), 2)
	second := chainClient.filterRequests[len(chainClient.filterRequests)-1]
	require.Contains(t, second.WatchedOutPoints, outPoint,
		"found outpoints must be watched in later batches so spends are caught")
}

func TestBackfillRetriesThenFails(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	boom := errors.New("peers starving")
	chainClient := &scriptedChainClient{
		current:    true,
		bestHeight: 10,
		filterErrs: []error{boom, boom, boom, boom, boom},
	}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	_, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)

	// 5 attempts with 1s+2s+4s+8s backoff is too slow for a unit test; the
	// backoff caps at 30s and starts at 1s. Wait generously but bounded.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		status, ok := w.BackfillStatus(addr.EncodeAddress())
		if ok && status.Status == BackfillStatusFailed {
			require.Contains(t, status.Error, "peers starving")
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("job never failed")
}

func TestBackfillDuplicateStartReturnsExistingJob(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	chainClient := &scriptedChainClient{current: false, bestHeight: 10}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	first, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)

	second, err := w.StartAddressBackfill(addr, 5)
	require.NoError(t, err)
	require.Equal(t, first.StartHeight, second.StartHeight,
		"second start must return the existing queued job")

	chainClient.mtx.Lock()
	chainClient.current = true
	chainClient.mtx.Unlock()
	waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)
}

func TestBackfillClampsStartHeight(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	chainClient := &scriptedChainClient{current: true, bestHeight: 10}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	_, err := w.StartAddressBackfill(addr, 500)
	require.NoError(t, err)

	final := waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)
	require.Equal(t, int32(10), final.CurrentHeight)
}

func TestBackfillRecordsRelevantTransactions(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	addr := testAddress(t, w)
	pkScript, err := txscript.PayToAddrScript(addr)
	require.NoError(t, err)

	// A transaction paying the backfilled address.
	tx := wire.NewMsgTx(wire.TxVersion)
	tx.AddTxIn(&wire.TxIn{PreviousOutPoint: wire.OutPoint{Index: 0}})
	tx.AddTxOut(&wire.TxOut{Value: 100_000, PkScript: pkScript})

	chainClient := &scriptedChainClient{current: true, bestHeight: 99}
	chainClient.filterScript = []*chain.FilterBlocksResponse{
		{
			BatchIndex:   50,
			BlockMeta:    blockMetaAt(50),
			RelevantTxns: []*wire.MsgTx{tx},
		},
	}
	w.chainClient = chainClient

	_, err = w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)
	waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)

	// The transaction must be recorded in the wallet's tx store with a
	// credit for our address.
	txHash := tx.TxHash()
	var details *wtxmgr.TxDetails
	err = walletdb.View(w.db, func(dbtx walletdb.ReadTx) error {
		ns := dbtx.ReadBucket(wtxmgrNamespaceKey)
		var err error
		details, err = w.TxStore.TxDetails(ns, &txHash)
		return err
	})
	require.NoError(t, err)
	require.NotNil(t, details, "backfilled transaction missing from tx store")
	require.Len(t, details.Credits, 1)
	require.Equal(t, int64(100_000), int64(details.Credits[0].Amount))
	require.Equal(t, int32(50), details.Block.Height)
}

func blockMetaAt(height int32) wtxmgr.BlockMeta {
	return wtxmgr.BlockMeta{
		Block: wtxmgr.Block{Hash: hashForHeight(height), Height: height},
		Time:  time.Unix(1234, 0),
	}
}

func TestAddressHistoryClassifiesFromAddressPerspective(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	addr := testAddress(t, w)
	pkScript, err := txscript.PayToAddrScript(addr)
	require.NoError(t, err)

	// Foreign output script (another taproot-like witness program).
	foreign := make([]byte, 34)
	foreign[0] = txscript.OP_1
	foreign[1] = 32
	foreign[2] = 0x99

	// tx1 pays the address 100k.
	fundingTx := wire.NewMsgTx(wire.TxVersion)
	fundingTx.AddTxIn(&wire.TxIn{PreviousOutPoint: wire.OutPoint{Index: 3}})
	fundingTx.AddTxOut(&wire.TxOut{Value: 100_000, PkScript: pkScript})
	fundingHash := fundingTx.TxHash()

	// tx2 spends tx1:0 and pays 60k to a foreign script (fee 40k).
	spendTx := wire.NewMsgTx(wire.TxVersion)
	spendTx.AddTxIn(&wire.TxIn{
		PreviousOutPoint: wire.OutPoint{Hash: fundingHash, Index: 0},
	})
	spendTx.AddTxOut(&wire.TxOut{Value: 60_000, PkScript: foreign})

	chainClient := &scriptedChainClient{current: true, bestHeight: 99}
	chainClient.filterScript = []*chain.FilterBlocksResponse{
		{
			BatchIndex:   50,
			BlockMeta:    blockMetaAt(50),
			RelevantTxns: []*wire.MsgTx{fundingTx},
			FoundOutPoints: map[wire.OutPoint]btcutil.Address{
				{Hash: fundingHash, Index: 0}: addr,
			},
		},
		{
			// BatchIndex is relative to the (trimmed) request: after the
			// match at index 50, the remaining batch starts at height 51,
			// so height 60 sits at index 9.
			BatchIndex:   9,
			BlockMeta:    blockMetaAt(60),
			RelevantTxns: []*wire.MsgTx{spendTx},
		},
	}
	w.chainClient = chainClient

	_, err = w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)
	waitForJob(t, w, addr.EncodeAddress(), BackfillStatusComplete)

	entries, err := w.AddressHistory(addr)
	require.NoError(t, err)
	require.Len(t, entries, 2)

	byHash := map[chainhash.Hash]AddressHistoryEntry{}
	for _, entry := range entries {
		byHash[entry.TxHash] = entry
	}

	funding := byHash[fundingHash]
	require.False(t, funding.Sent, "payment TO the address must be a receive")
	require.Equal(t, btcutil.Amount(100_000), funding.Amount)

	spend := byHash[spendTx.TxHash()]
	require.True(t, spend.Sent, "spend FROM the address must be a send")
	require.Equal(t, btcutil.Amount(60_000), spend.Amount)
	require.Equal(t, btcutil.Amount(40_000), spend.Fee)
}

func TestBackfillWatermarkPersistsAndGatesReimports(t *testing.T) {
	w, cleanup := testWallet(t)
	defer cleanup()

	chainClient := &scriptedChainClient{current: true, bestHeight: 10}
	w.chainClient = chainClient

	addr := testAddress(t, w)
	encoded := addr.EncodeAddress()

	// No watermark before any backfill.
	_, done := w.BackfilledThrough(encoded)
	require.False(t, done)

	_, err := w.StartAddressBackfill(addr, 0)
	require.NoError(t, err)
	waitForJob(t, w, encoded, BackfillStatusComplete)

	height, done := w.BackfilledThrough(encoded)
	require.True(t, done)
	require.Equal(t, int32(10), height)

	// A failed job must not record a watermark. Derive the second address
	// before injecting the failure (derivation itself subscribes).
	other := deriveSecondAddress(t, w)

	chainClient.mtx.Lock()
	chainClient.notifyErr = errors.New("subscribe down")
	chainClient.mtx.Unlock()

	_, err = w.StartAddressBackfill(other, 0)
	require.NoError(t, err)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		status, ok := w.BackfillStatus(other.EncodeAddress())
		if ok && status.Status == BackfillStatusFailed {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	_, done = w.BackfilledThrough(other.EncodeAddress())
	require.False(t, done)
}

func deriveSecondAddress(t *testing.T, w *Wallet) btcutil.Address {
	t.Helper()
	addr, err := w.NewAddress(0, waddrmgr.KeyScopeBIP0086, false)
	require.NoError(t, err)
	return addr
}
