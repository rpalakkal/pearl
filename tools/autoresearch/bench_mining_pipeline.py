#!/usr/bin/env python3
"""Benchmark the end-to-end Pearl GPU mining pipeline.

This mirrors the mining work inside vllm_miner.gemm_operators.pearl_gemm_noisy
without gateway submission or wallet access.  It times the GPU tensor hash,
commitment hash, noise generation, and noisy_gemm stages separately, and also
records whole-iteration wall time including Python-side allocation/setup.
"""

from __future__ import annotations

import argparse
import inspect
import json
import math
import statistics
import sys
import time
from pathlib import Path

import torch

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from miner_base.commitment_hash import CommitmentHasher
from miner_base.gpu_matmul_config import GPUMatmulConfigFactory
from pearl_gateway.comm.dataclasses import MiningJob
from pearl_gemm import (
    commitment_hash_from_merkle_roots,
    get_host_signal_header_size,
    get_host_signal_sync_size,
    get_required_scratchpad_bytes,
    make_pow_target_tensor,
    noise_gen,
    noisy_gemm,
    tensor_hash,
)

from bench_mining import (
    expected_inner_hashes,
    kernel_for_args,
    resolve_dtypes,
    resolve_k_blocks_per_split_noising,
    resolve_swizzle_for_log,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--m", type=int, default=8192)
    parser.add_argument("--n", type=int, default=8192)
    parser.add_argument("--k", type=int, default=8192)
    parser.add_argument("--r", type=int, default=128)
    parser.add_argument("--iters", type=int, default=20)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--gpu", type=int, default=0)
    parser.add_argument("--dtype", choices=("auto", "fp16", "int32"), default="auto")
    parser.add_argument("--dtype-a", choices=("auto", "fp16", "int32"), default=None)
    parser.add_argument("--dtype-b", choices=("auto", "fp16", "int32"), default=None)
    parser.add_argument("--skip-denoising", action="store_true")
    parser.add_argument("--skip-output", action="store_true")
    parser.add_argument("--uint8-mode", choices=("cast", "view"), default="view")
    parser.add_argument("--reuse-buffers", action="store_true")
    parser.add_argument(
        "--compact-timing",
        action="store_true",
        help="Time the full launch sequence with one CUDA sync instead of syncing after each stage.",
    )
    parser.add_argument("--hash-threads", type=int, default=512)
    parser.add_argument("--hash-stages", type=int, default=2)
    parser.add_argument("--hash-leaves-per-block", type=int, default=512)
    parser.add_argument("--tile-m", type=int, default=None)
    parser.add_argument("--tile-n", type=int, default=None)
    parser.add_argument("--tile-k", type=int, default=None)
    parser.add_argument("--pipeline-stages", type=int, default=None)
    parser.add_argument("--tile-m-noising-a", type=int, default=None)
    parser.add_argument("--tile-n-noising-b", type=int, default=None)
    parser.add_argument("--tile-k-noising-a", type=int, default=None)
    parser.add_argument("--tile-k-noising-b", type=int, default=None)
    parser.add_argument("--pipeline-stages-noising-a", type=int, default=2)
    parser.add_argument("--pipeline-stages-noising-b", type=int, default=2)
    parser.add_argument("--k-blocks-per-split-noising-a", type=int, default=None)
    parser.add_argument("--k-blocks-per-split-noising-b", type=int, default=None)
    parser.add_argument("--swizzle", type=int, default=None)
    parser.add_argument("--swizzle-m-major", action="store_true")
    parser.add_argument("--out", type=Path, default=Path("artifacts/mining_pipeline_bench.jsonl"))
    return parser.parse_args()


def model_to_dict(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return dict(model)


def as_hash_bytes(tensor: torch.Tensor, mode: str) -> torch.Tensor:
    if mode == "view":
        return tensor.view(torch.uint8)
    return tensor.to(torch.uint8)


class PipelineBuffers:
    def __init__(self, args: argparse.Namespace, dtype_a: str, dtype_b: str) -> None:
        self.args = args
        self.device = torch.device("cuda", args.gpu)
        m, n, k, r = args.m, args.n, args.k, args.r
        self.A = torch.randint(-64, 64, (m, k), dtype=torch.int8, device=self.device)
        self.B = torch.randint(-64, 64, (n, k), dtype=torch.int8, device=self.device)
        self.A_scales = torch.ones((m,), dtype=torch.float32, device=self.device) / 128
        self.B_scales = torch.ones((n,), dtype=torch.float32, device=self.device) / 128
        self.C = torch.empty((m, n), dtype=torch.bfloat16, device=self.device)

        matrix_bytes = max(m * k, n * k)
        self.tensor_hash_scratchpad = torch.empty(
            get_required_scratchpad_bytes(matrix_bytes, args.hash_threads),
            dtype=torch.uint8,
            device=self.device,
        )

        matmul_config = GPUMatmulConfigFactory.create(k=k, noise_rank=r)
        mining_job = MiningJob(incomplete_header_bytes=bytes(80), target=1)
        hash_key = CommitmentHasher.get_key(
            mining_job.incomplete_header_bytes, matmul_config.mining_config
        )
        self.key_tensor = torch.tensor(list(hash_key), dtype=torch.uint8, device=self.device)
        self.pow_target = make_pow_target_tensor(0, device=self.device)

        self.A_tensor_hash = torch.empty(32, device=self.device, dtype=torch.uint8)
        self.B_tensor_hash = torch.empty(32, device=self.device, dtype=torch.uint8)
        self.commitment_hash_A = torch.empty(32, device=self.device, dtype=torch.uint8)
        self.commitment_hash_B = torch.empty(32, device=self.device, dtype=torch.uint8)

        self.EAL = torch.empty((m, r), dtype=torch.int8, device=self.device)
        self.EBR = torch.empty((n, r), dtype=torch.int8, device=self.device)
        self.EAR_R_major = torch.empty((k, r), dtype=torch.int8, device=self.device)
        self.EBL_R_major = torch.empty((k, r), dtype=torch.int8, device=self.device)
        self.EAR_K_major = torch.empty((r, k), dtype=torch.int8, device=self.device)
        self.EBL_K_major = torch.empty((r, k), dtype=torch.int8, device=self.device)
        self.EAL_fp16 = torch.empty((m, r), dtype=torch.float16, device=self.device)
        self.EBR_fp16 = torch.empty((n, r), dtype=torch.float16, device=self.device)

        self.BpEB = torch.empty((n, k), dtype=torch.int8, device=self.device)
        self.ApEA = torch.empty((m, k), dtype=torch.int8, device=self.device)
        dtype_map = {"fp16": torch.float16, "int32": torch.int32}
        self.AxEBL = torch.empty((m, r), dtype=dtype_map[dtype_a], device=self.device)
        self.EARxBpEB = torch.empty((n, r), dtype=dtype_map[dtype_b], device=self.device)
        self.AxEBL_fp16 = (
            self.AxEBL
            if dtype_a == "fp16"
            else torch.empty((m, r), dtype=torch.float16, device=self.device)
        )
        self.EARxBpEB_fp16 = (
            self.EARxBpEB
            if dtype_b == "fp16"
            else torch.empty((n, r), dtype=torch.float16, device=self.device)
        )
        self.AxEBL_int32 = self.AxEBL if dtype_a == "int32" else None
        self.EARxBpEB_int32 = self.EARxBpEB if dtype_b == "int32" else None

        self.host_signal_sync = torch.zeros(
            (get_host_signal_sync_size(),), dtype=torch.int8, device=self.device
        )
        self.host_signal_header_pinned = torch.zeros(
            (get_host_signal_header_size(),), dtype=torch.int8, pin_memory=True
        )


def record_stage(timings: dict[str, list[float]], name: str, fn) -> None:
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    start.record()
    fn()
    end.record()
    torch.cuda.synchronize()
    timings.setdefault(name, []).append(start.elapsed_time(end))


def run_one(
    args: argparse.Namespace,
    buffers: PipelineBuffers,
    timings: dict[str, list[float]],
    dtype_a: str,
    dtype_b: str,
    k_split_a: int | None,
    k_split_b: int | None,
) -> float:
    wall_start = time.perf_counter()

    def hash_a() -> None:
        tensor_hash(
            as_hash_bytes(buffers.A, args.uint8_mode),
            buffers.key_tensor,
            buffers.A_tensor_hash,
            buffers.tensor_hash_scratchpad,
            threads_per_block=args.hash_threads,
            num_stages=args.hash_stages,
            leaves_per_mt_block=args.hash_leaves_per_block,
        )

    def hash_b() -> None:
        tensor_hash(
            as_hash_bytes(buffers.B, args.uint8_mode),
            buffers.key_tensor,
            buffers.B_tensor_hash,
            buffers.tensor_hash_scratchpad,
            threads_per_block=args.hash_threads,
            num_stages=args.hash_stages,
            leaves_per_mt_block=args.hash_leaves_per_block,
        )

    def commitment() -> None:
        commitment_hash_from_merkle_roots(
            buffers.A_tensor_hash,
            buffers.B_tensor_hash,
            buffers.key_tensor,
            buffers.commitment_hash_A,
            buffers.commitment_hash_B,
        )

    def noise() -> None:
        noise_gen(
            R=args.r,
            EAL=buffers.EAL,
            EAL_fp16=buffers.EAL_fp16,
            EAR_R_major=buffers.EAR_R_major,
            EAR_K_major=buffers.EAR_K_major,
            EBL_R_major=buffers.EBL_R_major,
            EBL_K_major=buffers.EBL_K_major,
            EBR=buffers.EBR,
            EBR_fp16=buffers.EBR_fp16,
            key_A=buffers.commitment_hash_A,
            key_B=buffers.commitment_hash_B,
        )

    def gemm_stage() -> None:
        kwargs = {
            "A": buffers.A,
            "B": buffers.B,
            "EAL": buffers.EAL,
            "EAL_fp16": buffers.EAL_fp16,
            "EBR": buffers.EBR,
            "EBR_fp16": buffers.EBR_fp16,
            "EAR_R_major": buffers.EAR_R_major,
            "EBL_R_major": buffers.EBL_R_major,
            "EAR_K_major": buffers.EAR_K_major,
            "EBL_K_major": buffers.EBL_K_major,
            "AxEBL_fp16": buffers.AxEBL_fp16,
            "EARxBpEB_fp16": buffers.EARxBpEB_fp16,
            "ApEA": buffers.ApEA,
            "BpEB": buffers.BpEB,
            "A_scales": buffers.A_scales,
            "B_scales": buffers.B_scales,
            "C": buffers.C,
            "host_signal_header_pinned": buffers.host_signal_header_pinned,
            "host_signal_sync": buffers.host_signal_sync,
            "pow_target": buffers.pow_target,
            "pow_key": buffers.commitment_hash_A.view(torch.uint32),
            "AxEBL_int32": buffers.AxEBL_int32,
            "EARxBpEB_int32": buffers.EARxBpEB_int32,
            "tile_size_m": args.tile_m or 128,
            "tile_size_n": args.tile_n or 256,
            "tile_size_k": args.tile_k or 128,
            "pipeline_stages": args.pipeline_stages or 3,
            "swizzle": args.swizzle,
            "swizzle_n_maj": not args.swizzle_m_major,
            "tile_size_m_noising_A": args.tile_m_noising_a,
            "tile_size_n_noising_B": args.tile_n_noising_b,
            "tile_size_k_noising_A": args.tile_k_noising_a,
            "tile_size_k_noising_B": args.tile_k_noising_b,
            "pipeline_stages_noising_A": args.pipeline_stages_noising_a,
            "pipeline_stages_noising_B": args.pipeline_stages_noising_b,
            "k_blocks_per_split_noising_A": k_split_a,
            "k_blocks_per_split_noising_B": k_split_b,
            "run_noising_A": True,
            "run_noising_B": True,
            "skip_reduction": False,
            "skip_denoising": args.skip_denoising,
        }
        if args.skip_output and "skip_output" in inspect.signature(noisy_gemm).parameters:
            kwargs["skip_output"] = True
        noisy_gemm(**kwargs)

    if args.compact_timing:
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        hash_a()
        hash_b()
        commitment()
        noise()
        gemm_stage()
        end.record()
        torch.cuda.synchronize()
        timings.setdefault("pipeline_event_ms", []).append(start.elapsed_time(end))
    else:
        record_stage(timings, "tensor_hash_A_ms", hash_a)
        record_stage(timings, "tensor_hash_B_ms", hash_b)
        record_stage(timings, "commitment_hash_ms", commitment)
        record_stage(timings, "noise_gen_ms", noise)
        record_stage(timings, "noisy_gemm_ms", gemm_stage)
        torch.cuda.synchronize()
    return time.perf_counter() - wall_start


def median_or_zero(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def main() -> None:
    args = parse_args()
    torch.manual_seed(1)
    torch.cuda.set_device(args.gpu)

    dtype_a, dtype_b = resolve_dtypes(args)
    dtype = dtype_a if dtype_a == dtype_b else f"{dtype_a}/{dtype_b}"
    k_split_a, k_split_b = resolve_k_blocks_per_split_noising(args, dtype_a, dtype_b)
    matmul_config = kernel_for_args(args)
    swizzle_resolved = resolve_swizzle_for_log(args, matmul_config)

    buffers = PipelineBuffers(args, dtype_a, dtype_b)
    if args.warmup:
        warmup_timings: dict[str, list[float]] = {}
        for _ in range(args.warmup):
            if not args.reuse_buffers:
                buffers = PipelineBuffers(args, dtype_a, dtype_b)
            run_one(args, buffers, warmup_timings, dtype_a, dtype_b, k_split_a, k_split_b)
        torch.cuda.synchronize()

    timings: dict[str, list[float]] = {}
    wall_s = []
    for _ in range(args.iters):
        if not args.reuse_buffers:
            buffers = PipelineBuffers(args, dtype_a, dtype_b)
        wall_s.append(run_one(args, buffers, timings, dtype_a, dtype_b, k_split_a, k_split_b))

    stage_medians = {name: median_or_zero(values) for name, values in timings.items()}
    stage_sum_ms = sum(stage_medians.values())
    wall_median_ms = statistics.median(wall_s) * 1000
    macs_per_iter = args.m * args.n * args.k
    hashes_per_iter = expected_inner_hashes(args.m, args.n, args.k, args.r)
    noisy_gemm_ms = stage_medians.get("noisy_gemm_ms")
    pipeline_event_ms = stage_medians.get("pipeline_event_ms")
    result = {
        "kind": "mining_pipeline",
        "m": args.m,
        "n": args.n,
        "k": args.k,
        "rank": args.r,
        "gpu": args.gpu,
        "dtype": dtype,
        "dtype_requested": args.dtype,
        "dtype_A": dtype_a,
        "dtype_B": dtype_b,
        "skip_denoising": args.skip_denoising,
        "skip_output_requested": args.skip_output,
        "uint8_mode": args.uint8_mode,
        "reuse_buffers": args.reuse_buffers,
        "compact_timing": args.compact_timing,
        "hash_threads": args.hash_threads,
        "hash_stages": args.hash_stages,
        "hash_leaves_per_block": args.hash_leaves_per_block,
        "swizzle": args.swizzle,
        "swizzle_resolved": swizzle_resolved,
        "swizzle_n_maj": not args.swizzle_m_major,
        "kernel": model_to_dict(matmul_config),
        "k_blocks_per_split_noising_A": k_split_a,
        "k_blocks_per_split_noising_B": k_split_b,
        "iters": args.iters,
        "warmup": args.warmup,
        "wall_median_ms": wall_median_ms,
        "wall_mean_ms": statistics.mean(wall_s) * 1000,
        "stage_sum_median_ms": stage_sum_ms,
        "stage_median_ms": stage_medians,
        "pipeline_hashrate_th_s_wall_median": macs_per_iter / (wall_median_ms / 1000) / 1e12,
        "pipeline_hashrate_th_s_stage_sum": macs_per_iter / (stage_sum_ms / 1000) / 1e12,
        "kernel_hashrate_th_s_noisy_gemm": (
            macs_per_iter / (noisy_gemm_ms / 1000) / 1e12
            if noisy_gemm_ms
            else None
        ),
        "pipeline_hashrate_th_s_event": (
            macs_per_iter / (pipeline_event_ms / 1000) / 1e12
            if pipeline_event_ms
            else None
        ),
        "inner_hashes_per_iter": hashes_per_iter,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(result, sort_keys=True) + "\n")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
