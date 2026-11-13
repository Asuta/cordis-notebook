import { writeFile } from 'node:fs/promises'
const rate = 22050, length = Math.round(rate * 1.4), bytes = Buffer.alloc(44 + length * 2)
bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40)
for (let i = 0; i < length; i++) {
  const t = i / rate
  let value = 0
  for (const [start, freq] of [[0, 523.25], [.28, 659.25], [.56, 783.99]]) {
    const dt = t - start
    if (dt >= 0) value += Math.sin(2 * Math.PI * freq * dt) * Math.exp(-dt * 6) * Math.min(1, dt * 100) * .22
  }
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2)
}
await writeFile(new URL('../assets/signal-cue.wav', import.meta.url), bytes)
