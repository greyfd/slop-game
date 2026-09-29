use std::collections::HashMap;
use crate::macro_map::MacroMap;
use crate::memory;
use crate::generated::{TERRAIN_CHUNK_COUNT, TERRAIN_CHUNK_RADIUS};
use super::{CHUNK_WORLD_SIZE, CELL_SIZE, GRID_SIZE};
use super::generator::{generate_chunk, get_world_height};

struct ChunkSlot {
    index: usize,
    chunk_x: i32,
    chunk_z: i32,
    heights: Vec<f32>,
}

pub struct ChunkManager {
    active_chunks: HashMap<(i32, i32), ChunkSlot>,
    free_slots: Vec<usize>,
    last_player_chunk: (i32, i32),
    pub macro_map: MacroMap,
}

static mut MANAGER: Option<ChunkManager> = None;

pub fn init(macro_map: MacroMap) {
    let mut free_slots = Vec::with_capacity(TERRAIN_CHUNK_COUNT);
    for i in (0..TERRAIN_CHUNK_COUNT).rev() {
        free_slots.push(i);
        memory::write_terrain_chunk_meta(i, 0, 0, 0);
    }
    unsafe {
        MANAGER = Some(ChunkManager {
            active_chunks: HashMap::with_capacity(TERRAIN_CHUNK_COUNT),
            free_slots,
            last_player_chunk: (100000, 100000), // Force generation on first tick
            macro_map,
        });
    }
}

pub fn update(player_x: f32, player_z: f32) {
    let manager = unsafe { MANAGER.as_mut().unwrap() };
    
    let cx = (player_x / CHUNK_WORLD_SIZE).floor() as i32;
    let cz = (player_z / CHUNK_WORLD_SIZE).floor() as i32;
    
    if cx == manager.last_player_chunk.0 && cz == manager.last_player_chunk.1 {
        return;
    }
    manager.last_player_chunk = (cx, cz);
    
    let radius = TERRAIN_CHUNK_RADIUS as i32;
    let mut needed_chunks = Vec::new();
    
    for x in (cx - radius)..=(cx + radius) {
        for z in (cz - radius)..=(cz + radius) {
            needed_chunks.push((x, z));
        }
    }
    
    let mut to_remove = Vec::new();
    for (pos, slot) in manager.active_chunks.iter() {
        if !needed_chunks.contains(pos) {
            to_remove.push(*pos);
            manager.free_slots.push(slot.index);
            memory::write_terrain_chunk_meta(slot.index, 0, 0, 0);
        }
    }
    for pos in to_remove {
        manager.active_chunks.remove(&pos);
    }
    
    for pos in needed_chunks {
        if !manager.active_chunks.contains_key(&pos) {
            if let Some(slot_index) = manager.free_slots.pop() {
                let heights = generate_chunk(manager, slot_index, pos.0, pos.1);
                manager.active_chunks.insert(pos, ChunkSlot {
                    index: slot_index,
                    chunk_x: pos.0,
                    chunk_z: pos.1,
                    heights,
                });
            }
        }
    }
}

pub fn get_height(world_x: f32, world_z: f32) -> f32 {
    let cx = (world_x / CHUNK_WORLD_SIZE).floor() as i32;
    let cz = (world_z / CHUNK_WORLD_SIZE).floor() as i32;
    
    let manager = unsafe {
        match &MANAGER {
            Some(m) => m,
            None => return 0.0, // Should not happen after init
        }
    };
    
    if let Some(slot) = manager.active_chunks.get(&(cx, cz)) {
        let origin_x = cx as f32 * CHUNK_WORLD_SIZE;
        let origin_z = cz as f32 * CHUNK_WORLD_SIZE;
        
        let gxf = (world_x - origin_x) / CELL_SIZE;
        let gzf = (world_z - origin_z) / CELL_SIZE;
        
        let gx0 = gxf.floor() as usize;
        let gz0 = gzf.floor() as usize;
        
        if gx0 >= GRID_SIZE - 1 || gz0 >= GRID_SIZE - 1 {
            return get_world_height(manager, world_x, world_z);
        }
        
        let gx1 = gx0 + 1;
        let gz1 = gz0 + 1;
        let fx = gxf - gx0 as f32;
        let fz = gzf - gz0 as f32;
        
        let h00 = slot.heights[gz0 * GRID_SIZE + gx0];
        let h10 = slot.heights[gz0 * GRID_SIZE + gx1];
        let h01 = slot.heights[gz1 * GRID_SIZE + gx0];
        let h11 = slot.heights[gz1 * GRID_SIZE + gx1];

        let h0 = h00 + (h10 - h00) * fx;
        let h1 = h01 + (h11 - h01) * fx;
        return h0 + (h1 - h0) * fz;
    }
    
    get_world_height(manager, world_x, world_z)
}
