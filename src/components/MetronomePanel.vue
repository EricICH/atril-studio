<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { Play, Square, Plus, Minus, Volume2 } from 'lucide-vue-next'
import { MetronomeEngine } from '../core/audio/MetronomeEngine'

const engine = new MetronomeEngine()

const isPlaying = ref(false)
const bpm = ref(100)
const numerator = ref(4)
const denominator = ref(4)
// 2 = Fuerte, 1 = Normal, 0 = Silencio
const accentPattern = ref([2, 1, 1, 1])
const volume = ref(0.8)
const activeBeat = ref(-1)
const tapTimes = ref([])

const presets = [
  { label: '2/4', num: 2, den: 4, pattern: [2, 1] },
  { label: '3/4', num: 3, den: 4, pattern: [2, 1, 1] },
  { label: '4/4', num: 4, den: 4, pattern: [2, 1, 1, 1] },
  { label: '6/8', num: 6, den: 8, pattern: [2, 1, 1, 2, 1, 1] },
  { label: '5/4', num: 5, den: 4, pattern: [2, 1, 1, 2, 1], hint: 'Jazz' },
  { label: '5/8', num: 5, den: 8, pattern: [2, 1, 2, 1, 1], hint: 'Merengue' },
  { label: '7/8', num: 7, den: 8, pattern: [2, 1, 2, 1, 2, 1, 1] },
]

const denominators = [2, 4, 8, 16]

const pulsesPerMinute = computed(() => Math.round(bpm.value * (denominator.value / 4)))

const applyPreset = (preset) => {
  numerator.value = preset.num
  denominator.value = preset.den
  accentPattern.value = [...preset.pattern]
  engine.setTimeSignature(preset.num, preset.den, preset.pattern)
  activeBeat.value = -1
}

const changeNumerator = (delta) => {
  const next = Math.max(1, Math.min(16, numerator.value + delta))
  if (next === numerator.value) return
  numerator.value = next

  const updated = []
  for (let i = 0; i < next; i++) {
    updated.push(i < accentPattern.value.length ? accentPattern.value[i] : (i === 0 ? 2 : 1))
  }
  accentPattern.value = updated
  engine.setTimeSignature(numerator.value, denominator.value, updated)
  activeBeat.value = -1
}

const changeDenominator = (den) => {
  denominator.value = den
  engine.setTimeSignature(numerator.value, denominator.value, accentPattern.value)
}

// Cicla el acento al hacer clic en un pulso: Fuerte (2) -> Normal (1) -> Silencio (0)
const cycleAccent = (index) => {
  const current = accentPattern.value[index]
  const next = current === 2 ? 1 : current === 1 ? 0 : 2
  accentPattern.value[index] = next
  engine.setAccentAt(index, next)
}

watch(bpm, (val) => engine.setBpm(val))
watch(volume, (val) => engine.setVolume(val))

const togglePlay = async () => {
  if (isPlaying.value) {
    engine.stop()
    isPlaying.value = false
    activeBeat.value = -1
  } else {
    engine.setBpm(bpm.value)
    engine.setTimeSignature(numerator.value, denominator.value, accentPattern.value)
    engine.setVolume(volume.value)
    isPlaying.value = true
    await engine.start((beatIndex) => {
      activeBeat.value = beatIndex
    })
  }
}

const adjustBpm = (delta) => {
  bpm.value = Math.max(30, Math.min(260, bpm.value + delta))
}

const handleTapTempo = () => {
  const now = performance.now()
  if (tapTimes.value.length > 0 && now - tapTimes.value[tapTimes.value.length - 1] > 2000) {
    tapTimes.value = []
  }
  tapTimes.value.push(now)
  if (tapTimes.value.length > 5) tapTimes.value.shift()

  if (tapTimes.value.length >= 2) {
    let totalDiff = 0
    for (let i = 1; i < tapTimes.value.length; i++) {
      totalDiff += tapTimes.value[i] - tapTimes.value[i - 1]
    }
    const avgMs = totalDiff / (tapTimes.value.length - 1)
    bpm.value = Math.max(30, Math.min(260, Math.round(60000 / avgMs)))
  }
}

