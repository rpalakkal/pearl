use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use icicle_core::bignum::BigNum;
use icicle_core::ntt::{
    initialize_domain, ntt, release_domain, NttAlgorithm, NTTConfig, NTTDir, NTTInitDomainConfig,
    Ordering, CUDA_NTT_ALGORITHM, CUDA_NTT_FAST_TWIDDLES_MODE,
};
#[cfg(pearl_zk_cuda)]
use icicle_core::vec_ops::{mul_scalars, VecOpsConfig};
use icicle_goldilocks::field::ScalarField as IcicleGoldilocksField;
use icicle_runtime::memory::{IntoIcicleSlice, IntoIcicleSliceMut};
#[cfg(pearl_zk_cuda)]
use icicle_runtime::memory::{DeviceVec, HostOrDeviceSlice, HostSlice};
use icicle_runtime::{runtime, set_device, Device};
use plonky2_field::extension::quadratic::QuadraticExtension;
use plonky2_field::extension::Extendable;
use plonky2_field::goldilocks_field::GoldilocksField;
use plonky2_field::polynomial::{PolynomialCoeffs, PolynomialValues};
use plonky2_field::types::{Field, PrimeField64, Sample};
use plonky2_util::log2_strict;

use crate::fri::oracle::SALT_SIZE;

static BACKEND_READY: OnceLock<bool> = OnceLock::new();
static INITIALIZED_DOMAIN: OnceLock<Mutex<Option<(usize, bool)>>> = OnceLock::new();
#[cfg(pearl_zk_cuda)]
static EXT_FFT_DEVICE_POWERS: OnceLock<
    Mutex<Vec<(usize, u64, DeviceVec<IcicleGoldilocksField>)>>,
> = OnceLock::new();

#[cfg(pearl_zk_cuda)]
unsafe extern "C" {
    fn pearl_zk_ext_fft_deinterleave_u64(
        input_aos: *const u64,
        output_soa: *mut u64,
        len: usize,
    ) -> i32;
    fn pearl_zk_ext_fft_deinterleave_mul_u64(
        input_aos: *const u64,
        powers: *const u64,
        output_soa: *mut u64,
        len: usize,
    ) -> i32;
    fn pearl_zk_ext_fft_interleave_u64(
        input_soa: *const u64,
        output_aos: *mut u64,
        len: usize,
    ) -> i32;
}

fn env_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_NTT").is_some_and(|value| value != "0")
}

fn ext_fft_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_EXT_FFT").is_some_and(|value| value != "0")
}

#[cfg(pearl_zk_cuda)]
fn ext_fft_device_pack_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_EXT_FFT_DEVICE_PACK").is_some_and(|value| value != "0")
}

#[cfg(pearl_zk_cuda)]
fn ext_fft_vecmul_pack_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_EXT_FFT_VECMUL_PACK").is_some_and(|value| value != "0")
}

fn min_elements() -> usize {
    std::env::var("PEARL_ZK_ICICLE_MIN_ELEMENTS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn ext_fft_min_elements() -> usize {
    std::env::var("PEARL_ZK_ICICLE_EXT_FFT_MIN_ELEMENTS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn log_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_LOG").is_some()
}

fn timing_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_TIMING").is_some_and(|value| value != "0")
}

fn backend_coset_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_BACKEND_COSET").is_some_and(|value| value != "0")
}

fn fast_twiddles_enabled() -> bool {
    std::env::var_os("PEARL_ZK_ICICLE_FAST_TWIDDLES").is_some_and(|value| value != "0")
}

fn ntt_algorithm() -> Option<NttAlgorithm> {
    match std::env::var("PEARL_ZK_ICICLE_NTT_ALGORITHM") {
        Ok(value) if value.eq_ignore_ascii_case("auto") => Some(NttAlgorithm::Auto),
        Ok(value) if value.eq_ignore_ascii_case("radix2") => Some(NttAlgorithm::Radix2),
        Ok(value) if value.eq_ignore_ascii_case("mixedradix") || value.eq_ignore_ascii_case("mixed_radix") => {
            Some(NttAlgorithm::MixedRadix)
        }
        Ok(value) if value.is_empty() => None,
        Ok(value) => {
            log::debug!("Unknown PEARL_ZK_ICICLE_NTT_ALGORITHM={value}; using backend default");
            None
        }
        Err(_) => None,
    }
}

