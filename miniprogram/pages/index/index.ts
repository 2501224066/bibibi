type InstrumentId = 'drums' | 'piano' | 'synth'
type NoteEvent = { index: number; start: number; duration: number; octave: number; vibrato: boolean; vibratoAge?: number; vibratoPhase?: number; velocity?: number; midiNote?: number }
type Track = { id: number; instrument: InstrumentId | null; name: string; octaveLabel: string; selected: boolean; duration: number; durationLabel: string; notes: NoteEvent[]; bars: { id: number; left: number; width: number; top: number }[] }
type SavedMix = { id: string; name: string; duration: number; durationLabel: string; tracks: Track[] }
const GUIDE_KEY = 'bibibi.guide.v1'
const GUIDE_MELODY = [[0, 1], [1, 1], [2, 1], [0, 1], [0, 1], [1, 1], [2, 1], [0, 1], [2, 1], [3, 1], [4, 2], [2, 1], [3, 1], [4, 2]]
const GUIDE_STEPS = [
  { selector: '.tone-knob', action: 'tone', title: '音色旋钮：切换乐器', text: '点击 音色 切换一次音色，观察屏幕左下方的图标变化。' },
  { selector: '.range-knob', action: 'octave', title: '音域旋钮：切换高低音', text: '点击 音域，观察屏幕上的 L / M / H 音域标记变化。' },
  { selector: '.metronome-knob', action: 'metronome', title: '节拍旋钮：设置节奏', text: '点击节拍，在关闭、60、90、120 BPM 之间切换。听听节拍声，观察屏幕左下角的速度标记。节拍声不会录入作品。' },
  { selector: '.record-button', action: 'record', title: '录制按钮：开始录音', text: '点击红色录制按钮，开始记录方格演奏。' },
  { selector: '.disc-frame', action: 'melody', title: '音乐操作区', text: '点击方格或“示范”，自动弹奏一段《两只老虎》，看看音符与方格的对应关系。' },
  { selector: '.record-button', action: 'stop-record', title: '录制按钮：结束录音', text: '示范完成，请点击红色录制按钮结束录制。' },
  { selector: '.bottom-save', action: 'save', title: '保存按钮：保存刚录制的旋律', text: '点击保存，保存刚才录下的《两只老虎》。' },
  { selector: '.library-button', action: 'library', title: '音库按钮：查看已保存曲目', text: '点击亮起的音库按钮，看看可以试听的曲目。' },
  { selector: '.screen-library', action: 'rainbow', title: '曲目列表：选择作品', text: '点击曲目即可选中，请试着选择《彩虹》。' },
  { selector: '.mix-button', action: 'play', title: '播放按钮：播放或停止', text: '点击右侧播放按钮，听听完整的《彩虹》，观察音轨和实时音符。' },
]
type GuideRect = { left: number; top: number; width: number; height: number }
function guideMasks(width: number, height: number, holes: GuideRect[]): GuideRect[] {
  let masks = [{ left: 0, top: 0, width, height }]
  for (const hole of holes) {
    const next: GuideRect[] = []
    for (const mask of masks) {
      const left = Math.max(mask.left, hole.left), top = Math.max(mask.top, hole.top)
      const right = Math.min(mask.left + mask.width, hole.left + hole.width)
      const bottom = Math.min(mask.top + mask.height, hole.top + hole.height)
      if (right <= left || bottom <= top) { next.push(mask); continue }
      next.push(
        { left: mask.left, top: mask.top, width: mask.width, height: top - mask.top },
        { left: mask.left, top: bottom, width: mask.width, height: mask.top + mask.height - bottom },
        { left: mask.left, top, width: left - mask.left, height: bottom - top },
        { left: right, top, width: mask.left + mask.width - right, height: bottom - top },
      )
    }
    masks = next.filter(mask => mask.width > 0 && mask.height > 0)
  }
  return masks
}
const LIBRARY_KEY = 'peninsula-music-box.library.v1'
type Voice = { stop: () => void; release?: () => void; vibratoPhase?: () => number; retune?: (index: number, octave: number, vibrato: boolean, age: number, midiNote?: number) => void; oneShot?: boolean }
const TIMELINE_MIN_DURATION = 180000
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
const METRONOME_BPMS = [0, 60, 90, 120]
const PAD_CELLS = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5]
// Raised about 5 dB after device listening feedback; velocity remains linear.
const INSTRUMENT_LEVELS = { synth: .063, piano: .074 }
// Balance 20ms attacks and 100ms body energy; equal body RMS alone makes short hits too loud.
const DRUM_SOUNDS = [
  { name: '军鼓', kind: 'snare', frequency: 185, duration: .32, level: 0.068 },
  { name: '高通鼓', kind: 'tom', frequency: 220, duration: .55, level: 0.0744 },
  { name: '闭合踩镲', kind: 'metal', frequency: 410, duration: .12, level: 0.1013 },
  { name: '开放踩镲', kind: 'metal', frequency: 410, duration: .65, level: 0.0637 },
  { name: '吊镲', kind: 'metal', frequency: 295, duration: 1.8, level: 0.0556 },
  { name: '叮叮镲', kind: 'metal', frequency: 630, duration: 1.4, level: 0.0655 },
  { name: '中通鼓', kind: 'tom', frequency: 165, duration: .65, level: 0.0725 },
  { name: '落地通鼓', kind: 'tom', frequency: 110, duration: .8, level: 0.0691 },
  { name: '底鼓', kind: 'kick', frequency: 55, duration: .45, level: 0.0752 },
  { name: '军鼓Ⅱ', kind: 'snare', frequency: 240, duration: .22, level: 0.074 },
  { name: '吊镲Ⅱ', kind: 'metal', frequency: 345, duration: 2.1, level: 0.0541 },
  { name: '水镲', kind: 'metal', frequency: 520, duration: .8, level: 0.0643 },
]
const DIATONIC_STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19]
const NOTE_STEPS = DIATONIC_STEPS
// Keep drum sound indices stable as the physical layout changes.
// Recorded drum indices continue to identify sounds, independent of layout.
const DRUM_KEY_ORDER = [0, 1, 6, 7, 9, 8, 2, 3, 4, 5, 10, 11]
// Each entry is [pitch/key, start beat, length in beats]; melodic pitches can cross octaves.
const LOGO_DEMOS: Record<InstrumentId, number[][]> = {
  piano: [[4, 0, .95], [2, 1, .45], [4, 1.5, .45], [7, 2, 1.95], [5, 4, .95], [7, 5, .95], [4, 6, 1.95], [4, 8, .95], [0, 9, .45], [1, 9.5, .45], [2, 10, .95], [1, 11, .45], [0, 11.5, .45], [1, 12, 3.95]],
  synth: [[0, 0, .4], [4, .5, .4], [6, 1, .4], [4, 1.5, .4], [0, 2, .4], [2, 2.5, .4], [4, 3, .8], [6, 4, .4], [4, 4.5, .4], [2, 5, .4], [1, 5.5, .4], [2, 6, .8], [0, 7, 1.8]],
  drums: [[5, 0, .2], [6, 0, .2], [6, .5, .2], [0, 1, .2], [6, 1, .2], [6, 1.5, .2], [5, 2, .2], [6, 2, .2], [5, 2.5, .2], [6, 2.5, .2], [0, 3, .2], [6, 3, .2], [7, 3.5, .2], [5, 4, .2], [8, 4, .2], [1, 5, .2], [2, 5.5, .2], [5, 6, .2]],
}
const DIATONIC_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F', 'G']
const DIATONIC_OCTAVE_OFFSETS = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function shiftedKey(index: number, octave = 1) {
  const note = DIATONIC_NAMES[index]
  const oct = octave + 3 + DIATONIC_OCTAVE_OFFSETS[index]
  return { label: note, note, pitchLabel: `${note}${oct}` }
}
function shiftedPitch(index: number, octave: number): number {
  return 48 + octave * 12 + DIATONIC_STEPS[index]
}
const activeVoices = new Set<Voice>()
function padKeyAt(x: number, y: number, width = 0, height = 0): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || x >= 1 || y < -1 || y >= 1) return -1
  const gapX = width > 0 ? 8 / width : 0
  const gapY = height > 0 ? 8 / height : 0
  const cellWidth = (2 - gapX * 5) / 6
  const cellHeight = (2 - gapY) / 2
  if (cellWidth <= 0 || cellHeight <= 0) return -1
  const column = Math.floor((x + 1) / (cellWidth + gapX))
  const row = Math.floor((y + 1) / (cellHeight + gapY))
  if (x + 1 - column * (cellWidth + gapX) >= cellWidth || y + 1 - row * (cellHeight + gapY) >= cellHeight) return -1
  return PAD_CELLS[row * 6 + column]
}

