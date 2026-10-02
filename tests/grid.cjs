// Run: node tests/grid.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let definition
const sandbox = { Component(value) { definition = value } }
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const layout = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
assert.deepEqual(Array.from(definition.data.padCells), layout)
for (let cell = 0; cell < 12; cell++) {
  assert.equal(sandbox.padKeyAt((cell % 6 + .5) / 3 - 1, (Math.floor(cell / 6) + .5) - 1), layout[cell])
  if (layout[cell] >= 0) {
    const key = definition.data.keys[layout[cell]]
    assert.equal(key.drumLabel.includes('镲'), cell < 6, 'all cymbals occupy the top row')
    assert.equal(key.drumIconIndex, vm.runInNewContext(`DRUM_KEY_ORDER[${layout[cell]}]`, sandbox), 'icon and played drum share the same sound index')
  }
}
for (const [x, y] of [[-1.01, 0], [1, 0], [0, -1.01], [0, 1], [NaN, 0]]) {
  assert.equal(sandbox.padKeyAt(x, y), -1)
}
assert.equal(sandbox.padKeyAt(-1, -1), 0)
assert.equal(sandbox.padKeyAt(0, -.75), 3, 'cell boundaries match the grid')
let demoCount = 0
const page = {
  data: structuredClone(definition.data), ...definition.methods,
  createSelectorQuery() { return { select() { return this }, boundingClientRect() { return this }, exec(callback) { callback([{ left: 0, top: 0, width: 300, height: 100 }]) } } },
  playKey(index) { this.data.activeIndex = index },
  releaseKey() { this.data.activeIndex = -1 },
  playGuideDemo() { demoCount++ },
}
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })
page.onPadStart(touch(25, 25))
assert.equal(page.data.activeIndex, 0)
page.onKeyMove(touch(48, 25))
assert.equal(page.data.activeIndex, -1, 'the 4px column gap releases the note')
page.onKeyMove(touch(25, 25))
page.onKeyMove(touch(25, 50))
assert.equal(page.data.activeIndex, -1, 'the 4px row gap releases the note')
page.onKeyMove(touch(125, 75))
assert.equal(page.data.activeIndex, 8, 'the centre now plays a note in the bottom row')
page.onKeyMove(touch(310, 75))
assert.equal(page.data.activeIndex, -1, 'sliding outside the grid releases the note')
page.onKeyMove(touch(275, 75))
assert.equal(page.data.activeIndex, 11)
page.onKeyEnd()
assert.equal(page.data.activeIndex, -1)
page.data.guideVisible = true
page.data.guideStep = page.data.guideSteps.findIndex(step => step.action === 'melody')
page.onPadStart(touch(310, 75))
assert.equal(demoCount, 0, 'touches outside the grid do not start the guide demonstration')
page.onPadStart(touch(25, 25))
assert.equal(demoCount, 1)
console.log('PASS: 2×6 layout, 12 keys, top-row cymbals, boundaries, 4px gaps, sliding release and guide interaction')
