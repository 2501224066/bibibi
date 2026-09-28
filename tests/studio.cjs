// Run with Node 22.6+: node tests/studio.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, now = 1000, audioTime = 0, tick, starts = [], stopped = 0
const oscillators = [], gains = [], sources = [], filters = []
const intervals = new Map(); let nextTimerId = 0
const parameter = () => ({ value: 0, events: [], setValueAtTime(value, at) { this.events.push({ type: 'set', value, at }) }, linearRampToValueAtTime(value, at) { this.events.push({ type: 'linear', value, at }) }, exponentialRampToValueAtTime(value, at) { this.events.push({ type: 'exponential', value, at }) }, cancelScheduledValues() {} })
const audio = {
  get currentTime() { return audioTime }, destination: {}, resume() {}, close() {},
  createBuffer: (channels, frames, sampleRate) => { const data = new Float32Array(frames); return { sampleRate, duration: frames / sampleRate, getChannelData: () => data } },
  createBufferSource: () => { let buffer = null; const source = { get buffer() { return buffer }, set buffer(value) { assert.ok(!buffer, 'source buffer can only be assigned once'); buffer = value }, playbackRate: parameter(), stops: [], connections: [], connect(target) { this.connections.push(target) }, disconnect() {}, start(at) { starts.push(at) }, stop(at) { this.stops.push(at); stopped++ } }; sources.push(source); return source },
  createBiquadFilter: () => { const filter = { type: '', frequency: parameter(), Q: parameter(), gain: parameter(), connections: [], connect(target) { this.connections.push(target) }, disconnect() {} }; filters.push(filter); return filter },
  createGain: () => { const node = { gain: parameter(), connections: [], connect(target) { this.connections.push(target) }, disconnect() {} }; gains.push(node); return node },
  createPeriodicWave: (real, imag) => ({ real, imag }),
  createOscillator: () => { const node = { setPeriodicWave(wave) { this.wave = wave; this.type = 'custom' }, frequency: parameter(), detune: parameter(), stops: [], connections: [], connect(target) { this.connections.push(target) }, disconnect() {}, start(at) { starts.push(at) }, stop(at) { this.stops.push(at); stopped++ } }; oscillators.push(node); return node },
}
const sandbox = {
  Component: value => { definition = value }, Date: { now: () => now },
  setInterval: callback => { const id = ++nextTimerId; intervals.set(id, callback); tick = callback; return id }, clearInterval: id => { intervals.delete(id); tick = [...intervals.values()].at(-1) || null },
  wx: { getFileSystemManager: () => ({ readFileSync(path, encoding) { if (encoding) return fs.readFileSync('miniprogram/' + path, encoding); const data = fs.readFileSync('miniprogram/' + path); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } }), getStorageSync() {}, setStorageSync() {}, hideKeyboard(options) { options.complete?.() }, createWebAudioContext: () => audio, showToast() {}, showModal: options => options.success?.({ confirm: true }) },
}
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) }, ...definition.methods }
// Check the ring geometry, centre and flared bottom against the actual hit testing.
const hit = (x, y) => sandbox.padKeyAt(x, y)
assert.equal(hit(0, 0), 8)
assert.equal(hit(0, .9), 8)
assert.equal(hit(1.01, 0), -1)
for (let index = 0; index < 8; index++) {
  const angle = (120 + (index + .5) * 300 / 8) * Math.PI / 180
  assert.equal(hit(.7 * Math.cos(angle), .7 * Math.sin(angle)), index)
}
assert.equal(page.data.keys.length, 9)
for (let index = 0; index < 9; index++) {
  page.playKey(index)
  assert.equal(page.data.activeIndex, index)
  assert.ok(Number.isFinite(sources.at(-1).playbackRate.events[0].value), 'each region has a valid sampled piano pitch')
  page.onKeyEnd()
}
// The four outer regions on each side mirror one another.
for (let index = 0; index < 4; index++) {
  const angle = (120 + (index + .5) * 300 / 8) * Math.PI / 180
  assert.equal(hit(-.7 * Math.cos(angle), .7 * Math.sin(angle)), 7 - index)
}
const gesture = x => ({ touches: [{ clientX: x }] })
page.onOctaveStart(gesture(100))
page.onOctaveMove(gesture(140))
assert.equal(page.data.octaveIndex, 2, 'dragging right rotates clockwise toward H')
page.onOctaveMove(gesture(300))
assert.equal(page.data.octaveIndex, 2, 'wheel clamps at high')
page.onOctaveEnd()
page.selectOctave({ currentTarget: { dataset: { index: 0 } } })
assert.equal(page.data.octaveIndex, 0, 'external labels remain tappable after dragging')
page.setOctave(1)
page.onOctaveStart(gesture(100))
page.onOctaveMove(gesture(60))
assert.equal(page.data.octaveIndex, 0, 'dragging left rotates counterclockwise toward L')
page.onOctaveMove(gesture(-100))
assert.equal(page.data.octaveIndex, 0, 'wheel clamps at low')
page.onOctaveEnd()
page.onOctaveStart(gesture(100))
page.onOctaveEnd()
page.selectOctave({ currentTarget: { dataset: { index: 1 } } })
assert.equal(page.data.octaveIndex, 1)
page.data.instrument = 'synth'
page.setVibrato({ detail: { value: true } })
assert.equal(page.data.vibrato, true)
page.setVibrato({ detail: { value: false } })
assert.equal(page.data.vibrato, false)
page.data.instrument = 'piano'
const initialInstrument = page.data.instrument
page.cycleInstrument()
assert.equal(page.data.instrument, 'synth')
page.cycleInstrument()
assert.equal(page.data.instrument, 'drums')
page.cycleInstrument()
assert.equal(page.data.instrument, initialInstrument)
const tap = id => ({ currentTarget: { dataset: { id } } })
page.togglePlayback()
assert.equal(page.data.isPlaying, false)
page.toggleRecording()
assert.equal(page.data.isRecording, true)
page.cycleInstrument()
assert.equal(page.data.instrument, 'piano', 'recording locks the instrument')
now += 100
page.playKey(2)
now += 400
page.onKeyEnd()
now += 100
page.toggleRecording()
let track = page.data.tracks[0]
assert.equal(track.notes.length, 1)
assert.equal(track.notes[0].start, 100)
assert.equal(track.notes[0].duration, 400)
assert.equal(track.bars.length, 1)
assert.equal(track.checked, true)
page.cycleInstrument()
page.cycleInstrument()
assert.equal(page.data.instrument, 'drums')
page.toggleRecording()
now += 100
page.playKey(0)
now += 200
page.onKeyEnd()
now += 100
page.stopRecording()
starts = []
page.togglePlayback()
assert.equal(page.data.isPlaying, true)
assert.equal(starts.length, 2)
assert.equal(starts[0], starts[1], 'tracks use the same audio clock')
page.toggleTrack(tap(0))
assert.equal(page.data.tracks[0].checked, true, 'selection is locked during playback')
audioTime = 1
tick()
assert.equal(page.data.isPlaying, false)
assert.equal(tick, null)
page.toggleTrack(tap(0))
assert.equal(page.data.tracks[0].checked, false)
page.toggleTrack(tap(0))
assert.equal(page.data.tracks[0].checked, true)
assert.equal(page.data.hasTracks, true)
page.cycleInstrument()
page.cycleInstrument()
assert.equal(page.data.instrument, 'synth')
page.toggleRecording()
page.playKey(4)
now += 17000
tick()
track = page.data.tracks[2]
assert.equal(page.data.isRecording, false)
assert.equal(track.duration, 16000)
assert.equal(track.notes[0].duration, 16000)
assert.equal(track.bars.length, 1)
page.togglePlayback()
page.pauseSession()
assert.equal(page.data.isPlaying, false)
assert.equal(page.data.activeIndex, -1)
assert.equal(tick, null)
assert.ok(stopped > 0)
console.log('PASS: octave wheel, vibrato switch, radial touch geometry, instrument cycling, recording, note bars, track selection, synchronized playback, 16s limit and cleanup')

