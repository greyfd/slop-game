/**
 * Terrain rendering pipeline.
 *
 * Creates the WebGPU render pipeline, vertex/index GPU buffers,
 * uniform buffer for the view-projection matrix, and bind group.
 * Provides a render() method to dispatch the terrain draw call.
 */

import { GPUContext } from './gpu';
import { TerrainMeshData } from '../terrain/mesh';
import terrainShaderSource from './shaders/terrain.wgsl?raw';

export class TerrainPipeline {
    private readonly device: GPUDevice;
    private readonly pipeline: GPURenderPipeline;
    private readonly vertexBuffer: GPUBuffer;
    private readonly indexBuffer: GPUBuffer;
    private readonly uniformBuffer: GPUBuffer;
    private readonly bindGroup: GPUBindGroup;
    private readonly indexCount: number;

    constructor(gpu: GPUContext, mesh: TerrainMeshData) {
        this.device = gpu.device;
        this.indexCount = mesh.indexCount;

        // Shader module
        const shaderModule = gpu.device.createShaderModule({
            label: 'Terrain Shader',
            code: terrainShaderSource,
        });

        // Vertex buffer
        this.vertexBuffer = gpu.device.createBuffer({
            label: 'Terrain Vertices',
            size: mesh.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        gpu.device.queue.writeBuffer(this.vertexBuffer, 0, mesh.vertices);

        // Index buffer
        this.indexBuffer = gpu.device.createBuffer({
            label: 'Terrain Indices',
            size: mesh.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        gpu.device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices);

        // Uniform buffer: mat4x4<f32> = 64 bytes
        this.uniformBuffer = gpu.device.createBuffer({
            label: 'Terrain Uniforms',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Render pipeline
        const vertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 24, // 6 floats * 4 bytes
            attributes: [
                {
                    // position: vec3<f32>
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x3',
                },
                {
                    // normal: vec3<f32>
                    shaderLocation: 1,
                    offset: 12,
                    format: 'float32x3',
                },
            ],
        };

        this.pipeline = gpu.device.createRenderPipeline({
            label: 'Terrain Pipeline',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: gpu.format }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
                frontFace: 'ccw',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: gpu.depthFormat,
            },
        });

        // Bind group
        this.bindGroup = gpu.device.createBindGroup({
            label: 'Terrain Bind Group',
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
            ],
        });
    }

    /**
     * Upload the view-projection matrix and encode the terrain draw call
     * into the provided render pass.
     */
    render(pass: GPURenderPassEncoder, viewProjectionMatrix: Float32Array): void {
        this.device.queue.writeBuffer(this.uniformBuffer, 0, viewProjectionMatrix);

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.drawIndexed(this.indexCount);
    }
}
