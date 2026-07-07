// Copyright (c) 2025-2026 The Pearl Research Labs
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package wallet

import (
	"fmt"
	"time"

	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/wire"
	"github.com/pearl-research-labs/pearl/wallet/chain"
	"github.com/pearl-research-labs/pearl/wallet/waddrmgr"
	"github.com/pearl-research-labs/pearl/wallet/walletdb"
	"github.com/pearl-research-labs/pearl/wallet/wtxmgr"
)

// Backfill job states reported by BackfillStatus.
const (
	BackfillStatusQueued   = "queued"
	BackfillStatusRunning  = "running"
	BackfillStatusComplete = "complete"
	BackfillStatusFailed   = "failed"
)

// How many attempts a single batch gets before the job fails. The chain
// backend already retries filter fetches internally, so exhausting these
// means sustained peer starvation.
const backfillMaxBatchAttempts = 5

// BackfillJobStatus describes the progress of an explicit address backfill
// started with StartAddressBackfill. Job state is kept in memory for the
// lifetime of the wallet process; the transactions a backfill discovers are
// persisted by the transaction store as usual.
//
// TargetHeight stays 0 while the job is queued: the scan target is resolved
// only once the chain backend reports itself current, otherwise a backfill
// started mid header-sync would scan to the local (stale) tip, mark itself
// complete, and silently skip the rest of the chain.
type BackfillJobStatus struct {
	Address       string
	Status        string
	StartHeight   int32
	CurrentHeight int32
	TargetHeight  int32
	Error         string
	UpdatedAt     time.Time
}

func backfillJobActive(status string) bool {
	return status == BackfillStatusQueued || status == BackfillStatusRunning
}

// StartAddressBackfill scans historical blocks for transactions involving a
// single address, using the same batched compact-filter path as birthday
// recovery (2000-block FilterBlocks batches; full blocks fetched only on
// filter match). The scan runs in the background; poll BackfillStatus for
// progress. If a backfill for the address is already queued or running, its
// existing status is returned instead of starting another scan.
//
// The address must already be tracked by the wallet for discovered outputs to
// be recorded; callers importing a watch-only key should do so before
// starting the backfill.
func (w *Wallet) StartAddressBackfill(addr btcutil.Address,
	startHeight int32) (BackfillJobStatus, error) {

	if _, err := w.requireChainClient(); err != nil {
		return BackfillJobStatus{}, err
	}
	if w.ShuttingDown() {
		return BackfillJobStatus{}, ErrWalletShuttingDown
	}

	if startHeight < 0 {
		startHeight = 0
	}

	encodedAddr := addr.EncodeAddress()

	w.backfillMtx.Lock()
	if w.backfillJobs == nil {
		w.backfillJobs = make(map[string]*BackfillJobStatus)
	}
	if existing, ok := w.backfillJobs[encodedAddr]; ok &&
		backfillJobActive(existing.Status) {

		status := *existing
		w.backfillMtx.Unlock()
		return status, nil
	}
	job := &BackfillJobStatus{
		Address:       encodedAddr,
		Status:        BackfillStatusQueued,
		StartHeight:   startHeight,
		CurrentHeight: startHeight,
		UpdatedAt:     time.Now(),
	}
	w.backfillJobs[encodedAddr] = job
	status := *job
	w.backfillMtx.Unlock()

	w.wg.Add(1)
	go w.runAddressBackfill(addr, startHeight)

	return status, nil
}

// BackfillStatus returns the status of the most recent backfill started for
// the given encoded address, if any.
func (w *Wallet) BackfillStatus(address string) (BackfillJobStatus, bool) {
	w.backfillMtx.Lock()
	defer w.backfillMtx.Unlock()

	job, ok := w.backfillJobs[address]
	if !ok {
		return BackfillJobStatus{}, false
	}
	return *job, true
}

// mutateBackfillJob applies fn to the tracked job for the address, if any,
// and stamps the update time.
func (w *Wallet) mutateBackfillJob(address string,
	fn func(*BackfillJobStatus)) {

	w.backfillMtx.Lock()
	defer w.backfillMtx.Unlock()

	if job, ok := w.backfillJobs[address]; ok {
		fn(job)
		job.UpdatedAt = time.Now()
	}
}

