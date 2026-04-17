import sharp from 'sharp';

const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="0" fill="#FF9800"/>
  <text x="256" y="340" font-family="Arial Black, Arial" font-weight="900" font-size="180" fill="white" text-anchor="middle">IOPN</text>
</svg>`);

await sharp(svg).resize(512, 512).png().toFile('./public/iopn-icon.png');
console.log('Done');
