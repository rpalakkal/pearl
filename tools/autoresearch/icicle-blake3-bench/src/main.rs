use std::env;
use std::hint::black_box;
use std::time::Instant;

use icicle_core::hash::{HashConfig, Hasher};
use icicle_core::merkle::{MerkleTree, MerkleTreeConfig, PaddingPolicy};
use icicle_hash::blake3::Blake3;
use icicle_runtime::memory::{DeviceVec, HostOrDeviceSlice, IntoIcicleSlice, IntoIcicleSliceMut};
use icicle_runtime::{runtime, set_device, Device};
use rayon::prelude::*;

const PLONKY2_BLAKE3_DIGEST_BYTES: usize = 27;

#[cfg(pearl_icicle_blake3_bench_cuda)]
unsafe extern "C" {
    fn pearl_blake3_truncate_32_to_n(
        input: *const u8,
        output: *mut u8,
        count: usize,
        n: usize,
    ) -> i32;
}

#[derive(Clone, Copy)]
struct Case {
    name: &'static str,
    chunk_bytes: usize,
    batch: usize,
}

#[derive(Clone, Copy)]
struct Args {
    custom_chunk: Option<usize>,
    custom_batch: Option<usize>,
    reps: usize,
    warmup: usize,
    mode: &'static str,
    cap_height: usize,
}

fn parse_args() -> Args {
    let mut args = env::args().skip(1);
    let mut parsed = Args {
        custom_chunk: None,
        custom_batch: None,
        reps: 5,
        warmup: 1,
        mode: "all",
        cap_height: 5,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--chunk-bytes" => parsed.custom_chunk = args.next().and_then(|v| v.parse().ok()),
            "--batch" => parsed.custom_batch = args.next().and_then(|v| v.parse().ok()),
            "--reps" => parsed.reps = args.next().and_then(|v| v.parse().ok()).unwrap_or(parsed.reps),
            "--warmup" => parsed.warmup = args.next().and_then(|v| v.parse().ok()).unwrap_or(parsed.warmup),
            "--cap-height" => {
                parsed.cap_height = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(parsed.cap_height)
            }
            "--mode" => {
                parsed.mode = match args.next().as_deref() {
                    Some("hash") => "hash",
                    Some("merkle") => "merkle",
                    Some("merkle27") => "merkle27",
                    Some("fulltree27") => "fulltree27",
                    _ => "all",
                };
            }
            _ => {}
        }
    }
    parsed
}

fn parse_cases(args: Args) -> Vec<Case> {
    if let (Some(chunk_bytes), Some(batch)) = (args.custom_chunk, args.custom_batch) {
        return vec![Case {
            name: "custom",
            chunk_bytes,
            batch,
        }];
    }

    vec![
        // Final-recursion wire commitment leaf hashes: 1330 Goldilocks values per leaf.
        Case {
            name: "stage2_wires_leaf",
            chunk_bytes: 1330 * 8,
            batch: 1 << 16,
        },
        // Final-recursion quotient commitment leaf hashes: 135 Goldilocks values per leaf.
        Case {
            name: "stage2_quotient_leaf",
            chunk_bytes: 135 * 8,
            batch: 1 << 20,
        },
        // Blake3 Merkle internal node hashes: two truncated 27-byte child digests.
        Case {
            name: "internal_nodes_54b",
            chunk_bytes: 54,
            batch: 1 << 20,
        },
    ]
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

fn make_input(bytes: usize) -> Vec<u8> {
    let mut input = vec![0u8; bytes];
    input
        .par_chunks_mut(4096)
        .enumerate()
        .for_each(|(chunk_idx, chunk)| {
            let mut state = (chunk_idx as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
            for byte in chunk {
                state ^= state >> 12;
                state ^= state << 25;
                state ^= state >> 27;
                *byte = state.wrapping_mul(0x2545_f491_4f6c_dd1d) as u8;
            }
        });
    input
}

fn bench_rust_blake3(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    reps: usize,
    warmup: usize,
) -> (f64, Vec<u8>) {
    let mut output = vec![0u8; 32 * batch];
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);

    for iter in 0..total {
        let start = Instant::now();
        input
            .par_chunks_exact(chunk_bytes)
            .zip(output.par_chunks_exact_mut(32))
            .for_each(|(chunk, digest)| {
                digest.copy_from_slice(blake3::hash(chunk).as_bytes());
            });
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&output);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    (median(timings), output)
}

fn bench_icicle_blake3_host(
    device_type: &str,
    input: &[u8],
    batch: usize,
    reps: usize,
    warmup: usize,
) -> Option<(f64, Vec<u8>)> {
    if device_type == "CUDA" {
        runtime::load_backend_from_env_or_default().ok()?;
    }
    set_device(&Device::new(device_type, 0)).ok()?;

    let hasher = Blake3::new(0).ok()?;
    let mut output = vec![0u8; 32 * batch];
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);

    for iter in 0..total {
        let start = Instant::now();
        hasher
            .hash(
                input.into_slice(),
                &HashConfig::default(),
                output.into_slice_mut(),
            )
            .ok()?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&output);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), output))
}

