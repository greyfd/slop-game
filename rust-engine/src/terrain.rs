//! Terrain heightmap generation and mesh construction.
//!
//! Writes vertex/index data to the SAB via memory module.
//! Stores heightmap locally for CPU-side collision queries.

use crate::generated::TERRAIN_FLOATS_PER_VERTEX;
use crate::memory;

const GRID_SIZE: usize = 128;
const CELL_SIZE: f32 = 2.0;
const AMPLITUDE: f32 = 8.0;

const WORLD_WIDTH: f32 = (GRID_SIZE - 1) as f32 * CELL_SIZE;
const WORLD_DEPTH: f32 = (GRID_SIZE - 1) as f32 * CELL_SIZE;
const ORIGIN_X: f32 = -WORLD_WIDTH * 0.5;
const ORIGIN_Z: f32 = -WORLD_DEPTH * 0.5;

static mut HEIGHTMAP: Option<Vec<f32>> = None;

/// Generate heightmap, write mesh to SAB, store heightmap for collision.
pub fn generate() {
    let mut heights = vec![0.0f32; GRID_SIZE * GRID_SIZE];

    for gz in 0..GRID_SIZE {
        for gx in 0..GRID_SIZE {
            let wx = ORIGIN_X + gx as f32 * CELL_SIZE;
            let wz = ORIGIN_Z + gz as f32 * CELL_SIZE;

            let mut h: f32 = 0.0;
            h += (wx * 0.02).sin() * (wz * 0.03).cos() * AMPLITUDE * 0.6;
            h += (wx * 0.07 + 1.3).sin() * (wz * 0.05 + 0.7).sin() * AMPLITUDE * 0.25;
            h += (wx * 0.15 + 2.1).cos() * (wz * 0.12 + 1.5).sin() * AMPLITUDE * 0.1;
            h += (wx * 0.04 + wz * 0.03).sin() * AMPLITUDE * 0.15;
            h = h.max(-AMPLITUDE * 0.1);

            heights[gz * GRID_SIZE + gx] = h;
        }
    }

    // Write vertices to SAB
    let vertex_count = GRID_SIZE * GRID_SIZE;
    for gz in 0..GRID_SIZE {
        for gx in 0..GRID_SIZE {
            let wx = ORIGIN_X + gx as f32 * CELL_SIZE;
            let wz = ORIGIN_Z + gz as f32 * CELL_SIZE;
            let wy = heights[gz * GRID_SIZE + gx];
            let normal = compute_normal(&heights, gx, gz);

            let base = (gz * GRID_SIZE + gx) * TERRAIN_FLOATS_PER_VERTEX;
            memory::write_terrain_vertex_float(base, wx);
            memory::write_terrain_vertex_float(base + 1, wy);
            memory::write_terrain_vertex_float(base + 2, wz);
            memory::write_terrain_vertex_float(base + 3, normal[0]);
            memory::write_terrain_vertex_float(base + 4, normal[1]);
            memory::write_terrain_vertex_float(base + 5, normal[2]);
        }
    }

    // Write indices to SAB
    let quads = GRID_SIZE - 1;
    let index_count = quads * quads * 6;
    let mut ii = 0usize;
    for gz in 0..quads {
        for gx in 0..quads {
            let tl = (gz * GRID_SIZE + gx) as u32;
            let tr = tl + 1;
            let bl = ((gz + 1) * GRID_SIZE + gx) as u32;
            let br = bl + 1;

            memory::write_terrain_index(ii, tl);
            memory::write_terrain_index(ii + 1, bl);
            memory::write_terrain_index(ii + 2, tr);
            memory::write_terrain_index(ii + 3, tr);
            memory::write_terrain_index(ii + 4, bl);
            memory::write_terrain_index(ii + 5, br);

            ii += 6;
        }
    }

    memory::write_terrain_vertex_count(vertex_count as u32);
    memory::write_terrain_index_count(index_count as u32);
    memory::store_terrain_ready(1);

    unsafe { HEIGHTMAP = Some(heights); }
}

/// Bilinear height query for collision.
pub fn get_height(world_x: f32, world_z: f32) -> f32 {
    let heights = unsafe {
        match &HEIGHTMAP {
            Some(h) => h,
            None => return 0.0,
        }
    };

    let gxf = (world_x - ORIGIN_X) / CELL_SIZE;
    let gzf = (world_z - ORIGIN_Z) / CELL_SIZE;
    let max_g = (GRID_SIZE - 1) as f32;

    if gxf < 0.0 || gxf > max_g || gzf < 0.0 || gzf > max_g {
        return 0.0;
    }

    let gx0 = gxf.floor() as usize;
    let gz0 = gzf.floor() as usize;
    let gx1 = (gx0 + 1).min(GRID_SIZE - 1);
    let gz1 = (gz0 + 1).min(GRID_SIZE - 1);
    let fx = gxf - gx0 as f32;
    let fz = gzf - gz0 as f32;

    let h00 = heights[gz0 * GRID_SIZE + gx0];
    let h10 = heights[gz0 * GRID_SIZE + gx1];
    let h01 = heights[gz1 * GRID_SIZE + gx0];
    let h11 = heights[gz1 * GRID_SIZE + gx1];

    let h0 = h00 + (h10 - h00) * fx;
    let h1 = h01 + (h11 - h01) * fx;
    h0 + (h1 - h0) * fz
}

fn compute_normal(heights: &[f32], gx: usize, gz: usize) -> [f32; 3] {
    let hl = if gx > 0 { heights[gz * GRID_SIZE + gx - 1] } else { heights[gz * GRID_SIZE + gx] };
    let hr = if gx < GRID_SIZE - 1 { heights[gz * GRID_SIZE + gx + 1] } else { heights[gz * GRID_SIZE + gx] };
    let hd = if gz > 0 { heights[(gz - 1) * GRID_SIZE + gx] } else { heights[gz * GRID_SIZE + gx] };
    let hu = if gz < GRID_SIZE - 1 { heights[(gz + 1) * GRID_SIZE + gx] } else { heights[gz * GRID_SIZE + gx] };

    let nx = (hl - hr) / (2.0 * CELL_SIZE);
    let nz = (hd - hu) / (2.0 * CELL_SIZE);
    let ny = 1.0f32;
    let len = (nx * nx + ny * ny + nz * nz).sqrt();
    [nx / len, ny / len, nz / len]
}
