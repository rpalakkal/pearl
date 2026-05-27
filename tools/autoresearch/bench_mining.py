#!/usr/bin/env python3
"""Repeatable Pearl NoisyGEMM mining benchmark.

This is intentionally small in the style of karpathy/autoresearch: fixed inputs,
one benchmark file, one scalar metric, JSONL output that makes experiments easy
to compare and keep/revert.
"""

from __future__ import annotations

import argparse
import inspect
import json
import math
import time
import statistics
from pathlib import Path

import torch

from miner_base.gpu_matmul_config import GPUMatmulConfigFactory
from pearl_gemm import noisy_gemm
from pearl_gemm.testing import GEMMParam, GemmTensorGenerator
from pearl_gemm_build_utils.kernel_configs.default_compiled_kernels import (
    KERNEL_CONFIGS,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--m", type=int, default=4096)
    parser.add_argument("--n", type=int, default=4096)
    parser.add_argument("--k", type=int, default=4096)
    parser.add_argument("--r", type=int, default=128)
    parser.add_argument("--iters", type=int, default=25)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--dtype", choices=("auto", "fp16", "int32"), default="auto")
    parser.add_argument("--dtype-a", choices=("auto", "fp16", "int32"), default=None)
    parser.add_argument("--dtype-b", choices=("auto", "fp16", "int32"), default=None)
    parser.add_argument("--skip-denoising", action="store_true")
    parser.add_argument("--skip-output", action="store_true")
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
    parser.add_argument("--out", type=Path, default=Path("artifacts/mining_bench.jsonl"))
    return parser.parse_args()


def kernel_for_args(args: argparse.Namespace):
    matches = [cfg for cfg in KERNEL_CONFIGS.matmul_kernels if cfg.R == args.r]
    if args.tile_m is not None:
        matches = [cfg for cfg in matches if cfg.tile_size_m == args.tile_m]
    if args.tile_n is not None:
        matches = [cfg for cfg in matches if cfg.tile_size_n == args.tile_n]
    if args.tile_k is not None:
        matches = [cfg for cfg in matches if cfg.tile_size_k == args.tile_k]
    if args.pipeline_stages is not None:
        matches = [
            cfg for cfg in matches if cfg.pipeline_stages == args.pipeline_stages
        ]
    if not matches:
        raise SystemExit(
            "No compiled matmul kernel for "
            f"R={args.r}, tile=({args.tile_m},{args.tile_n},{args.tile_k}), "
            f"stages={args.pipeline_stages}"
        )
    return matches[0]


def resolve_dtype(args: argparse.Namespace, requested: str | None = None) -> str:
    requested = args.dtype if requested is None else requested
    if requested != "auto":
        return requested
    # int32 noising buffers are faster for 4096-class mining-only work, but
    # fp16 remains faster for wider 6144+/6912+ and 8192-class mining-only
    # shapes on this H100. Large-M/small-N projection shapes prefer int32
    # split-K noising.
    large_k_projection = (
        args.m >= 8192
        and args.n <= 4096
        and args.k >= 8192
        and args.k % 128 == 0
    )
    large_m_k4096_projection = (
        args.m >= 8192
        and args.n <= 4096
        and args.k == 4096
    )
    k4096_has_4096_side = (
        args.k == 4096
        and min(args.m, args.n) <= 4096
        and args.k % 128 == 0
    )
    mid_dim_high_other_large_k = (
        min(args.m, args.n) >= 6144
        and max(args.m, args.n) >= 6912
        and args.k >= 8192
        and args.k % 128 == 0
    )
    small_m_wide_n_large_k = (
        args.m <= 5120
        and args.n >= 8192
        and args.k >= 8192
        and args.k % 128 == 0
    )
    if (
        args.skip_denoising
        and args.skip_output
        and (
            (args.m < 8192 and args.n < 8192 and not mid_dim_high_other_large_k)
            or large_k_projection
            or k4096_has_4096_side
            or small_m_wide_n_large_k
        )
    ):
        return "int32"
    return "fp16"


def resolve_dtypes(args: argparse.Namespace) -> tuple[str, str]:
    return (
        resolve_dtype(args, args.dtype_a),
        resolve_dtype(args, args.dtype_b),
    )


def resolve_k_blocks_per_split_noising(args: argparse.Namespace, dtype_a: str, dtype_b: str) -> tuple[int | None, int | None]:
    split_a = args.k_blocks_per_split_noising_a
    split_b = args.k_blocks_per_split_noising_b
    large_k_projection = (
        args.m >= 8192
        and args.n <= 4096
        and args.k >= 8192
        and args.k % 128 == 0
    )
    large_m_k4096_projection = (
        args.m >= 8192
        and args.n <= 4096
        and args.k == 4096
    )
    square_4096_large_k = (
        args.m == 4096
        and args.n == 4096
        and args.k >= 8192
        and args.k % 128 == 0
    )
    high_n_4096_large_k = (
        args.m == 4096
        and args.n >= 8192
        and args.k >= 8192
        and args.k % 128 == 0
    )
    if (
        args.skip_denoising
        and args.skip_output
        and (
            args.k in (2048, 4096)
            or large_k_projection
            or square_4096_large_k
            or high_n_4096_large_k
        )
    ):
        default_split = 8 if args.k == 2048 else args.k // 128
        b_only_large_k_projection = large_k_projection or large_m_k4096_projection
        if split_a is None and dtype_a == "int32":
            split_a = 0 if b_only_large_k_projection else default_split
        if split_b is None and dtype_b == "int32":
            split_b = default_split
    return split_a, split_b


def resolve_swizzle_for_log(args: argparse.Namespace, matmul_config) -> int | None:
    if args.swizzle is not None:
        return args.swizzle
    if args.skip_output:
        mid_m_large_k = args.m >= 6144 and args.n >= 4096 and args.k >= 8192
        large_m_wide_or_large_k = (
            args.m >= 8192
            and args.k >= 4096
            and (args.n >= 8192 or args.k >= 8192)
        )
        large_m_k4096 = args.m >= 8192 and args.k == 4096
        return (
            4
            if large_m_wide_or_large_k or mid_m_large_k or large_m_k4096
            else 1
        )

    dprops = torch.cuda.get_device_properties()
    l2_size_bytes = getattr(dprops, "l2_cache_size", None)
    if l2_size_bytes is None:
        return None

    b_maj = (
        matmul_config.tile_size_n
        if not args.swizzle_m_major
        else matmul_config.tile_size_m
    )
    b_size_bytes = args.k * b_maj * 2
    swizzle = (2 * l2_size_bytes // 3) // b_size_bytes
    swizzle = 4 * (swizzle // 4)
    return min(128, swizzle)


def model_to_dict(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return dict(model)


def expected_inner_hashes(m: int, n: int, k: int, rank: int) -> int:
    """Mirror pearl-gemm's debug-count test for secondary mining evidence."""
    matmul_config = GPUMatmulConfigFactory.create(k=k, noise_rank=rank)
    num_tiles = math.ceil(m / matmul_config.matmul_tile_h) * math.ceil(
        n / matmul_config.matmul_tile_w
    )
    reductions_per_tile = k // matmul_config.noise_rank
    num_threads_per_cta = (
        matmul_config.matmul_tile_h // matmul_config.hash_tile_h
    ) * (matmul_config.matmul_tile_w // matmul_config.hash_tile_w)
    return num_tiles * reductions_per_tile * num_threads_per_cta


def make_kwargs(tg: GemmTensorGenerator, params: GEMMParam, args: argparse.Namespace) -> dict:
    kwargs = {
        "A": tg.A,
        "B": tg.B,
        "EAL": tg.EAL,
        "EAL_fp16": tg.EAL_fp16,
        "EBR": tg.EBR,
        "EBR_fp16": tg.EBR_fp16,
        "EAR_R_major": tg.EAR_R_major,
        "EBL_R_major": tg.EBL_R_major,
        "EAR_K_major": tg.EAR_K_major,
        "EBL_K_major": tg.EBL_K_major,
        "AxEBL_fp16": tg.AxEBL_fp16,
        "EARxBpEB_fp16": tg.EARxBpEB_fp16,
        "ApEA": tg.ApEA,
        "BpEB": tg.BpEB,
        "A_scales": tg.A_scales,
        "B_scales": tg.B_scales,
        "C": tg.C,
        "host_signal_header_pinned": tg.host_signal_header_pinned,
        "host_signal_sync": tg.host_signal_sync,
        "pow_target": tg.pow_target,
        "pow_key": tg.pow_key,
        "AxEBL_int32": tg.AxEBL_int32,
        "EARxBpEB_int32": tg.EARxBpEB_int32,
        "tile_size_m": params.tile_size_m,
        "tile_size_n": params.tile_size_n,
        "tile_size_k": params.tile_size_k,
        "cluster_size_m": params.cluster_size_m,
        "cluster_size_n": params.cluster_size_n,
        "pipeline_stages": params.pipeline_stages,
        "swizzle": args.swizzle,
        "swizzle_n_maj": not args.swizzle_m_major,
        "tile_size_m_noising_A": params.tile_size_m_noising_A,
        "tile_size_n_noising_B": params.tile_size_n_noising_B,
        "tile_size_k_noising_A": params.tile_size_k_noising_A,
        "tile_size_k_noising_B": params.tile_size_k_noising_B,
        "pipeline_stages_noising_A": params.pipeline_stages_noising_A,
        "pipeline_stages_noising_B": params.pipeline_stages_noising_B,
        "k_blocks_per_split_noising_A": params.k_blocks_per_split_noising_A,
        "k_blocks_per_split_noising_B": params.k_blocks_per_split_noising_B,
        "run_noising_A": True,
        "run_noising_B": True,
        "skip_reduction": False,
        "skip_denoising": args.skip_denoising,
    }
    if args.skip_output and "skip_output" in inspect.signature(noisy_gemm).parameters:
        kwargs["skip_output"] = True
    return kwargs


def main() -> None:
    args = parse_args()
    torch.manual_seed(1)
    torch.cuda.set_device(0)
    dtype_a, dtype_b = resolve_dtypes(args)
    dtype = dtype_a if dtype_a == dtype_b else f"{dtype_a}/{dtype_b}"
    k_split_a, k_split_b = resolve_k_blocks_per_split_noising(args, dtype_a, dtype_b)

    matmul_config = kernel_for_args(args)
    swizzle_resolved_for_log = resolve_swizzle_for_log(args, matmul_config)
    params = GEMMParam(
        args.m,
        args.n,
        args.k,
        matmul_config=matmul_config,
        EARxBpEB_type_noising=dtype_b,
        AxEBL_type_noising=dtype_a,
        tile_size_m_noising_A=args.tile_m_noising_a,
        tile_size_n_noising_B=args.tile_n_noising_b,
        tile_size_k_noising_A=args.tile_k_noising_a,
        tile_size_k_noising_B=args.tile_k_noising_b,
        pipeline_stages_noising_A=args.pipeline_stages_noising_a,
        pipeline_stages_noising_B=args.pipeline_stages_noising_b,
        k_blocks_per_split_noising_A=k_split_a,
        k_blocks_per_split_noising_B=k_split_b,
    )
    tg = GemmTensorGenerator(params)
    tg.generate(pow_target=0)
    kwargs = make_kwargs(tg, params, args)

    for _ in range(args.warmup):
        noisy_gemm(**kwargs)
    torch.cuda.synchronize()

    timings_ms = []
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    wall_start = time.perf_counter()
    for _ in range(args.iters):
        start.record()
        noisy_gemm(**kwargs)
        end.record()
        torch.cuda.synchronize()
        timings_ms.append(start.elapsed_time(end))
    wall_s = time.perf_counter() - wall_start

    tiles = math.ceil(args.m / params.tile_size_m) * math.ceil(args.n / params.tile_size_n)
    median_ms = statistics.median(timings_ms)
    macs_per_iter = args.m * args.n * args.k
    hashrate_th_s_median = macs_per_iter / (median_ms / 1000.0) / 1e12
    hashes_per_iter = expected_inner_hashes(args.m, args.n, args.k, args.r)
    inner_hashes_per_s_median = hashes_per_iter / (median_ms / 1000.0)
    result = {
        "m": args.m,
        "n": args.n,
        "k": args.k,
        "rank": args.r,
        "dtype": dtype,
        "dtype_requested": args.dtype,
        "dtype_A": dtype_a,
        "dtype_B": dtype_b,
        "dtype_A_requested": args.dtype_a,
        "dtype_B_requested": args.dtype_b,
        "skip_denoising": args.skip_denoising,
        "skip_output_requested": args.skip_output,
        "skip_output_active": "skip_output" in kwargs,
        "swizzle": args.swizzle,
        "swizzle_resolved": swizzle_resolved_for_log,
        "swizzle_n_maj": not args.swizzle_m_major,
        "kernel": model_to_dict(matmul_config),
        "k_blocks_per_split_noising_A": params.k_blocks_per_split_noising_A,
        "k_blocks_per_split_noising_B": params.k_blocks_per_split_noising_B,
        "iters": args.iters,
        "warmup": args.warmup,
        "median_ms": median_ms,
        "mean_ms": statistics.mean(timings_ms),
        "min_ms": min(timings_ms),
        "max_ms": max(timings_ms),
        "macs_per_iter": macs_per_iter,
        "hashrate_th_s_median": hashrate_th_s_median,
        "tmac_s_median": hashrate_th_s_median,
        "inner_hashes_per_iter": hashes_per_iter,
        "inner_hashes_per_s_median": inner_hashes_per_s_median,
        "wall_s": wall_s,
        "tiles": tiles,
        "tiles_per_s_median": tiles / (median_ms / 1000.0),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(result, sort_keys=True) + "\n")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
