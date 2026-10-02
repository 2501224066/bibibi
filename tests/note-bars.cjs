// Run: node tests/note-bars.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const sandbox = { Component() {} }
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const bars = sandbox.noteBars([{ index: 0, start: 0, duration: 20 }, { index: 1, start: 20, duration: 20 }])
assert.ok(Math.abs(bars[0].left + bars[0].width - bars[1].left) < 1e-12)
assert.ok(Math.abs(bars[0].top - bars[1].top) / 100 * 38 > 2, 'adjacent rows have room for the stroke')
const css = fs.readFileSync('miniprogram/pages/index/index.less', 'utf8').match(/\.note-bar\s*\{([^}]+)\}/)[1]
assert.ok(!css.includes('min-width'), 'short notes must not extend into later notes')
console.log('PASS: sequential short notes retain exact timing and adjacent rows do not overlap')

const markup = fs.readFileSync('miniprogram/pages/index/index.wxml', 'utf8')
const timeline = { module: { exports: {} } }
vm.runInNewContext(markup.match(/<wxs module="timeline">([\s\S]*?)<\/wxs>/)[1], timeline)
const active = timeline.module.exports.active
assert.equal(active(-1, bars[0].left, bars[0].width), false, 'stopped tracks do not glow')
assert.equal(active(undefined, bars[0].left, bars[0].width), false)
assert.equal(active(bars[0].left, bars[0].left, bars[0].width), true)
assert.equal(active(bars[0].left + bars[0].width / 2, bars[0].left, bars[0].width), true)
assert.equal(active(bars[0].left + bars[0].width, bars[0].left, bars[0].width), false, 'glow ends with the note')
assert.equal(active(bars[1].left, bars[1].left, bars[1].width), true, 'the next note glows at its start')
console.log('PASS: playback glow follows note starts and ends and clears on stopped tracks')
