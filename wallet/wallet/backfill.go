// Copyright (c) 2025-2026 The Pearl Research Labs
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package wallet

import (
	"fmt"
	"time"

	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/wallet/waddrmgr"
)

// Backfill job states reported by BackfillStatus.
const (
	BackfillStatusQueued   = "queued"
	BackfillStatusRunning  = "running"
	BackfillStatusComplete = "complete"
	BackfillStatusFailed   = "failed"
)

// BackfillJobStatus describes the progress of an explicit address backfill
// rescan started with StartAddressBackfill. Job state is kept in memory for
// the lifetime of the wallet process; the UTXOs a backfill discovers are
// persisted by the transaction store as usual.
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

// StartAddressBackfill submits a background rescan for a single address,
// starting at startHeight (clamped to the chain) and scanning to the current
// tip. The start block is resolved from locally stored headers. If a backfill
// for the address is already queued or running, its existing status is
// returned instead of starting another scan.
//
// The address must already be tracked by the wallet for discovered outputs to
// be recorded; callers importing a watch-only key should do so before starting
// the backfill.
func (w *Wallet) StartAddressBackfill(addr btcutil.Address,
	startHeight int32) (BackfillJobStatus, error) {

	chainClient, err := w.requireChainClient()
	if err != nil {
		return BackfillJobStatus{}, err
	}

	if startHeight < 0 {
		startHeight = 0
	}

	_, bestHeight, err := chainClient.GetBestBlock()
	if err != nil {
		return BackfillJobStatus{}, fmt.Errorf("unable to determine chain "+
			"tip: %w", err)
	}
	if startHeight > bestHeight {
		startHeight = bestHeight
	}

	// Resolve the starting block from local header storage.
	startHash, err := chainClient.GetBlockHash(int64(startHeight))
	if err != nil {
		return BackfillJobStatus{}, fmt.Errorf("unable to resolve block at "+
			"height %d from stored headers: %w", startHeight, err)
	}

	bs := waddrmgr.BlockStamp{Height: startHeight, Hash: *startHash}
	if header, err := chainClient.GetBlockHeader(startHash); err == nil {
		bs.Timestamp = header.Timestamp
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
		TargetHeight:  bestHeight,
		UpdatedAt:     time.Now(),
	}
	w.backfillJobs[encodedAddr] = job
	status := *job
	w.backfillMtx.Unlock()

	log.Infof("Starting backfill for address %v from height %d to %d",
		encodedAddr, startHeight, bestHeight)

	errChan := w.SubmitRescan(&RescanJob{
		Addrs:         []btcutil.Address{addr},
		OutPoints:     nil,
		BlockStamp:    bs,
		backfillAddrs: []string{encodedAddr},
	})

	// The rescan error channel only reports whether the chain backend
	// accepted and started the rescan, not scan completion; completion
	// arrives as a RescanFinished notification which marks the job complete
	// via completeBackfillJobs. The channel is buffered, so this goroutine
	// always terminates: the batch handler sends the start result, and
	// wallet shutdown sends ErrWalletShuttingDown.
	go func() {
		w.mutateBackfillJob(encodedAddr, func(job *BackfillJobStatus) {
			if job.Status == BackfillStatusQueued {
				job.Status = BackfillStatusRunning
			}
		})

		if err := <-errChan; err != nil {
			w.mutateBackfillJob(encodedAddr, func(job *BackfillJobStatus) {
				job.Status = BackfillStatusFailed
				job.Error = err.Error()
			})
		}
	}()

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

// updateBackfillProgress records rescan progress for the tracked backfill jobs
// that are part of the currently running rescan batch. Called from the
// wallet's rescan notification handlers.
func (w *Wallet) updateBackfillProgress(backfillAddrs []string, height int32) {
	w.backfillMtx.Lock()
	defer w.backfillMtx.Unlock()

	for _, addr := range backfillAddrs {
		job, ok := w.backfillJobs[addr]
		if !ok || !backfillJobActive(job.Status) {
			continue
		}
		job.Status = BackfillStatusRunning
		if height > job.CurrentHeight {
			job.CurrentHeight = height
		}
		job.UpdatedAt = time.Now()
	}
}

// completeBackfillJobs marks the tracked backfill jobs that were part of a
// finished rescan batch as complete. Called when the chain backend reports the
// batch's rescan finished.
func (w *Wallet) completeBackfillJobs(backfillAddrs []string, height int32) {
	w.backfillMtx.Lock()
	defer w.backfillMtx.Unlock()

	for _, addr := range backfillAddrs {
		job, ok := w.backfillJobs[addr]
		if !ok || !backfillJobActive(job.Status) {
			continue
		}
		job.Status = BackfillStatusComplete
		if height > job.CurrentHeight {
			job.CurrentHeight = height
		}
		job.UpdatedAt = time.Now()
	}
}