fn bench_icicle_cuda_device(
    input: &[u8],
    batch: usize,
    reps: usize,
    warmup: usize,
    include_transfers: bool,
) -> Option<(f64, Vec<u8>)> {
    runtime::load_backend_from_env_or_default().ok()?;
    set_device(&Device::new("CUDA", 0)).ok()?;

    let hasher = Blake3::new(0).ok()?;
    let mut device_input = DeviceVec::<u8>::malloc(input.len());
    let mut device_output = DeviceVec::<u8>::malloc(32 * batch);
    let mut output = vec![0u8; 32 * batch];

    if !include_transfers {
        device_input
            .copy_from_host(input.into_slice())
            .ok()?;
    }

    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    for iter in 0..total {
        let start = Instant::now();
        if include_transfers {
            device_input
                .copy_from_host(input.into_slice())
                .ok()?;
        }
        hasher
            .hash(
                (&device_input).into_slice(),
                &HashConfig::default(),
                (&mut device_output).into_slice_mut(),
            )
            .ok()?;
        if include_transfers {
            device_output
                .copy_to_host(output.into_slice_mut())
                .ok()?;
        }
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&device_output);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    if !include_transfers {
        device_output
            .copy_to_host(output.into_slice_mut())
            .ok()?;
    }

    Some((median(timings), output))
}

fn blake3_27(input: &[u8]) -> [u8; PLONKY2_BLAKE3_DIGEST_BYTES] {
    blake3::hash(input).as_bytes()[..PLONKY2_BLAKE3_DIGEST_BYTES]
        .try_into()
        .unwrap()
}

fn blake3_27_leaf_layer(input: &[u8], chunk_bytes: usize, batch: usize) -> Option<Vec<u8>> {
    if !batch.is_power_of_two() || input.len() != chunk_bytes.checked_mul(batch)? {
        return None;
    }

    let mut layer = vec![0u8; PLONKY2_BLAKE3_DIGEST_BYTES * batch];
    input
        .par_chunks_exact(chunk_bytes)
        .zip(layer.par_chunks_exact_mut(PLONKY2_BLAKE3_DIGEST_BYTES))
        .for_each(|(chunk, digest)| {
            digest.copy_from_slice(&blake3_27(chunk));
        });
    Some(layer)
}

fn log2_power_of_two(value: usize) -> Option<usize> {
    value.is_power_of_two().then(|| value.ilog2() as usize)
}

fn cpu_blake3_27_layers_until_cap(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    cap_height: usize,
) -> Option<Vec<Vec<u8>>> {
    let log_batch = log2_power_of_two(batch)?;
    if cap_height > log_batch {
        return None;
    }

    let mut layers = vec![blake3_27_leaf_layer(input, chunk_bytes, batch)?];
    let cap_count = 1usize << cap_height;
    let mut count = batch;
    while count > cap_count {
        let next_count = count / 2;
        let prev = layers.last()?;
        let mut next_layer = vec![0u8; PLONKY2_BLAKE3_DIGEST_BYTES * next_count];
        prev[..count * PLONKY2_BLAKE3_DIGEST_BYTES]
            .par_chunks_exact(2 * PLONKY2_BLAKE3_DIGEST_BYTES)
            .zip(next_layer.par_chunks_exact_mut(PLONKY2_BLAKE3_DIGEST_BYTES))
            .for_each(|(chunk, digest)| {
                digest.copy_from_slice(&blake3_27(chunk));
            });
        layers.push(next_layer);
        count = next_count;
    }

    Some(layers)
}

fn digest_from_layer(layer: &[u8], node_idx: usize) -> &[u8] {
    let start = node_idx * PLONKY2_BLAKE3_DIGEST_BYTES;
    &layer[start..start + PLONKY2_BLAKE3_DIGEST_BYTES]
}

fn push_plonky2_subtree_layout(
    layers: &[Vec<u8>],
    subtree_height: usize,
    start_leaf: usize,
    output: &mut Vec<u8>,
) {
    if subtree_height == 0 {
        return;
    }

    let child_height = subtree_height - 1;
    let half_leaves = 1usize << child_height;
    push_plonky2_subtree_layout(layers, child_height, start_leaf, output);
    output.extend_from_slice(digest_from_layer(
        &layers[child_height],
        start_leaf >> child_height,
    ));
    output.extend_from_slice(digest_from_layer(
        &layers[child_height],
        (start_leaf + half_leaves) >> child_height,
    ));
    push_plonky2_subtree_layout(layers, child_height, start_leaf + half_leaves, output);
}

