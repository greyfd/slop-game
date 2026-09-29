/**
 * Main Thread -- Pure Presentation Layer.
 *
 * Responsibilities:
 *   1. Allocate the SharedArrayBuffer
 *   2. Spawn the engine worker and send it the SAB
 *   3. Capture raw input and write it to the SAB input ring buffer
 *   4. Each frame: read the active FrameState, upload to GPU, render
 *   5. Detect terrain ready flag and upload mesh to GPU
 *
 * NO game logic, physics, or matrix computation runs here.
 * The only math is one mat4 multiply (projection * view) per frame
 * so that resize is handled instantly without SAB round-trips.
 */

import { MemoryMap } from './shared/generated';
import { InputWriter } from './shared/input-writer';
import { SABReader } from './shared/sab-reader';
import { MainToWorkerMessage, WorkerToMainMessage } from './shared/worker-messages';
import { Input } from './input';
import { initGPU, recreateDepthTexture } from './render/gpu';
import { TerrainPipeline } from './render/terrain-pipeline';
import { mat4Create, mat4Perspective, mat4Multiply } from './math/mat4';
import { Minimap } from './minimap';

// --- Configuration ---
const FOV = Math.PI / 3;
const NEAR_PLANE = 0.1;
const FAR_PLANE = 12000.0;

// --- Key bitmap encoding (must match Rust input.rs) ---
const KEY_W     = 1 << 0;
const KEY_S     = 1 << 1;
const KEY_A     = 1 << 2;
const KEY_D     = 1 << 3;
const KEY_SPACE = 1 << 4;

