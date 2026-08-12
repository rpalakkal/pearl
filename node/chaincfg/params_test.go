// Copyright (c) 2025-2026 The Pearl Research Labs
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package chaincfg

import (
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/pearl-research-labs/pearl/node/wire"
	"github.com/stretchr/testify/require"
)

// TestInvalidHashStr ensures the newShaHashFromStr function panics when used to
// with an invalid hash string.
func TestInvalidHashStr(t *testing.T) {
	require.Panics(t, func() {
		newHashFromStr("banana")
	}, "Expected panic for invalid hash")
}

// TestMustRegisterPanic ensures the mustRegister function panics when used to
// register an invalid network.
func TestMustRegisterPanic(t *testing.T) {
	t.Parallel()

	// Intentionally try to register duplicate params to force a panic.
	require.Panics(t, func() {
		mustRegister(&MainNetParams)
	}, "mustRegister did not panic as expected")
}

func TestRegisterHDKeyID(t *testing.T) {
	t.Parallel()

	// Ref: https://github.com/satoshilabs/slips/blob/master/slip-0132.md
	hdKeyIDZprv := []byte{0x02, 0xaa, 0x7a, 0x99}
	hdKeyIDZpub := []byte{0x02, 0xaa, 0x7e, 0xd3}

	err := RegisterHDKeyID(hdKeyIDZpub, hdKeyIDZprv)
	require.NoError(t, err, "RegisterHDKeyID")

	got, err := HDPrivateKeyToPublicKeyID(hdKeyIDZprv)
	require.NoError(t, err, "HDPrivateKeyToPublicKeyID")
	require.Equal(t, hdKeyIDZpub, got, "HDPrivateKeyToPublicKeyID result mismatch")
}

func TestInvalidHDKeyID(t *testing.T) {
	t.Parallel()

	prvValid := []byte{0x02, 0xaa, 0x7a, 0x99}
	pubValid := []byte{0x02, 0xaa, 0x7e, 0xd3}
	prvInvalid := []byte{0x00}
	pubInvalid := []byte{0x00}

	err := RegisterHDKeyID(pubInvalid, prvValid)
	require.ErrorIs(t, err, ErrInvalidHDKeyID)

	err = RegisterHDKeyID(pubValid, prvInvalid)
	require.ErrorIs(t, err, ErrInvalidHDKeyID)

	err = RegisterHDKeyID(pubInvalid, prvInvalid)
	require.ErrorIs(t, err, ErrInvalidHDKeyID)

	// FIXME: The error type should be changed to ErrInvalidHDKeyID.
	_, err = HDPrivateKeyToPublicKeyID(prvInvalid)
	require.ErrorIs(t, err, ErrUnknownHDKeyID)
}

func TestSigNetPowLimit(t *testing.T) {
	// sigNetPowLimit should be 2^228 - 1 (7 leading hex zeros followed by 57 f's)
	expectedPowLimitHex, err := hex.DecodeString(
		"0000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	)
	require.NoError(t, err)
	expectedPowLimit := new(big.Int).SetBytes(expectedPowLimitHex)
	require.Equal(t, 0, sigNetPowLimit.Cmp(expectedPowLimit),
		"Signet PoW limit (%s) not equal to expected 2^228-1 (%s)",
		sigNetPowLimit.Text(16), expectedPowLimit.Text(16))

	// The genesis block Bits (0x1d0fffff) is the compact representation.
	// Compact format has limited precision (24-bit mantissa), so it yields
	// 0x0fffff000... rather than 0x0ffff...fff. Verify the expected compact value.
	expectedBitsTargetHex, err := hex.DecodeString(
		"0000000fffff0000000000000000000000000000000000000000000000000000",
	)
	require.NoError(t, err)
	expectedBitsTarget := new(big.Int).SetBytes(expectedBitsTargetHex)
	actualBitsTarget := compactToBig(sigNetGenesisBlock.BlockHeader().Bits)
	require.Equal(t, 0, actualBitsTarget.Cmp(expectedBitsTarget),
		"Signet genesis Bits target (%s) not equal to expected (%s)",
		actualBitsTarget.Text(16), expectedBitsTarget.Text(16))
}

// TestSigNetMagic makes sure that the default signet has the expected Pearl
// network magic.
func TestSigNetMagic(t *testing.T) {
	require.Equal(t, wire.SigNet, SigNetParams.Net)
}

// TestMoEForkActivation verifies the strict cutover at the MoE hardfork
// activation height: V1 before the fork, V2 at and after it.
func TestMoEForkActivation(t *testing.T) {
	const forkHeight = int32(100)
	p := Params{MoEForkHeight: forkHeight}

	tests := []struct {
		name        string
		height      int32
		wantActive  bool
		wantVersion wire.CertificateVersion
	}{
		{"genesis", 0, false, wire.CertificateVersionV1},
		{"just before fork", forkHeight - 1, false, wire.CertificateVersionV1},
		{"at fork height", forkHeight, true, wire.CertificateVersionV2},
		{"after fork height", forkHeight + 1, true, wire.CertificateVersionV2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.wantActive, p.IsMoEForkActive(tt.height))
			require.Equal(t, tt.wantVersion, p.RequiredCertVersion(tt.height))
		})
	}
}