func (w *Wallet) failBackfillJob(address string, err error) {
	log.Errorf("Backfill for %v failed: %v", address, err)
	w.mutateBackfillJob(address, func(job *BackfillJobStatus) {
		job.Status = BackfillStatusFailed
		job.Error = err.Error()
	})
}

// runAddressBackfill drives one backfill job to completion. It waits for any
// birthday recovery to finish and for the chain backend to be current,
// subscribes the address for live notifications, then scans start..tip in
// recovery-sized FilterBlocks batches.
func (w *Wallet) runAddressBackfill(addr btcutil.Address, startHeight int32) {
	defer w.wg.Done()

	encodedAddr := addr.EncodeAddress()
	quit := w.quitChan()

	chainClient, err := w.requireChainClient()
	if err != nil {
		w.failBackfillJob(encodedAddr, err)
		return
	}

	// Wait for birthday recovery: not required for correctness, but avoids
	// competing with it for peer bandwidth.
	if syncerI := w.recovering.Load(); syncerI != nil {
		if syncer, ok := syncerI.(*recoverySyncer); ok {
			select {
			case <-syncer.done:
			case <-quit:
				return
			}
		}
	}

	// Wait until the header chain is current, otherwise the target below
	// would be the stale local tip and blocks past it would never be
	// scanned for this address.
	for !chainClient.IsCurrent() {
		select {
		case <-time.After(2 * time.Second):
		case <-quit:
			return
		}
	}

	// One scan at a time: bounds peer load and database churn when several
	// addresses are backfilled in quick succession.
	w.backfillRunMtx.Lock()
	defer w.backfillRunMtx.Unlock()

	select {
	case <-quit:
		return
	default:
	}

	// Subscribe for live notifications BEFORE resolving the scan target:
	// the live watch covers everything past the target, so the union of
	// [start..target] and the live watch has no gap. Overlap is harmless —
	// transaction inserts are idempotent.
	if err := chainClient.NotifyReceived([]btcutil.Address{addr}); err != nil {
		w.failBackfillJob(encodedAddr, fmt.Errorf("unable to subscribe "+
			"address for notifications: %w", err))
		return
	}

	_, bestHeight, err := chainClient.GetBestBlock()
	if err != nil {
		w.failBackfillJob(encodedAddr, fmt.Errorf("unable to determine "+
			"chain tip: %w", err))
		return
	}
	if startHeight > bestHeight {
		startHeight = bestHeight
	}

	w.mutateBackfillJob(encodedAddr, func(job *BackfillJobStatus) {
		job.Status = BackfillStatusRunning
		job.TargetHeight = bestHeight
		if job.CurrentHeight > bestHeight {
			job.CurrentHeight = bestHeight
		}
	})

	log.Infof("Starting backfill for address %v from height %d to %d",
		encodedAddr, startHeight, bestHeight)

	// The ScopedIndex key is arbitrary: filter matching iterates map
	// values only; keys exist for recovery's derivation feedback, which a
	// fixed-address scan does not use.
	watchedAddrs := map[waddrmgr.ScopedIndex]btcutil.Address{
		{Scope: waddrmgr.KeyScopeBIP0086, Index: 0}: addr,
	}
	// Outpoints found so far. Accumulating these is required for
	// correctness, not an optimization: compact filters match a spending
	// block via the prev-out script, but the block filterer only marks the
	// spending transaction relevant when its input outpoint is in this
	// watch list. Without it, spends of discovered UTXOs are dropped and
	// the wallet keeps phantom credits.
	watchedOutPoints := make(map[wire.OutPoint]btcutil.Address)

	start := time.Now()

	for height := startHeight; height <= bestHeight; {
		select {
		case <-quit:
			return
		default:
		}

		batchEnd := height + recoveryBatchSize - 1
		if batchEnd > bestHeight {
			batchEnd = bestHeight
		}

		if err := w.backfillBatch(
			chainClient, height, batchEnd, watchedAddrs, watchedOutPoints, quit,
		); err != nil {
			if err == ErrWalletShuttingDown {
				return
			}
			w.failBackfillJob(encodedAddr, err)
			return
		}

		w.mutateBackfillJob(encodedAddr, func(job *BackfillJobStatus) {
			job.CurrentHeight = batchEnd
		})

		height = batchEnd + 1
	}

	w.mutateBackfillJob(encodedAddr, func(job *BackfillJobStatus) {
		job.Status = BackfillStatusComplete
		job.CurrentHeight = bestHeight
	})

	log.Infof("Backfill for address %v finished: scanned blocks %d-%d in %v",
		encodedAddr, startHeight, bestHeight, time.Since(start))
}

