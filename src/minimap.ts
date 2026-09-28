import { MemoryMap } from './shared/generated';

const BIOME_COLORS: Record<number, [number, number, number]> = {
    0: [140, 140, 140], // Polar Desert
    1: [165, 165, 178], // Alpine Tundra
    2: [242, 250, 255], // Glacier
    3: [191, 165, 102], // Highland Steppe
    4: [63, 89, 63],    // Boreal Forest
    5: [38, 102, 51],   // Temperate Rainforest
    6: [204, 114, 76],  // High Desert
    7: [178, 89, 38],   // Deciduous Woodlands
    8: [25, 63, 38],    // Redwood Coast
    9: [229, 216, 204], // Salt Flat
    10: [38, 76, 127],  // Ocean
};

export class Minimap {
    private ctx: CanvasRenderingContext2D;
    private minimapArray: Uint8Array;
    private imageData: ImageData;
    
    // 16.2km map -> 64 chunks, 128 grids per chunk, 2 meters per grid
    private totalWorldSize = 64 * (128 - 1) * 2.0;

    constructor(sab: SharedArrayBuffer) {
        const canvas = document.getElementById('minimap') as HTMLCanvasElement;
        this.ctx = canvas.getContext('2d')!;
        // 64x64 mapped to 256x256 (4x scale handled manually in imageData)
        this.imageData = this.ctx.createImageData(256, 256);
        
        this.minimapArray = new Uint8Array(sab, MemoryMap.MINIMAP_DATA_START, MemoryMap.MINIMAP_DATA_SIZE);
    }

    render(playerX: number, playerZ: number) {
        // Render map pixels
        const data = this.imageData.data;
        for (let z = 0; z < 64; z++) {
            for (let x = 0; x < 64; x++) {
                const biomeId = this.minimapArray[z * 64 + x];
                const color = BIOME_COLORS[biomeId] || [255, 0, 255];
                
                // Draw a 4x4 block
                for (let dy = 0; dy < 4; dy++) {
                    for (let dx = 0; dx < 4; dx++) {
                        const px = x * 4 + dx;
                        const py = z * 4 + dy;
                        const i = (py * 256 + px) * 4;
                        data[i] = color[0];
                        data[i+1] = color[1];
                        data[i+2] = color[2];
                        data[i+3] = 255;
                    }
                }
            }
        }
        
        this.ctx.putImageData(this.imageData, 0, 0);
        
        // Draw player dot
        // World coordinates are roughly -8100 to +8100
        const halfWorld = this.totalWorldSize / 2;
        const normX = (playerX + halfWorld) / this.totalWorldSize;
        const normZ = (playerZ + halfWorld) / this.totalWorldSize;
        
        const dotX = normX * 256;
        const dotY = normZ * 256;
        
        this.ctx.fillStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }
}
