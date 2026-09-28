use crate::noise;

pub const WORLD_CHUNKS: usize = 64;
// Nodes are chunk corners, so there is 1 more node than chunks in each dimension
pub const MACRO_NODES: usize = WORLD_CHUNKS + 1;

/// The MacroMap acts as the global simulation context (Tier A).
/// It uses a Data-Oriented Design (Structure of Arrays) for fast iteration and cache coherence.
pub struct MacroMap {
    pub base_elevation: Vec<f32>,
    pub rainfall: Vec<f32>,
    pub temperature: Vec<f32>,
    pub biome: Vec<u8>,
    pub river_dx: Vec<f32>,
    pub river_dz: Vec<f32>,
    pub water_volume: Vec<f32>,
}

impl MacroMap {
    /// Generates the complete global macro map based on a procedural seed.
    pub fn generate(seed: u32) -> Self {
        let node_count = MACRO_NODES * MACRO_NODES;
        let mut map = MacroMap {
            base_elevation: vec![0.0; node_count],
            rainfall: vec![0.0; node_count],
            temperature: vec![0.0; node_count],
            biome: vec![0; node_count],
            river_dx: vec![0.0; node_count],
            river_dz: vec![0.0; node_count],
            water_volume: vec![0.0; node_count],
        };

        map.simulate_tectonics(seed);
        map.simulate_climate(seed);
        map.simulate_hydrology();
        map.simulate_biomes();
        
        map
    }

    /// Level 1: Lithospheric Architecture & Tectonic Foundations
    fn simulate_tectonics(&mut self, seed: u32) {
        let center = MACRO_NODES as f32 / 2.0;
        let max_dist = center;

        let tectonic_scale = 0.02;
        
        for z in 0..MACRO_NODES {
            for x in 0..MACRO_NODES {
                let idx = z * MACRO_NODES + x;
                
                let dx = x as f32 - center;
                let dz = z as f32 - center;
                let dist = (dx * dx + dz * dz).sqrt();
                
                let mask = (1.0 - (dist / max_dist)).clamp(0.0, 1.0);
                
                let mut elevation = noise::fbm_2d(seed, x as f32 * tectonic_scale, z as f32 * tectonic_scale, 4, 0.5, 2.0);
                
                // Shift baseline so FBM is roughly [0.0, 1.0] instead of [-1.0, 1.0]
                elevation = (elevation + 1.0) * 0.5;
                elevation *= 1000.0; // scale up to 1000m
                
                let final_elevation = elevation * mask - (1.0 - mask) * 500.0;
                self.base_elevation[idx] = final_elevation;
            }
        }
    }

