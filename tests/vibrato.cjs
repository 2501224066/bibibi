// Run: node tests/vibrato.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition
const oscillators = []
const gains = []
const param = () => ({ value: 0, events: [], setValueAtTime(value, at) { this.events.push({ value, at }) }, linearRampToValueAtTime(value, at) { this.events.push({ value, at }) }, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} })
const node = () => ({ connections: [], connect(target) { this.connections.push(target) }, disconnect() { this.disconnected = true } })
const audio = {
  currentTime: 3, destination: {}, resume() {},
  createGain() { const value = { ...node(), gain: param() }; gains.push(value); return value },
  createBiquadFilter() { return { ...node(), frequency: param(), Q: param(), gain: param() } },
  createPeriodicWave(real, imag) { return { real, imag } },
  createOscillator() { const value = { ...node(), frequency: param(), detune: param(), setPeriodicWave(wave) { this.wave = wave }, start() {}, stop() {} }; oscillators.push(value); return value },
}
const sandbox = { Component(value) { definition = value }, wx: { createWebAudioContext: () => audio } }
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) }, ...definition.methods }
page.getAudioContext()
for (const instrument of ['drums', 'piano', 'synth']) {
  for (const savedVibrato of [false, true]) {
    const start = oscillators.length
    const voice = page.createVoice(instrument, 0, 1, savedVibrato, 3, .2, .7, .4)
    const sources = oscillators.slice(start)
    const lfos = sources.filter(source => source.frequency.value === 7)
    assert.equal(lfos.length, instrument === 'synth' ? 1 : 0, 'only synth has automatic vibrato, regardless of saved toggle')
    if (instrument === 'synth') {
      const lfo = lfos[0]
      assert.ok(lfo.wave, 'recorded synth phase is restored')
      const depth = lfo.connections[0]
      if (savedVibrato) assert.ok(Math.abs(depth.gain.events[0].value - 15) < 1e-9)
      assert.ok(depth.connections.includes(sources[0].detune))
    }
    voice.stop()
    assert.ok(sources.every(source => source.disconnected), 'LFO and carriers are cleaned up')
  }
}
assert.equal(page.toggleVibrato, undefined, 'the user-facing vibrato toggle is removed')
console.log('PASS: automatic synth vibrato, dry piano/drums, saved synth phase and oscillator cleanup')
