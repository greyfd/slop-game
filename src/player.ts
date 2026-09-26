/**
 * First-person character controller.
 *
 * Handles WASD movement, mouse look, gravity, and jump.
 * Queries a heightmap for ground collision (vertical raycast).
 */

import { Input } from './input';
import { Camera } from './camera';
import { vec3Create } from './math/vec3';
import { Heightmap } from './terrain/heightmap';

const MOVE_SPEED = 10.0;        // units per second
const MOUSE_SENSITIVITY = 0.002; // radians per pixel
const GRAVITY = -20.0;           // units/s^2
const JUMP_VELOCITY = 8.0;       // units/s upward
const PLAYER_HEIGHT = 1.7;       // eye height above ground
const MAX_PITCH = Math.PI * 0.49; // just under 90 degrees

export class Player {
    readonly camera: Camera = new Camera();

    private readonly velocity: Float32Array = vec3Create();
    private onGround: boolean = false;

    // Scratch vectors to avoid per-frame allocation
    private readonly tmpForward: Float32Array = vec3Create();
    private readonly tmpRight: Float32Array = vec3Create();

    /**
     * Run one simulation tick.
     * @param dt Delta time in seconds (capped externally).
     * @param input The current input state.
     * @param heightmap The terrain heightmap for ground collision.
     */
    update(dt: number, input: Input, heightmap: Heightmap): void {
        // --- Mouse look ---
        if (input.isPointerLocked()) {
            // Mouse right = positive movementX -> decrease yaw (turn right)
            this.camera.yaw -= input.mouseDeltaX * MOUSE_SENSITIVITY;
            this.camera.pitch -= input.mouseDeltaY * MOUSE_SENSITIVITY;

            // Clamp pitch
            if (this.camera.pitch > MAX_PITCH) this.camera.pitch = MAX_PITCH;
            if (this.camera.pitch < -MAX_PITCH) this.camera.pitch = -MAX_PITCH;
        }
        input.resetDeltas();

        // --- Horizontal movement ---
        const forward = this.camera.getForwardXZ(this.tmpForward);
        const right = this.camera.getRightXZ(this.tmpRight);

        let moveX = 0;
        let moveZ = 0;

        if (input.isKeyDown('KeyW')) {
            moveX += forward[0];
            moveZ += forward[2];
        }
        if (input.isKeyDown('KeyS')) {
            moveX -= forward[0];
            moveZ -= forward[2];
        }
        if (input.isKeyDown('KeyD')) {
            moveX += right[0];
            moveZ += right[2];
        }
        if (input.isKeyDown('KeyA')) {
            moveX -= right[0];
            moveZ -= right[2];
        }

        // Normalize diagonal movement to prevent speed boost
        const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (moveLen > 1e-6) {
            const invLen = 1.0 / moveLen;
            moveX *= invLen;
            moveZ *= invLen;
        }

        this.velocity[0] = moveX * MOVE_SPEED;
        this.velocity[2] = moveZ * MOVE_SPEED;

        // --- Vertical physics ---
        // Jump
        if (input.isKeyDown('Space') && this.onGround) {
            this.velocity[1] = JUMP_VELOCITY;
            this.onGround = false;
        }

        // Gravity
        if (!this.onGround) {
            this.velocity[1] += GRAVITY * dt;
        }

        // --- Integrate position ---
        this.camera.position[0] += this.velocity[0] * dt;
        this.camera.position[1] += this.velocity[1] * dt;
        this.camera.position[2] += this.velocity[2] * dt;

        // --- Ground collision ---
        const groundHeight = heightmap.getHeight(
            this.camera.position[0],
            this.camera.position[2]
        );
        const feetY = this.camera.position[1] - PLAYER_HEIGHT;

        if (feetY <= groundHeight) {
            // Snap to ground
            this.camera.position[1] = groundHeight + PLAYER_HEIGHT;
            this.velocity[1] = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }

        // --- Update camera matrices ---
        this.camera.updateView();
    }
}
