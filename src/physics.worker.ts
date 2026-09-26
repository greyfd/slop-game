// src/physics.worker.ts

const ctx: Worker = self as any;

let sharedMatrix: Float32Array;
let angle = 0;
let intervalId: number;

ctx.onmessage = (e: MessageEvent) => {
    if (e.data.type === 'INIT') {
        const sab = e.data.buffer as SharedArrayBuffer;
        
        // 64 bytes = 16 Float32s (4x4 matrix)
        sharedMatrix = new Float32Array(sab);

        // Initialize as identity matrix
        sharedMatrix.set([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);

        // Clear any existing interval in case of multiple inits
        if (intervalId) clearInterval(intervalId);

        // Run simulation loop at ~60Hz
        intervalId = self.setInterval(() => {
            angle += 0.05;
            
            // Calculate orbiting motion
            const radius = 0.5;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            // In WebGPU / WGSL, matrices are column-major by default.
            // The translation part of a 4x4 matrix is at indices 12, 13, 14.
            sharedMatrix[12] = x;
            sharedMatrix[13] = y;
        }, 1000 / 60);
    }
};
