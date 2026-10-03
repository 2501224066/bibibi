// Run: node tests/guide.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition, seen = false, demoTick, recordTick
const timeouts = new Map()
let timeoutId = 0
const runTimeout = delay => {
  const entry = [...timeouts].find(([, timer]) => timer.delay === delay)
  assert.ok(entry, `expected a ${delay}ms timer`)
  timeouts.delete(entry[0])
  entry[1].callback()
}
const audio = { currentTime: 0 }
const demoNotes = []
const sandbox = {
  setTimeout(callback, delay) { const id = ++timeoutId; timeouts.set(id, { callback, delay }); return id },
  clearTimeout(id) { timeouts.delete(id) },
  setInterval(callback, interval) { if (interval === 40) demoTick = callback; else recordTick = callback; return interval }, clearInterval() {}, Component(value) { definition = value }, wx: {
  getStorageSync: () => seen,
  getFileSystemManager: () => ({ readFileSync: () => fs.readFileSync('miniprogram/assets/demo-rainbow.json', 'utf8') }),
  setStorageSync(key, value) { assert.equal(key, 'bibibi.guide.v1'); seen = value },
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20 }),
} }
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = { data: structuredClone(definition.data), ...definition.methods,
  setData(value, callback) { Object.assign(this.data, value); callback?.() },
  measureKeys() {}, onKeyEnd() {}, playKnobBeep() {}, startMetronome() {},
  createSelectorQuery() { return { select() { return this }, boundingClientRect() { return this }, exec(callback) { callback([{ left: 180, top: 440, bottom: 480, width: 50, height: 40 }, { left: 32, top: 360, bottom: 380, width: 90, height: 20 }]) } } }
}
definition.lifetimes.ready.call(page)
assert.equal(page.data.guideVisible, true)
assert.equal(page.data.guideStep, 0)
assert.equal(page.data.guideRect.top, 435, 'knob window does not include the space between targets')
assert.ok(page.data.guideRect.top + page.data.guideRect.height >= 480, 'knob remains interactive')
assert.ok(page.data.guideCardTop + page.data.guideCardHeight <= 423, 'instruction card sits above the knob with a gap')
assert.ok(page.data.guideCardTop >= 68, 'instruction card stays below the navigation')
assert.equal(667 - page.data.guideCardBottom, page.data.guideRect.top - 12, 'the card bottom stays 12px above the knob regardless of content height')
page.nextGuide()
assert.equal(page.data.guideStep, 0, 'must operate the highlighted control first')
page.cycleInstrument()
assert.equal(page.data.controlFlashes.tone, 1, 'changing instrument flashes its screen icon')
assert.equal(page.data.guideDone, true)
assert.ok(page.data.guideFeedback.includes(page.data.instrumentName))
page.nextGuide()
page.cycleOctave()
assert.equal(page.data.controlFlashes.range, 1, 'changing octave flashes the range marker')
assert.equal(page.data.guideDone, true)
page.nextGuide()
page.getAudioContext = () => audio
page.cycleMetronome()
assert.equal(page.data.controlFlashes.metronome, 1, 'changing tempo flashes its screen icon')
assert.equal(page.data.guideDone, true)
page.nextGuide()
assert.equal(page.data.instrument, 'piano')
assert.equal(page.data.octaveIndex, 1)
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'record')
page.createVoice = (...args) => { demoNotes.push(args); return { stop() {} } }
page.toggleRecording()
assert.equal(page.data.isRecording, true)
page.nextGuide()
assert.equal(page.data.guideDemoPlaying, false, 'recording opens the demo step without starting it')
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'melody')
const melodyCardTop = page.data.guideCardTop
assert.equal(page.data.guideDemoPlaying, false)
page.nextGuide()
assert.equal(page.data.guideDemoPlaying, true, 'the user starts the demo with its button')
assert.equal(demoNotes.length, 14)
assert.deepEqual(demoNotes.map(args => args[9]), [60, 62, 64, 60, 60, 62, 64, 60, 64, 65, 67, 64, 65, 67])
page.nextGuide()
assert.equal(demoNotes.length, 14, 'cannot duplicate a running demonstration')
audio.currentTime = .9
demoTick()
assert.equal(page.data.guideExpectedKey, 2)
audio.currentTime = 1.2
demoTick()
assert.equal(page.data.guideExpectedKey, -1, 'key releases in the gap between notes')
assert.ok(Math.abs(demoNotes[10][5] - .72) < 1e-9, 'phrase ending has a two-beat note')
audio.currentTime = 7
demoTick()
assert.equal(page.data.guideDemoPlaying, false)
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'melody', 'demo completion waits for Next')
assert.equal(page.data.guideDone, true, 'demo completion enables Next')
assert.equal(page.data.isRecording, true, 'recording continues while waiting for Next')
page.onPadStart({ touches: [{ clientX: 100, clientY: 100 }] })
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'melody', 'tapping disc after demo does not advance step')
page.nextGuide()
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'stop-record')
assert.equal(page.data.isRecording, true, 'entering stop-record waits for the record button')
assert.equal(page.data.guideDone, false)
page.nextGuide()
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'stop-record', 'cannot skip stopping the recording')
page.toggleRecording()
assert.equal(page.data.isRecording, false)
assert.equal(page.data.guideCardTop, melodyCardTop, 'card remains in place when window switches to stop recording')
assert.equal(page.data.tracks[0].notes.length, 14, 'demonstration is actually recorded')
assert.equal(page.data.guideDone, true)
assert.equal(page.data.guideExpectedKey, -1)
page.openLibrary = () => page.setData({ libraryOpen: true })
page.closeLibrary = () => page.setData({ libraryOpen: false })
page.nextGuide()
assert.equal(page.data.guideSteps[page.data.guideStep].action, 'save')
page.enterGuideStep(page.data.guideSteps.findIndex(step => step.action === 'library'))
page.toggleLibrary()
assert.equal(page.data.guideDone, true)
page.nextGuide()
assert.ok(page.data.savedMixes.some(mix => mix.id === 'demo-rainbow-midi-v1'))
page.selectSavedMix({ currentTarget: { dataset: { id: 'demo-rainbow-midi-v1' } } })
assert.equal(page.data.guideDone, true)
assert.equal(page.data.selectedMixId, 'demo-rainbow-midi-v1')
page.nextGuide()
page.createVoice = () => ({ stop() {} })
page.togglePlayback()
assert.equal(page.data.isPlaying, true)
assert.equal(page.data.guideDone, true, 'actual playback completes the final step')
page.nextGuide()
assert.equal(page.data.guideVisible, true, 'final step stays visible without requiring a finish button')
assert.equal(page.data.guideFading, false)
runTimeout(1000)
assert.equal(page.data.guideVisible, true, 'guide remains mounted during fade')
assert.equal(page.data.guideFading, true)
runTimeout(350)
assert.equal(page.data.guideVisible, false)
assert.equal(page.data.isPlaying, true, 'automatic dismissal keeps the music playing')
assert.equal(seen, true)
assert.equal(timeouts.size, 0)
page.stopPlayback()
definition.lifetimes.ready.call(page)
assert.equal(page.data.guideVisible, false, 'completed guide is not shown automatically')
page.startGuide()
assert.equal(page.data.guideVisible, true, 'help reopens guide')
page.enterGuideStep(page.data.guideSteps.length - 1)
page.guideAction('play', '正在播放。')
assert.equal(timeouts.size, 1)
page.enterGuideStep(0)
assert.equal(timeouts.size, 0, 'changing steps cancels automatic dismissal')
page.enterGuideStep(page.data.guideSteps.length - 1)
page.guideAction('play', '正在播放。')
runTimeout(1000)
page.finishGuide()
assert.equal(timeouts.size, 0, 'manual dismissal cancels the pending fade timer')
assert.equal(page.data.guideFading, false)
page.data.isRecording = true
page.startGuide()
assert.equal(page.data.guideVisible, false, 'recording is not interrupted')
console.log('PASS: first visit, positioning, previous/next, completion memory, manual replay and recording guard')

