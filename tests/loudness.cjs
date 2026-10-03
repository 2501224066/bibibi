// NODE_PATH=/path/to/playwright/node_modules node tests/loudness.cjs
// Requires Chrome (CHROME_PATH overrides the macOS default) and Node 22.6+.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { chromium } = require('playwright')
const code = stripTypeScriptTypes(fs.readFileSync('miniprogram/pages/index/index.ts', 'utf8'))
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  try {
    const page = await browser.newPage()
    const rows = await page.evaluate(async code => {
      async function render(instrument, index, midi, velocity = 1, copies = 1) {
        const audio = new OfflineAudioContext(1, 48000 * 3, 48000)
        let definition
        new Function('wx', 'Component', code)({ createWebAudioContext: () => audio }, value => { definition = value })
        const methods = definition.methods
        // Offline contexts cannot resume; production initialization otherwise stays intact.
        audio.resume = () => Promise.resolve()
        methods.getAudioContext()
        for (let i = 0; i < copies; i++) methods.createVoice(instrument, index, 1, false, 0, instrument === 'drums' ? undefined : .5, 0, 0, velocity, midi)
        const output = await audio.startRendering()
        const pcm = output.getChannelData(0)
        let peak = 0
        for (const value of pcm) peak = Math.max(peak, Math.abs(value))
        // Approximate frequency weighting for comparison, not an integrated LUFS meter.
        const meter = new OfflineAudioContext(1, pcm.length, 48000)
        const source = meter.createBufferSource()
        source.buffer = output
        const shelf = meter.createBiquadFilter()
        shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4
        const highpass = meter.createBiquadFilter()
        highpass.type = 'highpass'; highpass.frequency.value = 38; highpass.Q.value = .5
        source.connect(shelf).connect(highpass).connect(meter.destination)
        source.start()
        const weighted = (await meter.startRendering()).getChannelData(0)
        // Maximum 100 ms energy compares attacks without padding short drums with silence.
        const window = 4800
        let energy = 0, maxEnergy = 0, attackEnergy = 0, maxAttackEnergy = 0
        const attackWindow = 960
        for (let i = 0; i < weighted.length; i++) {
          energy += weighted[i] ** 2
          if (i >= window) energy -= weighted[i - window] ** 2
          if (i >= window - 1) maxEnergy = Math.max(maxEnergy, energy)
          attackEnergy += weighted[i] ** 2
          if (i >= attackWindow) attackEnergy -= weighted[i - attackWindow] ** 2
          if (i >= attackWindow - 1) maxAttackEnergy = Math.max(maxAttackEnergy, attackEnergy)
        }
        return { instrument, index, midi, velocity, copies, db: 10 * Math.log10(maxEnergy / window), attackDb: 10 * Math.log10(maxAttackEnergy / attackWindow), peak }
      }
      const rows = []
      for (const instrument of ['synth', 'piano']) for (let midi = 48; midi < 84; midi++) rows.push(await render(instrument, 0, midi))
      for (let index = 0; index < 12; index++) rows.push(await render('drums', index))
      for (const instrument of ['synth', 'piano', 'drums']) {
        rows.push(await render(instrument, 0, instrument === 'drums' ? undefined : 60, .5))
        rows.push(await render(instrument, 0, instrument === 'drums' ? undefined : 60, 1, 5))
      }
      return rows
    }, code)
    for (const instrument of ['synth', 'piano', 'drums']) {
      const notes = rows.filter(row => row.instrument === instrument && row.velocity === 1 && row.copies === 1)
      console.log(instrument, 'weighted 100ms dBFS range:', Math.min(...notes.map(row => row.db)).toFixed(2), 'to', Math.max(...notes.map(row => row.db)).toFixed(2), 'peak:', Math.max(...notes.map(row => row.peak)).toFixed(3))
    }
    if (process.argv.includes('--report')) { console.log(JSON.stringify(rows)); return }
    if (process.argv.includes('--drums')) {
      const drums = rows.filter(row => row.instrument === 'drums' && row.velocity === 1 && row.copies === 1)
      const attacks = drums.map(row => row.attackDb)
      const balanced = drums.map(row => .65 * row.attackDb + .35 * row.db)
      assert.ok(Math.max(...attacks) - Math.min(...attacks) < 2, 'drum attack loudness should stay within 2 dB')
      assert.ok(Math.max(...balanced) - Math.min(...balanced) < .1, 'attack/body balance should match across drums')
      assert.ok(drums.every(row => row.peak < .65), 'individual drum hits retain peak headroom')
      const half = rows.find(row => row.instrument === 'drums' && row.velocity === .5)
      assert.ok(Math.abs(drums[0].db - half.db - 6.0206) < .05, 'drum velocity retains its dynamics')
      console.log('PASS: 12 drums balanced across attack/body energy, attack spread <2 dB, peak headroom and velocity dynamics')
      return
    }
    for (const row of rows) {
      assert.ok(Number.isFinite(row.db) && row.peak < .95, `clipping/non-finite output: ${JSON.stringify(row)}`)
      if (row.copies === 1 && row.velocity === 1) {
        // Device listening called for piano 3 dB below the initial meter-only balance.
        const target = row.instrument === 'piano' ? -32 : -29
        assert.ok(Math.abs(row.db - target) <= 3, `uncalibrated loudness: ${JSON.stringify(row)}`)
        assert.ok(row.peak * 5 < .95, `five unison voices exceed headroom: ${JSON.stringify(row)}`)
      }
      if (row.velocity === .5) {
        const full = rows.find(full => full.instrument === row.instrument && full.index === row.index && full.midi === row.midi && full.velocity === 1 && full.copies === 1)
        assert.ok(Math.abs(full.db - row.db - 6.0206) < .05, 'velocity must retain dynamics')
      }
    }
    console.log('PASS: 84 sounds within target ±3 dB, half-velocity dynamics and five-voice peak headroom')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
