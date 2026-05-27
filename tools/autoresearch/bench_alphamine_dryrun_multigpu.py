#!/usr/bin/env python3
"""Benchmark AlphaMine alpha-miner dry-run mode across GPUs.

This uses alpha-miner's offline `--dry-run` mode, so it does not need a wallet,
pool, or share submission. Each GPU gets one process because alpha-miner only
allows multiple `--devices` in Stratum mode.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


STATUS_RE = re.compile(
    r"gpu=(?P<gpu>[^ ]+).*status attempts=(?P<attempts>\d+) hits=(?P<hits>\d+) "
    r"hashrate_th_s=(?P<hashrate>[0-9.]+) tmac_s=(?P<tmac>[0-9.]+)"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--binary",
        type=Path,
        default=Path("artifacts/alphamine/alpha-miner"),
    )
    parser.add_argument("--m", type=int, required=True)
    parser.add_argument("--n", type=int, required=True)
    parser.add_argument("--k", type=int, required=True)
    parser.add_argument("--rank", type=int, default=128)
    parser.add_argument("--attempts", type=int, default=160)
    parser.add_argument("--status-interval", type=int, default=10)
    parser.add_argument("--gpus", type=str, default="0,1,2,3,4,5,6,7")
    parser.add_argument("--cuda-schedule-spin", action="store_true")
    parser.add_argument("--run-id", type=str, default=None)
    parser.add_argument("--out", type=Path, default=Path("artifacts/alphamine_bench.jsonl"))
    parser.add_argument("--artifact-dir", type=Path, default=Path("artifacts/alphamine"))
    return parser.parse_args()


def parse_log(path: Path) -> dict[str, Any]:
    statuses = []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            match = STATUS_RE.search(line)
            if match:
                statuses.append(
                    {
                        "gpu_label": match.group("gpu"),
                        "attempts": int(match.group("attempts")),
                        "hits": int(match.group("hits")),
                        "hashrate_th_s": float(match.group("hashrate")),
                        "tmac_s": float(match.group("tmac")),
                    }
                )
    if not statuses:
        raise RuntimeError(f"No alpha-miner status lines found in {path}")
    return {
        "final": statuses[-1],
        "statuses": statuses,
    }


def main() -> None:
    args = parse_args()
    gpus = [gpu.strip() for gpu in args.gpus.split(",") if gpu.strip()]
    if not gpus:
        raise SystemExit("--gpus must list at least one GPU")
    if not args.binary.exists():
        raise SystemExit(f"alpha-miner binary not found: {args.binary}")

    run_id = args.run_id or time.strftime(
        f"%Y%m%dT%H%M%SZ-alphamine-dryrun-{args.m}x{args.n}x{args.k}",
        time.gmtime(),
    )
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)

    procs: list[tuple[str, Path, subprocess.Popen[bytes]]] = []
    for gpu in gpus:
        log_path = args.artifact_dir / f"{run_id}-gpu{gpu}.log"
        cmd = [
            str(args.binary),
            "--dry-run",
            "--profile",
            "--max-attempts",
            str(args.attempts),
            "--status-interval",
            str(args.status_interval),
            "--devices",
            gpu,
            "--color",
            "never",
            "--m",
            str(args.m),
            "--n",
            str(args.n),
            "--k",
            str(args.k),
            "--rank",
            str(args.rank),
        ]
        if args.cuda_schedule_spin:
            cmd.append("--cuda-schedule-spin")
        with log_path.open("wb") as log:
            proc = subprocess.Popen(cmd, cwd=Path.cwd(), stdout=log, stderr=subprocess.STDOUT)
        procs.append((gpu, log_path, proc))

    rows = []
    failures = []
    for gpu, log_path, proc in procs:
        rc = proc.wait()
        if rc != 0:
            failures.append((gpu, rc, log_path))
            continue
        parsed = parse_log(log_path)
        rows.append((gpu, log_path, parsed))

    if failures:
        detail = ", ".join(f"gpu{gpu} rc={rc} log={log}" for gpu, rc, log in failures)
        raise SystemExit(f"alpha-miner dry-run benchmark failed: {detail}")

    rates = [parsed["final"]["hashrate_th_s"] for _, _, parsed in rows]
    aggregate = {
        "kind": "alphamine_dryrun_multi_gpu_aggregate",
        "run_id": run_id,
        "binary": str(args.binary),
        "gpu_count": len(rows),
        "gpus": [gpu for gpu, _, _ in rows],
        "m": args.m,
        "n": args.n,
        "k": args.k,
        "rank": args.rank,
        "attempts": args.attempts,
        "status_interval": args.status_interval,
        "cuda_schedule_spin": args.cuda_schedule_spin,
        "hashrate_th_s_sum": sum(rates),
        "hashrate_th_s_mean": sum(rates) / len(rates),
        "hashrate_th_s_min": min(rates),
        "hashrate_th_s_max": max(rates),
        "per_gpu": {
            gpu: {
                "log": str(log_path),
                "final": parsed["final"],
            }
            for gpu, log_path, parsed in rows
        },
    }
    with args.out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(aggregate, sort_keys=True) + "\n")
    print(json.dumps(aggregate, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
