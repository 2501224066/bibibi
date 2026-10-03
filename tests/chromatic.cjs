// Run with Node 22.6+: node tests/chromatic.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, now = 1000, audioTime = 0, tick, starts = [], stopped = 0
const oscillators = [], gains = [], filters = []
const intervals = new Map(); let nextTimerId = 0
const parameter = () => ({ value: 0, events: [], setValueAtTime(value, at) { this.events.push({ type: 'set', value, at }) }, linearRampToValueAtTime(value, at) { this.events.push({ type: 'linear', value, at }) }, exponentialRampToValueAtTime(value, at) { this.events.push({ type: 'exponential', value, at }) }, cancelScheduledValues() {} })
const audio = {
  get currentTime() { return audioTime }, destination: {}, resume() {}, close() {},
  createBuffer() { assert.fail('synthesis must not allocate sample buffers') },
  createBufferSource() { assert.fail('synthesis must not play sample buffers') },
  createBiquadFilter: () => { const filter = { type: '', frequency: parameter(), Q: parameter(), gain: parameter(), connections: [], connect(target) { this.connections.push(target) }, disconnect() {} }; filters.push(filter); return filter },
  createGain: () => { const node = { gain: parameter(), connections: [], connect(target) { this.connections.push(target) }, disconnect() {} }; gains.push(node); return node },
  createPeriodicWave: (real, imag) => ({ real, imag }),
  createOscillator: () => { const node = { setPeriodicWave(wave) { this.wave = wave; this.type = 'custom' }, frequency: parameter(), detune: parameter(), stops: [], connections: [], connect(target) { this.connections.push(target) }, disconnect() {}, start(at) { starts.push(at) }, stop(at) { this.stops.push(at); stopped++ } }; oscillators.push(node); return node },
}
const sandbox = {
  Component: value => { definition = value }, Date: { now: () => now },
  setInterval: callback => { const id = ++nextTimerId; intervals.set(id, callback); tick = callback; return id }, clearInterval: id => { intervals.delete(id); tick = [...intervals.values()].at(-1) || null },
  wx: { getFileSystemManager: () => ({ readFileSync(path, encoding) { assert.ok(!path.endsWith('.wav'), 'synthesis must not read audio files'); return fs.readFileSync('miniprogram/' + path, encoding) } }), getStorageSync() {}, setStorageSync() {}, hideKeyboard(options) { options.complete?.() }, createWebAudioContext: () => audio, showToast(options) { assert.fail(options.title) }, showModal: options => options.success?.({ confirm: true }) },
}
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) }, ...definition.methods }
const allPitches = new Set()
assert.equal(page.data.keys[0].pitchLabel, 'C4')
for (const instrument of ['piano', 'synth']) {
  page.setInstrument(instrument === 'piano' ? 1 : 2)
  for (let octave = 0; octave < 3; octave++) {
    page.setOctave(octave)
    for (let index = 0; index < 12; index++) {
      const midi = sandbox.shiftedPitch(index, octave)
      allPitches.add(midi)
      assert.equal(sandbox.shiftedPitch(index, octave), midi)
      assert.equal(page.data.keys[index].pitchLabel, sandbox.shiftedKey(index, octave).pitchLabel)
      page.playKey(index)
      if (instrument === 'synth') assert.ok(Math.abs(oscillators.at(-2).frequency.events.at(-1).value - 440 * Math.pow(2, (midi - 69) / 12)) < .001)
      else assert.ok(Math.abs(oscillators.at(-1).frequency.events[0].value - 440 * Math.pow(2, (midi - 69) / 12)) < .001)
      page.onKeyEnd()
    }
  }
}
assert.ok(allPitches.size >= 24)
page.setInstrument(0)
const drumSignatures = new Set()
for (let index = 0; index < 12; index++) {
  const first = oscillators.length
  page.playKey(index)
  const drumOscillators = oscillators.slice(first)
  const sound = vm.runInNewContext(`DRUM_SOUNDS[${page.data.keys[index].drumIconIndex}]`, sandbox)
  assert.equal(drumOscillators.length, sound.kind === 'metal' ? 2 : sound.kind === 'snare' ? 3 : 1)
  assert.equal(drumOscillators[0].stops[0], audioTime + sound.duration + .012)
  const signature = JSON.stringify(drumOscillators.map(node => [node.frequency.events, node.stops]))
  drumSignatures.add(signature)
  for (const suffix of ['', '-active']) assert.ok(fs.existsSync(`miniprogram/assets/drum-key-${index}${suffix}.svg`))
  page.onKeyEnd()
  const key = page.data.keys[index], x = (key.labelLeft - 50) / 50, y = (key.labelTop - 50) / 50
  assert.equal(JSON.stringify(drumOscillators.map(node => [node.frequency.events, node.stops])), signature, 'release leaves drum tails playing')
  assert.equal(key.drumLabel, sound.name, 'icon and triggered sound match')
  assert.equal(sandbox.padKeyAt(x, y), index)
}
assert.equal(drumSignatures.size, 12)
page.setInstrument(1); page.setOctave(1)
page.startRecording(); page.playKey(1); now += 200; page.onKeyEnd(); page.stopRecording()
assert.equal(page.data.tracks.find(t => t.notes.length).notes[0].midiNote, 62)
assert.equal(sandbox.restoreTracks(page.data.tracks).find(t => t.notes.length).notes[0].midiNote, 62)
page.createVoice('piano', 0, 1, false, audioTime, .2).stop()
assert.equal(oscillators.at(-1).frequency.events[0].value, 349.23, 'legacy F4 retains its original pitch')
page.pauseSession()
page.setInstrument(0); page.startRecording(); page.playKey(5); now += 100; page.onKeyEnd(); page.stopRecording()
assert.equal(page.data.tracks.find(t => t.instrument === 'drums').notes[0].index, 8, 'bottom kick records its stable sample index')
page.pauseSession()
const oldTracks = structuredClone(definition.data.tracks)
oldTracks[0] = { ...oldTracks[0], instrument: 'drums', duration: 100, notes: [{ index: 11, start: 0, duration: 100, octave: 1, vibrato: false }] }
const stored = { version: 1, mixes: [{ id: 'old', name: 'old', tracks: oldTracks }] }
sandbox.wx.getStorageSync = () => structuredClone(stored)
page.loadLibrary()
assert.equal(page.data.savedMixes[0].tracks[0].notes[0].index, 2, 'old repeated drum keys retain their original sound')
stored.soundLayoutVersion = 2
page.loadLibrary()
assert.equal(page.data.savedMixes[0].tracks[0].notes[0].index, 11, 'new sample indices survive reload')
console.log('PASS: 72 live pitches, 36 contiguous MIDI notes, 12 distinct synthesized drums without audio files/buffers, grid keys, recording round-trip and legacy playback')