// TestMoEForkDisabled verifies that a zero MoEForkHeight disables the fork at
// every height (the V1 certificate is always required).
func TestMoEForkDisabled(t *testing.T) {
	p := Params{MoEForkHeight: 0}
	for _, height := range []int32{0, 1, 100, 1_000_000} {
		require.False(t, p.IsMoEForkActive(height))
		require.Equal(t, wire.CertificateVersionV1, p.RequiredCertVersion(height))
	}
}

// TestSaltedSeedForkActivation verifies the strict cutover at the salted
// noise-seed hardfork activation height: V2 before the fork (with the MoE fork
// active), V3 at and after it.
func TestSaltedSeedForkActivation(t *testing.T) {
	const forkHeight = int32(200)
	p := Params{MoEForkHeight: 100, SaltedSeedForkHeight: forkHeight}

	tests := []struct {
		name        string
		height      int32
		wantActive  bool
		wantVersion wire.CertificateVersion
	}{
		{"just before fork", forkHeight - 1, false, wire.CertificateVersionV2},
		{"at fork height", forkHeight, true, wire.CertificateVersionV3},
		{"after fork height", forkHeight + 1, true, wire.CertificateVersionV3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.wantActive, p.IsSaltedSeedForkActive(tt.height))
			require.Equal(t, tt.wantVersion, p.RequiredCertVersion(tt.height))
		})
	}
}

// TestSaltedSeedForkDisabled verifies that a zero SaltedSeedForkHeight disables
// the fork at every height (the version follows the MoE fork schedule).
func TestSaltedSeedForkDisabled(t *testing.T) {
	p := Params{MoEForkHeight: 1, SaltedSeedForkHeight: 0}
	for _, height := range []int32{1, 100, 1_000_000} {
		require.False(t, p.IsSaltedSeedForkActive(height))
		require.Equal(t, wire.CertificateVersionV2, p.RequiredCertVersion(height))
	}
}

// TestRankPenaltyForkActivation verifies the activation boundary of the
// rank-penalty softfork, including the disabled case.
func TestRankPenaltyForkActivation(t *testing.T) {
	const forkHeight = int32(100)
	enabled := Params{RankPenaltyForkHeight: forkHeight}

	tests := []struct {
		name       string
		height     int32
		wantActive bool
	}{
		{"genesis", 0, false},
		{"just before fork", forkHeight - 1, false},
		{"at fork height", forkHeight, true},
		{"after fork height", forkHeight + 1, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.wantActive, enabled.IsRankPenaltyForkActive(tt.height))
		})
	}

	disabled := Params{RankPenaltyForkHeight: 0}
	for _, height := range []int32{0, 1, 100, 1_000_000} {
		require.False(t, disabled.IsRankPenaltyForkActive(height))
	}
}

// TestShippedNetworksRankPenaltyOrdering asserts the invariant the rule relies
// on: only V2 certificates carry a noise rank, so the rank-penalty softfork must
// never activate before the V2 cutover. blockchain.New rejects params that
// violate this.
func TestShippedNetworksRankPenaltyOrdering(t *testing.T) {
	for name, params := range map[string]*Params{
		"mainnet":  &MainNetParams,
		"testnet":  &TestNetParams,
		"testnet2": &TestNet2Params,
		"regtest":  &RegressionNetParams,
		"simnet":   &SimNetParams,
	} {
		if params.RankPenaltyForkHeight == 0 {
			continue
		}
		require.GreaterOrEqualf(t, params.RankPenaltyForkHeight, params.MoEForkHeight,
			"%s must not activate the rank-penalty fork before the MoE fork", name)
	}
}

