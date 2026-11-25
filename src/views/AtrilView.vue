<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  Play, Square, Volume2, VolumeX, Sun, Moon, RotateCcw,
  AlertTriangle, Gamepad2, Headphones, Mic
} from 'lucide-vue-next'
import { useScoreStore } from '../stores/scoreStore'
import { ScorePlayer } from '../core/audio/ScorePlayer'
import { PitchDetector } from '../core/pitch/PitchDetector'
import { PracticeEvaluator } from '../core/pitch/PracticeEvaluator'
import ScoreViewer from '../components/ScoreViewer.vue'
import GameResultCard from '../components/GameResultCard.vue'

const store = useScoreStore()
const player = new ScorePlayer()
const pitchDetector = new PitchDetector()
const evaluator = new PracticeEvaluator()

const isPlaying = ref(false)
const activePos = ref(null)
const countInText = ref('')
const startMeasure = ref(0)

// Controles de práctica y Modo Juego
const gameMode = ref(false)
const allowOctaveShift = ref(false)
const tempoPercent = ref(100)
const selectedInstrument = ref('piano')
const karaokeVisualOnly = ref(false)
const clickTrack = ref(true)
const countIn = ref(true)
const paperTheme = ref('light')

// Estado en vivo del Modo Juego
const micError = ref('')
const detectedPitch = ref(null)
const expectedNoteLabel = ref('--')
const noteResults = ref({})
const liveStats = ref({ accuracy: 0, hit: 0, partial: 0, miss: 0, total: 0 })
const sessionResult = ref(null)

const currentScore = computed(() => store.currentScore)

const effectiveBpm = computed(() => {
  if (!currentScore.value) return 100
  return Math.round(currentScore.value.bpm * (tempoPercent.value / 100))
})

watch(currentScore, (score) => {
  stopPlayback(false)
  startMeasure.value = 0
  noteResults.value = {}
  sessionResult.value = null
  if (score) {
    selectedInstrument.value = score.instrument || 'piano'
    player.setInstrument(selectedInstrument.value)
  }
}, { immediate: true })

// Al entrar en Modo Juego silenciamos el audio guía por defecto para evitar sangrado al micrófono
watch(gameMode, (enabled) => {
  stopPlayback(false)
  noteResults.value = {}
  sessionResult.value = null
  micError.value = ''
  if (enabled) {
    karaokeVisualOnly.value = true
    countIn.value = true
  } else {
    karaokeVisualOnly.value = false
  }
})

watch(tempoPercent, (val) => player.setTempoScale(val / 100))
watch(selectedInstrument, (val) => player.setInstrument(val))
watch(karaokeVisualOnly, (val) => player.setMuteAudio(val))
watch(clickTrack, (val) => player.setClickTrack(val))
watch(countIn, (val) => player.setCountIn(val))

async function startPlayback(fromMeasure = startMeasure.value) {
  if (!currentScore.value) return
  micError.value = ''
  sessionResult.value = null
  noteResults.value = {}
  liveStats.value = { accuracy: 0, hit: 0, partial: 0, miss: 0, total: 0 }
  detectedPitch.value = null
  expectedNoteLabel.value = '--'
  startMeasure.value = fromMeasure

  // Si estamos en Modo Juego, encender primero el micrófono y el evaluador
  if (gameMode.value) {
    try {
      evaluator.start(currentScore.value, {
        instrument: selectedInstrument.value,
        allowOctaveShift: allowOctaveShift.value,
        onNoteEvaluated: (key, status, stats) => {
          noteResults.value = { ...noteResults.value, [key]: status }
          liveStats.value = stats
        },
      })

      await pitchDetector.start((pitch) => {
        detectedPitch.value = pitch
        if (pitch) evaluator.feedPitch(pitch)
      })
    } catch {
      micError.value = 'No se pudo activar el micrófono para el Modo Juego. Revisa los permisos del navegador.'
      return
    }
  }

  player.setInstrument(selectedInstrument.value)
  player.setTempoScale(tempoPercent.value / 100)
  player.setMuteAudio(karaokeVisualOnly.value)
  player.setClickTrack(clickTrack.value)
  player.setCountIn(countIn.value)

  isPlaying.value = true
  countInText.value = ''

  await player.start(currentScore.value, fromMeasure, {
    onCountIn: (beat, total) => {
      countInText.value = `Prepárate... ${beat} / ${total}`
    },
    onPositionChange: (pos) => {
      countInText.value = ''
      activePos.value = pos
      if (gameMode.value) {
        evaluator.onPositionChange(pos)
        expectedNoteLabel.value = evaluator.getCurrentExpectedLabel()
      }
    },
    onFinish: async () => {
      await finishSession(true)
    },
  })
}

