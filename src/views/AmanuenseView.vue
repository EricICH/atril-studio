<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  Mic, Square, Play, Save, Download, FilePlus, FolderEdit,
  Trash2, Plus, ArrowUp, ArrowDown, CheckCheck, Music2, Layers
} from 'lucide-vue-next'
import { useScoreStore } from '../stores/scoreStore'
import { validateMeasures } from '../core/score/MusicXMLParser'
import {
  createBlankScore,
  midiToScoreNote,
  appendDurationToMeasures,
  appendManualEvent,
  fillIncompleteMeasuresWithRests,
  exportToMusicXML,
} from '../core/score/ScoreBuilder'
import { AmanuenseEngine } from '../core/pitch/AmanuenseEngine'
import { ScorePlayer } from '../core/audio/ScorePlayer'
import ScoreViewer from '../components/ScoreViewer.vue'

const emit = defineEmits(['open-in-atril'])
const store = useScoreStore()
const amanuense = new AmanuenseEngine()
const player = new ScorePlayer()

// Borrador editable de la partitura
const draft = ref(createBlankScore())
const selectedPos = ref(null)
const activePos = ref(null)
const isPreviewPlaying = ref(false)
const saveBanner = ref('')

// Controles del Amanuense (grabación de audio a partitura)
const isRecording = ref(false)
const quantizeBeats = ref(0.5) // Corcheas por defecto
const guitarOctaveFix = ref(false)
const countInStatus = ref('')
const liveBeat = ref(-1)
const livePitch = ref(null)
const micError = ref('')

// Controles del Editor Manual
const currentDuration = ref('q')
const isDotted = ref(false)
const chordMode = ref(false) // true = agrega nota encima de la nota seleccionada (acorde)
const keyboardOctave = ref(4)

const durations = [
  { id: 'w', label: 'Redonda', symbol: '𝅝' },
  { id: 'h', label: 'Blanca', symbol: '𝅗𝅥' },
  { id: 'q', label: 'Negra', symbol: '𝅘𝅥' },
  { id: '8', label: 'Corchea', symbol: '𝅘𝅥𝅮' },
  { id: '16', label: 'Semicorchea', symbol: '𝅘𝅥𝅯' },
]

const keySignatures = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab']

// 1 octava completa + Do superior para escritura rápida táctil/mouse
const pianoKeys = [
  { offset: 0, label: 'Do', black: false },
  { offset: 1, label: 'Do#', black: true },
  { offset: 2, label: 'Re', black: false },
  { offset: 3, label: 'Re#', black: true },
  { offset: 4, label: 'Mi', black: false },
  { offset: 5, label: 'Fa', black: false },
  { offset: 6, label: 'Fa#', black: true },
  { offset: 7, label: 'Sol', black: false },
  { offset: 8, label: 'Sol#', black: true },
  { offset: 9, label: 'La', black: false },
  { offset: 10, label: 'La#', black: true },
  { offset: 11, label: 'Si', black: false },
  { offset: 12, label: 'Do+', black: false },
]

const selectedEvent = computed(() => {
  if (!selectedPos.value) return null
  const m = draft.value.measures[selectedPos.value.measureIdx]
  return m?.events?.[selectedPos.value.eventIdx] || null
})

watch(() => draft.value.instrument, (inst) => {
  guitarOctaveFix.value = inst === 'guitar'
})

watch(
  () => store.pendingEditScore,
  (incoming) => {
    if (!incoming) return
    stopAll()
    draft.value = store.consumeScoreForEditor()
    selectedPos.value = null
    saveBanner.value = `Revisión rápida cargada para "${draft.value.title}". Haz clic en cualquier nota para corregirla.`
  },
  { immediate: true }
)

function refreshWarnings() {
  draft.value.warnings = validateMeasures(draft.value)
}

