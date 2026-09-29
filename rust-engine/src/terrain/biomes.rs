pub fn get_biome_color(biome: u8) -> [f32; 3] {
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
