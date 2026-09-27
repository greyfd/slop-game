/**
 * Code generation script.
 *
 * Reads schema.json and produces:
 *   1. rust-engine/src/generated.rs  -- #[repr(C)] structs + SAB memory map constants
 *   2. src/shaders/generated.wgsl    -- WGSL structs with @align/@size (gpu-only structs)
 *   3. src/shared/generated.ts       -- TypeScript byte-offset constants + MemoryMap
 *
 * The memory map computes deterministic byte offsets for:
 *   - 4 atomic control words (state_index, input_write_head, input_read_head, terrain_ready)
 *   - Input ring buffer (N slots of InputFrame)
 *   - Double-buffered FrameState (Buffer A + Buffer B)
 *   - Terrain staging region (vertex_count, index_count, vertex data, index data)
 *
 * All offsets respect 16-byte alignment for WebGPU compatibility.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.join(__dirname, '../schema.json');
const rustOut = path.join(__dirname, '../rust-engine/src/generated.rs');
const wgslOut = path.join(__dirname, '../src/shaders/generated.wgsl');
const tsOut = path.join(__dirname, '../src/shared/generated.ts');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// ---------------------------------------------------------------------------
// Type metadata
// ---------------------------------------------------------------------------

const typeInfo = {
    'f32':          { align: 4,  size: 4,  rustType: 'f32',      wgslType: 'f32' },
    'vec2<f32>':    { align: 8,  size: 8,  rustType: '[f32; 2]',  wgslType: 'vec2<f32>' },
    'vec3<f32>':    { align: 16, size: 12, rustType: '[f32; 3]',  wgslType: 'vec3<f32>' },
    'vec4<f32>':    { align: 16, size: 16, rustType: '[f32; 4]',  wgslType: 'vec4<f32>' },
    'mat4x4<f32>': { align: 16, size: 64, rustType: '[f32; 16]', wgslType: 'mat4x4<f32>' },
    'i32':          { align: 4,  size: 4,  rustType: 'i32',       wgslType: 'i32' },
    'u32':          { align: 4,  size: 4,  rustType: 'u32',       wgslType: 'u32' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Align `offset` up to `alignment`. */
function alignUp(offset, alignment) {
    return Math.ceil(offset / alignment) * alignment;
}

// ---------------------------------------------------------------------------
// Process structs
// ---------------------------------------------------------------------------

let rustCode = '// GENERATED CODE - DO NOT MODIFY\n\n';
let wgslCode = '// GENERATED CODE - DO NOT MODIFY\n\n';
let tsCode = '// GENERATED CODE - DO NOT MODIFY\n\n';

/** Map from struct name -> computed byte size (after padding) */
const structSizes = {};

for (const struct of schema.structs) {
    let currentOffset = 0;
    let maxAlign = 1;

    const rustFields = [];
    const wgslFields = [];
    const tsFields = [];

    let padCounter = 0;

    for (const field of struct.fields) {
        const info = typeInfo[field.type];
        if (!info) {
            throw new Error(`Unknown type "${field.type}" in struct "${struct.name}".`);
        }

        // Pre-field alignment padding
        const aligned = alignUp(currentOffset, info.align);
        const pad = aligned - currentOffset;
        if (pad > 0) {
            const numU32s = pad / 4;
            for (let i = 0; i < numU32s; i++) {
                rustFields.push(`    pub _align_pad${padCounter}: u32,`);
                padCounter++;
            }
            currentOffset = aligned;
        }

        const fieldOffset = currentOffset;
        maxAlign = Math.max(maxAlign, info.align);

        // Rust
        rustFields.push(`    pub ${field.name}: ${info.rustType},`);

        // WGSL (only for gpu-visible structs)
        if (struct.gpu !== false) {
            wgslFields.push(`    @align(${info.align}) @size(${info.size}) ${field.name}: ${info.wgslType},`);
        }

        // TypeScript
        tsFields.push(`    static readonly ${field.name.toUpperCase()} = ${fieldOffset};`);

        currentOffset += info.size;

        // Post-field padding for vec3 (12 bytes -> 16 bytes to maintain alignment)
        if (field.type === 'vec3<f32>') {
            rustFields.push(`    pub _pad${padCounter}: f32,`);
            padCounter++;
            currentOffset += 4;
        }
    }

    // Struct tail padding to maxAlign
    const tailAligned = alignUp(currentOffset, maxAlign);
    const tailPad = tailAligned - currentOffset;
    if (tailPad > 0) {
        const numU32s = tailPad / 4;
        for (let i = 0; i < numU32s; i++) {
            rustFields.push(`    pub _tail_pad${padCounter}: u32,`);
            padCounter++;
        }
        currentOffset = tailAligned;
    }

    const structSize = currentOffset;
    structSizes[struct.name] = structSize;

    tsFields.push(`    static readonly _STRUCT_SIZE = ${structSize};`);

    // Emit Rust struct
    rustCode += `#[repr(C)]\n#[derive(Debug, Copy, Clone)]\npub struct ${struct.name} {\n${rustFields.join('\n')}\n}\n\n`;

    // Emit WGSL struct (only for gpu-visible)
    if (struct.gpu !== false) {
        // Fix: last field gets @size that includes tail padding for correct struct stride
        const lastFieldType = struct.fields[struct.fields.length - 1].type;
        const lastInfo = typeInfo[lastFieldType];
        const lastFieldActualEnd = structSize; // struct size includes tail padding
        const lastFieldOffset = currentOffset - tailPad - (lastFieldType === 'vec3<f32>' ? 4 : 0) - lastInfo.size;
        const lastFieldSizeWithPad = structSize - lastFieldOffset;

        // Rebuild WGSL fields with corrected last-field @size
        const correctedWgslFields = [...wgslFields];
        if (correctedWgslFields.length > 0) {
            const lastIdx = correctedWgslFields.length - 1;
            const lastField = struct.fields[struct.fields.length - 1];
            const lastFI = typeInfo[lastField.type];
            correctedWgslFields[lastIdx] = `    @align(${lastFI.align}) @size(${lastFieldSizeWithPad}) ${lastField.name}: ${lastFI.wgslType},`;
        }

        wgslCode += `struct ${struct.name} {\n${correctedWgslFields.join('\n')}\n}\n\n`;
    }

    // Emit TypeScript class
    tsCode += `export class ${struct.name}Offsets {\n${tsFields.join('\n')}\n}\n\n`;
}

