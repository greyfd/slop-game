# spec.md (System Architecture & Integration Specification)

## 1. Executive Summary
This document defines the architectural blueprint for a zero-copy, multi-threaded browser game engine. The system leverages WebAssembly (WASM), WebGPU, and background threads to push browser performance to near-native limits for a 3D first-person RPG.

## 2. Core Technologies
*   **Engine & Physics:** Rust or C++ compiled to WebAssembly, running in a dedicated Web Worker.
*   **Memory Management:** `SharedArrayBuffer` synchronized via JavaScript `Atomics`.
*   **Rendering:** WebGPU via the Main Thread.
*   **User Interface:** HTML-in-Canvas API (using `drawElementImage`) projected into WebGPU.
*   **Artificial Intelligence:** WebNN API for local Small Language Models (SLMs) and NPC logic.
*   **Spatial Audio:** `AudioWorklet` with WASM-driven Head-Related Transfer Functions (HRTF).
*   **Asset Storage:** Origin Private File System (OPFS) with `FileSystemSyncAccessHandle`.

## 3. Thread Boundaries & Subsystem Integration

### A. The Core Memory (SharedArrayBuffer)
The engine avoids JavaScript garbage collection by pre-allocating a single `SharedArrayBuffer`. This acts as the universal source of truth. All threads receive a pointer to this buffer upon initialization and cast it to typed arrays (e.g., `Float32Array`). 

### B. The Engine Worker (Simulation & I/O)
This background Web Worker executes the WASM binary containing the game loop, physics, and collision detection. 
*   **Integration:** It runs on a fixed time step (e.g., 60 ticks per second) and writes updated transform matrices directly to the `SharedArrayBuffer`. 
*   **File I/O:** When large assets (Gaussian splat data, high-res textures) are needed, this worker uses the synchronous `FileSystemSyncAccessHandle` to stream data from OPFS directly into WASM linear memory, completely avoiding Main Thread blockages.

### C. The Main Thread (Presentation Layer)
The JavaScript main thread is strictly reserved for orchestrating API calls that cannot be offloaded to workers. It runs at the monitor's refresh rate via `requestAnimationFrame`.
*   **Integration:** It reads the latest entity matrices from the `SharedArrayBuffer` using zero-copy data views. It then writes these matrices to WebGPU buffers (`device.queue.writeBuffer`) and dispatches the rendering passes.
*   **UI Projection:** DOM elements are rendered directly into the WebGPU context using the HTML-in-Canvas `drawElementImage` primitive, keeping the UI accessible and fully styled with CSS while remaining part of the 3D scene.

### D. The AI Worker (WebNN)
An isolated Web Worker manages local NPC intelligence and dialogue. 
*   **Integration:** It loads ONNX model weights from OPFS and utilizes the WebNN API to execute inference directly on the device's Neural Processing Unit (NPU). It writes behavioral state changes (e.g., pathfinding targets or animation states) back to the `SharedArrayBuffer`.

### E. The AudioWorklet (Spatial Acoustics)
A dedicated Web Audio API thread running its own WASM module for spatial audio processing.
*   **Integration:** It reads the player's camera position and audio source coordinates from the `SharedArrayBuffer`. The WASM module computes the HRTF reverberations and outputs the audio samples. The `SharedArrayBuffer` acts as a ring-buffer to bypass standard Web Audio node limitations and ensure crackle-free delivery.

## 4. The Data Flow Pipeline (The Loop)
1.  **Tick Start:** Engine Worker locks necessary memory regions using `Atomics`.
2.  **Simulation:** Engine Worker calculates physics, updates bounding boxes, and writes new 4x4 transform matrices to the `SharedArrayBuffer`.
3.  **NPC Update:** AI Worker computes SLM outputs via WebNN and writes state changes to the `SharedArrayBuffer`.
4.  **Audio Frame:** `AudioWorklet` reads the updated spatial coordinates from the `SharedArrayBuffer` and processes the next audio chunk.
5.  **Render Frame:** Main Thread reads the latest transforms from the `SharedArrayBuffer`, binds them to the WebGPU command encoder, updates the HTML-in-Canvas DOM matrices, and dispatches the frame to the GPU.