import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const assetDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const [observatory, station, lin, yao] = process.argv.slice(2)
if (![observatory, station, lin, yao].every(Boolean)) throw Error('请提供 4 张生成图路径：观测室、车站、林汐、姚青')
for (const [source, target] of [[observatory, 'observatory.png'], [station, 'station.png']]) {
  await sharp(source).resize(1280, 720, { fit: 'cover' }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(join(assetDir, target))
}
for (const [source, target] of [[lin, 'lin.png'], [yao, 'yao.png']]) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info, count = width * height, seen = new Uint8Array(count), queue = new Int32Array(count)
  let start = 0, end = 0
  const visit = index => {
    if (seen[index]) return
    const offset = index * 4
    if (data[offset] < 242 || data[offset + 1] < 242 || data[offset + 2] < 242) return
    seen[index] = 1; queue[end++] = index
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1) }
  while (start < end) {
    const index = queue[start++], x = index % width, y = (index / width) | 0
    data[index * 4 + 3] = 0
    if (x) visit(index - 1)
    if (x + 1 < width) visit(index + 1)
    if (y) visit(index - width)
    if (y + 1 < height) visit(index + width)
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).resize(720, 1080).png({ compressionLevel: 9 }).toFile(join(assetDir, target))
}
console.log('已准备 4 张视觉小说素材')
