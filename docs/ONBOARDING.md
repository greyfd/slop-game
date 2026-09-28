# Developer Onboarding

Welcome to the project! This engine relies on bleeding-edge web APIs that are not yet available in stable browser releases. Follow these instructions to set up your environment.

## 1. Required Browser
You must use **Chrome Canary** or **Edge Canary** for development. Standard browsers will not work.

## 2. Experimental Flags
Navigate to `chrome://flags` (or `edge://flags`) and enable the following experimental features:

1. **HTML-in-Canvas (`#canvas-draw-element`)**: 
   - Search for `#canvas-draw-element` and set it to **Enabled**.
   - This unlocks the `drawElementImage` API needed to render DOM UI directly into the WebGPU context.
2. **WebNN API (`#enable-webnn-api`)**:
   - Search for `#enable-webnn-api` and set it to **Enabled**.
   - This unlocks the Neural Processing Unit (NPU) for executing local Small Language Models (SLMs) in the AI Worker.

## 3. Development Server
Run the project using `npm run dev`. Our `vite.config.ts` automatically injects the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers, which are strictly required to use `SharedArrayBuffer` for zero-copy state transfers.