fn backend_ready() -> bool {
    *BACKEND_READY.get_or_init(|| {
        if let Err(err) = runtime::load_backend_from_env_or_default() {
            log::debug!("ICICLE backend load failed: {err}");
            return false;
        }

        let device_id = std::env::var("PEARL_ZK_ICICLE_DEVICE")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let device = Device::new("CUDA", device_id);
        if let Err(err) = set_device(&device) {
            log::debug!("ICICLE CUDA device selection failed: {err}");
            return false;
        }

        true
    })
}

fn to_icicle(value: GoldilocksField) -> IcicleGoldilocksField {
    let value = value.to_canonical_u64();
    IcicleGoldilocksField::from([value as u32, (value >> 32) as u32])
}

fn init_domain(size: usize) -> Option<()> {
    let fast_twiddles = fast_twiddles_enabled();
    let initialized_domain = INITIALIZED_DOMAIN.get_or_init(|| Mutex::new(None));
    let mut initialized_domain = initialized_domain.lock().ok()?;
    if initialized_domain
        .is_some_and(|(domain_size, domain_fast_twiddles)| domain_size >= size && domain_fast_twiddles == fast_twiddles)
    {
        return Some(());
    }

    if initialized_domain.is_some() {
        release_domain::<IcicleGoldilocksField>().ok()?;
    }
    let root = GoldilocksField::primitive_root_of_unity(log2_strict(size));
    let root = to_icicle(root);
    let config = NTTInitDomainConfig::default();
    config
        .ext
        .set_bool(CUDA_NTT_FAST_TWIDDLES_MODE, fast_twiddles);
    initialize_domain(root, &config).ok()?;
    *initialized_domain = Some((size, fast_twiddles));
    Some(())
}

fn is_goldilocks<F>() -> bool {
    core::mem::size_of::<F>() == core::mem::size_of::<GoldilocksField>()
        && core::mem::align_of::<F>() == core::mem::align_of::<GoldilocksField>()
        && core::any::type_name::<F>() == core::any::type_name::<GoldilocksField>()
}

fn as_goldilocks<F>(value: F) -> Option<GoldilocksField> {
    if !is_goldilocks::<F>() {
        return None;
    }
    Some(unsafe { *(&value as *const F).cast::<GoldilocksField>() })
}

