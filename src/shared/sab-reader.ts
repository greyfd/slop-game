import { MemoryMap, FrameStateOffsets } from './generated';

export class SABReader {
    private readonly sab: SharedArrayBuffer;
    private readonly int32: Int32Array;
    private readonly float32: Float32Array;
    private readonly uint32: Uint32Array;
    private readonly stateIndexSlot: number;

    constructor(sab: SharedArrayBuffer) {
        this.sab = sab;
        this.int32 = new Int32Array(sab);
        this.float32 = new Float32Array(sab);
        this.uint32 = new Uint32Array(sab);
        this.stateIndexSlot = MemoryMap.STATE_INDEX / 4;
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

    /** Read the state of a specific chunk slot (0 = Empty, 2 = Needs Upload, 3 = Active) */
    getChunkState(slot: number): number {
        const offset = (MemoryMap.TERRAIN_META_START + slot * MemoryMap.TERRAIN_META_STRIDE) / 4;
        return Atomics.load(this.int32, offset);
    }

    /** Set the state of a specific chunk slot */
    setChunkState(slot: number, state: number): void {
        const offset = (MemoryMap.TERRAIN_META_START + slot * MemoryMap.TERRAIN_META_STRIDE) / 4;
        Atomics.store(this.int32, offset, state);
    }

    /** Get a Float32Array view of a chunk's vertex data. */
    getChunkVertices(slot: number): Float32Array {
        const offset = MemoryMap.TERRAIN_VERTICES_START + slot * MemoryMap.TERRAIN_VERTEX_STRIDE;
        return new Float32Array(this.sab, offset, MemoryMap.TERRAIN_MAX_VERTICES_PER_CHUNK * MemoryMap.TERRAIN_FLOATS_PER_VERTEX);
    }

    /** Get a Uint32Array view of a chunk's index data. */
    getChunkIndices(slot: number): Uint32Array {
        const offset = MemoryMap.TERRAIN_INDICES_START + slot * MemoryMap.TERRAIN_INDEX_STRIDE;
        return new Uint32Array(this.sab, offset, MemoryMap.TERRAIN_MAX_INDICES_PER_CHUNK);
    }
}
