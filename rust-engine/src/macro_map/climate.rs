use super::MacroMap;
use crate::noise;
use super::MACRO_NODES;

impl MacroMap {
    pub(crate) fn simulate_climate(&mut self, seed: u32) {
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

    pub(crate) fn sample_elevation_bilerp(&self, x: f32, z: f32) -> f32 {
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
}
