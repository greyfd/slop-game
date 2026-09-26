// Terrain vertex + fragment shader
//
// Vertex layout (interleaved, 24 bytes stride):
//   @location(0) position: vec3<f32>
//   @location(1) normal:   vec3<f32>
//
// Uniforms:
//   @group(0) @binding(0) viewProjection: mat4x4<f32>

struct Uniforms {
    viewProjection: mat4x4<f32>,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) worldNormal: vec3<f32>,
    @location(1) worldPos: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.clipPosition = uniforms.viewProjection * vec4<f32>(input.position, 1.0);
    output.worldNormal = input.normal;
    output.worldPos = input.position;
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

    // Height-based coloring
    let h = input.worldPos.y;

    // Color palette
    let waterColor = vec3<f32>(0.15, 0.3, 0.5);
    let sandColor = vec3<f32>(0.76, 0.7, 0.5);
    let grassColor = vec3<f32>(0.22, 0.48, 0.14);
    let rockColor = vec3<f32>(0.45, 0.38, 0.32);
    let snowColor = vec3<f32>(0.92, 0.92, 0.96);

    var baseColor: vec3<f32>;
    if (h < -0.5) {
        baseColor = waterColor;
    } else if (h < 0.5) {
        let t = (h + 0.5) / 1.0;
        baseColor = mix(waterColor, sandColor, t);
    } else if (h < 2.0) {
        let t = (h - 0.5) / 1.5;
        baseColor = mix(sandColor, grassColor, t);
    } else if (h < 5.0) {
        let t = (h - 2.0) / 3.0;
        baseColor = mix(grassColor, rockColor, t);
    } else if (h < 8.0) {
        let t = (h - 5.0) / 3.0;
        baseColor = mix(rockColor, snowColor, t);
    } else {
        baseColor = snowColor;
    }

    // Apply slope darkening (steep = more rock-like)
    let slopeFactor = 1.0 - normal.y; // 0 = flat, 1 = vertical
    let slopeColor = mix(baseColor, rockColor, slopeFactor * 0.6);

    let finalColor = slopeColor * lighting;

    // Simple distance fog
    let dist = length(input.worldPos);
    let fogStart = 80.0;
    let fogEnd = 200.0;
    let fogColor = vec3<f32>(0.6, 0.7, 0.85);
    let fogFactor = clamp((dist - fogStart) / (fogEnd - fogStart), 0.0, 1.0);

    let fogged = mix(finalColor, fogColor, fogFactor);

    return vec4<f32>(fogged, 1.0);
}
