pub fn point_line_distance(px: f32, pz: f32, x1: f32, z1: f32, x2: f32, z2: f32) -> f32 {
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

pub fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