// Only synth receives vibrato, including recordings with the effect flag.
page.getAudioContext()
for (const instrument of ['drums', 'piano', 'synth']) {
  for (const octave of [0, 1, 2]) {
    oscillators.length = 0; gains.length = 0
    const dry = page.createVoice(instrument, 2, octave, false, 3, .2)
    assert.equal(oscillators.length, instrument === 'synth' ? 1 : 0, 'piano/drums use samples, synth uses one carrier')
    dry.stop()
    oscillators.length = 0; gains.length = 0
    const wet = page.createVoice(instrument, 2, octave, true, 3, .2)
    if (instrument !== 'synth') {
      assert.equal(oscillators.length, 0, `${instrument} remains dry even with vibrato enabled`)
      wet.stop()
      continue
    }
    assert.equal(oscillators.length, 2, 'synth has one carrier and one vibrato LFO')
    assert.equal(oscillators[0].type, 'square', 'vibrato keeps the full square-wave carrier')
    assert.equal(filters.at(-1).frequency.events[0].value, 3200)
    const lfo = oscillators[1]
    const depth = gains[1]
    assert.equal(lfo.connections[0], depth)
    assert.equal(depth.connections[0], oscillators[0].detune)
    assert.equal(depth.gain.events[0].value, 0, 'newly enabled vibrato starts dry')
    assert.equal(depth.gain.events[1].at, 3.5, 'half-second switch delay')
    assert.equal(depth.gain.events[1].value, 0)
    assert.equal(depth.gain.events[2].type, 'linear')
    assert.equal(depth.gain.events[2].at, 3.7)
    assert.equal(depth.gain.events[2].value, 15, 'depth is 15 cents in every octave')
    assert.equal(depth.gain.events[0].at, 3)
    assert.equal(lfo.frequency.value, 7)
    wet.stop()
  }
}
// Enabling vibrato during a held note changes the voice and preserves the effect in recording.
page.data.instrument = 'synth'
page.data.vibrato = false
page.startRecording()
page.playKey(1)
now += 120
page.setVibrato({ detail: { value: true } })
now += 180
page.stopRecording()
const recorded = page.data.tracks[3].notes
assert.equal(recorded.length, 2)
assert.equal(recorded[0].vibrato, false)
assert.equal(recorded[1].vibrato, true)
assert.equal(recorded[1].duration, 180)
oscillators.length = 0
page.togglePlayback()
assert.ok(oscillators.some(node => node.frequency.value === 7), 'recorded vibrato is restored on playback')
page.stopPlayback()
page.setVibrato({ detail: { value: true } })
page.cycleInstrument()
assert.equal(page.data.instrument, 'drums')
page.setVibrato({ detail: { value: false } })
assert.equal(page.data.vibrato, true, 'other instruments cannot change the saved synth preference')
page.cycleInstrument()
page.cycleInstrument()
assert.equal(page.data.instrument, 'synth')
assert.equal(page.data.vibrato, true)
console.log('PASS: synth-only vibrato, dry drums/piano, live toggle, playback and saved preference')

// Physical top four sectors use real cymbal recordings; lower five use real drum recordings.
page.data.instrument = 'drums'
const expectedNames = ['军鼓', '高通鼓', '闭合踩镲', '开放踩镲', '吊镲', '叮叮镲', '中通鼓', '落地通鼓', '底鼓']
const allBuffers = new Set()
for (let index = 0; index < 9; index++) {
  const angle = (120 + (index + .5) * 300 / 8) * Math.PI / 180
  const touchedIndex = index === 8 ? hit(0, 0) : hit(.7 * Math.cos(angle), .7 * Math.sin(angle))
  if (index < 8) assert.equal(Math.sin(angle) < 0, index >= 2 && index <= 5)
  const oscillatorCount = oscillators.length
  page.playKey(touchedIndex)
  assert.equal(page.data.activeNote, expectedNames[index])
  assert.equal(oscillators.length, oscillatorCount, 'drums never use synthetic oscillators')
  const source = sources.at(-1)
  assert.ok(source.buffer.duration > .1)
  assert.ok(source.buffer.getChannelData(0).some(value => Math.abs(value) > .1), 'packaged recording is audible PCM')
  allBuffers.add(source.buffer)
  const scheduledStops = source.stops.length
  page.onKeyEnd()
  assert.equal(source.stops.length, scheduledStops, 'finger release does not cut the drum/cymbal tail')
  const voice = page.createVoice('drums', touchedIndex, 1, false, 5, source.buffer.duration)
  assert.equal(sources.at(-1).buffer, source.buffer, 'playback reuses the actual recording')
  voice.stop()
}
assert.equal(allBuffers.size, 9, 'nine distinct recordings')
page.pauseSession()

// A short tap records the entire cymbal tail and playback waits for it.
page.startRecording()
page.playKey(5)
const ride = sources.at(-1)
now += 30
page.onKeyEnd()
page.stopRecording()
const drumTrack = page.data.tracks[4]
assert.equal(drumTrack.notes[0].duration, ride.buffer.duration * 1000)
assert.ok(drumTrack.duration >= ride.buffer.duration * 1000)

page.togglePlayback()
const replay = sources.at(-1)
assert.equal(replay.buffer, ride.buffer)
assert.equal(replay.stops.length, 1)
page.pauseSession()
assert.equal(replay.stops.length, 2, 'leaving the page stops sample playback')
console.log('PASS: nine real sample files, physical mapping, overlapping natural tails, recorded tails and cleanup')

// Every piano note across L/M/H uses a nearby real sample at the correct pitch.
const roots = new Set()
for (let octave = 0; octave < 3; octave++) {
  for (let index = 0; index < 9; index++) {
    const sample = page.getPianoSample(index, octave)
    assert.ok(sample.rate >= Math.pow(2, -.25) && sample.rate <= Math.pow(2, .25))
    assert.ok(sample.buffer.duration > 2)
    assert.ok(sample.buffer.getChannelData(0).some(value => Math.abs(value) > .1))
    roots.add(sample.buffer)
    const voice = page.createVoice('piano', index, octave, false, 8, .3)
    const source = sources.at(-1)
    assert.equal(source.buffer, sample.buffer)
    assert.equal(source.playbackRate.events[0].value, sample.rate)
    assert.ok(Math.abs(source.stops[0] - 8.48) < 1e-8, 'scheduled piano includes its release tail')
    voice.stop()
  }
}
assert.equal(roots.size, 7)

// Dry synth has a square-wave lead, steady harmonics/volume and a soft release.
oscillators.length = 0; filters.length = 0; gains.length = 0
audioTime = 10
const synth = page.createVoice('synth', 0, 1, false, 10)
assert.deepEqual(oscillators.map(node => node.type), ['square', 'sine'])
assert.equal(filters[0].type, 'peaking')
assert.equal(filters[1].type, 'lowpass')
assert.equal(filters[0].frequency.events.length, 1, 'dry synth does not darken like a struck piano note')
assert.equal(gains[0].gain.events.at(-1).value, .12, 'dry synth holds its full level after the attack')
assert.ok(oscillators.every(node => node.stops.length === 0), 'dry synth sustains until released')
assert.equal(oscillators[0].connections[0], filters[0])
audioTime += .3
synth.release()
assert.equal(gains[0].gain.events.at(-1).value, 0)
assert.ok(Math.abs(gains[0].gain.events.at(-1).at - 10.318) < 1e-8)
synth.stop()
page.pauseSession()
console.log('PASS: 27 sampled piano pitches, piano release tails, filtered single-oscillator synth and soft release')