async function init(): Promise<void> {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
        throw new Error('Canvas element not found.');
    }
    const overlay = document.getElementById('overlay') as HTMLDivElement | null;

    // Resize canvas to fill viewport
    function resizeCanvas(): void {
        if (!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();

    // --- Initialize WebGPU ---
    let gpu = await initGPU(canvas);

    // --- Allocate SharedArrayBuffer ---
    const sab = new SharedArrayBuffer(MemoryMap.TOTAL_SAB_SIZE);
    const inputWriter = new InputWriter(sab);
    const sabReader = new SABReader(sab);
    const minimap = new Minimap(sab);

    // --- Spawn engine worker ---
    const worker = new Worker(
        new URL('./workers/engine.worker.ts', import.meta.url),
        { type: 'module' }
    );

    // Wait for worker to be ready before starting render loop
    const workerReady = new Promise<void>((resolve) => {
        worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
            const data = e.data;
            if (data.type === 'READY') {
                resolve();
            }
        };
    });

    const initMsg: MainToWorkerMessage = { type: 'INIT', buffer: sab };
    worker.postMessage(initMsg);
    await workerReady;

    // --- Initialize input ---
    const input = new Input(canvas);

    // --- Projection matrix (computed on main thread for instant resize) ---
    const projectionMatrix = mat4Create();
    const viewProjectionMatrix = mat4Create();
    const viewMatrix = new Float32Array(16);

    function updateProjection(): void {
        if (!canvas) return;
        mat4Perspective(
            projectionMatrix,
            FOV,
            canvas.width / canvas.height,
            NEAR_PLANE,
            FAR_PLANE
        );
    }
    updateProjection();

    // --- Terrain pipeline (created after first terrain data arrives) ---
    let terrainPipeline: TerrainPipeline | null = null;

    // --- Hoisted Render Resources ---
    const colorAttachment: GPURenderPassColorAttachment = {
        view: gpu.depthTextureView, // dummy initialization, updated per-frame
        clearValue: { r: 0.6, g: 0.7, b: 0.85, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
    };
    
    const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [colorAttachment],
        depthStencilAttachment: {
            view: gpu.depthTextureView, // updated on resize
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    };
    const submitArray: GPUCommandBuffer[] = [];

    // --- Handle resize ---
    window.addEventListener('resize', () => {
        resizeCanvas();
        gpu = recreateDepthTexture(gpu);
        if (renderPassDescriptor.depthStencilAttachment) {
            renderPassDescriptor.depthStencilAttachment.view = gpu.depthTextureView;
        }
        updateProjection();
    });

    // --- Overlay click -> pointer lock ---
    if (overlay) {
        overlay.addEventListener('click', () => {
            canvas.requestPointerLock();
        });
    }
    document.addEventListener('pointerlockchange', () => {
        if (overlay) {
            overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
        }
    });

    // --- Stats DOM ---
    const fpsCounter = document.getElementById('fps-counter');
    const hzCounter = document.getElementById('hz-counter');
    const tickToggle = document.getElementById('tick-toggle') as HTMLButtonElement | null;
    
    let currentEngineHz = 60;
    if (tickToggle) {
        tickToggle.addEventListener('click', () => {
            currentEngineHz = currentEngineHz === 60 ? 120 : 60;
            tickToggle.textContent = `Switch to ${currentEngineHz === 60 ? 120 : 60}Hz`;
            const msg: MainToWorkerMessage = { type: 'SET_TICK_RATE', rate: currentEngineHz };
            worker.postMessage(msg);
        });
    }


    // --- Game loop ---
    let lastTime = performance.now();
    let framesSinceUpdate = 0;
    let timeSinceUpdate = 0;
    let lastTickCount = sabReader.readTickCount();

    function frame(now: number): void {
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        
        // Capped dt for input accumulator
        let clampedDt = dt;
        if (clampedDt > 1 / 30) clampedDt = 1 / 30;

        // --- Performance Metrics ---
        framesSinceUpdate++;
        timeSinceUpdate += dt;
        
        if (timeSinceUpdate >= 1.0) {
            const currentTickCount = sabReader.readTickCount();
            
            const renderFps = (framesSinceUpdate / timeSinceUpdate).toFixed(1);
            const engineHz = ((currentTickCount - lastTickCount) / timeSinceUpdate).toFixed(1);
            
            if (fpsCounter) fpsCounter.textContent = `Render: ${renderFps} FPS`;
            if (hzCounter) hzCounter.textContent = `Engine: ${engineHz} Hz`;
            
            framesSinceUpdate = 0;
            timeSinceUpdate = 0;
            lastTickCount = currentTickCount;
        }

        // 1. Pack input into the ring buffer
        let keysBitmap = 0;
        if (input.isKeyDown('KeyW')) keysBitmap |= KEY_W;
        if (input.isKeyDown('KeyS')) keysBitmap |= KEY_S;
        if (input.isKeyDown('KeyA')) keysBitmap |= KEY_A;
        if (input.isKeyDown('KeyD')) keysBitmap |= KEY_D;
        if (input.isKeyDown('Space')) keysBitmap |= KEY_SPACE;

        // Debug controls
        const flyModeCheckbox = document.getElementById('fly-mode') as HTMLInputElement | null;
        const playerSpeedRange = document.getElementById('player-speed') as HTMLInputElement | null;
        const speedVal = document.getElementById('speed-val');
        
        let flyMode = 0;
        let playerSpeed = 0.0;
        
        if (flyModeCheckbox && flyModeCheckbox.checked) {
            flyMode = 1;
        }
        
        if (playerSpeedRange) {
            playerSpeed = parseFloat(playerSpeedRange.value);
            if (speedVal) speedVal.textContent = playerSpeedRange.value;
        }

        inputWriter.push(
            keysBitmap,
            input.mouseDeltaX,
            input.mouseDeltaY,
            clampedDt,
            flyMode,
            playerSpeed
        );
        input.resetDeltas();

        // 2. Process Terrain Chunks
        if (!terrainPipeline) {
            terrainPipeline = new TerrainPipeline(gpu);
        }
        
        const activeSlots: number[] = [];
        for (let slot = 0; slot < MemoryMap.TERRAIN_CHUNK_COUNT; slot++) {
            const state = sabReader.getChunkState(slot);
            if (state === 2) { // Generated by Rust, ready for WebGPU upload
                const vertices = sabReader.getChunkVertices(slot);
                const indices = sabReader.getChunkIndices(slot);
                terrainPipeline.uploadChunk(slot, vertices, indices);
                
                // Mark as uploaded to prevent re-uploading
                sabReader.setChunkState(slot, 3);
                activeSlots.push(slot);
            } else if (state === 3) { // Already uploaded, active
                activeSlots.push(slot);
            }
        }

        // 3. Read view matrix and camera from active buffer
        sabReader.readViewMatrix(viewMatrix);
        mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);
        
        const cameraPos = new Float32Array(3);
        sabReader.readCameraPosition(cameraPos);
        
        // Update minimap
        minimap.render(cameraPos[0], cameraPos[2]);

        // 4. Render
        const commandEncoder = gpu.device.createCommandEncoder();
        colorAttachment.view = gpu.context.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);

        if (terrainPipeline && activeSlots.length > 0) {
            terrainPipeline.render(renderPass, viewProjectionMatrix, cameraPos, activeSlots);
        }

        renderPass.end();
        submitArray[0] = commandEncoder.finish();
        gpu.device.queue.submit(submitArray);

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

init().catch(err => {
    console.error('Initialization failed:', err);
    const errorEl = document.getElementById('error');
    if (errorEl) {
        errorEl.style.display = 'block';
        errorEl.textContent = String(err);
    }
});
