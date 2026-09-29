# ISSUE-002: Refactor to Shared WASM Linear Memory

**Status**: Deferred  
**Priority**: Low (future optimization)  
**Blocked By**: wasm-bindgen thread support stabilization  

---

## Current Architecture

The engine allocates a `SharedArrayBuffer` in JavaScript (`new SharedArrayBuffer(size)`), passes it to the Rust/WASM engine via `init(sab: JsValue)`, and Rust accesses it through `js_sys` typed array views (`Int32Array`, `Float32Array`, etc.). WASM linear memory is private and separate -- only Rust-internal data lives there.

This works well and is the battle-tested pattern for Rust/WASM shared-memory architectures. All ECS component data, frame state, input, and terrain staging live in the external SAB, accessed via codegen'd byte offsets.

## Desired Future State

Eliminate the external SAB entirely. Make WASM linear memory itself a `SharedArrayBuffer` so that:

1. Rust structs allocated on the WASM heap are directly readable by JavaScript `TypedArray` views over `wasm.memory.buffer`.
2. No manual offset management -- Rust owns the layout, exports pointers, and JS maps views at those pointers.
3. True zero-copy: no `set_index` / `get_index` calls through `js_sys` -- JS reads/writes the same backing memory Rust does.

## What Is Required

### Compiler Flags

```toml
# .cargo/config.toml (in the rust-engine directory)
[target.wasm32-unknown-unknown]
rustflags = [
    "-C", "target-feature=+atomics,+bulk-memory",
    "-C", "link-args=--shared-memory --import-memory",
]

[unstable]
build-std = ["panic_abort", "std"]
```

- `+atomics`: Enables `memory.atomic.*` WASM instructions so `core::sync::atomic::AtomicU32` etc. compile to hardware atomics instead of being no-ops.
- `+bulk-memory`: Enables `memory.copy` and `memory.fill` instructions (required by the atomics proposal).
- `--shared-memory`: Tells the linker to emit the memory as `(memory (export "memory") 1 <max> shared)`. This is what makes `wasm.memory.buffer` a `SharedArrayBuffer`.
- `--import-memory`: Required so the host (JS) can provide the memory, ensuring all threads share the same backing store.
- `build-std`: Required because the pre-compiled `std` for `wasm32-unknown-unknown` does not include atomics. We must recompile `std` from source with these features.

### JavaScript Side

```typescript
// Instead of allocating a SAB ourselves, we import WASM memory:
const memory = new WebAssembly.Memory({
    initial: 256,     // 16 MB
    maximum: 16384,   // 1 GB
    shared: true,
});

// memory.buffer is now a SharedArrayBuffer
// Pass it to workers:
worker.postMessage({ type: 'INIT', memory });

// Map views directly:
const int32 = new Int32Array(memory.buffer);
const float32 = new Float32Array(memory.buffer);
```

### Rust Side

```rust
// Rust allocates normally -- all heap allocations land in linear memory.
// Export a pointer to the ECS arrays:
#[wasm_bindgen]
pub fn get_position_array_ptr() -> *const f32 {
    unsafe { WORLD.positions.as_ptr() }
}

#[wasm_bindgen]
pub fn get_position_array_len() -> usize {
    unsafe { WORLD.positions.len() }
}
```

```typescript
// JS side:
const ptr = wasm.get_position_array_ptr();
const len = wasm.get_position_array_len();
const positions = new Float32Array(wasm.memory.buffer, ptr, len);
// `positions` is a live zero-copy view over Rust's heap allocation
```

### Worker Threading

Each worker would instantiate the WASM module with the same shared `WebAssembly.Memory`:

```typescript
// In worker:
const instance = await WebAssembly.instantiate(wasmBytes, {
    env: { memory: sharedMemory },
});
```

This enables true multi-threaded WASM where multiple workers run WASM instances that share the same linear memory, using `Atomics` for synchronization.

## Why This Is Deferred

1. **wasm-bindgen support is incomplete.** As of late 2026, `wasm-bindgen` does not fully support `--shared-memory` + `--import-memory` in a way that integrates cleanly with its generated JS glue. The `wasm-pack` toolchain assumes exclusive ownership of memory.
2. **`build-std` requires nightly.** Recompiling `std` with atomics requires the Rust nightly toolchain and the `build-std` unstable feature. This adds CI/CD complexity.
3. **Memory growth semantics.** When WASM memory grows (`memory.grow`), all existing `TypedArray` views are detached. With shared memory across multiple threads, this requires careful coordination. The current external SAB has a fixed size and avoids this entirely.
4. **The current approach works.** The external SAB with codegen'd offsets is proven, stable, and already handles all the data sharing we need. The performance difference (indirect `js_sys` view access vs direct `TypedArray` indexing) is measurable but not a bottleneck.

## Migration Path

When wasm-bindgen stabilizes shared memory support:

1. Add `.cargo/config.toml` with the flags above.
2. Switch to nightly toolchain with `rust-toolchain.toml`.
3. Replace `js_sys` typed array access in `memory.rs` with direct pointer casts over WASM linear memory.
4. Update `codegen.js` to emit pointer-export functions instead of byte-offset constants.
5. Update all JS consumers to use `new Float32Array(wasm.memory.buffer, ptr, len)` instead of SAB views.
6. Remove the external SAB allocation from `main.ts`.