// Synth sustains until release, including its modulation oscillator.
audioTime = 30
const sustained = page.createVoice('synth', 0, 1, true, audioTime)
const held = oscillators.slice(-2)
assert.ok(held.every(source => source.stops.length === 0))
audioTime = 60
sustained.release()
assert.ok(held.every(source => source.stops.length === 0), 'release mutes the continuous voice without stopping its oscillators')
sustained.stop()
const sustainedReplay = page.createVoice('synth', 0, 1, true, 65, 12)
assert.ok(oscillators.slice(-2).every(source => source.stops[0] === 77.018))
sustainedReplay.stop()
page.setData({ instrument: 'synth', vibrato: true })
page.playKey(0)
const leaving = oscillators.slice(-2)
page.pauseSession()
assert.ok(leaving.every(source => source.stops.length > 0))
console.log('PASS: sustained synth vibrato, recorded duration, release and page cleanup')

// Real toy: right side Do, clockwise Re/Mi/Fa/Sol/La/Si/high Do/high Re.
const toyOrder = [6, 7, 8, 0, 1, 2, 3, 4, 5]
const toyLabels = ['1', '2', '3', '4', '5', '6', '7', '1̇', '2̇']
const toySteps = [0, 2, 4, 5, 7, 9, 11, 12, 14]
page.setData({ instrument: 'piano', vibrato: false, octaveIndex: 1 })
for (let n = 0; n < toyOrder.length; n++) {
  const index = toyOrder[n]
  assert.equal(page.data.keys[index].label, toyLabels[n])
  const expectedSteps = toySteps[n] + 12
  const root = Math.min(6, Math.round(expectedSteps / 6))
  const file = ['C3', 'Fs3', 'C4', 'Fs4', 'C5', 'Fs5', 'C6'][root]
  const sample = page.getPianoSample(index, 1)
  assert.equal(sample.buffer, page.getSampleBuffer(`assets/piano/${file}.wav`))
  assert.equal(sample.rate, Math.pow(2, (expectedSteps - root * 6) / 12))
  const voice = page.createSynthVoice(index, 1, audioTime, .2)
  const actual = oscillators.at(-1).frequency.events[0].value
  assert.ok(Math.abs(actual - 261.625565 * Math.pow(2, toySteps[n] / 12)) < .01)
  voice.stop()
}
assert.equal(page.data.keys[hit(0, 0)].label, '3')
assert.equal(page.data.keys[hit(0, .9)].label, '3')
page.pauseSession()
console.log('PASS: real-toy note layout and matching piano/synth pitches')

// The visible sound selector reaches the dry synth without loading another piano sample.
page.setData({ instrument: 'piano', vibrato: false })
page.playKey(6)
const pianoSources = sources.length
page.onKeyEnd()
page.cycleInstrument()
assert.equal(page.data.instrument, 'synth')
const beforeSynth = oscillators.length
page.playKey(6)
assert.equal(sources.length, pianoSources, 'dry synth must not load a piano sample')
assert.deepEqual(oscillators.slice(beforeSynth).map(node => node.type), ['square', 'sine'])
page.onKeyEnd()
page.pauseSession()
console.log('PASS: sound selector routes dry electronic voice separately from piano samples')

// Five independent slots, duplicate instruments, explicit overwrite and full-track mix.
assert.equal(page.data.tracks.length, 5)
assert.equal(page.data.tracks.filter(track => track.instrument === 'synth').length, 2)
const filled = JSON.stringify(page.data.tracks)
page.startRecording()
assert.equal(page.data.isRecording, false, 'sixth recording requires deleting a track')
assert.equal(JSON.stringify(page.data.tracks), filled, 'full slots never overwrite implicitly')
page.toggleTrack(tap(1))
page.toggleTrack(tap(3))
assert.equal(page.data.tracks[1].checked, false)
assert.equal(page.data.tracks[3].checked, false)
page.deleteTrack(tap(3))
page.toggleTrack(tap(1))
const untouched = page.data.tracks.filter(track => track.id !== 3).map(track => JSON.stringify(track))
page.setData({ instrument: 'piano', instrumentName: '钢琴', octaveIndex: 0, vibrato: false })
page.toggleRecording()
assert.equal(page.data.recordingTrackId, 3)
page.toggleTrack(tap(0))
assert.equal(page.data.tracks[3].checked, false, 'recording is not checked until finished')
page.playKey(6)
now += 200
page.setOctave(2)
page.playKey(8)
now += 300
page.stopRecording()
assert.equal(page.data.tracks[3].instrument, 'piano')
assert.equal(page.data.tracks[3].name, '钢琴')
assert.equal(page.data.tracks[3].octaveLabel, 'L/H')
assert.equal(page.data.tracks[3].notes.length, 2)
assert.deepEqual(page.data.tracks.filter(track => track.id !== 3).map(track => JSON.stringify(track)), untouched)
const played = [], originalCreateVoice = page.createVoice
page.createVoice = (...args) => { played.push(args); return originalCreateVoice.apply(page, args) }
page.togglePlayback()
assert.equal(played.length, page.data.tracks.reduce((count, track) => count + track.notes.length, 0), 'all checked tracks play')
assert.ok(played.some(args => args[0] === 'piano'))
assert.ok(played.some(args => args[0] === 'drums'))
assert.ok(played.some(args => args[0] === 'synth'))
page.pauseSession()
page.createVoice = originalCreateVoice
// Delete frees a slot; an empty recording does not consume it.
page.deleteTrack(tap(3))
page.startRecording()
page.stopRecording()
assert.equal(page.data.tracks[3].notes.length, 0)
assert.equal(page.data.tracks[3].instrument, null)
page.startRecording()
assert.equal(page.data.recordingTrackId, 3)
page.playKey(0)
now += 100
page.stopRecording()
assert.equal(page.data.tracks.length, 5)
assert.equal(page.data.tracks[3].checked, true, 'new recordings are checked by default')
console.log('PASS: five independent tracks, append, delete and refill, metadata, full capacity and playback-all')

// Sound slider follows the finger, selects three detents and snaps on release/cancel.
page.createSelectorQuery = () => ({ select() { return this }, boundingClientRect() { return this }, exec(callback) { callback([{ left: 100, width: 120 }]) } })
page.setInstrument(1)
page.onSoundStart(gesture(160))
page.onSoundMove(gesture(202))
assert.equal(page.data.instrument, 'synth')
assert.equal(page.data.soundPosition, 85)
assert.equal(page.data.isSoundDragging, true)
page.onSoundEnd()
assert.equal(page.data.soundPosition, 100)
assert.equal(page.data.isSoundDragging, false)
page.onSoundStart(gesture(220))
page.onSoundMove(gesture(40))
assert.equal(page.data.instrument, 'drums')
assert.equal(page.data.soundPosition, 0)
page.onSoundEnd()
page.selectInstrument({ currentTarget: { dataset: { index: 1 } } })
assert.equal(page.data.instrument, 'piano')
assert.equal(page.data.soundPosition, 50)
for (const locked of ['isRecording', 'isPlaying']) {
  page.setData({ [locked]: true })
  page.onSoundStart(gesture(220))
  page.onSoundMove(gesture(100))
  page.selectInstrument({ currentTarget: { dataset: { index: 2 } } })
  assert.equal(page.data.instrument, 'piano')
  assert.equal(page.data.soundPosition, 50)
  assert.equal(page.data.isSoundDragging, false)
  page.setData({ [locked]: false })
}
page.onSoundStart(gesture(180))
page.pauseSession()
assert.equal(page.data.isSoundDragging, false)
assert.equal(page.data.soundPosition, 50)
console.log('PASS: sound slider drag, clamping, snapping, icon selection, recording/playback locks and cleanup')

