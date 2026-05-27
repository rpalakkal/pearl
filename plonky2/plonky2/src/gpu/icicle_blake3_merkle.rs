use std::any::type_name;
use std::sync::OnceLock;
use std::time::Instant;

use icicle_core::hash::HashConfig;
use icicle_hash::blake3::Blake3;
use icicle_runtime::memory::{DeviceVec, HostOrDeviceSlice, IntoIcicleSlice, IntoIcicleSliceMut};
use icicle_runtime::{runtime, set_device, Device};
use plonky2_maybe_rayon::*;

use crate::field::goldilocks_field::GoldilocksField;
use crate::hash::blake3_perm::Blake3Hash;
use crate::hash::hash_types::RichField;
use crate::plonk::config::{GenericHashOut, Hasher};
use crate::util::log2_strict;

const DIGEST_BYTES: usize = 27;

unsafe extern "C" {
    fn pearl_zk_blake3_truncate_32_to_27(
        input: *const u8,
        output: *mut u8,
        count: usize,
    ) -> i32;
    fn pearl_zk_blake3_store_27_layer_layout(
        layer: *const u8,
        digests: *mut u8,
        nodes: usize,
        subtree_height: usize,
        layer_height: usize,
    ) -> i32;
}

static BACKEND_READY: OnceLock<bool> = OnceLock::new();

fn env_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_BLAKE3_MERKLE").is_some_and(|value| value != "0")
}

fn min_leaves() -> usize {
    std::env::var("PEARL_ZK_ICICLE_BLAKE3_MERKLE_MIN_LEAVES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn log_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_BLAKE3_MERKLE_LOG").is_some()
}

fn timing_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_BLAKE3_MERKLE_TIMING").is_some_and(|value| value != "0")
}

fn backend_ready() -> bool {
    *BACKEND_READY.get_or_init(|| {
        if let Err(err) = runtime::load_backend_from_env_or_default() {
            log::debug!("ICICLE Blake3 Merkle backend load failed: {err}");
            return false;
        }

        let device_id = std::env::var("PEARL_ZK_ICICLE_DEVICE")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let device = Device::new("CUDA", device_id);
        if let Err(err) = set_device(&device) {
            log::debug!("ICICLE Blake3 Merkle CUDA device selection failed: {err}");
            return false;
        }

        true
    })
}

fn supported_types<F, H>() -> bool
where
    F: RichField,
    H: Hasher<F>,
{
    type_name::<F>() == type_name::<GoldilocksField>()
        && type_name::<H>() == type_name::<Blake3Hash<DIGEST_BYTES>>()
        && H::HASH_SIZE == DIGEST_BYTES
}

fn truncate_32_to_27_device(
    input: &(impl HostOrDeviceSlice<u8> + ?Sized),
    output: &mut (impl HostOrDeviceSlice<u8> + ?Sized),
    count: usize,
) -> Option<()> {
    if !input.is_on_device()
        || !output.is_on_device()
        || input.len() < count.checked_mul(32)?
        || output.len() < count.checked_mul(DIGEST_BYTES)?
    {
        return None;
    }

    let status = unsafe {
        pearl_zk_blake3_truncate_32_to_27(input.as_ptr(), output.as_mut_ptr(), count)
    };
    if status == 0 {
        Some(())
    } else {
        log::debug!("CUDA Blake3-27 truncation failed with status {status}");
        None
    }
}

fn store_layer_layout_device(
    layer: &(impl HostOrDeviceSlice<u8> + ?Sized),
    digests: &mut (impl HostOrDeviceSlice<u8> + ?Sized),
    nodes: usize,
    subtree_height: usize,
    layer_height: usize,
) -> Option<()> {
    let local_bits = subtree_height.checked_sub(layer_height)?;
    let nodes_per_subtree = 1usize.checked_shl(local_bits.try_into().ok()?)?;
    if nodes_per_subtree == 0 || nodes % nodes_per_subtree != 0 {
        return None;
    }
    let cap_count = nodes / nodes_per_subtree;
    let subtree_nodes = 1usize.checked_shl(subtree_height.try_into().ok()?)?;
    let tree_len = 2usize.checked_mul(subtree_nodes.checked_sub(1)?)?;
    let required_digest_bytes = tree_len.checked_mul(cap_count)?.checked_mul(DIGEST_BYTES)?;
    if !layer.is_on_device()
        || !digests.is_on_device()
        || layer_height >= subtree_height
        || layer.len() < nodes.checked_mul(DIGEST_BYTES)?
        || digests.len() < required_digest_bytes
    {
        return None;
    }

    let status = unsafe {
        pearl_zk_blake3_store_27_layer_layout(
            layer.as_ptr(),
            digests.as_mut_ptr(),
            nodes,
            subtree_height,
            layer_height,
        )
    };
    if status == 0 {
        Some(())
    } else {
        log::debug!("CUDA Blake3-27 layer layout scatter failed with status {status}");
        None
    }
}

