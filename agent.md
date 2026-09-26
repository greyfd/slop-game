
## Core Directives
1. Zero Garbage Collection: The render loop and physics loop must not trigger JavaScript garbage collection. Use pre-allocated object pools and mutate SharedArrayBuffer directly.
2. State Synchronization: Never transfer game state via postMessage. All entity state must live in SharedArrayBuffer and be synchronized using Atomics.
3. Graphics API: Use WebGPU exclusively. Never use WebGL or CanvasRenderingContext2D for 3D rendering.
4. File I/O: Inside the Engine Worker, only use the synchronous FileSystemSyncAccessHandle for OPFS reads.
5. Memory Alignment: Rust or C++ memory layouts must exactly match WGSL memory layouts.


## Required Context Files
Before modifying architecture, you must read:
* docs/memory_map.md
* docs/wgsl_alignment.md