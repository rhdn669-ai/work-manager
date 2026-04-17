import sharp from 'sharp';

const { data, info } = await sharp('./public/iopn-logo.png')
  .raw()
  .toBuffer({ resolveWithObject: true });

let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const r = data[i], g = data[i+1], b = data[i+2];
    // 주황색 픽셀만 찾기 (R이 높고 G가 중간이고 B가 낮음)
    if (r > 180 && g > 100 && g < 200 && b < 80) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const pad = 30;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(info.width - 1, maxX + pad);
maxY = Math.min(info.height - 1, maxY + pad);

console.log('Logo bounds:', minX, minY, maxX - minX, maxY - minY);

await sharp('./public/iopn-logo.png')
  .extract({ left: minX, top: minY, width: maxX - minX, height: maxY - minY })
  .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png()
  .toFile('./public/iopn-icon.png');

console.log('Done');
