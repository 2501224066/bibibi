// Run: node tests/logo-demo.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, timerId = 0, scheduled = [], stopped = 0, error
const timers = new Map()
const audio = { currentTime: 0 }
const sandbox = {
  Component(value) { definition = value },
  setInterval(callback) { const id = ++timerId; timers.set(id, callback); return id },
  clearInterval(id) { timers.delete(id) },
  wx: { showToast(value) { error = value.title } },
}
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = {
  data: structuredClone(definition.data), ...definition.methods,
  setData(value) { Object.assign(this.data, value) },
  getAudioContext: () => audio,
  createVoice(...args) { scheduled.push(args); return { stop() { stopped++ } } },
}
const tick = () => { for (const callback of [...timers.values()]) callback() }
for (const instrument of ['piano', 'synth', 'drums']) {
  scheduled = []; stopped = 0; audio.currentTime = 0
  page.setData({ instrument, octaveIndex: 2 })
  const original = JSON.stringify(page.data.tracks)
  page.playLogoDemo()
  assert.equal(page.data.logoDemoPlaying, true)
  assert.equal(timers.size, 1)
  assert.ok(scheduled.length >= 9)
  assert.ok(scheduled.every(args => args[0] === instrument && args[2] === 2))
  assert.ok(scheduled.every(args => args[3] === (instrument === 'synth')))
  if (instrument !== 'drums') assert.ok(scheduled.every(args => args[9] >= 72 && args[9] <= (instrument === 'piano' ? 84 : 83)), 'demo follows the selected octave and preserves the high C')
  if (instrument === 'piano') {
    assert.deepEqual(scheduled.map(args => args[9]), [79, 76, 79, 84, 81, 84, 79, 79, 72, 74, 76, 74, 72, 74], 'Farewell opening retains its melody and octave changes')
    audio.currentTime = scheduled[3][4]
    tick()
    assert.equal(page.data.logoDemoKeys[7], true)
    assert.equal(page.data.logoDemoNoteLabels[7], 'C6', 'the high C lights the C key with its actual pitch')
  }
  audio.currentTime = .05
  tick()
  const firstNotes = scheduled.filter(args => args[4] === .05)
  for (const note of firstNotes) {
    const key = instrument === 'drums' ? vm.runInNewContext(`DRUM_KEY_ORDER.indexOf(${note[1]})`, sandbox) : note[1]
    assert.equal(page.data.logoDemoKeys[key], true, 'sounding notes highlight the corresponding physical key')
  }
  if (instrument === 'drums') assert.equal(page.data.logoDemoKeys.filter(Boolean).length, 2, 'simultaneous kick and hi-hat both light up')
  const end = Math.max(...scheduled.map(args => args[4] + args[5]))
  audio.currentTime = end + .19
  tick()
  assert.equal(page.data.logoDemoPlaying, false)
  assert.equal(page.data.logoDemoKeys.length, 0)
  assert.equal(timers.size, 0)
  assert.equal(stopped, scheduled.length)
  assert.equal(JSON.stringify(page.data.tracks), original, 'preview does not change recorded tracks')
}
for (const guard of ['isRecording', 'isPlaying', 'guideVisible', 'showSaveDialog']) {
  page.setData({ [guard]: true })
  const count = scheduled.length
  page.playLogoDemo()
  assert.equal(scheduled.length, count, guard + ' prevents competing playback')
  page.setData({ [guard]: false })
}
scheduled = []; stopped = 0
page.playLogoDemo()
const count = scheduled.length
page.playLogoDemo()
assert.equal(stopped, count, 'tapping again stops the previous preview')
assert.equal(timers.size, 1, 'tapping again does not duplicate timers')
page.setOctave(1)
assert.equal(page.data.logoDemoPlaying, false, 'changing octave stops the preview')
page.playLogoDemo()
page.pauseSession()
assert.equal(page.data.logoDemoPlaying, false, 'backgrounding stops the preview and scheduled voices')
assert.equal(timers.size, 0)
page.createVoice = () => { throw new Error('audio failure') }
page.playLogoDemo()
assert.equal(error, '示范暂时无法播放，请重试')
assert.equal(page.data.logoDemoPlaying, false)
assert.equal(timers.size, 0)
console.log('PASS: three instrument demos, octave matching, simultaneous drum highlights, one-shot completion, replay cleanup, guards and failure handling')
