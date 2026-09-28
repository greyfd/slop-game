// 2D Simplex Noise implementation from first principles.
// No external dependencies to maintain zero-GC WebAssembly requirements.

const F2: f32 = 0.366025403784439; // 0.5 * (sqrt(3.0) - 1.0)
const G2: f32 = 0.211324865405187; // (3.0 - sqrt(3.0)) / 6.0

// Permutation table (0-255 duplicated to avoid wrap-around index logic)
const PERM: [u8; 512] = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69,
    142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
    203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
    74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230,
    220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76,
    132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173,
    186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206,
    59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163,
    70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232,
    178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162,
    241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204,
    176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141,
    128, 195, 78, 66, 215, 61, 156, 180, 151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194,
    233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234,
    75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174,
    20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83,
    111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25,
    63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188,
    159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147,
    118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170,
    213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253,
    19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193,
    238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31,
    181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
    222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

// Gradients for 2D Simplex Noise
const GRAD3: [[f32; 2]; 12] = [
    [1.0, 1.0], [-1.0, 1.0], [1.0, -1.0], [-1.0, -1.0],
    [1.0, 0.0], [-1.0, 0.0], [1.0, 0.0], [-1.0, 0.0],
    [0.0, 1.0], [0.0, -1.0], [0.0, 1.0], [0.0, -1.0],
];

fn dot(g: [f32; 2], x: f32, y: f32) -> f32 {
    g[0] * x + g[1] * y
}

/// Evaluates 2D Simplex Noise for a given coordinate.
/// Returns a value strictly in the range [-1.0, 1.0].
#[inline]
pub fn simplex_2d(seed: u32, x: f32, y: f32) -> f32 {
    // Offset the coordinates by a large, pseudo-random value based on the seed
    // to give each seed a unique noise map.
    let sx = x + (seed.wrapping_mul(1234567) as f32 % 100000.0);
    let sy = y + (seed.wrapping_mul(7654321) as f32 % 100000.0);

    // Skew the input space to determine which simplex cell we're in
    let s = (sx + sy) * F2;
    let i = (sx + s).floor() as i32;
    let j = (sy + s).floor() as i32;
    
    // Unskew the cell origin back to (x,y) space
    let t = (i + j) as f32 * G2;
    let x0 = i as f32 - t;
    let y0 = j as f32 - t;
    let x0 = sx - x0; // The x,y distances from the cell origin
    let y0 = sy - y0;
    
    // Determine which simplex we are in.
    let (i1, j1) = if x0 > y0 { (1, 0) } else { (0, 1) };
    
    // Offsets for second (middle) corner of simplex in (x,y) coords
    let x1 = x0 - i1 as f32 + G2;
    let y1 = y0 - j1 as f32 + G2;
    // Offsets for last corner in (x,y) coords
    let x2 = x0 - 1.0 + 2.0 * G2;
    let y2 = y0 - 1.0 + 2.0 * G2;
    
    // Wrap the integer indices at 256
    let ii = (i & 255) as usize;
    let jj = (j & 255) as usize;
    
    // Calculate the contribution from the three corners
    let mut n0 = 0.0;
    let mut n1 = 0.0;
    let mut n2 = 0.0;
    
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if t0 >= 0.0 {
        let gi0 = PERM[ii + PERM[jj] as usize] as usize % 12;
        let t0_sq = t0 * t0;
        n0 = t0_sq * t0_sq * dot(GRAD3[gi0], x0, y0);
    }
    
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if t1 >= 0.0 {
        let gi1 = PERM[ii + i1 + PERM[jj + j1] as usize] as usize % 12;
        let t1_sq = t1 * t1;
        n1 = t1_sq * t1_sq * dot(GRAD3[gi1], x1, y1);
    }
    
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if t2 >= 0.0 {
        let gi2 = PERM[ii + 1 + PERM[jj + 1] as usize] as usize % 12;
        let t2_sq = t2 * t2;
        n2 = t2_sq * t2_sq * dot(GRAD3[gi2], x2, y2);
    }
    
    // Add contributions from each corner to get the final noise value.
    // The result is scaled to return values in the interval [-1, 1].
    70.0 * (n0 + n1 + n2)
}

/// Evaluates Fractal Brownian Motion (fBm) using 2D Simplex Noise.
pub fn fbm_2d(seed: u32, x: f32, y: f32, octaves: usize, persistence: f32, lacunarity: f32) -> f32 {
    let mut total = 0.0;
    let mut frequency = 1.0;
    let mut amplitude = 1.0;
    let mut max_value = 0.0; // Used for normalizing result to [-1, 1]
    
    for _ in 0..octaves {
        total += simplex_2d(seed, x * frequency, y * frequency) * amplitude;
        max_value += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    total / max_value
}
