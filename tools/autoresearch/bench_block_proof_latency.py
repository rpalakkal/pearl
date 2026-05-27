#!/usr/bin/env python3
"""Measure Pearl block proof/submission latency without wallet secrets.

This benchmark separates miner-side PlainProof packaging from gateway-side ZK
proof generation and block serialization. It does not submit to a live node.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import platform
import statistics
import time
from pathlib import Path
from typing import Any, Callable

import pearl_mining
import torch
from miner_base.block_submission import create_proof
from pearl_gateway.blockchain_utils.pearl_block import PearlBlock
from pearl_gateway.blockchain_utils.pearl_header import PearlHeader
from pearl_gateway.blockchain_utils.zk_certificate import ZKCertificate
from pearl_gateway.comm.dataclasses import BlockTemplate, MiningJob, OpenedBlockInfo


DEFAULT_NBITS = 0x1D2FFFFF
ROWS_PATTERN = [0, 8, 64, 72]
COLS_PATTERN = [0, 1, 8, 9, 32, 33, 40, 41]


class DummyCoinbase:
    has_segwit = False

    def to_bytes(self, has_segwit: bool = False) -> bytes:
        del has_segwit
        return b"\x00"


def now_ns() -> int:
    return time.perf_counter_ns()


def ms_since(start_ns: int) -> float:
    return (now_ns() - start_ns) / 1e6


def timed(fn: Callable[[], Any]) -> tuple[Any, float]:
    start_ns = now_ns()
    result = fn()
    return result, ms_since(start_ns)


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def make_header(nbits: int) -> pearl_mining.IncompleteBlockHeader:
    return pearl_mining.IncompleteBlockHeader(
        version=0,
        prev_block=b"\x00" * 32,
        merkle_root=b"0123456789abcdef" * 2,
        timestamp=0x66666666,
        nbits=nbits,
    )


def make_config(k: int, rank: int) -> pearl_mining.MiningConfiguration:
    return pearl_mining.MiningConfiguration(
        common_dim=k,
        rank=rank,
        mma_type=pearl_mining.MMAType.Int7xInt7ToInt32,
        rows_pattern=pearl_mining.PeriodicPattern.from_list(ROWS_PATTERN),
        cols_pattern=pearl_mining.PeriodicPattern.from_list(COLS_PATTERN),
        reserved=pearl_mining.MiningConfiguration.RESERVED,
    )


def make_template(header: pearl_mining.IncompleteBlockHeader) -> BlockTemplate:
    return BlockTemplate(
        header=PearlHeader(incomplete_header=header),
        height=0,
        raw_transactions=[],
        coinbase_tx=DummyCoinbase(),
    )


def generate_valid_plain_proof(
    m: int,
    n: int,
    k: int,
    rank: int,
    header: pearl_mining.IncompleteBlockHeader,
    config: pearl_mining.MiningConfiguration,
) -> tuple[pearl_mining.PlainProof, float]:
    return timed(lambda: pearl_mining.mine(m, n, k, header, config))


def make_synthetic_opened_block_info(
    a_row_indices: list[int],
    bt_row_indices: list[int],
    m: int,
    n: int,
    k: int,
    rank: int,
    seed: int,
) -> tuple[OpenedBlockInfo, float]:
    generator = torch.Generator(device="cpu")
    generator.manual_seed(seed)

    def allocate() -> OpenedBlockInfo:
        a_matrix = torch.randint(-64, 64, (m, k), dtype=torch.int8, generator=generator)
        bt_matrix = torch.randint(-64, 64, (n, k), dtype=torch.int8, generator=generator)
        return OpenedBlockInfo(
            A_row_indices=a_row_indices,
            B_column_indices=bt_row_indices,
            A=a_matrix,
            B_t=bt_matrix,
            commitment_hash=None,
            noise_rank=rank,
        )

    return timed(allocate)


def measure_one(
    args: argparse.Namespace,
    header: pearl_mining.IncompleteBlockHeader,
    config: pearl_mining.MiningConfiguration,
    iteration: int,
) -> dict[str, Any]:
    if args.clear_cache_each_iter:
        pearl_mining.clear_circuit_cache()

    template = make_template(header)
    mining_job = MiningJob.from_template(template)

    if args.plain_proof_source == "mine":
        plain_proof, mine_ms = generate_valid_plain_proof(
            args.m, args.n, args.k, args.rank, header, config
        )
        proof_rows = list(plain_proof.a.row_indices)
        proof_cols = list(plain_proof.bt.row_indices)
    else:
        plain_proof = None
        mine_ms = None
        proof_rows = ROWS_PATTERN
        proof_cols = COLS_PATTERN

    opened_info, synthetic_matrix_alloc_ms = make_synthetic_opened_block_info(
        proof_rows, proof_cols, args.m, args.n, args.k, args.rank, args.seed + iteration
    )
    created_plain_proof, create_plain_proof_ms = timed(
        lambda: create_proof(opened_info, template.header.serialize_without_proof_commitment())
    )
    if plain_proof is None:
        plain_proof = created_plain_proof

    payload, submit_payload_ms = timed(
        lambda: {
            "plain_proof": plain_proof.to_base64(),
            "mining_job": mining_job.to_dict(),
        }
    )
    payload_json_bytes, submit_payload_json_ms = timed(
        lambda: len(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    )
    decoded_plain_proof, gateway_decode_plain_proof_ms = timed(
        lambda: pearl_mining.PlainProof.from_base64(payload["plain_proof"])
    )

    zk_proof, generate_zk_proof_ms = timed(
        lambda: pearl_mining.generate_proof(header, decoded_plain_proof)
    )
    (zk_valid, zk_message), verify_zk_proof_ms = timed(
        lambda: pearl_mining.verify_proof(header, zk_proof)
    )
    if not zk_valid and not args.allow_invalid_zk:
        raise RuntimeError(f"Generated ZK proof failed verification: {zk_message}")

    def build_and_serialize_block() -> bytes:
        header_copy = copy.copy(template.header)
        zk_certificate = ZKCertificate.from_pearl_header(header_copy, zk_proof)
        block = PearlBlock(
            header=header_copy,
            raw_txns=template.get_raw_transactions(),
            zk_certificate=zk_certificate,
        )
        return block.serialize()

    serialized_block, build_and_serialize_block_ms = timed(build_and_serialize_block)

    gateway_total_ms = (
        gateway_decode_plain_proof_ms + generate_zk_proof_ms + build_and_serialize_block_ms
    )
    gateway_total_with_verify_ms = gateway_total_ms + verify_zk_proof_ms
    estimated_full_local_ms = create_plain_proof_ms + submit_payload_ms + gateway_total_ms
    estimated_full_local_with_verify_ms = estimated_full_local_ms + verify_zk_proof_ms

    return {
        "benchmark": "block_proof_latency",
        "variant": args.variant,
        "hostname": platform.node(),
        "pid": os.getpid(),
        "iteration": iteration,
        "m": args.m,
        "n": args.n,
        "k": args.k,
        "rank": args.rank,
        "nbits": args.nbits,
        "plain_proof_source": args.plain_proof_source,
        "clear_cache_each_iter": args.clear_cache_each_iter,
        "warmup_prove": args.warmup_prove,
        "mine_fixture_ms": mine_ms,
        "synthetic_matrix_alloc_ms": synthetic_matrix_alloc_ms,
        "create_plain_proof_ms": create_plain_proof_ms,
        "submit_payload_ms": submit_payload_ms,
        "submit_payload_json_ms": submit_payload_json_ms,
        "gateway_decode_plain_proof_ms": gateway_decode_plain_proof_ms,
        "generate_zk_proof_ms": generate_zk_proof_ms,
        "verify_zk_proof_ms": verify_zk_proof_ms,
        "zk_valid": zk_valid,
        "zk_message": zk_message,
        "build_and_serialize_block_ms": build_and_serialize_block_ms,
        "gateway_total_ms": gateway_total_ms,
        "gateway_total_with_verify_ms": gateway_total_with_verify_ms,
        "estimated_full_local_ms": estimated_full_local_ms,
        "estimated_full_local_with_verify_ms": estimated_full_local_with_verify_ms,
        "plain_proof_base64_bytes": len(payload["plain_proof"].encode("ascii")),
        "submit_payload_json_bytes": payload_json_bytes,
        "created_plain_proof_base64_bytes": len(created_plain_proof.to_base64()),
        "zk_public_data_bytes": len(zk_proof.public_data),
        "zk_proof_data_bytes": len(zk_proof.proof_data),
        "serialized_block_bytes": len(serialized_block),
        "a_opened_rows": len(plain_proof.a.row_indices),
        "bt_opened_rows": len(plain_proof.bt.row_indices),
        "timestamp_ns": time.time_ns(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--m", type=int, default=256)
    parser.add_argument("--n", type=int, default=128)
    parser.add_argument("--k", type=int, default=1024)
    parser.add_argument("--rank", type=int, default=32)
    parser.add_argument("--nbits", type=lambda value: int(value, 0), default=DEFAULT_NBITS)
    parser.add_argument("--iters", type=int, default=1)
    parser.add_argument("--plain-proof-source", choices=("mine", "synthetic"), default="mine")
    parser.add_argument(
        "--allow-invalid-zk",
        action="store_true",
        help="Keep timing records when verify_proof rejects the generated proof.",
    )
    parser.add_argument("--warmup-prove", action="store_true")
    parser.add_argument("--clear-cache-each-iter", action="store_true")
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--variant", default="default")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("artifacts/block_proof_latency.jsonl"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)

    header = make_header(args.nbits)
    config = make_config(args.k, args.rank)

    if args.warmup_prove:
        pearl_mining.warmup_prove(config)

    records = [measure_one(args, header, config, i) for i in range(args.iters)]
    with args.out.open("a", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, sort_keys=True) + "\n")

    summary = {
        "benchmark": "block_proof_latency_summary",
        "variant": args.variant,
        "iters": args.iters,
        "m": args.m,
        "n": args.n,
        "k": args.k,
        "rank": args.rank,
        "create_plain_proof_ms_median": median(
            [record["create_plain_proof_ms"] for record in records]
        ),
        "generate_zk_proof_ms_median": median(
            [record["generate_zk_proof_ms"] for record in records]
        ),
        "verify_zk_proof_ms_median": median(
            [record["verify_zk_proof_ms"] for record in records]
        ),
        "gateway_total_ms_median": median([record["gateway_total_ms"] for record in records]),
        "estimated_full_local_ms_median": median(
            [record["estimated_full_local_ms"] for record in records]
        ),
        "estimated_full_local_with_verify_ms_median": median(
            [record["estimated_full_local_with_verify_ms"] for record in records]
        ),
        "out": str(args.out),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
