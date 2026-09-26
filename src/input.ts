/**
 * Input manager: keyboard state + pointer-locked mouse deltas.
 *
 * Mouse deltas accumulate between frames and must be consumed via resetDeltas().
 * Pointer lock is requested on canvas click and released on Escape.
 */

export class Input {
    private readonly keys: Set<string> = new Set();
    private dx: number = 0;
    private dy: number = 0;
    private locked: boolean = false;
    private readonly canvas: HTMLCanvasElement;

    // Bound handlers for cleanup
    private readonly onKeyDown: (e: KeyboardEvent) => void;
    private readonly onKeyUp: (e: KeyboardEvent) => void;
    private readonly onMouseMove: (e: MouseEvent) => void;
    private readonly onClick: () => void;
    private readonly onPointerLockChange: () => void;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        this.onKeyDown = (e: KeyboardEvent): void => {
            this.keys.add(e.code);
            // Prevent default for game keys to stop browser scroll
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
        };

        this.onKeyUp = (e: KeyboardEvent): void => {
            this.keys.delete(e.code);
        };

        this.onMouseMove = (e: MouseEvent): void => {
            if (this.locked) {
                this.dx += e.movementX;
                this.dy += e.movementY;
            }
        };

        this.onClick = (): void => {
            if (!this.locked) {
                this.canvas.requestPointerLock();
            }
        };

        this.onPointerLockChange = (): void => {
            this.locked = document.pointerLockElement === this.canvas;
            if (!this.locked) {
                this.keys.clear();
            }
        };

        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousemove', this.onMouseMove);
        canvas.addEventListener('click', this.onClick);
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }

    isKeyDown(code: string): boolean {
        return this.keys.has(code);
    }

    get mouseDeltaX(): number {
        return this.dx;
    }

    get mouseDeltaY(): number {
        return this.dy;
    }

    isPointerLocked(): boolean {
        return this.locked;
    }

    /** Consume accumulated mouse deltas. Call once per frame after reading. */
    resetDeltas(): void {
        this.dx = 0;
        this.dy = 0;
    }

    destroy(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('click', this.onClick);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
}
