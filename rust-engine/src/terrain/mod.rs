use crate::generated::{TERRAIN_CHUNK_COUNT, TERRAIN_CHUNK_RADIUS, TERRAIN_FLOATS_PER_VERTEX};
use crate::memory;
use crate::macro_map::{MacroMap, MACRO_NODES, WORLD_CHUNKS};
use std::collections::HashMap;

pub const GRID_SIZE: usize = 128;
pub const CELL_SIZE: f32 = 10.0;
pub const CHUNK_WORLD_SIZE: f32 = (GRID_SIZE - 1) as f32 * CELL_SIZE;

pub mod math;
pub mod biomes;
pub mod generator;
pub mod manager;

pub use manager::{ChunkManager, init, update, get_height};
