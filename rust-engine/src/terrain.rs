//! Terrain Chunk Manager with Object Pooling and Simplex Noise
use crate::generated::{TERRAIN_CHUNK_COUNT, TERRAIN_CHUNK_RADIUS, TERRAIN_FLOATS_PER_VERTEX};
use crate::memory;
use crate::macro_map::{MacroMap, MACRO_NODES, WORLD_CHUNKS};
use crate::noise;
use std::collections::HashMap;

const GRID_SIZE: usize = 128;
const CELL_SIZE: f32 = 2.0;
const CHUNK_WORLD_SIZE: f32 = (GRID_SIZE - 1) as f32 * CELL_SIZE;

fn point_line_distance(px: f32, pz: f32, x1: f32, z1: f32, x2: f32, z2: f32) -> f32 {
    let l2 = (x2 - x1)*(x2 - x1) + (z2 - z1)*(z2 - z1);
    if l2 == 0.0 {
        return ((px - x1)*(px - x1) + (pz - z1)*(pz - z1)).sqrt();
    }
    let t = ((px - x1)*(x2 - x1) + (pz - z1)*(z2 - z1)) / l2;
    let t = t.clamp(0.0, 1.0);
    let proj_x = x1 + t * (x2 - x1);
    let proj_z = z1 + t * (z2 - z1);
    ((px - proj_x)*(px - proj_x) + (pz - proj_z)*(pz - proj_z)).sqrt()
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn get_biome_color(biome: u8) -> [f32; 3] {
    match biome {
        0 => [0.55, 0.55, 0.55], // Polar Desert
        1 => [0.65, 0.65, 0.70], // Alpine Tundra (frosty slate)
        2 => [0.95, 0.98, 1.00], // Glacier
        3 => [0.75, 0.65, 0.40], // Highland Steppe
        4 => [0.25, 0.35, 0.25], // Boreal Forest
        5 => [0.15, 0.40, 0.20], // Temperate Rainforest
        6 => [0.80, 0.45, 0.30], // High Desert
        7 => [0.70, 0.35, 0.15], // Deciduous Woodlands
        8 => [0.10, 0.25, 0.15], // Redwood Coast
        9 => [0.90, 0.85, 0.80], // Salt Flat
        10=> [0.15, 0.30, 0.50], // Ocean/Water
        _ => [1.00, 0.00, 1.00], // Magenta error
    }
}

// Get raw mathematical world height (fallback and edge cases)
fn get_world_height(manager: &ChunkManager, world_x: f32, world_z: f32) -> f32 {
    let offset_chunks = WORLD_CHUNKS as f32 / 2.0;
    
    // Position in chunks relative to bottom-left of macro map
    let chunk_xf = (world_x / CHUNK_WORLD_SIZE) + offset_chunks;
    let chunk_zf = (world_z / CHUNK_WORLD_SIZE) + offset_chunks;
    
    let mx0 = (chunk_xf.floor() as i32).clamp(0, MACRO_NODES as i32 - 1) as usize;
    let mz0 = (chunk_zf.floor() as i32).clamp(0, MACRO_NODES as i32 - 1) as usize;
    let mx1 = (mx0 + 1).min(MACRO_NODES - 1);
    let mz1 = (mz0 + 1).min(MACRO_NODES - 1);
    
    let fx = chunk_xf - chunk_xf.floor();
    let fz = chunk_zf - chunk_zf.floor();
    
    let h00 = manager.macro_map.get_elevation(mx0, mz0);
    let h10 = manager.macro_map.get_elevation(mx1, mz0);
    let h01 = manager.macro_map.get_elevation(mx0, mz1);
    let h11 = manager.macro_map.get_elevation(mx1, mz1);
    
    let h0 = h00 + (h10 - h00) * fx;
    let h1 = h01 + (h11 - h01) * fx;
    let base_height = h0 + (h1 - h0) * fz;
    
    // Check 3x3 macro neighborhood for rivers
    let mut river_mask = 0.0;
    let mut max_trench = 0.0;
    for dx in -1..=1 {
        for dz in -1..=1 {
            let mx = (mx0 as i32 + dx).clamp(0, MACRO_NODES as i32 - 1) as usize;
            let mz = (mz0 as i32 + dz).clamp(0, MACRO_NODES as i32 - 1) as usize;
            let idx = mz * MACRO_NODES + mx;
            
            let rdx = manager.macro_map.river_dx[idx];
            let rdz = manager.macro_map.river_dz[idx];
            if rdx != 0.0 || rdz != 0.0 {
                let volume = manager.macro_map.water_volume[idx];
                let width = 4.0 + volume.sqrt() * 1.5;
                let nx = (mx as f32 - WORLD_CHUNKS as f32 / 2.0) * CHUNK_WORLD_SIZE;
                let nz = (mz as f32 - WORLD_CHUNKS as f32 / 2.0) * CHUNK_WORLD_SIZE;
                let end_x = nx + rdx * CHUNK_WORLD_SIZE;
                let end_z = nz + rdz * CHUNK_WORLD_SIZE;
                
                let dist = point_line_distance(world_x, world_z, nx, nz, end_x, end_z);
                let mask = 1.0 - smoothstep(0.0, width, dist);
                if mask > river_mask {
                    river_mask = mask;
                    max_trench = width * 0.3;
                }
            }
        }
    }
    
    let micro_noise = noise::fbm_2d(42, world_x * 0.002, world_z * 0.002, 4, 0.5, 2.0) * 12.0;
    let flattened_noise = micro_noise * (1.0 - river_mask);
    
    base_height + flattened_noise - (river_mask * max_trench)
}

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

fn generate_chunk(manager: &ChunkManager, slot: usize, cx: i32, cz: i32) -> Vec<f32> {
    let mut heights = vec![0.0f32; GRID_SIZE * GRID_SIZE];
    let origin_x = cx as f32 * CHUNK_WORLD_SIZE;
    let origin_z = cz as f32 * CHUNK_WORLD_SIZE;

    // PRE-FETCH MACRO NODES
    // Evaluate the 4 bounding box Macro Nodes surrounding this chunk
    let offset_chunks = WORLD_CHUNKS as i32 / 2;
    let mx0 = (cx + offset_chunks).clamp(0, MACRO_NODES as i32 - 1) as usize;
    let mz0 = (cz + offset_chunks).clamp(0, MACRO_NODES as i32 - 1) as usize;
    let mx1 = (mx0 + 1).min(MACRO_NODES - 1);
    let mz1 = (mz0 + 1).min(MACRO_NODES - 1);

    let h00 = manager.macro_map.get_elevation(mx0, mz0);
    let h10 = manager.macro_map.get_elevation(mx1, mz0);
    let h01 = manager.macro_map.get_elevation(mx0, mz1);
    let h11 = manager.macro_map.get_elevation(mx1, mz1);

    // PRE-FETCH RIVER SEGMENTS IN 4x4 MACRO NEIGHBORHOOD
    let mut river_segments = Vec::new();
    for dx in -1..=2 {
        for dz in -1..=2 {
            let mx = (mx0 as i32 + dx).clamp(0, MACRO_NODES as i32 - 1) as usize;
            let mz = (mz0 as i32 + dz).clamp(0, MACRO_NODES as i32 - 1) as usize;
            
            let idx = mz * MACRO_NODES + mx;
            let rdx = manager.macro_map.river_dx[idx];
            let rdz = manager.macro_map.river_dz[idx];
            
            if rdx != 0.0 || rdz != 0.0 {
                let volume = manager.macro_map.water_volume[idx];
                let width = 4.0 + volume.sqrt() * 1.5; // Base 4m + √vol scaling
                
                let nx = (mx as f32 - WORLD_CHUNKS as f32 / 2.0) * CHUNK_WORLD_SIZE;
                let nz = (mz as f32 - WORLD_CHUNKS as f32 / 2.0) * CHUNK_WORLD_SIZE;
                let end_x = nx + rdx * CHUNK_WORLD_SIZE;
                let end_z = nz + rdz * CHUNK_WORLD_SIZE;
                
                river_segments.push((nx, nz, end_x, end_z, width));
            }
        }
    }

    // A. Generate Heightmap math with mathematically guaranteed C0 continuity
    for gz in 0..GRID_SIZE {
        let fz = gz as f32 / (GRID_SIZE - 1) as f32;
        // bilerp along z first:
        let hz0 = h00 + (h01 - h00) * fz;
        let hz1 = h10 + (h11 - h10) * fz;
        
        for gx in 0..GRID_SIZE {
            let fx = gx as f32 / (GRID_SIZE - 1) as f32;
            let base_height = hz0 + (hz1 - hz0) * fx;
            
            let wx = origin_x + gx as f32 * CELL_SIZE;
            let wz = origin_z + gz as f32 * CELL_SIZE;
            
            // Carve Rivers
            let mut river_mask = 0.0;
            let mut max_trench = 0.0;
            for &(x1, z1, x2, z2, width) in &river_segments {
                let dist = point_line_distance(wx, wz, x1, z1, x2, z2);
                let mask = 1.0 - smoothstep(0.0, width, dist);
                if mask > river_mask {
                    river_mask = mask;
                    max_trench = width * 0.3; // trench depth is 30% of width
                }
            }
            
            let micro_noise = noise::fbm_2d(42, wx * 0.002, wz * 0.002, 4, 0.5, 2.0) * 12.0;
            
            // Flatten micro noise in riverbed to guarantee monotonic descent
            let flattened_noise = micro_noise * (1.0 - river_mask);
            
            heights[gz * GRID_SIZE + gx] = base_height + flattened_noise - (river_mask * max_trench);
        }
    }

    let c00 = get_biome_color(manager.macro_map.biome[mz0 * MACRO_NODES + mx0]);
    let c10 = get_biome_color(manager.macro_map.biome[mz0 * MACRO_NODES + mx1]);
    let c01 = get_biome_color(manager.macro_map.biome[mz1 * MACRO_NODES + mx0]);
    let c11 = get_biome_color(manager.macro_map.biome[mz1 * MACRO_NODES + mx1]);

    // B. Compute Normals and Write Interleaved Vertices
    for gz in 0..GRID_SIZE {
        let fz = gz as f32 / (GRID_SIZE - 1) as f32;
        let c0 = [
            c00[0] + (c01[0] - c00[0]) * fz,
            c00[1] + (c01[1] - c00[1]) * fz,
            c00[2] + (c01[2] - c00[2]) * fz,
        ];
        let c1 = [
            c10[0] + (c11[0] - c10[0]) * fz,
            c10[1] + (c11[1] - c10[1]) * fz,
            c10[2] + (c11[2] - c10[2]) * fz,
        ];

        for gx in 0..GRID_SIZE {
            let fx = gx as f32 / (GRID_SIZE - 1) as f32;
            let wx = origin_x + gx as f32 * CELL_SIZE;
            let wz = origin_z + gz as f32 * CELL_SIZE;
            let wy = heights[gz * GRID_SIZE + gx];
            
            let hl = if gx > 0 { heights[gz * GRID_SIZE + gx - 1] } else { get_world_height(manager, wx - CELL_SIZE, wz) };
            let hr = if gx < GRID_SIZE - 1 { heights[gz * GRID_SIZE + gx + 1] } else { get_world_height(manager, wx + CELL_SIZE, wz) };
            let hd = if gz > 0 { heights[(gz - 1) * GRID_SIZE + gx] } else { get_world_height(manager, wx, wz - CELL_SIZE) };
            let hu = if gz < GRID_SIZE - 1 { heights[(gz + 1) * GRID_SIZE + gx] } else { get_world_height(manager, wx, wz + CELL_SIZE) };

            let nx = (hl - hr) / (2.0 * CELL_SIZE);
            let nz = (hd - hu) / (2.0 * CELL_SIZE);
            let ny = 1.0f32;
            let len = (nx * nx + ny * ny + nz * nz).sqrt();
            let normal = [nx / len, ny / len, nz / len];

            // Interpolated biome color
            let color = [
                c0[0] + (c1[0] - c0[0]) * fx,
                c0[1] + (c1[1] - c0[1]) * fx,
                c0[2] + (c1[2] - c0[2]) * fx,
            ];

            let base = (gz * GRID_SIZE + gx) * TERRAIN_FLOATS_PER_VERTEX;
            memory::write_chunk_vertex_float(slot, base, wx);
            memory::write_chunk_vertex_float(slot, base + 1, wy);
            memory::write_chunk_vertex_float(slot, base + 2, wz);
            memory::write_chunk_vertex_float(slot, base + 3, normal[0]);
            memory::write_chunk_vertex_float(slot, base + 4, normal[1]);
            memory::write_chunk_vertex_float(slot, base + 5, normal[2]);
            memory::write_chunk_vertex_float(slot, base + 6, color[0]);
            memory::write_chunk_vertex_float(slot, base + 7, color[1]);
            memory::write_chunk_vertex_float(slot, base + 8, color[2]);
        }
    }

    // C. Write Triangle Indices
    let quads = GRID_SIZE - 1;
    let mut ii = 0usize;
    for gz in 0..quads {
        for gx in 0..quads {
            let tl = (gz * GRID_SIZE + gx) as u32;
            let tr = tl + 1;
            let bl = ((gz + 1) * GRID_SIZE + gx) as u32;
            let br = bl + 1;

            memory::write_chunk_index(slot, ii, tl);
            memory::write_chunk_index(slot, ii + 1, bl);
            memory::write_chunk_index(slot, ii + 2, tr);
            memory::write_chunk_index(slot, ii + 3, tr);
            memory::write_chunk_index(slot, ii + 4, bl);
            memory::write_chunk_index(slot, ii + 5, br);
            ii += 6;
        }
    }

    memory::write_terrain_chunk_meta(slot, 2, cx, cz);
    heights
}

/// Bilinear height query for collision.
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