pub(crate) fn try_lde_values<F>(
    polynomials: &[PolynomialCoeffs<F>],
    rate_bits: usize,
    blinding: bool,
) -> Option<Vec<Vec<F>>>
where
    F: Field,
{
    if !env_enabled() || !is_goldilocks::<F>() || polynomials.is_empty() {
        return None;
    }

    let degree = polynomials[0].len();
    let extended_degree = degree.checked_shl(rate_bits as u32)?;
    let poly_count = polynomials.len();
    let total_elements = poly_count.checked_mul(extended_degree)?;
    if total_elements < min_elements() {
        return None;
    }
    if !backend_ready() {
        return None;
    }
    let timing = timing_enabled();
    let start_total = Instant::now();
    let start_domain = Instant::now();
    init_domain(extended_degree)?;
    let domain_ms = start_domain.elapsed().as_secs_f64() * 1000.0;

    if log_enabled() {
        eprintln!(
            "pearl_zk_icicle_ntt polynomials={poly_count} degree={degree} extended_degree={extended_degree} elements={total_elements}",
        );
    }

    let backend_coset = backend_coset_enabled();
    let start_pack = Instant::now();
    let shift_powers = if backend_coset {
        Vec::new()
    } else {
        GoldilocksField::coset_shift()
            .powers()
            .take(degree)
            .collect::<Vec<_>>()
    };
    let mut input = vec![IcicleGoldilocksField::zero(); total_elements];

    for (poly_idx, poly) in polynomials.iter().enumerate() {
        if poly.len() != degree {
            return None;
        }
        let coeffs = unsafe {
            core::slice::from_raw_parts(
                poly.coeffs.as_ptr().cast::<GoldilocksField>(),
                poly.coeffs.len(),
            )
        };
        let offset = poly_idx * extended_degree;
        for i in 0..degree {
            input[offset + i] = if backend_coset {
                to_icicle(coeffs[i])
            } else {
                to_icicle(coeffs[i] * shift_powers[i])
            };
        }
    }
    let pack_ms = start_pack.elapsed().as_secs_f64() * 1000.0;

    let start_ntt = Instant::now();
    let mut output = vec![IcicleGoldilocksField::zero(); total_elements];
    let mut config = NTTConfig::<IcicleGoldilocksField>::default();
    config.batch_size = poly_count as i32;
    if backend_coset {
        config.coset_gen = to_icicle(GoldilocksField::coset_shift());
    }
    config.ordering = Ordering::kNN;
    if let Some(algorithm) = ntt_algorithm() {
        config.ext.set_int(CUDA_NTT_ALGORITHM, algorithm as i32);
    }

    ntt(
        input.into_slice(),
        NTTDir::kForward,
        &config,
        output.into_slice_mut(),
    )
    .ok()?;
    let ntt_ms = start_ntt.elapsed().as_secs_f64() * 1000.0;

    let start_unpack = Instant::now();
    let mut result = output
        .chunks_exact(extended_degree)
        .map(|chunk| {
            let chunk = unsafe {
                core::slice::from_raw_parts(chunk.as_ptr().cast::<GoldilocksField>(), chunk.len())
            };
            chunk.to_vec()
        })
        .collect::<Vec<_>>();

    if blinding {
        result.extend((0..SALT_SIZE).map(|_| GoldilocksField::rand_vec(extended_degree)));
    }
    let unpack_ms = start_unpack.elapsed().as_secs_f64() * 1000.0;

    if timing {
        let total_ms = start_total.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "pearl_zk_icicle_timing polynomials={poly_count} degree={degree} extended_degree={extended_degree} elements={total_elements} domain_ms={domain_ms:.3} pack_ms={pack_ms:.3} ntt_ms={ntt_ms:.3} unpack_ms={unpack_ms:.3} total_ms={total_ms:.3}",
        );
    }

    Some(unsafe { core::mem::transmute::<Vec<Vec<GoldilocksField>>, Vec<Vec<F>>>(result) })
}

