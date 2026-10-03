// Run: node tests/library-playback.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, tick
const audio = { currentTime: 0 }
const sandbox = { Component(value) { definition = value }, setInterval(fn) { tick = fn; return 1 }, clearInterval() {}, wx: {} }
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = { data: structuredClone(definition.data), ...definition.methods,
  setData(value, cb) { Object.assign(this.data, value); cb?.() },
  loadLibrary() {}, measureKeys() {}, getAudioContext: () => audio,
  createVoice: () => ({ stop() {} }),
}
const makeTracks = pitch => sandbox.restoreTracks([{ instrument: 'piano', duration: 500, notes: [{ index: 0, midiNote: pitch, start: 0, duration: 500, octave: 1, vibrato: false }] }])
const original = makeTracks(60)
original[0].selected = true
page.setData({ tracks: original, hasTracks: true, hasSelectedTracks: true, elapsedLabel: '0.5s', savedMixes: [{ id: 'song', name: '歌曲', tracks: makeTracks(67), duration: 500, durationLabel: '0.5s' }] })
page.openLibrary()
assert.equal(page.data.libraryOpen, true)
page.selectSavedMix({ currentTarget: { dataset: { id: 'song' } } })
page.togglePlayback()
assert.equal(page.data.libraryOpen, true, 'library button stays pressed during song playback')
assert.equal(page.data.libraryLift, false)
assert.equal(page.data.isPlaying, true)
assert.equal(page.data.tracks[0].notes[0].midiNote, 67)
page.togglePlayback()
assert.equal(page.data.libraryOpen, true)
assert.equal(page.data.isPlaying, false, 'manual stop returns to library list')
page.togglePlayback()
audio.currentTime = 2
tick()
assert.equal(page.data.libraryOpen, true)
assert.equal(page.data.isPlaying, false, 'natural end returns to library list')
page.togglePlayback()
for (const control of ['tone', 'range', 'metronome']) page.flashScreenControl(control)
page.closeLibrary()
assert.equal(JSON.stringify(page.data.controlFlashes), JSON.stringify({ tone: 0, range: 0, metronome: 0 }), 'closing the library cannot replay stale knob glows')
assert.equal(page.data.isPlaying, false)
assert.equal(page.data.libraryOpen, false)
assert.equal(page.data.hasSelectedTracks, true)
assert.equal(JSON.stringify(page.data.tracks), JSON.stringify(original), 'original unsaved tracks and selection restored')
page.openLibrary(); page.closeLibrary()
assert.equal(JSON.stringify(page.data.tracks), JSON.stringify(original), 'opening and closing without choosing a song is non-destructive')
console.log('PASS: library button stays on, manual/natural stop shows list, closing restores original tracks and selection')

let created = 0, stopped = 0, playbackError
sandbox.wx.showToast = value => { playbackError = value.title }
page.data.tracks[0].notes.push({ ...page.data.tracks[0].notes[0], start: 100 })
page.createVoice = () => {
  if (++created === 2) throw new Error('audio unavailable')
  return { stop() { stopped++ } }
}
page.togglePlayback()
assert.equal(page.data.isPlaying, false)
assert.equal(stopped, 1, 'partial scheduling is cleaned up when a later note fails')
assert.equal(playbackError, '播放失败，请重试')
page.animateSavedMix()
assert.equal(page.data.libraryGlow, true, 'successful saving visibly highlights the library button')
page.finishLibraryAnimation()
assert.equal(page.data.libraryGlow, false)
console.log('PASS: playback failure cleanup and save feedback')

for (const control of ['tone', 'range', 'metronome']) {
  page.flashScreenControl(control)
  assert.equal(page.data.controlFlashes[control], 1, 'knob change still starts a glow')
  page.finishScreenControlFlash({ currentTarget: { dataset: { control } } })
  assert.equal(page.data.controlFlashes[control], 0, 'completed glow removes its animation class')
}
const markup = fs.readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
for (const control of ['tone', 'range', 'metronome']) {
  assert.ok(markup.includes(`data-control="${control}" bindanimationend="finishScreenControlFlash"`))
}
console.log('PASS: control glows clear on animation completion and library close')
