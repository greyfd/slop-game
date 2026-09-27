import { MemoryMap, InputFrameOffsets } from './generated';

export class InputWriter {
    private readonly int32: Int32Array;
    private readonly float32: Float32Array;
    private readonly writeHeadIndex: number;
    private readonly readHeadIndex: number;

    constructor(sab: SharedArrayBuffer) {
        this.int32 = new Int32Array(sab);
        this.float32 = new Float32Array(sab);
        this.writeHeadIndex = MemoryMap.INPUT_WRITE_HEAD / 4;
        this.readHeadIndex = MemoryMap.INPUT_READ_HEAD / 4;
    }

    /**
     * Push an input frame into the ring buffer.
     * Returns false if the buffer is full (producer would overwrite unread data).
     */
    push(keysBitmap: number, mouseDx: number, mouseDy: number, dt: number): boolean {
        const capacity = MemoryMap.INPUT_RING_CAPACITY;
        const writeHead = Atomics.load(this.int32, this.writeHeadIndex);
        const readHead = Atomics.load(this.int32, this.readHeadIndex);

        if ((writeHead + 1) % capacity === readHead) {
            return false;
        }

        const byteOffset = MemoryMap.INPUT_RING_START + writeHead * MemoryMap.INPUT_FRAME_SIZE;
        const slot = byteOffset / 4;

        // keys_bitmap is u32 -- must be written via Int32Array to preserve integer bits
        this.int32[slot + InputFrameOffsets.KEYS_BITMAP / 4] = keysBitmap;
        // mouse_dx, mouse_dy, dt are f32
        this.float32[slot + InputFrameOffsets.MOUSE_DX / 4] = mouseDx;
        this.float32[slot + InputFrameOffsets.MOUSE_DY / 4] = mouseDy;
        this.float32[slot + InputFrameOffsets.DT / 4] = dt;

        Atomics.store(this.int32, this.writeHeadIndex, (writeHead + 1) % capacity);

        return true;
    }
}
