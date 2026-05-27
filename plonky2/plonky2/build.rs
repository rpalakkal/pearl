use std::env;

fn main() {
    println!("cargo:rustc-check-cfg=cfg(pearl_zk_cuda)");
    println!("cargo:rerun-if-changed=src/gpu/transpose.cu");
    println!("cargo:rerun-if-changed=src/gpu/blake3_27.cu");
    println!("cargo:rerun-if-changed=src/gpu/ext_fft.cu");
    println!("cargo:rerun-if-env-changed=PEARL_BUILD_ZK_CUDA");
    println!("cargo:rerun-if-env-changed=NVCC");

    if env::var("PEARL_BUILD_ZK_CUDA").ok().as_deref() != Some("1") {
        return;
    }

    let nvcc = env::var("NVCC")
        .map(which::which)
        .unwrap_or_else(|_| which::which("nvcc"));
    if nvcc.is_err() {
        println!("cargo:warning=nvcc not found; PEARL_ZK_GPU_TRANSPOSE will use CPU fallback");
        return;
    }

    cc::Build::new()
        .cuda(true)
        .flag("-O3")
        .flag("-arch=sm_90")
        .file("src/gpu/transpose.cu")
        .compile("pearl_zk_cuda_transpose");

    cc::Build::new()
        .cuda(true)
        .flag("-O3")
        .flag("-arch=sm_90")
        .file("src/gpu/blake3_27.cu")
        .compile("pearl_zk_cuda_blake3_27");

    cc::Build::new()
        .cuda(true)
        .flag("-O3")
        .flag("-arch=sm_90")
        .file("src/gpu/ext_fft.cu")
        .compile("pearl_zk_cuda_ext_fft");

    println!("cargo:rustc-cfg=pearl_zk_cuda");
}