fn plonky2_layout_from_layers(
    layers: &[Vec<u8>],
    batch: usize,
    cap_height: usize,
) -> Option<(Vec<u8>, Vec<u8>)> {
    let log_batch = log2_power_of_two(batch)?;
    if cap_height > log_batch {
        return None;
    }
    let subtree_height = log_batch - cap_height;
    if layers.len() != subtree_height + 1 {
        return None;
    }

    let cap_count = 1usize << cap_height;
    let cap = layers[subtree_height].clone();
    if cap.len() != cap_count * PLONKY2_BLAKE3_DIGEST_BYTES {
        return None;
    }

    let mut digests = Vec::with_capacity(2 * (batch - cap_count) * PLONKY2_BLAKE3_DIGEST_BYTES);
    let subtree_leaves = 1usize << subtree_height;
    for cap_idx in 0..cap_count {
        push_plonky2_subtree_layout(
            layers,
            subtree_height,
            cap_idx * subtree_leaves,
            &mut digests,
        );
    }
    Some((digests, cap))
}

fn bench_rust_blake3_27_full_tree(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    cap_height: usize,
    reps: usize,
    warmup: usize,
) -> Option<(f64, Vec<u8>, usize)> {
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    let mut cap = Vec::new();
    let mut digests_len = 0;

    for iter in 0..total {
        let start = Instant::now();
        let layers = cpu_blake3_27_layers_until_cap(input, chunk_bytes, batch, cap_height)?;
        let (digests, next_cap) = plonky2_layout_from_layers(&layers, batch, cap_height)?;
        digests_len = digests.len();
        cap = next_cap;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&digests);
        black_box(&cap);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), cap, digests_len))
}

fn blake3_27_merkle_root(input: &[u8], chunk_bytes: usize, batch: usize) -> Option<Vec<u8>> {
    let mut layer = blake3_27_leaf_layer(input, chunk_bytes, batch)?;
    let mut count = batch;
    while count > 1 {
        let next_count = count / 2;
        let mut next_layer = vec![0u8; PLONKY2_BLAKE3_DIGEST_BYTES * next_count];
        layer[..count * PLONKY2_BLAKE3_DIGEST_BYTES]
            .par_chunks_exact(2 * PLONKY2_BLAKE3_DIGEST_BYTES)
            .zip(next_layer.par_chunks_exact_mut(PLONKY2_BLAKE3_DIGEST_BYTES))
            .for_each(|(chunk, digest)| {
                digest.copy_from_slice(&blake3_27(chunk));
            });
        layer = next_layer;
        count = next_count;
    }

    Some(layer)
}

fn bench_rust_blake3_27_merkle(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    reps: usize,
    warmup: usize,
) -> Option<(f64, Vec<u8>)> {
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    let mut root = Vec::new();

    for iter in 0..total {
        let start = Instant::now();
        root = blake3_27_merkle_root(input, chunk_bytes, batch)?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&root);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), root))
}

fn bench_icicle_blake3_27_merkle_hybrid(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    reps: usize,
    warmup: usize,
) -> Option<(f64, Vec<u8>)> {
    if !batch.is_power_of_two() || input.len() != chunk_bytes.checked_mul(batch)? {
        return None;
    }

    runtime::load_backend_from_env_or_default().ok()?;
    set_device(&Device::new("CUDA", 0)).ok()?;

    let internal_hasher = Blake3::new((2 * PLONKY2_BLAKE3_DIGEST_BYTES) as u64).ok()?;
    let cfg = HashConfig::default();
    let mut layer_a = DeviceVec::<u8>::malloc(PLONKY2_BLAKE3_DIGEST_BYTES * batch);
    let mut layer_b = DeviceVec::<u8>::malloc(PLONKY2_BLAKE3_DIGEST_BYTES * batch);
    let mut hash32 = DeviceVec::<u8>::malloc(32 * (batch / 2).max(1));
    let mut root = vec![0u8; PLONKY2_BLAKE3_DIGEST_BYTES];

    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    for iter in 0..total {
        let start = Instant::now();
        let leaf_layer = blake3_27_leaf_layer(input, chunk_bytes, batch)?;
        layer_a
            .copy_from_host(leaf_layer.into_slice())
            .ok()?;

        let mut count = batch;
        let mut curr_is_a = true;
        while count > 1 {
            let next_count = count / 2;
            let input_len = PLONKY2_BLAKE3_DIGEST_BYTES * count;
            let hash_len = 32 * next_count;
            let output_len = PLONKY2_BLAKE3_DIGEST_BYTES * next_count;

            if curr_is_a {
                internal_hasher
                    .hash(&layer_a[0..input_len], &cfg, &mut hash32[0..hash_len])
                    .ok()?;
                truncate_32_to_n_device(
                    &hash32[0..hash_len],
                    &mut layer_b[0..output_len],
                    next_count,
                    PLONKY2_BLAKE3_DIGEST_BYTES,
                )?;
            } else {
                internal_hasher
                    .hash(&layer_b[0..input_len], &cfg, &mut hash32[0..hash_len])
                    .ok()?;
                truncate_32_to_n_device(
                    &hash32[0..hash_len],
                    &mut layer_a[0..output_len],
                    next_count,
                    PLONKY2_BLAKE3_DIGEST_BYTES,
                )?;
            }

            curr_is_a = !curr_is_a;
            count = next_count;
        }

        if curr_is_a {
            layer_a[0..PLONKY2_BLAKE3_DIGEST_BYTES]
                .copy_to_host(root.into_slice_mut())
                .ok()?;
        } else {
            layer_b[0..PLONKY2_BLAKE3_DIGEST_BYTES]
                .copy_to_host(root.into_slice_mut())
                .ok()?;
        }

        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&root);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), root))
}

