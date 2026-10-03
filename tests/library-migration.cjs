// Run: node tests/library-migration.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const fixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-rainbow.json', 'utf8'))
const nocturneFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-nocturne.json', 'utf8'))
const lawrenceFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-lawrence.json', 'utf8'))
const zebraFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-zebra.json', 'utf8'))
const boundlessFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-boundless.json', 'utf8'))
const summerFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-summer.json', 'utf8'))
const doraemonFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-doraemon.json', 'utf8'))
const moonboatFixture = JSON.parse(fs.readFileSync('miniprogram/assets/demo-moonboat.json', 'utf8'))
let definition, stored
const sandbox = {
  Component(value) { definition = value },
  wx: {
    getStorageSync: () => stored,
    setStorageSync(key, value) { stored = value },
    getFileSystemManager: () => ({
      readFileSync: (path) => {
        if (typeof path === 'string' && path.includes('moonboat')) return JSON.stringify(moonboatFixture)
        if (typeof path === 'string' && path.includes('doraemon')) return JSON.stringify(doraemonFixture)
        if (typeof path === 'string' && path.includes('summer')) return JSON.stringify(summerFixture)
        if (typeof path === 'string' && path.includes('boundless')) return JSON.stringify(boundlessFixture)
        if (typeof path === 'string' && path.includes('zebra')) return JSON.stringify(zebraFixture)
        if (typeof path === 'string' && path.includes('lawrence')) return JSON.stringify(lawrenceFixture)
        if (typeof path === 'string' && path.includes('nocturne')) return JSON.stringify(nocturneFixture)
        return JSON.stringify(fixture)
      },
    }),
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
assert.deepEqual(Array.from(page.data.savedMixes, mix => mix.id), [moonboatFixture.id, doraemonFixture.id, summerFixture.id, boundlessFixture.id, zebraFixture.id, lawrenceFixture.id, nocturneFixture.id, fixture.id, custom.id])
assert.equal(page.data.savedMixes[0].name, '月亮船(快乐星球)-王英姿')
assert.equal(page.data.savedMixes[1].name, '哆啦A梦')
assert.equal(page.data.savedMixes[2].name, '菊次郎的夏天-久石让')
assert.equal(page.data.savedMixes[3].name, '海阔天空-Beyond')
assert.equal(page.data.savedMixes[4].name, '斑马斑马-宋冬野')
assert.equal(page.data.savedMixes[5].name, '战场上的圣诞节-坂本龙一')
assert.equal(page.data.savedMixes[6].name, '夜曲-周杰伦')
assert.equal(page.data.savedMixes[7].name, '彩虹-周杰伦')
assert.equal(page.data.savedMixes[0].tracks.reduce((sum, track) => sum + track.notes.length, 0), 505)
assert.equal(page.data.savedMixes[1].tracks.reduce((sum, track) => sum + track.notes.length, 0), 870)
assert.equal(page.data.savedMixes[2].tracks.reduce((sum, track) => sum + track.notes.length, 0), 1223)
assert.equal(page.data.savedMixes[3].tracks.reduce((sum, track) => sum + track.notes.length, 0), 3612)
assert.equal(page.data.savedMixes[4].tracks.reduce((sum, track) => sum + track.notes.length, 0), 907)
assert.equal(page.data.savedMixes[5].tracks.reduce((sum, track) => sum + track.notes.length, 0), 2269)
assert.equal(page.data.savedMixes[6].tracks.reduce((sum, track) => sum + track.notes.length, 0), 2881)
assert.equal(page.data.savedMixes[7].tracks.reduce((sum, track) => sum + track.notes.length, 0), 1362)
assert.ok(page.data.savedMixes[0].duration > 80000)
assert.ok(page.data.savedMixes[1].duration > 170000)
assert.ok(page.data.savedMixes[2].duration > 140000)
assert.ok(page.data.savedMixes[3].duration > 340000)
assert.ok(page.data.savedMixes[4].duration > 240000)
assert.ok(page.data.savedMixes[5].duration > 280000)
assert.ok(page.data.savedMixes[6].duration > 200000)
assert.ok(page.data.savedMixes[7].duration > 240000)
assert.equal(page.data.savedMixes[8].name, custom.name)
page.loadLibrary()
assert.equal(page.data.libraryError, '')
page.seedMidiMix()
assert.equal(page.data.savedMixes.length, 9)
stored.mixes = [custom]
page.loadLibrary()
page.seedMidiMix()
assert.equal(page.data.savedMixes.length, 1, 'deleted full demo stays deleted')
stored = undefined
page.loadLibrary()
page.seedMidiMix()
assert.equal(page.data.savedMixes.length, 8)
assert.equal(page.data.savedMixes[0].id, moonboatFixture.id)
assert.equal(page.data.savedMixes[1].id, doraemonFixture.id)
assert.equal(page.data.savedMixes[2].id, summerFixture.id)
assert.equal(page.data.savedMixes[3].id, boundlessFixture.id)
assert.equal(page.data.savedMixes[4].id, zebraFixture.id)
assert.equal(page.data.savedMixes[5].id, lawrenceFixture.id)
assert.equal(page.data.savedMixes[6].id, nocturneFixture.id)
assert.equal(page.data.savedMixes[7].id, fixture.id)
assert.equal(page.data.savedMixes[0].name, '月亮船(快乐星球)-王英姿')
assert.equal(page.data.savedMixes[1].name, '哆啦A梦')
assert.equal(page.data.savedMixes[2].name, '菊次郎的夏天-久石让')
assert.equal(page.data.savedMixes[3].name, '海阔天空-Beyond')
assert.equal(page.data.savedMixes[4].name, '斑马斑马-宋冬野')
assert.equal(page.data.savedMixes[5].name, '战场上的圣诞节-坂本龙一')
assert.equal(page.data.savedMixes[6].name, '夜曲-周杰伦')
assert.equal(page.data.savedMixes[7].name, '彩虹-周杰伦')
console.log('PASS: Moon Boat, Doraemon, Summer, Boundless, Zebra, Lawrence, Nocturne and Rainbow load, old demo removed, Rainbow renamed, user mixes preserved, migration idempotent and fresh library contains all 8 built-in songs')
