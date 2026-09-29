use super::MacroMap;
use super::MACRO_NODES;

impl MacroMap {
    pub(crate) fn simulate_biomes(&mut self) {
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
}