// Saved combinations survive reload, retain independent notes and restore all five tracks.
const libraryStorage = new Map()
let storageWrites = 0
sandbox.wx.getStorageSync = key => structuredClone(libraryStorage.get(key))
sandbox.wx.setStorageSync = (key, value) => { storageWrites++; libraryStorage.set(key, structuredClone(value)) }
page.loadLibrary()
assert.equal(page.data.savedMixes.length, 0)
page.openSaveDialog()
assert.equal(page.data.showSaveDialog, true)
page.onSaveNameInput({ detail: { value: '   ' } })
page.saveMix()
assert.ok(page.data.saveError)
assert.equal(storageWrites, 0)
page.closeSaveDialog()
assert.equal(page.data.showSaveDialog, false)
page.openSaveDialog()
page.onSaveNameInput({ detail: { value: '  夜晚练习  ' } })
page.saveMix()
assert.equal(storageWrites, 1)
assert.equal(page.data.showSaveDialog, false)
const firstMix = page.data.savedMixes[0]
assert.equal(firstMix.name, '夜晚练习')
assert.equal(firstMix.duration, Math.max(...page.data.tracks.map(track => track.duration)))
assert.equal(firstMix.tracks.length, 5)
assert.deepEqual(Array.from(firstMix.tracks, track => track.checked), Array.from(page.data.tracks, track => track.checked))
const firstSnapshot = JSON.stringify(firstMix.tracks)
page.deleteTrack(tap(0))
page.startRecording()
assert.equal(page.data.selectedMixId, '')
page.playKey(8)
now += 200
page.stopRecording()
assert.equal(JSON.stringify(firstMix.tracks), firstSnapshot, 'editing current tracks cannot mutate a saved snapshot')
page.openSaveDialog()
page.onSaveNameInput({ detail: { value: '第二次' } })
page.saveMix()
assert.equal(page.data.savedMixes.length, 2)
assert.notEqual(page.data.savedMixes[0].id, firstMix.id)
page.setData({ savedMixes: [] })
page.loadLibrary()
assert.equal(page.data.savedMixes.length, 2)
page.openLibrary()
assert.equal(page.data.libraryOpen, true)
assert.equal(page.data.isScreenMoving, true)
page.onScreenTransitionEnd()
assert.equal(page.data.isScreenMoving, false)
page.selectSavedMix(tap(firstMix.id))
assert.equal(JSON.stringify(page.data.tracks), firstSnapshot)
assert.equal(page.data.selectedMixId, firstMix.id)
assert.equal(page.data.elapsedLabel, firstMix.durationLabel)
page.togglePlayback()
assert.equal(page.data.isPlaying, true)
page.selectSavedMix(tap(page.data.savedMixes[0].id))
assert.equal(page.data.isPlaying, false, 'loading a different combination stops old playback')
page.startRecording()
assert.equal(page.data.isRecording, false, 'hidden instrument pane cannot record')
page.closeLibrary()
page.onScreenTransitionEnd()
assert.equal(page.data.libraryOpen, false)
page.openSaveDialog()
page.onSaveNameInput({ detail: { value: '失败时保留输入' } })
const savedBeforeFailure = JSON.stringify(page.data.savedMixes)
sandbox.wx.setStorageSync = () => { throw Error('storage full') }
page.saveMix()
assert.equal(page.data.isSaving, false)
assert.equal(page.data.showSaveDialog, true)
assert.ok(page.data.saveError)
assert.equal(page.data.saveName, '失败时保留输入')
assert.equal(JSON.stringify(page.data.savedMixes), savedBeforeFailure)
page.closeSaveDialog()
sandbox.wx.getStorageSync = () => ({ version: 1, mixes: [{ id: 'bad', name: '损坏', tracks: [] }] })
page.loadLibrary()
assert.ok(page.data.libraryError)
assert.equal(JSON.stringify(page.data.savedMixes), savedBeforeFailure, 'read failure preserves in-memory entries')
page.openSaveDialog()
page.onSaveNameInput({ detail: { value: '不可覆盖损坏的原始存储' } })
page.saveMix()
assert.equal(page.data.saveError, page.data.libraryError)
page.closeSaveDialog()
page.pauseSession()
console.log('PASS: named save, blank/cancel validation, persistence, independent snapshots, restore/playback, transitions and storage failures')

// Loop switches configure playback silently; only mix starts the selected tracks.
page.setData({ libraryOpen: false, libraryError: '', tracks: sandbox.restoreTracks(Array.from({ length: 5 }, (_, id) => ({
  instrument: id < 3 ? 'synth' : null, duration: [1000, 1500, 500, 0, 0][id],
  notes: id < 3 ? [{ index: id, start: 0, duration: 150, octave: 1, vibrato: false }] : [],
}))), hasTracks: true })
const scheduled = []
page.createVoice = (...args) => { scheduled.push({ index: args[1], at: args[4] }); return originalCreateVoice.apply(page, args) }
audioTime = 100
page.toggleTrackLoop(tap(0)); page.toggleTrackLoop(tap(1)); page.toggleTrackLoop(tap(4))
assert.equal(scheduled.length, 0)
assert.equal(intervals.size, 0)
assert.equal(page.data.isPlaying, false)
assert.equal(page.data.isLooping, false)
assert.equal(page.data.tracks[4].loop, false)
page.togglePlayback()
assert.equal(page.data.isPlaying, true)
assert.equal(page.data.isLooping, true)
assert.deepEqual(scheduled.map(n => n.index).sort(), [0,1,2])
for (const time of [100.98, 101.48, 101.98, 102.98]) { audioTime = time; tick() }
assert.deepEqual(scheduled.filter(n=>n.index===0).map(n=>n.at), [100.05,101.05,102.05,103.05])
assert.deepEqual(scheduled.filter(n=>n.index===1).map(n=>n.at), [100.05,101.55,103.05])
assert.equal(scheduled.filter(n=>n.index===2).length, 1, 'non-looping track plays once')
page.togglePlayback()
assert.equal(page.data.isPlaying, false)
assert.equal(intervals.size, 0)
assert.equal(page.data.tracks[0].loop, true, 'stop preserves loop settings')
page.toggleTrackLoop(tap(0)); page.toggleTrackLoop(tap(1))
page.togglePlayback(); audioTime += 2; tick()
assert.equal(page.data.isPlaying, false, 'one-shot mix ends automatically')
page.createVoice = originalCreateVoice
console.log('PASS: silent loop switches, synchronized selected mix, independent periods and manual/automatic stop')

// Saving flies a visual copy into the header library button, then glows; no track data moves.
const beforeEffect = JSON.stringify(page.data.tracks)
page.createSelectorQuery = () => ({ select() { return this }, boundingClientRect() { return this }, exec(callback) { callback([{ left: 24, top: 100, width: 342, height: 216 }, { left: 236, top: 52, width: 34, height: 34 }]) } })
page.animateSavedMix('动效测试', page.data.tracks)
assert.equal(page.data.saveFlight.x, 58)
assert.equal(page.data.saveFlight.y, -139)
assert.equal(page.data.saveFlight.scale, 34 / 342)
assert.equal(page.data.libraryGlow, false)
assert.equal(JSON.stringify(page.data.tracks), beforeEffect)
page.finishSaveFlight()
assert.equal(page.data.saveFlight, null)
assert.equal(page.data.libraryGlow, true)
page.finishLibraryGlow()
assert.equal(page.data.libraryGlow, false)
let pendingEffect
page.createSelectorQuery = () => ({ select() { return this }, boundingClientRect() { return this }, exec(callback) { pendingEffect = callback } })
page.animateSavedMix('过期动效', page.data.tracks)
page.clearSaveEffect()
pendingEffect([{ left: 24, top: 100, width: 342, height: 216 }, { left: 236, top: 52, width: 34, height: 34 }])
assert.equal(page.data.saveFlight, null)
assert.equal(page.data.libraryGlow, false)
console.log('PASS: save-flight target geometry, glow sequence, unchanged tracks and stale-effect cleanup')

