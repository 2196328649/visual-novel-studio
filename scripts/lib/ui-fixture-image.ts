import { deflateSync } from 'node:zlib';

/** Small, deterministic local RGBA texture for UI acceptance; no downloads. */
export function uiFixturePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    const result=Buffer.alloc(data.length+12); result.writeUInt32BE(data.length,0); body.copy(result,4); result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4); return result;
  };
  const header=Buffer.alloc(13); header.writeUInt32BE(8,0); header.writeUInt32BE(8,4); header[8]=8; header[9]=6;
  const pixels=Buffer.alloc(8*(1+8*4));
  for(let y=0;y<8;y++) for(let x=0;x<8;x++) { const offset=y*33+1+x*4; pixels[offset]=40+x*8; pixels[offset+1]=70+y*8; pixels[offset+2]=170; pixels[offset+3]=255; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
