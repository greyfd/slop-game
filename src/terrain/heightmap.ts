/**
 * Heightmap generation and CPU-side height sampling.
 *
 * Generates a 2D grid of height values using layered sine waves.
 * Provides bilinear-interpolated height queries for player collision.
 *
 * World-space layout:
 *   The terrain spans from (-halfWidth, 0, -halfDepth) to (+halfWidth, 0, +halfDepth)
 *   where halfWidth = (gridWidth - 1) * cellSize / 2, etc.
 *   The heightmap origin (grid [0][0]) maps to the -X, -Z corner.
 */

export class Heightmap {
    /** Number of vertices along X axis */
    readonly gridWidth: number;
    /** Number of vertices along Z axis */
    readonly gridDepth: number;
    /** World-space distance between adjacent vertices */
    readonly cellSize: number;
    /** Raw height data, row-major: data[z * gridWidth + x] */
    readonly data: Float32Array;
    /** World-space X of grid origin (most negative X corner) */
    readonly originX: number;
    /** World-space Z of grid origin (most negative Z corner) */
    readonly originZ: number;
    /** Total world-space width */
    readonly worldWidth: number;
    /** Total world-space depth */
    readonly worldDepth: number;

    constructor(gridWidth: number, gridDepth: number, cellSize: number, amplitude: number) {
        this.gridWidth = gridWidth;
        this.gridDepth = gridDepth;
        this.cellSize = cellSize;
        this.worldWidth = (gridWidth - 1) * cellSize;
        this.worldDepth = (gridDepth - 1) * cellSize;
        this.originX = -this.worldWidth * 0.5;
        this.originZ = -this.worldDepth * 0.5;

        this.data = new Float32Array(gridWidth * gridDepth);
        this.generate(amplitude);
    }

    private generate(amplitude: number): void {
        for (let gz = 0; gz < this.gridDepth; gz++) {
            for (let gx = 0; gx < this.gridWidth; gx++) {
                // Convert grid coords to world coords for noise sampling
                const wx = this.originX + gx * this.cellSize;
                const wz = this.originZ + gz * this.cellSize;

                // Layered sine waves to create rolling hills
                let h = 0;

                // Large rolling hills
                h += Math.sin(wx * 0.02) * Math.cos(wz * 0.03) * amplitude * 0.6;

                // Medium undulations
                h += Math.sin(wx * 0.07 + 1.3) * Math.sin(wz * 0.05 + 0.7) * amplitude * 0.25;

                // Small detail
                h += Math.cos(wx * 0.15 + 2.1) * Math.sin(wz * 0.12 + 1.5) * amplitude * 0.1;

                // Subtle asymmetric variation
                h += Math.sin(wx * 0.04 + wz * 0.03) * amplitude * 0.15;

                // Ensure some areas are relatively flat (clamp negative values gently)
                h = Math.max(h, -amplitude * 0.1);

                this.data[gz * this.gridWidth + gx] = h;
            }
        }
    }

    /**
     * Sample height at an arbitrary world-space (x, z) using bilinear interpolation.
     * Returns 0 if the query point is outside the heightmap bounds.
     */
    getHeight(worldX: number, worldZ: number): number {
        // Convert to grid-local floating-point coordinates
        const gxf = (worldX - this.originX) / this.cellSize;
        const gzf = (worldZ - this.originZ) / this.cellSize;

        // Clamp to grid bounds
        const maxGx = this.gridWidth - 1;
        const maxGz = this.gridDepth - 1;

        if (gxf < 0 || gxf > maxGx || gzf < 0 || gzf > maxGz) {
            return 0;
        }

        const gx0 = Math.floor(gxf);
        const gz0 = Math.floor(gzf);
        const gx1 = Math.min(gx0 + 1, maxGx);
        const gz1 = Math.min(gz0 + 1, maxGz);

        const fx = gxf - gx0;
        const fz = gzf - gz0;

        const h00 = this.data[gz0 * this.gridWidth + gx0];
        const h10 = this.data[gz0 * this.gridWidth + gx1];
        const h01 = this.data[gz1 * this.gridWidth + gx0];
        const h11 = this.data[gz1 * this.gridWidth + gx1];

        // Bilinear interpolation
        const h0 = h00 + (h10 - h00) * fx;
        const h1 = h01 + (h11 - h01) * fx;
        return h0 + (h1 - h0) * fz;
    }

    /**
     * Compute the surface normal at world-space (x, z) via central differences.
     * Returns a new Float32Array(3).
     */
    getNormal(worldX: number, worldZ: number): Float32Array {
        const eps = this.cellSize * 0.5;
        const hL = this.getHeight(worldX - eps, worldZ);
        const hR = this.getHeight(worldX + eps, worldZ);
        const hD = this.getHeight(worldX, worldZ - eps);
        const hU = this.getHeight(worldX, worldZ + eps);

        // Normal = normalize((-dh/dx, 1, -dh/dz))
        const nx = (hL - hR) / (2 * eps);
        const nz = (hD - hU) / (2 * eps);
        const ny = 1.0;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

        return new Float32Array([nx / len, ny / len, nz / len]);
    }
}
