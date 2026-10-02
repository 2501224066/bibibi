// Run: node tests/metronome.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, now = 1000, timerId = 0
const timers = new Map(), oscillators = [], gains = [], voices = []
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} })
const node = () => ({ connect() {}, disconnect() { this.disconnected = true } })
const audio = {
  currentTime: 0, destination: {}, resume() {},
  createGain() { const gain = { ...node(), gain: param() }; gains.push(gain); return gain },
  createOscillator() { const oscillator = { ...node(), frequency: param(), start(at) { this.startAt = at }, stop(at) { this.stopAt = at } }; oscillators.push(oscillator); return oscillator },
}
const sandbox = {
  Component(value) { definition = value }, Date: { now: () => now },
  setInterval(callback) { const id = ++timerId; timers.set(id, callback); return id },
  clearInterval(id) { timers.delete(id) },
  wx: { createWebAudioContext: () => audio, showToast(options) { assert.fail(options.title) } },
}
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = {
  data: structuredClone(definition.data), ...definition.methods,
  setData(value) { Object.assign(this.data, value) },
  setupShareMenu() {},
  createVoice(...args) { voices.push(args); return { stop() {} } },
}
assert.equal(page.data.metronomeBpm, 0)
assert.equal(timers.size, 0)
for (const bpm of [60, 90, 120]) {
  const start = oscillators.length
  const previousGain = vm.runInNewContext('metronomeGain', sandbox)
  page.cycleMetronome()
  assert.equal(page.data.metronomeBpm, bpm)
  assert.equal(timers.size, 1, 'changing tempo replaces the scheduler')
  if (previousGain) assert.equal(previousGain.disconnected, true)
  const first = oscillators[start].startAt
  const interval = 60 / bpm
  for (let beat = 1; beat <= 4; beat++) {
    audio.currentTime = first + beat * interval - .04
    for (const callback of timers.values()) callback()
    assert.ok(Math.abs(oscillators.at(-1).startAt - first - beat * interval) < 1e-9, 'beat timing uses the audio clock without drift')
  }
}
page.cycleMetronome()
assert.equal(page.data.metronomeBpm, 0)
assert.equal(timers.size, 0)
page.setMetronome(-1); page.setMetronome(4)
assert.equal(page.data.metronomeBpm, 0)
page.setMetronome(2)
definition.pageLifetimes.hide.call(page)
assert.equal(timers.size, 0, 'backgrounding stops the scheduler')
definition.pageLifetimes.show.call(page)
assert.equal(timers.size, 1, 'returning resumes the chosen tempo')
for (const index of [0, 1, 2]) {
  page.setInstrument(index)
  page.startRecording()
  for (const callback of timers.values()) callback()
  assert.equal(page.data.tracks.at(-1).notes.length, 0, 'metronome clicks are not recorded')
  page.playKey(0)
  assert.equal(voices.at(-1)[3], index === 2, 'only live synth notes have vibrato')
  now += 200
  page.onKeyEnd()
  page.stopRecording()
  assert.equal(page.data.tracks.at(-1).notes.length, 1)
  assert.equal(page.data.tracks.at(-1).notes[0].vibrato, index === 2, 'recorded vibrato follows instrument defaults')
}
page.stopMetronome()
assert.equal(timers.size, 0)
console.log('PASS: four tempo settings, audio-clock scheduling, background cleanup/resume, metronome excluded from recordings and instrument vibrato defaults')
