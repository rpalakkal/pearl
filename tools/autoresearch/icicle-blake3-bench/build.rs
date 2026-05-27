use std::env;

fn main() {
    println!("cargo:rustc-check-cfg=cfg(pearl_icicle_blake3_bench_cuda)");
    println!("cargo:rerun-if-changed=src/truncate.cu");
    println!("cargo:rerun-if-env-changed=NVCC");

    let nvcc = env::var("NVCC")
        .map(which::which)
        .unwrap_or_else(|_| which::which("nvcc"));
    if nvcc.is_err() {
        println!("cargo:warning=nvcc not found; Blake3-27 CUDA Merkle benchmark unavailable");
        return;
    }

    cc::Build::new()
        .cuda(true)
        .flag("-O3")
        .flag("-arch=sm_90")
        .file("src/truncate.cu")
        .compile("icicle_blake3_bench_cuda");

    println!("cargo:rustc-cfg=pearl_icicle_blake3_bench_cuda");
}
