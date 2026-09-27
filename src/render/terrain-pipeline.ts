/**
 * Terrain rendering pipeline.
 *
 * Creates the WebGPU render pipeline, vertex/index GPU buffers,
 * uniform buffer for the view-projection matrix, and bind group.
 * Supports updating mesh data when new terrain arrives from the SAB.
 */

import { GPUContext } from './gpu';
import terrainShaderSource from './shaders/terrain.wgsl?raw';

export interface TerrainMeshData {
    vertices: Float32Array;
    indices: Uint32Array;
    vertexCount: number;
    indexCount: number;
}

export class TerrainPipeline {
    private readonly device: GPUDevice;
    private readonly pipeline: GPURenderPipeline;
    private vertexBuffer: GPUBuffer;
    private indexBuffer: GPUBuffer;
    private readonly uniformBuffer: GPUBuffer;
    private readonly bindGroup: GPUBindGroup;
    private indexCount: number;

    constructor(gpu: GPUContext, mesh: TerrainMeshData) {
        this.device = gpu.device;
        this.indexCount = mesh.indexCount;

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

        const vertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 24,
            attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x3' },
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

        this.bindGroup = gpu.device.createBindGroup({
            label: 'Terrain Bind Group',
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: this.uniformBuffer },
            }],
        });
    }

    /**
     * Replace the terrain mesh data with new buffers from the SAB.
     * Called when the terrain_ready flag is detected.
     */
    updateMesh(vertices: Float32Array, indices: Uint32Array, indexCount: number): void {
        // Destroy old buffers
        this.vertexBuffer.destroy();
        this.indexBuffer.destroy();

        // Create new vertex buffer
        this.vertexBuffer = this.device.createBuffer({
            label: 'Terrain Vertices',
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

        // Create new index buffer
        this.indexBuffer = this.device.createBuffer({
            label: 'Terrain Indices',
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.indexBuffer, 0, indices);

        this.indexCount = indexCount;
    }

    render(pass: GPURenderPassEncoder, viewProjectionMatrix: Float32Array): void {
        this.device.queue.writeBuffer(this.uniformBuffer, 0, viewProjectionMatrix);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.drawIndexed(this.indexCount);
    }
}