fn bench_icicle_blake3_27_full_tree_hybrid(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    cap_height: usize,
    reps: usize,
    warmup: usize,
) -> Option<(f64, Vec<u8>, usize)> {
    let log_batch = log2_power_of_two(batch)?;
    if cap_height > log_batch || input.len() != chunk_bytes.checked_mul(batch)? {
        return None;
    }

    runtime::load_backend_from_env_or_default().ok()?;
    set_device(&Device::new("CUDA", 0)).ok()?;

    let internal_hasher = Blake3::new((2 * PLONKY2_BLAKE3_DIGEST_BYTES) as u64).ok()?;
    let cfg = HashConfig::default();
    let mut layer_a = DeviceVec::<u8>::malloc(PLONKY2_BLAKE3_DIGEST_BYTES * batch);
    let mut layer_b = DeviceVec::<u8>::malloc(PLONKY2_BLAKE3_DIGEST_BYTES * batch);
    let mut hash32 = DeviceVec::<u8>::malloc(32 * (batch / 2).max(1));

    let cap_count = 1usize << cap_height;
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    let mut cap = Vec::new();
    let mut digests_len = 0;

    for iter in 0..total {
        let start = Instant::now();
        let leaf_layer = blake3_27_leaf_layer(input, chunk_bytes, batch)?;
        layer_a
            .copy_from_host(leaf_layer.into_slice())
            .ok()?;

        let mut layers = Vec::with_capacity(log_batch - cap_height + 1);
        layers.push(leaf_layer);

        let mut count = batch;
        let mut curr_is_a = true;
        while count > cap_count {
            let next_count = count / 2;
            let input_len = PLONKY2_BLAKE3_DIGEST_BYTES * count;
            let hash_len = 32 * next_count;
            let output_len = PLONKY2_BLAKE3_DIGEST_BYTES * next_count;

            if curr_is_a {
                internal_hasher
                    .hash(&layer_a[0..input_len], &cfg, &mut hash32[0..hash_len])
                    .ok()?;
                truncate_32_to_n_device(
                    &hash32[0..hash_len],
                    &mut layer_b[0..output_len],
                    next_count,
                    PLONKY2_BLAKE3_DIGEST_BYTES,
                )?;
                let mut host_layer = vec![0u8; output_len];
                layer_b[0..output_len]
                    .copy_to_host(host_layer.into_slice_mut())
                    .ok()?;
                layers.push(host_layer);
            } else {
                internal_hasher
                    .hash(&layer_b[0..input_len], &cfg, &mut hash32[0..hash_len])
                    .ok()?;
                truncate_32_to_n_device(
                    &hash32[0..hash_len],
                    &mut layer_a[0..output_len],
                    next_count,
                    PLONKY2_BLAKE3_DIGEST_BYTES,
                )?;
                let mut host_layer = vec![0u8; output_len];
                layer_a[0..output_len]
                    .copy_to_host(host_layer.into_slice_mut())
                    .ok()?;
                layers.push(host_layer);
            }

            curr_is_a = !curr_is_a;
            count = next_count;
        }

        let (digests, next_cap) = plonky2_layout_from_layers(&layers, batch, cap_height)?;
        digests_len = digests.len();
        cap = next_cap;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&digests);
        black_box(&cap);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), cap, digests_len))
}

fn build_icicle_merkle_root(
    leaves: &(impl HostOrDeviceSlice<u8> + ?Sized),
    chunk_bytes: usize,
    batch: usize,
    config: &MerkleTreeConfig,
) -> Option<Vec<u8>> {
    let height = batch.next_power_of_two().ilog2() as usize;
    let leaf_hasher = Blake3::new(chunk_bytes as u64).ok()?;
    let compress_hasher = Blake3::new(64).ok()?;
    let layer_hashes: Vec<&Hasher> = std::iter::once(&leaf_hasher)
        .chain(std::iter::repeat(&compress_hasher).take(height))
        .collect();
    let tree = MerkleTree::new(&layer_hashes, chunk_bytes as u64, 0).ok()?;
    tree.build(leaves, config).ok()?;
    Some(tree.get_root::<u8>().ok()?.to_vec())
}