// Configured loops stay silent while recording. Saving/loading never starts playback.
page.toggleTrackLoop(tap(0))
page.setInstrument(0); page.startRecording()
assert.equal(page.data.isRecording, true)
assert.equal(page.data.isLooping, false)
assert.equal(intervals.size, 1)
page.playKey(8); now += 400; audioTime += .4; page.stopRecording()
assert.equal(page.data.tracks[3].instrument, 'drums')
assert.equal(page.data.tracks[0].loop, true)
assert.equal(intervals.size, 0)
page.toggleTrackLoop(tap(1))
let storedLoopMix
sandbox.wx.setStorageSync = (_, value) => { storedLoopMix = structuredClone(value) }
sandbox.wx.getStorageSync = () => storedLoopMix
page.openSaveDialog()
page.onSaveNameInput({ detail: { value: '循环组合' } }); page.saveMix()
assert.equal(page.data.saveError, '')
page.loadLibrary()
const loopMix = page.data.savedMixes[0]
assert.deepEqual(Array.from(loopMix.tracks,t=>t.loop), [true,true,false,false,false])
page.selectSavedMix(tap(loopMix.id))
assert.equal(page.data.isPlaying, false)
assert.equal(page.data.isLooping, false)
assert.equal(intervals.size, 0)
assert.deepEqual(Array.from(page.data.tracks,t=>t.loop), [true,true,false,false,false])
page.togglePlayback()
assert.equal(page.data.isPlaying, true)
assert.equal(page.data.isLooping, true)
page.pauseSession()
assert.equal(intervals.size, 0)
console.log('PASS: recording with silent loop settings, persistence and no autoplay on restore')

// Library gestures distinguish scrolling from swiping, and deletes commit storage first.
page.setData({ libraryError: '', libraryOpen: true })
const userMixIds = page.data.savedMixes.map(m => m.id)
storedLoopMix = { version: 1, mixes: structuredClone(page.data.savedMixes) }
page.seedTestMix()
const demo = page.data.savedMixes.find(m => m.id === 'demo-fathers-name-v1')
assert.ok(demo && demo.duration > 0 && demo.duration === 90000)
assert.equal(demo.tracks.length, 5)
assert.ok(userMixIds.every(id => page.data.savedMixes.some(m => m.id === id)))
page.seedTestMix()
assert.equal(page.data.savedMixes.filter(m => m.id === demo.id).length, 1)
const swipe = (id, x, y) => ({ currentTarget: { dataset: { id } }, touches: [{ clientX: x, clientY: y }] })
page.onMixTouchStart(swipe(demo.id, 200, 100))
page.onMixTouchMove(swipe(demo.id, 196, 160))
assert.equal(page.data.isMixSwiping, false, 'vertical scrolling is not locked')
assert.equal(page.data.mixSwipeOffset, 0)
page.onMixTouchEnd()
const priorSelection = page.data.selectedMixId
page.selectSavedMix(tap(demo.id))
assert.equal(page.data.selectedMixId, priorSelection, 'scroll gesture must not select a row')
page.onMixTouchStart(swipe(demo.id, 200, 100))
page.onMixTouchMove(swipe(demo.id, 110, 102))
assert.equal(page.data.isMixSwiping, true)
page.onMixTouchEnd()
assert.equal(page.data.mixSwipeOffset, -80)
page.selectSavedMix(tap(demo.id))
assert.equal(page.data.selectedMixId, priorSelection, 'swipe must not load a mix')
page.onMixTouchStart(swipe(demo.id, 110, 100))
page.onMixTouchMove(swipe(demo.id, 190, 102))
page.onMixTouchEnd()
assert.equal(page.data.mixSwipeOffset, 0, 'swiping right closes delete')
page.onMixTouchStart(swipe(demo.id, 200, 100))
page.onMixTouchEnd()
page.selectSavedMix(tap(demo.id))
assert.equal(page.data.selectedMixId, demo.id)
page.togglePlayback()
assert.equal(page.data.isPlaying, true, 'test phrase uses the application playback engine')
const tracksBeforeDelete = JSON.stringify(page.data.tracks)
const persist = sandbox.wx.setStorageSync
sandbox.wx.setStorageSync = () => { throw Error('storage full') }
page.deleteSavedMix(tap(demo.id))
assert.ok(page.data.savedMixes.some(m => m.id === demo.id), 'failed write retains the row')
assert.equal(page.data.isPlaying, true, 'failed deletion does not stop playback')
sandbox.wx.setStorageSync = persist
page.deleteSavedMix(tap(demo.id))
assert.equal(page.data.isPlaying, false)
assert.equal(page.data.selectedMixId, '')
assert.equal(JSON.stringify(page.data.tracks), tracksBeforeDelete, 'deletion preserves the working copy')
page.loadLibrary()
page.seedTestMix()
assert.ok(!page.data.savedMixes.some(m => m.id === demo.id), 'deleted demo stays deleted after reload')
assert.ok(userMixIds.every(id => page.data.savedMixes.some(m => m.id === id)))
assert.equal(intervals.size, 0)
console.log('PASS: one-time demo seed, swipe/scroll/tap separation, delete persistence, failure recovery and working-copy preservation')

// Vibrato delay belongs to the switch, not each key, and survives recorded playback.
page.setData({ libraryOpen: false, tracks: structuredClone(definition.data.tracks), hasTracks: false, instrument: 'synth', vibrato: false })
audioTime = 500; now = 500000
page.setVibrato({ detail: { value: true } })
page.startRecording()
audioTime = 500.1; now = 500100; page.playKey(0)
assert.equal(gains.at(-1).gain.events[0].value, 0)
audioTime = 500.6; now = 500600; page.playKey(1)
const partialDepth = gains.at(-1).gain.events
assert.equal(partialDepth[1].at, 500.5, 'changing keys preserves the original fade schedule')
assert.equal(partialDepth.at(-1).at, 500.7)
audioTime = 500.8; now = 500800; page.playKey(2)
assert.ok(Math.abs(gains.at(-1).gain.events.at(-1).value - 15) < 1e-8, 'ready switch stays at full depth without a new delay')
audioTime = 500.9; now = 500900; page.stopRecording()
const fadedNotes = page.data.tracks[0].notes
assert.ok(Math.abs(fadedNotes[0].vibratoAge - .1) < 1e-8)
assert.ok(Math.abs(fadedNotes[1].vibratoAge - .6) < 1e-8)
assert.equal(fadedNotes[2].vibratoAge, .7)
assert.ok(fadedNotes[1].vibratoPhase > 0, 'recording keeps the running LFO phase after a key change')
const restoredFade = sandbox.restoreTracks(page.data.tracks)
assert.deepEqual(Array.from(restoredFade[0].notes, n => n.vibratoPhase), Array.from(fadedNotes, n => n.vibratoPhase))
assert.deepEqual(Array.from(restoredFade[0].notes, n => n.vibratoAge), Array.from(fadedNotes, n => n.vibratoAge))
const replayAges = []
page.createVoice = (...args) => { replayAges.push(args[6]); return originalCreateVoice.apply(page, args) }
page.togglePlayback()
assert.deepEqual(replayAges, Array.from(fadedNotes, n => n.vibratoAge))
page.pauseSession()
page.toggleTrackLoop(tap(0))
page.togglePlayback()
assert.deepEqual(replayAges.slice(3), Array.from(fadedNotes, n => n.vibratoAge))
page.pauseSession()
page.createVoice = originalCreateVoice
page.setVibrato({ detail: { value: false } })
page.setVibrato({ detail: { value: true } })
page.playKey(0)
assert.equal(gains.at(-1).gain.events[0].value, 0, 'turning off/on restarts switch delay')
page.pauseSession()
console.log('PASS: delayed pitch vibrato, continuous switch fade across keys, recording/persistence/replay/loop timing and switch reset')