// TestShippedNetworksMoEForkHeights pins the MoE hardfork activation heights
// for the shipped networks so they cannot change accidentally.
func TestShippedNetworksMoEForkHeights(t *testing.T) {
	heights := map[string]struct {
		params *Params
		want   int32
	}{
		"mainnet":  {&MainNetParams, 71935},
		"testnet":  {&TestNetParams, 1},
		"testnet2": {&TestNet2Params, 54869},
	}
	for name, tt := range heights {
		require.Equalf(t, tt.want, tt.params.MoEForkHeight,
			"%s must ship with MoEForkHeight %d", name, tt.want)
	}
}

// TestShippedNetworksConsensusForkHeights pins the post-MoE consensus fork
// heights used by the desktop wallet's two selectable networks. Changing any
// of these values changes which certificates an SPV wallet accepts.
func TestShippedNetworksConsensusForkHeights(t *testing.T) {
	tests := []struct {
		name       string
		params     *Params
		wantDense  int32
		wantRank   int32
		wantSalted int32
	}{
		{
			name:       "mainnet",
			params:     &MainNetParams,
			wantDense:  91630,
			wantRank:   96251,
			wantSalted: 99000,
		},
		{
			name:       "testnet2",
			params:     &TestNet2Params,
			wantDense:  80051,
			wantRank:   80627,
			wantSalted: 83109,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.wantDense, tt.params.DenseOnlyForkHeight)
			require.Equal(t, tt.wantRank, tt.params.RankPenaltyForkHeight)
			require.Equal(t, tt.wantSalted, tt.params.SaltedSeedForkHeight)
		})
	}
}

// TestMainNetCheckpoints pins the ordered mainnet checkpoints used during
// headers-first SPV sync. A changed height or hash must be an explicit network
// decision rather than an incidental refactor.
func TestMainNetCheckpoints(t *testing.T) {
	want := []struct {
		height int32
		hash   string
	}{
		{10000, "a3c196fb1c3f7837bbebd69b98fc451d88d48083af98c318c78486d7f1888490"},
		{20000, "513270b25c6d538f38b26ecdc014f2a809639ec7ebd3c09e4685675311420273"},
		{30000, "fd61132c2ad6c22fa48a8df483bc6b885c12ceeb3fe0a9fa55eb5beb849fac7b"},
		{40000, "35aac0e2a1e7f2d54924d584cf423b56f0d72d6770ee8365dc1667dbb5b5b320"},
		{50000, "608f32e5390b2ae964c986a53e1be10ba4a640f3ccecf96d6b7838e06cb517ff"},
		{60000, "5a7f0590c3a89099b2d0f1509d2186c73bc3d8e2e4a60e7ce4ec236856900dad"},
		{70000, "281a3469d55226bb9e1b3ccee06eeb923177817b4cdead75131074b171b215c1"},
		{80000, "69d40caca39b3c04ee55589d13cd1c5c546a3eb8712a3367840c5f67ab707cfc"},
		{90000, "0738b30bb353820a4f97331d805d134de4321a5fc5c8b2955988e7291a0c8562"},
	}

	require.Len(t, MainNetParams.Checkpoints, len(want))
	for i, checkpoint := range MainNetParams.Checkpoints {
		require.Equalf(t, want[i].height, checkpoint.Height,
			"checkpoint %d height", i)
		require.NotNilf(t, checkpoint.Hash, "checkpoint %d hash", i)
		require.Equalf(t, want[i].hash, checkpoint.Hash.String(),
			"checkpoint %d hash", i)
	}
}

// compactToBig is a copy of the blockchain.CompactToBig function. We copy it
// here so we don't run into a circular dependency just because of a test.
func compactToBig(compact uint32) *big.Int {
	// Extract the mantissa, sign bit, and exponent.
	mantissa := compact & 0x007fffff
	isNegative := compact&0x00800000 != 0
	exponent := uint(compact >> 24)

	// Since the base for the exponent is 256, the exponent can be treated
	// as the number of bytes to represent the full 256-bit number.  So,
	// treat the exponent as the number of bytes and shift the mantissa
	// right or left accordingly.  This is equivalent to:
	// N = mantissa * 256^(exponent-3)
	var bn *big.Int
	if exponent <= 3 {
		mantissa >>= 8 * (3 - exponent)
		bn = big.NewInt(int64(mantissa))
	} else {
		bn = big.NewInt(int64(mantissa))
		bn.Lsh(bn, 8*(exponent-3))
	}

	// Make it negative if the sign bit is set.
	if isNegative {
		bn = bn.Neg(bn)
	}

	return bn
}