async function finishSession(completedNaturally = false) {
  player.stop()
  pitchDetector.stop()
  isPlaying.value = false
  activePos.value = null
  countInText.value = ''
  detectedPitch.value = null
  expectedNoteLabel.value = '--'

  if (gameMode.value) {
    const finalReport = evaluator.finish()
    if (finalReport && (completedNaturally || finalReport.counts.total >= 2)) {
      sessionResult.value = finalReport
      await store.savePracticeLog({
        scoreId: currentScore.value.id,
        scoreTitle: currentScore.value.title,
        accuracy: finalReport.accuracy,
        pitchAccuracy: finalReport.pitchAccuracy,
        rhythmAccuracy: finalReport.rhythmAccuracy,
        instrument: selectedInstrument.value,
        tempoPercent: tempoPercent.value,
        counts: finalReport.counts,
        weakMeasures: finalReport.weakMeasures,
      })
    }
  }
}

function stopPlayback(shouldEvaluate = true) {
  if (isPlaying.value && gameMode.value && shouldEvaluate) {
    finishSession(false)
    return
  }
  player.stop()
  pitchDetector.stop()
  isPlaying.value = false
  activePos.value = null
  countInText.value = ''
  detectedPitch.value = null
  expectedNoteLabel.value = '--'
}

function togglePlayback() {
  if (isPlaying.value) {
    stopPlayback(true)
  } else {
    startPlayback(startMeasure.value)
  }
}

function handleSelectMeasure(mIdx) {
  startMeasure.value = mIdx
  if (isPlaying.value) {
    startPlayback(mIdx)
  }
}

function handlePracticeWeakMeasure(mIdx) {
  startMeasure.value = mIdx
  startPlayback(mIdx)
}

onUnmounted(() => {
  player.stop()
  pitchDetector.stop()
})
</script>

