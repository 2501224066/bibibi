// Run: node tests/share.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')

let definition
let shareMenuCalled = false
let shareMenuOptions = null

const sandbox = {
  Component(value) { definition = value },
  wx: {
    getFileSystemManager: () => ({ readFileSync: () => '{}' }),
    getStorageSync: () => null,
    setStorageSync() {},
    getSystemInfoSync: () => ({ windowWidth: 375, screenHeight: 667, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, left: 280 }),
    showShareMenu(options) {
      shareMenuCalled = true
      shareMenuOptions = options
    },
  },
}

vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8')), sandbox)

assert.ok(definition.methods.onShareAppMessage, 'onShareAppMessage method must be defined in methods')
assert.ok(definition.methods.onShareTimeline, 'onShareTimeline method must be defined in methods')

const shareAppMessageResult = definition.methods.onShareAppMessage()
assert.equal(shareAppMessageResult.path, '/pages/index/index')
assert.ok(shareAppMessageResult.title && shareAppMessageResult.title.includes('哔哔'))

const shareTimelineResult = definition.methods.onShareTimeline()
assert.ok(shareTimelineResult.title && shareTimelineResult.title.includes('哔哔'))

const pageInstance = {
  ...definition.methods,
  setData() {},
  loadLibrary() {},
  seedMidiMix() {},
}

definition.lifetimes.attached.call(pageInstance)
assert.equal(shareMenuCalled, true, 'showShareMenu should be invoked during attached lifecycle')
assert.deepEqual(Array.from(shareMenuOptions.menus), ['shareAppMessage', 'shareTimeline'])
assert.equal(shareMenuOptions.withShareTicket, true)

shareMenuCalled = false
shareMenuOptions = null
definition.pageLifetimes.show.call(pageInstance)
assert.equal(shareMenuCalled, true, 'showShareMenu should be invoked during page show lifecycle')
assert.deepEqual(Array.from(shareMenuOptions.menus), ['shareAppMessage', 'shareTimeline'])

console.log('PASS: share configuration and lifecycle hooks for home page forwarding')
