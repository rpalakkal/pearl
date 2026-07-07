// Copyright (c) 2025-2026 The Pearl Research Labs
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package wallet

import (
	"bytes"
	"time"

	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
	"github.com/pearl-research-labs/pearl/node/txscript"
	"github.com/pearl-research-labs/pearl/wallet/walletdb"
	"github.com/pearl-research-labs/pearl/wallet/wtxmgr"
)

// AddressHistoryEntry describes one transaction from the perspective of a
// single address: whether that address funded the transaction (sent) or was
// paid by it (received), independent of which other keys the hosting wallet
// controls. This exists because the legacy listtransactions categories are
// wallet-relative — a wallet that pays one of its own watch-only addresses
// reports "send", which is backwards from that address's point of view.
type AddressHistoryEntry struct {
	TxHash chainhash.Hash
	// Sent is true when the address's own outputs funded this transaction.
	Sent bool
	// Amount paid to the address (receives) or to other parties (sends),
	// in satoshis. A self-transfer (every output returns to the address)
	// reports the returned amount.
	Amount btcutil.Amount
	// Fee is the transaction fee when the wallet knew every input of a
	// send; zero otherwise.
	Fee btcutil.Amount
	// Counterparty is the first non-self output address of a send, or the
	// address itself for receives. Empty when undecodable.
	Counterparty string
	Height       int32 // -1 while unmined
	BlockHash    chainhash.Hash
	Timestamp    time.Time
}

// AddressHistory returns every wallet-known transaction that pays to or
// spends from the given address, classified from that address's perspective.
// The address must be tracked by the wallet (imported or derived) for its
// transactions to be present; run a backfill first for historical coverage.
func (w *Wallet) AddressHistory(addr btcutil.Address) ([]AddressHistoryEntry, error) {
	addrScript, err := txscript.PayToAddrScript(addr)
	if err != nil {
		return nil, err
	}

	var entries []AddressHistoryEntry

	err = walletdb.View(w.db, func(dbtx walletdb.ReadTx) error {
		ns := dbtx.ReadBucket(wtxmgrNamespaceKey)

		rangeFn := func(details []wtxmgr.TxDetails) (bool, error) {
			for i := range details {
				detail := &details[i]

				entry, relevant, err := classifyForAddress(
					ns, w.TxStore, detail, addrScript, w,
				)
				if err != nil {
					return false, err
				}
				if relevant {
					entries = append(entries, entry)
				}
			}
			return false, nil
		}

		return w.TxStore.RangeTransactions(ns, 0, -1, rangeFn)
	})
	if err != nil {
		return nil, err
	}

	return entries, nil
}

// classifyForAddress inspects one transaction's credits/debits and decides
// how it looks from addrScript's perspective.
func classifyForAddress(ns walletdb.ReadBucket, store *wtxmgr.Store,
	detail *wtxmgr.TxDetails, addrScript []byte,
	w *Wallet) (AddressHistoryEntry, bool, error) {

	// Credits paying the address.
	var receivedSats btcutil.Amount
	for _, credit := range detail.Credits {
		output := detail.MsgTx.TxOut[credit.Index]
		if bytes.Equal(output.PkScript, addrScript) {
			receivedSats += credit.Amount
		}
	}

	// Debits spending the address's own outputs: resolve each spent
	// outpoint's script through the funding transaction.
	var sentSats btcutil.Amount
	var debitTotal btcutil.Amount
	for _, debit := range detail.Debits {
		debitTotal += debit.Amount

		prevOut := detail.MsgTx.TxIn[debit.Index].PreviousOutPoint
		funding, err := store.TxDetails(ns, &prevOut.Hash)
		if err != nil {
			return AddressHistoryEntry{}, false, err
		}
		if funding == nil || int(prevOut.Index) >= len(funding.MsgTx.TxOut) {
			continue
		}
		if bytes.Equal(funding.MsgTx.TxOut[prevOut.Index].PkScript, addrScript) {
			sentSats += debit.Amount
		}
	}

	if receivedSats == 0 && sentSats == 0 {
		return AddressHistoryEntry{}, false, nil
	}

	// Output totals for amount/fee/counterparty derivation.
	var totalOut, toAddr btcutil.Amount
	counterparty := ""
	for _, output := range detail.MsgTx.TxOut {
		totalOut += btcutil.Amount(output.Value)
		if bytes.Equal(output.PkScript, addrScript) {
			toAddr += btcutil.Amount(output.Value)
		} else if counterparty == "" {
			_, outAddrs, _, err := txscript.ExtractPkScriptAddrs(
				output.PkScript, w.chainParams,
			)
			if err == nil && len(outAddrs) > 0 {
				counterparty = outAddrs[0].EncodeAddress()
			}
		}
	}

	entry := AddressHistoryEntry{
		TxHash:    detail.Hash,
		Height:    detail.Block.Height,
		BlockHash: detail.Block.Hash,
		Timestamp: detail.Received,
	}
	if !detail.Block.Time.IsZero() {
		entry.Timestamp = detail.Block.Time
	}

	if sentSats > 0 {
		entry.Sent = true
		entry.Amount = totalOut - toAddr // paid to others
		if entry.Amount == 0 {
			// Self-transfer: everything returned to the address.
			entry.Amount = toAddr
		}
		if debitTotal >= totalOut {
			entry.Fee = debitTotal - totalOut
		}
		entry.Counterparty = counterparty
	} else {
		entry.Amount = receivedSats
	}

	return entry, true, nil
}