#[cfg(pearl_zk_cuda)]
fn try_coset_fft_ext2_device_pack<F, const D: usize>(
    coeffs: &[QuadraticExtension<GoldilocksField>],
    len: usize,
    shift: GoldilocksField,
    domain_ms: f64,
    start_total: Instant,
    timing: bool,
) -> Option<PolynomialValues<F::Extension>>
where
    F: Field + Extendable<D>,
{
    let total_elements = len.checked_mul(2)?;

    let start_copy_in = Instant::now();
    let input_host = unsafe {
        core::slice::from_raw_parts(coeffs.as_ptr().cast::<IcicleGoldilocksField>(), total_elements)
    };
    let mut input_aos = DeviceVec::<IcicleGoldilocksField>::malloc(total_elements);
    input_aos
        .copy_from_host(HostSlice::from_slice(input_host))
        .ok()?;
    let copy_in_ms = start_copy_in.elapsed().as_secs_f64() * 1000.0;

    let start_powers = Instant::now();
    let powers_cache = EXT_FFT_DEVICE_POWERS.get_or_init(|| Mutex::new(Vec::new()));
    let mut powers_cache = powers_cache.lock().ok()?;
    let shift_key = shift.to_canonical_u64();
    let fused_pack = !ext_fft_vecmul_pack_enabled();
    let cached_elements = if fused_pack { len } else { total_elements };
    let power_index = if let Some(index) = powers_cache
        .iter()
        .position(|(cached_len, cached_shift, _)| *cached_len == cached_elements && *cached_shift == shift_key)
    {
        index
    } else {
        let shift_powers = shift
            .powers()
            .take(len)
            .map(to_icicle)
            .collect::<Vec<_>>();
        let powers = if fused_pack {
            shift_powers
        } else {
            let mut duplicated_powers = Vec::with_capacity(total_elements);
            duplicated_powers.extend_from_slice(&shift_powers);
            duplicated_powers.extend_from_slice(&shift_powers);
            duplicated_powers
        };
        let mut device_powers = DeviceVec::<IcicleGoldilocksField>::malloc(cached_elements);
        device_powers
            .copy_from_host(HostSlice::from_slice(&powers))
            .ok()?;
        powers_cache.push((cached_elements, shift_key, device_powers));
        powers_cache.len() - 1
    };
    let powers_ms = start_powers.elapsed().as_secs_f64() * 1000.0;

    let start_pack = Instant::now();
    let mut shifted_input = DeviceVec::<IcicleGoldilocksField>::malloc(total_elements);
    if fused_pack {
        let status = unsafe {
            pearl_zk_ext_fft_deinterleave_mul_u64(
                input_aos.as_ptr().cast::<u64>(),
                powers_cache[power_index].2.as_ptr().cast::<u64>(),
                shifted_input.as_mut_ptr().cast::<u64>(),
                len,
            )
        };
        drop(powers_cache);
        if status != 0 {
            log::debug!(
                "CUDA extension FFT fused deinterleave/coset multiplication failed with status {status}; using CPU staging fallback"
            );
            return None;
        }
    } else {
        let status = unsafe {
            pearl_zk_ext_fft_deinterleave_u64(
                input_aos.as_ptr().cast::<u64>(),
                shifted_input.as_mut_ptr().cast::<u64>(),
                len,
            )
        };
        if status != 0 {
            log::debug!("CUDA extension FFT deinterleave failed with status {status}; using CPU staging fallback");
            return None;
        }

        let mut coset_input = DeviceVec::<IcicleGoldilocksField>::malloc(total_elements);
        let vec_ops_config = VecOpsConfig::default();
        mul_scalars(
            (&shifted_input).into_slice(),
            (&powers_cache[power_index].2).into_slice(),
            (&mut coset_input).into_slice_mut(),
            &vec_ops_config,
        )
        .ok()?;
        drop(powers_cache);
        shifted_input = coset_input;
    }
    let pack_ms = start_pack.elapsed().as_secs_f64() * 1000.0;

    let start_ntt = Instant::now();
    let mut output = DeviceVec::<IcicleGoldilocksField>::malloc(total_elements);
    let mut config = NTTConfig::<IcicleGoldilocksField>::default();
    config.batch_size = 2;
    config.ordering = Ordering::kNN;
    if let Some(algorithm) = ntt_algorithm() {
        config.ext.set_int(CUDA_NTT_ALGORITHM, algorithm as i32);
    }

    ntt(
        (&shifted_input).into_slice(),
        NTTDir::kForward,
        &config,
        (&mut output).into_slice_mut(),
    )
    .ok()?;
    let ntt_ms = start_ntt.elapsed().as_secs_f64() * 1000.0;

    let start_unpack = Instant::now();
    let mut output_aos = DeviceVec::<IcicleGoldilocksField>::malloc(total_elements);
    let status = unsafe {
        pearl_zk_ext_fft_interleave_u64(
            output.as_ptr().cast::<u64>(),
            output_aos.as_mut_ptr().cast::<u64>(),
            len,
        )
    };
    if status != 0 {
        log::debug!("CUDA extension FFT interleave failed with status {status}; using CPU staging fallback");
        return None;
    }
    let unpack_ms = start_unpack.elapsed().as_secs_f64() * 1000.0;

    let start_copy_out = Instant::now();
    let mut values = vec![QuadraticExtension([GoldilocksField::ZERO; 2]); len];
    let values_host = unsafe {
        core::slice::from_raw_parts_mut(
            values.as_mut_ptr().cast::<IcicleGoldilocksField>(),
            total_elements,
        )
    };
    output_aos
        .copy_to_host(HostSlice::from_mut_slice(values_host))
        .ok()?;
    let copy_out_ms = start_copy_out.elapsed().as_secs_f64() * 1000.0;

    if log_enabled() {
        eprintln!("pearl_zk_icicle_ext_fft_device_pack len={len} elements={total_elements}");
    }
    if timing {
        let total_ms = start_total.elapsed().as_secs_f64() * 1000.0;
        let pack_mode = if fused_pack { "fused" } else { "vecmul" };
        eprintln!(
            "pearl_zk_icicle_ext_fft_device_timing mode={pack_mode} len={len} elements={total_elements} domain_ms={domain_ms:.3} copy_in_ms={copy_in_ms:.3} powers_ms={powers_ms:.3} pack_ms={pack_ms:.3} ntt_ms={ntt_ms:.3} unpack_ms={unpack_ms:.3} copy_out_ms={copy_out_ms:.3} total_ms={total_ms:.3}",
        );
    }

    let values = unsafe {
        core::mem::transmute::<
            Vec<QuadraticExtension<GoldilocksField>>,
            Vec<F::Extension>,
        >(values)
    };
    Some(PolynomialValues::new(values))
}