// ---------------------------------------------------------------------------
// Compute SAB Memory Map
// ---------------------------------------------------------------------------

const regions = schema.memory_regions;
const inputCapacity = regions.input_ring_buffer_capacity;
const gridSize = regions.terrain_grid_size;
const floatsPerVert = regions.terrain_floats_per_vertex;
const bytesPerIndex = regions.terrain_bytes_per_index;

const inputFrameSize = structSizes['InputFrame'];
if (!inputFrameSize) {
    throw new Error('InputFrame struct must be defined in schema.');
}
const frameStateSize = structSizes['FrameState'];
if (!frameStateSize) {
    throw new Error('FrameState struct must be defined in schema.');
}

let offset = 0;

// Control words (4 x u32, each used with Atomics)
const STATE_INDEX = offset;           offset += 4;
const INPUT_WRITE_HEAD = offset;      offset += 4;
const INPUT_READ_HEAD = offset;       offset += 4;
const TERRAIN_READY = offset;         offset += 4;

// Input ring buffer
offset = alignUp(offset, 16);
const INPUT_RING_START = offset;
offset += inputCapacity * inputFrameSize;

// Double-buffered FrameState
offset = alignUp(offset, 16);
const BUFFER_A_START = offset;
offset += frameStateSize;

offset = alignUp(offset, 16);
const BUFFER_B_START = offset;
offset += frameStateSize;

// Terrain metadata
offset = alignUp(offset, 16);
const TERRAIN_VERTEX_COUNT = offset;  offset += 4;
const TERRAIN_INDEX_COUNT = offset;   offset += 4;
offset += 8; // padding to 16

// Terrain vertex data
offset = alignUp(offset, 16);
const TERRAIN_VERTICES_START = offset;
const vertexCount = gridSize * gridSize;
const vertexBytes = vertexCount * floatsPerVert * 4;
offset += vertexBytes;

// Terrain index data
offset = alignUp(offset, 16);
const TERRAIN_INDICES_START = offset;
const quadsPerAxis = gridSize - 1;
const indexCount = quadsPerAxis * quadsPerAxis * 6;
const indexBytes = indexCount * bytesPerIndex;
offset += indexBytes;

// Total SAB size (aligned to 16)
const TOTAL_SAB_SIZE = alignUp(offset, 16);

