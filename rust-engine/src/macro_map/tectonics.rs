use super::MacroMap;
use crate::noise;
use super::MACRO_NODES;

impl MacroMap {
    pub(crate) fn simulate_tectonics(&mut self, seed: u32) {
        let center = MACRO_NODES as f32 / 2.0;
        let max_dist = center;

        let tectonic_scale = 0.02;
        
        for z in 0..MACRO_NODES {
            for x in 0..MACRO_NODES {
                let idx = z * MACRO_NODES + x;
                
                let dx = x as f32 - center;
                let dz = z as f32 - center;
                let dist = (dx * dx + dz * dz).sqrt();
                
                let t = (dist / max_dist).clamp(0.0, 1.0);
                // Keep mask at 1.0 for most of the map, only drop off at the very edge (90% land)
                // We'll manually compute a smooth dropoff from 0.85 to 1.0
                let edge0 = 0.85;
                let edge1 = 1.0;
                let mask = if t < edge0 {
                    1.0
                } else if t > edge1 {
                    0.0
                } else {
                    let st = (t - edge0) / (edge1 - edge0);
                    1.0 - (st * st * (3.0 - 2.0 * st))
                };
                
                let mut elevation = noise::fbm_2d(seed, x as f32 * tectonic_scale, z as f32 * tectonic_scale, 4, 0.5, 2.0);
                
                // Shift baseline so FBM is roughly [0.0, 1.0] instead of [-1.0, 1.0]
                elevation = (elevation + 1.0) * 0.5;
                elevation *= 1000.0; // scale up to 1000m
                
                // Use original math, but with the new flat plateau mask
                let final_elevation = elevation * mask - (1.0 - mask) * 500.0;
                self.base_elevation[idx] = final_elevation;
            }
        }
    }
}
