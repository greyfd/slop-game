import { GPUContext } from './gpu';
import terrainShaderSource from './shaders/terrain.wgsl?raw';
import { MemoryMap } from '../shared/generated';

export class TerrainPipeline {
    private readonly device: GPUDevice;
    private readonly pipeline: GPURenderPipeline;
    private readonly vertexBuffer: GPUBuffer;
    private readonly indexBuffer: GPUBuffer;
    private readonly uniformBuffer: GPUBuffer;
    private readonly bindGroup: GPUBindGroup;

    constructor(gpu: GPUContext) {
        this.device = gpu.device;

        const shaderModule = gpu.device.createShaderModule({
            label: 'Terrain Shader',
            code: terrainShaderSource,
        });

        // Allocate huge buffers for all 25 chunks
        this.vertexBuffer = gpu.device.createBuffer({
            label: 'Terrain Vertices',
            size: MemoryMap.TERRAIN_CHUNK_COUNT * MemoryMap.TERRAIN_VERTEX_STRIDE,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this.indexBuffer = gpu.device.createBuffer({
            label: 'Terrain Indices',
            size: MemoryMap.TERRAIN_CHUNK_COUNT * MemoryMap.TERRAIN_INDEX_STRIDE,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });

        // Uniform buffer: mat4x4<f32> (64) + vec4<f32> (16) = 80 bytes
        this.uniformBuffer = gpu.device.createBuffer({
            label: 'Terrain Uniforms',
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const vertexBufferLayout: GPUVertexBufferLayout = {
            arrayStride: 36,
            attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x3' },
                { shaderLocation: 2, offset: 24, format: 'float32x3' },
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
     * Upload a single chunk's mesh data from SAB to the GPU buffer.
     */
    uploadChunk(slot: number, vertices: Float32Array, indices: Uint32Array): void {
        const vertexOffset = slot * MemoryMap.TERRAIN_VERTEX_STRIDE;
        const indexOffset = slot * MemoryMap.TERRAIN_INDEX_STRIDE;
        
        this.device.queue.writeBuffer(this.vertexBuffer, vertexOffset, vertices);
        this.device.queue.writeBuffer(this.indexBuffer, indexOffset, indices);
    }

    render(pass: GPURenderPassEncoder, viewProjectionMatrix: Float32Array, cameraPos: Float32Array, activeSlots: number[]): void {
        // Upload mat4 (64 bytes) and vec3 as vec4 (16 bytes)
        const uniformData = new Float32Array(20);
        uniformData.set(viewProjectionMatrix, 0);
        uniformData.set(cameraPos, 16);
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        
        for (const slot of activeSlots) {
            const indexCount = MemoryMap.TERRAIN_MAX_INDICES_PER_CHUNK;
            const firstIndex = (slot * MemoryMap.TERRAIN_INDEX_STRIDE) / 4;
            const baseVertex = slot * MemoryMap.TERRAIN_MAX_VERTICES_PER_CHUNK;
            
            pass.drawIndexed(indexCount, 1, firstIndex, baseVertex);
        }
    }
}
