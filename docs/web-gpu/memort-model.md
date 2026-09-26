### 14.5. Memory Model

In general, WGSL follows the [Vulkan Memory Model](#biblio-vulkanmemorymodel "Vulkan Memory Model"). The remainder of this section describes how WGSL programs map to the Vulkan Memory Model.

Note: The Vulkan Memory Model is a textual version of a [formal Alloy model](https://github.com/KhronosGroup/Vulkan-MemoryModel/blob/master/alloy/spirv.als).

#### 14.5.1. Memory OperationIn WGSL, a [read access](#read-access) is equivalent to a memory read operation in the Vulkan Memory Model. In WGSL, a [write access](#write-access) is equivalent to a memory write operation in the Vulkan Memory Model.

A [read access](#read-access) occurs when an invocation executes one of the following:

- An evaluation of the [Load Rule](#load-rule)
- An evaluation of the [Swizzle View Load Rule](#swizzle-view-load-rule)
- Any [texture builtin function](#texture-builtin-functions) except:
	- [textureDimensions](#texturedimensions)
		- [textureStore](#texturestore)
		- [textureNumLayers](#texturenumlayers)
		- [textureNumLevels](#texturenumlevels)
		- [textureNumSamples](#texturenumsamples)
- Any atomic built-in function except [atomicStore](#atomic-store)
- A [workgroupUniformLoad](#workgroupUniformLoad-builtin) built-in function
- A [swizzle assignment](#swizzle-assignment) statement (for the [left-hand side](#left-hand-side) expression)
- A [compound assignment](#compound-assignment) statement (for the [left-hand side](#left-hand-side) expression)

A [write access](#write-access) occurs when an invocation executes one of the following:

- A [simple assignment](#simple-assignment), [swizzle assignment](#swizzle-assignment), or a [compound assignment](#compound-assignment) (for the [left-hand side](#left-hand-side) expression)
- A [textureStore](#texturestore) built-in function
- Any atomic built-in function except [atomicLoad](#atomic-load)
	- [atomicCompareExchangeWeak](#atomic-rmw) only performs a write if the `exchanged` member of the returned result is `true`

[Atomic read-modify-write](#atomic-rmw) built-in functions perform a single memory operation that is both a [read access](#read-access) and a [write access](#write-access).

Read and write accesses do not occur under any other circumstances. Read and write accesses are collectively known as [memory operations](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-memory-operation) in the Vulkan Memory Model.

A memory operation via a [memory view](#memory-view) generally accesses exactly the set of [locations](#memory-locations) associated with that [memory view](#memory-view). The exception is that a write access to a component of a vector **may** access all memory locations associated with that vector.

- For example, a memory read that accesses a [u32](#u32) from a struct containing multiple members, only reads the memory locations associated with that u32 member.
- For example, a memory write to the second component of a three element vector will write the locations for that second component, and may read and may write all three elements of the vector.

A memory operation via a [swizzle view](#swizzle-view) will access all memory locations associated with the underlying vector. See [swizzle view read](#swizzle-view-read) and [swizzle view write](#swizzle-view-write) for details.EXAMPLE: Accessing memory locations

struct S {
  a : f32,
  b : u32,
  c : f32
}

@group(0) @binding(0)
var<storage\> v : S;

fn foo() {
  let x \= v.b; // Does not access memory locations for v.a or v.c.
}

#### 14.5.2. Memory Model ReferenceEach module-scope [resource](#resource) variable forms a [memory model reference](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-references) for the unique [group](#attribute-group) and [binding](#attribute-binding) pair. Each other variable (i.e. variables in the [function](#address-spaces-function), [private](#address-spaces-private), and [workgroup](#address-spaces-workgroup) address spaces) forms a unique [memory model reference](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-references) for the lifetime of the variable.

#### 14.5.3. Scoped OperationsWhen an invocation performs a scoped operation, it will affect one or two sets of invocations. These sets are the memory scope and the execution scope. The memory scope specifies the set of invocations that will see any updates to memory contents affected by the operation. For [synchronization built-in functions](#sync-builtin-functions), this also means that all affected memory operations program ordered before the function are visible to affected operations program ordered after the function. The execution scope specifies the set of invocations which may participate in an operation (see [§ 15.6 Collective Operations](#collective-operations)).

[Atomic built-in functions](#atomic-builtin-functions) map to [atomic operations](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-atomic-operation) whose memory [scope](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-scope) is:

- `Workgroup` if the atomic pointer is in the [workgroup](#address-spaces-workgroup) address space
- `QueueFamily` if the atomic pointer is in the [storage](#address-spaces-storage) address space

[Synchronization built-in functions](#sync-builtin-functions) map to control barriers whose execution and memory [scopes](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-scope) are `Workgroup`.

Implicit and explicit [derivatives](#derivatives) have an implicit [quad](#quad) execution scope.

Note: If the Vulkan memory model is not enabled in generated shaders, `Device` scope should be used instead of `QueueFamily`.

#### 14.5.4. Memory SemanticsAll [Atomic built-in functions](#atomic-builtin-functions) use `Relaxed` [memory semantics](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-memory-semantics) and, thus, no storage class semantics.

Note: Address space in WGSL is equivalent to storage class in SPIR-V.

[workgroupBarrier](#sync-builtin-functions) uses `AcquireRelease` [memory semantics](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-memory-semantics) and `WorkgroupMemory` semantics. [storageBarrier](#sync-builtin-functions) uses `AcquireRelease` [memory semantics](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-memory-semantics) and `UniformMemory` semantics. [textureBarrier](#sync-builtin-functions) uses `AcquireRelease` [memory semantics](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-memory-semantics) and `ImageMemory` semantics.

Note: A combined `workgroupBarrier` and `storageBarrier` uses `AcquireRelease` ordering semantics and both `WorkgroupMemory` and `UniformMemory` memory semantics.

Note: No atomic or synchronization built-in functions use `MakeAvailable` or `MakeVisible` semantics.

#### 14.5.5. Private vs Non-privateAll non-atomic [read accesses](#read-access) in the [storage](#address-spaces-storage) or [workgroup](#address-spaces-workgroup) address spaces are considered [non-private](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-non-private) and correspond to read operations with `NonPrivatePointer | MakePointerVisible` memory operands with the `Workgroup` scope.

All non-atomic [write accesses](#write-access) in the [storage](#address-spaces-storage) or [workgroup](#address-spaces-workgroup) address spaces are considered [non-private](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-non-private) and correspond to write operations with `NonPrivatePointer | MakePointerAvailable` memory operands with the `Workgroup` scope.

All non-atomic [read accesses](#read-access) in the the [handle](#address-spaces-handle) address space are considered [non-private](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-non-private) and correspond to read operations with `NonPrivateTexel | MakeTexelVisible` memory operands with the `Workgroup` scope.

All non-atomic [write accesses](#write-access) in the [handle](#address-spaces-handle) address space are considered [non-private](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/html/vkspec.html#memory-model-non-private) and correspond to write operations with `NonPrivateTexel | MakeTexelAvailable` memory operands with the `Workgroup` scope.