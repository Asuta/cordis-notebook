import sharp from 'sharp'

// Compatibility budget for the upload path; leave room below 2 MiB for the
// multipart envelope and up to 24,000 prompt characters. Originals stay intact.
export const referenceUploadBudget = 2 * 1024 * 1024 - 128 * 1024

export async function prepareReferences(images, { budget = referenceUploadBudget } = {}) {
  const original = images.map((bytes, index) => ({ bytes, type: 'image/png', name: `reference-${index + 1}.png` }))
  if (images.reduce((sum, bytes) => sum + bytes.length, 0) <= budget) return original
  const allowance = Math.floor(budget / images.length), result = []
  for (const [index, bytes] of images.entries()) {
    if (bytes.length <= allowance) { result.push(original[index]); continue }
    const source = sharp(bytes, { limitInputPixels: 50_000_000 }), metadata = await source.metadata()
    const transparent = metadata.hasAlpha && !(await source.clone().stats()).isOpaque
    const sizes = [...new Set([2048, 1536, 1024, 768, 512, 384, 256, 128].map(size => Math.min(size, Math.max(metadata.width, metadata.height))))]
    let encoded
    for (const size of sizes) {
      const scaled = source.clone().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      const candidate = await (transparent ? scaled.png({ compressionLevel: 9 }) : scaled.jpeg({ quality: 90, mozjpeg: true })).toBuffer()
      if (candidate.length <= allowance) { encoded = candidate; break }
    }
    if (!encoded) throw Error('参考图优化后仍过大，请减少参考图数量或尺寸后再生成')
    result.push({ bytes: encoded, type: transparent ? 'image/png' : 'image/jpeg', name: `reference-${index + 1}.${transparent ? 'png' : 'jpg'}` })
  }
  return result
}
