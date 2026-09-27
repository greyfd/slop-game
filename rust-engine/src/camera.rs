//! Camera module.
//!
//! Computes the FPS view matrix from position, yaw, and pitch.
//! Uses the same convention as the TypeScript version:
//!   - yaw = 0 -> looking down -Z
//!   - yaw > 0 -> turning left (counterclockwise from above)
//!   - pitch > 0 -> looking up
//!   - Right-handed coordinate system, Y-up
//!
//! The view matrix is written to the SAB for the main thread to read.
//! The main thread computes the projection matrix locally (handles resize).

use glam::{Vec3, Mat4};

/// Build a right-handed FPS view matrix (column-major, matching WebGPU).
///
/// Returns a [f32; 16] in column-major order for direct SAB write.
pub fn fps_view_matrix(position: Vec3, yaw: f32, pitch: f32) -> [f32; 16] {
    let cy = yaw.cos();
    let sy = yaw.sin();
    let cp = pitch.cos();
    let sp = pitch.sin();

    // Forward direction in world space
    let fx = -sy * cp;
    let fy = sp;
    let fz = -cy * cp;

    // Right vector = cross(forward, world_up)
    let sx = cy;
    let sy2: f32 = 0.0;
    let sz = -sy;

    // Camera up = cross(right, forward)
    let ux = sy * sp;       // sy2 * fz - sz * fy = 0 - (-sy)*sp
    let uy = cp;             // sz * fx - sx * fz = (-sy)*(-sy*cp) - cy*(-cy*cp) = cp
    let uz = cy * sp;        // sx * fy - sy2 * fx = cy*sp - 0

    // Translation component
    let tx = -(sx * position.x + sy2 * position.y + sz * position.z);
    let ty = -(ux * position.x + uy * position.y + uz * position.z);
    let tz = fx * position.x + fy * position.y + fz * position.z;

    // Column-major layout for WebGPU mat4x4<f32>
    [
        sx,   ux,  -fx,  0.0,   // column 0
        sy2,  uy,  -fy,  0.0,   // column 1
        sz,   uz,  -fz,  0.0,   // column 2
        tx,   ty,   tz,  1.0,   // column 3
    ]
}
