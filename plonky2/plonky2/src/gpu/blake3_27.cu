#include <cuda_runtime.h>
#include <stddef.h>
#include <stdint.h>

namespace {

__global__ void truncate_32_to_27_kernel(
    const uint8_t* __restrict__ input,
    uint8_t* __restrict__ output,
    size_t count
) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    size_t total = count * 27;
    if (idx >= total) {
        return;
    }

    size_t digest_idx = idx / 27;
    size_t byte_idx = idx - digest_idx * 27;
    output[idx] = input[digest_idx * 32 + byte_idx];
}

__global__ void store_27_layer_layout_kernel(
    const uint8_t* __restrict__ layer,
    uint8_t* __restrict__ digests,
    size_t nodes,
    size_t subtree_height,
    size_t layer_height
) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    size_t total = nodes * 27;
    if (idx >= total) {
        return;
    }

    size_t node_idx = idx / 27;
    size_t byte_idx = idx - node_idx * 27;
    size_t local_bits = subtree_height - layer_height;
    size_t cap_idx = node_idx >> local_bits;
    size_t local_mask = (static_cast<size_t>(1) << local_bits) - 1;
    size_t local_node_idx = node_idx & local_mask;
    size_t pair_index = local_node_idx >> 1;
    size_t parity = local_node_idx & 1;
    size_t siblings_index =
        (pair_index << (layer_height + 1)) + ((static_cast<size_t>(1) << layer_height) - 1);
    size_t tree_len = 2 * ((static_cast<size_t>(1) << subtree_height) - 1);
    size_t digest_index = cap_idx * tree_len + 2 * siblings_index + parity;

    digests[digest_index * 27 + byte_idx] = layer[node_idx * 27 + byte_idx];
}

}  // namespace

extern "C" int pearl_zk_blake3_truncate_32_to_27(
    const uint8_t* input,
    uint8_t* output,
    size_t count
) {
    if (count == 0) {
        return 0;
    }

    const int threads = 256;
    size_t total = count * 27;
    int blocks = static_cast<int>((total + threads - 1) / threads);
    truncate_32_to_27_kernel<<<blocks, threads>>>(input, output, count);
    cudaError_t err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    return static_cast<int>(err);
}

extern "C" int pearl_zk_blake3_store_27_layer_layout(
    const uint8_t* layer,
    uint8_t* digests,
    size_t nodes,
    size_t subtree_height,
    size_t layer_height
) {
    if (nodes == 0 || layer_height >= subtree_height) {
        return 1;
    }

    const int threads = 256;
    size_t total = nodes * 27;
    int blocks = static_cast<int>((total + threads - 1) / threads);
    store_27_layer_layout_kernel<<<blocks, threads>>>(layer, digests, nodes, subtree_height, layer_height);
    cudaError_t err = cudaGetLastError();
    if (err == cudaSuccess) {
        err = cudaDeviceSynchronize();
    }
    return static_cast<int>(err);
}