const markup = fs.readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
assert.ok(markup.includes('<block wx:if="{{guideVisible}}">'), 'guide must not have a full-screen hit target')
assert.ok(markup.includes('wx:if="{{guideStep < guideSteps.length - 1}}" class="guide-next"'), 'final step has no finish button')
assert.ok(!markup.includes('class="guide-focus"'), 'no transparent view may cover the interactive hole')
for (const step of definition.data.guideSteps) {
  assert.ok(!step.selector.includes(':nth-child'), 'selector query uses direct classes')
  assert.ok(markup.includes(step.selector.slice(1)), 'guide target exists in markup')
}
console.log('PASS: guide targets use direct classes and the interaction hole has no overlay element')

const masks = sandbox.guideMasks(375, 667, [
  { left: 175, top: 435, width: 60, height: 50 },
  { left: 27, top: 355, width: 100, height: 30 },
])
const covered = (x, y) => masks.some(r => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height)
assert.equal(covered(200, 460), false, 'knob is interactive')
assert.equal(covered(50, 370), false, 'screen icons are visible')
assert.equal(covered(150, 410), true, 'space between windows stays masked')
assert.equal(covered(10, 10), true)
assert.equal(masks.reduce((area, r) => area + r.width * r.height, 0), 375 * 667 - 60 * 50 - 100 * 30)
console.log('PASS: separate knob/status windows, masked gap and card above knob')

