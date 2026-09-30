// Run: node tests/library-migration.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const fixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-rainbow.json', 'utf8'))
let definition, stored
const sandbox = {
  Component(value) { definition = value },
  wx: {
    getStorageSync: () => stored,
    setStorageSync(key, value) { stored = value },
    getFileSystemManager: () => ({ readFileSync: () => JSON.stringify(fixture) }),
    showToast(value) { assert.fail(value.title) },
  },
}
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)
const page = { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) }, ...definition.methods }
const old = { ...fixture, tracks: fixture.tracks.map(track => ({ ...track, duration: track.notes.length ? 90000 : 0, notes: track.notes.filter(note => note.start + note.duration <= 90000) })) }
const custom = { ...old, id: 'user-saved', name: '我的录音' }
stored = { version: 1, soundLayoutVersion: 2, midiDemoVersion: 1, mixes: [old, { ...old, id: 'demo-fathers-name-v1' }, custom] }
page.loadLibrary()
assert.equal(page.data.libraryError, '')
page.seedMidiMix()
assert.deepEqual(Array.from(page.data.savedMixes, mix => mix.id), [fixture.id, custom.id])
assert.equal(page.data.savedMixes[0].tracks.reduce((sum, track) => sum + track.notes.length, 0), 1362)
assert.ok(page.data.savedMixes[0].duration > 240000)
assert.equal(page.data.savedMixes[1].name, custom.name)
page.loadLibrary()
assert.equal(page.data.libraryError, '')
page.seedMidiMix()
assert.equal(page.data.savedMixes.length, 2)
stored.mixes = [custom]
page.loadLibrary()
page.seedMidiMix()
assert.equal(page.data.savedMixes.length, 1, 'deleted full demo stays deleted')
stored = undefined
page.loadLibrary()
page.seedMidiMix()
assert.equal(page.data.savedMixes.length, 1)
assert.equal(page.data.savedMixes[0].id, fixture.id)
console.log('PASS: full MIDI loads, old demo removed, Rainbow replaced, user mixes preserved, migration idempotent and fresh library contains only Rainbow')
