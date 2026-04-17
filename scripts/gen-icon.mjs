import sharp from 'sharp';

const { data, info } = await sharp('./public/iopn-logo.png').raw().toBuffer({ resolveWithObject: true });

let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const r = data[i], g = data[i+1], b = data[i+2];
    if (r > 180 && g > 100 && g < 200 && b < 80) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const pad = 40;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(info.width - 1, maxX + pad);
maxY = Math.min(info.height - 1, maxY + pad);

const w = maxX - minX;
const h = maxY - minY;
const size = Math.max(w, h);
const offsetX = Math.floor((size - w) / 2);
const offsetY = Math.floor((size - h) / 2);

// 정사각형 흰 배경에 로고 합성
const logoBuf = await sharp('./public/iopn-logo.png')
  .extract({ left: minX, top: minY, width: w, height: h })
  .resize(512 - offsetX * 2, 512 - offsetY * 2, { fit: 'fill' })
  .png()
  .toBuffer();

const whiteBg = await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } }
}).png().toBuffer();

await sharp(whiteBg)
  .composite([{ input: logoBuf, gravity: 'center' }])
  .png()
  .toFile('./public/iopn-icon.png');

console.log('Done');
