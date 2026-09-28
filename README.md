# WebGPU Rust/Wasm Engine

A high-performance, browser-based game engine written in Rust (compiled to WebAssembly) and TypeScript.

## Project Description

This project aims to push the limits of browser performance by leveraging modern web standards:
- **Zero Garbage Collection**: The render and physics loops avoid JavaScript garbage collection by using pre-allocated object pools and directly mutating memory.
- **Shared Memory**: All entity state resides in a `SharedArrayBuffer` and is synchronized between threads using `Atomics`, avoiding the overhead of `postMessage`.
- **WebGPU Rendering**: Utilizes modern WebGPU APIs for hardware-accelerated 3D rendering with exact memory alignment between WGSL and Rust/C++.
- **Multithreading**: Offloads the simulation core, AI, and audio to Web Workers and AudioWorklets.
- **Rust / Wasm Core**: The simulation core (ECS, physics, 1st-person controller, procedural terrain) is written entirely in Rust.

## Architecture

- **`src/`**: The presentation layer (TypeScript, Web Workers, WebGPU render pipelines, and spatial audio).
- **`rust-engine/`**: The simulation core (Rust). Compiles to WebAssembly using `wasm-pack`.
- **`docs/`**: Documentation including memory mapping and WGSL alignment rules.

## Getting Started

### Prerequisites
- Node.js (v18+)
- Rust & Cargo
- `wasm-pack`

### Build & Run
```bash
npm install
npm run dev
```

The development server uses Vite and supports COOP/COEP headers necessary for `SharedArrayBuffer` functionality.
