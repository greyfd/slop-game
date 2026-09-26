# structure.md (File Structure & Subsystem Setup)

## 1. Directory Tree
```text
/
├── vite.config.ts           # COOP/COEP header configuration
├── index.html               # Entry point, Canvas, and PointerLock UI
├── package.json
├── Cargo.toml               # Rust workspace definition
│
├── structure.md             # This file (File Structure & Subsystem Setup)
│
├── /docs                    # Antigravity Agent Ledger
│   ├── memory_map.md        # Explicit SAB byte offsets
│   └── wgsl_alignment.md    # 16-byte alignment rules
│
├── /rust-engine             # The Simulation Core (WebAssembly)
│   ├── Cargo.toml
│   └── /src
│       ├── lib.rs           # wasm-bindgen FFI entry points
│       ├── memory.rs        # SharedArrayBuffer casting and struct mappings
│       ├── ecs.rs           # Entity Component System (Data-Oriented)
│       ├── physics.rs       # AABB collision and gravity
│       ├── player.rs        # 1st-Person Character Controller logic
│       └── terrain.rs       # Procedural chunk generation (Heightmaps)
│
├── /src                     # The Presentation Layer (TypeScript)
│   ├── main.ts              # UI/Input setup and Worker initialization
│   │
│   ├── /shared              # Memory Contracts
│   │   └── memory_map.ts    # JS DataViews mapping to rust-engine/memory.rs
│   │
│   ├── /workers             # Background Threads
│   │   ├── engine.worker.ts # Loads rust-engine.wasm, manages game loop
│   │   └── ai.worker.ts     # WebNN SLM execution
│   │
│   ├── /audio               # High-Priority Audio
│   │   └── hrtf.worklet.ts  # Spatial audio processor
│   │
│   └── /render              # WebGPU Pipeline
│       ├── renderer.ts      # WebGPU Device/Queue setup
│       ├── pipeline.ts      # Bind groups and render passes
│       └── /shaders
│           ├── common.wgsl  # Shared structs (aligned to memory_map)
│           ├── terrain.wgsl # Terrain rendering and lighting
│           └── post.wgsl    # Full-screen passes (bloom, tonemapping)
```