// Emit TS MemoryMap
tsCode += `/** SharedArrayBuffer memory map -- all offsets in bytes. */\n`;
tsCode += `export class MemoryMap {\n`;
tsCode += `    // --- Atomic Control Words ---\n`;
tsCode += `    static readonly STATE_INDEX = ${STATE_INDEX};\n`;
tsCode += `    static readonly INPUT_WRITE_HEAD = ${INPUT_WRITE_HEAD};\n`;
tsCode += `    static readonly INPUT_READ_HEAD = ${INPUT_READ_HEAD};\n`;
tsCode += `    static readonly TERRAIN_READY = ${TERRAIN_READY};\n`;
tsCode += `\n`;
tsCode += `    // --- Input Ring Buffer ---\n`;
tsCode += `    static readonly INPUT_RING_START = ${INPUT_RING_START};\n`;
tsCode += `    static readonly INPUT_RING_CAPACITY = ${inputCapacity};\n`;
tsCode += `    static readonly INPUT_FRAME_SIZE = ${inputFrameSize};\n`;
tsCode += `\n`;
tsCode += `    // --- Double-Buffered FrameState ---\n`;
tsCode += `    static readonly BUFFER_A_START = ${BUFFER_A_START};\n`;
tsCode += `    static readonly BUFFER_B_START = ${BUFFER_B_START};\n`;
tsCode += `    static readonly FRAME_STATE_SIZE = ${frameStateSize};\n`;
tsCode += `\n`;
tsCode += `    // --- Terrain Staging ---\n`;
tsCode += `    static readonly TERRAIN_VERTEX_COUNT = ${TERRAIN_VERTEX_COUNT};\n`;
tsCode += `    static readonly TERRAIN_INDEX_COUNT = ${TERRAIN_INDEX_COUNT};\n`;
tsCode += `    static readonly TERRAIN_VERTICES_START = ${TERRAIN_VERTICES_START};\n`;
tsCode += `    static readonly TERRAIN_INDICES_START = ${TERRAIN_INDICES_START};\n`;
tsCode += `    static readonly TERRAIN_MAX_VERTICES = ${vertexCount};\n`;
tsCode += `    static readonly TERRAIN_MAX_INDICES = ${indexCount};\n`;
tsCode += `    static readonly TERRAIN_FLOATS_PER_VERTEX = ${floatsPerVert};\n`;
tsCode += `\n`;
tsCode += `    // --- Total ---\n`;
tsCode += `    static readonly TOTAL_SAB_SIZE = ${TOTAL_SAB_SIZE};\n`;
tsCode += `}\n\n`;

// Emit Rust constants
rustCode += `// --- SharedArrayBuffer Memory Map (byte offsets) ---\n\n`;
rustCode += `pub const STATE_INDEX: usize = ${STATE_INDEX};\n`;
rustCode += `pub const INPUT_WRITE_HEAD: usize = ${INPUT_WRITE_HEAD};\n`;
rustCode += `pub const INPUT_READ_HEAD: usize = ${INPUT_READ_HEAD};\n`;
rustCode += `pub const TERRAIN_READY: usize = ${TERRAIN_READY};\n`;
rustCode += `\n`;
rustCode += `pub const INPUT_RING_START: usize = ${INPUT_RING_START};\n`;
rustCode += `pub const INPUT_RING_CAPACITY: usize = ${inputCapacity};\n`;
rustCode += `pub const INPUT_FRAME_SIZE: usize = ${inputFrameSize};\n`;
rustCode += `\n`;
rustCode += `pub const BUFFER_A_START: usize = ${BUFFER_A_START};\n`;
rustCode += `pub const BUFFER_B_START: usize = ${BUFFER_B_START};\n`;
rustCode += `pub const FRAME_STATE_SIZE: usize = ${frameStateSize};\n`;
rustCode += `\n`;
rustCode += `pub const TERRAIN_VERTEX_COUNT_OFFSET: usize = ${TERRAIN_VERTEX_COUNT};\n`;
rustCode += `pub const TERRAIN_INDEX_COUNT_OFFSET: usize = ${TERRAIN_INDEX_COUNT};\n`;
rustCode += `pub const TERRAIN_VERTICES_START: usize = ${TERRAIN_VERTICES_START};\n`;
rustCode += `pub const TERRAIN_INDICES_START: usize = ${TERRAIN_INDICES_START};\n`;
rustCode += `pub const TERRAIN_MAX_VERTICES: usize = ${vertexCount};\n`;
rustCode += `pub const TERRAIN_MAX_INDICES: usize = ${indexCount};\n`;
rustCode += `pub const TERRAIN_FLOATS_PER_VERTEX: usize = ${floatsPerVert};\n`;
rustCode += `\n`;
rustCode += `pub const TOTAL_SAB_SIZE: usize = ${TOTAL_SAB_SIZE};\n`;

// ---------------------------------------------------------------------------
// Write output files (create directories if needed)
// ---------------------------------------------------------------------------

function writeFileSafe(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
}

writeFileSafe(rustOut, rustCode);
writeFileSafe(wgslOut, wgslCode);
writeFileSafe(tsOut, tsCode);

console.log('Code generation complete.');
console.log(`  Rust:  ${rustOut}`);
console.log(`  WGSL:  ${wgslOut}`);
console.log(`  TS:    ${tsOut}`);
console.log(`\nMemory Map Summary:`);
console.log(`  InputFrame size:    ${inputFrameSize} bytes`);
console.log(`  FrameState size:    ${frameStateSize} bytes`);
console.log(`  Input ring buffer:  ${inputCapacity} slots x ${inputFrameSize} bytes = ${inputCapacity * inputFrameSize} bytes`);
console.log(`  Terrain vertices:   ${vertexCount} verts x ${floatsPerVert * 4} bytes = ${vertexBytes} bytes`);
console.log(`  Terrain indices:    ${indexCount} indices x ${bytesPerIndex} bytes = ${indexBytes} bytes`);
console.log(`  Total SAB size:     ${TOTAL_SAB_SIZE} bytes (${(TOTAL_SAB_SIZE / 1024 / 1024).toFixed(2)} MB)`);