fn merkle_config(batch: usize) -> MerkleTreeConfig {
    let mut config = MerkleTreeConfig::default();
    if !batch.is_power_of_two() {
        config.padding_policy = PaddingPolicy::ZeroPadding;
    }
    config
}

fn bench_icicle_merkle_host(
    device_type: &str,
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    reps: usize,
    warmup: usize,
) -> Option<(f64, Vec<u8>)> {
    if device_type == "CUDA" {
        runtime::load_backend_from_env_or_default().ok()?;
    }
    set_device(&Device::new(device_type, 0)).ok()?;

    let config = merkle_config(batch);
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    let mut root = Vec::new();

    for iter in 0..total {
        let start = Instant::now();
        root = build_icicle_merkle_root(input.into_slice(), chunk_bytes, batch, &config)?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&root);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), root))
}

fn bench_icicle_merkle_cuda_device(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    reps: usize,
    warmup: usize,
    include_transfers: bool,
) -> Option<(f64, Vec<u8>)> {
    runtime::load_backend_from_env_or_default().ok()?;
    set_device(&Device::new("CUDA", 0)).ok()?;

    let config = merkle_config(batch);
    let mut device_input = DeviceVec::<u8>::malloc(input.len());
    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    let mut root = Vec::new();

    if !include_transfers {
        device_input
            .copy_from_host(input.into_slice())
            .ok()?;
    }

    for iter in 0..total {
        let start = Instant::now();
        if include_transfers {
            device_input
                .copy_from_host(input.into_slice())
                .ok()?;
        }
        root = build_icicle_merkle_root((&device_input).into_slice(), chunk_bytes, batch, &config)?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&root);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), root))
}

#[cfg(pearl_icicle_blake3_bench_cuda)]
fn truncate_32_to_n_device(
    input: &(impl HostOrDeviceSlice<u8> + ?Sized),
    output: &mut (impl HostOrDeviceSlice<u8> + ?Sized),
    count: usize,
    n: usize,
) -> Option<()> {
    if !input.is_on_device()
        || !output.is_on_device()
        || input.len() < count.checked_mul(32)?
        || output.len() < count.checked_mul(n)?
    {
        return None;
    }

    let status = unsafe {
        pearl_blake3_truncate_32_to_n(input.as_ptr(), output.as_mut_ptr(), count, n)
    };
    if status == 0 {
        Some(())
    } else {
        None
    }
}

#[cfg(not(pearl_icicle_blake3_bench_cuda))]
fn truncate_32_to_n_device(
    _input: &(impl HostOrDeviceSlice<u8> + ?Sized),
    _output: &mut (impl HostOrDeviceSlice<u8> + ?Sized),
    _count: usize,
    _n: usize,
) -> Option<()> {
    None
}

