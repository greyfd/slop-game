import { TransformOffsets } from '../shared/generated';

const ctx: Worker = self as any;

let sharedInt32: Int32Array;
let sharedFloat32: Float32Array;
let intervalId: number;

ctx.onmessage = (e: MessageEvent) => {
    if (e.data.type === 'INIT') {
        const sab = e.data.buffer as SharedArrayBuffer;
        
        sharedInt32 = new Int32Array(sab);
        sharedFloat32 = new Float32Array(sab);

        if (intervalId) clearInterval(intervalId);

        const structSize = TransformOffsets._STRUCT_SIZE;

        // Run simulation loop at ~60Hz
        intervalId = self.setInterval(() => {
            // Task 2.3: Implement the Rust Engine Worker loop to write physics 
            // and transform updates only to the inactive buffer.
            const activeIndex = Atomics.load(sharedInt32, 0);
            const inactiveIndex = activeIndex === 0 ? 1 : 0;
            
            // Calculate offsets
            const inactiveOffsetBytes = 16 + (inactiveIndex * structSize);
            const floatOffset = inactiveOffsetBytes / 4; 
            
            // Mock Physics (Moving and scaling the triangle)
            const time = performance.now() / 1000;
            const x = Math.cos(time) * 0.5;
            const y = Math.sin(time) * 0.5;

            // Write Position (vec3)
            sharedFloat32[floatOffset + TransformOffsets.POSITION / 4] = x;
            sharedFloat32[floatOffset + TransformOffsets.POSITION / 4 + 1] = y;
            sharedFloat32[floatOffset + TransformOffsets.POSITION / 4 + 2] = 0; // z

            // Write Scale (vec3)
            sharedFloat32[floatOffset + TransformOffsets.SCALE / 4] = 1.0;
            sharedFloat32[floatOffset + TransformOffsets.SCALE / 4 + 1] = 1.0;
            sharedFloat32[floatOffset + TransformOffsets.SCALE / 4 + 2] = 1.0;
            
            // Once a physics tick completes, flip the ActiveBufferIndex
            Atomics.store(sharedInt32, 0, inactiveIndex);
            
            // (Note: in the actual Rust engine, file I/O will use FileSystemSyncAccessHandle from OPFS)
        }, 1000 / 60);
    }
};
