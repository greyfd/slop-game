import { MemoryMap, FrameStateOffsets } from './generated';

export class SABReader {
    private readonly sab: SharedArrayBuffer;
    private readonly int32: Int32Array;
    private readonly float32: Float32Array;
    private readonly uint32: Uint32Array;
    private readonly stateIndexSlot: number;
    private readonly terrainReadySlot: number;

    constructor(sab: SharedArrayBuffer) {
        this.sab = sab;
        this.int32 = new Int32Array(sab);
        this.float32 = new Float32Array(sab);
        this.uint32 = new Uint32Array(sab);
        this.stateIndexSlot = MemoryMap.STATE_INDEX / 4;
        this.terrainReadySlot = MemoryMap.TERRAIN_READY / 4;
    }

    /** Get the byte offset of the currently active FrameState buffer. */
    getActiveBufferOffset(): number {
        const stateIndex = Atomics.load(this.int32, this.stateIndexSlot);
        return stateIndex === 0 ? MemoryMap.BUFFER_A_START : MemoryMap.BUFFER_B_START;
    }

    /** Read the current tick count from the active buffer. */
    readTickCount(): number {
        const activeOffset = this.getActiveBufferOffset();
        return this.uint32[(activeOffset + FrameStateOffsets.TICK_COUNT) / 4];
    }

    /** Read the 16-float view matrix from the active buffer into `out`. */
    readViewMatrix(out: Float32Array): void {
        const activeOffset = this.getActiveBufferOffset();
        const startIndex = (activeOffset + FrameStateOffsets.VIEW_MATRIX) / 4;
        for (let i = 0; i < 16; i++) {
            out[i] = this.float32[startIndex + i];
        }
    }

    /** Read camera position from active buffer. */
    readCameraPosition(out: Float32Array): void {
        const activeOffset = this.getActiveBufferOffset();
        const startIndex = (activeOffset + FrameStateOffsets.CAMERA_POSITION) / 4;
        for (let i = 0; i < 3; i++) {
            out[i] = this.float32[startIndex + i];
        }
    }

    /** Check if new terrain data is ready. Returns true and clears the flag if so. */
    checkTerrainReady(): boolean {
        const isReady = Atomics.load(this.int32, this.terrainReadySlot);
        if (isReady === 1) {
            Atomics.store(this.int32, this.terrainReadySlot, 0);
            return true;
        }
        return false;
    }

    /** Read terrain vertex count. */
    getTerrainVertexCount(): number {
        return this.int32[MemoryMap.TERRAIN_VERTEX_COUNT / 4];
    }

    /** Read terrain index count. */
    getTerrainIndexCount(): number {
        return this.int32[MemoryMap.TERRAIN_INDEX_COUNT / 4];
    }

    /** Get a Float32Array view of the terrain vertex data. */
    getTerrainVertices(vertexCount: number): Float32Array {
        return new Float32Array(this.sab, MemoryMap.TERRAIN_VERTICES_START, vertexCount * MemoryMap.TERRAIN_FLOATS_PER_VERTEX);
    }

    /** Get a Uint32Array view of the terrain index data. */
    getTerrainIndices(indexCount: number): Uint32Array {
        return new Uint32Array(this.sab, MemoryMap.TERRAIN_INDICES_START, indexCount);
    }
}
