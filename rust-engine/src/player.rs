//! First-person character controller.
//!
//! Handles WASD movement, mouse look, gravity, jump,
//! and ground collision via heightmap raycasting.

use glam::Vec3;
use crate::input::AccumulatedInput;
use crate::terrain;

const MOVE_SPEED: f32 = 10.0;
const MOUSE_SENSITIVITY: f32 = 0.002;
const GRAVITY: f32 = -20.0;
const JUMP_VELOCITY: f32 = 8.0;
const PLAYER_HEIGHT: f32 = 1.7;
const MAX_PITCH: f32 = std::f32::consts::FRAC_PI_2 * 0.98; // just under 90 degrees

pub struct Player {
    pub position: Vec3,
    pub velocity: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub on_ground: bool,
}

impl Player {
    pub fn new(start_x: f32, start_z: f32) -> Self {
        let ground_h = terrain::get_height(start_x, start_z);
        Self {
            position: Vec3::new(start_x, ground_h + PLAYER_HEIGHT, start_z),
            velocity: Vec3::ZERO,
            yaw: 0.0,
            pitch: 0.0,
            on_ground: true,
        }
    }

    /// Run one simulation tick with the given accumulated input.
    pub fn update(&mut self, input: &AccumulatedInput) {
        let dt = input.dt;

        // --- Mouse look ---
        // Mouse right = positive dx -> decrease yaw (turn right)
        self.yaw -= input.mouse_dx * MOUSE_SENSITIVITY;
        self.pitch -= input.mouse_dy * MOUSE_SENSITIVITY;

        // Clamp pitch
        self.pitch = self.pitch.clamp(-MAX_PITCH, MAX_PITCH);

        // --- Horizontal movement ---
        let sy = self.yaw.sin();
        let cy = self.yaw.cos();

        // Forward direction
        let forward = if input.fly_mode {
            let sp = self.pitch.sin();
            let cp = self.pitch.cos();
            Vec3::new(-sy * cp, sp, -cy * cp)
        } else {
            Vec3::new(-sy, 0.0, -cy)
        };
        // Right direction
        let right = Vec3::new(cy, 0.0, -sy);

        let mut move_dir = Vec3::ZERO;

        if input.forward {
            move_dir += forward;
        }
        if input.backward {
            move_dir -= forward;
        }
        if input.right {
            move_dir += right;
        }
        if input.left {
            move_dir -= right;
        }

        // Normalize diagonal movement
        let move_len = move_dir.length();
        if move_len > 1e-6 {
            move_dir /= move_len;
        }

        let current_speed = if input.player_speed > 0.0 { input.player_speed } else { MOVE_SPEED };

        self.velocity.x = move_dir.x * current_speed;
        self.velocity.z = move_dir.z * current_speed;
        if input.fly_mode {
            self.velocity.y = move_dir.y * current_speed;
            
            // Allow ascending with jump key in fly mode
            if input.jump {
                self.velocity.y += current_speed;
            }
        }

        // --- Vertical physics ---
        if !input.fly_mode {
            if input.jump && self.on_ground {
                self.velocity.y = JUMP_VELOCITY;
                self.on_ground = false;
            }

            if !self.on_ground {
                self.velocity.y += GRAVITY * dt;
            }
        }

        // --- Integrate position ---
        self.position += self.velocity * dt;

        // --- Ground collision ---
        if !input.fly_mode {
            let ground_height = terrain::get_height(self.position.x, self.position.z);
            let feet_y = self.position.y - PLAYER_HEIGHT;

            if feet_y <= ground_height {
                self.position.y = ground_height + PLAYER_HEIGHT;
                self.velocity.y = 0.0;
                self.on_ground = true;
            } else {
                self.on_ground = false;
            }
        } else {
            self.on_ground = false;
        }
    }
}
