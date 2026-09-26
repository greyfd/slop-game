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

const typeInfo = {
    'f32': { align: 4, size: 4, rustType: 'f32', wgslType: 'f32' },
    'vec2<f32>': { align: 8, size: 8, rustType: '[f32; 2]', wgslType: 'vec2<f32>' },
    'vec3<f32>': { align: 16, size: 12, rustType: '[f32; 3]', wgslType: 'vec3<f32>' },
    'vec4<f32>': { align: 16, size: 16, rustType: '[f32; 4]', wgslType: 'vec4<f32>' },
    'mat4x4<f32>': { align: 16, size: 64, rustType: '[f32; 16]', wgslType: 'mat4x4<f32>' },
    'i32': { align: 4, size: 4, rustType: 'i32', wgslType: 'i32' },
    'u32': { align: 4, size: 4, rustType: 'u32', wgslType: 'u32' }
};

let rustCode = `// GENERATED CODE - DO NOT MODIFY\n\n`;
let wgslCode = `// GENERATED CODE - DO NOT MODIFY\n\n`;
let tsCode = `// GENERATED CODE - DO NOT MODIFY\n\n`;

for (const struct of schema.structs) {
    let currentOffset = 0;
    let maxAlign = 1;
    
    let rustFields = [];
    let wgslFields = [];
    let tsFields = [];
    
    let padCounter = 0;

    for (const field of struct.fields) {
        const info = typeInfo[field.type];
        if (!info) {
            throw new Error(`Unknown type: ${field.type}`);
        }
        
        // Handle alignment padding before the field
        let pad = (info.align - (currentOffset % info.align)) % info.align;
        if (pad > 0) {
            let numFloats = pad / 4;
            for (let i = 0; i < numFloats; i++) {
                rustFields.push(`    pub _align_pad${padCounter++}: f32,`);
            }
            currentOffset += pad;
        }

        const fieldOffset = currentOffset;
        maxAlign = Math.max(maxAlign, info.align);
        
        // Add to Rust
        rustFields.push(`    pub ${field.name}: ${info.rustType},`);
        
        // Add to WGSL
        wgslFields.push(`    @align(${info.align}) @size(${info.size}) ${field.name}: ${info.wgslType},`);
        
        // Add to TS
        tsFields.push(`    static readonly ${field.name.toUpperCase()} = ${fieldOffset};`);
        
        currentOffset += info.size;

        // Post-field padding for vec3
        if (field.type === 'vec3<f32>') {
            // Need 4 bytes of padding to reach 16 bytes
            rustFields.push(`    pub _pad${padCounter++}: f32,`);
            currentOffset += 4;
        }
    }
    
    // Struct tail padding
    let tailPad = (maxAlign - (currentOffset % maxAlign)) % maxAlign;
    if (tailPad > 0) {
        let numFloats = tailPad / 4;
        for (let i = 0; i < numFloats; i++) {
            rustFields.push(`    pub _tail_pad${padCounter++}: f32,`);
        }
        currentOffset += tailPad;
    }

    const structSize = currentOffset;
    
    tsFields.push(`    static readonly _STRUCT_SIZE = ${structSize};`);

    rustCode += `#[repr(C)]\n#[derive(Debug, Copy, Clone)]\npub struct ${struct.name} {\n${rustFields.join('\n')}\n}\n\n`;
    wgslCode += `struct ${struct.name} {\n${wgslFields.join('\n')}\n}\n\n`;
    tsCode += `export class ${struct.name}Offsets {\n${tsFields.join('\n')}\n}\n\n`;
}

fs.writeFileSync(rustOut, rustCode);
fs.writeFileSync(wgslOut, wgslCode);
fs.writeFileSync(tsOut, tsCode);

console.log('Successfully generated memory mapped files.');
