import { promises as fs } from 'node:fs';
export async function writeTestTone(file: string, seconds: number, hz = 440) {
 const rate=16000,samples=Math.round(rate*seconds),wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(800*Math.sin(2*Math.PI*hz*i/rate)),44+i*2);
 await fs.writeFile(file,wav);
}