fn bench_icicle_blake3_27_merkle_cuda_device(
    input: &[u8],
    chunk_bytes: usize,
    batch: usize,
    reps: usize,
    warmup: usize,
    include_h2d: bool,
) -> Option<(f64, Vec<u8>)> {
    if !batch.is_power_of_two() || input.len() != chunk_bytes.checked_mul(batch)? {
        return None;
    }

    runtime::load_backend_from_env_or_default().ok()?;
    set_device(&Device::new("CUDA", 0)).ok()?;

    let leaf_hasher = Blake3::new(chunk_bytes as u64).ok()?;
    let internal_hasher = Blake3::new((2 * PLONKY2_BLAKE3_DIGEST_BYTES) as u64).ok()?;
    let cfg = HashConfig::default();

    let mut device_input = DeviceVec::<u8>::malloc(input.len());
    let mut hash32 = DeviceVec::<u8>::malloc(32 * batch);
    let mut layer_a = DeviceVec::<u8>::malloc(PLONKY2_BLAKE3_DIGEST_BYTES * batch);
    let mut layer_b = DeviceVec::<u8>::malloc(PLONKY2_BLAKE3_DIGEST_BYTES * batch);
    let mut root = vec![0u8; PLONKY2_BLAKE3_DIGEST_BYTES];

    if !include_h2d {
        device_input
            .copy_from_host(input.into_slice())
            .ok()?;
    }

    let total = warmup + reps;
    let mut timings = Vec::with_capacity(reps);
    for iter in 0..total {
        let start = Instant::now();
        if include_h2d {
            device_input
                .copy_from_host(input.into_slice())
                .ok()?;
        }

        {
            let hash_len = 32 * batch;
            leaf_hasher
                .hash(
                    (&device_input).into_slice(),
                    &cfg,
                    &mut hash32[0..hash_len],
                )
                .ok()?;
            let layer_len = PLONKY2_BLAKE3_DIGEST_BYTES * batch;
            truncate_32_to_n_device(
                &hash32[0..hash_len],
                &mut layer_a[0..layer_len],
                batch,
                PLONKY2_BLAKE3_DIGEST_BYTES,
            )?;
        }

        let mut count = batch;
        let mut curr_is_a = true;
        while count > 1 {
            let next_count = count / 2;
            let input_len = PLONKY2_BLAKE3_DIGEST_BYTES * count;
            let hash_len = 32 * next_count;
            let output_len = PLONKY2_BLAKE3_DIGEST_BYTES * next_count;

            if curr_is_a {
                internal_hasher
                    .hash(&layer_a[0..input_len], &cfg, &mut hash32[0..hash_len])
                    .ok()?;
                truncate_32_to_n_device(
                    &hash32[0..hash_len],
                    &mut layer_b[0..output_len],
                    next_count,
                    PLONKY2_BLAKE3_DIGEST_BYTES,
                )?;
            } else {
                internal_hasher
                    .hash(&layer_b[0..input_len], &cfg, &mut hash32[0..hash_len])
                    .ok()?;
                truncate_32_to_n_device(
                    &hash32[0..hash_len],
                    &mut layer_a[0..output_len],
                    next_count,
                    PLONKY2_BLAKE3_DIGEST_BYTES,
                )?;
            }

            curr_is_a = !curr_is_a;
            count = next_count;
        }

        if curr_is_a {
            layer_a[0..PLONKY2_BLAKE3_DIGEST_BYTES]
                .copy_to_host(root.into_slice_mut())
                .ok()?;
        } else {
            layer_b[0..PLONKY2_BLAKE3_DIGEST_BYTES]
                .copy_to_host(root.into_slice_mut())
                .ok()?;
        }

        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&root);
        if iter >= warmup {
            timings.push(ms);
        }
    }

    Some((median(timings), root))
}

fn run_hash_case(case: Case, args: Args, input: &[u8]) {
    let total_bytes = case.chunk_bytes * case.batch;
    let (rust_ms, rust_output) =
        bench_rust_blake3(&input, case.chunk_bytes, case.batch, args.reps, args.warmup);
    println!(
        "{{\"benchmark\":\"icicle_blake3\",\"case\":\"{}\",\"device\":\"rust_rayon\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"reps\":{},\"warmup\":{},\"median_ms\":{:.3}}}",
        case.name, case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, rust_ms
    );

    for device in ["CPU", "CUDA"] {
        match bench_icicle_blake3_host(device, &input, case.batch, args.reps, args.warmup) {
            Some((ms, output)) => {
                let matches = output == rust_output;
                println!(
                    "{{\"benchmark\":\"icicle_blake3\",\"case\":\"{}\",\"device\":\"icicle_{}_host\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"matches_rust\":{}}}",
                    case.name, device.to_lowercase(), case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, matches
                );
            }
            None => {
                println!(
                    "{{\"benchmark\":\"icicle_blake3\",\"case\":\"{}\",\"device\":\"icicle_{}_host\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unavailable\"}}",
                    case.name, device.to_lowercase(), case.chunk_bytes, case.batch, total_bytes
                );
            }
        }
    }

    for (name, include_transfers) in [
        ("icicle_cuda_device_hash_only", false),
        ("icicle_cuda_device_with_transfers", true),
    ] {
        match bench_icicle_cuda_device(&input, case.batch, args.reps, args.warmup, include_transfers) {
            Some((ms, output)) => {
                let matches = output == rust_output;
                println!(
                    "{{\"benchmark\":\"icicle_blake3\",\"case\":\"{}\",\"device\":\"{}\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"matches_rust\":{}}}",
                    case.name, name, case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, matches
                );
            }
            None => {
                println!(
                    "{{\"benchmark\":\"icicle_blake3\",\"case\":\"{}\",\"device\":\"{}\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unavailable\"}}",
                    case.name, name, case.chunk_bytes, case.batch, total_bytes
                );
            }
        }
    }
}

