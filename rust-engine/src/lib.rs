//! WASM entry points for the game engine.
//!
//! Exported functions:
//!   - `init(sab: JsValue)` -- Initialize with the SharedArrayBuffer.
//!   - `tick()` -- Run one simulation step (called at 60 Hz by the worker).

mod generated;
mod memory;
mod input;
mod player;
mod camera;
mod terrain;

use wasm_bindgen::prelude::*;
use js_sys::SharedArrayBuffer;
use crate::generated::FrameState;

static mut PLAYER: Option<player::Player> = None;
static mut TICK_COUNT: u32 = 0;

/// Initialize the engine with the SharedArrayBuffer.
///
/// Called once from the engine worker after receiving the SAB via postMessage.
#[wasm_bindgen]
pub fn init(sab: JsValue) {
    // Set up panic hook for better error messages
    std::panic::set_hook(Box::new(|info| {
        web_sys::console::error_1(&JsValue::from_str(&format!("{}", info)));
    }));

    // Cast JsValue to SharedArrayBuffer
    let shared_buffer: SharedArrayBuffer = sab.unchecked_into();

    // Initialize memory views
    memory::init(&shared_buffer);

    // Generate terrain (writes to SAB)
    terrain::generate();

    // Create player at world center
    unsafe {
        PLAYER = Some(player::Player::new(0.0, 0.0));
    }
}

/// Run one simulation tick.
#[wasm_bindgen]
pub fn tick(dt: f32) {
    // 1. Drain input from the ring buffer
    let mut accumulated = input::drain_input();
    accumulated.dt = dt;

    // 2. Update player
    let player = unsafe {
        match PLAYER.as_mut() {
            Some(p) => p,
            None => return,
        }
    };
    player.update(&accumulated);

    // 3. Compute view matrix
    let view_matrix = camera::fps_view_matrix(player.position, player.yaw, player.pitch);

    // 4. Build FrameState
    let tick_count = unsafe {
        TICK_COUNT += 1;
        TICK_COUNT
    };

    let frame_state = FrameState {
        view_matrix,
        camera_position: [player.position.x, player.position.y, player.position.z],
        _pad0: 0.0,
        player_position: [player.position.x, player.position.y, player.position.z],
        _pad1: 0.0,
        player_velocity: [player.velocity.x, player.velocity.y, player.velocity.z],
        _pad2: 0.0,
        player_yaw: player.yaw,
        player_pitch: player.pitch,
        player_on_ground: if player.on_ground { 1 } else { 0 },
        tick_count,
    };

    // 5. Write to the INACTIVE buffer, then flip
    let active_index = memory::load_state_index();
    let inactive_index = if active_index == 0 { 1 } else { 0 };

    memory::write_frame_state(inactive_index, &frame_state);
    memory::flip_state_index(inactive_index);
}
