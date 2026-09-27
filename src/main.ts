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
import { Input } from './input';
import { initGPU, recreateDepthTexture } from './render/gpu';
import { TerrainPipeline } from './render/terrain-pipeline';
import { mat4Create, mat4Perspective, mat4Multiply } from './math/mat4';

// --- Configuration ---
const FOV = Math.PI / 3;
const NEAR_PLANE = 0.1;
const FAR_PLANE = 500.0;

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

    // --- Spawn engine worker ---
    const worker = new Worker(
        new URL('./workers/engine.worker.ts', import.meta.url),
        { type: 'module' }
    );

    // Wait for worker to be ready before starting render loop
    const workerReady = new Promise<void>((resolve) => {
        worker.onmessage = (e: MessageEvent) => {
            const data = e.data as { type: string };
            if (data.type === 'READY') {
                resolve();
            }
        };
    });

    worker.postMessage({ type: 'INIT', buffer: sab });
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
        view: undefined as unknown as GPUTextureView, // updated per-frame
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
    const submitArray: GPUCommandBuffer[] = [undefined as unknown as GPUCommandBuffer];

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
            worker.postMessage({ type: 'SET_TICK_RATE', rate: currentEngineHz });
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

        inputWriter.push(
            keysBitmap,
            input.mouseDeltaX,
            input.mouseDeltaY,
            clampedDt
        );
        input.resetDeltas();

        // 2. Check for terrain data
        if (sabReader.checkTerrainReady()) {
            const vertexCount = sabReader.getTerrainVertexCount();
            const indexCount = sabReader.getTerrainIndexCount();
            const vertices = sabReader.getTerrainVertices(vertexCount);
            const indices = sabReader.getTerrainIndices(indexCount);

            if (terrainPipeline) {
                terrainPipeline.updateMesh(vertices, indices, indexCount);
            } else {
                terrainPipeline = new TerrainPipeline(gpu, {
                    vertices,
                    indices,
                    vertexCount,
                    indexCount,
                });
            }
        }

        // 3. Read view matrix from active buffer, compose VP matrix
        sabReader.readViewMatrix(viewMatrix);
        mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);

        // 4. Render
        const commandEncoder = gpu.device.createCommandEncoder();
        colorAttachment.view = gpu.context.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);

        if (terrainPipeline) {
            terrainPipeline.render(renderPass, viewProjectionMatrix);
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
