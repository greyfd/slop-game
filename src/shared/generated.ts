// GENERATED CODE - DO NOT MODIFY

export class InputFrameOffsets {
    static readonly KEYS_BITMAP = 0;
    static readonly MOUSE_DX = 4;
    static readonly MOUSE_DY = 8;
    static readonly DT = 12;
    static readonly _STRUCT_SIZE = 16;
}

export class FrameStateOffsets {
    static readonly VIEW_MATRIX = 0;
    static readonly CAMERA_POSITION = 64;
    static readonly PLAYER_POSITION = 80;
    static readonly PLAYER_VELOCITY = 96;
    static readonly PLAYER_YAW = 112;
    static readonly PLAYER_PITCH = 116;
    static readonly PLAYER_ON_GROUND = 120;
    static readonly TICK_COUNT = 124;
    static readonly _STRUCT_SIZE = 128;
}

/** SharedArrayBuffer memory map -- all offsets in bytes. */
export class MemoryMap {
    // --- Atomic Control Words ---
    static readonly STATE_INDEX = 0;
    static readonly INPUT_WRITE_HEAD = 4;
    static readonly INPUT_READ_HEAD = 8;
    static readonly TERRAIN_READY = 12;

    // --- Input Ring Buffer ---
    static readonly INPUT_RING_START = 16;
    static readonly INPUT_RING_CAPACITY = 128;
    static readonly INPUT_FRAME_SIZE = 16;

    // --- Double-Buffered FrameState ---
    static readonly BUFFER_A_START = 2064;
    static readonly BUFFER_B_START = 2192;
    static readonly FRAME_STATE_SIZE = 128;

    // --- Terrain Staging ---
    static readonly TERRAIN_VERTEX_COUNT = 2320;
    static readonly TERRAIN_INDEX_COUNT = 2324;
    static readonly TERRAIN_VERTICES_START = 2336;
    static readonly TERRAIN_INDICES_START = 395552;
    static readonly TERRAIN_MAX_VERTICES = 16384;
    static readonly TERRAIN_MAX_INDICES = 96774;
    static readonly TERRAIN_FLOATS_PER_VERTEX = 6;

    // --- Total ---
    static readonly TOTAL_SAB_SIZE = 782656;
}

