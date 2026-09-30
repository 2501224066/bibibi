// Run: node tests/timeline.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const markup = fs.readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
const sandbox = { module: { exports: {} } }
vm.runInNewContext(markup.match(/<wxs module="timeline">([\s\S]*?)<\/wxs>/)[1], sandbox)
const timeline = sandbox.module.exports
for (const duration of [10000, 180000, 3600000]) {
  const span = Math.max(180000, duration)
  assert.equal(timeline.pixels(5000 / span * 100, duration), 200, 'same time has same position for short and long tracks')
  assert.ok(Math.abs(timeline.pixels(100 / span * 100, duration) - 4) < 1e-9, 'short notes are not stretched')
  const head = timeline.pixels(duration / span * 100, duration)
  const scroll = timeline.scroll(duration / span * 100, duration, 240)
  assert.ok(head - scroll <= 240 * .7 + 1e-9, 'playhead remains visible')
  assert.ok(scroll <= timeline.width(duration, 240) - 240 + 1e-9, 'scroll offset is reachable')
}
assert.equal(timeline.scroll(0, 10000, 240), 0)
console.log('PASS: fixed note spacing, short-note widths and reachable auto-scroll for recordings up to one hour')