function loadCurrentLibraryScore() {
  stopAll()
  if (!store.currentScore) return
  draft.value = JSON.parse(JSON.stringify(store.currentScore))
  selectedPos.value = null
  saveBanner.value = `Editando "${draft.value.title}" de tu biblioteca.`
}

function startNewScore() {
  stopAll()
  draft.value = createBlankScore()
  selectedPos.value = null
  saveBanner.value = 'Nueva partitura en blanco creada.'
}

// Pre-escucha breve de una nota al pulsar el teclado
function previewSingleMidi(midi) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!player.audioCtx) player.audioCtx = new AudioCtx()
    if (player.audioCtx.state === 'suspended') player.audioCtx.resume()
    player.setInstrument(draft.value.instrument || 'piano')
    player.triggerInstrumentNote(midi, player.audioCtx.currentTime, 0.35)
  } catch {
    // Ignorar si el navegador aún bloquea audio
  }
}

// Escribir nota desde el teclado visual
function handlePianoKeyClick(semitoneOffset) {
  const midi = (keyboardOctave.value + 1) * 12 + semitoneOffset
  const noteObj = midiToScoreNote(midi, draft.value.keySignature)
  previewSingleMidi(midi)

  // Si está activo Modo Acorde y hay una nota seleccionada, apilar sobre ella
  if (chordMode.value && selectedEvent.value && !selectedEvent.value.isRest) {
    const exists = selectedEvent.value.notes.some(n => n.midi === noteObj.midi)
    if (!exists) {
      selectedEvent.value.notes.push(noteObj)
      selectedEvent.value.notes.sort((a, b) => a.midi - b.midi)
    }
    refreshWarnings()
    return
  }

  const pos = appendManualEvent(draft.value, {
    isRest: false,
    duration: currentDuration.value,
    dotted: isDotted.value,
    notes: [noteObj],
  })
  selectedPos.value = pos
  refreshWarnings()
}

function addRestManual() {
  const pos = appendManualEvent(draft.value, {
    isRest: true,
    duration: currentDuration.value,
    dotted: isDotted.value,
    notes: [],
  })
  selectedPos.value = pos
  refreshWarnings()
}

function addEmptyMeasure() {
  draft.value.measures.push({ number: draft.value.measures.length + 1, events: [] })
  refreshWarnings()
}

function autoCompleteRests() {
  fillIncompleteMeasuresWithRests(draft.value)
  refreshWarnings()
}

// Modificar nota seleccionada (altura, duración, puntillo o borrar)
function transposeSelected(semitones) {
  if (!selectedEvent.value || selectedEvent.value.isRest) return
  selectedEvent.value.notes = selectedEvent.value.notes.map(n =>
    midiToScoreNote(n.midi + semitones, draft.value.keySignature)
  )
  previewSingleMidi(selectedEvent.value.notes[0].midi)
  refreshWarnings()
}

function changeSelectedDuration(dur) {
  if (!selectedEvent.value) return
  selectedEvent.value.duration = dur
  refreshWarnings()
}

function toggleSelectedDotted() {
  if (!selectedEvent.value) return
  selectedEvent.value.dotted = !selectedEvent.value.dotted
  refreshWarnings()
}

function deleteSelectedEvent() {
  if (!selectedPos.value) return
  const { measureIdx, eventIdx } = selectedPos.value
  const measure = draft.value.measures[measureIdx]
  if (!measure) return

  measure.events.splice(eventIdx, 1)
  if (measure.events.length === 0 && draft.value.measures.length > 1) {
    draft.value.measures.splice(measureIdx, 1)
    draft.value.measures.forEach((m, i) => { m.number = i + 1 })
  }
  selectedPos.value = null
  refreshWarnings()
}

