#include <cuda_runtime.h>
#include <stddef.h>
#include <stdint.h>

namespace {

__global__ void deinterleave_ext2_kernel(
    const uint64_t* __restrict__ input_aos,
    uint64_t* __restrict__ output_soa,
    size_t len
) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= len) {
        return;
    }

    output_soa[idx] = input_aos[2 * idx];
    output_soa[len + idx] = input_aos[2 * idx + 1];
}

__device__ __forceinline__ uint64_t reduce_goldilocks(unsigned __int128 value) {
    constexpr uint64_t GOLDILOCKS_MODULUS = 0xffffffff00000001ULL;
    constexpr unsigned __int128 MODULUS_128 =
        static_cast<unsigned __int128>(GOLDILOCKS_MODULUS);

    uint64_t lo = static_cast<uint64_t>(value);
    uint64_t hi = static_cast<uint64_t>(value >> 64);
    unsigned __int128 reduced =
        static_cast<unsigned __int128>(lo) +
        (static_cast<unsigned __int128>(hi) << 32) -
        static_cast<unsigned __int128>(hi);

    lo = static_cast<uint64_t>(reduced);
    hi = static_cast<uint64_t>(reduced >> 64);
    reduced =
        static_cast<unsigned __int128>(lo) +
        (static_cast<unsigned __int128>(hi) << 32) -
        static_cast<unsigned __int128>(hi);

    while (reduced >= MODULUS_128) {
        reduced -= MODULUS_128;
    }
    return static_cast<uint64_t>(reduced);
}

__global__ void deinterleave_mul_ext2_kernel(
    const uint64_t* __restrict__ input_aos,
    const uint64_t* __restrict__ powers,
    uint64_t* __restrict__ output_soa,
    size_t len
) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= len) {
        return;
    }

    uint64_t power = powers[idx];
    output_soa[idx] = reduce_goldilocks(
        static_cast<unsigned __int128>(input_aos[2 * idx]) *
        static_cast<unsigned __int128>(power)
    );
    output_soa[len + idx] = reduce_goldilocks(
        static_cast<unsigned __int128>(input_aos[2 * idx + 1]) *
        static_cast<unsigned __int128>(power)
    );
}

__global__ void interleave_ext2_kernel(
    const uint64_t* __restrict__ input_soa,
    uint64_t* __restrict__ output_aos,
    size_t len
) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= len) {
        return;
    }

    output_aos[2 * idx] = input_soa[idx];
    output_aos[2 * idx + 1] = input_soa[len + idx];
}

}  // namespace

extern "C" int pearl_zk_ext_fft_deinterleave_u64(
    const uint64_t* input_aos,
    uint64_t* output_soa,
    size_t len
) {
    if (len == 0) {
        return 0;
    }

    const int threads = 256;
    int blocks = static_cast<int>((len + threads - 1) / threads);
    deinterleave_ext2_kernel<<<blocks, threads>>>(input_aos, output_soa, len);
    cudaError_t err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    return static_cast<int>(err);
}

extern "C" int pearl_zk_ext_fft_deinterleave_mul_u64(
    const uint64_t* input_aos,
    const uint64_t* powers,
    uint64_t* output_soa,
    size_t len
) {
    if (len == 0) {
        return 0;
    }

    const int threads = 256;
    int blocks = static_cast<int>((len + threads - 1) / threads);
    deinterleave_mul_ext2_kernel<<<blocks, threads>>>(input_aos, powers, output_soa, len);
    cudaError_t err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    return static_cast<int>(err);
}

extern "C" int pearl_zk_ext_fft_interleave_u64(
    const uint64_t* input_soa,
    uint64_t* output_aos,
    size_t len
) {
    if (len == 0) {
        return 0;
    }

    const int threads = 256;
    int blocks = static_cast<int>((len + threads - 1) / threads);
    interleave_ext2_kernel<<<blocks, threads>>>(input_soa, output_aos, len);
    cudaError_t err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    return static_cast<int>(err);
}
