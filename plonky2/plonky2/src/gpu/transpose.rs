use core::any::TypeId;

use crate::field::extension::Extendable;
use crate::field::goldilocks_field::GoldilocksField;
use crate::hash::hash_types::RichField;

unsafe extern "C" {
    fn pearl_zk_transpose_u64(
        input: *const u64,
        output: *mut u64,
        rows: usize,
        cols: usize,
    ) -> i32;
}

pub(crate) fn env_enabled() -> bool {
    std::env::var_os("PEARL_ZK_GPU_TRANSPOSE").is_some_and(|value| value != "0")
}

fn min_elements() -> usize {
    std::env::var("PEARL_ZK_GPU_TRANSPOSE_MIN_ELEMENTS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

pub(crate) fn try_transpose_lde<F, const D: usize>(values: &[Vec<F>]) -> Option<Vec<Vec<F>>>
where
    F: RichField + Extendable<D>,
{
    if !env_enabled() || TypeId::of::<F>() != TypeId::of::<GoldilocksField>() {
        return None;
    }
    if values.is_empty() {
        return Some(Vec::new());
    }

    let rows = values.len();
    let cols = values[0].len();
    if cols == 0 || !values.iter().all(|row| row.len() == cols) {
        return None;
    }

    let total = rows.checked_mul(cols)?;
    if total < min_elements() {
        return None;
    }

    if std::env::var_os("PEARL_ZK_GPU_TRANSPOSE_LOG").is_some() {
        eprintln!("pearl_zk_cuda_transpose rows={rows} cols={cols} elements={total}");
    }

    let mut input = Vec::with_capacity(total);
    for row in values {
        let row_words = unsafe { core::slice::from_raw_parts(row.as_ptr().cast::<u64>(), cols) };
        input.extend_from_slice(row_words);
    }

    let mut output = vec![0u64; total];
    let status = unsafe {
        pearl_zk_transpose_u64(input.as_ptr(), output.as_mut_ptr(), rows, cols)
    };
    if status != 0 {
        log::debug!("CUDA LDE transpose failed with status {status}; using CPU fallback");
        return None;
    }

    let transposed = output
        .chunks_exact(rows)
        .map(|row| row.iter().copied().map(GoldilocksField).collect::<Vec<_>>())
        .collect::<Vec<_>>();

    Some(unsafe { core::mem::transmute::<Vec<Vec<GoldilocksField>>, Vec<Vec<F>>>(transposed) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::field::types::Field;
    use crate::util::transpose;

    #[test]
    fn cuda_transpose_matches_cpu() {
        std::env::set_var("PEARL_ZK_GPU_TRANSPOSE", "1");
        let values = (0..7)
            .map(|r| {
                (0..33)
                    .map(|c| GoldilocksField::from_canonical_usize(r * 1000 + c))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        let gpu = try_transpose_lde::<GoldilocksField, 2>(&values).unwrap();
        assert_eq!(gpu, transpose(&values));
    }
}