// backfillBatch scans one contiguous block range with bounded retries.
func (w *Wallet) backfillBatch(chainClient chain.Interface,
	startHeight, endHeight int32,
	watchedAddrs map[waddrmgr.ScopedIndex]btcutil.Address,
	watchedOutPoints map[wire.OutPoint]btcutil.Address,
	quit <-chan struct{}) error {

	backoff := time.Second
	var lastErr error

	for attempt := 0; attempt < backfillMaxBatchAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(backoff):
			case <-quit:
				return ErrWalletShuttingDown
			}
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}

		lastErr = w.scanBatchOnce(
			chainClient, startHeight, endHeight, watchedAddrs,
			watchedOutPoints,
		)
		if lastErr == nil {
			return nil
		}

		log.Warnf("Backfill batch %d-%d attempt %d failed: %v",
			startHeight, endHeight, attempt+1, lastErr)
	}

	return fmt.Errorf("backfill batch %d-%d failed after %d attempts: %w",
		startHeight, endHeight, backfillMaxBatchAttempts, lastErr)
}

// scanBatchOnce builds the block metas for a range and filters them,
// recording any relevant transactions. Found outpoints are added to
// watchedOutPoints so later batches catch their spends.
func (w *Wallet) scanBatchOnce(chainClient chain.Interface,
	startHeight, endHeight int32,
	watchedAddrs map[waddrmgr.ScopedIndex]btcutil.Address,
	watchedOutPoints map[wire.OutPoint]btcutil.Address) error {

	batch := make([]wtxmgr.BlockMeta, 0, endHeight-startHeight+1)
	for height := startHeight; height <= endHeight; height++ {
		hash, err := chainClient.GetBlockHash(int64(height))
		if err != nil {
			return fmt.Errorf("unable to resolve block hash at "+
				"height %d: %w", height, err)
		}
		header, err := chainClient.GetBlockHeader(hash)
		if err != nil {
			return fmt.Errorf("unable to resolve block header at "+
				"height %d: %w", height, err)
		}
		batch = append(batch, wtxmgr.BlockMeta{
			Block: wtxmgr.Block{Hash: *hash, Height: height},
			Time:  header.Timestamp,
		})
	}

	// FilterBlocks returns on the first matching block in the batch; trim
	// past it and re-request until the batch is consumed. NOTE: unlike
	// recovery, a backfill never calls SetSyncedTo — the wallet's sync tip
	// is owned by the live notification pipeline.
	for len(batch) > 0 {
		filterResp, err := chainClient.FilterBlocks(&chain.FilterBlocksRequest{
			Blocks:           batch,
			ExternalAddrs:    watchedAddrs,
			WatchedOutPoints: watchedOutPoints,
		})
		if err != nil {
			return err
		}
		if filterResp == nil {
			break
		}

		err = walletdb.Update(w.db, func(tx walletdb.ReadWriteTx) error {
			for _, txn := range filterResp.RelevantTxns {
				txRecord, err := wtxmgr.NewTxRecordFromMsgTx(
					txn, filterResp.BlockMeta.Time,
				)
				if err != nil {
					return err
				}
				if err := w.addRelevantTx(
					tx, txRecord, &filterResp.BlockMeta,
				); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("unable to record backfilled "+
				"transactions: %w", err)
		}

		for outPoint, outPointAddr := range filterResp.FoundOutPoints {
			watchedOutPoints[outPoint] = outPointAddr
		}

		batch = batch[filterResp.BatchIndex+1:]
	}

	return nil
}