// Every key keeps its octave pitch while vibrato uses an octave-independent cents depth.
for (let index = 0; index < 9; index++) {
  const pitches = []
  for (let octave = 0; octave < 3; octave++) {
    const voice = page.createSynthVoice(index, octave, audioTime, .3, true, .7)
    const carrier = oscillators.at(-2), lfo = oscillators.at(-1), depth = gains.at(-1)
    pitches.push(carrier.frequency.events[0].value)
    assert.equal(carrier.type, 'square')
    assert.equal(carrier.detune.events[0].value, 0)
    assert.equal(lfo.type, 'sine')
    assert.equal(lfo.frequency.value, 7)
    assert.equal(depth.connections[0], carrier.detune)
    assert.ok(Math.abs(depth.gain.events[0].value - 15) < 1e-8)
    voice.stop()
  }
  assert.equal(pitches[1] / pitches[0], 2)
  assert.equal(pitches[2] / pitches[1], 2)
}
console.log('PASS: 27 synth pitches, octave ratios and uniform 15-cent detune vibrato')

// Upgrade the existing demo in place without touching user mixes; long timelines stay bounded.
const shortTracks = sandbox.restoreTracks(Array.from({ length: 5 }, (_, id) => ({ instrument: id === 0 ? 'synth' : null, duration: id === 0 ? 1000 : 0, notes: id === 0 ? [{ index: 2, start: 0, duration: 800, octave: 1, vibrato: true }] : [] })))
const oldDemo = { id: 'demo-fathers-name-v1', name: '以父之名（测试片段）', duration: 1000, durationLabel: '1.0s', tracks: shortTracks }
const userCopy = { ...oldDemo, id: 'user-copy', name: '我的作品' }
storedLoopMix = { version: 1, demoVersion: 1, mixes: [userCopy, oldDemo] }
page.loadLibrary(); page.seedTestMix()
assert.equal(page.data.savedMixes.length, 2)
assert.equal(page.data.savedMixes[0].duration, 1000, 'user copy is untouched')
const longDemo = page.data.savedMixes[1]
assert.equal(longDemo.duration, 90000)
assert.deepEqual(Array.from(longDemo.tracks, t => t.instrument), ['synth', 'drums', 'piano', null, null])
assert.ok(longDemo.tracks[0].notes.every(n => n.octave === 2), 'all lead notes use H')
for (const track of longDemo.tracks.slice(0, 3)) {
  assert.equal(track.duration, 90000)
  assert.ok(track.notes.some(n => n.start > 85000), 'every instrument reaches the ending')
  assert.ok(track.notes.every(n => n.start + n.duration <= 90000))
  assert.ok(track.bars.every(b => b.left >= 0 && b.left + b.width <= 100.000001))
}
page.loadLibrary(); page.seedTestMix()
assert.equal(page.data.savedMixes.length, 2, 'migration is idempotent')
page.setData({ libraryOpen: false })
page.selectSavedMix(tap(longDemo.id))
assert.equal(page.data.timelineSeconds, 90)
audioTime = 1000
page.togglePlayback()
audioTime = 1045.05; tick()
assert.equal(page.data.isPlaying, true, 'long playback continues after 16 seconds')
assert.ok(page.data.playbackProgress.slice(0, 3).every(p => Math.abs(p - 50) < 1e-8))
audioTime = 1090.3; tick()
assert.equal(page.data.isPlaying, false, 'long playback stops after the end and release tail')
assert.equal(intervals.size, 0)
page.toggleTrackLoop(tap(0))
page.togglePlayback()
audioTime += 45.05; tick()
assert.ok(Math.abs(page.data.playbackProgress[0] - 50) < 1e-8)
page.pauseSession()
page.openSaveDialog(); page.onSaveNameInput({ detail: { value: '90秒保存测试' } }); page.saveMix()
page.loadLibrary()
assert.equal(page.data.savedMixes[0].duration, 90000, 'long mix can be saved and loaded')
console.log('PASS: demo upgrade, three instruments, H synth, 90-second rendering/playback/loops and persistence')

// Live synth preserves oscillator phase and its gate across repeated and legato notes.
page.closeSaveDialog(); page.pauseSession()
page.setData({ libraryOpen: false, instrument: 'synth', octaveIndex: 1, vibrato: false })
audioTime = 2000
const priorOscillators = oscillators.length
page.playKey(6)
const liveCarrier = oscillators.at(-2), liveLfo = oscillators.at(-1), liveGain = gains.at(-2)
const attackEvents = liveGain.gain.events.length
audioTime += .2; page.playKey(8)
assert.equal(oscillators.length, priorOscillators + 2)
assert.equal(liveGain.gain.events.length, attackEvents, 'legato has no amplitude retrigger')
assert.equal(liveCarrier.frequency.events.at(-1).value, 329.63)
page.setVibrato({ detail: { value: true } })
assert.equal(oscillators.length, priorOscillators + 2, 'switch does not replace the carrier or LFO')
page.onKeyEnd()
assert.equal(liveGain.gain.events.at(-1).value, 0, 'release closes the output gate')
assert.equal(liveCarrier.stops.length, 0)
assert.equal(liveLfo.stops.length, 0)
audioTime += .4; page.playKey(1)
assert.equal(oscillators.length, priorOscillators + 2, 'a new touch reuses the running pair')
assert.equal(liveGain.gain.events.at(-1).value, .12)
page.setInstrument(1)
assert.ok(liveCarrier.stops.length && liveLfo.stops.length, 'changing instruments cleans up the silent pair')
const phase = 1.25
const phaseVoice = page.createSynthVoice(6, 1, audioTime, .2, true, .7, phase)
assert.ok(Math.abs(oscillators.at(-1).wave.real[1] - Math.sin(phase)) < 1e-6)
assert.ok(Math.abs(oscillators.at(-1).wave.imag[1] - Math.cos(phase)) < 1e-6)
phaseVoice.stop(); page.pauseSession()
console.log('PASS: continuous live carrier/LFO, legato gate, touch reuse, cleanup and recorded vibrato phase')

