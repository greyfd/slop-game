//! SAB memory access module.
//!
//! The SharedArrayBuffer lives in JavaScript-managed memory, separate from
//! WASM linear memory. We access it through js_sys typed array views.
//!
//! For atomic operations (control words), we call js_sys::Atomics directly.
//! For bulk data (FrameState, terrain), we use typed array get/set methods.

use js_sys::{Atomics, Int32Array, Float32Array, Uint32Array, SharedArrayBuffer};
use wasm_bindgen::JsValue;

use crate::generated::{
    FrameState, InputFrame,
    BUFFER_A_START, BUFFER_B_START,
    INPUT_READ_HEAD, INPUT_RING_START, INPUT_WRITE_HEAD, INPUT_RING_CAPACITY,
    STATE_INDEX, TERRAIN_INDEX_COUNT_OFFSET, TERRAIN_INDICES_START, TERRAIN_READY,
    TERRAIN_VERTEX_COUNT_OFFSET, TERRAIN_VERTICES_START, TERRAIN_FLOATS_PER_VERTEX,
    INPUT_FRAME_SIZE,
};

/// Global typed array views over the SharedArrayBuffer.
/// Set once in init(), read in tick() and terrain generation.
static mut SAB_INT32: Option<Int32Array> = None;
static mut SAB_FLOAT32: Option<Float32Array> = None;
static mut SAB_UINT32: Option<Uint32Array> = None;

/// Initialize typed array views over the SharedArrayBuffer.
pub fn init(sab: &SharedArrayBuffer) {
    unsafe {
        SAB_INT32 = Some(Int32Array::new(sab));
        SAB_FLOAT32 = Some(Float32Array::new(sab));
        SAB_UINT32 = Some(Uint32Array::new(sab));
    }
}

fn int32() -> &'static Int32Array {
    unsafe { SAB_INT32.as_ref().expect("memory not initialized") }
}

fn float32() -> &'static Float32Array {
    unsafe { SAB_FLOAT32.as_ref().expect("memory not initialized") }
}

fn uint32() -> &'static Uint32Array {
    unsafe { SAB_UINT32.as_ref().expect("memory not initialized") }
}

// ---------------------------------------------------------------------------
// Atomic control word access (via js_sys::Atomics)
// ---------------------------------------------------------------------------

/// Read the active buffer index (0 or 1).
pub fn load_state_index() -> u32 {
    Atomics::load(int32(), STATE_INDEX as u32 / 4)
        .expect("Atomics.load failed") as u32
}

/// Flip the active buffer index. Uses Atomics.store for cross-thread visibility.
pub fn flip_state_index(new_index: u32) {
    Atomics::store(int32(), STATE_INDEX as u32 / 4, new_index as i32)
        .expect("Atomics.store failed");
}

/// Load the input ring buffer write head (set by main thread).
pub fn load_input_write_head() -> u32 {
    Atomics::load(int32(), INPUT_WRITE_HEAD as u32 / 4)
        .expect("Atomics.load failed") as u32
}

/// Load the input ring buffer read head (set by this worker).
pub fn load_input_read_head() -> u32 {
    Atomics::load(int32(), INPUT_READ_HEAD as u32 / 4)
        .expect("Atomics.load failed") as u32
}

/// Store the input ring buffer read head after consuming input.
pub fn store_input_read_head(value: u32) {
    Atomics::store(int32(), INPUT_READ_HEAD as u32 / 4, value as i32)
        .expect("Atomics.store failed");
}

/// Signal that terrain data is ready for the main thread to upload.
pub fn store_terrain_ready(value: u32) {
    Atomics::store(int32(), TERRAIN_READY as u32 / 4, value as i32)
        .expect("Atomics.store failed");
}

/// Check if the main thread has consumed the terrain data.
pub fn load_terrain_ready() -> u32 {
    Atomics::load(int32(), TERRAIN_READY as u32 / 4)
        .expect("Atomics.load failed") as u32
}

