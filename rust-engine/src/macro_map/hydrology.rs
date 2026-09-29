use super::MacroMap;
use super::MACRO_NODES;

impl MacroMap {
    pub(crate) fn simulate_hydrology(&mut self) {
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
}
