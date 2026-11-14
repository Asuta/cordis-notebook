import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// A quiet 32-second loop: four repeating chords, soft bell melody and rain-like texture.
const rate = 16000, seconds = 32, frames = rate * seconds
const wav = Buffer.alloc(44 + frames * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
const chords = [[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66],[164.81,196,246.94]]
const notes = [440,392,329.63,392,349.23,329.63,293.66,261.63,329.63,392,440,392,329.63,293.66,261.63,293.66]
const ease = x => Math.min(1, x / .12, (2 - x) / .18)
for (let i = 0; i < frames; i++) {
  const t = i / rate, chord = chords[Math.floor(t / 8) % chords.length]
  let value = 0
  for (let j = 0; j < 3; j++) value += Math.sin(2 * Math.PI * chord[j] * t) * .07 + Math.sin(4 * Math.PI * chord[j] * t) * .012
  const beat = t % 2, bell = notes[Math.floor(t / 2) % notes.length]
  value += Math.sin(2 * Math.PI * bell * t) * .12 * Math.max(0, ease(beat)) * Math.exp(-beat * 1.8)
  const rain = (Math.sin(i * 12.9898) * Math.sin(i * 78.233)) * .009
  value = Math.max(-1, Math.min(1, (value + rain) * Math.min(1, t / 1.5, (seconds - t) / 1.5)))
  wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
}
const target = fileURLToPath(new URL('../assets/rain-theme.wav', import.meta.url))
await writeFile(target, wav)
console.log(target)
