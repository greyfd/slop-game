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

    // --- Terrain Staging (Chunk Array) ---
    static readonly TERRAIN_CHUNK_COUNT = 289;
    static readonly TERRAIN_CHUNK_RADIUS = 8;
    static readonly TERRAIN_META_START = 2320;
    static readonly TERRAIN_META_STRIDE = 16;
    static readonly TERRAIN_VERTICES_START = 6944;
    static readonly TERRAIN_VERTEX_STRIDE = 589824;
    static readonly TERRAIN_INDICES_START = 170466080;
    static readonly TERRAIN_INDEX_STRIDE = 387096;
    static readonly TERRAIN_MAX_VERTICES_PER_CHUNK = 16384;
    static readonly TERRAIN_MAX_INDICES_PER_CHUNK = 96774;
    static readonly TERRAIN_FLOATS_PER_VERTEX = 9;
    static readonly MINIMAP_DATA_START = 282336832;
    static readonly MINIMAP_DATA_SIZE = 4096;

    // --- Total ---
    static readonly TOTAL_SAB_SIZE = 282340928;
}