pub(crate) fn try_coset_fft_ext2<F, const D: usize>(
    coeffs: &PolynomialCoeffs<F::Extension>,
    shift: F,
) -> Option<PolynomialValues<F::Extension>>
where
    F: Field + Extendable<D>,
{
    if !ext_fft_enabled()
        || D != 2
        || !is_goldilocks::<F>()
        || coeffs.coeffs.is_empty()
        || core::mem::size_of::<F::Extension>()
            != core::mem::size_of::<QuadraticExtension<GoldilocksField>>()
        || core::mem::align_of::<F::Extension>()
            != core::mem::align_of::<QuadraticExtension<GoldilocksField>>()
    {
        return None;
    }

    let len = coeffs.len();
    if !len.is_power_of_two() {
        return None;
    }
    let total_elements = len.checked_mul(2)?;
    if total_elements < ext_fft_min_elements() {
        return None;
    }
    if !backend_ready() {
        return None;
    }

    let timing = timing_enabled();
    let start_total = Instant::now();
    let start_domain = Instant::now();
    init_domain(len)?;
    let domain_ms = start_domain.elapsed().as_secs_f64() * 1000.0;

    let shift = as_goldilocks(shift)?;
    let start_pack = Instant::now();
    let coeffs = unsafe {
        core::slice::from_raw_parts(
            coeffs
                .coeffs
                .as_ptr()
                .cast::<QuadraticExtension<GoldilocksField>>(),
            len,
        )
    };

    #[cfg(pearl_zk_cuda)]
    if ext_fft_device_pack_enabled() {
        if let Some(values) =
            try_coset_fft_ext2_device_pack::<F, D>(coeffs, len, shift, domain_ms, start_total, timing)
        {
            return Some(values);
        }
    }

    let shift_powers = shift.powers().take(len).collect::<Vec<_>>();
    let mut input = vec![IcicleGoldilocksField::zero(); total_elements];
    for i in 0..len {
        let shifted = coeffs[i].0;
        let power = shift_powers[i];
        input[i] = to_icicle(shifted[0] * power);
        input[len + i] = to_icicle(shifted[1] * power);
    }
    let pack_ms = start_pack.elapsed().as_secs_f64() * 1000.0;

    let start_ntt = Instant::now();
    let mut output = vec![IcicleGoldilocksField::zero(); total_elements];
    let mut config = NTTConfig::<IcicleGoldilocksField>::default();
    config.batch_size = 2;
    config.ordering = Ordering::kNN;
    if let Some(algorithm) = ntt_algorithm() {
        config.ext.set_int(CUDA_NTT_ALGORITHM, algorithm as i32);
    }

    ntt(
        input.into_slice(),
        NTTDir::kForward,
        &config,
        output.into_slice_mut(),
    )
    .ok()?;
    let ntt_ms = start_ntt.elapsed().as_secs_f64() * 1000.0;

    let start_unpack = Instant::now();
    let output = unsafe {
        core::slice::from_raw_parts(output.as_ptr().cast::<GoldilocksField>(), output.len())
    };
    let mut values = Vec::with_capacity(len);
    for i in 0..len {
        values.push(QuadraticExtension([output[i], output[len + i]]));
    }
    let values = unsafe {
        core::mem::transmute::<
            Vec<QuadraticExtension<GoldilocksField>>,
            Vec<F::Extension>,
        >(values)
    };
    let unpack_ms = start_unpack.elapsed().as_secs_f64() * 1000.0;

    if log_enabled() {
        eprintln!("pearl_zk_icicle_ext_fft len={len} elements={total_elements}");
    }
    if timing {
        let total_ms = start_total.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "pearl_zk_icicle_ext_fft_timing len={len} elements={total_elements} domain_ms={domain_ms:.3} pack_ms={pack_ms:.3} ntt_ms={ntt_ms:.3} unpack_ms={unpack_ms:.3} total_ms={total_ms:.3}",
        );
    }

    Some(PolynomialValues::new(values))
}