fn blake3_leaf_hashes<F>(leaves: &[Vec<F>], leaf_len: usize) -> Vec<u8>
where
    F: RichField,
{
    let mut leaf_hashes = vec![0u8; leaves.len() * DIGEST_BYTES];
    leaf_hashes
        .par_chunks_exact_mut(DIGEST_BYTES)
        .zip(leaves.par_iter())
        .for_each(|(digest, leaf)| {
            let mut buffer = Vec::with_capacity(leaf_len * 8);
            for value in leaf {
                buffer.extend_from_slice(&value.to_canonical_u64().to_le_bytes());
            }
            digest.copy_from_slice(&blake3::hash(&buffer).as_bytes()[..DIGEST_BYTES]);
        });
    leaf_hashes
}

fn hashes_from_bytes<F, H>(bytes: &[u8]) -> Vec<H::Hash>
where
    F: RichField,
    H: Hasher<F>,
{
    bytes
        .chunks_exact(DIGEST_BYTES)
        .map(H::Hash::from_bytes)
        .collect::<Vec<_>>()
}

pub(crate) fn try_build<F, H>(
    leaves: &[Vec<F>],
    cap_height: usize,
) -> Option<(Vec<H::Hash>, Vec<H::Hash>)>
where
    F: RichField,
    H: Hasher<F>,
{
    if !env_enabled() || !supported_types::<F, H>() || leaves.is_empty() {
        return None;
    }

    let leaves_len = leaves.len();
    if leaves_len < min_leaves() || !leaves_len.is_power_of_two() {
        return None;
    }
    let log_leaves_len = log2_strict(leaves_len);
    if cap_height > log_leaves_len {
        return None;
    }
    let subtree_height = log_leaves_len.checked_sub(cap_height)?;
    if subtree_height == 0 {
        return None;
    }

    let leaf_len = leaves[0].len();
    if leaf_len * 8 <= DIGEST_BYTES || !leaves.iter().all(|leaf| leaf.len() == leaf_len) {
        return None;
    }
    if !backend_ready() {
        return None;
    }

    let timing = timing_enabled();
    let start_total = Instant::now();

    let start_leaf = Instant::now();
    let leaf_hashes = blake3_leaf_hashes(leaves, leaf_len);
    let leaf_ms = start_leaf.elapsed().as_secs_f64() * 1000.0;

    let start_cuda = Instant::now();
    let cap_count = 1usize << cap_height;
    let num_digests = 2 * (leaves_len - cap_count);
    let mut layer_a = DeviceVec::<u8>::malloc(DIGEST_BYTES * leaves_len);
    let mut layer_b = DeviceVec::<u8>::malloc(DIGEST_BYTES * leaves_len);
    let mut hash32 = DeviceVec::<u8>::malloc(32 * (leaves_len / 2).max(1));
    let mut device_digests = DeviceVec::<u8>::malloc(DIGEST_BYTES * num_digests);
    layer_a
        .copy_from_host(leaf_hashes.into_slice())
        .ok()?;
    store_layer_layout_device(
        &layer_a[0..DIGEST_BYTES * leaves_len],
        &mut device_digests[0..DIGEST_BYTES * num_digests],
        leaves_len,
        subtree_height,
        0,
    )?;

    let internal_hasher = Blake3::new((2 * DIGEST_BYTES) as u64).ok()?;
    let cfg = HashConfig::default();

    let mut count = leaves_len;
    let mut layer_height = 0usize;
    let mut curr_is_a = true;
    while count > cap_count {
        let next_count = count / 2;
        let next_layer_height = layer_height + 1;
        let input_len = DIGEST_BYTES * count;
        let hash_len = 32 * next_count;
        let output_len = DIGEST_BYTES * next_count;

        if curr_is_a {
            internal_hasher
                .hash(&layer_a[0..input_len], &cfg, &mut hash32[0..hash_len])
                .ok()?;
            truncate_32_to_27_device(&hash32[0..hash_len], &mut layer_b[0..output_len], next_count)?;
            if next_layer_height < subtree_height {
                store_layer_layout_device(
                    &layer_b[0..output_len],
                    &mut device_digests[0..DIGEST_BYTES * num_digests],
                    next_count,
                    subtree_height,
                    next_layer_height,
                )?;
            }
        } else {
            internal_hasher
                .hash(&layer_b[0..input_len], &cfg, &mut hash32[0..hash_len])
                .ok()?;
            truncate_32_to_27_device(&hash32[0..hash_len], &mut layer_a[0..output_len], next_count)?;
            if next_layer_height < subtree_height {
                store_layer_layout_device(
                    &layer_a[0..output_len],
                    &mut device_digests[0..DIGEST_BYTES * num_digests],
                    next_count,
                    subtree_height,
                    next_layer_height,
                )?;
            }
        }

        curr_is_a = !curr_is_a;
        layer_height = next_layer_height;
        count = next_count;
    }
    let cuda_ms = start_cuda.elapsed().as_secs_f64() * 1000.0;

    let start_copy = Instant::now();
    let mut digest_bytes = vec![0u8; DIGEST_BYTES * num_digests];
    device_digests[0..DIGEST_BYTES * num_digests]
        .copy_to_host(digest_bytes.into_slice_mut())
        .ok()?;
    let mut cap_bytes = vec![0u8; DIGEST_BYTES * cap_count];
    if curr_is_a {
        layer_a[0..DIGEST_BYTES * cap_count]
            .copy_to_host(cap_bytes.into_slice_mut())
            .ok()?;
    } else {
        layer_b[0..DIGEST_BYTES * cap_count]
            .copy_to_host(cap_bytes.into_slice_mut())
            .ok()?;
    }
    let copy_ms = start_copy.elapsed().as_secs_f64() * 1000.0;

    let start_convert = Instant::now();
    let digests = hashes_from_bytes::<F, H>(&digest_bytes);
    let cap = hashes_from_bytes::<F, H>(&cap_bytes);
    let convert_ms = start_convert.elapsed().as_secs_f64() * 1000.0;
    let total_ms = start_total.elapsed().as_secs_f64() * 1000.0;

    if log_enabled() {
        eprintln!(
            "pearl_zk_icicle_blake3_merkle leaves={leaves_len} leaf_len={leaf_len} cap_height={cap_height} digests={} total_ms={total_ms:.3}",
            digests.len()
        );
    }
    if timing {
        eprintln!(
            "pearl_zk_icicle_blake3_merkle_timing leaf_ms={leaf_ms:.3} cuda_ms={cuda_ms:.3} copy_ms={copy_ms:.3} convert_ms={convert_ms:.3} total_ms={total_ms:.3}"
        );
    }

    Some((digests, cap))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::field::types::Field;
    use crate::hash::merkle_proofs::verify_merkle_proof_to_cap;
    use crate::hash::merkle_tree::MerkleTree;

    #[test]
    fn icicle_blake3_merkle_matches_cpu() {
        std::env::remove_var("PEARL_ZK_ICICLE_BLAKE3_MERKLE");
        let leaves = (0..64)
            .map(|row| {
                (0..13)
                    .map(|col| GoldilocksField::from_canonical_usize(row * 1000 + col))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        let cpu = MerkleTree::<GoldilocksField, Blake3Hash<DIGEST_BYTES>>::new(leaves.clone(), 3);

        std::env::set_var("PEARL_ZK_ICICLE_BLAKE3_MERKLE", "1");
        let gpu = MerkleTree::<GoldilocksField, Blake3Hash<DIGEST_BYTES>>::new(leaves.clone(), 3);
        std::env::remove_var("PEARL_ZK_ICICLE_BLAKE3_MERKLE");

        assert_eq!(gpu.digests, cpu.digests);
        assert_eq!(gpu.cap, cpu.cap);

        for (i, leaf) in leaves.into_iter().enumerate() {
            let proof = gpu.prove(i);
            verify_merkle_proof_to_cap(leaf, i, &gpu.cap, &proof).unwrap();
        }
    }
}