fn run_merkle27_case(case: Case, args: Args, input: &[u8]) {
    let total_bytes = case.chunk_bytes * case.batch;
    let reference = bench_rust_blake3_27_merkle(
        input,
        case.chunk_bytes,
        case.batch,
        args.reps,
        args.warmup,
    );
    match reference {
        Some((ms, root)) => {
            println!(
                "{{\"benchmark\":\"plonky2_blake3_27_merkle\",\"case\":\"{}\",\"device\":\"rust_rayon\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":27,\"proof_compatible_with_plonky2_blake3_27\":true,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"root_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                case.name, case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, root[0], root[1], root[2], root[3]
            );

            for (name, include_h2d) in [
                ("icicle_cuda_merkle27_device_only", false),
                ("icicle_cuda_merkle27_with_h2d", true),
            ] {
                match bench_icicle_blake3_27_merkle_cuda_device(
                    input,
                    case.chunk_bytes,
                    case.batch,
                    args.reps,
                    args.warmup,
                    include_h2d,
                ) {
                    Some((ms, cuda_root)) => {
                        let matches = cuda_root == root;
                        println!(
                            "{{\"benchmark\":\"plonky2_blake3_27_merkle\",\"case\":\"{}\",\"device\":\"{}\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":27,\"proof_compatible_with_plonky2_blake3_27\":true,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"matches_rust\":{},\"root_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                            case.name, name, case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, matches, cuda_root[0], cuda_root[1], cuda_root[2], cuda_root[3]
                        );
                    }
                    None => {
                        println!(
                            "{{\"benchmark\":\"plonky2_blake3_27_merkle\",\"case\":\"{}\",\"device\":\"{}\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unavailable\"}}",
                            case.name, name, case.chunk_bytes, case.batch, total_bytes
                        );
                    }
                }
            }

            match bench_icicle_blake3_27_merkle_hybrid(
                input,
                case.chunk_bytes,
                case.batch,
                args.reps,
                args.warmup,
            ) {
                Some((ms, hybrid_root)) => {
                    let matches = hybrid_root == root;
                    println!(
                        "{{\"benchmark\":\"plonky2_blake3_27_merkle\",\"case\":\"{}\",\"device\":\"cpu_leaf_hash_cuda_internal_layers\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":27,\"proof_compatible_with_plonky2_blake3_27\":true,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"matches_rust\":{},\"root_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                        case.name, case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, matches, hybrid_root[0], hybrid_root[1], hybrid_root[2], hybrid_root[3]
                    );
                }
                None => {
                    println!(
                        "{{\"benchmark\":\"plonky2_blake3_27_merkle\",\"case\":\"{}\",\"device\":\"cpu_leaf_hash_cuda_internal_layers\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unavailable\"}}",
                        case.name, case.chunk_bytes, case.batch, total_bytes
                    );
                }
            }
        }
        None => {
            println!(
                "{{\"benchmark\":\"plonky2_blake3_27_merkle\",\"case\":\"{}\",\"device\":\"rust_rayon\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unsupported_non_power_of_two_or_bad_size\"}}",
                case.name, case.chunk_bytes, case.batch, total_bytes
            );
        }
    }
}

fn run_fulltree27_case(case: Case, args: Args, input: &[u8]) {
    let total_bytes = case.chunk_bytes * case.batch;
    let reference = bench_rust_blake3_27_full_tree(
        input,
        case.chunk_bytes,
        case.batch,
        args.cap_height,
        args.reps,
        args.warmup,
    );
    match reference {
        Some((ms, cap, digests_len)) => {
            println!(
                "{{\"benchmark\":\"plonky2_blake3_27_full_tree\",\"case\":\"{}\",\"device\":\"rust_rayon_layout\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":27,\"cap_height\":{},\"digests_bytes\":{},\"proof_compatible_with_plonky2_blake3_27\":true,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"cap_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                case.name, case.chunk_bytes, case.batch, total_bytes, args.cap_height, digests_len, args.reps, args.warmup, ms, cap[0], cap[1], cap[2], cap[3]
            );

            match bench_icicle_blake3_27_full_tree_hybrid(
                input,
                case.chunk_bytes,
                case.batch,
                args.cap_height,
                args.reps,
                args.warmup,
            ) {
                Some((ms, hybrid_cap, hybrid_digests_len)) => {
                    let matches = hybrid_cap == cap && hybrid_digests_len == digests_len;
                    println!(
                        "{{\"benchmark\":\"plonky2_blake3_27_full_tree\",\"case\":\"{}\",\"device\":\"cpu_leaf_hash_cuda_internal_layers_layout\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":27,\"cap_height\":{},\"digests_bytes\":{},\"proof_compatible_with_plonky2_blake3_27\":true,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"matches_rust\":{},\"cap_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                        case.name, case.chunk_bytes, case.batch, total_bytes, args.cap_height, hybrid_digests_len, args.reps, args.warmup, ms, matches, hybrid_cap[0], hybrid_cap[1], hybrid_cap[2], hybrid_cap[3]
                    );
                }
                None => {
                    println!(
                        "{{\"benchmark\":\"plonky2_blake3_27_full_tree\",\"case\":\"{}\",\"device\":\"cpu_leaf_hash_cuda_internal_layers_layout\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"cap_height\":{},\"error\":\"unavailable\"}}",
                        case.name, case.chunk_bytes, case.batch, total_bytes, args.cap_height
                    );
                }
            }
        }
        None => {
            println!(
                "{{\"benchmark\":\"plonky2_blake3_27_full_tree\",\"case\":\"{}\",\"device\":\"rust_rayon_layout\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"cap_height\":{},\"error\":\"unsupported\"}}",
                case.name, case.chunk_bytes, case.batch, total_bytes, args.cap_height
            );
        }
    }
}

