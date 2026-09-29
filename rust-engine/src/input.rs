//! Input ring buffer consumer (SPSC reader).
//!
//! Reads InputFrame structs written by the main thread.
//! Accumulates mouse deltas across multiple frames since the worker
//! may tick slower than the main thread produces input.

use crate::generated::{InputFrame, INPUT_RING_CAPACITY};
use crate::memory;

/// Accumulated input state for a single simulation tick.
#[derive(Debug, Default)]
pub struct AccumulatedInput {
    pub forward: bool,
    pub backward: bool,
    pub left: bool,
    pub right: bool,
    pub jump: bool,
    pub mouse_dx: f32,
    pub mouse_dy: f32,
    pub dt: f32,
    pub fly_mode: bool,
    pub player_speed: f32,
}

/// Key bitmap bit positions.
const KEY_W: u32 = 1 << 0;
const KEY_S: u32 = 1 << 1;
const KEY_A: u32 = 1 << 2;
const KEY_D: u32 = 1 << 3;
const KEY_SPACE: u32 = 1 << 4;

static mut LAST_KEYS: u32 = 0;

/// Drain all pending input frames from the ring buffer and return
/// the accumulated result for this tick.
pub fn drain_input() -> AccumulatedInput {
    let mut result = AccumulatedInput::default();
    let mut frames_read = 0u32;

    let write_head = memory::load_input_write_head() % (INPUT_RING_CAPACITY as u32);
    let mut read_head = memory::load_input_read_head() % (INPUT_RING_CAPACITY as u32);

    unsafe {
        while read_head != write_head {
            let frame: InputFrame = memory::read_input_frame(read_head);

            LAST_KEYS = frame.keys_bitmap;

            // Accumulate mouse deltas (sum across all pending frames)
            result.mouse_dx += frame.mouse_dx;
            result.mouse_dy += frame.mouse_dy;
            
            // Just take the latest value for these state flags
            result.fly_mode = frame.fly_mode != 0;
            result.player_speed = frame.player_speed;

            frames_read += 1;
            read_head = (read_head + 1) % (INPUT_RING_CAPACITY as u32);
        }

        // Apply the most recent persistent key state
        result.forward = LAST_KEYS & KEY_W != 0;
        result.backward = LAST_KEYS & KEY_S != 0;
        result.left = LAST_KEYS & KEY_A != 0;
        result.right = LAST_KEYS & KEY_D != 0;
        result.jump = LAST_KEYS & KEY_SPACE != 0;
    }

    // Commit the read head so the main thread can reclaim slots
    if frames_read > 0 {
        memory::store_input_read_head(read_head);
    }

    result
}
