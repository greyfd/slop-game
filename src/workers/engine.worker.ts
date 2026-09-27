/**
 * Engine Worker.
 *
 * Loads the Rust WASM module and runs the game loop at ~60 Hz.
 * Receives the SharedArrayBuffer from the main thread via postMessage.
 */

import wasmInit, { init as engineInit, tick as engineTick } from '../../pkg/rust_engine';
import { MainToWorkerMessage, WorkerToMainMessage } from '../shared/worker-messages';

let intervalId: number | undefined;
let lastTime = performance.now();

function setTickRate(hz: number) {
    if (intervalId !== undefined) {
        clearInterval(intervalId);
    }
    
    // Reset lastTime to prevent a massive delta spike during the switch
    lastTime = performance.now();
    
    intervalId = self.setInterval(() => {
        const now = performance.now();
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        
        // Prevent death spirals if the worker pauses
        if (dt > 0.1) dt = 0.1;
        
        engineTick(dt);
    }, 1000 / hz);
}

self.onmessage = async (e: MessageEvent<MainToWorkerMessage>) => {
    const data = e.data;

    if (data.type === 'INIT') {
        const sab = data.buffer;

        // Initialize the WASM module (loads and instantiates the .wasm file)
        await wasmInit();

        // Pass the SharedArrayBuffer directly to Rust
        engineInit(sab);

        const readyMsg: WorkerToMainMessage = { type: 'READY' };
        postMessage(readyMsg);

        // Start the fixed-tick game loop at default 60 Hz
        setTickRate(60);
    } else if (data.type === 'SET_TICK_RATE') {
        setTickRate(data.rate);
    }
};
