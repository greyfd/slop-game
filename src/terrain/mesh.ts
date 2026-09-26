/**
 * Generate a terrain grid mesh from a Heightmap.
 *
 * Vertex layout (interleaved):
 *   position: vec3<f32> (12 bytes)
 *   normal:   vec3<f32> (12 bytes)
 *   Total stride: 24 bytes per vertex
 *
 * Index buffer uses Uint32 to support large grids (>256x256).
 */

import { Heightmap } from './heightmap';

export interface TerrainMeshData {
    vertices: Float32Array;
    indices: Uint32Array;
    vertexCount: number;
    indexCount: number;
}

/**
 * Build vertex and index buffers for the terrain.
 * Vertices include pre-displaced Y positions from the heightmap.
 * Normals are computed per-vertex via central differences on the heightmap.
 */
export function generateTerrainMesh(heightmap: Heightmap): TerrainMeshData {
    const gw = heightmap.gridWidth;
    const gd = heightmap.gridDepth;
    const vertexCount = gw * gd;
    const floatsPerVertex = 6; // pos(3) + normal(3)
    const vertices = new Float32Array(vertexCount * floatsPerVertex);

    // Fill vertex positions and normals
    for (let gz = 0; gz < gd; gz++) {
        for (let gx = 0; gx < gw; gx++) {
            const wx = heightmap.originX + gx * heightmap.cellSize;
            const wz = heightmap.originZ + gz * heightmap.cellSize;
            const wy = heightmap.data[gz * gw + gx];

            const idx = (gz * gw + gx) * floatsPerVertex;

            // Position
            vertices[idx]     = wx;
            vertices[idx + 1] = wy;
            vertices[idx + 2] = wz;

            // Normal via central differences
            const normal = heightmap.getNormal(wx, wz);
            vertices[idx + 3] = normal[0];
            vertices[idx + 4] = normal[1];
            vertices[idx + 5] = normal[2];
        }
    }

    // Index buffer: two triangles per quad cell
    const quadsX = gw - 1;
    const quadsZ = gd - 1;
    const indexCount = quadsX * quadsZ * 6;
    const indices = new Uint32Array(indexCount);

    let ii = 0;
    for (let gz = 0; gz < quadsZ; gz++) {
        for (let gx = 0; gx < quadsX; gx++) {
            const topLeft = gz * gw + gx;
            const topRight = topLeft + 1;
            const bottomLeft = (gz + 1) * gw + gx;
            const bottomRight = bottomLeft + 1;

            // Triangle 1 (CCW winding for front-face)
            indices[ii++] = topLeft;
            indices[ii++] = bottomLeft;
            indices[ii++] = topRight;

            // Triangle 2
            indices[ii++] = topRight;
            indices[ii++] = bottomLeft;
            indices[ii++] = bottomRight;
        }
    }

    return { vertices, indices, vertexCount, indexCount };
}
