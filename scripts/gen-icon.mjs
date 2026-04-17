import sharp from 'sharp';

const { data, info } = await sharp('./public/iopn-logo.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

// 불투명 픽셀 바운딩박스
let x0=width, x1=0, y0=height, y1=0;
for(let y=0; y<height; y++) for(let x=0; x<width; x++) {
  if(data[(y*width+x)*4+3] > 10) {
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
  }
}
const pad = 40;
const lx=Math.max(0,x0-pad), ly=Math.max(0,y0-pad);
const lw=Math.min(width,x1+pad+1)-lx, lh=Math.min(height,y1+pad+1)-ly;
const square = Math.max(lw, lh);
const eTop = Math.floor((square-lh)/2), eBot = square-lh-eTop;
const eLft = Math.floor((square-lw)/2), eRgt = square-lw-eLft;
console.log(`crop=${lw}x${lh} square=${square} extend T${eTop}B${eBot}L${eLft}R${eRgt}`);

// 단계별로 파일 저장
await sharp('./public/iopn-logo.png')
  .extract({ left:lx, top:ly, width:lw, height:lh })
  .png().toFile('./public/_crop.png');

await sharp('./public/_crop.png')
  .extend({ top:eTop, bottom:eBot, left:eLft, right:eRgt,
    background:{r:255,g:255,b:255,alpha:255} })
  .png().toFile('./public/_square.png');

const m = await sharp('./public/_square.png').metadata();
console.log(`Square actual: ${m.width}x${m.height}`);

await sharp('./public/_square.png').resize(512,512,{fit:'fill'}).png().toFile('./public/iopn-icon.png');
await sharp('./public/_square.png').resize(192,192,{fit:'fill'}).png().toFile('./public/iopn-icon-192.png');
await sharp('./public/_square.png').resize(512,512,{fit:'fill'}).png().toFile('./public/iopn-icon-512.png');

import { unlinkSync } from 'fs';
['_crop','_square'].forEach(f=>{try{unlinkSync(`./public/${f}.png`)}catch{}});
console.log('Done');