// Modo Amanuense: grabar micrófono en vivo
async function toggleRecording() {
  micError.value = ''
  if (isRecording.value) {
    amanuense.stop(true)
    isRecording.value = false
    countInStatus.value = ''
    liveBeat.value = -1
    livePitch.value = null
    refreshWarnings()
    return
  }

  stopPreview()

  try {
    isRecording.value = true
    await amanuense.start({
      bpm: draft.value.bpm,
      numerator: draft.value.timeSignature.numerator,
      denominator: draft.value.timeSignature.denominator,
      quantizeBeats: quantizeBeats.value,
      octaveOffset: guitarOctaveFix.value ? 12 : 0,
      countIn: true,
      onCountIn: (beat, total) => {
        countInStatus.value = beat > 0 ? `Cuenta regresiva: ${beat} / ${total}` : 'Grabando... toca o canta ahora'
      },
      onBeat: (beatIdx) => {
        liveBeat.value = beatIdx
      },
      onPitchLive: (p) => {
        livePitch.value = p
      },
      onChunkCommitted: ({ isRest, midi, beats }) => {
        const notes = isRest ? [] : [midiToScoreNote(midi, draft.value.keySignature)]
        appendDurationToMeasures(draft.value.measures, { isRest, notes, beats }, draft.value.timeSignature)
        refreshWarnings()
      },
    })
  } catch {
    isRecording.value = false
    micError.value = 'No se pudo activar el micrófono para el Amanuense.'
  }
}

// Pre-escucha completa del borrador
async function togglePreview() {
  if (isPreviewPlaying.value) {
    stopPreview()
    return
  }
  if (isRecording.value) toggleRecording()

  const playable = JSON.parse(JSON.stringify(draft.value))
  playable.measures = playable.measures.filter(m => m.events.length > 0)
  if (!playable.measures.length) return

  player.setInstrument(draft.value.instrument || 'piano')
  player.setTempoScale(1.0)
  player.setMuteAudio(false)
  player.setClickTrack(true)
  player.setCountIn(false)

  isPreviewPlaying.value = true
  await player.start(playable, 0, {
    onPositionChange: (pos) => { activePos.value = pos },
    onFinish: () => {
      isPreviewPlaying.value = false
      activePos.value = null
    },
  })
}

function stopPreview() {
  player.stop()
  isPreviewPlaying.value = false
  activePos.value = null
}

function stopAll() {
  if (isRecording.value) amanuense.stop(false)
  isRecording.value = false
  stopPreview()
}

async function saveToLibrary(andOpenAtril = false) {
  stopAll()
  refreshWarnings()
  const saved = await store.saveScore(draft.value)
  draft.value = JSON.parse(JSON.stringify(saved))
  saveBanner.value = `Guardado "${saved.title}" en tu Biblioteca Offline.`
  if (andOpenAtril) emit('open-in-atril')
}