// Checkbox inclusion, looping and row deletion are independent controls.
page.setData({ libraryOpen: false, showSaveDialog: false, tracks: sandbox.restoreTracks(Array.from({ length: 5 }, (_, id) => ({
  instrument: id < 3 ? 'synth' : null, duration: id < 3 ? 1000 : 0,
  notes: id < 3 ? [{ index: id, start: 0, duration: 300, octave: 1, vibrato: false }] : [],
}))), hasTracks: true })
page.closeMixSwipe()
const checksBeforeTap = JSON.stringify(page.data.tracks)
page.dismissTrackSwipe()
assert.equal(JSON.stringify(page.data.tracks), checksBeforeTap, 'row tap never selects an overwrite target')
page.toggleTrack(tap(1))
assert.equal(page.data.tracks[1].checked, false)
assert.equal(page.data.isPlaying, false)
assert.equal(page.data.isLooping, false, 'checkbox alone never starts audio')
page.toggleTrackLoop(tap(1))
assert.equal(page.data.tracks[1].loop, true)
assert.equal(page.data.tracks[1].checked, false, 'unchecked track can loop independently')
page.toggleTrack(tap(1))
assert.equal(page.data.tracks[1].loop, true)
assert.equal(page.data.tracks[1].checked, true)
page.toggleTrack(tap(1))
const included = []
page.createVoice = (...args) => { included.push(args[1]); return originalCreateVoice.apply(page, args) }
page.togglePlayback()
assert.deepEqual(included, [0, 2], 'mix plays checked tracks only, excluding the previously looping track')
assert.equal(page.data.isLooping, false)
assert.equal(page.data.playbackProgress[1], -1)
page.pauseSession()
page.createVoice = originalCreateVoice
const remembered = sandbox.restoreTracks(page.data.tracks)
assert.equal(remembered[1].checked, false, 'unchecked flag persists')
page.toggleTrackLoop(tap(0)); page.toggleTrackLoop(tap(2))
const preservedNotes = JSON.stringify(page.data.tracks[2].notes)
page.onMixTouchStart(swipe('track:0', 200, 100))
page.onMixTouchMove(swipe('track:0', 110, 101)); page.onMixTouchEnd()
assert.equal(page.data.mixSwipeOffset, -80)
page.dismissTrackSwipe()
assert.equal(page.data.mixSwipeOffset, -80, 'end-of-swipe tap does not close delete action')
page.deleteTrack(tap(0))
assert.equal(page.data.tracks[0].notes.length, 0)
assert.equal(page.data.tracks[0].checked, false)
assert.equal(page.data.tracks[0].loop, false)
assert.equal(page.data.tracks[2].loop, true, 'deleting one loop leaves the other playing')
assert.equal(page.data.isLooping, false, 'configured loops do not autoplay after deletion')
assert.equal(JSON.stringify(page.data.tracks[2].notes), preservedNotes)
page.startRecording()
assert.equal(page.data.recordingTrackId, 0, 'recording fills the deleted slot without overwriting checked tracks')
page.playKey(6); now += 200; page.stopRecording()
assert.equal(page.data.tracks[0].checked, true)
assert.equal(JSON.stringify(page.data.tracks[2].notes), preservedNotes)
page.pauseSession()
page.deleteTrack(tap(0)); page.deleteTrack(tap(1)); page.deleteTrack(tap(2))
assert.equal(page.data.hasTracks, false)
assert.equal(page.data.tracks.length, 5)
assert.equal(intervals.size, 0)
console.log('PASS: independent checkboxes/loops, checked-only mix, inert row tap, swipe deletion, loop cleanup and append-only recording')

// Original demo v3 replaces older built-in data and carries dynamics through playback.
storedLoopMix = { version: 1, demoVersion: 2, mixes: [userCopy, oldDemo] }
page.loadLibrary(); page.seedTestMix()
const originalDemo = page.data.savedMixes.find(m => m.id === oldDemo.id)
assert.equal(originalDemo.name, '夜航 · 原创编曲测试（90秒）')
assert.equal(originalDemo.duration, 90000)
assert.equal(storedLoopMix.demoVersion, 3)
assert.equal(page.data.savedMixes[0].name, '我的作品')
assert.ok(originalDemo.tracks[0].notes.every(n => n.octave === 2 && n.velocity < 1))
assert.ok(originalDemo.tracks[0].notes.every(n => n.start >= 10000), 'piano introduction leaves space before the lead enters')
assert.ok(originalDemo.tracks[0].notes.every(n => n.start < 50000 || n.start >= 60000), 'break gives the lead a rest')
assert.ok(originalDemo.tracks[1].notes.every(n => n.duration / 1000 >= page.getDrumBuffer(n.index).duration), 'drums retain their natural sample tails')
assert.ok(new Set(originalDemo.tracks[1].notes.map(n => n.velocity)).size > 3, 'drums have varied accents')
const persistedDynamics = sandbox.restoreTracks(originalDemo.tracks)
assert.deepEqual(Array.from(persistedDynamics[0].notes, n => n.velocity), Array.from(originalDemo.tracks[0].notes, n => n.velocity))
for (const [instrument, level] of [['drums', .35], ['piano', .5], ['synth', .12]]) {
  gains.length = 0
  const voice = page.createVoice(instrument, 0, 1, false, audioTime, .2, 0, 0, .4)
  assert.ok(gains[0].gain.events.some(event => Math.abs(event.value - level * .4) < 1e-8), `${instrument} applies note velocity to output`)
  voice.stop()
}
const invalidDynamics = structuredClone(originalDemo.tracks)
invalidDynamics[0].notes[0].velocity = 4
assert.throws(() => sandbox.restoreTracks(invalidDynamics))
console.log('PASS: original 90-second arrangement, version-2 migration, natural drum tails and persisted playback dynamics')

// Supplied MIDI retains exact pitches, original timing and dynamics without duplicate imports.
page.setData({ midiDemoVersion: 0, libraryError: '' })
const existingMixes = page.data.savedMixes.map(m => m.id)
page.seedMidiMix()
const midiMix = page.data.savedMixes.find(m => m.id === 'demo-rainbow-midi-v1')
assert.ok(midiMix)
assert.equal(midiMix.name, '彩虹 · MIDI前90秒')
assert.equal(midiMix.duration, 90000)
assert.deepEqual(Array.from(midiMix.tracks, t => t.notes.length), [131, 149, 216, 0, 0])
assert.ok(existingMixes.every(id => page.data.savedMixes.some(m => m.id === id)))
page.seedMidiMix()
assert.equal(page.data.savedMixes.filter(m => m.id === midiMix.id).length, 1)
assert.equal(midiMix.tracks[2].octaveLabel, 'E2–D4', 'imported bass range is labeled accurately')
assert.equal(midiMix.tracks[0].notes[0].start, 12467.568)
assert.equal(midiMix.tracks[0].notes[0].midiNote, 64)
assert.equal(midiMix.tracks[1].notes[0].duration, 1478.9)
for (const pitch of [36, 49, 61, 66, 83]) {
  const voice = page.createVoice('synth', 6, 1, false, audioTime, .2, 0, 0, .5, pitch)
  assert.ok(Math.abs(oscillators.at(-1).frequency.events[0].value - 440 * Math.pow(2, (pitch - 69) / 12)) < 1e-8)
  voice.stop()
  const sample = page.getPianoSample(6, 1, pitch)
  const semitones = pitch - 48
  const root = Math.max(0, Math.min(6, Math.round(semitones / 6)))
  assert.equal(sample.rate, Math.pow(2, (semitones - root * 6) / 12))
}
const originalMidiTracks = JSON.stringify(midiMix.tracks)
page.selectSavedMix(tap(midiMix.id))
page.toggleTrack(tap(0))
const midiPitches = []
page.createVoice = (...args) => { midiPitches.push(args[9]); return originalCreateVoice.apply(page, args) }
page.togglePlayback()
assert.deepEqual(midiPitches, Array.from(midiMix.tracks.slice(1, 3).flatMap(t => t.notes), n => n.midiNote), 'checked-only playback passes exact MIDI pitches')
page.pauseSession(); page.createVoice = originalCreateVoice
assert.equal(JSON.stringify(midiMix.tracks), originalMidiTracks, 'working copy remains independent')
page.loadLibrary(); page.seedMidiMix()
assert.equal(page.data.savedMixes.filter(m => m.id === midiMix.id).length, 1)
page.deleteSavedMix(tap(midiMix.id))
page.loadLibrary(); page.seedMidiMix()
assert.ok(!page.data.savedMixes.some(m => m.id === midiMix.id), 'deleted import stays deleted')
const invalidMidi = structuredClone(midiMix.tracks)
invalidMidi[0].notes[0].midiNote = 128
assert.throws(() => sandbox.restoreTracks(invalidMidi))
console.log('PASS: MIDI import, 496 notes, chromatic/bass pitches, metadata, selection, persistence and deletion')

