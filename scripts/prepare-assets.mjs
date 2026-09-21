import { cp, mkdir } from 'node:fs/promises';

await mkdir('public', { recursive: true });
await cp('output/blender/assets', 'public/assets', { recursive: true });
await cp('node_modules/three/examples/jsm/libs/draco/gltf', 'public/draco', { recursive: true });
await mkdir('public/images', { recursive: true });
await cp('output/blender/finished/exterior.png', 'public/images/exterior.png');
await cp('output/blender/finished/interior.png', 'public/images/interior.png');
await cp('output/blender/textures/gltf/spruce-color.png', 'public/images/wood.png');
console.log('Blender assets and local Draco decoder are ready.');
