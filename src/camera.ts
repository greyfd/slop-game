/**
 * First-person camera.
 *
 * Maintains projection and view matrices, updated per frame.
 * Provides horizontal forward/right vectors for ground-plane movement.
 */

import { mat4Create, mat4Perspective, mat4FpsView, mat4Multiply } from './math/mat4';
import { vec3Create } from './math/vec3';

export class Camera {
    readonly position: Float32Array = vec3Create(0, 5, 0);
    yaw: number = 0;
    pitch: number = 0;

    readonly projectionMatrix: Float32Array = mat4Create();
    readonly viewMatrix: Float32Array = mat4Create();
    readonly viewProjectionMatrix: Float32Array = mat4Create();

    updateProjection(fovY: number, aspect: number, near: number, far: number): void {
        mat4Perspective(this.projectionMatrix, fovY, aspect, near, far);
    }

    updateView(): void {
        mat4FpsView(this.viewMatrix, this.position, this.yaw, this.pitch);
        mat4Multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    }

    /**
     * Horizontal forward direction (for WASD movement, ignores pitch).
     * Returns (x, 0, z) normalized.
     */
    getForwardXZ(out: Float32Array): Float32Array {
        const sy = Math.sin(this.yaw);
        const cy = Math.cos(this.yaw);
        out[0] = -sy;
        out[1] = 0;
        out[2] = -cy;
        return out;
    }

    /**
     * Horizontal right direction (for WASD movement, ignores pitch).
     * Returns (x, 0, z) normalized.
     */
    getRightXZ(out: Float32Array): Float32Array {
        const sy = Math.sin(this.yaw);
        const cy = Math.cos(this.yaw);
        out[0] = cy;
        out[1] = 0;
        out[2] = -sy;
        return out;
    }
}
