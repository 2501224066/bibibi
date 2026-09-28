type InstrumentId = 'drums' | 'piano' | 'synth'
type NoteEvent = { index: number; start: number; duration: number; octave: number; vibrato: boolean; vibratoAge?: number; vibratoPhase?: number; velocity?: number; midiNote?: number }
type Track = { id: number; instrument: InstrumentId | null; name: string; octaveLabel: string; checked: boolean; loop: boolean; duration: number; durationLabel: string; notes: NoteEvent[]; bars: { id: number; left: number; width: number; top: number }[] }
type SavedMix = { id: string; name: string; duration: number; durationLabel: string; tracks: Track[] }
type SaveFlight = { left: number; top: number; width: number; height: number; x: number; y: number; scale: number; name: string; tracks: Track[] }
const LIBRARY_KEY = 'peninsula-music-box.library.v1'
type Voice = { stop: () => void; release?: () => void; vibratoPhase?: () => number; retune?: (index: number, octave: number, vibrato: boolean, age: number, midiNote?: number) => void; oneShot?: boolean }
const LIMIT = 16000
const MAX_TRACK_DURATION = 90000
const DEMO_VERSION = 3
const VIBRATO_RATE = 7
const VIBRATO_DEPTH_CENTS = 15
const VIBRATO_DELAY = .5
const VIBRATO_FADE = .2
const VIBRATO_READY = VIBRATO_DELAY + VIBRATO_FADE
const INSTRUMENTS: { id: InstrumentId; name: string }[] = [
  { id: 'drums', name: '鼓嚓' }, { id: 'piano', name: '钢琴' }, { id: 'synth', name: '电音' },
]
// Legacy pitches preserve recordings made before the chromatic layout.
const FREQUENCIES = [349.23, 392, 440, 493.88, 523.25, 587.33, 261.63, 293.66, 329.63, 698.46, 783.99, 880]
const RING_KEYS = 12
// Calibrated with tests/loudness.cjs: weighted 100 ms level near -29 dBFS.
// Keep trims explicit for device listening adjustments; velocity remains linear.
// Piano receives an additional -3 dB trim based on device listening feedback.
const INSTRUMENT_LEVELS = { synth: .035, piano: .041 }
const DRUM_SOUNDS = [
  { name: '军鼓', kind: 'snare', frequency: 185, duration: .32, level: 0.0755 },
  { name: '高通鼓', kind: 'tom', frequency: 220, duration: .55, level: 0.0762 },
  { name: '闭合踩镲', kind: 'metal', frequency: 410, duration: .12, level: 0.1319 },
  { name: '开放踩镲', kind: 'metal', frequency: 410, duration: .65, level: 0.0624 },
  { name: '吊镲', kind: 'metal', frequency: 295, duration: 1.8, level: 0.0493 },
  { name: '叮叮镲', kind: 'metal', frequency: 630, duration: 1.4, level: 0.0591 },
  { name: '中通鼓', kind: 'tom', frequency: 165, duration: .65, level: 0.0721 },
  { name: '落地通鼓', kind: 'tom', frequency: 110, duration: .8, level: 0.0663 },
  { name: '底鼓', kind: 'kick', frequency: 55, duration: .45, level: 0.0782 },
  { name: '军鼓Ⅱ', kind: 'snare', frequency: 240, duration: .22, level: 0.0888 },
  { name: '吊镲Ⅱ', kind: 'metal', frequency: 345, duration: 2.1, level: 0.0471 },
  { name: '水镲', kind: 'metal', frequency: 520, duration: .8, level: 0.0613 },
]
const NOTE_STEPS = [5, 7, 9, 11, 12, 14, 0, 2, 4, 17, 19, 21]
// Physical keys: cymbals across the upper arc, drums across the lower arc.
// Recorded drum indices continue to identify sounds, independent of layout.
const DRUM_KEY_ORDER = [0, 1, 2, 3, 4, 5, 10, 11, 6, 7, 9, 8]
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function shiftedKey(index: number, octave = 1) {
  const note = NOTE_NAMES[index]
  return { label: note, note, pitchLabel: `${note}${octave + 3}` }
}
function shiftedPitch(index: number, octave: number): number {
  return 48 + octave * 12 + index
}
const activeVoices = new Set<Voice>()
function arcPoints(radius: number, start: number, end: number): string[] {
  const steps = Math.ceil(Math.abs(end - start) / 3)
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (start + (end - start) * index / steps) * Math.PI / 180
    return `${(50 + radius * Math.cos(angle)).toFixed(3)}% ${(50 + radius * Math.sin(angle)).toFixed(3)}%`
  })
}

function keyPolygon(index: number): string {
  if (index === RING_KEYS - 1) return [
    ...arcPoints(18, 105, 435), ...arcPoints(50, 75, 105),
  ].join(', ')
  const start = 105 + index * 30
  const end = start + 30
  return [...arcPoints(50, start, end), ...arcPoints(18, end, start)].join(', ')
}

function padKeyAt(x: number, y: number): number {
  const radius = Math.sqrt(x * x + y * y)
  if (radius > 1) return -1
  const angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
  if (radius <= .36 || (angle >= 75 && angle <= 105)) return RING_KEYS - 1
  return Math.min(RING_KEYS - 2, Math.floor(((angle - 105 + 360) % 360) / 30))
}

function noteBars(notes: NoteEvent[], duration = LIMIT) {
  const span = Math.max(LIMIT, duration)
  return notes.map((note, id) => ({ id, left: note.start / span * 100, width: Math.min(100 - note.start / span * 100, Math.max(.2, note.duration / span * 100)), top: (11 - note.index) / 12 * 70 }))
}