function noteBars(notes: NoteEvent[], duration = TIMELINE_MIN_DURATION) {
  const span = Math.max(TIMELINE_MIN_DURATION, duration)
  const rawBars = notes.map((note, id) => ({
    id,
    left: note.start / span * 100,
    width: Math.min(100 - note.start / span * 100, note.duration / span * 100),
    top: (11 - note.index) / 12 * 100
  }))
  if (rawBars.length <= 150) return rawBars

  // For long MIDI tracks (>150 notes), merge visually adjacent bars on the same row
  // to avoid rendering thousands of redundant DOM nodes on the timeline.
  const byRow: { [top: number]: typeof rawBars } = {}
  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i]
    if (!byRow[b.top]) byRow[b.top] = []
    byRow[b.top].push(b)
  }
  const merged: typeof rawBars = []
  const tops = Object.keys(byRow)
  for (let r = 0; r < tops.length; r++) {
    const rowBars = byRow[Number(tops[r])]
    rowBars.sort((a, b) => a.left - b.left)
    let cur: { id: number; left: number; width: number; top: number } | null = null
    for (let i = 0; i < rowBars.length; i++) {
      const b = rowBars[i]
      if (!cur) {
        cur = { id: 0, left: b.left, width: b.width, top: b.top }
      } else if (b.left <= cur.left + cur.width + 0.35) {
        cur.width = Math.max(cur.width, (b.left + b.width) - cur.left)
      } else {
        merged.push(cur)
        cur = { id: 0, left: b.left, width: b.width, top: b.top }
      }
    }
    if (cur) merged.push(cur)
  }
  merged.sort((a, b) => a.left - b.left)
  for (let i = 0; i < merged.length; i++) merged[i].id = i
  return merged
}

