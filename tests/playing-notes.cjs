// Run: node tests/playing-notes.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const sandbox = { Component() {} }
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const track = { instrument: 'piano', notes: [
  { index: 0, octave: 1, midiNote: 60, start: 100, duration: 200 },
  { index: 0, octave: 1, midiNote: 64, start: 150, duration: 100 },
] }
assert.equal(sandbox.playingNoteLabel(track, 99), '—')
assert.equal(sandbox.playingNoteLabel(track, 100), 'C4')
assert.equal(sandbox.playingNoteLabel(track, 150), 'C4 · E4')
assert.equal(sandbox.playingNoteLabel(track, 250), 'C4')
assert.equal(sandbox.playingNoteLabel(track, 300), '—')
assert.equal(sandbox.playingNoteLabel({ instrument: 'synth', notes: [{ index: 0, octave: 1, start: 0, duration: 100 }] }, 0), 'C4')
assert.equal(sandbox.playingNoteLabel({ instrument: 'drums', notes: [{ index: 8, start: 0, duration: 100 }] }, 0), '底鼓')
console.log('PASS: real-time notes, chords, rests, note boundaries, legacy pitches and drum names')

const drums = { instrument: 'drums', notes: [
  { index: 8, start: 0, duration: 500 },
  { index: 0, start: 100, duration: 500 },
] }
assert.equal(sandbox.playingDrumIcon(drums, 0), '/assets/drum-key-8.svg')
assert.equal(sandbox.playingDrumIcon(drums, 100), '/assets/drum-key-0.svg')
assert.equal(sandbox.playingDrumIcon(drums, 600), '')
assert.equal(sandbox.playingDrumIcon(track, 150), '')
console.log('PASS: drum symbols match recorded indices, latest strike wins during overlap, rests clear the symbol')
