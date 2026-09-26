/**
 * WebGPU device and canvas context initialization.
 */

export interface GPUContext {
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
    canvas: HTMLCanvasElement;
    depthTexture: GPUTexture;
    depthFormat: GPUTextureFormat;
}

/**
 * Initialize WebGPU: request adapter, device, configure canvas context,
 * and create the depth texture.
 *
 * Throws descriptive errors if WebGPU is unavailable.
 */
export async function initGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('No appropriate GPU adapter found.');
    }

    const device = await adapter.requestDevice();

    const rawContext = canvas.getContext('webgpu');
    if (!rawContext) {
        throw new Error('Failed to get WebGPU canvas context.');
    }
    // getContext('webgpu') is typed as RenderingContext union; narrow to GPUCanvasContext
    const context: GPUCanvasContext = rawContext as unknown as GPUCanvasContext;

    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
    });

    const depthFormat: GPUTextureFormat = 'depth24plus';
    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: depthFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    return { device, context, format, canvas, depthTexture, depthFormat };
}

/**
 * Recreate the depth texture after canvas resize.
 */
export function recreateDepthTexture(gpu: GPUContext): GPUContext {
    gpu.depthTexture.destroy();
    const depthTexture = gpu.device.createTexture({
        size: { width: gpu.canvas.width, height: gpu.canvas.height },
        format: gpu.depthFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return { ...gpu, depthTexture };
}