function findNoteStartIndex(notes: NoteEvent[], elapsed: number): number {
  let low = 0
  let high = notes.length - 1
  const target = elapsed - 6000
  let result = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (notes[mid].start >= target) {
      result = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  return result
}

function playingDrumIcon(track: Track, elapsed: number): string {
  if (track.instrument !== 'drums') return ''
  let current: NoteEvent | undefined
  const startIdx = track.notes.length > 50 ? findNoteStartIndex(track.notes, elapsed) : 0
  for (let i = startIdx; i < track.notes.length; i++) {
    const note = track.notes[i]
    if (note.start > elapsed + 2000) break
    if (note.start <= elapsed && elapsed < note.start + note.duration && (!current || note.start >= current.start)) current = note
  }
  return current ? `/assets/drum-key-${current.index}.svg` : ''
}

function playingNoteLabel(track: Track, elapsed: number): string {
  const labels: string[] = []
  const startIdx = track.notes.length > 50 ? findNoteStartIndex(track.notes, elapsed) : 0
  for (let i = startIdx; i < track.notes.length; i++) {
    const note = track.notes[i]
    if (note.start > elapsed + 2000) break
    if (note.start <= elapsed && elapsed < note.start + note.duration) {
      const pitch = note.midiNote !== undefined ? note.midiNote : 48 + note.octave * 12 + NOTE_STEPS[note.index]
      const label = track.instrument === 'drums'
        ? DRUM_SOUNDS[note.index].name
        : `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
      if (!labels.includes(label)) labels.push(label)
    }
  }
  return labels.join(' · ') || '—'
}

function trackRange(notes: NoteEvent[]): string {
  if (!notes.some(note => note.midiNote !== undefined)) return ['L', 'M', 'H'].filter((_, octave) => notes.some(note => note.octave === octave)).join('/')
  const pitches = notes.map(note => (note.midiNote !== undefined ? note.midiNote : 48 + note.octave * 12 + NOTE_STEPS[note.index]))
  const label = (pitch: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`
  return `${label(pitches.reduce((lowest, pitch) => Math.min(lowest, pitch), Infinity))}–${label(pitches.reduce((highest, pitch) => Math.max(highest, pitch), -Infinity))}`
}

function restoreTracks(value: unknown, withBars = true): Track[] {
  if (!Array.isArray(value)) throw new Error('Invalid tracks')
  return value.map((track, id) => {
    if (!track || !Array.isArray(track.notes) || !Number.isFinite(track.duration) || track.duration < 0) throw new Error('Invalid track')
    const instrument = INSTRUMENTS.find(item => item.id === track.instrument)
    if (track.notes.length && !instrument) throw new Error('Invalid instrument')
    const notes: NoteEvent[] = track.notes.map((note: NoteEvent) => {
      if (!note || !Number.isInteger(note.index) || note.index < 0 || note.index > 11
        || !Number.isInteger(note.octave) || note.octave < 0 || note.octave > 2
        || !Number.isFinite(note.start) || note.start < 0
        || !Number.isFinite(note.duration) || note.duration <= 0 || !Number.isFinite(note.start + note.duration)
        || typeof note.vibrato !== 'boolean'
        || (note.vibratoAge !== undefined && (!Number.isFinite(note.vibratoAge) || note.vibratoAge < 0 || note.vibratoAge > VIBRATO_READY))
        || (note.vibratoPhase !== undefined && (!Number.isFinite(note.vibratoPhase) || note.vibratoPhase < 0 || note.vibratoPhase >= Math.PI * 2))
        || (note.velocity !== undefined && (!Number.isFinite(note.velocity) || note.velocity <= 0 || note.velocity > 1))
        || (note.midiNote !== undefined && (!Number.isInteger(note.midiNote) || note.midiNote < 0 || note.midiNote > 127))) throw new Error('Invalid note')
      return { index: note.index, octave: note.octave, start: note.start, duration: note.duration, vibrato: note.vibrato, vibratoAge: note.vibratoAge !== undefined ? note.vibratoAge : (note.vibrato ? VIBRATO_READY : 0), vibratoPhase: note.vibratoPhase !== undefined ? note.vibratoPhase : 0, velocity: note.velocity !== undefined ? note.velocity : 1, ...(note.midiNote === undefined ? {} : { midiNote: note.midiNote }) }
    })
    const duration = notes.length ? notes.reduce((end, note) => Math.max(end, note.start + note.duration), track.duration) : 0
    return { id, instrument: notes.length ? instrument!.id : null, name: notes.length ? instrument!.name : '',
      octaveLabel: trackRange(notes),
      selected: false, duration, durationLabel: duration ? `${(duration / 1000).toFixed(1)}s` : '—', notes, bars: withBars ? noteBars(notes, duration) : [] }
  })
}

const BUILTIN_DEMO_METAS = [
  { id: 'demo-moonboat-midi-v1', name: '月亮船(快乐星球)-王英姿', file: 'demo-moonboat.json', duration: 86994.792, durationLabel: '87.0s' },
  { id: 'demo-doraemon-midi-v1', name: '哆啦A梦', file: 'demo-doraemon.json', duration: 173998.958, durationLabel: '174.0s' },
  { id: 'demo-summer-midi-v1', name: '菊次郎的夏天-久石让', file: 'demo-summer.json', duration: 148241.029, durationLabel: '148.2s' },
  { id: 'demo-boundless-midi-v1', name: '海阔天空-Beyond', file: 'demo-boundless.json', duration: 350180.804, durationLabel: '350.2s' },
  { id: 'demo-zebra-midi-v1', name: '斑马斑马-宋冬野', file: 'demo-zebra.json', duration: 249942.024, durationLabel: '249.9s' },
  { id: 'demo-lawrence-midi-v1', name: '战场上的圣诞节-坂本龙一', file: 'demo-lawrence.json', duration: 289227.708, durationLabel: '289.2s' },
  { id: 'demo-nocturne-midi-v1', name: '夜曲-周杰伦', file: 'demo-nocturne.json', duration: 216741.476, durationLabel: '216.7s' },
  { id: 'demo-rainbow-midi-v1', name: '彩虹-周杰伦', file: 'demo-rainbow.json', duration: 249193.892, durationLabel: '249.2s' },
]

const BUILTIN_DEMO_FILES: Record<string, string> = {
  'demo-moonboat-midi-v1': 'demo-moonboat.json',
  'demo-doraemon-midi-v1': 'demo-doraemon.json',
  'demo-summer-midi-v1': 'demo-summer.json',
  'demo-boundless-midi-v1': 'demo-boundless.json',
  'demo-zebra-midi-v1': 'demo-zebra.json',
  'demo-lawrence-midi-v1': 'demo-lawrence.json',
  'demo-nocturne-midi-v1': 'demo-nocturne.json',
  'demo-rainbow-midi-v1': 'demo-rainbow.json',
}

function loadFixture(filename: string, expectedId: string): any {
  let fixture: any = null
  const fsManager = (wx as any).getFileSystemManager ? (wx as any).getFileSystemManager() : null
  if (fsManager && fsManager.readFileSync) {
    const candidatePaths = [`assets/${filename}`, `/assets/${filename}`, filename]
    for (let i = 0; i < candidatePaths.length; i++) {
      try {
        const text = fsManager.readFileSync(candidatePaths[i], 'utf8') as string
        if (text) {
          const parsed = JSON.parse(text)
          if (parsed && parsed.id === expectedId) {
            fixture = parsed
            break
          }
        }
      } catch (_) {}
    }
  }
  if (!fixture) {
    try {
      if (typeof require === 'function') {
        const req = require(`../../assets/${filename}`)
        if (req && req.id === expectedId) fixture = req
      }
    } catch (_) {}
  }
  return fixture
}

function attachLazyTracks(mix: SavedMix, filename?: string, initialTracks?: Track[]) {
  let cachedTracks: Track[] | null = initialTracks && initialTracks.length ? initialTracks : (Array.isArray(mix.tracks) && mix.tracks.length ? mix.tracks : null)
  Object.defineProperty(mix, 'tracks', {
    get() {
      if (cachedTracks) return cachedTracks
      const file = filename || BUILTIN_DEMO_FILES[mix.id]
      if (file) {
        const fixture = loadFixture(file, mix.id)
        if (fixture && fixture.tracks) {
          cachedTracks = restoreTracks(fixture.tracks, false)
          return cachedTracks
        }
      }
      return []
    },
    set(value) {
      cachedTracks = value
    },
    enumerable: false,
    configurable: true,
  })
  return mix
}

function serializeLibraryMixes(mixes: SavedMix[]) {
  return mixes.map(mix => {
    if (BUILTIN_DEMO_FILES[mix.id]) {
      return {
        id: mix.id,
        name: mix.name,
        duration: mix.duration,
        durationLabel: mix.durationLabel,
      }
    }
    return {
      id: mix.id,
      name: mix.name,
      duration: mix.duration,
      durationLabel: mix.durationLabel,
      tracks: mix.tracks,
    }
  })
}

let mixGesture: { id: string; x: number; y: number; offset: number; axis: string } | null = null
let suppressMixTap = false
let context: any = null
let masterGain: any = null
let liveVoice: Voice | null = null
let liveSynthVoice: Voice | null = null
let vibratoStartedAt: number | null = null
let playbackVoices: Voice[] = []
let timer: ReturnType<typeof setInterval> | null = null
let metronomeTimer: ReturnType<typeof setInterval> | null = null
let metronomeGain: any = null
let playbackTimer: ReturnType<typeof setInterval> | null = null
let startedAt = 0
let pendingNote: NoteEvent | null = null
let padRect: WechatMiniprogram.BoundingClientRectCallbackResult | null = null
let soundRect: WechatMiniprogram.BoundingClientRectCallbackResult | null = null
let libraryReturnState: {
  tracks: Track[]; hasTracks: boolean; hasSelectedTracks: boolean; selectedMixId: string;
  elapsedLabel: string; timelineSeconds: number; progress: number; scrollTrackIntoView: string;
} | null = null
let guideDemoTimer: ReturnType<typeof setInterval> | null = null
let guideFinishTimer: ReturnType<typeof setTimeout> | null = null
let guideDemoVoices: Voice[] = []
let logoDemoTimer: ReturnType<typeof setInterval> | null = null
let logoDemoVoices: Voice[] = []
let soundTouchX = 0
let touching = false
let cachedPianoWave: any = null
let cachedDrumWave: any = null

Component({
  data: {
    guideVisible: false, guideFading: false, guideStep: 0, guideSteps: GUIDE_STEPS, guideDone: false, guideFeedback: '', guideDemoPlaying: false, guideExpectedKey: -1, guideRecording: false, guideSaving: false,
    guideMasks: [] as GuideRect[], guideCardHeight: 260,
    guideRect: { left: 0, top: 0, width: 0, height: 0 }, guideCardTop: 100, guideCardBottom: -1,
    laneWidth: 240,
    topInset: 52, bottomInset: 24, speakerRows: [] as { id: number; dots: number[] }[],
    libraryButtonTop: 52, libraryButtonRight: 104, libraryButtonSize: 32,
    instrument: 'piano' as InstrumentId, instrumentName: '钢琴',
    instruments: INSTRUMENTS, soundPosition: 50, isSoundDragging: false,
    controlFlashes: { tone: 0, range: 0, metronome: 0 },
    screenGlitch: 0,
    logoDemoPlaying: false, logoDemoKeys: [] as boolean[], logoDemoNoteLabels: [] as string[],
    padCells: PAD_CELLS,
    keys: Array.from({ length: 12 }, (_, index) => {
      const cell = PAD_CELLS.indexOf(index)
      return { ...shiftedKey(index), drumLabel: DRUM_SOUNDS[DRUM_KEY_ORDER[index]].name, drumIconIndex: DRUM_KEY_ORDER[index],
        labelLeft: (cell % 6 + .5) * 100 / 6, labelTop: (Math.floor(cell / 6) + .5) * 50 }
    }),
    tracks: [] as Track[],
    recordingTrackId: -1,
    midiDemoVersion: 0, libraryOpen: false, isScreenMoving: false, savedMixes: [] as SavedMix[], selectedMixId: '', libraryError: '', scrollTrackIntoView: '',
    swipedMixId: '', mixSwipeOffset: 0, isMixSwiping: false,
    showSaveDialog: false, saveName: '', saveError: '', isSaving: false,
    libraryGlow: false, libraryLift: false,
    octaveLetters: ['L', 'M', 'H'],
    octaveNames: ['低', '中', '高'], octaveIndex: 1, metronomeIndex: 0, metronomeBpm: 0,
    activeIndex: -1, activeNote: '', activeDrumIcon: '', isRecording: false, isPlaying: false,
    hasTracks: false, progress: 0, playbackProgress: [] as number[], playbackNoteLabels: [] as string[], playbackDrumIcons: [] as string[], elapsedLabel: '0.0s', timelineSeconds: TIMELINE_MIN_DURATION / 1000,
    hasSelectedTracks: false,
  },
  lifetimes: {
    attached() {
      this.setupShareMenu()
      soundRect = null
      try { if ((wx as any).setInnerAudioOption) (wx as any).setInnerAudioOption({ obeyMuteSwitch: false }) } catch (_) {}
      this.loadLibrary()
      this.seedMidiMix()
      const info = wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      const speakerCount = Math.floor((info.windowWidth - 36) / 9) + 1
      this.setData({
        speakerRows: [speakerCount, speakerCount - 1, speakerCount].map((count, id) => ({ id, dots: Array.from({ length: count }, (_, index) => index) })),
        topInset: Math.max(info.statusBarHeight + 4, menu.top || 0),
        libraryButtonTop: menu.top || info.statusBarHeight + 4,
        libraryButtonRight: menu.left ? info.windowWidth - menu.left + 8 : 104,
        libraryButtonSize: menu.height || 32,
        bottomInset: Math.max(18, info.screenHeight - ((info.safeArea && info.safeArea.bottom) || info.screenHeight)),
      })
    },
    ready() {
      this.measureKeys()
      let seen = false
      try { seen = !!wx.getStorageSync(GUIDE_KEY) } catch (_) {}
      if (!seen) this.startGuide()
    },
    detached() {
      this.clearGuideFinish()
      this.stopGuideDemo()
      this.clearSaveEffect()
      this.stopMetronome()
      this.pauseSession()
      if (context && context.close) context.close()
      context = null
      masterGain = null
      vibratoStartedAt = null
    },
  },
  pageLifetimes: {
    show() {
      this.setupShareMenu()
      this.startMetronome()
      if (this.data.guideVisible && this.data.guideRecording && !this.data.isRecording) {
        this.setData({ guideRecording: false })
        this.enterGuideStep(GUIDE_STEPS.findIndex(step => step.action === 'record'))
      }
    },
    hide() { this.stopGuideDemo(); this.clearSaveEffect(); this.stopMetronome(); this.pauseSession() },
    resize() { this.measureKeys(); if (this.data.guideVisible) this.positionGuide() },
  },
  methods: {
    startGuide() {
      if (this.data.isRecording || this.data.isPlaying || this.data.showSaveDialog) return
      this.onKeyEnd()
      if (this.data.libraryOpen) this.closeLibrary()
      this.setData({ guideVisible: true }, () => this.enterGuideStep(0))
    },
    positionGuide(keepCard = false) {
      const step = this.data.guideStep
      const showScreenIcons = ['tone', 'octave', 'metronome'].includes(GUIDE_STEPS[step].action)
      const query = this.createSelectorQuery().select(GUIDE_STEPS[step].selector).boundingClientRect()
      if (showScreenIcons) query.select('.screen-control-icons').boundingClientRect()
      query.exec(results => {
        if (!this.data.guideVisible || this.data.guideStep !== step) return
        const rect = results[0]
        const info = wx.getSystemInfoSync()
        if (!rect || !rect.width) {
          this.setData({ guideRect: { left: 0, top: 0, width: 0, height: 0 }, guideCardTop: Math.max(info.statusBarHeight + 48, (info.windowHeight - 190) / 2), guideCardBottom: -1, guideMasks: guideMasks(info.windowWidth, info.windowHeight, []), guideCardHeight: 260 })
          return
        }
        const padded = (target: WechatMiniprogram.BoundingClientRectCallbackResult): GuideRect => {
          const left = Math.max(0, target.left - 5), top = Math.max(0, target.top - 5)
          return { left, top, width: Math.min(info.windowWidth, target.left + target.width + 5) - left, height: Math.min(info.windowHeight, target.bottom + 5) - top }
        }
        const target = padded(rect)
        const holes = [target]
        const icons = showScreenIcons ? results[1] : null
        if (icons && icons.width) holes.push(padded(icons))
        const bottom = target.top + target.height
        const cardTop = showScreenIcons ? target.top - 272 : target.top >= info.statusBarHeight + 300 ? target.top - 260 : bottom + 14
        const top = Math.max(info.statusBarHeight + 48, Math.min(cardTop, info.windowHeight - 260))
        const cardHeight = showScreenIcons ? Math.max(0, Math.min(260, target.top - info.statusBarHeight - 48 - 12)) : Math.max(60, info.windowHeight - top - 12)
        this.setData({
          guideRect: target, guideMasks: guideMasks(info.windowWidth, info.windowHeight, holes),
          guideCardTop: keepCard ? this.data.guideCardTop : top, guideCardHeight: keepCard ? this.data.guideCardHeight : cardHeight,
          guideCardBottom: keepCard ? this.data.guideCardBottom : showScreenIcons ? info.windowHeight - target.top + 12 : -1,
        })
      })
    },
    enterGuideStep(step: number) {
      this.clearGuideFinish()
      if (GUIDE_STEPS[step].action === 'melody' && !this.data.isRecording) step = GUIDE_STEPS.findIndex(item => item.action === 'record')
      this.stopGuideDemo()
      if (this.data.guideRecording && !['melody', 'stop-record'].includes(GUIDE_STEPS[step].action)) {
        this.stopRecording()
        this.setData({ guideRecording: false })
      }
      this.onKeyEnd()
      this.setData({ guideStep: step, guideFading: false, guideDone: false, guideFeedback: '', guideDemoPlaying: false, guideExpectedKey: -1 }, () => {
        const action = GUIDE_STEPS[step].action
        if (action === 'record' || action === 'melody') {
          if (this.data.libraryOpen) this.closeLibrary()
          this.setInstrument(1)
          this.setOctave(1)
          this.setMetronome(0)
        }
        if (action === 'library' && this.data.libraryOpen) this.closeLibrary()
        if (action === 'rainbow') {
          if (!this.data.savedMixes.some(mix => mix.id === 'demo-rainbow-midi-v1')) {
            try {
              const fixture = JSON.parse(wx.getFileSystemManager().readFileSync('assets/demo-rainbow.json', 'utf8') as string)
              const tracks = restoreTracks(fixture.tracks)
              const duration = Math.max(...tracks.map(track => track.duration))
              const mix: SavedMix = { id: fixture.id, name: fixture.name, tracks, duration, durationLabel: `${(duration / 1000).toFixed(1)}s` }
              this.setData({ savedMixes: [mix, ...this.data.savedMixes] })
            } catch (_) { this.setData({ guideFeedback: '彩虹加载失败，可先跳过引导，稍后重试。' }) }
          }
          if (!this.data.libraryOpen) this.openLibrary()
        }
        this.positionGuide(action === 'stop-record')
      })
    },
    guideAction(action: string, feedback: string) {
      if (!this.data.guideVisible || GUIDE_STEPS[this.data.guideStep].action !== action) return
      this.setData({ guideDone: true, guideFeedback: feedback })
      if (this.data.guideStep === GUIDE_STEPS.length - 1 && guideFinishTimer === null) {
        guideFinishTimer = setTimeout(() => {
          this.setData({ guideFading: true })
          guideFinishTimer = setTimeout(() => this.finishGuide(), 350)
        }, 1000)
      }
    },
    clearGuideFinish() {
      if (guideFinishTimer !== null) clearTimeout(guideFinishTimer)
      guideFinishTimer = null
    },
    stopGuideDemo() {
      if (guideDemoTimer !== null) clearInterval(guideDemoTimer)
      guideDemoTimer = null
      guideDemoVoices.forEach(voice => voice.stop())
      guideDemoVoices = []
      if (this.data.guideDemoPlaying) this.setData({ guideDemoPlaying: false, guideExpectedKey: -1, activeNote: '', activeDrumIcon: '' })
    },
    playGuideDemo() {
      if (!this.data.guideVisible || GUIDE_STEPS[this.data.guideStep].action !== 'melody' || this.data.guideDemoPlaying) return
      if (!this.data.isRecording) { this.enterGuideStep(GUIDE_STEPS.findIndex(item => item.action === 'record')); return }
      const audio = this.getAudioContext()
      if (!audio) return
      this.onKeyEnd()
      const start = audio.currentTime + .05
      const recordingOffset = Math.max(0, Date.now() - startedAt) + 50
      let recordedNotes = 0
      let total = 0
      const notes = GUIDE_MELODY.map(([index, beats]) => {
        const note = { index, start: total, duration: beats * .4 - .08 }
        total += beats * .4
        return note
      })
      try {
        notes.forEach(note => {
          guideDemoVoices.push(this.createVoice('piano', note.index, 1, false, start + note.start, note.duration, 0, 0, 1, shiftedPitch(note.index, 1)))
        })
      } catch (_) {
        this.stopGuideDemo()
        this.setData({ guideFeedback: '示范暂时无法播放，请再试一次。' })
        return
      }
      this.setData({ guideDemoPlaying: true, guideDone: false, guideFeedback: '正在示范：两只老虎，两只老虎，跑得快，跑得快' })
      guideDemoTimer = setInterval(() => {
        const elapsed = audio.currentTime - start
        if (this.data.guideRecording && this.data.isRecording) {
          const completed = notes.filter(note => elapsed >= note.start + note.duration)
          if (completed.length > recordedNotes) {
            const added: NoteEvent[] = completed.slice(recordedNotes).map(note => ({ index: note.index, midiNote: shiftedPitch(note.index, 1), start: recordingOffset + note.start * 1000, duration: note.duration * 1000, octave: 1, vibrato: false }))
            const tracks = this.data.tracks.map(track => track.id === this.data.recordingTrackId ? { ...track, notes: [...track.notes, ...added] } : track)
            recordedNotes = completed.length
            this.setData({ tracks })
            this.updateRecording()
          }
        }
        if (elapsed >= total + .15) {
          this.stopGuideDemo()
          this.guideAction('melody', '示范已完成，点击“下一步”学习结束录制。')
          return
        }
        const sounding = notes.find(note => elapsed >= note.start && elapsed < note.start + note.duration)
        const key = sounding ? sounding.index : undefined
        this.setData({ guideExpectedKey: key === undefined ? -1 : key, activeNote: key === undefined ? '' : this.data.keys[key].pitchLabel, activeDrumIcon: '' })
      }, 40)
    },
    nextGuide() {
      if (GUIDE_STEPS[this.data.guideStep].action === 'melody' && !this.data.guideDone) { this.playGuideDemo(); return }
      if (!this.data.guideDone) return
      if (this.data.guideStep === GUIDE_STEPS.length - 1) return
      this.enterGuideStep(this.data.guideStep + 1)
    },
    previousGuide() {
      if (this.data.guideStep > 0 && !this.data.isPlaying) this.enterGuideStep(this.data.guideStep - 1)
    },
    finishGuide() {
      this.clearGuideFinish()
      this.stopGuideDemo()
      if (this.data.guideRecording) { this.stopRecording(); this.setData({ guideRecording: false }) }
      this.onKeyEnd()
      this.setData({ guideVisible: false, guideFading: false, guideSaving: false })
      try { wx.setStorageSync(GUIDE_KEY, true) } catch (_) {}
    },
    setupShareMenu() {
      try {
        if (typeof wx !== 'undefined' && (wx as any).showShareMenu) {
          (wx as any).showShareMenu({
            withShareTicket: true,
            menus: ['shareAppMessage', 'shareTimeline'],
          })
        }
      } catch (_) {}
    },
    onLoad() {
      this.setupShareMenu()
    },
    onShow() {
      this.setupShareMenu()
    },
    onShareAppMessage() {
      return { title: '哔哔 · 随手演奏，录下你的旋律', path: '/pages/index/index' }
    },
    onShareTimeline() {
      return { title: '哔哔 · 随手演奏，录下你的旋律' }
    },
    vibrate(type: 'light' | 'medium' | 'heavy' = 'light') {
      try { if ((wx as any).vibrateShort) (wx as any).vibrateShort({ type }) } catch (_) {}
    },
    onPageScroll() { if (!this.data.libraryOpen) this.measureKeys() },
    loadLibrary() {
      try {
        const stored = wx.getStorageSync(LIBRARY_KEY)
        if (!stored) { this.setData({ savedMixes: [], midiDemoVersion: 0, libraryError: '' }); return }
        if (stored.version !== 1 || !Array.isArray(stored.mixes)) throw new Error('Invalid library')
        const savedMixes: SavedMix[] = stored.mixes.map((mix: any) => {
          if (!mix || typeof mix.id !== 'string' || !mix.id || typeof mix.name !== 'string' || !mix.name.trim()) throw new Error('Invalid mix')
          const builtin = BUILTIN_DEMO_METAS.find(item => item.id === mix.id)
          if (builtin) {
            const duration = mix.duration || builtin.duration
            const durationLabel = mix.durationLabel || builtin.durationLabel
            const item: SavedMix = { id: mix.id, name: mix.name, duration, durationLabel } as any
            attachLazyTracks(item, builtin.file)
            return item
          }
          const tracks = Array.isArray(mix.tracks) ? restoreTracks(mix.tracks, false) : []
          if (stored.soundLayoutVersion !== 2) tracks.forEach(track => {
            if (track.instrument === 'drums') {
              track.notes.forEach(note => { note.index %= 9 })
            }
          })
          const duration = mix.duration || Math.max(0, ...tracks.map(track => track.duration))
          if (!duration && !tracks.length) throw new Error('Empty mix')
          const durationLabel = mix.durationLabel || `${(duration / 1000).toFixed(1)}s`
          const item: SavedMix = { id: mix.id, name: mix.name, duration, durationLabel } as any
          attachLazyTracks(item, undefined, tracks)
          return item
        })
        this.setData({ savedMixes, midiDemoVersion: stored.midiDemoVersion === 10 ? 10 : 0, libraryError: '' })
      } catch (_) {
        this.setData({ libraryError: '音轨库读取失败，请重新打开应用后重试' })
      }
    },
    seedMidiMix() {
      if (this.data.libraryError || this.data.midiDemoVersion === 10) return
      try {
        const demoMixes: SavedMix[] = BUILTIN_DEMO_METAS.map(meta => {
          const item: SavedMix = {
            id: meta.id,
            name: meta.name,
            duration: meta.duration,
            durationLabel: meta.durationLabel,
          } as any
          attachLazyTracks(item, meta.file)
          return item
        })

        const demoIds = new Set(demoMixes.map(mix => mix.id))
        const savedMixes = [
          ...demoMixes,
          ...this.data.savedMixes.filter(item => !demoIds.has(item.id) && item.id !== 'demo-fathers-name-v1')
        ]
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: 10, mixes: serializeLibraryMixes(savedMixes) })
        this.setData({ savedMixes, midiDemoVersion: 10 })
      } catch (err) {
        console.error('seedMidiMix failed:', err)
        wx.showToast({ title: 'MIDI测试音轨添加失败', icon: 'none' })
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
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: this.data.midiDemoVersion, mixes: serializeLibraryMixes(savedMixes) })
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
      libraryReturnState = {
        tracks: this.data.tracks.map(track => ({
          ...track,
          notes: track.notes ? track.notes.map(n => ({ ...n })) : [],
          bars: track.bars ? track.bars.map(b => ({ ...b })) : [],
        })),
        hasTracks: this.data.hasTracks,
        hasSelectedTracks: this.data.hasSelectedTracks,
        selectedMixId: this.data.selectedMixId,
        elapsedLabel: this.data.elapsedLabel,
        timelineSeconds: this.data.timelineSeconds,
        progress: this.data.progress,
        scrollTrackIntoView: this.data.scrollTrackIntoView,
      }
      if (!this.data.savedMixes.length && !this.data.libraryError) {
        this.loadLibrary()
      }
      this.setData({ libraryOpen: true, isScreenMoving: false, selectedMixId: '' })
    },
    closeLibrary() {
      if (!this.data.libraryOpen) return
      this.pauseSession()
      this.closeMixSwipe()
      const restored = libraryReturnState
      libraryReturnState = null
      this.setData({ ...restored, libraryOpen: false, isScreenMoving: false, libraryLift: false,
        controlFlashes: { tone: 0, range: 0, metronome: 0 },
        playbackProgress: (restored ? restored.tracks : this.data.tracks).map(() => -1),
      }, () => this.measureKeys())
    },
    toggleLibrary() {
      if (this.data.libraryOpen) this.closeLibrary()
      else this.openLibrary()
      if (this.data.libraryOpen) this.guideAction('library', '音库已打开。')
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
      const guideSaving = this.data.guideVisible && GUIDE_STEPS[this.data.guideStep].action === 'save'
      this.setData({ showSaveDialog: true, saveName: guideSaving ? '两只老虎' : '', saveError: '', ...(guideSaving ? { guideSaving: true, guideVisible: false } : {}) })
    },
    closeSaveDialog() {
      if (!this.data.isSaving) this.setData({ showSaveDialog: false, saveError: '', ...(this.data.guideSaving ? { guideSaving: false, guideVisible: true, guideFeedback: '保存已取消，点击保存 可重新保存。' } : {}) })
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
        const mix: SavedMix = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, name, duration, durationLabel: `${(duration / 1000).toFixed(1)}s` } as any
        attachLazyTracks(mix, undefined, tracks)
        const savedMixes = [mix, ...this.data.savedMixes]
        wx.setStorageSync(LIBRARY_KEY, { version: 1, soundLayoutVersion: 2, demoVersion: DEMO_VERSION, midiDemoVersion: this.data.midiDemoVersion, mixes: serializeLibraryMixes(savedMixes) })
        const continueGuide = this.data.guideSaving
        this.setData({
          savedMixes, selectedMixId: '', showSaveDialog: false, saveName: '', saveError: '',
          tracks: [], hasTracks: false, hasSelectedTracks: false, recordingTrackId: -1,
          elapsedLabel: '0.0s', timelineSeconds: TIMELINE_MIN_DURATION / 1000, progress: 0,
          playbackProgress: [], playbackNoteLabels: [], playbackDrumIcons: [], scrollTrackIntoView: '',
          ...(continueGuide ? { guideSaving: false, guideVisible: true } : {}),
        }, () => {
          if (continueGuide) this.enterGuideStep(GUIDE_STEPS.findIndex(item => item.action === 'library'))
        })
        wx.hideKeyboard({ complete: () => this.animateSavedMix() })
      } catch (_) {
        this.setData({ saveError: '保存失败，请检查本机存储空间后重试' })
      } finally { this.setData({ isSaving: false }) }
    },
    animateSavedMix() {
      this.setData({ libraryGlow: true })
    },
    finishLibraryAnimation() { this.setData({ libraryGlow: false, libraryLift: false }) },
    clearSaveEffect() {
      this.setData({ libraryGlow: false, libraryLift: false })
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
      this.setData({ tracks, hasTracks: true, hasSelectedTracks: false, recordingTrackId: -1, selectedMixId: mix.id, elapsedLabel: mix.durationLabel, timelineSeconds: Math.max(TIMELINE_MIN_DURATION, mix.duration) / 1000, progress: 0 })
      if (mix.id === 'demo-rainbow-midi-v1') this.guideAction('rainbow', '已选中《彩虹》。')
    },
    stopDialogEvent() {},
    triggerScreenGlitch() {
      this.setData({ screenGlitch: this.data.screenGlitch + 1 })
    },
    playLogoDemo() {
      if (this.data.isRecording || this.data.isPlaying || this.data.guideVisible || this.data.showSaveDialog) return
      this.onKeyEnd()
      this.stopVoices()
      const audio = this.getAudioContext()
      if (!audio) return
      const instrument = this.data.instrument
      const octave = this.data.octaveIndex
      const beat = 60 / (this.data.metronomeBpm || 100)
      const start = audio.currentTime + .05
      const notes = LOGO_DEMOS[instrument].map(([pitch, at, length]) => {
        const key = instrument === 'drums' ? pitch : pitch % 12
        const index = instrument === 'drums' ? DRUM_KEY_ORDER[key] : key
        return { key, index, midiNote: instrument === 'drums' ? undefined : shiftedPitch(pitch, octave), at: at * beat,
          duration: instrument === 'drums' ? DRUM_SOUNDS[index].duration : length * beat }
      })
      try {
        notes.forEach(note => logoDemoVoices.push(this.createVoice(instrument, note.index, octave, instrument === 'synth', start + note.at,
          note.duration, instrument === 'synth' ? VIBRATO_READY : 0, 0, .85, note.midiNote)))
      } catch (_) {
        this.stopLogoDemo()
        wx.showToast({ title: '示范暂时无法播放，请重试', icon: 'none' })
        return
      }
      const end = Math.max(...notes.map(note => note.at + note.duration)) + .18
      this.triggerScreenGlitch()
      this.setData({ logoDemoPlaying: true, logoDemoKeys: [], logoDemoNoteLabels: [] })
      logoDemoTimer = setInterval(() => {
        const elapsed = audio.currentTime - start
        if (elapsed >= end) { this.stopLogoDemo(); return }
        const logoDemoKeys = Array.from({ length: 12 }, (_, key) => notes.some(note => note.key === key && elapsed >= note.at && elapsed < note.at + note.duration))
        const logoDemoNoteLabels = Array.from({ length: 12 }, (_, key) => {
          const note = notes.find(note => note.key === key && elapsed >= note.at && elapsed < note.at + note.duration)
          return note && note.midiNote !== undefined ? `${NOTE_NAMES[note.midiNote % 12]}${Math.floor(note.midiNote / 12) - 1}` : ''
        })
        this.setData({ logoDemoKeys, logoDemoNoteLabels })
      }, 25)
    },
    stopLogoDemo() {
      if (logoDemoTimer !== null) clearInterval(logoDemoTimer)
      logoDemoTimer = null
      logoDemoVoices.forEach(voice => voice.stop())
      logoDemoVoices = []
      if (this.data.logoDemoPlaying) this.setData({ logoDemoPlaying: false, logoDemoKeys: [], logoDemoNoteLabels: [] })
    },
    finishScreenGlitch() {
      this.setData({ screenGlitch: 0 })
    },
    flashScreenControl(control: 'tone' | 'range' | 'metronome') {
      this.setData({ controlFlashes: { ...this.data.controlFlashes, [control]: this.data.controlFlashes[control] + 1 } })
    },
    finishScreenControlFlash(event: WechatMiniprogram.BaseEvent) {
      const control = event.currentTarget.dataset.control
      if (control !== 'tone' && control !== 'range' && control !== 'metronome') return
      this.setData({ controlFlashes: { ...this.data.controlFlashes, [control]: 0 } })
    },
    setOctave(index: number) {
      if (!Number.isInteger(index) || index < 0 || index > 2 || index === this.data.octaveIndex) return
      this.vibrate('medium')
      this.onKeyEnd()
      this.setData({ octaveIndex: index, keys: this.data.keys.map((key, keyIndex) => ({ ...key, ...shiftedKey(keyIndex, index) })) })
      this.flashScreenControl('range')
    },
    cycleOctave() {
      const previous = this.data.octaveIndex
      this.setOctave((previous + 1) % 3)
      if (this.data.octaveIndex !== previous) this.playKnobBeep(988)
      this.guideAction('octave', `音域已修改为${this.data.octaveNames[this.data.octaveIndex]}。`)
    },
    cycleMetronome() {
      this.setMetronome((this.data.metronomeIndex + 1) % METRONOME_BPMS.length)
      this.guideAction('metronome', this.data.metronomeBpm ? `节拍已设为 ${this.data.metronomeBpm} BPM。` : '节拍已关闭。')
    },
    setMetronome(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= METRONOME_BPMS.length || index === this.data.metronomeIndex) return
      this.stopMetronome()
      this.setData({ metronomeIndex: index, metronomeBpm: METRONOME_BPMS[index] })
      this.flashScreenControl('metronome')
      this.vibrate('light')
      this.startMetronome()
    },
    startMetronome() {
      if (!this.data.metronomeBpm || metronomeTimer !== null) return
      const audio = this.getAudioContext()
      if (!audio) return
      metronomeGain = audio.createGain()
      metronomeGain.gain.value = .65
      metronomeGain.connect(masterGain || audio.destination)
      const interval = 60 / this.data.metronomeBpm
      let nextBeat = audio.currentTime + .02
      const schedule = () => {
        if (nextBeat < audio.currentTime) nextBeat = audio.currentTime + .02
        while (nextBeat < audio.currentTime + .1) {
          this.playKnobBeep(1200, nextBeat, metronomeGain)
          nextBeat += interval
        }
      }
      schedule()
      metronomeTimer = setInterval(schedule, 25)
    },
    stopMetronome() {
      if (metronomeTimer !== null) clearInterval(metronomeTimer)
      metronomeTimer = null
      if (metronomeGain) metronomeGain.disconnect()
      metronomeGain = null
    },
    setInstrument(index: number) {
      if (this.data.isRecording || this.data.isPlaying || !INSTRUMENTS[index]) return
      const instrument = INSTRUMENTS[index]
      if (instrument.id !== this.data.instrument) {
        this.flashScreenControl('tone')
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
      if (this.data.instrument !== INSTRUMENTS[index].id) this.playKnobBeep(988)
      this.guideAction('tone', `音色已修改为${this.data.instrumentName}。`)
    },
    playKnobBeep(frequency: number, when?: number, output?: any) {
      const audio = this.getAudioContext()
      if (!audio) return
      try {
        const now = when === undefined ? audio.currentTime : when
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency, now)
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(.045, now + .004)
        gain.gain.exponentialRampToValueAtTime(.001, now + .075)
        oscillator.connect(gain)
        gain.connect(output || masterGain || audio.destination)
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
        oscillator.start(now)
        oscillator.stop(now + .08)
      } catch (_) {}
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
      this.createSelectorQuery().select('.screen-glass').boundingClientRect().exec(results => {
        const screen = results[0]
        if (screen && screen.width) this.setData({ laneWidth: Math.max(1, screen.width - 90) })
      })
      this.createSelectorQuery().select('.touch-disc').boundingClientRect().exec(results => {
        padRect = results[0] || null
      })
    },
    handlePadTouches(event: WechatMiniprogram.TouchEvent, isStart: boolean) {
      const rect = padRect
      if (!rect) return
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
          const x = (t.clientX - rect.left - rect.width / 2) / (rect.width / 2)
          const y = (t.clientY - rect.top - rect.height / 2) / (rect.height / 2)
          const k = padKeyAt(x, y, rect.width, rect.height)
          if (k >= 0) this.playKey(k)
        }
        return
      }
      let targetIndex = -1
      for (let i = candidateTouches.length - 1; i >= 0; i--) {
        const t = candidateTouches[i]
        const x = (t.clientX - rect.left - rect.width / 2) / (rect.width / 2)
        const y = (t.clientY - rect.top - rect.height / 2) / (rect.height / 2)
        const k = padKeyAt(x, y, rect.width, rect.height)
        if (k >= 0) {
          targetIndex = k
          break
        }
      }
      if (targetIndex < 0 && candidateTouches !== touches) {
        for (let i = touches.length - 1; i >= 0; i--) {
          const t = touches[i]
          const x = (t.clientX - rect.left - rect.width / 2) / (rect.width / 2)
          const y = (t.clientY - rect.top - rect.height / 2) / (rect.height / 2)
          const k = padKeyAt(x, y, rect.width, rect.height)
          if (k >= 0) {
            targetIndex = k
            break
          }
        }
      }
      if (this.data.guideVisible && GUIDE_STEPS[this.data.guideStep].action === 'melody') {
        if (targetIndex >= 0 && !this.data.guideDone && !this.data.guideDemoPlaying) this.playGuideDemo()
        return
      }
      if (targetIndex === this.data.activeIndex) return
      if (targetIndex >= 0) this.playKey(targetIndex)
      else if (!touches.some(t => {
        const x = (t.clientX - rect.left - rect.width / 2) / (rect.width / 2)
        const y = (t.clientY - rect.top - rect.height / 2) / (rect.height / 2)
        return padKeyAt(x, y, rect.width, rect.height) >= 0
      })) {
        this.releaseKey()
      }
    },
    onPadStart(event: WechatMiniprogram.TouchEvent) {
      if (this.data.libraryOpen || this.data.isScreenMoving || this.data.showSaveDialog) return
      this.stopLogoDemo()
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
      this.stopLogoDemo()
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
      this.setData({ activeIndex: -1 })
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
      const hasVibrato = this.data.instrument === 'synth'
      if (hasVibrato && vibratoStartedAt === null) vibratoStartedAt = audio.currentTime
      const vibratoAge = hasVibrato ? Math.max(0, Math.min(VIBRATO_READY, audio.currentTime - vibratoStartedAt!)) : 0
      try {
        if (reuseSynth) {
          liveSynthVoice!.retune!(index, this.data.octaveIndex, hasVibrato, vibratoAge, midiNote)
          liveVoice = liveSynthVoice
        } else {
          liveVoice = this.createVoice(this.data.instrument, voiceIndex, this.data.octaveIndex, hasVibrato, audio.currentTime, undefined, vibratoAge, 0, 1, midiNote)
          if (this.data.instrument === 'synth') liveSynthVoice = liveVoice
        }
      } catch (_) {
        wx.showToast({ title: '音色加载失败，请重试', icon: 'none' })
        return
      }
      const isDrum = this.data.instrument === 'drums'
      this.setData({ activeIndex: index, activeNote: isDrum ? key.drumLabel : key.pitchLabel, activeDrumIcon: isDrum ? `/assets/drum-key-${key.drumIconIndex}.svg` : '' })
      if (this.data.isRecording) {
        const vPhase = liveVoice && liveVoice.vibratoPhase ? liveVoice.vibratoPhase() : 0
        pendingNote = { index: voiceIndex, start: Math.max(0, Date.now() - startedAt), duration: 0, octave: this.data.octaveIndex, vibrato: hasVibrato, vibratoAge, vibratoPhase: vPhase !== undefined ? vPhase : 0, ...(midiNote === undefined ? {} : { midiNote }) }
      }
    },
    getAudioContext(): any {
      try {
        if (!context) {
          context = (wx as any).createWebAudioContext()
          cachedPianoWave = null
          cachedDrumWave = null
          masterGain = context.createGain()
          masterGain.gain.value = 2.8
          masterGain.connect(context.destination)
        }
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
      gain.connect(masterGain || context.destination)
      const sources: any[] = []
      const nodes: any[] = [filter, gain]
      if (noisy) {
        if (!cachedDrumWave) {
          const real = new Float32Array(257)
          const imag = new Float32Array(257)
          for (let harmonic = 1; harmonic < imag.length; harmonic++) {
            const phase = harmonic * harmonic * 2.399963
            real[harmonic] = Math.cos(phase)
            imag[harmonic] = Math.sin(phase)
          }
          cachedDrumWave = context.createPeriodicWave(real, imag)
        }
        for (const ratio of [1, 1.481]) {
          const noise = context.createOscillator()
          noise.setPeriodicWave(cachedDrumWave)
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
      const level = sound.level * 1.5 * velocity
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
      if (!cachedPianoWave) {
        cachedPianoWave = context.createPeriodicWave(
          new Float32Array(9), new Float32Array([0, 1, .45, .22, .12, .07, .04, .025, .015]),
        )
      }
      source.setPeriodicWave(cachedPianoWave)
      source.frequency.setValueAtTime(frequency, when)
      filter.type = 'lowpass'
      filter.Q.value = .5
      filter.frequency.setValueAtTime(Math.min(12000, frequency * 12), when)
      filter.frequency.exponentialRampToValueAtTime(Math.min(6000, frequency * 2), when + naturalLength)
      source.connect(filter)
      filter.connect(gain)
      gain.connect(masterGain || context.destination)
      const level = INSTRUMENT_LEVELS.piano * velocity
      const levelAt = (seconds: number) => seconds < .004
        ? level * seconds / .004 : level * Math.exp(-5 * (seconds - .004) / naturalLength)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(level, when + .004)
      gain.gain.exponentialRampToValueAtTime(levelAt(length), when + length)
      const sources = [source]
      const nodes = [source, filter, gain]
      return this.manageMelodicVoice(sources, nodes, gain, when, length, .18, levelAt)
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
      const isBass = frequency < 140
      filter.frequency.setValueAtTime(isBass ? Math.min(1200, Math.max(500, frequency * 7)) : 3200, when)
      // Broad midrange resonance approximates a small speaker's nasal body.
      body.type = 'peaking'
      body.frequency.setValueAtTime(isBass ? Math.min(400, frequency * 2) : 900, when)
      body.Q.value = .65
      body.gain.value = isBass ? 0 : 3
      lead.connect(body)
      body.connect(filter)
      filter.connect(gain)
      gain.connect(masterGain || context.destination)
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
          const nextFreq = nextMidiNote === undefined ? FREQUENCIES[nextIndex] * [0.5, 1, 2][octave] : 440 * Math.pow(2, (nextMidiNote - 69) / 12)
          lead.frequency.setValueAtTime(nextFreq, now)
          const isNextBass = nextFreq < 140
          filter.frequency.setValueAtTime(isNextBass ? Math.min(1200, Math.max(500, nextFreq * 7)) : 3200, now)
          body.frequency.setValueAtTime(isNextBass ? Math.min(400, nextFreq * 2) : 900, now)
          body.gain.value = isNextBass ? 0 : 3
          if (enabled || enabled !== effectOn) { setDepth(enabled, age, now); effectOn = enabled }
          if (!open) { gate(level, .003); open = true }
        }
      }
      return voice
    },
    createVoice(instrument: InstrumentId, index: number, octave: number, vibrato: boolean, when: number, duration?: number, vibratoAge = 0, vibratoPhase = 0, velocity = 1, midiNote?: number): Voice {
      if (instrument === 'drums') return this.createDrumVoice(index, when, duration, velocity)
      if (instrument === 'piano') return this.createPianoVoice(index, octave, when, duration, velocity, midiNote)
      return this.createSynthVoice(index, octave, when, duration, true, vibrato ? vibratoAge : 0, vibratoPhase, velocity, midiNote)
    },
    finishNote() {
      if (!pendingNote) return
      const note = pendingNote
      pendingNote = null
      note.duration = this.data.instrument === 'drums'
        ? DRUM_SOUNDS[note.index].duration * 1000
        : Math.max(0, Math.max(0, Date.now() - startedAt) - note.start)
      if (note.duration <= 0) return
      const tracks = this.data.tracks.map(track => track.id === this.data.recordingTrackId ? { ...track, notes: [...track.notes, note] } : track)
      this.data.tracks = tracks
      this.updateRecording(true)
    },
    updateRecording(forceTracks = false) {
      const elapsed = Math.max(0, Date.now() - startedAt)
      const durationLabel = `${(elapsed / 1000).toFixed(1)}s`
      const timelineSeconds = Math.max(TIMELINE_MIN_DURATION, elapsed) / 1000
      const progress = elapsed / Math.max(TIMELINE_MIN_DURATION, elapsed) * 100

      const trackIndex = this.data.tracks.findIndex(track => track.id === this.data.recordingTrackId)
      if (trackIndex < 0) return

      const track = this.data.tracks[trackIndex]
      track.duration = elapsed
      track.durationLabel = durationLabel

      if (pendingNote || forceTracks) {
        const notes = pendingNote ? [...track.notes, { ...pendingNote, duration: elapsed - pendingNote.start }] : track.notes
        const octaveLabel = trackRange(notes) || track.octaveLabel
        const bars = noteBars(notes, elapsed)
        track.octaveLabel = octaveLabel
        track.bars = bars
        this.setData({
          tracks: this.data.tracks,
          timelineSeconds,
          progress,
          elapsedLabel: durationLabel,
        })
      } else {
        this.setData({
          timelineSeconds,
          progress,
          elapsedLabel: durationLabel,
        })
      }
    },
    toggleRecording() {
      if (this.data.isRecording) {
        this.stopRecording()
        if (this.data.guideRecording && GUIDE_STEPS[this.data.guideStep].action === 'stop-record') {
          this.setData({ guideRecording: false })
          this.guideAction('stop-record', '录制已结束，旋律已录入音轨。')
        } else if (this.data.guideRecording) this.setData({ guideRecording: false, guideDone: false, guideFeedback: '录制已停止。' })
        return
      }
      this.startRecording()
      if (this.data.guideVisible && GUIDE_STEPS[this.data.guideStep].action === 'record' && this.data.isRecording) {
        this.setData({ guideRecording: true })
        this.guideAction('record', '录制已开始。')
      }
    },
    startRecording() {
      this.onSoundEnd()
      if (this.data.isRecording || this.data.libraryOpen || this.data.showSaveDialog || !this.getAudioContext()) return
      const target = this.data.tracks.find(track => !track.notes.length) || {
        id: this.data.tracks.length, instrument: null, name: '', octaveLabel: '', selected: false,
        duration: 0, durationLabel: '—', notes: [], bars: [],
      }
      this.closeMixSwipe()
      this.onKeyEnd()
      this.vibrate('medium')
      if (!this.data.isPlaying) this.stopVoices()
      startedAt = Date.now()
      const recordingTrack = {
        ...target, instrument: this.data.instrument, name: this.data.instrumentName,
        octaveLabel: this.data.octaveLetters[this.data.octaveIndex],
        notes: [], bars: [], duration: 0, durationLabel: '0.0s',
      }
      const tracks = this.data.tracks.some(track => track.id === target.id)
        ? this.data.tracks.map(track => track.id === target.id ? recordingTrack : track)
        : [...this.data.tracks, recordingTrack]
      this.setData({ isRecording: true, timelineSeconds: TIMELINE_MIN_DURATION / 1000, selectedMixId: '', recordingTrackId: target.id, scrollTrackIntoView: `track-${target.id}`, progress: 0, elapsedLabel: '0.0s', tracks, hasTracks: tracks.some(track => track.notes.length > 0) })
      timer = setInterval(() => {
        this.updateRecording()
      }, 100)
    },
    stopRecording() {
      if (!this.data.isRecording) return
      this.vibrate('medium')
      this.onKeyEnd()
      this.clearTimer()
      const elapsed = Math.max(0, Date.now() - startedAt)
      const tracks = this.data.tracks.map(track => {
        if (track.id !== this.data.recordingTrackId) return track
        const duration = track.notes.reduce((end, note) => Math.max(end, note.start + note.duration), elapsed)
        if (!track.notes.length) return { ...track, instrument: null, name: '', octaveLabel: '', duration: 0, durationLabel: '—', selected: false, bars: [] }
        return { ...track, duration, durationLabel: `${(duration / 1000).toFixed(1)}s`, bars: noteBars(track.notes, duration) }
      })
      this.setData({ isRecording: false, recordingTrackId: -1, tracks, hasTracks: tracks.some(track => track.notes.length > 0) })
    },
    dismissTrackSwipe() {
      if (suppressMixTap) { suppressMixTap = false; return }
      this.closeMixSwipe()
    },
    deleteCurrent() {
      if (this.data.isRecording || this.data.showSaveDialog) return
      const savedId = this.data.libraryOpen ? this.data.selectedMixId : ''
      const selectedIds = this.data.tracks.filter(track => track.selected).map(track => track.id)
      if (this.data.libraryOpen && !savedId || !this.data.libraryOpen && !selectedIds.length) return
      wx.showModal({
        title: this.data.libraryOpen ? '删除已保存音轨？' : `删除选中的 ${selectedIds.length} 条音轨？`,
        content: '删除后无法恢复',
        confirmColor: '#a94c30',
        success: result => {
          if (!result.confirm) return
          if (savedId) { this.removeSavedMix(savedId); return }
          this.pauseSession()
          const tracks = this.data.tracks.map(track => selectedIds.includes(track.id) ? {
            ...track, instrument: null, name: '', octaveLabel: '', selected: false,
            duration: 0, durationLabel: '—', notes: [], bars: [],
          } : track)
          this.setData({ tracks, selectedMixId: '', recordingTrackId: -1, hasTracks: tracks.some(track => track.notes.length > 0), hasSelectedTracks: false,
            elapsedLabel: '0.0s', timelineSeconds: Math.max(TIMELINE_MIN_DURATION, ...tracks.map(track => track.duration)) / 1000, progress: 0 })
        },
      })
    },
    toggleTrackSelection(event: WechatMiniprogram.TouchEvent) {
      if (suppressMixTap) { suppressMixTap = false; return }
      if (this.data.mixSwipeOffset) { this.closeMixSwipe(); return }
      if (this.data.isRecording || this.data.isPlaying || this.data.showSaveDialog) return
      const id = Number(event.currentTarget.dataset.id)
      this.vibrate('light')
      const tracks = this.data.tracks.map(track => track.id === id && track.notes.length ? { ...track, selected: !track.selected } : track)
      this.setData({ tracks, hasSelectedTracks: tracks.some(track => track.selected) })
    },
    togglePlayback() {
      this.vibrate('medium')
      if (this.data.isPlaying) { this.stopPlayback(); return }
      if (this.data.isRecording || this.data.showSaveDialog) return
      const fromLibrary = this.data.libraryOpen && !!this.data.selectedMixId
      if (this.data.libraryOpen && !fromLibrary) return
      const tracks = this.data.tracks.filter(track => track.notes.length > 0)
      if (!tracks.length) { wx.showToast({ title: '请先录制音轨', icon: 'none' }); return }
      this.closeMixSwipe()
      this.stopPlayback()
      const audio = this.getAudioContext()
      if (!audio) return
      this.onKeyEnd()
      this.stopVoices()
      const when = audio.currentTime + .05
      const span = Math.max(TIMELINE_MIN_DURATION, ...tracks.map(track => track.duration))
      const duration = Math.max(...tracks.map(track => track.duration + (track.instrument === 'piano' ? 180 : track.instrument === 'synth' ? 18 : 0)))
      const totalNotes = tracks.reduce((sum, track) => sum + track.notes.length, 0)
      const useLookahead = totalNotes > 100
      const LOOKAHEAD_SEC = 2.5
      const nextNoteIndices = tracks.map(() => 0)

      const scheduleNotes = (horizonSec: number) => {
        tracks.forEach((track, tIdx) => {
          let nIdx = nextNoteIndices[tIdx]
          while (nIdx < track.notes.length) {
            const note = track.notes[nIdx]
            if (note.start / 1000 > horizonSec) break
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
            nIdx++
          }
          nextNoteIndices[tIdx] = nIdx
        })
      }

      try {
        scheduleNotes(useLookahead ? LOOKAHEAD_SEC : Infinity)
      } catch (_) {
        this.stopPlayback()
        this.stopVoices()
        wx.showToast({ title: '播放失败，请重试', icon: 'none' })
        return
      }
      if (masterGain) {
        const mixFactor = Math.max(1, Math.sqrt(tracks.length * 0.55))
        masterGain.gain.setValueAtTime(2.8 / mixFactor, when)
      }
      this.setData({ ...(fromLibrary ? { isScreenMoving: false, libraryLift: false } : {}), isPlaying: true, timelineSeconds: span / 1000, progress: 0, playbackProgress: this.data.tracks.map(track => track.notes.length ? 0 : -1), elapsedLabel: '0.0s' }, () => {
        if (fromLibrary) { padRect = null; this.measureKeys() }
      })
      if (!this.data.isPlaying) return
      if (this.data.selectedMixId === 'demo-rainbow-midi-v1') this.guideAction('play', '《彩虹》正在播放。')
      playbackTimer = setInterval(() => {
        if (!this.data.isPlaying) return
        const elapsed = Math.max(0, (audio.currentTime - when) * 1000)
        if (useLookahead) {
          try {
            scheduleNotes(audio.currentTime - when + LOOKAHEAD_SEC)
          } catch (_) {}
        }
        const playbackProgress = this.data.tracks.map(track => {
          if (!tracks.some(playing => playing.id === track.id) || elapsed >= track.duration) return -1
          return elapsed / Math.max(TIMELINE_MIN_DURATION, track.duration) * 100
        })
        const playbackNoteLabels = this.data.tracks.map(track => {
          const playing = tracks.find(item => item.id === track.id)
          return playing ? playingNoteLabel(playing, (audio.currentTime - when) * 1000) : '—'
        })
        const playbackDrumIcons = this.data.tracks.map(track => {
          const playing = tracks.find(item => item.id === track.id)
          return playing ? playingDrumIcon(playing, (audio.currentTime - when) * 1000) : ''
        })
        this.setData({ playbackProgress, playbackNoteLabels, playbackDrumIcons, ...(!this.data.isRecording ? { progress: Math.min(100, elapsed / span * 100), elapsedLabel: `${(Math.min(elapsed, duration) / 1000).toFixed(1)}s`, timelineSeconds: span / 1000 } : {}) })
        if (elapsed >= duration + 40) this.stopPlayback()
      }, 50)
    },
    stopPlayback() {
      if (playbackTimer !== null) clearInterval(playbackTimer)
      playbackTimer = null
      playbackVoices.forEach(voice => voice.stop())
      playbackVoices = []
      if (masterGain && context) {
        try { masterGain.gain.setValueAtTime(2.8, context.currentTime) } catch (_) {}
      }
      this.setData({ isPlaying: false, playbackNoteLabels: [], playbackDrumIcons: [], ...(!this.data.isRecording ? { progress: 0 } : {}), playbackProgress: this.data.tracks.map(() => -1) })
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
