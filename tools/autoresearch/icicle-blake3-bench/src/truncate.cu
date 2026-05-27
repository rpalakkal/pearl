#include <cuda_runtime.h>
#include <stddef.h>
#include <stdint.h>

namespace {

__global__ void truncate_32_to_n_kernel(
    const uint8_t* __restrict__ input,
    uint8_t* __restrict__ output,
    size_t count,
    size_t n
) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    size_t total = count * n;
    if (idx >= total) {
        return;
    }

    size_t digest_idx = idx / n;
    size_t byte_idx = idx - digest_idx * n;
    output[idx] = input[digest_idx * 32 + byte_idx];
}

}  // namespace

extern "C" int pearl_blake3_truncate_32_to_n(
    const uint8_t* input,
    uint8_t* output,
    size_t count,
    size_t n
) {
    if (count == 0 || n == 0 || n > 32) {
        return 1;
    }

    const int threads = 256;
    size_t total = count * n;
    int blocks = static_cast<int>((total + threads - 1) / threads);
    truncate_32_to_n_kernel<<<blocks, threads>>>(input, output, count, n);
    cudaError_t err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    return static_cast<int>(err);
}