fn run_merkle_case(case: Case, args: Args, input: &[u8]) {
    let total_bytes = case.chunk_bytes * case.batch;
    for device in ["CPU", "CUDA"] {
        match bench_icicle_merkle_host(device, input, case.chunk_bytes, case.batch, args.reps, args.warmup) {
            Some((ms, root)) => {
                println!(
                    "{{\"benchmark\":\"icicle_blake3_merkle\",\"case\":\"{}\",\"device\":\"icicle_{}_host\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":32,\"proof_compatible_with_plonky2_blake3_27\":false,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"root_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                    case.name, device.to_lowercase(), case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, root[0], root[1], root[2], root[3]
                );
            }
            None => {
                println!(
                    "{{\"benchmark\":\"icicle_blake3_merkle\",\"case\":\"{}\",\"device\":\"icicle_{}_host\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unavailable\"}}",
                    case.name, device.to_lowercase(), case.chunk_bytes, case.batch, total_bytes
                );
            }
        }
    }

    for (name, include_transfers) in [
        ("icicle_cuda_merkle_device_only", false),
        ("icicle_cuda_merkle_device_with_h2d", true),
    ] {
        match bench_icicle_merkle_cuda_device(
            input,
            case.chunk_bytes,
            case.batch,
            args.reps,
            args.warmup,
            include_transfers,
        ) {
            Some((ms, root)) => {
                println!(
                    "{{\"benchmark\":\"icicle_blake3_merkle\",\"case\":\"{}\",\"device\":\"{}\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"digest_bytes\":32,\"proof_compatible_with_plonky2_blake3_27\":false,\"reps\":{},\"warmup\":{},\"median_ms\":{:.3},\"root_prefix\":\"{:02x}{:02x}{:02x}{:02x}\"}}",
                    case.name, name, case.chunk_bytes, case.batch, total_bytes, args.reps, args.warmup, ms, root[0], root[1], root[2], root[3]
                );
            }
            None => {
                println!(
                    "{{\"benchmark\":\"icicle_blake3_merkle\",\"case\":\"{}\",\"device\":\"{}\",\"chunk_bytes\":{},\"batch\":{},\"total_bytes\":{},\"error\":\"unavailable\"}}",
                    case.name, name, case.chunk_bytes, case.batch, total_bytes
                );
            }
        }
    }
}

fn main() {
    let args = parse_args();
    for case in parse_cases(args) {
        let total_bytes = case.chunk_bytes * case.batch;
        let input = make_input(total_bytes);
        if args.mode == "hash" || args.mode == "all" {
            run_hash_case(case, args, &input);
        }
        if args.mode == "merkle" || args.mode == "all" {
            run_merkle_case(case, args, &input);
        }
        if args.mode == "merkle27" || args.mode == "all" {
            run_merkle27_case(case, args, &input);
        }
        if args.mode == "fulltree27" || args.mode == "all" {
            run_fulltree27_case(case, args, &input);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plonky2::field::goldilocks_field::GoldilocksField;
    use plonky2::field::types::Field;
    use plonky2::hash::blake3_perm::Blake3Hash;
    use plonky2::hash::merkle_tree::MerkleTree;

    #[test]
    fn plonky2_blake3_27_layout_matches_merkle_tree() {
        const BATCH: usize = 32;
        const LEAF_FIELDS: usize = 5;
        const CHUNK_BYTES: usize = LEAF_FIELDS * 8;
        const CAP_HEIGHT: usize = 2;

        let input = make_input(BATCH * CHUNK_BYTES);
        let layers = cpu_blake3_27_layers_until_cap(&input, CHUNK_BYTES, BATCH, CAP_HEIGHT).unwrap();
        let (digests, cap) = plonky2_layout_from_layers(&layers, BATCH, CAP_HEIGHT).unwrap();

        let leaves = input
            .chunks_exact(CHUNK_BYTES)
            .map(|leaf| {
                leaf.chunks_exact(8)
                    .map(|word| {
                        GoldilocksField::from_canonical_u64(u64::from_le_bytes(word.try_into().unwrap()))
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        let tree = MerkleTree::<GoldilocksField, Blake3Hash<PLONKY2_BLAKE3_DIGEST_BYTES>>::new(
            leaves,
            CAP_HEIGHT,
        );
        let tree_digests = tree
            .digests
            .iter()
            .flat_map(|digest| digest.0)
            .collect::<Vec<_>>();
        let tree_cap = tree
            .cap
            .0
            .iter()
            .flat_map(|digest| digest.0)
            .collect::<Vec<_>>();

        assert_eq!(digests, tree_digests);
        assert_eq!(cap, tree_cap);
    }
}