#[cfg(test)]
mod tests {
    use super::*;
    use plonky2_field::polynomial::PolynomialCoeffs;

    #[test]
    fn icicle_lde_matches_cpu() {
        let local_backend =
            "../../artifacts/external/icicle-release/cuda122/icicle/lib/backend";
        if std::env::var_os("ICICLE_BACKEND_INSTALL_DIR").is_none()
            && std::path::Path::new(local_backend).exists()
        {
            std::env::set_var("ICICLE_BACKEND_INSTALL_DIR", local_backend);
        }
        std::env::set_var("PEARL_ZK_ICICLE_NTT", "1");

        let polynomials = (0..5)
            .map(|p| {
                PolynomialCoeffs::new(
                    (0..256)
                        .map(|i| GoldilocksField::from_canonical_usize(i * 17 + p * 31))
                        .collect(),
                )
            })
            .collect::<Vec<_>>();

        let Some(gpu) = try_lde_values::<GoldilocksField>(&polynomials, 2, false) else {
            eprintln!("Skipping ICICLE LDE test; CUDA backend is unavailable");
            return;
        };
        let cpu = polynomials
            .iter()
            .map(|p| {
                p.lde(2)
                    .coset_fft_with_options(GoldilocksField::coset_shift(), Some(2), None)
                    .values
            })
            .collect::<Vec<_>>();

        assert_eq!(gpu, cpu);
    }

    #[test]
    fn icicle_quadratic_ext_coset_fft_matches_cpu() {
        let local_backend =
            "../../artifacts/external/icicle-release/cuda122/icicle/lib/backend";
        if std::env::var_os("ICICLE_BACKEND_INSTALL_DIR").is_none()
            && std::path::Path::new(local_backend).exists()
        {
            std::env::set_var("ICICLE_BACKEND_INSTALL_DIR", local_backend);
        }
        std::env::set_var("PEARL_ZK_ICICLE_EXT_FFT", "1");

        let coeffs = PolynomialCoeffs::new(
            (0..256)
                .map(|i| {
                    QuadraticExtension([
                        GoldilocksField::from_canonical_usize(i * 17 + 3),
                        GoldilocksField::from_canonical_usize(i * 31 + 9),
                    ])
                })
                .collect::<Vec<_>>(),
        );
        let shift = GoldilocksField::coset_shift();

        let Some(gpu) = try_coset_fft_ext2::<GoldilocksField, 2>(&coeffs, shift) else {
            eprintln!("Skipping ICICLE quadratic extension FFT test; CUDA backend is unavailable");
            return;
        };
        let cpu = coeffs.coset_fft(shift.into());
        assert_eq!(gpu, cpu);
    }

}
