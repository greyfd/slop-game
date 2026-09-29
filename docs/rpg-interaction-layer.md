# RPG Interaction Layer: Architecture & Implementation Plan

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Decisions](#2-design-decisions)
3. [SAB Memory Map Extension](#3-sab-memory-map-extension)
4. [Schema Extension](#4-schema-extension)
5. [Rust: SoA ECS Component Storage](#5-rust-soa-ecs-component-storage)
6. [Rust: Entity Pool Allocator](#6-rust-entity-pool-allocator)
7. [Rust: BVH Spatial Index](#7-rust-bvh-spatial-index)
8. [Rust: AABB Raycaster](#8-rust-aabb-raycaster)
9. [Rust: Interaction Event Ring Buffer](#9-rust-interaction-event-ring-buffer)
10. [Rust: Tick Integration](#10-rust-tick-integration)
11. [TypeScript: SAB Interaction Reader](#11-typescript-sab-interaction-reader)
12. [TypeScript: DOM Overlay Bridge](#12-typescript-dom-overlay-bridge)
13. [Codegen Changes](#13-codegen-changes)
14. [Phase Breakdown](#14-phase-breakdown)
15. [File Manifest](#15-file-manifest)
16. [Risk Assessment](#16-risk-assessment)

---

## 1. Executive Summary

This document specifies the architecture for adding an RPG interaction layer to the existing Rust/WASM/WebGPU engine. The system enables the player to target entities in the 3D world via raycasting, read their component state (stats, inventory, interactable metadata), and trigger interactions -- all without garbage collection, serialization, or `postMessage`.

The implementation extends the existing SharedArrayBuffer architecture with three new subsystems:

1. **SoA ECS storage** for `Interactable`, `Stats`, and `Inventory` components, laid out as contiguous typed arrays in the SAB.
2. **A BVH-accelerated AABB raycaster** in Rust that runs once per physics tick and writes the targeted entity ID to a fixed SAB address.
3. **An interaction event ring buffer** (SPSC, TypeScript producer / Rust consumer) for UI-triggered actions (e.g., "use item", "open dialogue"), modeled identically to the existing input ring buffer.
4. **A zero-GC DOM bridge** in TypeScript that reads entity state from SAB views and mutates cached text nodes.

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Memory model | External SAB (current) | Proven, stable, works with stable Rust. Shared WASM linear memory deferred to [ISSUE-002](../issues/002-shared-wasm-linear-memory.md). |
| ECS data location | SAB (via codegen offsets) | JS needs zero-copy reads. SAB is the shared medium. |
| ECS layout | Struct-of-Arrays | Cache-friendly iteration for Rust; trivially mappable to `Float32Array`/`Int32Array` views for JS. |
| Entity capacity | Fixed 2048 slots | Pre-allocated. No dynamic resizing. Sufficient for 1000+ active entities with headroom. |
| Entity identity | Generational indices (`index:u16 \| generation:u16`) | Prevents the ABA problem: if slot N is freed and reallocated between frames, stale `InteractEvent`s targeting the old entity are detected and discarded by generation mismatch. |
| Spatial index | BVH (Bounding Volume Hierarchy) | Required for 1000+ entity raycasting at 60Hz. Rebuilt on entity movement. Cheaper than octree for dynamic scenes with moderate entity counts. |
| Ring buffer tail update | `Atomics.store((head + 1) % capacity)` | Correct modular wrapping. `Atomics.add` would grow unboundedly. Matches existing input ring buffer. |
| Raycast output | Single `u32` generational entity ID at fixed SAB address | `0xFFFFFFFF` (sentinel) means "no target". Lower 16 bits = slot index, upper 16 bits = generation. JS reads with `Atomics.load`. |
| Interaction UI output | Entity ID only | User will define UI behavior. We provide zero-copy SAB views over component arrays for the UI to read as needed. |
| Entity lifecycle | Pooled allocator with free list | Supports both static (loaded at init) and dynamic (spawned/despawned at runtime) entities without allocation. |
| Name resolution | Pre-allocated hash-to-string dictionary | `Interactable.name_hash` is a `u32`. TS side holds a `Map<number, string>` built at startup from the same data source Rust uses. No dynamic string allocation in the hot path. |

---

## 3. SAB Memory Map Extension

The new ECS and interaction regions are appended after the existing minimap data. All offsets are 16-byte aligned and will be computed by the updated `codegen.js`.

```
Offset (bytes)      Size              Region                         Access
-------------------------------------------------------------------------------------
... existing regions up to MINIMAP_DATA_START + 4096 ...

INTERACTION_CTRL     16               Interaction control words       Mixed
  +0                 4                  player_target_id (atomic u32) Worker: write
                                                                      Main: Atomics.load
  +4                 4                  interact_write_head (atomic)  Main: Atomics.store
  +8                 4                  interact_read_head (atomic)   Worker: Atomics.store
  +12                4                  reserved

INTERACT_RING        2048             Interaction event ring buffer   
                                      128 slots x 16 bytes            Main: write
                                      InteractEvent struct             Worker: read

ENTITY_ALIVE         2048 * 4         Entity alive + component flags  
                     = 8192 bytes     1 u32 per entity                Worker: read/write
                                      bit 0: alive                     Main: read
                                      bits 1-7: component mask

ENTITY_GENERATION    2048 * 2         Generation counters (ABA guard) 
                     = 4096 bytes     1 u16 per entity                Worker: read/write
                     (padded to 4096) Incremented on free()            Main: read

COMP_INTERACTABLE    2048 * 32        Interactable component array    Worker: write
                     = 65536 bytes    32 bytes per entity              Main: read

COMP_STATS           2048 * 32        Stats component array           Worker: write
                     = 65536 bytes    32 bytes per entity              Main: read

COMP_INVENTORY       2048 * 64        Inventory component array       Worker: write
                     = 131072 bytes   64 bytes per entity              Main: read

COMP_TRANSFORM       2048 * 32        Transform component array       Worker: write
                     = 65536 bytes    32 bytes per entity              Main: read (for AABB)

COMP_AABB            2048 * 32        AABB component array            Worker: read/write
                     = 65536 bytes    32 bytes per entity              

BVH_NODES            4096 * 32        BVH node array                  Worker only
                     = 131072 bytes   (2x entity count for internal
                                       nodes)

                                      TOTAL NEW: ~509 KB
```

> [!NOTE]
> The BVH node array is worker-only (Rust reads/writes, JS never touches it). It lives in the SAB purely for layout simplicity and to avoid a second allocation, but it could alternatively live in WASM linear memory. We keep it in SAB for now so the entire world state is in one contiguous block.

---

## 4. Schema Extension

New structs added to `schema.json`:

```json
{
  "structs": [
    // ... existing InputFrame, FrameState ...
    {
      "name": "InteractEvent",
      "gpu": false,
      "fields": [
        { "name": "event_type", "type": "u32" },
        { "name": "target_entity", "type": "u32" },
        { "name": "param_a", "type": "u32" },
        { "name": "param_b", "type": "u32" }
      ]
    },
    {
      "name": "Interactable",
      "gpu": false,
      "fields": [
        { "name": "entity_id", "type": "u32" },
        { "name": "interact_type", "type": "u32" },
        { "name": "name_hash", "type": "u32" },
        { "name": "interact_radius", "type": "f32" },
        { "name": "flags", "type": "u32" },
        { "name": "reserved_a", "type": "u32" },
        { "name": "reserved_b", "type": "u32" },
        { "name": "reserved_c", "type": "u32" }
      ]
    },
    {
      "name": "Stats",
      "gpu": false,
      "fields": [
        { "name": "health", "type": "f32" },
        { "name": "max_health", "type": "f32" },
        { "name": "mana", "type": "f32" },
        { "name": "max_mana", "type": "f32" },
        { "name": "level", "type": "u32" },
        { "name": "xp", "type": "u32" },
        { "name": "defense", "type": "f32" },
        { "name": "attack", "type": "f32" }
      ]
    },
    {
      "name": "InventorySlot",
      "gpu": false,
      "fields": [
        { "name": "item_id", "type": "u32" },
        { "name": "quantity", "type": "u32" }
      ]
    },
    {
      "name": "Transform",
      "gpu": false,
      "fields": [
        { "name": "pos_x", "type": "f32" },
        { "name": "pos_y", "type": "f32" },
        { "name": "pos_z", "type": "f32" },
        { "name": "scale", "type": "f32" },
        { "name": "rot_y", "type": "f32" },
        { "name": "reserved_a", "type": "f32" },
        { "name": "reserved_b", "type": "f32" },
        { "name": "reserved_c", "type": "f32" }
      ]
    },
    {
      "name": "AABB",
      "gpu": false,
      "fields": [
        { "name": "min_x", "type": "f32" },
        { "name": "min_y", "type": "f32" },
        { "name": "min_z", "type": "f32" },
        { "name": "max_x", "type": "f32" },
        { "name": "max_y", "type": "f32" },
        { "name": "max_z", "type": "f32" },
        { "name": "reserved_a", "type": "f32" },
        { "name": "reserved_b", "type": "f32" }
      ]
    },
    {
      "name": "BVHNode",
      "gpu": false,
      "fields": [
        { "name": "min_x", "type": "f32" },
        { "name": "min_y", "type": "f32" },
        { "name": "min_z", "type": "f32" },
        { "name": "max_x", "type": "f32" },
        { "name": "max_y", "type": "f32" },
        { "name": "max_z", "type": "f32" },
        { "name": "left_or_entity", "type": "u32" },
        { "name": "right_or_flag", "type": "u32" }
      ]
    }
  ],
  "memory_regions": {
    // ... existing fields ...
    "max_entities": 2048,
    "interact_ring_capacity": 128,
    "inventory_slots_per_entity": 8,
    "bvh_node_count": 4096
  }
}
```

### Component Size Summary

| Component | Fields | Bytes/Entity | Total (2048) |
|-----------|--------|-------------|--------------|
| Interactable | 8 x u32/f32 | 32 | 64 KB |
| Stats | 8 x f32/u32 | 32 | 64 KB |
| Inventory | 8 slots x 8 bytes | 64 | 128 KB |
| Transform | 8 x f32 | 32 | 64 KB |
| AABB | 8 x f32 | 32 | 64 KB |
| BVHNode | 8 x f32/u32 | 32 | 128 KB (4096 nodes) |

---

## 5. Rust: SoA ECS Component Storage

The ECS uses flat arrays where the array index IS the entity ID. Each component type is a separate contiguous array in the SAB. Entity 42's health is at `COMP_STATS_START + 42 * STATS_SIZE + Stats::HEALTH_OFFSET`.

### Rust Module: `rust-engine/src/ecs.rs`

```rust
//! Struct-of-Arrays ECS with fixed-capacity entity pool.
//!
//! All component data lives in the SharedArrayBuffer.
//! Arrays are indexed by entity ID (0..MAX_ENTITIES).
//! The alive bitmap tracks which slots are occupied.

use crate::generated::{
    MAX_ENTITIES,
    ENTITY_ALIVE_START,
    COMP_INTERACTABLE_START, INTERACTABLE_SIZE,
    COMP_STATS_START, STATS_SIZE,
    COMP_INVENTORY_START, INVENTORY_SIZE,
    COMP_TRANSFORM_START, TRANSFORM_SIZE,
    COMP_AABB_START, AABB_SIZE,
};
use crate::memory;

/// Component presence flags (which components an entity has).
/// Stored as a u32 in the alive bitmap region alongside the alive bit.
pub const HAS_INTERACTABLE: u32 = 1 << 1;
pub const HAS_STATS: u32        = 1 << 2;
pub const HAS_INVENTORY: u32    = 1 << 3;
pub const HAS_TRANSFORM: u32    = 1 << 4;
pub const HAS_AABB: u32         = 1 << 5;

/// Entity free list for O(1) alloc/dealloc.
/// Kept in WASM linear memory (not SAB) since only Rust touches it.
pub struct EntityPool {
    free_list: Vec<u32>,
    alive_count: u32,
}
```

**Key design**: The component *data* is in the SAB (for JS zero-copy reads), but the *free list* and *bookkeeping* are in WASM linear memory (only Rust needs them).

### Read/Write Pattern

```rust
/// Read an entity's transform from the SAB.
pub fn read_transform(entity_id: u32) -> [f32; 8] {
    let byte_offset = COMP_TRANSFORM_START + (entity_id as usize) * TRANSFORM_SIZE;
    let float_offset = byte_offset / 4;
    let f = memory::float32();
    let mut result = [0.0f32; 8];
    for i in 0..8 {
        result[i] = f.get_index((float_offset + i) as u32);
    }
    result
}

/// Write an entity's AABB to the SAB.
pub fn write_aabb(entity_id: u32, min: [f32; 3], max: [f32; 3]) {
    let byte_offset = COMP_AABB_START + (entity_id as usize) * AABB_SIZE;
    let float_offset = byte_offset / 4;
    let f = memory::float32();
    f.set_index(float_offset as u32, min[0]);
    f.set_index((float_offset + 1) as u32, min[1]);
    f.set_index((float_offset + 2) as u32, min[2]);
    f.set_index((float_offset + 3) as u32, max[0]);
    f.set_index((float_offset + 4) as u32, max[1]);
    f.set_index((float_offset + 5) as u32, max[2]);
}
```

This follows the exact same pattern as the existing `memory::write_frame_state` -- typed array views over the external SAB, accessed via codegen'd byte offsets.

---

## 6. Rust: Entity Pool Allocator (with Generational Indices)

Generational indices prevent the ABA problem. Each entity ID is a packed `u32`:
- **Bits 0-15**: slot index (0..2047)
- **Bits 16-31**: generation counter (0..65535)

When a slot is freed and reallocated, its generation counter increments. Any stale reference holding the old generation will fail validation.

```rust
use crate::generated::{MAX_ENTITIES, ENTITY_ALIVE_START, ENTITY_GENERATION_START};
use crate::memory;

/// Pack a slot index and generation into a single u32 entity handle.
pub fn pack_entity_id(index: u32, generation: u16) -> u32 {
    (index & 0xFFFF) | ((generation as u32) << 16)
}

/// Unpack a u32 entity handle into (slot_index, generation).
pub fn unpack_entity_id(id: u32) -> (u32, u16) {
    (id & 0xFFFF, (id >> 16) as u16)
}

/// Sentinel value meaning "no entity".
pub const NO_ENTITY: u32 = 0xFFFFFFFF;

pub struct EntityPool {
    free_list: Vec<u32>,
    alive_count: u32,
}

impl EntityPool {
    /// Pre-fill the free list with all entity slots.
    pub fn new() -> Self {
        let mut free_list = Vec::with_capacity(MAX_ENTITIES);
        for index in (0..MAX_ENTITIES as u32).rev() {
            free_list.push(index);
        }
        Self { free_list, alive_count: 0 }
    }

    /// Allocate a new entity. Returns a packed generational ID, or None if exhausted.
    pub fn alloc(&mut self) -> Option<u32> {
        let index = self.free_list.pop()?;

        // Read the current generation for this slot
        let gen = read_generation(index);

        // Set alive flag in SAB
        let alive_offset = ENTITY_ALIVE_START + (index as usize) * 4;
        memory::uint32().set_index((alive_offset / 4) as u32, 1);

        self.alive_count += 1;
        Some(pack_entity_id(index, gen))
    }

    /// Free an entity. Increments the generation counter so stale handles are invalidated.
    pub fn free(&mut self, packed_id: u32) {
        let (index, expected_gen) = unpack_entity_id(packed_id);
        let current_gen = read_generation(index);

        // Only free if the generation matches (caller holds a valid handle)
        if current_gen != expected_gen {
            return;
        }

        // Clear alive flag
        let alive_offset = ENTITY_ALIVE_START + (index as usize) * 4;
        memory::uint32().set_index((alive_offset / 4) as u32, 0);

        // Increment generation counter in SAB (wraps at u16::MAX)
        let new_gen = current_gen.wrapping_add(1);
        write_generation(index, new_gen);

        // Zero out component data to prevent stale reads from JS
        clear_entity_components(index);

        self.free_list.push(index);
        self.alive_count -= 1;
    }

    /// Validate that a packed entity ID refers to a currently alive entity
    /// with the correct generation. Returns the slot index if valid.
    pub fn validate(&self, packed_id: u32) -> Option<u32> {
        let (index, expected_gen) = unpack_entity_id(packed_id);
        if (index as usize) >= MAX_ENTITIES {
            return None;
        }
        let current_gen = read_generation(index);
        if current_gen != expected_gen {
            return None; // Stale handle -- entity was freed and slot reused
        }
        let alive_offset = ENTITY_ALIVE_START + (index as usize) * 4;
        let alive = memory::uint32().get_index((alive_offset / 4) as u32);
        if alive == 0 {
            return None;
        }
        Some(index)
    }

    /// Iterate over all alive entity slot indices (not packed IDs).
    pub fn alive_indices(&self) -> AliveIterator {
        AliveIterator { current: 0 }
    }
}

/// Read the generation counter for a slot from the SAB.
fn read_generation(index: u32) -> u16 {
    // ENTITY_GENERATION is stored as u16 per entity, but we read via Uint32Array
    // and extract the appropriate half-word.
    let u32_offset = ENTITY_GENERATION_START + (index as usize) * 2;
    // Read the byte pair as u16 via the Uint8Array or by reading u32 and masking
    let word_offset = u32_offset / 4;
    let shift = (u32_offset % 4) * 8;
    let word = memory::uint32().get_index(word_offset as u32);
    ((word >> shift) & 0xFFFF) as u16
}

/// Write the generation counter for a slot to the SAB.
fn write_generation(index: u32, gen: u16) {
    let u32_offset = ENTITY_GENERATION_START + (index as usize) * 2;
    let word_offset = u32_offset / 4;
    let shift = (u32_offset % 4) * 8;
    let mask = !(0xFFFF << shift);
    let old = memory::uint32().get_index(word_offset as u32);
    let new_word = (old & mask) | ((gen as u32) << shift);
    memory::uint32().set_index(word_offset as u32, new_word);
}

pub struct AliveIterator {
    current: u32,
}

impl Iterator for AliveIterator {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        while (self.current as usize) < MAX_ENTITIES {
            let id = self.current;
            self.current += 1;
            let byte_offset = ENTITY_ALIVE_START + (id as usize) * 4;
            let alive = memory::uint32().get_index((byte_offset / 4) as u32);
            if alive != 0 {
                return Some(id);
            }
        }
        None
    }
}
```

> [!IMPORTANT]
> When Rust processes an `InteractEvent`, it must call `pool.validate(event.target_entity)` before acting. If validation fails, the event is silently discarded -- the entity was freed between the raycast and the interaction.

---

## 7. Rust: BVH Spatial Index

A binary BVH stored as a flat array in the SAB at `BVH_NODES_START`. The tree is rebuilt each tick (or when entities move) using the Surface Area Heuristic (SAH) for split selection.

### Node Layout

Each `BVHNode` is 32 bytes:

```
[min_x, min_y, min_z, max_x, max_y, max_z, left_or_entity, right_or_flag]
```

- **Internal node**: `right_or_flag` is the index of the right child. `left_or_entity` is the index of the left child.
- **Leaf node**: `right_or_flag == 0xFFFFFFFF` (sentinel). `left_or_entity` is the entity ID.

### Build Algorithm

```rust
/// Build a BVH over all alive entities that have AABB components.
/// Returns the index of the root node, or u32::MAX if empty.
pub fn build_bvh(pool: &EntityPool) -> u32 {
    // 1. Collect entity IDs with AABBs into a scratch array (WASM linear memory)
    let mut entities: Vec<u32> = Vec::new();
    for id in pool.alive_indices() {
        let flags = read_entity_flags(id);
        if flags & HAS_AABB != 0 {
            entities.push(id);
        }
    }
    if entities.is_empty() {
        return u32::MAX;
    }

    // 2. Recursively subdivide using SAH
    let mut node_count: u32 = 0;
    let root = build_recursive(&entities, &mut node_count);
    root
}
```

**SAH Split Strategy**:
1. Compute the centroid of each entity's AABB.
2. Choose the axis with the largest centroid spread.
3. Sort entities along that axis by centroid.
4. Evaluate surface-area cost for each split position.
5. Take the split with the minimum cost.
6. Recurse on left and right subsets.

The BVH is written directly to the SAB at `BVH_NODES_START` using the flat array layout. This avoids heap allocation for tree nodes.

### Rebuild Strategy

Full rebuild every tick is acceptable for 2048 entities:
- SAH sort + partition: O(n log n) where n <= 2048
- At 60Hz: ~2048 * 11 = ~22,000 comparisons per tick
- On modern hardware this takes < 0.1ms

For future optimization, incremental refitting (update AABB bounds without restructuring) can be used when entities move but the spatial distribution doesn't change dramatically.

---

## 8. Rust: AABB Raycaster

### Ray Definition

The ray originates at the camera position and points along the camera forward vector. Both are already computed in the existing `tick()` function:

```rust
/// Camera forward vector from yaw and pitch.
fn camera_forward(yaw: f32, pitch: f32) -> [f32; 3] {
    let cp = pitch.cos();
    [
        -yaw.sin() * cp,
        pitch.sin(),
        -yaw.cos() * cp,
    ]
}
```

### Ray-AABB Intersection (Slab Method)

The slab method computes the intersection of the ray with three axis-aligned slab pairs. It is branchless and runs in constant time:

```rust
/// Test ray-AABB intersection using the slab method.
/// Returns the distance `t` along the ray, or f32::INFINITY if no hit.
///
/// `ray_origin`: [x, y, z] camera position
/// `ray_inv_dir`: [1/dx, 1/dy, 1/dz] precomputed inverse direction
/// `aabb_min`: [x, y, z] minimum corner
/// `aabb_max`: [x, y, z] maximum corner
pub fn ray_aabb_intersect(
    ray_origin: &[f32; 3],
    ray_inv_dir: &[f32; 3],
    aabb_min: &[f32; 3],
    aabb_max: &[f32; 3],
) -> f32 {
    let mut t_min = f32::NEG_INFINITY;
    let mut t_max = f32::INFINITY;

    for axis in 0..3 {
        let t1 = (aabb_min[axis] - ray_origin[axis]) * ray_inv_dir[axis];
        let t2 = (aabb_max[axis] - ray_origin[axis]) * ray_inv_dir[axis];

        let t_near = t1.min(t2);
        let t_far = t1.max(t2);

        t_min = t_min.max(t_near);
        t_max = t_max.min(t_far);
    }

    if t_min <= t_max && t_max >= 0.0 {
        if t_min >= 0.0 { t_min } else { t_max }
    } else {
        f32::INFINITY
    }
}
```

### BVH Traversal

Stack-based iterative traversal (no recursion, no allocation):

```rust
/// Cast a ray against the BVH, returning the nearest hit entity ID
/// and distance, or (0xFFFFFFFF, INFINITY) if nothing was hit.
///
/// `max_distance`: maximum interaction range (e.g., 50.0 units)
pub fn raycast_bvh(
    ray_origin: &[f32; 3],
    ray_dir: &[f32; 3],
    bvh_root: u32,
    max_distance: f32,
) -> (u32, f32) {
    if bvh_root == u32::MAX {
        return (u32::MAX, f32::INFINITY);
    }

    // Precompute inverse direction with epsilon to prevent NaN.
    // If ray_dir[axis] == 0.0, then 1.0/0.0 = Inf, which is normally fine.
    // But if the ray origin is exactly on the AABB boundary for that axis,
    // we get 0.0 * Inf = NaN, which breaks the slab test.
    // Clamping near-zero components to a tiny epsilon avoids this.
    let safe = |d: f32| -> f32 {
        if d.abs() < 1e-8 { 1e-8_f32.copysign(d + 1e-30) } else { d }
    };
    let ray_inv_dir = [
        1.0 / safe(ray_dir[0]),
        1.0 / safe(ray_dir[1]),
        1.0 / safe(ray_dir[2]),
    ];

    // Fixed-size stack (BVH depth <= 32 for 2048 entities)
    let mut stack = [0u32; 32];
    let mut stack_ptr: usize = 0;
    stack[0] = bvh_root;
    stack_ptr = 1;

    let mut closest_entity = u32::MAX;
    let mut closest_t = max_distance;

    while stack_ptr > 0 {
        stack_ptr -= 1;
        let node_idx = stack[stack_ptr];

        let node = read_bvh_node(node_idx);

        // Test ray against this node's AABB
        let t = ray_aabb_intersect(
            ray_origin, &ray_inv_dir,
            &[node.min_x, node.min_y, node.min_z],
            &[node.max_x, node.max_y, node.max_z],
        );

        if t > closest_t {
            continue; // Prune: this subtree can't have a closer hit
        }

        if node.right_or_flag == u32::MAX {
            // Leaf node: test against entity AABB for exact hit
            let entity_id = node.left_or_entity;
            let entity_aabb = read_entity_aabb(entity_id);
            let et = ray_aabb_intersect(
                ray_origin, &ray_inv_dir,
                &entity_aabb[0..3],
                &entity_aabb[3..6],
            );
            if et < closest_t {
                closest_t = et;
                closest_entity = entity_id;
            }
        } else {
            // Internal node: intersect BOTH children to determine near/far order.
            // "left" and "right" have no inherent spatial relationship to the ray;
            // we must test both and push the farther one first (so the nearer
            // one is popped and tested first from the LIFO stack).
            let left_idx = node.left_or_entity;
            let right_idx = node.right_or_flag;

            let left_node = read_bvh_node(left_idx);
            let right_node = read_bvh_node(right_idx);

            let t_left = ray_aabb_intersect(
                ray_origin, &ray_inv_dir,
                &[left_node.min_x, left_node.min_y, left_node.min_z],
                &[left_node.max_x, left_node.max_y, left_node.max_z],
            );
            let t_right = ray_aabb_intersect(
                ray_origin, &ray_inv_dir,
                &[right_node.min_x, right_node.min_y, right_node.min_z],
                &[right_node.max_x, right_node.max_y, right_node.max_z],
            );

            // Determine traversal order: push far child first, near child second.
            // Prune children whose AABB is farther than the current closest hit.
            if t_left < t_right {
                // Left is nearer
                if t_right < closest_t {
                    stack[stack_ptr] = right_idx;
                    stack_ptr += 1;
                }
                if t_left < closest_t {
                    stack[stack_ptr] = left_idx;
                    stack_ptr += 1;
                }
            } else {
                // Right is nearer (or equal)
                if t_left < closest_t {
                    stack[stack_ptr] = left_idx;
                    stack_ptr += 1;
                }
                if t_right < closest_t {
                    stack[stack_ptr] = right_idx;
                    stack_ptr += 1;
                }
            }
        }
    }

    (closest_entity, closest_t)
}
```

### Output

The result is a **generational entity ID** written to the `PLAYER_TARGET_ID` atomic address in the SAB. The ID is packed as `(index & 0xFFFF) | (generation << 16)` so the TypeScript side can include the full handle in `InteractEvent` payloads, and Rust can validate generation on receipt.

```rust
// In tick():
let (target_index, _distance) = raycast::raycast_bvh(
    &camera_pos, &camera_fwd, bvh_root, MAX_INTERACT_DISTANCE,
);

// Pack the generational ID for SAB output
let target_gen_id = if target_index == u32::MAX {
    u32::MAX // NO_ENTITY sentinel
} else {
    let gen = ecs::read_generation(target_index);
    ecs::pack_entity_id(target_index, gen)
};
memory::store_player_target(target_gen_id);
```

```rust
// In memory.rs:
pub fn store_player_target(entity_id: u32) {
    Atomics::store(
        int32(),
        PLAYER_TARGET_ID as u32 / 4,
        entity_id as i32,
    ).expect("Atomics.store failed");
}
```

---

## 9. Rust: Interaction Event Ring Buffer

Identical architecture to the existing input ring buffer. TypeScript pushes `InteractEvent` structs, Rust consumes them.

### InteractEvent Types

```
event_type 0: NONE (empty slot)
event_type 1: USE         -- "E" key press on targeted entity
event_type 2: EXAMINE     -- inspect entity details
event_type 3: PICKUP      -- take item from world
event_type 4: DROP        -- drop item from inventory
event_type 5: ATTACK      -- initiate combat
```

### TypeScript Producer: `src/shared/interact-writer.ts`

```typescript
export class InteractWriter {
    private readonly int32: Int32Array;
    private readonly uint32: Uint32Array;
    private readonly writeHeadIndex: number;
    private readonly readHeadIndex: number;

    constructor(sab: SharedArrayBuffer) {
        this.int32 = new Int32Array(sab);
        this.uint32 = new Uint32Array(sab);
        this.writeHeadIndex = MemoryMap.INTERACT_WRITE_HEAD / 4;
        this.readHeadIndex = MemoryMap.INTERACT_READ_HEAD / 4;
    }

    push(eventType: number, targetEntity: number, paramA: number, paramB: number): boolean {
        const capacity = MemoryMap.INTERACT_RING_CAPACITY;
        const writeHead = Atomics.load(this.int32, this.writeHeadIndex);
        const readHead = Atomics.load(this.int32, this.readHeadIndex);

        if ((writeHead + 1) % capacity === readHead) {
            return false; // Full
        }

        const byteOffset = MemoryMap.INTERACT_RING_START + writeHead * MemoryMap.INTERACT_EVENT_SIZE;
        const slot = byteOffset / 4;

        this.uint32[slot + 0] = eventType;
        this.uint32[slot + 1] = targetEntity;
        this.uint32[slot + 2] = paramA;
        this.uint32[slot + 3] = paramB;

        Atomics.store(this.int32, this.writeHeadIndex, (writeHead + 1) % capacity);
        return true;
    }
}
```

### Rust Consumer: `rust-engine/src/interact.rs`

```rust
pub fn drain_interactions() -> Vec<InteractEvent> {
    let mut events = Vec::new();
    let write_head = memory::load_interact_write_head() % (INTERACT_RING_CAPACITY as u32);
    let mut read_head = memory::load_interact_read_head() % (INTERACT_RING_CAPACITY as u32);

    while read_head != write_head {
        let event = memory::read_interact_event(read_head);
        if event.event_type != 0 {
            events.push(event);
        }
        read_head = (read_head + 1) % (INTERACT_RING_CAPACITY as u32);
    }

    if !events.is_empty() {
        memory::store_interact_read_head(read_head);
    }

    events
}
```

---

## 10. Rust: Tick Integration

The existing `tick()` function in [lib.rs](file:///Users/greysondobbels/Developer/Game/rust-engine/src/lib.rs) is extended with ECS and raycast steps:

```rust
#[wasm_bindgen]
pub fn tick(dt: f32) {
    // 1. Drain input (existing)
    let mut accumulated = input::drain_input();
    accumulated.dt = dt;

    // 2. Update player (existing)
    let player = unsafe { PLAYER.as_mut().unwrap() };
    player.update(&accumulated);

    // 3. Drain interaction events (NEW)
    let interact_events = interact::drain_interactions();
    for event in &interact_events {
        ecs::process_interaction(event);
    }

    // 4. Update entity AABBs from transforms (NEW)
    //    Only for entities that moved this tick.
    //    IMPORTANT: The Transform component includes rot_y. A naive AABB that
    //    ignores rotation will miss the corners of rotated meshes. update_aabbs()
    //    must compute the axis-aligned bounding box of the ROTATED local extents:
    //      for each of the 8 local-space corners:
    //        rotate by rot_y around Y axis
    //        expand world-space AABB min/max
    //    This is a standard "OBB to AABB" expansion using sin/cos of rot_y.
    ecs::update_aabbs();

    // 5. Rebuild BVH (NEW)
    let bvh_root = bvh::build_bvh(&ecs::POOL);

    // 6. Raycast from camera (NEW)
    let cam_pos = [player.position.x, player.position.y, player.position.z];
    let cam_fwd = camera::forward_vector(player.yaw, player.pitch);
    let (target_id, _dist) = raycast::raycast_bvh(
        &cam_pos, &cam_fwd, bvh_root, MAX_INTERACT_DISTANCE,
    );
    memory::store_player_target(target_id);

    // 7. Update terrain (existing)
    terrain::update(player.position.x, player.position.z);

    // 8. Write FrameState (existing)
    let view_matrix = camera::fps_view_matrix(player.position, player.yaw, player.pitch);
    // ... existing FrameState construction and double-buffer flip ...
}
```

### Tick Budget Analysis

At 60Hz, the tick budget is 16.6ms. Current tick (player + terrain check + frame write) takes < 1ms. The new work:

| Step | Estimated Cost |
|------|---------------|
| Drain interactions | < 0.01ms |
| Update AABBs | ~0.05ms (2048 entities, simple offset) |
| Build BVH (SAH) | ~0.1ms (2048 entities) |
| Raycast BVH | ~0.005ms (log2(2048) = 11 node tests) |
| **Total new work** | **~0.17ms** |

Well within budget. The BVH rebuild is the most expensive step and can be optimized to incremental refit if it ever becomes a bottleneck.

---

## 11. TypeScript: SAB Interaction Reader

### `src/shared/interaction-reader.ts`

The TypeScript side needs to read:
1. The `player_target_id` (which entity the ray hit)
2. Component data for the targeted entity (name, stats, etc.)

```typescript
// Component flag constants (must match Rust ecs.rs)
const HAS_INTERACTABLE = 1 << 1;
const HAS_STATS        = 1 << 2;

export class InteractionReader {
    private readonly int32: Int32Array;
    private readonly float32: Float32Array;
    private readonly uint32: Uint32Array;
    private readonly targetIdSlot: number;

    // Pre-allocated name dictionary: hash -> display string.
    // Built once at startup from the same data source Rust uses.
    // No dynamic string allocation in the hot path.
    private readonly nameDict: Map<number, string>;

    constructor(sab: SharedArrayBuffer, nameDict: Map<number, string>) {
        this.int32 = new Int32Array(sab);
        this.float32 = new Float32Array(sab);
        this.uint32 = new Uint32Array(sab);
        this.targetIdSlot = MemoryMap.PLAYER_TARGET_ID / 4;
        this.nameDict = nameDict;
    }

    /** Read the currently targeted generational entity ID. Returns 0xFFFFFFFF if none. */
    readTargetId(): number {
        return Atomics.load(this.int32, this.targetIdSlot) >>> 0;
    }

    /** Extract the slot index from a packed generational ID. */
    slotIndex(packedId: number): number {
        return packedId & 0xFFFF;
    }

    /** Look up the display name for an entity via its name_hash. */
    readInteractableName(packedId: number): string {
        const slot = this.slotIndex(packedId);
        const base = (MemoryMap.COMP_INTERACTABLE_START + slot * MemoryMap.INTERACTABLE_SIZE) / 4;
        const nameHash = this.uint32[base + 2]; // name_hash is at field offset 2
        return this.nameDict.get(nameHash) ?? 'Unknown';
    }

    /** Read the Stats component for an entity. Uses slot index, not packed ID. */
    readStats(packedId: number): { health: number; maxHealth: number; mana: number; maxMana: number } | null {
        const slot = this.slotIndex(packedId);
        const flags = this.readEntityFlags(slot);
        if ((flags & HAS_STATS) === 0) return null;

        const base = (MemoryMap.COMP_STATS_START + slot * MemoryMap.STATS_SIZE) / 4;
        return {
            health: this.float32[base + 0],
            maxHealth: this.float32[base + 1],
            mana: this.float32[base + 2],
            maxMana: this.float32[base + 3],
        };
    }

    private readEntityFlags(slot: number): number {
        const offset = (MemoryMap.ENTITY_ALIVE_START + slot * 4) / 4;
        return this.uint32[offset];
    }
}
```

All reads are direct `TypedArray` index access over the `SharedArrayBuffer` -- zero allocation, zero serialization, O(1).

---

## 12. TypeScript: DOM Overlay Bridge

### Zero-GC Text Node Mutation

The overlay caches raw `Text` node references at initialization and mutates `nodeValue` directly. No framework, no virtual DOM, no object allocation in the hot path.

```typescript
export class InteractionOverlay {
    // Cached DOM references -- allocated once, never replaced
    private readonly targetNameNode: Text;
    private readonly healthBarFill: HTMLDivElement;

    // Previous values for dirty-checking (avoids redundant DOM writes)
    private prevTargetId: number = 0xFFFFFFFF;
    private prevHealth: number = -1;

    constructor() {
        // Create overlay elements once
        const container = document.createElement('div');
        container.id = 'interaction-overlay';
        container.style.cssText = 'position:fixed;bottom:20%;left:50%;transform:translateX(-50%);' +
            'color:white;font:16px monospace;pointer-events:none;display:none;';

        const nameSpan = document.createElement('span');
        this.targetNameNode = document.createTextNode('');
        nameSpan.appendChild(this.targetNameNode);

        this.healthBarFill = document.createElement('div');
        // ... setup ...

        container.appendChild(nameSpan);
        container.appendChild(this.healthBarFill);
        document.body.appendChild(container);
    }

    /**
     * Called inside requestAnimationFrame. Reads SAB, updates DOM
     * only when values change. Zero allocations in the common path.
     */
    update(reader: InteractionReader): void {
        const targetId = reader.readTargetId();

        if (targetId === this.prevTargetId) {
            // Target hasn't changed -- check if stats changed
            if (targetId !== 0xFFFFFFFF) {
                this.updateStatsIfChanged(reader, targetId);
            }
            return;
        }

        // Target changed
        this.prevTargetId = targetId;

        if (targetId === 0xFFFFFFFF) {
            // No target -- hide overlay
            this.container.style.display = 'none';
            return;
        }

        // New target -- update name and stats
        this.container.style.display = 'block';
        this.targetNameNode.nodeValue = reader.readInteractableName(targetId);
        this.updateStats(reader, targetId);
    }

    private updateStatsIfChanged(reader: InteractionReader, entityId: number): void {
        const stats = reader.readStats(entityId);
        if (stats && stats.health !== this.prevHealth) {
            this.prevHealth = stats.health;
            // Use transform:scaleX instead of style.width.
            // scaleX runs entirely on the GPU compositor -- zero layout recalc.
            // Requires CSS: transform-origin: left; on the health bar fill element.
            const scaleX = stats.health / stats.maxHealth;
            this.healthBarFill.style.transform = `scaleX(${scaleX})`;
        }
    }
}
```

### Integration in `main.ts` rAF loop

```typescript
// In the frame() function, after reading view matrix:
interactionOverlay.update(interactionReader);
```

No `new` objects. No closures. No `Array.map/filter/reduce`. The only DOM mutations are `nodeValue` string assignment and `transform: scaleX()` -- both are primitive writes. The `scaleX` transform runs entirely on the GPU compositor thread, never triggering layout recalculation.

---

## 13. Codegen Changes

The existing `codegen.js` needs the following additions:

1. **New structs** from section 4 (`InteractEvent`, `Interactable`, `Stats`, `InventorySlot`, `Transform`, `AABB`, `BVHNode`).

2. **New memory regions** computed after the existing minimap region:

```javascript
// After MINIMAP_DATA_START + minimapDataSize:

// Interaction control words
offset = alignUp(offset, 16);
const PLAYER_TARGET_ID = offset;        offset += 4;
const INTERACT_WRITE_HEAD = offset;     offset += 4;
const INTERACT_READ_HEAD = offset;      offset += 4;
const INTERACT_RESERVED = offset;       offset += 4;

// Interaction event ring buffer
offset = alignUp(offset, 16);
const INTERACT_RING_START = offset;
offset += interactRingCapacity * interactEventSize;

// Entity alive/flags array (1 u32 per entity: bit 0 = alive, bits 1-7 = component mask)
offset = alignUp(offset, 16);
const ENTITY_ALIVE_START = offset;
offset += maxEntities * 4; // one u32 per entity

// Entity generation counters (1 u16 per entity, for ABA prevention)
// Padded to 16-byte alignment. Total = maxEntities * 2, rounded up.
offset = alignUp(offset, 16);
const ENTITY_GENERATION_START = offset;
offset += alignUp(maxEntities * 2, 16);

// Component arrays (SoA)
offset = alignUp(offset, 16);
const COMP_INTERACTABLE_START = offset;
offset += maxEntities * interactableSize;

offset = alignUp(offset, 16);
const COMP_STATS_START = offset;
offset += maxEntities * statsSize;

offset = alignUp(offset, 16);
const COMP_INVENTORY_START = offset;
offset += maxEntities * inventorySize;

offset = alignUp(offset, 16);
const COMP_TRANSFORM_START = offset;
offset += maxEntities * transformSize;

offset = alignUp(offset, 16);
const COMP_AABB_START = offset;
offset += maxEntities * aabbSize;

// BVH node array
offset = alignUp(offset, 16);
const BVH_NODES_START = offset;
offset += bvhNodeCount * bvhNodeSize;
```

3. **Emit new constants** to all three targets (Rust, TS, WGSL).

Total SAB size increase: ~499 KB (from 269 MB to ~270 MB). Negligible compared to the terrain staging region.

---

## 14. Phase Breakdown

### Phase 1: Schema & Codegen (No Rust changes)
> **Depends on:** Nothing  
> **Effort:** ~100 lines in `codegen.js`, ~50 lines in `schema.json`

| # | Task |
|---|------|
| 1.1 | Add new struct definitions to `schema.json` |
| 1.2 | Add `max_entities`, `interact_ring_capacity`, `bvh_node_count` to `memory_regions` |
| 1.3 | Extend `codegen.js` to compute ECS region offsets and emit constants |
| 1.4 | Run codegen, verify outputs in `generated.rs`, `generated.ts` |

### Phase 2: Rust ECS Core
> **Depends on:** Phase 1  
> **Effort:** ~300 lines

| # | Task |
|---|------|
| 2.1 | Create `rust-engine/src/ecs.rs` -- entity pool, alloc/free, component read/write |
| 2.2 | Add `memory.rs` helpers for new SAB regions (read/write entity components, alive flags) |
| 2.3 | Wire `ecs::init()` into `lib.rs init()` |
| 2.4 | Add test entities at known positions for validation |

### Phase 3: BVH + Raycaster
> **Depends on:** Phase 2  
> **Effort:** ~350 lines

| # | Task |
|---|------|
| 3.1 | Create `rust-engine/src/bvh.rs` -- flat-array BVH build with SAH |
| 3.2 | Create `rust-engine/src/raycast.rs` -- slab-method ray-AABB + BVH traversal |
| 3.3 | Add `camera::forward_vector()` helper |
| 3.4 | Integrate BVH rebuild + raycast into `tick()` |
| 3.5 | Write `player_target_id` to SAB |

### Phase 4: Interaction Ring Buffer
> **Depends on:** Phase 2  
> **Effort:** ~150 lines

| # | Task |
|---|------|
| 4.1 | Create `src/shared/interact-writer.ts` -- SPSC producer |
| 4.2 | Create `rust-engine/src/interact.rs` -- SPSC consumer + event dispatch |
| 4.3 | Add `memory.rs` helpers for interaction control words and ring buffer |

### Phase 5: TypeScript DOM Bridge
> **Depends on:** Phase 3, Phase 4  
> **Effort:** ~200 lines

| # | Task |
|---|------|
| 5.1 | Create `src/shared/interaction-reader.ts` -- reads target ID + component data |
| 5.2 | Create `src/ui/interaction-overlay.ts` -- zero-GC DOM bridge |
| 5.3 | Integrate into `main.ts` rAF loop |
| 5.4 | Add "E to interact" key handling via `InteractWriter` |

### Phase 6: Validation & Tuning
> **Depends on:** Phase 5  
> **Effort:** ~100 lines

| # | Task |
|---|------|
| 6.1 | Spawn 1000+ test entities in a grid pattern |
| 6.2 | Profile BVH build + raycast time per tick |
| 6.3 | Verify zero GC in Chrome DevTools Performance tab |
| 6.4 | Verify SAB memory layout alignment with Rust and TS views |

---

## 15. File Manifest

### New Files

| File | Language | Description |
|------|----------|-------------|
| `rust-engine/src/ecs.rs` | Rust | SoA component storage, entity pool, alive bitmap |
| `rust-engine/src/bvh.rs` | Rust | Flat-array BVH build (SAH) |
| `rust-engine/src/raycast.rs` | Rust | Ray-AABB slab test, BVH traversal |
| `rust-engine/src/interact.rs` | Rust | Interaction event ring buffer consumer |
| `src/shared/interact-writer.ts` | TypeScript | Interaction event ring buffer producer |
| `src/shared/interaction-reader.ts` | TypeScript | SAB reader for target ID + component data |
| `src/ui/interaction-overlay.ts` | TypeScript | Zero-GC DOM text node bridge |

### Modified Files

| File | Changes |
|------|---------|
| `schema.json` | New struct definitions, new memory region params |
| `scripts/codegen.js` | ECS region offset computation, new constant emission |
| `rust-engine/src/lib.rs` | Import new modules, extend `tick()` with ECS/BVH/raycast steps |
| `rust-engine/src/memory.rs` | New read/write helpers for ECS regions, interaction control words |
| `rust-engine/src/camera.rs` | Add `forward_vector()` export |
| `src/main.ts` | Add `InteractionReader`, `InteractWriter`, `InteractionOverlay` to rAF loop |
| `src/shared/generated.ts` | (auto-generated) new constants |
| `rust-engine/src/generated.rs` | (auto-generated) new constants and structs |

---

## 16. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BVH rebuild at 60Hz too slow for 2048 entities | Low | Medium | Profile early. Fall back to spatial hash grid or incremental refit. |
| SAB size exceeds browser limits | Very Low | High | Total is ~270 MB. Chrome supports up to 4 GB on 64-bit. |
| Component data races (Rust writes while JS reads) | Medium | Low | Acceptable for display data -- a torn read shows stale stats for one frame. Use `Atomics` only for control words. |
| Entity pool fragmentation | Low | Low | Fixed-size slots eliminate fragmentation. Free list is O(1). |
| BVH stack overflow for degenerate trees | Very Low | High | Fixed stack of 32 entries supports 2^32 nodes. Tree depth for 2048 entities is ~11. |
| Interaction event ring buffer overflow | Low | Low | 128 slots at 60Hz = 2.1 seconds of buffered events. Log a warning on drop. |
