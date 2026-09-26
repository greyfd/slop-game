# docs/wgsl_alignment.md (Alignment Rules)
WebGPU requires strict 16-byte alignment for uniform buffers and structured data.

## Rules
1. vec3<f32> takes 12 bytes but requires 16 bytes of alignment. You must manually add a 4-byte padding field immediately after it in your Rust/C++ structs to match the WGSL memory footprint.
2. Arrays of structs require the base struct size to be a multiple of 16 bytes.
3. Always use @size and @align attributes in WGSL to explicitly declare your assumptions so they fail at compile time if mismatched.

## Example
```wgsl
struct Transform {
    @align(16) position: vec3<f32>,
    // 4 bytes of implicit padding exist here
    @align(16) rotation: vec4<f32>,
}