const flashes = page.data.controlFlashes.tone
page.flashScreenControl('tone')
page.flashScreenControl('tone')
assert.equal(page.data.controlFlashes.tone, flashes + 2, 'repeated changes restart the glow animation')

assert.equal(page.data.screenGlitch, 0, 'screen starts without a glitch')
page.triggerScreenGlitch()
page.triggerScreenGlitch()
assert.equal(page.data.screenGlitch, 2, 'each logo tap restarts the screen effect')
page.finishScreenGlitch()
assert.equal(page.data.screenGlitch, 0, 'animation completion removes the effect before library content is recreated')
page.toggleLibrary()
page.toggleLibrary()
assert.equal(page.data.screenGlitch, 0, 'opening and closing the library does not trigger the logo effect')
assert.ok(markup.includes('class="panel-heading" bindanimationend="finishScreenGlitch"'), 'the stable screen header clears the effect on completion')

sandbox.wx.getSystemInfoSync = () => ({ windowWidth: 320, windowHeight: 568, statusBarHeight: 20 })
page.setData({ guideVisible: true })
for (const action of ['tone', 'octave', 'metronome']) {
  page.setData({ guideStep: page.data.guideSteps.findIndex(step => step.action === action) })
  page.positionGuide()
  assert.ok(page.data.guideCardTop >= 68)
  assert.ok(page.data.guideCardTop + page.data.guideCardHeight <= page.data.guideRect.top - 12, 'all knob cards fit above their targets on a small screen')
  assert.ok(page.data.guideCardTop + page.data.guideCardHeight <= 556)
  assert.equal(568 - page.data.guideCardBottom, page.data.guideRect.top - 12, 'short cards stay anchored close to the knob')
}

for (const action of ['melody', 'stop-record']) {
  page.setData({ guideVisible: true, guideRecording: true, isRecording: false,
    guideStep: page.data.guideSteps.findIndex(step => step.action === action) })
  definition.pageLifetimes.show.call(page)
  assert.equal(page.data.guideSteps[page.data.guideStep].action, 'record', 'interrupted guide recording can restart after returning')
  assert.equal(page.data.guideRecording, false)
  assert.equal(page.data.guideDone, false)
}