// Envelopes preserve dynamics, future scheduling and release/cleanup for all voices.
for (const instrument of ['piano', 'drums', 'synth']) {
  page.pauseSession()
  const before = oscillators.length
  const startCount = starts.length
  const voice = page.createVoice(instrument, 0, 1, false, 5, .1, 0, 0, .4, 60)
  assert.ok(starts.slice(startCount).every(at => at === 5))
  const created = oscillators.slice(before)
  assert.ok(created.every(node => node.stops.some(at => at > 5.1)), 'scheduled notes include release tails')
  voice.stop()
  assert.ok(created.every(node => node.stops.at(-1) === audioTime), 'stop cleans up all oscillators')
}
for (const velocity of [.4, 1]) {
  const firstGain = gains.length
  const voice = page.createVoice('piano', 0, 1, false, audioTime, undefined, 0, 0, velocity, 60)
  const envelope = gains[firstGain].gain.events
  assert.equal(envelope.find(event => event.type === 'linear').value, vm.runInNewContext('INSTRUMENT_LEVELS.piano', sandbox) * velocity)
  assert.ok(envelope.find(event => event.type === 'exponential').value < .01)
  audioTime += .1
  voice.release()
  assert.equal(gains[firstGain].gain.events.at(-1).value, 0)
  assert.equal(oscillators.at(-1).stops.at(-1), audioTime + .18)
  voice.stop()
}
page.pauseSession()
const synthGainIndex = gains.length
const heldSynth = page.createVoice('synth', 0, 1, false, audioTime, undefined, 0, 0, .5, 60)
const attackLevel = gains[synthGainIndex].gain.events.find(event => event.type === 'linear').value
audioTime += .1
heldSynth.release()
audioTime += .02
heldSynth.retune(1, 1, false, 0, 61)
assert.equal(gains[synthGainIndex].gain.events.at(-1).value, attackLevel, 'retrigger retains the calibrated synth level')
heldSynth.stop()
page.setData({ tracks: structuredClone(definition.data.tracks), hasTracks: false })
for (const instrument of [0, 1, 2]) {
  page.setInstrument(instrument)
  page.startRecording(); page.playKey(0); now += 200; page.onKeyEnd(); page.stopRecording()
}
const scheduled = starts.length
page.togglePlayback()
assert.equal(page.data.isPlaying, true)
assert.ok(starts.length > scheduled, 'recorded piano, drums and synth can play together')
page.pauseSession()
assert.equal(intervals.size, 0)
console.log('PASS: synthesis scheduling, velocity, decay, release, oscillator cleanup and recorded mix playback')

// The hardware library key swaps only the upper display; the lower controls stay in place.
page.pauseSession()
page.setData({ libraryOpen: false, showSaveDialog: false, isRecording: false })
page.toggleLibrary()
assert.equal(page.data.libraryOpen, true)
page.toggleLibrary()
assert.equal(page.data.libraryOpen, false)

// The bottom delete key clears the current session, or the selected saved item in library mode.
const currentTracks = structuredClone(definition.data.tracks)
currentTracks[0] = { ...currentTracks[0], instrument: 'piano', name: '钢琴', selected: true, duration: 100,
  notes: [{ index: 0, start: 0, duration: 100, octave: 1, vibrato: false }], bars: [] }
page.setData({ tracks: currentTracks, hasTracks: true, libraryOpen: false })
page.deleteCurrent()
assert.ok(page.data.tracks.every(track => !track.notes.length))
const saved = { id: 'delete-me', name: '待删除', duration: 100, durationLabel: '0.1s', tracks: currentTracks }
page.setData({ savedMixes: [saved], selectedMixId: saved.id, libraryOpen: true })
page.deleteCurrent()
assert.equal(page.data.savedMixes.length, 0)
assert.equal(page.data.selectedMixId, '')
console.log('PASS: in-screen library toggle and context-aware bottom delete key')
