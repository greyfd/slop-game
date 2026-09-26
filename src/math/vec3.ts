/**
 * Vec3 utility functions operating on Float32Array.
 * All mutating functions take an `out` parameter to avoid per-frame allocations.
 */

export function vec3Create(x: number = 0, y: number = 0, z: number = 0): Float32Array {
    return new Float32Array([x, y, z]);
}

export function vec3Set(out: Float32Array, x: number, y: number, z: number): Float32Array {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
}

export function vec3Copy(out: Float32Array, a: Float32Array): Float32Array {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
}

export function vec3Add(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    return out;
}

export function vec3Sub(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    return out;
}

export function vec3Scale(out: Float32Array, a: Float32Array, s: number): Float32Array {
    out[0] = a[0] * s;
    out[1] = a[1] * s;
    out[2] = a[2] * s;
    return out;
}

export function vec3ScaleAndAdd(out: Float32Array, a: Float32Array, b: Float32Array, s: number): Float32Array {
    out[0] = a[0] + b[0] * s;
    out[1] = a[1] + b[1] * s;
    out[2] = a[2] + b[2] * s;
    return out;
}

export function vec3Dot(a: Float32Array, b: Float32Array): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
    const ax = a[0], ay = a[1], az = a[2];
    const bx = b[0], by = b[1], bz = b[2];
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
}

export function vec3Length(a: Float32Array): number {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function vec3Normalize(out: Float32Array, a: Float32Array): Float32Array {
    const len = vec3Length(a);
    if (len > 1e-6) {
        const invLen = 1.0 / len;
        out[0] = a[0] * invLen;
        out[1] = a[1] * invLen;
        out[2] = a[2] * invLen;
    } else {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
    }
    return out;
}

export function vec3Negate(out: Float32Array, a: Float32Array): Float32Array {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    return out;
}