<template>
  <div v-if="currentScore" class="space-y-4">
    <!-- Cabecera y selector Karaoke vs Modo Juego -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-white leading-tight">{{ currentScore.title }}</h2>
          <p class="text-xs text-slate-400">
            {{ currentScore.composer }} · Compás {{ currentScore.timeSignature.numerator }}/{{ currentScore.timeSignature.denominator }} · Tonalidad {{ currentScore.keySignature }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Selector Modo Karaoke / Modo Juego -->
          <div class="flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              @click="gameMode = false"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              :class="!gameMode ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'"
            >
              Reproducir
            </button>
            <button
              @click="gameMode = true"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              :class="gameMode ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'"
            >
              <Gamepad2 class="w-3.5 h-3.5" />
              <span>Modo Estudio</span>
            </button>
          </div>

          <button
            @click="paperTheme = paperTheme === 'light' ? 'dark' : 'light'"
            class="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <component :is="paperTheme === 'light' ? Moon : Sun" class="w-3.5 h-3.5" />
            <span>{{ paperTheme === 'light' ? 'Oscuro' : 'Claro' }}</span>
          </button>

          <select
            v-model="selectedInstrument"
            class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-200"
          >
            <option value="piano">Piano</option>
            <option value="guitar">Guitarra</option>
            <option value="voice">Voz</option>
          </select>
        </div>
      </div>

      <!-- Barra de transporte y tempo en tiempo real -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-center pt-2 border-t border-slate-800">
        <div class="md:col-span-4 flex items-center gap-2">
          <button
            @click="togglePlayback"
            class="flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            :class="isPlaying
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : gameMode
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'"
          >
            <component :is="isPlaying ? Square : Play" class="w-4 h-4 fill-current" />
            <span>
              {{ isPlaying ? 'Terminar' : gameMode ? `Evaluar (Comp. ${startMeasure + 1})` : `Reproducir (Comp. ${startMeasure + 1})` }}
            </span>
          </button>

          <button
            @click="startMeasure = 0; noteResults = {}; sessionResult = null; stopPlayback(false)"
            title="Volver al inicio"
            class="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <RotateCcw class="w-4 h-4" />
          </button>
        </div>

        <div class="md:col-span-4 flex flex-col gap-1 px-1">
          <div class="flex justify-between text-xs">
            <span class="text-slate-400">Tempo en vivo: <strong class="text-indigo-300">{{ tempoPercent }}%</strong></span>
            <span class="font-mono text-slate-300">{{ effectiveBpm }} BPM</span>
          </div>
          <input
            v-model.number="tempoPercent"
            type="range"
            min="50"
            max="150"
            step="5"
            class="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        <div class="md:col-span-4 flex flex-wrap items-center justify-end gap-2 text-xs">
          <button
            @click="karaokeVisualOnly = !karaokeVisualOnly"
            class="px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
            :class="karaokeVisualOnly
              ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
              : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'"
          >
            <component :is="karaokeVisualOnly ? VolumeX : Volume2" class="w-3.5 h-3.5" />
            <span>{{ karaokeVisualOnly ? 'Solo Cursor' : 'Con Audio' }}</span>
          </button>

          <label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 cursor-pointer">
            <input v-model="clickTrack" type="checkbox" class="accent-indigo-500" />
            <span>Clic</span>
          </label>

          <label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 cursor-pointer">
            <input v-model="countIn" type="checkbox" class="accent-indigo-500" />
            <span>Cuenta</span>
          </label>

          <label
            v-if="gameMode"
            title="Acepta la nota correcta en cualquier octava (útil para voz)"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-emerald-800/70 text-emerald-300 cursor-pointer"
          >
            <input v-model="allowOctaveShift" type="checkbox" class="accent-emerald-500" />
            <span>Octava libre</span>
          </label>
        </div>
      </div>

      <!-- Aviso acústico inteligente para Modo Juego -->
      <div
        v-if="gameMode"
        class="flex items-center gap-2 text-xs rounded-xl px-3 py-2 border"
        :class="karaokeVisualOnly
          ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
          : 'bg-amber-950/60 border-amber-700/80 text-amber-300'"
      >
        <Headphones class="w-4 h-4 shrink-0" />
        <span v-if="karaokeVisualOnly">
          <strong>Modo Juego activo:</strong> El audio guía está silenciado para que el micrófono escuche solo tu instrumento.
          <template v-if="selectedInstrument === 'guitar'"> (Guitarra calibrada a su octava real de sonido).</template>
        </span>
        <span v-else>
          <strong>Usa audífonos:</strong> Tienes activado "Con Audio". Sin audífonos, el micrófono captará los altavoces y falseará tu puntaje.
        </span>
      </div>
    </section>

    <!-- Error de micrófono -->
    <div v-if="micError" class="text-xs text-rose-300 bg-rose-950/70 border border-rose-800 rounded-xl px-4 py-3">
      {{ micError }}
    </div>

    <!-- HUD en tiempo real durante la evaluación -->
    <section
      v-if="gameMode && isPlaying"
      class="grid grid-cols-3 gap-3 rounded-2xl border border-emerald-800/60 bg-slate-900/90 p-3 text-center"
    >
      <div>
        <div class="text-[11px] uppercase tracking-wider text-slate-400">Nota Esperada</div>
        <div class="text-xl font-black text-indigo-300 mt-0.5">{{ expectedNoteLabel }}</div>
      </div>

      <div>
        <div class="text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-center gap-1">
          <Mic class="w-3 h-3 text-emerald-400 animate-pulse" />
          <span>Escuchando</span>
        </div>
        <div class="text-xl font-black mt-0.5" :class="detectedPitch ? 'text-emerald-300' : 'text-slate-600'">
          {{ detectedPitch ? `${detectedPitch.latin}${detectedPitch.octave}` : '...' }}
        </div>
      </div>

      <div>
        <div class="text-[11px] uppercase tracking-wider text-slate-400">Precisión Viva</div>
        <div class="text-xl font-black text-white tabular-nums mt-0.5">
          {{ liveStats.total ? `${liveStats.accuracy}%` : '--' }}
        </div>
      </div>
    </section>

    <!-- Alerta de compases incompletos -->
    <div
      v-if="currentScore.warnings?.length"
      class="flex items-center gap-2 text-xs text-amber-300 bg-amber-950/60 border border-amber-800/80 rounded-xl px-4 py-2.5"
    >
      <AlertTriangle class="w-4 h-4 shrink-0" />
      <span>
        Revisión rítmica: los compases marcados con <strong>⚠</strong> ({{ currentScore.warnings.map(w => w.measureNumber).join(', ') }}) tienen duración distinta a {{ currentScore.timeSignature.numerator }}/{{ currentScore.timeSignature.denominator }}.
      </span>
    </div>

    <!-- Banner de cuenta regresiva -->
    <div
      v-if="countInText"
      class="text-center py-2 px-4 rounded-xl bg-indigo-600/20 border border-indigo-500/50 text-indigo-300 font-bold text-sm tracking-wide animate-pulse"
    >
      {{ countInText }}
    </div>

    <!-- Visor de Partitura SVG con colores de evaluación en vivo -->
    <ScoreViewer
      :score="currentScore"
      :active-pos="activePos"
      :note-results="noteResults"
      :paper-theme="paperTheme"
      @select-measure="handleSelectMeasure"
    />

    <!-- Reporte porcentual final e historial offline -->
    <GameResultCard
      v-if="gameMode"
      :result="sessionResult"
      :history="store.practiceLogs"
      @practice-measure="handlePracticeWeakMeasure"
      @retry="startPlayback(startMeasure)"
    />

    <p class="text-[11px] text-center text-slate-500">
      Consejo: haz clic sobre cualquier compás para arrancar desde ese punto. En Modo Juego, puedes practicar al 70% de tempo e ir subiendo.
    </p>
  </div>

  <div v-else class="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400 text-sm">
    Selecciona o importa una obra desde la pestaña <strong>Biblioteca</strong> para abrirla en el atril.
  </div>
</template>