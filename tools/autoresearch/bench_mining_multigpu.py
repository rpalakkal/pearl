#!/usr/bin/env python3
"""Run the mining benchmark on multiple GPUs and append an aggregate JSONL row."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--m", type=int, required=True)
    parser.add_argument("--n", type=int, required=True)
    parser.add_argument("--k", type=int, required=True)
    parser.add_argument("--r", type=int, default=128)
    parser.add_argument("--iters", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--gpus", type=str, default="0,1,2,3,4,5,6,7")
    parser.add_argument("--run-id", type=str, default=None)
    parser.add_argument("--out", type=Path, default=Path("artifacts/mining_bench.jsonl"))
    parser.add_argument("--artifact-dir", type=Path, default=Path("artifacts/multigpu"))
    parser.add_argument("--dtype", choices=("auto", "fp16", "int32"), default="auto")
    parser.add_argument("--dtype-a", choices=("auto", "fp16", "int32"), default=None)
    parser.add_argument("--dtype-b", choices=("auto", "fp16", "int32"), default=None)
    parser.add_argument("--skip-denoising", action="store_true", default=True)
    parser.add_argument("--skip-output", action="store_true", default=True)
    return parser.parse_args()


def read_last_jsonl(path: Path) -> dict[str, Any]:
    last = None
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                last = json.loads(line)
    if last is None:
        raise RuntimeError(f"{path} did not contain a JSONL row")
    return last


def main() -> None:
    args = parse_args()
    gpus = [gpu.strip() for gpu in args.gpus.split(",") if gpu.strip()]
    if not gpus:
        raise SystemExit("--gpus must list at least one GPU")

    run_id = args.run_id or time.strftime(
        f"%Y%m%dT%H%M%SZ-multigpu-{args.m}x{args.n}x{args.k}", time.gmtime()
    )
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)

    procs: list[tuple[str, Path, Path, subprocess.Popen[bytes]]] = []
    for gpu in gpus:
        gpu_out = args.artifact_dir / f"{run_id}-gpu{gpu}.jsonl"
        gpu_log = args.artifact_dir / f"{run_id}-gpu{gpu}.log"
        cmd = [
            sys.executable,
            "tools/autoresearch/bench_mining.py",
            "--m",
            str(args.m),
            "--n",
            str(args.n),
            "--k",
            str(args.k),
            "--r",
            str(args.r),
            "--iters",
            str(args.iters),
            "--warmup",
            str(args.warmup),
            "--dtype",
            args.dtype,
            "--out",
            str(gpu_out),
        ]
        if args.dtype_a is not None:
            cmd.extend(["--dtype-a", args.dtype_a])
        if args.dtype_b is not None:
            cmd.extend(["--dtype-b", args.dtype_b])
        if args.skip_denoising:
            cmd.append("--skip-denoising")
        if args.skip_output:
            cmd.append("--skip-output")

        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = gpu
        with gpu_log.open("wb") as log:
            proc = subprocess.Popen(cmd, cwd=Path.cwd(), env=env, stdout=log, stderr=subprocess.STDOUT)
        procs.append((gpu, gpu_out, gpu_log, proc))

    rows = []
    failures = []
    for gpu, gpu_out, gpu_log, proc in procs:
        rc = proc.wait()
        if rc != 0:
            failures.append((gpu, rc, gpu_log))
            continue
        rows.append((gpu, read_last_jsonl(gpu_out)))

    if failures:
        detail = ", ".join(f"gpu{gpu} rc={rc} log={log}" for gpu, rc, log in failures)
        raise SystemExit(f"multi-GPU benchmark failed: {detail}")

    rates = [row["hashrate_th_s_median"] for _, row in rows]
    aggregate = {
        "kind": "multi_gpu_aggregate",
        "run_id": run_id,
        "gpu_count": len(rows),
        "gpus": [gpu for gpu, _ in rows],
        "m": args.m,
        "n": args.n,
        "k": args.k,
        "rank": args.r,
        "iters": args.iters,
        "warmup": args.warmup,
        "dtype": args.dtype,
        "dtype_A": rows[0][1].get("dtype_A") if rows else None,
        "dtype_B": rows[0][1].get("dtype_B") if rows else None,
        "dtype_A_requested": args.dtype_a,
        "dtype_B_requested": args.dtype_b,
        "skip_denoising": args.skip_denoising,
        "skip_output_requested": args.skip_output,
        "hashrate_th_s_sum": sum(rates),
        "hashrate_th_s_mean": sum(rates) / len(rates),
        "hashrate_th_s_min": min(rates),
        "hashrate_th_s_max": max(rates),
        "per_gpu": {gpu: row for gpu, row in rows},
    }
    with args.out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(aggregate, sort_keys=True) + "\n")
    print(json.dumps(aggregate, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