// Four diatonic windows cover twelve natural notes, with exact sound and saved pitches.
page.pauseSession(); page.closeSaveDialog()
page.setData({ libraryOpen: false, tracks: structuredClone(definition.data.tracks), hasTracks: false, octaveIndex: 1 })
for (let octave = 0; octave < 3; octave++) {
  const pitches = new Set()
  for (let offset = 0; offset <= 3; offset++) for (let index = 0; index < 9; index++) pitches.add(sandbox.shiftedPitch(index, octave, offset))
  assert.equal(pitches.size, 12)
  assert.deepEqual([...pitches].sort((a,b)=>a-b), [0,2,4,5,7,9,11,12,14,16,17,19].map(n=>48+octave*12+n))
}
for (const instrument of [1, 2]) {
  page.setInstrument(instrument)
  for (const octave of [0,1,2]) {
    page.setOctave(octave)
    for (let offset = 0; offset <= 3; offset++) {
      page.setPitchOffset({ detail: { value: offset } })
      assert.equal(new Set(page.data.keys.map(k=>k.label)).size, 9)
      for (let index = 0; index < 9; index++) {
        page.playKey(index)
        const pitch = sandbox.shiftedPitch(index, octave, offset)
        const expectedLabel = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12] + (Math.floor(pitch / 12) - 1)
        assert.equal(page.data.keys[index].pitchLabel, expectedLabel)
        if (instrument === 2) assert.ok(Math.abs(oscillators.at(-2).frequency.events.at(-1).value - 440 * Math.pow(2, (pitch - 69) / 12)) < .01)
        else assert.equal(sources.at(-1).playbackRate.events[0].value, page.getPianoSample(index, octave, pitch).rate)
        page.onKeyEnd()
      }
    }
  }
}
page.setOctave(1); page.setPitchOffset({ detail: { value: 0 } })
page.startRecording(); page.playKey(5)
now += 200; audioTime += .2
page.setPitchOffset({ detail: { value: 2 } })
assert.equal(page.data.activeIndex, 5, 'moving slider retunes the held region')
assert.equal(page.data.keys[5].label, '4̇')
now += 200; audioTime += .2; page.stopRecording()
assert.equal(page.data.tracks[0].notes.length, 2)
assert.equal(page.data.tracks[0].notes[0].midiNote, undefined)
assert.equal(page.data.tracks[0].notes[1].midiNote, 77, 'M +2 reaches F5')
assert.equal(page.data.tracks[0].octaveLabel, 'D5–F5')
const offsetCopy = sandbox.restoreTracks(page.data.tracks)
assert.equal(offsetCopy[0].notes[1].midiNote, 77)
page.setPitchOffset({ detail: { value: 0 } })
const replayShift = []
page.createVoice = (...args) => { replayShift.push(args[9]); return originalCreateVoice.apply(page, args) }
page.togglePlayback()
assert.deepEqual(replayShift, [undefined,77], 'playback uses recorded pitch independent of current slider')
page.setPitchOffset({ detail: { value: 3 } })
assert.equal(page.data.pitchOffset, 0, 'mix playback locks offset')
page.pauseSession(); page.createVoice = originalCreateVoice
page.setPitchOffset({ detail: { value: 3 } }); page.setInstrument(0)
assert.equal(page.data.keys[5].label, '2̇', 'drums keep their original labels')
page.setPitchOffset({ detail: { value: 1 } })
assert.equal(page.data.pitchOffset, 3, 'drums cannot alter melodic offset')
page.setInstrument(1)
assert.equal(page.data.keys[5].label, '5̇', 'melodic offset is restored on return')
for (const value of [-1, 4, .5, NaN]) page.setPitchOffset({ detail: { value } })
assert.equal(page.data.pitchOffset, 3)
page.pauseSession()
console.log('PASS: twelve-note windows, 216 live piano/synth pitches, labels, held-note retune, recording, replay and drum isolation')

// Offset drag mirrors the instrument selector: continuous thumb movement and four snapped stops.
page.setInstrument(1); page.setPitchOffset({ detail: { value: 0 } })
page.createSelectorQuery = () => ({ select() { return this }, boundingClientRect() { return this }, exec(callback) { callback([{ left: 100, width: 90 }]) } })
page.onPitchStart(gesture(100))
page.onPitchMove(gesture(145))
assert.equal(page.data.pitchPosition, 50)
assert.equal(page.data.pitchOffset, 2)
page.onPitchEnd()
assert.equal(page.data.pitchPosition, 2 / 3 * 100)
assert.equal(page.data.isPitchDragging, false)
page.onPitchStart(gesture(300)); page.onPitchEnd()
assert.equal(page.data.pitchOffset, 3)
assert.equal(page.data.pitchPosition, 100)
page.onPitchStart(gesture(0)); page.onPitchEnd()
assert.equal(page.data.pitchOffset, 0)
page.setData({ isPlaying: true }); page.onPitchStart(gesture(190))
assert.equal(page.data.isPitchDragging, false)
page.setData({ isPlaying: false }); page.setInstrument(0); page.onPitchStart(gesture(190))
assert.equal(page.data.isPitchDragging, false)
page.pauseSession()
console.log('PASS: custom pitch slider movement, four-stop snapping, bounds and input locks')

// Overdub uses independent transport timers and never interrupts scheduled voices.
for (const loop of [false, true]) {
  page.pauseSession()
  page.setData({ ...structuredClone(definition.data), instrument: 'piano', instrumentName: '钢琴' })
  now += 20000; audioTime += 20
  page.startRecording(); page.playKey(6); now += 500; page.onKeyEnd(); page.stopRecording()
  page.data.tracks[0].loop = loop
  page.togglePlayback()
  const backingTimer = [...intervals.values()][0]
  const stopsBefore = stopped
  page.toggleRecording()
  assert.equal(page.data.isRecording, true)
  assert.equal(page.data.isPlaying, true)
  assert.equal(page.data.recordingTrackId, 1)
  assert.equal(stopped, stopsBefore, 'starting overdub does not stop backing voices')
  assert.equal(intervals.size, 2)
  page.playKey(2); now += 200; audioTime += .2
  for (const callback of [...intervals.values()]) callback()
  assert.equal(page.data.elapsedLabel, '0.2s', 'recording owns the visible timer')
  page.onKeyEnd(); page.stopRecording()
  assert.equal(page.data.tracks[1].notes.length, 1)
  assert.equal(page.data.tracks[1].checked, true)
  assert.equal(intervals.size, 1, 'stopping recording leaves playback running')
  backingTimer()
  assert.equal(page.data.playbackProgress[1], -1, 'newly checked track waits until next mix')
  page.startRecording(); page.playKey(4); now += 100
  page.togglePlayback()
  assert.equal(page.data.isRecording, true)
  assert.equal(intervals.size, 1, 'stopping playback leaves recording running')
  now += 100; tick(); page.stopRecording()
  assert.equal(page.data.tracks[2].notes.length, 1)
  assert.equal(intervals.size, 0)
}
page.pauseSession()
console.log('PASS: overdub alongside one-shot/loop mix, independent stops, captured notes and playback snapshot')
