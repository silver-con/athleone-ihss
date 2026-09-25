// Regenerates the app icons (PWA + Android) from public/icons/*.svg.
// Only needed if you change the icon artwork:  node scripts/generate-icons.mjs
// Uses sharp, which ships with Next.js.
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';

const icon = 'public/icons/hearth-icon.svg';
const maskable = 'public/icons/hearth-maskable.svg';

const out = [
  [icon, 'public/icons/icon-192.png', 192],
  [icon, 'public/icons/icon-512.png', 512],
  [maskable, 'public/icons/maskable-512.png', 512],
  [icon, 'public/apple-touch-icon.png', 180],
  [icon, 'app/icon.png', 64],
];
for (const [src, dest, size] of out) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(dest);
  console.log('wrote', dest);
}

// Android launcher icons for the Capacitor app (mobile/android), if present.
const res = 'mobile/android/app/src/main/res';
if (existsSync(res)) {
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, size] of Object.entries(densities)) {
    const dir = `${res}/mipmap-${d}`;
    mkdirSync(dir, { recursive: true });
    await sharp(icon, { density: 300 }).resize(size, size).png().toFile(`${dir}/ic_launcher.png`);
    await sharp(icon, { density: 300 }).resize(size, size).png().toFile(`${dir}/ic_launcher_round.png`);
    // Adaptive-icon foreground is 108dp with the art in the middle 72dp.
    const fg = Math.round(size * 2.25);
    await sharp(maskable, { density: 300 }).resize(fg, fg).png().toFile(`${dir}/ic_launcher_foreground.png`);
  }
  // Splash screens: teal background, icon centered at ~1/4 of the short side.
  const { readdirSync } = await import('node:fs');
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = `${res}/${dir}/splash.png`;
    if (!existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    const size = Math.round(Math.min(width, height) * 0.28);
    const logo = await sharp(maskable, { density: 300 }).resize(size, size).png().toBuffer();
    const bg = await sharp({ create: { width, height, channels: 4, background: '#23776d' } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toBuffer();
    await sharp(bg).toFile(file);
  }
  console.log('wrote Android launcher icons and splash screens');
}
