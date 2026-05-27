#!/usr/bin/env python3
"""Summarize Pearl mining benchmark JSONL results.

Groups benchmark rows by shape and prints the best TH/s rows. Aggregate rows
from multi-GPU runs are summarized separately.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, default=Path("artifacts/mining_bench.jsonl"))
    parser.add_argument("--top", type=int, default=3)
    parser.add_argument("--shape", type=str, default=None, help="Optional MxNxK filter")
    return parser.parse_args()


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{lineno}: invalid JSON: {exc}") from exc
    return rows


def shape_key(row: dict[str, Any]) -> tuple[int, int, int, int]:
    return (int(row["m"]), int(row["n"]), int(row["k"]), int(row["rank"]))


def config_label(row: dict[str, Any]) -> str:
    kernel = row.get("kernel") or {}
    tile = (
        kernel.get("tile_size_m"),
        kernel.get("tile_size_n"),
        kernel.get("tile_size_k"),
        kernel.get("pipeline_stages"),
    )
    split = (
        row.get("k_blocks_per_split_noising_A"),
        row.get("k_blocks_per_split_noising_B"),
    )
    swizzle = row.get("swizzle")
    swizzle_resolved = row.get("swizzle_resolved")
    swizzle_label = (
        f"{swizzle}->{swizzle_resolved}"
        if swizzle is None and swizzle_resolved is not None
        else str(swizzle)
    )
    major = "N" if row.get("swizzle_n_maj", True) else "M"
    return (
        f"dtype={row.get('dtype')} requested={row.get('dtype_requested')} "
        f"skipD={row.get('skip_denoising')} skipO={row.get('skip_output_requested')} "
        f"tile={tile} split={split} swizzle={swizzle_label}/{major} "
        f"iters={row.get('iters')}"
    )


def format_shape(key: tuple[int, int, int, int]) -> str:
    m, n, k, r = key
    return f"{m}x{n}x{k} R={r}"


def main() -> None:
    args = parse_args()
    rows = load_rows(args.path)
    shape_filter = None
    if args.shape:
        parts = args.shape.lower().replace(",", "x").split("x")
        if len(parts) != 3:
            raise SystemExit("--shape must look like MxNxK")
        shape_filter = tuple(int(part) for part in parts)

    aggregate_rows = [row for row in rows if row.get("kind") == "multi_gpu_aggregate"]
    single_rows = [
        row
        for row in rows
        if row.get("kind") != "multi_gpu_aggregate"
        and "hashrate_th_s_median" in row
        and {"m", "n", "k", "rank"}.issubset(row)
    ]
    if shape_filter is not None:
        single_rows = [
            row for row in single_rows if (row["m"], row["n"], row["k"]) == shape_filter
        ]

    grouped: dict[tuple[int, int, int, int], list[dict[str, Any]]] = {}
    for row in single_rows:
        grouped.setdefault(shape_key(row), []).append(row)

    for key in sorted(grouped):
        best = sorted(
            grouped[key], key=lambda row: row["hashrate_th_s_median"], reverse=True
        )[: args.top]
        print(format_shape(key))
        for idx, row in enumerate(best, start=1):
            print(
                f"  {idx}. {row['hashrate_th_s_median']:.3f} TH/s, "
                f"median={row.get('median_ms', 0):.6f} ms, {config_label(row)}"
            )

    if aggregate_rows and shape_filter is None:
        print("multi-GPU aggregates")
        for row in aggregate_rows:
            print(
                f"  {row.get('run_id')}: GPUs={row.get('gpu_count')} "
                f"sum={row.get('hashrate_th_s_sum', 0):.3f} TH/s "
                f"mean={row.get('hashrate_th_s_mean', 0):.3f} TH/s"
            )


if __name__ == "__main__":
    main()
