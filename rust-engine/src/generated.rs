// GENERATED CODE - DO NOT MODIFY

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct InputFrame {
    pub keys_bitmap: u32,
    pub mouse_dx: f32,
    pub mouse_dy: f32,
    pub dt: f32,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct FrameState {
    pub view_matrix: [f32; 16],
    pub camera_position: [f32; 3],
    pub _pad0: f32,
    pub player_position: [f32; 3],
    pub _pad1: f32,
    pub player_velocity: [f32; 3],
    pub _pad2: f32,
    pub player_yaw: f32,
    pub player_pitch: f32,
    pub player_on_ground: u32,
    pub tick_count: u32,
}

// --- SharedArrayBuffer Memory Map (byte offsets) ---

pub const STATE_INDEX: usize = 0;
pub const INPUT_WRITE_HEAD: usize = 4;
pub const INPUT_READ_HEAD: usize = 8;
pub const TERRAIN_READY: usize = 12;

pub const INPUT_RING_START: usize = 16;
pub const INPUT_RING_CAPACITY: usize = 128;
pub const INPUT_FRAME_SIZE: usize = 16;

pub const BUFFER_A_START: usize = 2064;
pub const BUFFER_B_START: usize = 2192;
pub const FRAME_STATE_SIZE: usize = 128;

pub const TERRAIN_VERTEX_COUNT_OFFSET: usize = 2320;
pub const TERRAIN_INDEX_COUNT_OFFSET: usize = 2324;
pub const TERRAIN_VERTICES_START: usize = 2336;
pub const TERRAIN_INDICES_START: usize = 395552;
pub const TERRAIN_MAX_VERTICES: usize = 16384;
pub const TERRAIN_MAX_INDICES: usize = 96774;
pub const TERRAIN_FLOATS_PER_VERTEX: usize = 6;

pub const TOTAL_SAB_SIZE: usize = 782656;
