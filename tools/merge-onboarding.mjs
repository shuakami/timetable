import sharp from 'sharp';
import path from 'path';

const files = [
  'C:\\Users\\win11\\.gaga\\web-4c96cd01-bc25-4b0e-b876-0aa69debd57f\\deliverables\\screenshots\\screenshot-1788431164812.png',
  'C:\\Users\\win11\\.gaga\\web-4c96cd01-bc25-4b0e-b876-0aa69debd57f\\deliverables\\screenshots\\screenshot-1788431174091.png',
  'C:\\Users\\win11\\.gaga\\web-4c96cd01-bc25-4b0e-b876-0aa69debd57f\\deliverables\\screenshots\\screenshot-1788431182223.png',
];

const GAP = 24;
const RADIUS = 40;
const BG = '#EDEDEB';

const images = await Promise.all(files.map(f => sharp(f).metadata().then(m => ({ meta: m, path: f }))));
const w = images[0].meta.width;
const h = images[0].meta.height;

const totalW = w * 3 + GAP * 4;
const totalH = h + GAP * 2;

const composites = [];
for (let i = 0; i < 3; i++) {
  const x = GAP + i * (w + GAP);
  const y = GAP;
  const rounded = await sharp(files[i])
    .png()
    .toBuffer()
    .then(buf => sharp(buf)
      .composite([{
        input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="white"/></svg>`),
        blend: 'dest-in',
      }])
      .toBuffer());
  composites.push({ input: rounded, left: x, top: y });
}

await sharp({
  create: { width: totalW, height: totalH, channels: 4, background: BG }
})
  .composite(composites)
  .png()
  .toFile('C:\\Users\\Shuakami_Projects\\Mine\\timetable\\docs\\screenshots\\onboarding-group.png');

console.log('done');
