# docs/memory_map.md (The Ledger)
This file is the single source of truth for all SharedArrayBuffer byte offsets. Update this file before writing any code that modifies structs in Rust, TypeScript, or WGSL.

## Global State Buffer
* Total Size: [Define size in bytes]
* Offset 0 to 3: Uint32 - Game Tick
* Offset 4 to 7: Uint32 - Active Entity Count

## Entity Transform Component (64 bytes)
* Byte 0 to 11: vec3<f32> - Position
* Byte 12 to 15: f32 - Padding (WGSL requirement)
* Byte 16 to 31: vec4<f32> - Rotation Quaternion
* Byte 32 to 47: vec3<f32> - Scale
* Byte 48 to 63: f32 array - Reserved for matrix padding