/**
 * Main entry point.
 *
 * Single-threaded game loop:
 *   1. Process input
 *   2. Update player physics (gravity, collision, movement)
 *   3. Update camera matrices
 *   4. Render terrain via WebGPU
 */

import { Input } from './input';
import { Player } from './player';
import { Heightmap } from './terrain/heightmap';
import { generateTerrainMesh } from './terrain/mesh';
import { initGPU, recreateDepthTexture } from './render/gpu';
import { TerrainPipeline } from './render/terrain-pipeline';

// --- Configuration ---
const TERRAIN_GRID_SIZE = 128;   // vertices per axis
const TERRAIN_CELL_SIZE = 2.0;   // world units between vertices
const TERRAIN_AMPLITUDE = 8.0;   // max height of hills
const FOV = Math.PI / 3;         // 60 degrees
const NEAR_PLANE = 0.1;
const FAR_PLANE = 500.0;
const MAX_DT = 1 / 30;           // cap delta time to prevent tunneling

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

    // --- Generate terrain ---
    const heightmap = new Heightmap(
        TERRAIN_GRID_SIZE,
        TERRAIN_GRID_SIZE,
        TERRAIN_CELL_SIZE,
        TERRAIN_AMPLITUDE
    );
    const terrainMesh = generateTerrainMesh(heightmap);
    const terrainPipeline = new TerrainPipeline(gpu, terrainMesh);

    // --- Initialize input and player ---
    const input = new Input(canvas);
    const player = new Player();

    // Place player at center of terrain, on the ground
    const startHeight = heightmap.getHeight(0, 0);
    player.camera.position[0] = 0;
    player.camera.position[1] = startHeight + 1.7; // PLAYER_HEIGHT
    player.camera.position[2] = 0;

    // Initial projection
    player.camera.updateProjection(
        FOV,
        canvas.width / canvas.height,
        NEAR_PLANE,
        FAR_PLANE
    );

    // --- Handle resize ---
    window.addEventListener('resize', () => {
        resizeCanvas();
        gpu = recreateDepthTexture(gpu);
        player.camera.updateProjection(
            FOV,
            canvas.width / canvas.height,
            NEAR_PLANE,
            FAR_PLANE
        );
    });

    // --- Show/hide overlay on pointer lock ---
    document.addEventListener('pointerlockchange', () => {
        if (overlay) {
            overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
        }
    });

    // --- Game loop ---
    let lastTime = performance.now();

    function frame(now: number): void {
        let dt = (now - lastTime) / 1000;
        lastTime = now;

        // Cap delta time to prevent physics tunneling on tab switch
        if (dt > MAX_DT) dt = MAX_DT;

        // Update
        player.update(dt, input, heightmap);

        // Render
        const commandEncoder = gpu.device.createCommandEncoder();
        const textureView = gpu.context.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.6, g: 0.7, b: 0.85, a: 1.0 }, // Sky color matching fog
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: gpu.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        terrainPipeline.render(renderPass, player.camera.viewProjectionMatrix);

        renderPass.end();
        gpu.device.queue.submit([commandEncoder.finish()]);

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
