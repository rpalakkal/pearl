#include <cuda_runtime.h>
#include <stdint.h>
#include <stddef.h>

namespace {

constexpr int TILE_DIM = 32;
constexpr int BLOCK_ROWS = 8;

__global__ void transpose_u64_kernel(
    const uint64_t* __restrict__ input,
    uint64_t* __restrict__ output,
    size_t rows,
    size_t cols
) {
    __shared__ uint64_t tile[TILE_DIM][TILE_DIM + 1];

    size_t x = blockIdx.x * TILE_DIM + threadIdx.x;
    size_t y = blockIdx.y * TILE_DIM + threadIdx.y;

    #pragma unroll
    for (int j = 0; j < TILE_DIM; j += BLOCK_ROWS) {
        if (x < cols && y + j < rows) {
            tile[threadIdx.y + j][threadIdx.x] = input[(y + j) * cols + x];
        }
    }

    __syncthreads();

    x = blockIdx.y * TILE_DIM + threadIdx.x;
    y = blockIdx.x * TILE_DIM + threadIdx.y;

    #pragma unroll
    for (int j = 0; j < TILE_DIM; j += BLOCK_ROWS) {
        if (x < rows && y + j < cols) {
            output[(y + j) * rows + x] = tile[threadIdx.x][threadIdx.y + j];
        }
    }
}

}  // namespace

extern "C" int pearl_zk_transpose_u64(
    const uint64_t* input,
    uint64_t* output,
    size_t rows,
    size_t cols
) {
    if (rows == 0 || cols == 0) {
        return 0;
    }

    const size_t total = rows * cols;
    uint64_t* d_input = nullptr;
    uint64_t* d_output = nullptr;

    cudaError_t err = cudaMalloc(&d_input, total * sizeof(uint64_t));
    if (err != cudaSuccess) {
        return static_cast<int>(err);
    }
    err = cudaMalloc(&d_output, total * sizeof(uint64_t));
    if (err != cudaSuccess) {
        cudaFree(d_input);
        return static_cast<int>(err);
    }

    err = cudaMemcpy(d_input, input, total * sizeof(uint64_t), cudaMemcpyHostToDevice);
    if (err != cudaSuccess) {
        cudaFree(d_output);
        cudaFree(d_input);
        return static_cast<int>(err);
    }

    dim3 block(TILE_DIM, BLOCK_ROWS);
    dim3 grid((cols + TILE_DIM - 1) / TILE_DIM, (rows + TILE_DIM - 1) / TILE_DIM);
    transpose_u64_kernel<<<grid, block>>>(d_input, d_output, rows, cols);
    err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    if (err == cudaSuccess) {
        err = cudaMemcpy(output, d_output, total * sizeof(uint64_t), cudaMemcpyDeviceToHost);
    }

    cudaFree(d_output);
    cudaFree(d_input);
    return static_cast<int>(err);
}
