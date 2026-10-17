// Read container metadata without decoding or executing user supplied media.
const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
export const videoLimit = 200 * 1024 * 1024

function mp4(bytes) {
  let dimensions, duration = 0, visited = 0, videoTrack = false
  function boxes(start, end, depth = 0) {
    const result = []
    for (let offset = start; offset + 8 <= end;) {
      if (++visited > 100000 || depth > 8) invalid('视频容器过于复杂')
      let size = bytes.readUInt32BE(offset), head = 8
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (size === 1) { if (offset + 16 > end) invalid('视频容器不完整'); const large = bytes.readBigUInt64BE(offset + 8); if (large > BigInt(end)) invalid('视频容器不完整'); size = Number(large); head = 16 }
      if (!size) size = end - offset
      if (size < head || offset + size > end) invalid('视频容器不完整')
      result.push({ type, start: offset + head, end: offset + size, depth })
      offset += size
    }
    return result
  }
  const root = boxes(0, bytes.length), moov = root.find(b => b.type === 'moov')
  if (!root.some(b => b.type === 'ftyp') || !moov || !root.some(b => b.type === 'mdat')) invalid('请上传完整的 MP4 视频')
  for (const box of boxes(moov.start, moov.end, 1)) {
    if (box.type === 'mvhd') {
      const v1 = bytes[box.start] === 1, at = box.start + (v1 ? 20 : 12)
      if (at + (v1 ? 12 : 8) <= box.end) { const scale = bytes.readUInt32BE(at), ticks = v1 ? Number(bytes.readBigUInt64BE(at + 4)) : bytes.readUInt32BE(at + 4); if (scale) duration = ticks / scale }
    }
    if (box.type !== 'trak') continue
    const track = boxes(box.start, box.end, 2), mdia = track.find(b => b.type === 'mdia'), tkhd = track.find(b => b.type === 'tkhd')
    const handler = mdia && boxes(mdia.start, mdia.end, 3).find(b => b.type === 'hdlr')
    if (!handler || handler.start + 12 > handler.end || bytes.toString('ascii', handler.start + 8, handler.start + 12) !== 'vide') continue
    videoTrack = true
    if (tkhd && tkhd.end - tkhd.start >= 84) dimensions = { width: Math.round(bytes.readUInt32BE(tkhd.end - 8) / 65536), height: Math.round(bytes.readUInt32BE(tkhd.end - 4) / 65536) }
  }
  if (!videoTrack) invalid('文件没有视频轨道')
  return { ...dimensions, duration, mimeType: 'video/mp4', extension: 'mp4' }
}

function webm(bytes) {
  let count = 0, width = 0, height = 0, duration = 0, scale = 1000000, videoTrack = false, docType = ''
  function vint(at, id = false) {
    const first = bytes[at]; if (!first) invalid('WebM 容器不完整')
    let length = 1, marker = 128
    while (!(first & marker)) { length++; marker >>= 1 }
    if (length > (id ? 4 : 8) || at + length > bytes.length) invalid('WebM 容器无效')
    let value = BigInt(id ? first : first & (marker - 1))
    for (let i = 1; i < length; i++) value = value * 256n + BigInt(bytes[at + i])
    return { length, value, unknown: !id && value === (1n << BigInt(7 * length)) - 1n }
  }
  const containers = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0])
  function walk(start, end, depth = 0) {
    for (let at = start; at < end;) {
      if (++count > 100000 || depth > 8) invalid('视频容器过于复杂')
      const tag = vint(at, true), size = vint(at + tag.length), begin = at + tag.length + size.length, finish = size.unknown ? end : begin + Number(size.value), id = Number(tag.value)
      if (finish > end || finish <= at) invalid('WebM 容器不完整')
      const uint = () => { if (finish - begin > 8) return 0; let value = 0; for (let i = begin; i < finish; i++) value = value * 256 + bytes[i]; return value }
      if (id === 0x4282) docType = bytes.toString('ascii', begin, finish)
      if (id === 0x83 && uint() === 1) videoTrack = true
      if (id === 0xb0) width = uint()
      if (id === 0xba) height = uint()
      if (id === 0x2ad7b1) scale = uint()
      if (id === 0x4489) duration = finish - begin === 4 ? bytes.readFloatBE(begin) : finish - begin === 8 ? bytes.readDoubleBE(begin) : 0
      if (containers.has(id)) walk(begin, finish, depth + 1)
      at = finish
    }
  }
  walk(0, bytes.length)
  if (docType !== 'webm' || !videoTrack) invalid('请上传包含视频轨道的 WebM 文件')
  return { width, height, duration: duration * scale / 1e9, mimeType: 'video/webm', extension: 'webm' }
}

export function videoMetadata(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > videoLimit) invalid('视频需小于 200 MB')
  const info = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' ? mp4(bytes) : bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 ? webm(bytes) : invalid('仅支持 MP4、WebM 视频')
  if (!info.width || !info.height || info.width > 32768 || info.height > 32768 || !Number.isFinite(info.duration) || info.duration < 0) invalid('无法读取视频尺寸或时长')
  return info
}