    /// Level 2: Topography & Orographic Climate
    fn simulate_climate(&mut self, seed: u32) {
        use std::f32::consts::PI;
        
        // 1. Establish Global Wind Belts and Base Temperature based on Seed
        // A single map is 16.2km, so it exists entirely within one climate band.
        let seed_f32 = seed as f32;
        let angle = (seed_f32 * 0.1234).rem_euclid(PI * 2.0);
        let wind_dx = angle.cos();
        let wind_dz = angle.sin();
        
        let raw_temp = (noise::simplex_2d(seed + 1, 0.0, 0.0) + 1.0) * 50.0;
        let global_temp = raw_temp.clamp(40.0, 100.0); // Never generate cold sea-level map
        
        // Topologically sort grid nodes from upwind to downwind
        let mut sorted_nodes: Vec<usize> = (0..(MACRO_NODES * MACRO_NODES)).collect();
        sorted_nodes.sort_by(|&a, &b| {
            let ax = (a % MACRO_NODES) as f32;
            let az = (a / MACRO_NODES) as f32;
            let bx = (b % MACRO_NODES) as f32;
            let bz = (b / MACRO_NODES) as f32;
            
            let dot_a = ax * wind_dx + az * wind_dz;
            let dot_b = bx * wind_dx + bz * wind_dz;
            dot_a.partial_cmp(&dot_b).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Track moisture in the air moving across the map
        let mut moisture = vec![0.0f32; MACRO_NODES * MACRO_NODES];
        
        // Ocean acts as an infinite moisture source
        for i in 0..(MACRO_NODES * MACRO_NODES) {
            if self.base_elevation[i] <= 0.0 {
                moisture[i] = 100.0;
            }
            
            // Lapse rate: temperature drops with altitude (~6.5C per 1000m, exaggerated for gameplay)
            let elev = self.base_elevation[i].max(0.0);
            let t = global_temp - (elev / 1000.0) * 30.0;
            self.temperature[i] = t.clamp(0.0, 100.0);
        }

        // 2. Orographic Precipitation Sweep
        for &idx in &sorted_nodes {
            let x = idx % MACRO_NODES;
            let z = idx / MACRO_NODES;
            let elev = self.base_elevation[idx];
            
            let current_moisture = moisture[idx];
            
            if elev <= 0.0 {
                self.rainfall[idx] = 100.0; // Oceans have max rain
            } else {
                // Sample elevation upwind to calculate terrain slope
                let upwind_x = x as f32 - wind_dx;
                let upwind_z = z as f32 - wind_dz;
                let upwind_elev = self.sample_elevation_bilerp(upwind_x, upwind_z);
                
                let slope = elev - upwind_elev;
                
                // Orographic Lift: Mountains force air up, cooling it and dumping rain
                let rain = if slope > 0.0 {
                    (slope * 0.4).clamp(0.0, current_moisture)
                } else {
                    // Rain Shadow / Flat Land: Base rain is very low
                    1.5_f32.min(current_moisture)
                };
                
                self.rainfall[idx] = rain;
                moisture[idx] = current_moisture - rain; // Deplete moisture
            }
            
            // Push remaining moisture downwind to the nearest neighbor
            let downwind_x = x as f32 + wind_dx;
            let downwind_z = z as f32 + wind_dz;
            let nx = downwind_x.round() as i32;
            let nz = downwind_z.round() as i32;
            
            if nx >= 0 && nx < MACRO_NODES as i32 && nz >= 0 && nz < MACRO_NODES as i32 {
                let nidx = (nz as usize) * MACRO_NODES + (nx as usize);
                // The downwind node inherits the strongest moisture front hitting it
                if moisture[idx] > moisture[nidx] {
                    moisture[nidx] = moisture[idx];
                }
            }
        }
    }
    
    /// Bilinear interpolation helper for sampling elevation between nodes
    fn sample_elevation_bilerp(&self, x: f32, z: f32) -> f32 {
        let x = x.clamp(0.0, MACRO_NODES as f32 - 1.0);
        let z = z.clamp(0.0, MACRO_NODES as f32 - 1.0);
        
        let x0 = x.floor() as usize;
        let z0 = z.floor() as usize;
        let x1 = (x0 + 1).min(MACRO_NODES - 1);
        let z1 = (z0 + 1).min(MACRO_NODES - 1);
        
        let fx = x - x0 as f32;
        let fz = z - z0 as f32;
        
        let h00 = self.base_elevation[z0 * MACRO_NODES + x0];
        let h10 = self.base_elevation[z0 * MACRO_NODES + x1];
        let h01 = self.base_elevation[z1 * MACRO_NODES + x0];
        let h11 = self.base_elevation[z1 * MACRO_NODES + x1];
        
        let h0 = h00 + (h10 - h00) * fx;
        let h1 = h01 + (h11 - h01) * fx;
        h0 + (h1 - h0) * fz
    }

    
    /// Level 3: Hydrology, Erosion & Fluvial Networks
    fn simulate_hydrology(&mut self) {
        // 1. Planchon-Darboux Depression Filling
        let mut water_level = vec![f32::MAX; MACRO_NODES * MACRO_NODES];
        for i in 0..MACRO_NODES * MACRO_NODES {
            if self.base_elevation[i] <= 0.0 {
                water_level[i] = self.base_elevation[i];
            }
        }
        let mut changed = true;
        while changed {
            changed = false;
            for z in 0..MACRO_NODES {
                for x in 0..MACRO_NODES {
                    let i = z * MACRO_NODES + x;
                    if self.base_elevation[i] <= 0.0 { continue; }
                    
                    let mut min_neighbor = f32::MAX;
                    for dx in -1..=1 {
                        for dz in -1..=1 {
                            if dx == 0 && dz == 0 { continue; }
                            let nx = x as i32 + dx;
                            let nz = z as i32 + dz;
                            if nx >= 0 && nx < MACRO_NODES as i32 && nz >= 0 && nz < MACRO_NODES as i32 {
                                let ni = (nz as usize) * MACRO_NODES + (nx as usize);
                                if water_level[ni] < min_neighbor {
                                    min_neighbor = water_level[ni];
                                }
                            }
                        }
                    }
                    
                    let new_level = self.base_elevation[i].max(min_neighbor + 0.01);
                    if new_level < water_level[i] {
                        water_level[i] = new_level;
                        changed = true;
                    }
                }
            }
        }
        
        // Lake Filling vs Salt Flats
        let mut visited = vec![false; MACRO_NODES * MACRO_NODES];
        for i in 0..MACRO_NODES * MACRO_NODES {
            if !visited[i] && water_level[i] > self.base_elevation[i] {
                let mut lake_nodes = Vec::new();
                let mut stack = vec![i];
                visited[i] = true;
                
                let mut total_rain = 0.0;
                
                while let Some(curr) = stack.pop() {
                    lake_nodes.push(curr);
                    total_rain += self.rainfall[curr];
                    
                    let cx = curr % MACRO_NODES;
                    let cz = curr / MACRO_NODES;
                    
                    for dx in -1..=1 {
                        for dz in -1..=1 {
                            if dx == 0 && dz == 0 { continue; }
                            let nx = cx as i32 + dx;
                            let nz = cz as i32 + dz;
                            if nx >= 0 && nx < MACRO_NODES as i32 && nz >= 0 && nz < MACRO_NODES as i32 {
                                let ni = (nz as usize) * MACRO_NODES + (nx as usize);
                                if !visited[ni] && water_level[ni] > self.base_elevation[ni] {
                                    visited[ni] = true;
                                    stack.push(ni);
                                }
                            }
                        }
                    }
                }
                
                let avg_rain = total_rain / lake_nodes.len() as f32;
                if avg_rain > 5.0 { // EVAPORATION_THRESHOLD
                    // Highland lake: fills to brim and overflows
                    for &node in &lake_nodes {
                        self.base_elevation[node] = water_level[node];
                    }
                } else {
                    // Desert sink: remains a pit (Salt Flat)
                    for &node in &lake_nodes {
                        self.biome[node] = 9; // Salt Flat
                    }
                }
            }
        }
        
        // 2. Spawn Headwaters using Weighted Poisson-like distribution
        let mut node_scores: Vec<(usize, f32)> = (0..MACRO_NODES * MACRO_NODES).map(|i| {
            let score = (self.rainfall[i] * 2.0) + self.base_elevation[i];
            (i, score)
        }).collect();
        node_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        let mut springs = Vec::new();
        for (idx, _) in node_scores {
            if self.base_elevation[idx] <= 0.0 { continue; }
            let x = (idx % MACRO_NODES) as f32;
            let z = (idx / MACRO_NODES) as f32;
            
            let mut valid = true;
            for &(sx, sz) in &springs {
                let dx = x - sx;
                let dz = z - sz;
                if dx * dx + dz * dz < 9.0 { // Minimum spacing squared (3.0^2)
                    valid = false;
                    break;
                }
            }
            if valid {
                springs.push((x, z));
                if springs.len() >= 40 { break; } // MAX_RIVER_SOURCES
            }
        }
        
        // 3. Trace Rivers with Inertial Momentum
        for (sx, sz) in springs {
            let mut cx = sx.round() as usize;
            let mut cz = sz.round() as usize;
            let mut current_vector = (0.0f32, 0.0f32);
            let mut volume = 1.0f32;
            
            loop {
                let c_idx = cz * MACRO_NODES + cx;
                self.water_volume[c_idx] += volume;
                
                if self.base_elevation[c_idx] <= 0.0 {
                    break; // Ocean mouth
                }
                
                let mut best_neighbor = None;
                let mut best_score = -f32::MAX;
                let elev = self.base_elevation[c_idx];
                
                for dx in -1..=1 {
                    for dz in -1..=1 {
                        if dx == 0 && dz == 0 { continue; }
                        let nx = cx as i32 + dx;
                        let nz = cz as i32 + dz;
                        
                        if nx >= 0 && nx < MACRO_NODES as i32 && nz >= 0 && nz < MACRO_NODES as i32 {
                            let n_idx = (nz as usize) * MACRO_NODES + (nx as usize);
                            let n_elev = self.base_elevation[n_idx];
                            
                            if n_elev < elev {
                                let slope = elev - n_elev;
                                let len = ((dx * dx + dz * dz) as f32).sqrt();
                                let dir_x = dx as f32 / len;
                                let dir_z = dz as f32 / len;
                                
                                let mut momentum_bonus = 1.0;
                                if current_vector.0 != 0.0 || current_vector.1 != 0.0 {
                                    let dot = dir_x * current_vector.0 + dir_z * current_vector.1;
                                    if dot < 0.707 { // Turn is tighter than 45 degrees
                                        momentum_bonus = 0.5;
                                    } else {
                                        momentum_bonus = 1.0 + dot * 0.5; // Reward straight path
                                    }
                                }
                                
                                let score = (slope / len) * momentum_bonus;
                                if score > best_score {
                                    best_score = score;
                                    best_neighbor = Some((nx as usize, nz as usize, dx, dz, dir_x, dir_z));
                                }
                            }
                        }
                    }
                }
                
                match best_neighbor {
                    Some((nx, nz, dx, dz, dir_x, dir_z)) => {
                        self.river_dx[c_idx] = dx as f32; // Store raw grid-step vector
                        self.river_dz[c_idx] = dz as f32;
                        
                        if current_vector.0 == 0.0 && current_vector.1 == 0.0 {
                            current_vector = (dir_x, dir_z);
                        } else {
                            // 70% steepest descent, 30% inertia
                            let ix = 0.7 * dir_x + 0.3 * current_vector.0;
                            let iz = 0.7 * dir_z + 0.3 * current_vector.1;
                            let ilen = (ix * ix + iz * iz).sqrt();
                            current_vector = (ix / ilen, iz / ilen);
                        }
                        
                        cx = nx;
                        cz = nz;
                        volume += 1.0;
                    },
                    None => break, // Hit a local minima (Salt Flat sink)
                }
            }
        }
    }
    
    /// Level 4: Biomes & Ecological Classification
    fn simulate_biomes(&mut self) {
        for i in 0..MACRO_NODES * MACRO_NODES {
            if self.base_elevation[i] <= 0.0 {
                self.biome[i] = 10; // Ocean
                continue;
            }
            if self.biome[i] == 9 {
                continue; // Salt flat (assigned during hydrology)
            }
            
            let temp = self.temperature[i];
            let rain = self.rainfall[i];
            
            let temp_idx = if temp < 33.3 {
                0 // Cold
            } else if temp < 66.6 {
                1 // Cool
            } else {
                2 // Mild
            };
            
            let rain_idx = if rain < 5.0 {
                0 // Dry
            } else if rain < 20.0 {
                1 // Moderate
            } else {
                2 // Wet
            };
            
            self.biome[i] = (temp_idx * 3 + rain_idx) as u8;
        }
    }
    
    /// Queries the base elevation of the nearest node. Used primarily by the engine logic if needed.
    pub fn get_elevation(&self, x: usize, z: usize) -> f32 {
        if x >= MACRO_NODES || z >= MACRO_NODES {
            return -500.0;
        }
        self.base_elevation[z * MACRO_NODES + x]
    }
}