onUnmounted(() => {
  engine.stop()
})
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between gap-5">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h2 class="text-lg font-bold text-slate-100">Metrónomo</h2>
        <p class="text-xs text-slate-400">Sincronización por hardware · Compás libre</p>
      </div>

      <!-- Indicador actual del compás -->
      <div class="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-indigo-300 font-black text-base tabular-nums">
        {{ numerator }}/{{ denominator }}
      </div>
    </div>

    <!-- Accesos rápidos (Presets musicales) -->
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="p in presets"
        :key="p.label"
        @click="applyPreset(p)"
        class="px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer"
        :class="numerator === p.num && denominator === p.den
          ? 'bg-indigo-600 border-indigo-500 text-white'
          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'"
      >
        {{ p.label }}<span v-if="p.hint" class="ml-1 text-[10px] opacity-75">· {{ p.hint }}</span>
      </button>
    </div>

    <!-- Constructor personalizado de compás (1 a 16 pulsos / unidad) -->
    <div class="flex items-center justify-between gap-3 bg-slate-950/70 border border-slate-800/80 rounded-xl px-3 py-2 text-xs">
      <div class="flex items-center gap-2">
        <span class="text-slate-400">Pulsos:</span>
        <button
          @click="changeNumerator(-1)"
          class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
        >
          <Minus class="w-3.5 h-3.5" />
        </button>
        <span class="w-5 text-center font-bold text-slate-100 tabular-nums">{{ numerator }}</span>
        <button
          @click="changeNumerator(1)"
          class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
        >
          <Plus class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-slate-400">Base:</span>
        <button
          v-for="den in denominators"
          :key="den"
          @click="changeDenominator(den)"
          class="px-2 py-0.5 rounded font-mono font-bold transition-colors cursor-pointer"
          :class="denominator === den ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'"
        >
          /{{ den }}
        </button>
      </div>
    </div>

    <!-- Luces de pulso interactivas (clic para editar acentos) -->
    <div class="space-y-1.5">
      <div class="flex flex-wrap items-center justify-center gap-2 py-1">
        <button
          v-for="(level, idx) in accentPattern"
          :key="idx"
          @click="cycleAccent(idx)"
          :title="`Pulso ${idx + 1}: clic para cambiar acento`"
          class="h-9 min-w-8 flex-1 max-w-12 rounded-lg border flex flex-col items-center justify-center transition-all duration-75 cursor-pointer select-none"
          :class="[
            activeBeat === idx
              ? (level === 2
                  ? 'bg-amber-400 border-amber-300 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.75)] scale-105'
                  : level === 1
                    ? 'bg-indigo-400 border-indigo-300 text-slate-950 shadow-[0_0_14px_rgba(129,140,248,0.65)] scale-105'
                    : 'bg-slate-700 border-slate-500 text-slate-300 scale-105')
              : (level === 2
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                  : level === 1
                    ? 'bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-700'
                    : 'bg-slate-950 border-slate-800 border-dashed text-slate-600 hover:text-slate-400')
          ]"
        >
          <span class="text-xs font-bold leading-none">{{ idx + 1 }}</span>
          <span class="text-[9px] uppercase mt-0.5 leading-none opacity-80">
            {{ level === 2 ? 'F' : level === 1 ? '·' : '×' }}
          </span>
        </button>
      </div>
      <p class="text-[11px] text-center text-slate-500">
        Toca cualquier pulso para alternar acento: <strong class="text-amber-400">F</strong> fuerte · <strong>·</strong> normal · <strong>×</strong> silencio
      </p>
    </div>

    <!-- Control de BPM -->
    <div class="flex flex-col items-center gap-3">
      <div class="flex items-center gap-5">
        <button
          @click="adjustBpm(-1)"
          class="w-11 h-11 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 cursor-pointer active:scale-95"
        >
          <Minus class="w-5 h-5" />
        </button>

        <div class="text-center min-w-32">
          <div class="text-5xl font-black tracking-tight tabular-nums text-white">
            {{ bpm }}
          </div>
          <div class="text-xs text-slate-400 font-semibold mt-1">
            ♩ = {{ bpm }} BPM
            <span v-if="denominator !== 4" class="text-indigo-400">
              ({{ pulsesPerMinute }}/{{ denominator }})
            </span>
          </div>
        </div>

        <button
          @click="adjustBpm(1)"
          class="w-11 h-11 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200 cursor-pointer active:scale-95"
        >
          <Plus class="w-5 h-5" />
        </button>
      </div>

      <input
        v-model.number="bpm"
        type="range"
        min="30"
        max="260"
        class="w-full accent-indigo-500 cursor-pointer"
      />
    </div>

    <!-- Volumen + Botones de acción -->
    <div class="space-y-4">
      <div class="flex items-center gap-3 text-slate-400">
        <Volume2 class="w-4 h-4 shrink-0" />
        <input
          v-model.number="volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          class="w-full accent-slate-400 cursor-pointer"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <button
          @click="handleTapTempo"
          class="py-3 px-4 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-100 font-semibold text-sm transition-colors cursor-pointer active:scale-95"
        >
          Tap Tempo
        </button>

        <button
          @click="togglePlay"
          class="py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-95"
          :class="isPlaying ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'"
        >
          <component :is="isPlaying ? Square : Play" class="w-4 h-4 fill-current" />
          <span>{{ isPlaying ? 'Detener' : 'Iniciar' }}</span>
        </button>
      </div>
    </div>
  </section>
</template>