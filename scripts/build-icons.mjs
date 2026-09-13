import {deflateSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
const size=256,stride=size*4+1,pixels=Buffer.alloc(stride*size);
const glyph=['10000','10000','11110','10001','10001','10001','11110'];
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const dx=Math.max(0,44-x,x-(size-45)),dy=Math.max(0,44-y,y-(size-45));const visible=dx*dx+dy*dy<=44*44;
 const gx=Math.floor((x-65)/18),gy=Math.floor((y-43)/24);
 const ink=(gx>=0&&gx<5&&gy>=0&&gy<7&&glyph[gy][gx]==='1')||(x>=182&&x<204&&y>=189&&y<211);
 const p=y*stride+1+x*4;pixels[p]=ink?30:188;pixels[p+1]=ink?48:243;pixels[p+2]=ink?24:123;pixels[p+3]=visible?255:0;
}
function crc(data){let c=0xffffffff;for(const byte of data){c^=byte;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await mkdir('assets',{recursive:true});await mkdir('dist',{recursive:true});await writeFile('assets/icon.ico',Buffer.concat([header,png]));await writeFile('dist/icon.png',png);
