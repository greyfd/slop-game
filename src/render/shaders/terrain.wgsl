// Terrain vertex + fragment shader
//
// Vertex layout (interleaved, 36 bytes stride):
//   @location(0) position: vec3<f32>
//   @location(1) normal:   vec3<f32>
//   @location(2) color:    vec3<f32>
//
// Uniforms:
//   @group(0) @binding(0) viewProjection: mat4x4<f32>

struct Uniforms {
    viewProjection: mat4x4<f32>,
    cameraPosition: vec4<f32>,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) worldNormal: vec3<f32>,
    @location(1) worldPos: vec3<f32>,
    @location(2) vertexColor: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.clipPosition = uniforms.viewProjection * vec4<f32>(input.position, 1.0);
    output.worldNormal = input.normal;
    output.worldPos = input.position;
    output.vertexColor = input.color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(0.4, 0.8, 0.3));
    let normal = normalize(input.worldNormal);

    // Diffuse lighting
    let ndotl = max(dot(normal, lightDir), 0.0);
    let ambient = 0.25;
    let lighting = ambient + ndotl * 0.75;

    // Apply slope darkening (steep = more rock-like)
    let slopeFactor = 1.0 - normal.y; // 0 = flat, 1 = vertical
    let rockColor = vec3<f32>(0.45, 0.38, 0.32);
    let slopeColor = mix(input.vertexColor, rockColor, slopeFactor * 0.6);

    let finalColor = slopeColor * lighting;

    // Accurate distance fog from camera
    let dist = distance(input.worldPos, uniforms.cameraPosition.xyz);
    let fogStart = 600.0;
    let fogEnd = 1400.0;
    let fogColor = vec3<f32>(0.6, 0.7, 0.85); // Matches canvas clear color
    let fogFactor = clamp((dist - fogStart) / (fogEnd - fogStart), 0.0, 1.0);

    let fogged = mix(finalColor, fogColor, fogFactor);

    return vec4<f32>(fogged, 1.0);
}
