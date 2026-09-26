/**
 * Mat4 utility functions operating on Float32Array (16 elements, column-major).
 * Column-major layout matches WebGPU/WGSL mat4x4<f32>.
 *
 * Memory layout:
 *   [col0.x, col0.y, col0.z, col0.w,   // indices 0-3
 *    col1.x, col1.y, col1.z, col1.w,   // indices 4-7
 *    col2.x, col2.y, col2.z, col2.w,   // indices 8-11
 *    col3.x, col3.y, col3.z, col3.w]   // indices 12-15
 *
 * Which represents the matrix (row-major reading):
 *   | m[0]  m[4]  m[8]   m[12] |
 *   | m[1]  m[5]  m[9]   m[13] |
 *   | m[2]  m[6]  m[10]  m[14] |
 *   | m[3]  m[7]  m[11]  m[15] |
 */



export function mat4Create(): Float32Array {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
}

export function mat4Identity(out: Float32Array): Float32Array {
    out.fill(0);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
}

/**
 * Right-handed perspective projection with Z clip range [0, 1] for WebGPU.
 */
export function mat4Perspective(
    out: Float32Array,
    fovY: number,
    aspect: number,
    near: number,
    far: number
): Float32Array {
    const f = 1.0 / Math.tan(fovY * 0.5);
    const rangeInv = 1.0 / (near - far);

    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = far * rangeInv;        // maps far plane to Z=1
    out[11] = -1.0;                  // perspective divide
    out[14] = near * far * rangeInv; // maps near plane to Z=0
    return out;
}

/**
 * Build a right-handed lookAt view matrix.
 *
 * f = normalize(center - eye)       (forward)
 * s = normalize(cross(f, worldUp))  (right)
 * u = cross(s, f)                   (camera up)
 */
export function mat4LookAt(
    out: Float32Array,
    eye: Float32Array,
    center: Float32Array,
    up: Float32Array
): Float32Array {
    // Forward
    let fx = center[0] - eye[0];
    let fy = center[1] - eye[1];
    let fz = center[2] - eye[2];
    let len = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (len > 1e-6) {
        len = 1.0 / len;
        fx *= len;
        fy *= len;
        fz *= len;
    }

    // Right = cross(f, up)
    let sx = fy * up[2] - fz * up[1];
    let sy = fz * up[0] - fx * up[2];
    let sz = fx * up[1] - fy * up[0];
    len = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (len > 1e-6) {
        len = 1.0 / len;
        sx *= len;
        sy *= len;
        sz *= len;
    }

    // Camera up = cross(s, f)
    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;

    // Column-major storage
    out[0] = sx;
    out[1] = ux;
    out[2] = -fx;
    out[3] = 0;

    out[4] = sy;
    out[5] = uy;
    out[6] = -fy;
    out[7] = 0;

    out[8] = sz;
    out[9] = uz;
    out[10] = -fz;
    out[11] = 0;

    out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
    out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
    out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
    out[15] = 1;

    return out;
}

/**
 * Build a view matrix from position + yaw/pitch (FPS camera).
 *
 * Convention:
 *   yaw = 0   -> looking down -Z
 *   yaw > 0   -> turning left  (counterclockwise from above)
 *   pitch > 0 -> looking up
 *   pitch is clamped to (-PI/2, PI/2)
 */
export function mat4FpsView(
    out: Float32Array,
    position: Float32Array,
    yaw: number,
    pitch: number
): Float32Array {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    // Forward direction in world space (where camera is looking)
    const fx = -sy * cp;
    const fy = sp;
    const fz = -cy * cp;

    // Right = cross(forward, worldUp) = (cos(yaw), 0, -sin(yaw))
    const sx = cy;
    const sy2 = 0;
    const sz = -sy;

    // Camera up = cross(right, forward)
    const ux = sy2 * fz - sz * fy;  // 0*fz - (-sy)*fy = sy*sp
    const uy = sz * fx - sx * fz;   // (-sy)*(-sy*cp) - cy*(-cy*cp) = sy^2*cp + cy^2*cp = cp
    const uz = sx * fy - sy2 * fx;  // cy*sp - 0 = cy*sp

    // Column-major view matrix (same structure as lookAt)
    out[0] = sx;
    out[1] = ux;
    out[2] = -fx;
    out[3] = 0;

    out[4] = sy2;
    out[5] = uy;
    out[6] = -fy;
    out[7] = 0;

    out[8] = sz;
    out[9] = uz;
    out[10] = -fz;
    out[11] = 0;

    out[12] = -(sx * position[0] + sy2 * position[1] + sz * position[2]);
    out[13] = -(ux * position[0] + uy * position[1] + uz * position[2]);
    out[14] = fx * position[0] + fy * position[1] + fz * position[2];
    out[15] = 1;

    return out;
}

/**
 * Multiply two 4x4 matrices: out = a * b (column-major).
 */
export function mat4Multiply(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
    const a00 = a[0], a01 = a[4], a02 = a[8],  a03 = a[12];
    const a10 = a[1], a11 = a[5], a12 = a[9],  a13 = a[13];
    const a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14];
    const a30 = a[3], a31 = a[7], a32 = a[11], a33 = a[15];

    for (let col = 0; col < 4; col++) {
        const bi = col * 4;
        const b0 = b[bi], b1 = b[bi + 1], b2 = b[bi + 2], b3 = b[bi + 3];

        out[bi]     = a00 * b0 + a01 * b1 + a02 * b2 + a03 * b3;
        out[bi + 1] = a10 * b0 + a11 * b1 + a12 * b2 + a13 * b3;
        out[bi + 2] = a20 * b0 + a21 * b1 + a22 * b2 + a23 * b3;
        out[bi + 3] = a30 * b0 + a31 * b1 + a32 * b2 + a33 * b3;
    }

    return out;
}
