use crate::noise;

pub const WORLD_CHUNKS: usize = 64;
pub const MACRO_NODES: usize = WORLD_CHUNKS + 1;

pub mod tectonics;
pub mod climate;
pub mod hydrology;
pub mod biomes;

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

    pub fn get_elevation(&self, x: usize, z: usize) -> f32 {
        if x >= MACRO_NODES || z >= MACRO_NODES {
            return -500.0;
        }
        self.base_elevation[z * MACRO_NODES + x]
    }
}
