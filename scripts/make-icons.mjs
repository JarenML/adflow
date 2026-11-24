// Builds the app icons from build/icon.svg: build/icon.ico (installer, .exe, taskbar) and
// build/icon.png (window icon in development). Run after changing the SVG: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'));
const png = (size) => sharp(svg).resize(size, size).png().toBuffer();

const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = await pngToIco(await Promise.all(sizes.map(png)));
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
fs.writeFileSync(path.join(dir, 'icon.png'), await png(512));
console.log(`build/icon.ico (${sizes.join(', ')} px) y build/icon.png (512 px)`);
