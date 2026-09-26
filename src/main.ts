// src/main.ts

const wgslShader = `
struct Uniforms {
  matrix: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4<f32> {
    // A simple colored triangle
    var pos = array<vec2<f32>, 3>(
        vec2<f32>( 0.0,  0.2),
        vec2<f32>(-0.2, -0.2),
        vec2<f32>( 0.2, -0.2)
    );

    let position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
    return uniforms.matrix * position;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 0.4, 0.0, 1.0); // Orange triangle
}
`;

async function init() {
    const errorEl = document.getElementById('error') as HTMLDivElement;
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;

    // Handle no-WebGPU case explicitly
    if (!navigator.gpu) {
        errorEl.style.display = 'block';
        canvas.style.display = 'none';
        console.error("WebGPU not supported on this browser.");
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        errorEl.style.display = 'block';
        canvas.style.display = 'none';
        console.error("No appropriate GPU adapter found.");
        return;
    }

    const device = await adapter.requestDevice();

    const context = canvas.getContext('webgpu') as GPUCanvasContext;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
    });

    // Allocate SharedArrayBuffer for a single 4x4 Float32 matrix (16 floats * 4 bytes = 64 bytes)
    // COOP and COEP headers must be set in vite.config.ts for this to not throw.
    const sab = new SharedArrayBuffer(64);

    // Initialize Web Worker
    const worker = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'INIT', buffer: sab });

    // WebGPU Shader Module
    const shaderModule = device.createShaderModule({
        label: 'Triangle Shader',
        code: wgslShader
    });

    // Create a uniform buffer
    const uniformBuffer = device.createBuffer({
        size: 64, // 64 bytes for a 4x4 f32 matrix
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render Pipeline
    const pipeline = device.createRenderPipeline({
        label: 'Triangle Pipeline',
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }],
        },
        primitive: {
            topology: 'triangle-list',
        }
    });

    // Create Bind Group for the uniform buffer
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: uniformBuffer }
            }
        ]
    });

    // Wrap the SharedArrayBuffer in a Uint8Array for easy byte copying
    const sharedMatrixBytes = new Uint8Array(sab);

    let animationFrameId: number;

    function frame() {
        // Copy exact bytes from SAB to the WebGPU uniform buffer
        device.queue.writeBuffer(uniformBuffer, 0, sharedMatrixBytes);

        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3);
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);

        animationFrameId = requestAnimationFrame(frame);
    }

    // Start render loop
    animationFrameId = requestAnimationFrame(frame);

    // Cleanup logic for memory leaks (though POC usually doesn't need it, it's good practice)
    return () => {
        cancelAnimationFrame(animationFrameId);
        worker.terminate();
        uniformBuffer.destroy();
        device.destroy();
    };
}

init().catch(err => {
    console.error("Initialization failed:", err);
});