function downloadMusicXML() {
  const xml = exportToMusicXML(draft.value)
  const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(draft.value.title || 'partitura').replace(/[^a-z0-9_-]/gi, '_')}.musicxml`
  a.click()
  URL.revokeObjectURL(url)
}

onUnmounted(() => {
  stopAll()
})
</script>

<template>
  <div class="space-y-4">
    <!-- Barra superior: acciones de documento -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-lg font-bold text-white">Estudio: Amanuense y Editor</h2>
          <p class="text-xs text-slate-400">Graba tu instrumento en vivo, crea partituras o modifica obras existentes</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            @click="startNewScore"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <FilePlus class="w-3.5 h-3.5" />
            <span>Nueva</span>
          </button>

          <button
            v-if="store.currentScore"
            @click="loadCurrentLibraryScore"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-indigo-300 flex items-center gap-1.5 cursor-pointer"
          >
            <FolderEdit class="w-3.5 h-3.5" />
            <span>Editar obra activa</span>
          </button>

          <button
            @click="togglePreview"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            :class="isPreviewPlaying ? 'bg-rose-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-emerald-300'"
          >
            <component :is="isPreviewPlaying ? Square : Play" class="w-3.5 h-3.5 fill-current" />
            <span>{{ isPreviewPlaying ? 'Detener' : 'Escuchar' }}</span>
          </button>

          <button
            @click="saveToLibrary(false)"
            class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Save class="w-3.5 h-3.5" />
            <span>Guardar</span>
          </button>

          <button
            @click="downloadMusicXML"
            title="Exportar a archivo estándar .musicxml"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Download class="w-3.5 h-3.5" />
            <span>.musicxml</span>
          </button>
        </div>
      </div>

      <!-- Metadatos de la obra -->
      <div class="grid grid-cols-2 md:grid-cols-6 gap-2 pt-2 border-t border-slate-800 text-xs">
        <input
          v-model="draft.title"
          placeholder="Título de la obra"
          class="col-span-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
        />

        <select
          v-model="draft.instrument"
          class="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200"
        >
          <option value="piano">Piano</option>
          <option value="guitar">Guitarra</option>
          <option value="voice">Voz</option>
        </select>

        <select
          v-model="draft.keySignature"
          @change="refreshWarnings"
          class="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200"
        >
          <option v-for="k in keySignatures" :key="k" :value="k">Tonalidad: {{ k }}</option>
        </select>

        <div class="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
          <span class="text-slate-500">Compás:</span>
          <input
            v-model.number="draft.timeSignature.numerator"
            @change="refreshWarnings"
            type="number" min="1" max="12"
            class="w-10 bg-transparent text-center text-slate-100 font-bold focus:outline-none"
          />
          <span>/</span>
          <select
            v-model.number="draft.timeSignature.denominator"
            @change="refreshWarnings"
            class="bg-transparent text-slate-100 font-bold focus:outline-none"
          >
            <option :value="4">4</option>
            <option :value="8">8</option>
          </select>
        </div>

        <div class="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
          <span class="text-slate-500">BPM:</span>
          <input
            v-model.number="draft.bpm"
            type="number" min="40" max="220"
            class="w-full bg-transparent text-center text-slate-100 font-bold focus:outline-none"
          />
        </div>
      </div>

      <div v-if="saveBanner" class="flex items-center justify-between text-xs text-emerald-300 bg-emerald-950/60 border border-emerald-800 rounded-xl px-3 py-2">
        <span>{{ saveBanner }}</span>
        <button @click="emit('open-in-atril')" class="underline font-semibold cursor-pointer">
          Ir al Atril →
        </button>
      </div>
    </section>

    <!-- Módulo 1: Panel del Amanuense (Audio a Partitura en vivo) -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Mic class="w-4 h-4 text-rose-400" />
          <h3 class="text-sm font-bold text-slate-100">Modo Amanuense (Grabar micrófono a partitura)</h3>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs">
          <label class="flex items-center gap-1.5 text-slate-400">
            <span>Cuantizar:</span>
            <select
              v-model.number="quantizeBeats"
              :disabled="isRecording"
              class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200"
            >
              <option :value="1">Negras (1/4)</option>
              <option :value="0.5">Corcheas (1/8)</option>
              <option :value="0.25">Semicorcheas (1/16)</option>
            </select>
          </label>

          <label class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 cursor-pointer">
            <input v-model="guitarOctaveFix" type="checkbox" :disabled="isRecording" class="accent-indigo-500" />
            <span>Guitarra (+1 oct)</span>
          </label>

          <button
            @click="toggleRecording"
            class="px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            :class="isRecording ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse' : 'bg-emerald-600 hover:bg-emerald-500 text-white'"
          >
            <component :is="isRecording ? Square : Mic" class="w-3.5 h-3.5" />
            <span>{{ isRecording ? 'Detener Grabación' : 'Grabar con Metrónomo' }}</span>
          </button>
        </div>
      </div>

      <p v-if="micError" class="text-xs text-rose-300 bg-rose-950/60 border border-rose-800 rounded-lg p-2.5">
        {{ micError }}
      </p>

      <!-- Estado en vivo mientras graba el Amanuense -->
      <div
        v-if="isRecording"
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-950 border border-rose-500/40 px-4 py-2.5 text-xs"
      >
        <div class="font-semibold text-rose-300">{{ countInStatus }}</div>

        <!-- Luces de pulso del metrónomo -->
        <div class="flex items-center gap-1.5">
          <div
            v-for="b in draft.timeSignature.numerator"
            :key="b"
            class="w-3 h-3 rounded-full transition-transform"
            :class="liveBeat === b - 1 ? (b === 1 ? 'bg-amber-400 scale-125' : 'bg-indigo-400 scale-110') : 'bg-slate-800'"
          />
        </div>

        <div class="font-mono text-emerald-300">
          Captando: <strong>{{ livePitch ? `${livePitch.latin}${livePitch.octave}` : '...' }}</strong>
        </div>
      </div>
    </section>

    <!-- Visor de Partitura Interactivo -->
    <ScoreViewer
      :score="draft"
      :active-pos="activePos"
      :selected-pos="selectedPos"
      paper-theme="light"
      @select-event="(pos) => selectedPos = pos"
      @select-measure="() => selectedPos = null"
    />

    <!-- Barra de edición de la nota seleccionada (si hiciste clic en una nota del pentagrama) -->
    <section
      v-if="selectedEvent"
      class="rounded-2xl border border-cyan-700/60 bg-cyan-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
    >
      <div class="font-semibold text-cyan-300">
        Editando Compás {{ selectedPos.measureIdx + 1 }}, Evento {{ selectedPos.eventIdx + 1 }}
        <span class="text-slate-400 ml-1">
          ({{ selectedEvent.isRest ? 'Silencio' : selectedEvent.notes.map(n => n.vexKey.toUpperCase()).join(' + ') }})
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-if="!selectedEvent.isRest"
          @click="transposeSelected(1)"
          class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <ArrowUp class="w-3.5 h-3.5" /> +1/2 tono
        </button>
        <button
          v-if="!selectedEvent.isRest"
          @click="transposeSelected(-1)"
          class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <ArrowDown class="w-3.5 h-3.5" /> -1/2 tono
        </button>

        <select
          :value="selectedEvent.duration"
          @change="changeSelectedDuration($event.target.value)"
          class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200"
        >
          <option v-for="d in durations" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>

        <button
          @click="toggleSelectedDotted"
          class="px-2.5 py-1.5 rounded-lg border cursor-pointer"
          :class="selectedEvent.dotted ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'"
        >
          Puntillo
        </button>
        <!-- Ligadura de prolongación y fraseo -->
        <button
          @click="selectedEvent.tieStart = !selectedEvent.tieStart"
          class="px-2 py-1.5 rounded-lg border cursor-pointer"
          :class="selectedEvent.tieStart ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'"
        >
          Ligar inicio (~)
        </button>
        <button
          @click="selectedEvent.tieEnd = !selectedEvent.tieEnd"
          class="px-2 py-1.5 rounded-lg border cursor-pointer"
          :class="selectedEvent.tieEnd ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'"
        >
          Ligar fin (~)
        </button>
        <button
          @click="selectedEvent.slurStart = !selectedEvent.slurStart"
          class="px-2 py-1.5 rounded-lg border cursor-pointer"
          :class="selectedEvent.slurStart ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'"
        >
          Fraseo ini
        </button>
        <button
          @click="selectedEvent.slurEnd = !selectedEvent.slurEnd"
          class="px-2 py-1.5 rounded-lg border cursor-pointer"
          :class="selectedEvent.slurEnd ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'"
        >
          Fraseo fin
        </button>

        <!-- Dinámicas (pp a ff) -->
        <select
          :value="selectedEvent.dynamic || ''"
          @change="selectedEvent.dynamic = $event.target.value || null"
          class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200"
        >
          <option value="">Dinámica...</option>
          <option value="pp">pp (pianissimo)</option>
          <option value="p">p (piano)</option>
          <option value="mp">mp (mezzo-piano)</option>
          <option value="mf">mf (mezzo-forte)</option>
          <option value="f">f (forte)</option>
          <option value="ff">ff (fortissimo)</option>
        </select>

        <!-- Articulaciones y técnica -->
        <!-- Articulaciones y técnica -->
        <select
          :value="selectedEvent.articulation || ''"
          @change="selectedEvent.articulation = $event.target.value || null"
          class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200"
        >
          <option value="">Articulación / Técnica...</option>
          <option value="staccato">Staccato</option>
          <option value="accent">Acento (&gt;)</option>
          <option value="tenuto">Tenuto (-)</option>
          <option value="pizzicato">Pizzicato (pizz.)</option>
          <option value="arco">Arco (arco)</option>
          <option value="letRing">Dejar vibrar (l.v.)</option>
        </select>
        <button
          @click="deleteSelectedEvent"
          class="px-2.5 py-1.5 rounded-lg bg-rose-900/70 hover:bg-rose-700 text-rose-200 flex items-center gap-1 cursor-pointer"
        >
          <Trash2 class="w-3.5 h-3.5" /> Borrar
        </button>
      </div>
    </section>

    <!-- Módulo 2: Teclado Musical y Paleta de Escritura Manual -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
        <!-- Figuras musicales -->
        <div class="flex flex-wrap items-center gap-1">
          <button
            v-for="d in durations"
            :key="d.id"
            @click="currentDuration = d.id"
            class="px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
            :class="currentDuration === d.id ? 'bg-indigo-600 text-white' : 'bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800'"
          >
            {{ d.label }}
          </button>

          <button
            @click="isDotted = !isDotted"
            class="px-2.5 py-1.5 rounded-lg font-semibold border cursor-pointer"
            :class="isDotted ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'"
          >
            · Puntillo
          </button>
        </div>

        <!-- Herramientas de compás y acorde -->
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            @click="chordMode = !chordMode"
            title="Apila la nueva nota sobre la nota seleccionada en el pentagrama"
            class="px-2.5 py-1.5 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer"
            :class="chordMode ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-300'"
          >
            <Layers class="w-3.5 h-3.5" />
            <span>Acorde</span>
          </button>

          <button
            @click="addRestManual"
            class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
          >
            + Silencio
          </button>

          <button
            @click="addEmptyMeasure"
            class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Plus class="w-3.5 h-3.5" /> Compás
          </button>

          <button
            @click="autoCompleteRests"
            title="Rellena con silencios los compases marcados con alerta"
            class="px-2.5 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900 border border-amber-800/70 text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <CheckCheck class="w-3.5 h-3.5" /> Completar compases
          </button>
        </div>
      </div>

      <!-- Selector de octava + Teclado interactivo -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="flex items-center gap-1.5">
            <Music2 class="w-3.5 h-3.5 text-indigo-400" />
            Toca una tecla para escribir (Octava actual: <strong class="text-white">{{ keyboardOctave }}</strong>)
          </span>
          <div class="flex items-center gap-1">
            <button
              v-for="oct in [3, 4, 5]"
              :key="oct"
              @click="keyboardOctave = oct"
              class="px-2.5 py-1 rounded-md font-bold cursor-pointer"
              :class="keyboardOctave === oct ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'"
            >
              Oct {{ oct }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-7 sm:grid-cols-13 gap-1">
          <button
            v-for="k in pianoKeys"
            :key="k.offset"
            @click="handlePianoKeyClick(k.offset)"
            class="py-4 px-1 rounded-xl text-xs font-bold border transition-transform active:scale-95 cursor-pointer"
            :class="k.black
              ? 'bg-slate-950 border-slate-700 text-indigo-300 hover:bg-slate-800'
              : 'bg-slate-100 border-slate-300 text-slate-900 hover:bg-white'"
          >
            {{ k.label }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>