function trackRange(notes: NoteEvent[]): string {
  if (!notes.some(note => note.midiNote !== undefined)) return ['L', 'M', 'H'].filter((_, octave) => notes.some(note => note.octave === octave)).join('/')
  const pitches = notes.map(note => (note.midiNote !== undefined ? note.midiNote : 48 + note.octave * 12 + NOTE_STEPS[note.index]))
  const label = (pitch: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`
  return `${label(Math.min(...pitches))}–${label(Math.max(...pitches))}`
}

function restoreTracks(value: unknown): Track[] {
  if (!Array.isArray(value) || value.length !== 5) throw new Error('Invalid tracks')
  return value.map((track, id) => {
    if (!track || !Array.isArray(track.notes) || !Number.isFinite(track.duration) || track.duration < 0 || track.duration > MAX_TRACK_DURATION) throw new Error('Invalid track')
    const instrument = INSTRUMENTS.find(item => item.id === track.instrument)
    if (track.notes.length && !instrument) throw new Error('Invalid instrument')
    const notes: NoteEvent[] = track.notes.map((note: NoteEvent) => {
      if (!note || !Number.isInteger(note.index) || note.index < 0 || note.index > 11
        || !Number.isInteger(note.octave) || note.octave < 0 || note.octave > 2
        || !Number.isFinite(note.start) || note.start < 0 || note.start >= MAX_TRACK_DURATION
        || !Number.isFinite(note.duration) || note.duration <= 0 || note.start + note.duration > MAX_TRACK_DURATION + .001
        || typeof note.vibrato !== 'boolean'
        || (note.vibratoAge !== undefined && (!Number.isFinite(note.vibratoAge) || note.vibratoAge < 0 || note.vibratoAge > VIBRATO_READY))
        || (note.vibratoPhase !== undefined && (!Number.isFinite(note.vibratoPhase) || note.vibratoPhase < 0 || note.vibratoPhase >= Math.PI * 2))
        || (note.velocity !== undefined && (!Number.isFinite(note.velocity) || note.velocity <= 0 || note.velocity > 1))
        || (note.midiNote !== undefined && (!Number.isInteger(note.midiNote) || note.midiNote < 0 || note.midiNote > 127))) throw new Error('Invalid note')
      return { index: note.index, octave: note.octave, start: note.start, duration: note.duration, vibrato: note.vibrato, vibratoAge: note.vibratoAge !== undefined ? note.vibratoAge : (note.vibrato ? VIBRATO_READY : 0), vibratoPhase: note.vibratoPhase !== undefined ? note.vibratoPhase : 0, velocity: note.velocity !== undefined ? note.velocity : 1, ...(note.midiNote === undefined ? {} : { midiNote: note.midiNote }) }
    })
    const duration = notes.length ? Math.max(track.duration, ...notes.map(note => note.start + note.duration)) : 0
    return { id, instrument: notes.length ? instrument!.id : null, name: notes.length ? instrument!.name : '',
      octaveLabel: trackRange(notes),
      checked: notes.length > 0 && track.checked !== false, loop: notes.length > 0 && track.loop === true, duration, durationLabel: duration ? `${(duration / 1000).toFixed(1)}s` : '—', notes, bars: noteBars(notes, duration) }
  })
}

let mixGesture: { id: string; x: number; y: number; offset: number; axis: string } | null = null
let suppressMixTap = false
let saveEffectId = 0
let context: any = null
let liveVoice: Voice | null = null
let liveSynthVoice: Voice | null = null
let vibratoStartedAt: number | null = null
let playbackVoices: Voice[] = []
const trackLoops = new Map<number, { start: number; next: number; voices: Voice[] }>()
let timer: ReturnType<typeof setInterval> | null = null
let playbackTimer: ReturnType<typeof setInterval> | null = null
let startedAt = 0
let pendingNote: NoteEvent | null = null
let padRect: WechatMiniprogram.BoundingClientRectCallbackResult | null = null
let soundRect: WechatMiniprogram.BoundingClientRectCallbackResult | null = null
let soundTouchX = 0
let touching = false

Component({
  data: {
    topInset: 52, bottomInset: 24, discSize: 200,
    libraryButtonTop: 52, libraryButtonRight: 104, libraryButtonSize: 32,
    instrument: 'piano' as InstrumentId, instrumentName: '钢琴',
    instruments: INSTRUMENTS, soundPosition: 50, isSoundDragging: false,
    keys: Array.from({ length: RING_KEYS }, (_, index) => {
      const degrees = index === RING_KEYS - 1 ? 90 : 120 + index * 30
      const angle = degrees * Math.PI / 180
      return { ...shiftedKey(index), polygon: keyPolygon(index), drumLabel: DRUM_SOUNDS[DRUM_KEY_ORDER[index]].name, drumIconIndex: DRUM_KEY_ORDER[index],
        labelLeft: 50 + 42 * Math.cos(angle), labelTop: 50 + 42 * Math.sin(angle), labelRotation: degrees - 90 }
    }),
    tracks: Array.from({ length: 5 }, (_, id) => ({ id, instrument: null, name: '', octaveLabel: '', checked: false, loop: false, duration: 0, durationLabel: '—', notes: [], bars: [] })) as Track[],
    recordingTrackId: -1,
    midiDemoVersion: 0, libraryOpen: false, isScreenMoving: false, savedMixes: [] as SavedMix[], selectedMixId: '', libraryError: '',
    swipedMixId: '', mixSwipeOffset: 0, isMixSwiping: false,
    showSaveDialog: false, saveName: '', saveError: '', isSaving: false,
    saveFlight: null as SaveFlight | null, libraryGlow: false,
    octaveLetters: ['L', 'M', 'H'],
    octaveNames: ['低', '中', '高'], octaveIndex: 1, vibrato: false,
    activeIndex: -1, activeNote: '', isRecording: false, isPlaying: false, isLooping: false,
    hasTracks: false, progress: 0, playbackProgress: [-1, -1, -1, -1, -1], elapsedLabel: '0.0s', timelineSeconds: 16,
  },
  lifetimes: {
    attached() {
      soundRect = null
      try { if ((wx as any).setInnerAudioOption) (wx as any).setInnerAudioOption({ obeyMuteSwitch: false }) } catch (_) {}
      this.loadLibrary()
      this.seedTestMix()
      this.seedMidiMix()
      const info = wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      this.setData({
        topInset: Math.max(info.statusBarHeight + 4, menu.top || 0),
        libraryButtonTop: menu.top || info.statusBarHeight + 4,
        libraryButtonRight: menu.left ? info.windowWidth - menu.left + 8 : 104,
        libraryButtonSize: menu.height || 32,
        bottomInset: Math.max(18, info.screenHeight - ((info.safeArea && info.safeArea.bottom) || info.screenHeight)),
      })
    },
    ready() { this.measureKeys() },
    detached() {
      this.clearSaveEffect()
      this.pauseSession()
      if (context && context.close) context.close()
      context = null
      vibratoStartedAt = null
    },
  },
  pageLifetimes: {
    hide() { this.clearSaveEffect(); this.pauseSession() },
    resize() { this.measureKeys() },
  },
  methods: {
    vibrate(type: 'light' | 'medium' | 'heavy' = 'light') {
      try { if ((wx as any).vibrateShort) (wx as any).vibrateShort({ type }) } catch (_) {}
    },
    onPageScroll() { if (!this.data.libraryOpen) this.measureKeys() },
    loadLibrary() {
      try {
        const stored = wx.getStorageSync(LIBRARY_KEY)
        if (!stored) { this.setData({ savedMixes: [], midiDemoVersion: 0, libraryError: '' }); return }
        if (stored.version !== 1 || !Array.isArray(stored.mixes)) throw new Error('Invalid library')
        const savedMixes: SavedMix[] = stored.mixes.map((mix: SavedMix) => {
          if (!mix || typeof mix.id !== 'string' || !mix.id || typeof mix.name !== 'string' || !mix.name.trim()) throw new Error('Invalid mix')
          const tracks = restoreTracks(mix.tracks)
          if (stored.soundLayoutVersion !== 2) tracks.forEach(track => {
            if (track.instrument === 'drums') {
              track.notes.forEach(note => { note.index %= 9 })
              track.bars = noteBars(track.notes, track.duration)
            }
          })
          const duration = Math.max(...tracks.map(track => track.duration))
          if (!duration) throw new Error('Empty mix')
          return { id: mix.id, name: mix.name, tracks, duration, durationLabel: `${(duration / 1000).toFixed(1)}s` }
        })
        this.setData({ savedMixes, midiDemoVersion: stored.midiDemoVersion === 1 ? 1 : 0, libraryError: '' })
      } catch (_) {
        this.setData({ libraryError: '音轨库读取失败，请重新打开应用后重试' })
      }
    },
    seedMidiMix() {
      if (this.data.libraryError || this.data.midiDemoVersion === 1) return
      try {
        let fixture: any = null
        const fsManager = wx.getFileSystemManager()
        const candidatePaths = ['assets/demo-rainbow.json', '/assets/demo-rainbow.json']
        for (let i = 0; i < candidatePaths.length; i++) {
          try {
            const text = fsManager.readFileSync(candidatePaths[i], 'utf8') as string
            if (text) {
              fixture = JSON.parse(text)
              break
            }
          } catch (_) {}
        }
        if (!fixture) {
          try {
            if (typeof require === 'function') {
              fixture = require('../../assets/demo-rainbow.json')
            }
          } catch (_) {}
        }
        if (!fixture) throw new Error('demo-rainbow.json not found')
        const tracks = restoreTracks(fixture.tracks)
        const duration = Math.max(...tracks.map(track => track.duration))
        const mix: SavedMix = { id: fixture.id, name: fixture.name, tracks, duration, durationLabel: `${(duration / 1000).toFixed(1)}s` }
        const savedMixes = this.data.savedMixes.some(item => item.id === mix.id) ? this.data.savedMixes : [mix, ...this.data.savedMixes]
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: 1, mixes: savedMixes })
        this.setData({ savedMixes, midiDemoVersion: 1 })
      } catch (err) {
        console.error('seedMidiMix failed:', err)
        wx.showToast({ title: 'MIDI测试音轨添加失败', icon: 'none' })
      }
    },
    seedTestMix() {
      if (this.data.libraryError) return
      try {
        const stored = wx.getStorageSync(LIBRARY_KEY)
        if (stored && stored.demoVersion === DEMO_VERSION) return
        const duration = 90000
        const beat = 625 // 144 beats at 96 BPM = 90 seconds.
        // Original 36-bar arrangement: intro, theme, response, break, reprise, outro.
        const synth: NoteEvent[] = [], drums: NoteEvent[] = [], piano: NoteEvent[] = []
        const add = (notes: NoteEvent[], index: number, at: number, beats: number, octave: number, velocity: number, vibrato = false) => {
          const start = at * beat
          notes.push({ index, start, duration: Math.min(beats * beat, duration - start), octave, velocity,
            vibrato, vibratoAge: vibrato ? VIBRATO_READY : 0,
            vibratoPhase: vibrato ? (start / 1000 * VIBRATO_RATE * Math.PI * 2) % (Math.PI * 2) : 0 })
        }
        const chords = [[2, 6, 8], [0, 2, 6], [6, 8, 1], [1, 3, 7]]
        const motifs = [[8, 6, 2], [6, 2, 0], [8, 1, 8], [7, 3, 1]]
        // Preserve the synthesized percussion tails in the arrangement.
        const drum = (index: number, at: number, velocity: number) => add(drums, index, at, DRUM_SOUNDS[index].duration * 1000 / beat, 1, velocity)
        for (let bar = 0; bar < 36; bar++) {
          const at = bar * 4
          const intro = bar < 4, quiet = bar >= 20 && bar < 24, outro = bar >= 32
          const final = bar === 35
          const chordIndex = final ? 2 : bar % 4
          const chord = chords[chordIndex]
          const pianoLevel = intro || quiet ? .6 : .42
          add(piano, chord[0], at, final ? 3.4 : 1.6, 0, pianoLevel)
          add(piano, chord[1], at + .5, final ? 2.8 : 1.2, 1, pianoLevel * .75)
          add(piano, chord[2], at + 2, final ? 1.7 : 1.4, 1, pianoLevel * .85)
          if (!intro && !quiet) {
            const motif = motifs[chordIndex]
            if (final) add(synth, 6, at + .5, 3, 2, .48, true)
            else {
              const response = bar >= 12 && bar < 20
              const level = outro ? .45 : .6
              add(synth, motif[response ? 2 : 0], at + .5, .7, 2, level, true)
              add(synth, motif[1], at + 1.5, .7, 2, level * .85, true)
              if (!outro || bar % 2 === 0) add(synth, motif[response ? 0 : 2], at + 2.5, 1.1, 2, level, true)
            }
          }
          drum(8, at, intro || quiet || outro ? .5 : .8)
          if (!quiet && !final) {
            drum(0, at + 1, .43)
            drum(8, at + 2, .62)
            drum(0, at + 3, .5)
            for (let step = 0; step < 4; step++) drum(2, at + step + .5, step % 2 ? .16 : .23)
          }
          if ([4, 12, 24].includes(bar)) drum(4, at, .22)
          if (final) drum(2, at + 2, .15)
        }
        ;[synth, drums, piano].forEach(notes => notes.sort((a, b) => a.start - b.start))
        const tracks = restoreTracks(Array.from({ length: 5 }, (_, id) => ({
          instrument: ['synth', 'drums', 'piano'][id] || null, duration: id < 3 ? duration : 0,
          notes: [synth, drums, piano][id] || [],
        })))
        const mix: SavedMix = { id: 'demo-fathers-name-v1', name: '夜航 · 原创编曲测试（90秒）', tracks, duration, durationLabel: '90.0s' }
        const existing = this.data.savedMixes.some(item => item.id === mix.id)
        // A removed demo stays removed; only the existing built-in entry is upgraded.
        const savedMixes = existing ? this.data.savedMixes.map(item => item.id === mix.id ? mix : item)
          : (stored && stored.demoVersion) ? this.data.savedMixes : [...this.data.savedMixes, mix]
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: this.data.midiDemoVersion, mixes: savedMixes })
        this.setData({ savedMixes })
      } catch (_) {
        wx.showToast({ title: '测试音轨添加失败', icon: 'none' })
      }
    },
    onMixTouchStart(event: WechatMiniprogram.TouchEvent) {
      const touch = event.touches[0]
      if (!touch) return
      const id = String(event.currentTarget.dataset.id)
      if (id.startsWith('track:') && (this.data.isRecording || !this.data.tracks[Number(id.slice(6))] || !this.data.tracks[Number(id.slice(6))].notes.length)) return
      suppressMixTap = false
      const offset = this.data.swipedMixId === id ? this.data.mixSwipeOffset : 0
      this.setData({ swipedMixId: id, mixSwipeOffset: offset })
      mixGesture = { id, x: touch.clientX, y: touch.clientY, offset, axis: '' }
    },
    onMixTouchMove(event: WechatMiniprogram.TouchEvent) {
      const touch = event.touches[0]
      if (!mixGesture || !touch) return
      const dx = touch.clientX - mixGesture.x
      const dy = touch.clientY - mixGesture.y
      if (!mixGesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) mixGesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (!mixGesture.axis) return
      suppressMixTap = true
      if (mixGesture.axis === 'x') this.setData({ isMixSwiping: true, mixSwipeOffset: Math.max(-80, Math.min(0, mixGesture.offset + dx)) })
    },
    onMixTouchEnd() {
      if (mixGesture && mixGesture.axis === 'x') this.setData({ mixSwipeOffset: this.data.mixSwipeOffset < -32 ? -80 : 0 })
      mixGesture = null
      this.setData({ isMixSwiping: false })
    },
    closeMixSwipe() {
      mixGesture = null
      this.setData({ swipedMixId: '', mixSwipeOffset: 0, isMixSwiping: false })
    },
    deleteSavedMix(event: WechatMiniprogram.TouchEvent) {
      if (this.data.libraryError || this.data.isRecording || this.data.showSaveDialog) return
      const id = String(event.currentTarget.dataset.id)
      this.removeSavedMix(id)
    },
    removeSavedMix(id: string) {
      if (!this.data.savedMixes.some(item => item.id === id)) return
      const savedMixes = this.data.savedMixes.filter(item => item.id !== id)
      try {
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: this.data.midiDemoVersion, mixes: savedMixes })
        if (this.data.selectedMixId === id) this.pauseSession()
        this.setData({ savedMixes, selectedMixId: this.data.selectedMixId === id ? '' : this.data.selectedMixId })
        this.closeMixSwipe()
      } catch (_) {
        wx.showToast({ title: '删除失败，请重试', icon: 'none' })
      }
    },
    openLibrary() {
      if (this.data.isRecording || this.data.showSaveDialog || this.data.libraryOpen) return
      this.pauseSession()
      this.loadLibrary()
      padRect = null
      this.setData({ libraryOpen: true, isScreenMoving: false })
    },
    closeLibrary() {
      if (!this.data.libraryOpen) return
      padRect = null
      this.closeMixSwipe()
      this.setData({ libraryOpen: false, isScreenMoving: false }, () => this.measureKeys())
    },
    toggleLibrary() {
      if (this.data.libraryOpen) this.closeLibrary()
      else this.openLibrary()
    },
    onScreenTransitionEnd() {
      this.setData({ isScreenMoving: false })
      if (!this.data.libraryOpen) this.measureKeys()
    },
    openSaveDialog() {
      if (this.data.isRecording || !this.data.hasTracks) return
      this.onSoundEnd()
      this.onKeyEnd()
      if (this.data.isPlaying) this.stopPlayback()
      this.setData({ showSaveDialog: true, saveName: '', saveError: '' })
    },
    closeSaveDialog() {
      if (!this.data.isSaving) this.setData({ showSaveDialog: false, saveError: '' })
    },
    onSaveNameInput(event: WechatMiniprogram.Input) {
      this.setData({ saveName: event.detail.value, saveError: '' })
    },
    saveMix() {
      if (!this.data.showSaveDialog || this.data.isSaving || this.data.isRecording) return
      const name = this.data.saveName.trim()
      if (!name || name.length > 30) { this.setData({ saveError: '请输入 1–30 字的音轨名称' }); return }
      if (this.data.libraryError) { this.setData({ saveError: this.data.libraryError }); return }
      this.setData({ isSaving: true })
      try {
        const tracks = restoreTracks(this.data.tracks)
        const duration = Math.max(...tracks.map(track => track.duration))
        if (!duration) { this.setData({ saveError: '请先录制音轨' }); return }
        const mix: SavedMix = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, name, tracks, duration, durationLabel: `${(duration / 1000).toFixed(1)}s` }
        const savedMixes = [mix, ...this.data.savedMixes]
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: this.data.midiDemoVersion, mixes: savedMixes })
        this.setData({ savedMixes, selectedMixId: mix.id, showSaveDialog: false, saveName: '', saveError: '' })
        wx.hideKeyboard({ complete: () => this.animateSavedMix(name, tracks) })
      } catch (_) {
        this.setData({ saveError: '保存失败，请检查本机存储空间后重试' })
      } finally { this.setData({ isSaving: false }) }
    },
    animateSavedMix(name: string, tracks: Track[]) {
      this.clearSaveEffect()
      const effectId = saveEffectId
      this.createSelectorQuery().select('.track-panel').boundingClientRect().select('.library-button').boundingClientRect().exec(results => {
        if (effectId !== saveEffectId) return
        const source = results[0] as WechatMiniprogram.BoundingClientRectCallbackResult
        const target = results[1] as WechatMiniprogram.BoundingClientRectCallbackResult
        if (!source || !source.width || !target || !target.width) { this.setData({ libraryGlow: true }); return }
        this.setData({ saveFlight: {
          left: source.left, top: source.top, width: source.width, height: source.height,
          x: target.left + target.width / 2 - source.left - source.width / 2,
          y: target.top + target.height / 2 - source.top - source.height / 2,
          scale: target.width / Math.max(source.width, source.height), name, tracks,
        } })
      })
    },
    finishSaveFlight() {
      if (this.data.saveFlight) this.setData({ saveFlight: null, libraryGlow: true })
    },
    finishLibraryGlow() { this.setData({ libraryGlow: false }) },
    clearSaveEffect() {
      saveEffectId++
      this.setData({ saveFlight: null, libraryGlow: false })
    },
    selectSavedMix(event: WechatMiniprogram.TouchEvent) {
      if (suppressMixTap) { suppressMixTap = false; return }
      if (this.data.mixSwipeOffset) { this.closeMixSwipe(); return }
      if (this.data.isRecording || this.data.showSaveDialog) return
      const mix = this.data.savedMixes.find(item => item.id === event.currentTarget.dataset.id)
      if (!mix) return
      this.closeMixSwipe()
      this.pauseSession()
      const tracks = restoreTracks(mix.tracks)
      this.setData({ tracks, hasTracks: true, recordingTrackId: -1, selectedMixId: mix.id, elapsedLabel: mix.durationLabel, timelineSeconds: Math.max(LIMIT, mix.duration) / 1000, progress: 0 })
    },
    stopDialogEvent() {},
    setOctave(index: number) {
      if (!Number.isInteger(index) || index < 0 || index > 2 || index === this.data.octaveIndex) return
      this.vibrate('medium')
      this.onKeyEnd()
      this.setData({ octaveIndex: index, keys: this.data.keys.map((key, keyIndex) => ({ ...key, ...shiftedKey(keyIndex, index) })) })
    },
    cycleOctave() {
      this.setOctave((this.data.octaveIndex + 1) % 3)
    },
    toggleVibrato() {
      this.setVibrato({ detail: { value: !this.data.vibrato } })
    },
    setVibrato(event: { detail: { value: boolean } }) {
      if (this.data.instrument !== 'synth' || this.data.vibrato === event.detail.value) return
      this.vibrate('light')
      const audioCtx = this.getAudioContext()
      vibratoStartedAt = event.detail.value ? (audioCtx && audioCtx.currentTime !== undefined ? audioCtx.currentTime : null) : null
      const activeIndex = this.data.activeIndex
      this.setData({ vibrato: event.detail.value })
      if (activeIndex >= 0) this.playKey(activeIndex)
    },
    setInstrument(index: number) {
      if (this.data.isRecording || this.data.isPlaying || !INSTRUMENTS[index]) return
      const instrument = INSTRUMENTS[index]
      if (instrument.id !== this.data.instrument) {
        this.vibrate('medium')
        this.onKeyEnd()
        if (liveSynthVoice) liveSynthVoice.stop()
        liveSynthVoice = null
      }
      this.setData({ instrument: instrument.id, instrumentName: instrument.name, soundPosition: index * 50, keys: this.data.keys.map((key, keyIndex) => ({ ...key, ...shiftedKey(keyIndex, this.data.octaveIndex) })) })
    },
    selectInstrument(event: WechatMiniprogram.TouchEvent) {
      this.setInstrument(Number(event.currentTarget.dataset.index))
    },
    cycleInstrument() {
      const index = INSTRUMENTS.findIndex(item => item.id === this.data.instrument)
      this.setInstrument((index + 1) % INSTRUMENTS.length)
    },
    onSoundStart(event: WechatMiniprogram.TouchEvent) {
      if (this.data.isRecording || this.data.isPlaying || !event.touches[0]) return
      soundTouchX = event.touches[0].clientX
      this.setData({ isSoundDragging: true })
      this.createSelectorQuery().select('.sound-rail').boundingClientRect().exec(results => {
        soundRect = results[0] || null
        if (this.data.isSoundDragging) this.updateSoundPosition()
      })
    },
    onSoundMove(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.isSoundDragging || !event.touches[0]) return
      soundTouchX = event.touches[0].clientX
      this.updateSoundPosition()
    },
    updateSoundPosition() {
      if (!soundRect || !soundRect.width || this.data.isRecording || this.data.isPlaying) return
      const position = Math.max(0, Math.min(100, (soundTouchX - soundRect.left) / soundRect.width * 100))
      this.setInstrument(Math.round(position / 50))
      this.setData({ soundPosition: position })
    },
    onSoundEnd() {
      const index = INSTRUMENTS.findIndex(item => item.id === this.data.instrument)
      this.setData({ isSoundDragging: false, soundPosition: index * 50 })
    },
    measureKeys() {
      this.createSelectorQuery().select('.disc-panel').boundingClientRect().exec(results => {
        const area = results[0]
        if (!area || !area.width || !area.height) return
        const discSize = Math.max(0, Math.floor(Math.min(420, area.width - 40, area.height - 16)))
        const measurePad = () => this.createSelectorQuery().select('.touch-disc').boundingClientRect().exec(rects => {
          padRect = rects[0] || null
        })
        if (discSize !== this.data.discSize) {
          padRect = null
          this.setData({ discSize }, measurePad)
        } else measurePad()
      })
    },
    handlePadTouches(event: WechatMiniprogram.TouchEvent, isStart: boolean) {
      if (!padRect) return
      const touches = event.touches || []
      if (!touches.length) {
        touching = false
        this.releaseKey()
        return
      }
      const candidateTouches = isStart && event.changedTouches && event.changedTouches.length ? event.changedTouches : touches
      if (isStart && this.data.instrument === 'drums' && candidateTouches.length > 1) {
        for (let i = 0; i < candidateTouches.length; i++) {
          const t = candidateTouches[i]
          const x = (t.clientX - padRect.left - padRect.width / 2) / (padRect.width / 2)
          const y = (t.clientY - padRect.top - padRect.height / 2) / (padRect.height / 2)
          const k = padKeyAt(x, y)
          if (k >= 0) this.playKey(k)
        }
        return
      }
      let targetIndex = -1
      for (let i = candidateTouches.length - 1; i >= 0; i--) {
        const t = candidateTouches[i]
        const x = (t.clientX - padRect.left - padRect.width / 2) / (padRect.width / 2)
        const y = (t.clientY - padRect.top - padRect.height / 2) / (padRect.height / 2)
        const k = padKeyAt(x, y)
        if (k >= 0) {
          targetIndex = k
          break
        }
      }
      if (targetIndex < 0 && candidateTouches !== touches) {
        for (let i = touches.length - 1; i >= 0; i--) {
          const t = touches[i]
          const x = (t.clientX - padRect.left - padRect.width / 2) / (padRect.width / 2)
          const y = (t.clientY - padRect.top - padRect.height / 2) / (padRect.height / 2)
          const k = padKeyAt(x, y)
          if (k >= 0) {
            targetIndex = k
            break
          }
        }
      }
      if (targetIndex === this.data.activeIndex) return
      if (targetIndex >= 0) this.playKey(targetIndex)
      else if (!touches.some(t => {
        const x = (t.clientX - padRect.left - padRect.width / 2) / (padRect.width / 2)
        const y = (t.clientY - padRect.top - padRect.height / 2) / (padRect.height / 2)
        return padKeyAt(x, y) >= 0
      })) {
        this.releaseKey()
      }
    },
    onPadStart(event: WechatMiniprogram.TouchEvent) {
      if (this.data.libraryOpen || this.data.isScreenMoving || this.data.showSaveDialog) return
      touching = true
      if (!padRect) {
        this.createSelectorQuery().select('.touch-disc').boundingClientRect().exec(results => {
          padRect = results[0] || null
          if (touching) this.handlePadTouches(event, true)
        })
      } else this.handlePadTouches(event, true)
    },
    onKeyMove(event: WechatMiniprogram.TouchEvent) {
      if (!touching || !padRect) return
      this.handlePadTouches(event, false)
    },
    onKeyEnd(event?: WechatMiniprogram.TouchEvent) {
      if (!event || !event.touches || !event.touches.length) {
        touching = false
        this.releaseKey()
        return
      }
      this.handlePadTouches(event, false)
    },
    releaseKey() {
      this.finishNote()
      if (liveVoice && !liveVoice.oneShot) {
        if (liveVoice.release) liveVoice.release()
        else liveVoice.stop()
      }
      liveVoice = null
      this.setData({ activeIndex: -1, activeNote: '' })
    },
    playKey(index: number) {
      if ((this.data.isPlaying && !this.data.isRecording) || this.data.libraryOpen || this.data.showSaveDialog || !this.data.keys[index]) return
      const reuseSynth = this.data.instrument === 'synth' && liveSynthVoice && activeVoices.has(liveSynthVoice)
      if (reuseSynth) this.finishNote()
      else this.releaseKey()
      const audio = this.getAudioContext()
      if (!audio) return
      const key = this.data.keys[index]
      const voiceIndex = this.data.instrument === 'drums' ? DRUM_KEY_ORDER[index] : index
      const midiNote = this.data.instrument === 'drums' ? undefined : shiftedPitch(index, this.data.octaveIndex)
      const hasVibrato = this.data.instrument === 'synth' && this.data.vibrato
      if (hasVibrato && vibratoStartedAt === null) vibratoStartedAt = audio.currentTime
      const vibratoAge = hasVibrato ? Math.max(0, Math.min(VIBRATO_READY, audio.currentTime - vibratoStartedAt!)) : 0
      try {
        const remaining = this.data.instrument === 'drums' && this.data.isRecording ? Math.max(0, LIMIT - (Date.now() - startedAt)) / 1000 : undefined
        if (reuseSynth) {
          liveSynthVoice!.retune!(index, this.data.octaveIndex, this.data.vibrato, vibratoAge, midiNote)
          liveVoice = liveSynthVoice
        } else {
          liveVoice = this.createVoice(this.data.instrument, voiceIndex, this.data.octaveIndex, this.data.vibrato, audio.currentTime, remaining, vibratoAge, 0, 1, midiNote)
          if (this.data.instrument === 'synth') liveSynthVoice = liveVoice
        }
      } catch (_) {
        wx.showToast({ title: '音色加载失败，请重试', icon: 'none' })
        return
      }
      this.setData({ activeIndex: index, activeNote: this.data.instrument === 'drums' ? key.drumLabel : key.pitchLabel })
      if (this.data.isRecording) {
        const vPhase = liveVoice && liveVoice.vibratoPhase ? liveVoice.vibratoPhase() : 0
        pendingNote = { index: voiceIndex, start: Math.min(LIMIT, Date.now() - startedAt), duration: 0, octave: this.data.octaveIndex, vibrato: hasVibrato, vibratoAge, vibratoPhase: vPhase !== undefined ? vPhase : 0, ...(midiNote === undefined ? {} : { midiNote }) }
      }
    },
    getAudioContext(): any {
      try {
        if (!context) context = (wx as any).createWebAudioContext()
        if (context && context.resume) context.resume()
        return context
      } catch (_) {
        wx.showToast({ title: '当前微信版本暂不支持合成音频', icon: 'none' })
        return null
      }
    },
    createDrumVoice(index: number, when: number, duration?: number, velocity = 1): Voice {
      const sound = DRUM_SOUNDS[index]
      const length = Math.max(.01, Math.min(sound.duration, duration === undefined ? sound.duration : duration))
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      const metallic = sound.kind === 'metal'
      const noisy = metallic || sound.kind === 'snare'
      filter.type = noisy ? 'highpass' : 'lowpass'
      filter.frequency.setValueAtTime(metallic ? 5000 : noisy ? 700 : 1800, when)
      filter.Q.value = .7
      filter.connect(gain)
      gain.connect(context.destination)
      const sources: any[] = []
      const nodes: any[] = [filter, gain]
      if (noisy) {
        // Dense, phase-scattered harmonics on two unrelated fundamentals approximate
        // noise without AudioBuffer or any file decoding on the native audio bridge.
        const real = new Float32Array(257)
        const imag = new Float32Array(257)
        for (let harmonic = 1; harmonic < imag.length; harmonic++) {
          const phase = harmonic * harmonic * 2.399963
          real[harmonic] = Math.cos(phase)
          imag[harmonic] = Math.sin(phase)
        }
        const wave = context.createPeriodicWave(real, imag)
        for (const ratio of [1, 1.481]) {
          const noise = context.createOscillator()
          noise.setPeriodicWave(wave)
          noise.frequency.setValueAtTime(sound.frequency * .137 * ratio, when)
          noise.connect(filter)
          sources.push(noise)
          nodes.push(noise)
        }
      }
      if (!metallic) {
        const body = context.createOscillator()
        const bodyGain = context.createGain()
        body.type = 'sine'
        body.frequency.setValueAtTime(sound.frequency * (sound.kind === 'kick' ? 3 : 1.5), when)
        body.frequency.exponentialRampToValueAtTime(sound.frequency, when + Math.min(.08, length))
        bodyGain.gain.setValueAtTime(noisy ? .5 : 1, when)
        body.connect(bodyGain)
        bodyGain.connect(noisy ? gain : filter)
        sources.push(body)
        nodes.push(body, bodyGain)
      }
      const level = sound.level * velocity
      const attack = Math.min(.002, length)
      const levelAt = (seconds: number) => seconds < attack
        ? level * seconds / attack : level * Math.exp(-6 * (seconds - attack) / length)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(level, when + attack)
      gain.gain.exponentialRampToValueAtTime(levelAt(length), when + length)
      const voice = this.manageMelodicVoice(sources, nodes, gain, when, length, .012, levelAt)
      voice.oneShot = true
      return voice
    },
    stopVoices() {
      liveSynthVoice = null
      activeVoices.forEach(voice => voice.stop())
      activeVoices.clear()
    },
    manageMelodicVoice(sources: any[], nodes: any[], gain: any, when: number, length: number, releaseTime: number, levelAt: (seconds: number) => number): Voice {
      const audio = context
      let ended = false
      let released = false
      const cleanup = () => {
        if (ended) return
        ended = true
        sources.forEach(source => { try { source.stop(audio.currentTime) } catch (_) { /* source already ended */ } })
        nodes.forEach(node => node.disconnect())
        activeVoices.delete(voice)
      }
      const voice: Voice = {
        stop() { cleanup() },
        release() {
          if (ended || released) return
          released = true
          const now = audio.currentTime
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(levelAt(Math.max(0, now - when)), now)
          gain.gain.linearRampToValueAtTime(0, now + releaseTime)
          sources.forEach(source => { try { source.stop(now + releaseTime) } catch (_) { /* source already ended */ } })
        },
      }
      if (Number.isFinite(length)) {
        gain.gain.setValueAtTime(levelAt(length), when + length)
        gain.gain.linearRampToValueAtTime(0, when + length + releaseTime)
      }
      sources[0].onended = cleanup
      activeVoices.add(voice)
      sources.forEach(source => {
        source.start(when)
        if (Number.isFinite(length)) source.stop(when + length + releaseTime)
      })
      return voice
    },
    createPianoVoice(index: number, octave: number, when: number, duration?: number, velocity = 1, midiNote?: number): Voice {
      const frequency = midiNote === undefined ? FREQUENCIES[index] * [0.5, 1, 2][octave] : 440 * Math.pow(2, (midiNote - 69) / 12)
      const source = context.createOscillator()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      const naturalLength = Math.max(1.2, Math.min(4, 3 * Math.sqrt(261.63 / frequency)))
      const length = Math.max(.01, Math.min(duration === undefined ? naturalLength : duration, naturalLength))
      source.setPeriodicWave(context.createPeriodicWave(
        new Float32Array(9), new Float32Array([0, 1, .45, .22, .12, .07, .04, .025, .015]),
      ))
      source.frequency.setValueAtTime(frequency, when)
      filter.type = 'lowpass'
      filter.Q.value = .5
      filter.frequency.setValueAtTime(Math.min(12000, frequency * 12), when)
      filter.frequency.exponentialRampToValueAtTime(Math.min(6000, frequency * 2), when + naturalLength)
      source.connect(filter)
      filter.connect(gain)
      gain.connect(context.destination)
      const level = INSTRUMENT_LEVELS.piano * velocity
      const levelAt = (seconds: number) => seconds < .004
        ? level * seconds / .004 : level * Math.exp(-5 * (seconds - .004) / naturalLength)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(level, when + .004)
      gain.gain.exponentialRampToValueAtTime(levelAt(length), when + length)
      return this.manageMelodicVoice([source], [source, filter, gain], gain, when, length, .18, levelAt)
    },
    createSynthVoice(index: number, octave: number, when: number, duration?: number, vibrato = false, vibratoAge = 0, vibratoPhase = 0, velocity = 1, midiNote?: number): Voice {
      const frequency = midiNote === undefined ? FREQUENCIES[index] * [0.5, 1, 2][octave] : 440 * Math.pow(2, (midiNote - 69) / 12)
      const lead = context.createOscillator()
      const body = context.createBiquadFilter()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      const length = Math.max(.01, duration !== undefined ? duration : Infinity)
      lead.type = 'square'
      lead.frequency.setValueAtTime(frequency, when)
      lead.detune.setValueAtTime(0, when)
      filter.type = 'lowpass'
      filter.Q.value = .7
      // Keep the full square-wave body with vibrato on or off.
      // Speaker-like rolloff softens the edge without thinning the fundamental.
      filter.frequency.setValueAtTime(3200, when)
      // Broad midrange resonance approximates a small speaker's nasal body.
      body.type = 'peaking'
      body.frequency.setValueAtTime(900, when)
      body.Q.value = .65
      body.gain.value = 3
      lead.connect(body)
      body.connect(filter)
      filter.connect(gain)
      gain.connect(context.destination)
      const level = INSTRUMENT_LEVELS.synth * velocity
      const levelAt = (seconds: number) => level * Math.min(1, seconds / .003)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(levelAt(Math.min(.003, length)), when + Math.min(.003, length))
      const sources = [lead]
      const nodes = [lead, body, filter, gain]
      const continuous = duration === undefined
      let depth: any = null
      let effectOn = vibrato
      const setDepth = (enabled: boolean, age: number, at: number) => {
        if (!depth) return
        const amount = enabled ? VIBRATO_DEPTH_CENTS : 0
        const strength = Math.max(0, Math.min(1, (age - VIBRATO_DELAY) / VIBRATO_FADE))
        depth.gain.cancelScheduledValues(at)
        if (!enabled) {
          depth.gain.setValueAtTime(depth.gain.value, at)
          depth.gain.linearRampToValueAtTime(0, at + .01)
          return
        }
        depth.gain.setValueAtTime(amount * strength, at)
        if (age < VIBRATO_DELAY) depth.gain.setValueAtTime(0, at + VIBRATO_DELAY - age)
        if (age < VIBRATO_READY) depth.gain.linearRampToValueAtTime(amount, at + VIBRATO_READY - age)
      }
      if (vibrato || continuous) {
        const lfo = context.createOscillator()
        depth = context.createGain()
        depth.gain.value = 0
        lfo.type = 'sine'
        if (vibratoPhase) lfo.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, Math.sin(vibratoPhase)]), new Float32Array([0, Math.cos(vibratoPhase)])))
        lfo.frequency.value = VIBRATO_RATE
        setDepth(vibrato, vibratoAge, when)
        lfo.connect(depth)
        depth.connect(lead.detune)
        sources.push(lfo)
        nodes.push(lfo, depth)
      }
      const voice = this.manageMelodicVoice(sources, nodes, gain, when, length, .018, levelAt)
      if (continuous) {
        voice.vibratoPhase = () => (Math.max(0, context.currentTime - when) * VIBRATO_RATE * Math.PI * 2) % (Math.PI * 2)
        let open = true
        let gateAt = when, gateEnd = when + .003, gateFrom = 0, gateTo = level
        const gate = (target: number, ramp: number) => {
          const now = context.currentTime
          const fraction = Math.max(0, Math.min(1, (now - gateAt) / Math.max(.001, gateEnd - gateAt)))
          const current = gateFrom + (gateTo - gateFrom) * fraction
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(current, now)
          gain.gain.linearRampToValueAtTime(target, now + ramp)
          gateAt = now; gateEnd = now + ramp; gateFrom = current; gateTo = target
        }
        voice.release = () => { if (open) { gate(0, .018); open = false } }
        voice.retune = (nextIndex, octave, enabled, age, nextMidiNote) => {
          const now = context.currentTime
          lead.frequency.setValueAtTime(nextMidiNote === undefined ? FREQUENCIES[nextIndex] * [0.5, 1, 2][octave] : 440 * Math.pow(2, (nextMidiNote - 69) / 12), now)
          if (enabled || enabled !== effectOn) { setDepth(enabled, age, now); effectOn = enabled }
          if (!open) { gate(level, .003); open = true }
        }
      }
      return voice
    },
    createVoice(instrument: InstrumentId, index: number, octave: number, vibrato: boolean, when: number, duration?: number, vibratoAge = 0, vibratoPhase = 0, velocity = 1, midiNote?: number): Voice {
      if (instrument === 'drums') return this.createDrumVoice(index, when, duration, velocity)
      if (instrument === 'piano') return this.createPianoVoice(index, octave, when, duration, velocity, midiNote)
      return this.createSynthVoice(index, octave, when, duration, vibrato, vibratoAge, vibratoPhase, velocity, midiNote)
    },
    finishNote() {
      if (!pendingNote) return
      const note = pendingNote
      pendingNote = null
      note.duration = this.data.instrument === 'drums'
        ? Math.min(DRUM_SOUNDS[note.index].duration * 1000, LIMIT - note.start)
        : Math.max(0, Math.min(LIMIT, Date.now() - startedAt) - note.start)
      if (note.duration <= 0) return
      const tracks = this.data.tracks.map(track => track.id === this.data.recordingTrackId ? { ...track, notes: [...track.notes, note] } : track)
      this.setData({ tracks })
      this.updateRecording()
    },
    updateRecording() {
      const elapsed = Math.min(LIMIT, Date.now() - startedAt)
      const tracks = this.data.tracks.map(track => {
        if (track.id !== this.data.recordingTrackId) return track
        const notes = pendingNote ? [...track.notes, { ...pendingNote, duration: elapsed - pendingNote.start }] : track.notes
        const octaveLabel = trackRange(notes) || track.octaveLabel
        return { ...track, octaveLabel, duration: elapsed, durationLabel: `${(elapsed / 1000).toFixed(1)}s`, bars: noteBars(notes) }
      })
      this.setData({ tracks, progress: elapsed / LIMIT * 100, elapsedLabel: `${(elapsed / 1000).toFixed(1)}s` })
    },
    toggleRecording() {
      if (this.data.isRecording) { this.stopRecording(); return }
      this.startRecording()
    },
    startRecording() {
      this.onSoundEnd()
      if (this.data.isRecording || this.data.libraryOpen || this.data.showSaveDialog || !this.getAudioContext()) return
      const target = this.data.tracks.find(track => !track.notes.length)
      if (!target) {
        wx.showToast({ title: '已满五条，请先左滑删除一条', icon: 'none' })
        return
      }
      this.closeMixSwipe()
      this.onKeyEnd()
      this.vibrate('medium')
      if (!this.data.isPlaying) this.stopVoices()
      startedAt = Date.now()
      const tracks = this.data.tracks.map(track => track.id === target.id ? {
        ...track, instrument: this.data.instrument, name: this.data.instrumentName,
        octaveLabel: this.data.octaveLetters[this.data.octaveIndex],
        notes: [], bars: [], duration: 0, durationLabel: '0.0s',
      } : track)
      this.setData({ isRecording: true, timelineSeconds: LIMIT / 1000, selectedMixId: '', recordingTrackId: target.id, progress: 0, elapsedLabel: '0.0s', tracks, hasTracks: tracks.some(track => track.notes.length > 0) })
      timer = setInterval(() => {
        this.updateRecording()
        if (Date.now() - startedAt >= LIMIT) this.stopRecording()
      }, 80)
    },
    stopRecording() {
      if (!this.data.isRecording) return
      this.vibrate('medium')
      this.onKeyEnd()
      this.updateRecording()
      this.clearTimer()
      const tracks = this.data.tracks.map(track => {
        if (track.id !== this.data.recordingTrackId) return track
        const duration = Math.max(track.duration, ...track.notes.map(note => note.start + note.duration))
        if (!track.notes.length) return { ...track, instrument: null, name: '', octaveLabel: '', duration: 0, durationLabel: '—', checked: false, loop: false }
        return { ...track, checked: true, duration, durationLabel: `${(duration / 1000).toFixed(1)}s` }
      })
      this.setData({ isRecording: false, recordingTrackId: -1, tracks, hasTracks: tracks.some(track => track.notes.length > 0) })
    },
    dismissTrackSwipe() {
      if (suppressMixTap) { suppressMixTap = false; return }
      this.closeMixSwipe()
    },
    toggleTrack(event: WechatMiniprogram.TouchEvent) {
      if (suppressMixTap) { suppressMixTap = false; return }
      if (this.data.mixSwipeOffset) { this.closeMixSwipe(); return }
      if (this.data.isRecording || this.data.isPlaying || this.data.showSaveDialog) return
      const id = Number(event.currentTarget.dataset.id)
      this.vibrate('light')
      const tracks = this.data.tracks.map(track => track.id === id && track.notes.length ? { ...track, checked: !track.checked } : track)
      this.setData({ tracks })
    },
    deleteTrack(event: WechatMiniprogram.TouchEvent) {
      if (this.data.isRecording || this.data.showSaveDialog) return
      const id = Number(event.currentTarget.dataset.id)
      if (!this.data.tracks.some(track => track.id === id && track.notes.length)) return
      if (this.data.isPlaying) this.stopPlayback()
      const loop = trackLoops.get(id)
      if (loop && loop.voices) loop.voices.forEach(voice => voice.stop())
      trackLoops.delete(id)
      const tracks = this.data.tracks.map(track => track.id === id ? {
        id, instrument: null, name: '', octaveLabel: '', checked: false, loop: false,
        duration: 0, durationLabel: '—', notes: [], bars: [],
      } : track)
      this.setData({ tracks, selectedMixId: '', hasTracks: tracks.some(track => track.notes.length > 0),
        timelineSeconds: Math.max(LIMIT, ...tracks.map(track => track.duration)) / 1000 })
      if (!trackLoops.size) this.stopTrackLoops()
      else this.updateTrackLoops()
      this.closeMixSwipe()
    },
    deleteCurrent() {
      if (this.data.isRecording || this.data.showSaveDialog) return
      const savedId = this.data.libraryOpen ? this.data.selectedMixId : ''
      if (this.data.libraryOpen && !savedId || !this.data.libraryOpen && !this.data.hasTracks) return
      wx.showModal({
        title: this.data.libraryOpen ? '删除已保存音轨？' : '删除当前全部音轨？',
        content: '删除后无法恢复',
        confirmColor: '#a94c30',
        success: result => {
          if (!result.confirm) return
          if (savedId) { this.removeSavedMix(savedId); return }
          this.pauseSession()
          const tracks = this.data.tracks.map((_, id) => ({
            id, instrument: null, name: '', octaveLabel: '', checked: false, loop: false,
            duration: 0, durationLabel: '—', notes: [], bars: [],
          })) as Track[]
          this.setData({ tracks, selectedMixId: '', recordingTrackId: -1, hasTracks: false,
            elapsedLabel: '0.0s', timelineSeconds: LIMIT / 1000, progress: 0 })
        },
      })
    },
    toggleTrackLoop(event: WechatMiniprogram.TouchEvent) {
      if (suppressMixTap) { suppressMixTap = false; return }
      if (this.data.mixSwipeOffset) { this.closeMixSwipe(); return }
      if (this.data.isRecording || this.data.isPlaying || this.data.showSaveDialog) return
      const id = Number(event.currentTarget.dataset.id)
      this.vibrate('light')
      this.setData({ tracks: this.data.tracks.map(track => track.id === id && track.notes.length ? { ...track, loop: !track.loop } : track) })
    },
    updateTrackLoops() {
      const now = context.currentTime
      try {
        trackLoops.forEach((state, id) => {
          const track = this.data.tracks.find(item => item.id === id)!
          const period = Math.max(.05, track.duration / 1000)
          state.voices = state.voices.filter(voice => activeVoices.has(voice))
          if (state.next < now) state.next += Math.ceil((now - state.next) / period) * period
          while (state.next <= now + .1) {
            track.notes.forEach(note => state.voices.push(this.createVoice(
              track.instrument!,
              note.index,
              note.octave,
              note.vibrato,
              state.next + note.start / 1000,
              note.duration / 1000,
              note.vibratoAge !== undefined ? note.vibratoAge : VIBRATO_READY,
              note.vibratoPhase !== undefined ? note.vibratoPhase : 0,
              note.velocity !== undefined ? note.velocity : 1,
              note.midiNote
            )))
            state.next += period
          }
        })
      } catch (_) {
        this.stopPlayback()
        wx.showToast({ title: '音轨播放失败，请重试', icon: 'none' })
      }
    },
    togglePlayback() {
      this.vibrate('medium')
      if (this.data.isPlaying) { this.stopPlayback(); return }
      if (this.data.isRecording || this.data.showSaveDialog) return
      const tracks = this.data.tracks.filter(track => track.checked && track.notes.length > 0)
      if (!tracks.length) { wx.showToast({ title: '请先勾选要播放的音轨', icon: 'none' }); return }
      this.closeMixSwipe()
      this.stopPlayback()
      const audio = this.getAudioContext()
      if (!audio) return
      this.onKeyEnd()
      this.stopVoices()
      const when = audio.currentTime + .05
      const span = Math.max(LIMIT, ...tracks.map(track => track.duration))
      const duration = Math.max(...tracks.map(track => track.duration + (track.instrument === 'piano' ? 180 : track.instrument === 'synth' ? 18 : 0)))
      tracks.filter(track => !track.loop).forEach(track => track.notes.forEach(note => {
        playbackVoices.push(this.createVoice(
          track.instrument!,
          note.index,
          note.octave,
          note.vibrato,
          when + note.start / 1000,
          note.duration / 1000,
          note.vibratoAge !== undefined ? note.vibratoAge : VIBRATO_READY,
          note.vibratoPhase !== undefined ? note.vibratoPhase : 0,
          note.velocity !== undefined ? note.velocity : 1,
          note.midiNote
        ))
      }))
      tracks.filter(track => track.loop).forEach(track => trackLoops.set(track.id, { start: when, next: when, voices: [] }))
      this.setData({ isPlaying: true, isLooping: trackLoops.size > 0, timelineSeconds: span / 1000, progress: 0, playbackProgress: this.data.tracks.map(track => track.checked && track.notes.length ? 0 : -1), elapsedLabel: '0.0s' })
      if (trackLoops.size) this.updateTrackLoops()
      if (!this.data.isPlaying) return
      playbackTimer = setInterval(() => {
        if (trackLoops.size) this.updateTrackLoops()
        if (!this.data.isPlaying) return
        const elapsed = Math.max(0, (audio.currentTime - when) * 1000)
        const playbackProgress = this.data.tracks.map(track => {
          if (!tracks.some(playing => playing.id === track.id) || (!track.loop && elapsed >= track.duration)) return -1
          const position = track.loop ? elapsed % Math.max(50, track.duration) : elapsed
          return position / Math.max(LIMIT, track.duration) * 100
        })
        this.setData({ playbackProgress, ...(!this.data.isRecording ? { progress: Math.min(100, elapsed / span * 100), elapsedLabel: `${((trackLoops.size ? elapsed : Math.min(elapsed, duration)) / 1000).toFixed(1)}s`, timelineSeconds: span / 1000 } : {}) })
        if (!trackLoops.size && elapsed >= duration + 40) this.stopPlayback()
      }, 25)
    },
    stopPlayback() {
      if (playbackTimer !== null) clearInterval(playbackTimer)
      playbackTimer = null
      playbackVoices.forEach(voice => voice.stop())
      playbackVoices = []
      this.stopTrackLoops()
      this.setData({ isPlaying: false, ...(!this.data.isRecording ? { progress: 0 } : {}), playbackProgress: [-1, -1, -1, -1, -1] })
    },
    stopTrackLoops() {
      trackLoops.forEach(state => state.voices.forEach(voice => voice.stop()))
      trackLoops.clear()
      this.setData({ isLooping: false, playbackProgress: [-1, -1, -1, -1, -1] })
    },
    clearTimer() { if (timer !== null) clearInterval(timer); timer = null },
    pauseSession() {
      this.onSoundEnd()
      if (this.data.isRecording) this.stopRecording()
      this.stopPlayback()
      this.onKeyEnd()
      this.stopVoices()
    },
  },
})
