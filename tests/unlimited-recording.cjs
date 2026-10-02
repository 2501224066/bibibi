// Run: node tests/unlimited-recording.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, now = 1000, tick, stored
const audio = { currentTime: 0 }
const sandbox = {
  Component(value) { definition = value }, Date: { now: () => now },
  setInterval(callback) { tick = callback; return 1 }, clearInterval() {},
  wx: { setStorageSync(key, value) { stored = value }, getStorageSync: () => stored, hideKeyboard() {}, showToast(value) { assert.fail(value.title) } },
}
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const scheduled = []
const page = { data: structuredClone(definition.data), ...definition.methods,
  setData(value, callback) { Object.assign(this.data, value); callback?.() },
  getAudioContext: () => audio, measureKeys() {},
  createVoice(...args) { scheduled.push(args); return { stop() {}, release() {} } },
}
page.startRecording()
page.playKey(0)
now += 3600000
 tick()
assert.equal(page.data.isRecording, true, 'recording continues past three and ten minutes')
assert.equal(page.data.tracks[0].duration, 3600000)
assert.equal(page.data.timelineSeconds, 3600)
page.onKeyEnd()
page.playKey(1)
now += 2000
page.stopRecording()
assert.equal(page.data.tracks[0].notes[0].duration, 3600000)
assert.equal(page.data.tracks[0].notes[1].start, 3600000)
assert.equal(page.data.tracks[0].notes[1].duration, 2000)
for (const bar of page.data.tracks[0].bars) assert.ok(bar.left >= 0 && bar.left + bar.width <= 100.000001)
page.setData({ showSaveDialog: true, saveName: '长录音' })
page.saveMix()
assert.ok(stored)
page.loadLibrary()
assert.equal(page.data.libraryError, '')
assert.equal(page.data.savedMixes[0].duration, 3602000)
page.openLibrary()
page.selectSavedMix({ currentTarget: { dataset: { id: page.data.savedMixes[0].id } } })
page.togglePlayback()
assert.ok(scheduled.some(args => args[5] === 3600), 'full held note is scheduled')
assert.ok(scheduled.some(args => args[4] > 3600), 'late note is scheduled')
page.stopPlayback()
page.closeLibrary()
page.setData({ instrument: 'drums' })
page.startRecording()
now += 7200000
page.playKey(0)
page.onKeyEnd()
page.stopRecording()
assert.ok(page.data.tracks[0].notes[0].start >= 7200000)
assert.ok(page.data.tracks[0].notes[0].duration > 0, 'drum tail is not clipped by old limit')
const invalid = structuredClone(page.data.tracks)
invalid[0].notes[0].duration = Infinity
assert.throws(() => sandbox.restoreTracks(invalid), /Invalid note/)
console.log('PASS: hour-long recording, growing timeline, late notes, save/reload/playback, drum tails and finite-value validation')