// ---------------------------------------------------------------------------
// Input ring buffer
// ---------------------------------------------------------------------------

/// Read an InputFrame from the ring buffer at the given slot index.
pub fn read_input_frame(slot: u32) -> InputFrame {
    let byte_offset = INPUT_RING_START + (slot as usize) * INPUT_FRAME_SIZE;
    let float_offset = byte_offset / 4;
    let int_offset = byte_offset / 4;

    let f = float32();
    let i = int32();

    InputFrame {
        // keys_bitmap is u32, read via Int32Array and reinterpret
        keys_bitmap: i.get_index(int_offset as u32) as u32,
        mouse_dx: f.get_index((float_offset + 1) as u32),
        mouse_dy: f.get_index((float_offset + 2) as u32),
        dt: f.get_index((float_offset + 3) as u32),
    }
}

// ---------------------------------------------------------------------------
// FrameState double buffer
// ---------------------------------------------------------------------------

fn frame_state_byte_offset(buffer_index: u32) -> usize {
    if buffer_index == 0 { BUFFER_A_START } else { BUFFER_B_START }
}

/// Write a FrameState to the specified buffer (0 = A, 1 = B).
pub fn write_frame_state(buffer_index: u32, state: &FrameState) {
    let base = frame_state_byte_offset(buffer_index) / 4;
    let f = float32();
    let u = uint32();

    // view_matrix: 16 floats at offset 0
    for i in 0..16 {
        f.set_index((base + i) as u32, state.view_matrix[i]);
    }

    // camera_position: 3 floats at offset 16 (64 bytes / 4)
    let cam_off = base + 16;
    f.set_index(cam_off as u32, state.camera_position[0]);
    f.set_index((cam_off + 1) as u32, state.camera_position[1]);
    f.set_index((cam_off + 2) as u32, state.camera_position[2]);
    // _pad0 at cam_off + 3

    // player_position: 3 floats at offset 20
    let pos_off = base + 20;
    f.set_index(pos_off as u32, state.player_position[0]);
    f.set_index((pos_off + 1) as u32, state.player_position[1]);
    f.set_index((pos_off + 2) as u32, state.player_position[2]);
    // _pad1 at pos_off + 3

    // player_velocity: 3 floats at offset 24
    let vel_off = base + 24;
    f.set_index(vel_off as u32, state.player_velocity[0]);
    f.set_index((vel_off + 1) as u32, state.player_velocity[1]);
    f.set_index((vel_off + 2) as u32, state.player_velocity[2]);
    // _pad2 at vel_off + 3

    // player_yaw: f32 at offset 28
    f.set_index((base + 28) as u32, state.player_yaw);
    // player_pitch: f32 at offset 29
    f.set_index((base + 29) as u32, state.player_pitch);
    // player_on_ground: u32 at offset 30
    u.set_index((base + 30) as u32, state.player_on_ground);
    // tick_count: u32 at offset 31
    u.set_index((base + 31) as u32, state.tick_count);
}

// ---------------------------------------------------------------------------
// Terrain data
// ---------------------------------------------------------------------------

/// Write the terrain vertex count.
pub fn write_terrain_vertex_count(count: u32) {
    uint32().set_index(TERRAIN_VERTEX_COUNT_OFFSET as u32 / 4, count);
}

/// Write the terrain index count.
pub fn write_terrain_index_count(count: u32) {
    uint32().set_index(TERRAIN_INDEX_COUNT_OFFSET as u32 / 4, count);
}

/// Write a single vertex float to the terrain vertex region.
pub fn write_terrain_vertex_float(float_index: usize, value: f32) {
    let idx = TERRAIN_VERTICES_START / 4 + float_index;
    float32().set_index(idx as u32, value);
}

/// Write a single index to the terrain index region.
pub fn write_terrain_index(index_slot: usize, value: u32) {
    let idx = TERRAIN_INDICES_START / 4 + index_slot;
    uint32().set_index(idx as u32, value);
}
