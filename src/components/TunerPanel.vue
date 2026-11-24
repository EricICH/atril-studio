<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { Mic, MicOff } from 'lucide-vue-next'
import { PitchDetector } from '../core/pitch/PitchDetector'

const detector = new PitchDetector()

const isListening = ref(false)
const notation = ref('latin') // 'latin' (Do Re Mi) o 'anglo' (C D E)
const a4Ref = ref(440)
const pitchData = ref(null)
const errorMsg = ref('')

watch(a4Ref, (val) => detector.setReferenceA4(val))

const toggleMic = async () => {
  errorMsg.value = ''
  if (isListening.value) {
    detector.stop()
    isListening.value = false
    pitchData.value = null
    return
  }

  try {
    detector.setReferenceA4(a4Ref.value)
    await detector.start((data) => {
      if (data) pitchData.value = data
    })
    isListening.value = true
  } catch (err) {
    errorMsg.value = 'No se pudo acceder al micrófono. Verifica los permisos del navegador.'
    isListening.value = false
  }
}

const displayNote = computed(() => {
  if (!pitchData.value) return '--'
  return notation.value === 'latin' ? pitchData.value.latin : pitchData.value.anglo
})

const tuningStatus = computed(() => {
  if (!pitchData.value) return { text: 'Toca o canta una nota', color: 'text-slate-400', dot: 'bg-slate-500' }
  const c = pitchData.value.cents
  if (Math.abs(c) <= 5) return { text: 'Afinado', color: 'text-emerald-400', dot: 'bg-emerald-400' }
  if (Math.abs(c) <= 15) return { text: c < 0 ? 'Un poco bajo' : 'Un poco alto', color: 'text-amber-400', dot: 'bg-amber-400' }
  return { text: c < 0 ? 'Bajo (subir tono)' : 'Alto (bajar tono)', color: 'text-rose-400', dot: 'bg-rose-400' }
})

// Posición porcentual de la aguja (-50 cents = 0%, 0 cents = 50%, +50 cents = 100%)
const needlePercent = computed(() => {
  if (!pitchData.value) return 50
  const clamped = Math.max(-50, Math.min(50, pitchData.value.cents))
  return ((clamped + 50) / 100) * 100
})

onUnmounted(() => {
  detector.stop()
})
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col justify-between gap-6">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h2 class="text-lg font-bold text-slate-100">Afinador Cromático</h2>
        <p class="text-xs text-slate-400">Voz, guitarra y piano (algoritmo YIN)</p>
      </div>

      <!-- Notación Latina vs Americana -->
      <div class="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        <button
          @click="notation = 'latin'"
          class="px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer"
          :class="notation === 'latin' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'"
        >
          Do Re Mi
        </button>
        <button
          @click="notation = 'anglo'"
          class="px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer"
          :class="notation === 'anglo' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'"
        >
          C D E
        </button>
      </div>
    </div>

    <!-- Lectura gigante de nota -->
    <div class="flex flex-col items-center justify-center py-2">
      <div class="flex items-baseline gap-1">
        <span
          class="text-6xl font-black tracking-tight transition-colors"
          :class="pitchData ? tuningStatus.color : 'text-slate-600'"
        >
          {{ displayNote }}
        </span>
        <span v-if="pitchData" class="text-2xl font-bold text-slate-400">
          {{ pitchData.octave }}
        </span>
      </div>

      <div class="text-sm font-semibold mt-1" :class="tuningStatus.color">
        {{ isListening ? tuningStatus.text : 'Micrófono apagado' }}
      </div>

      <div class="text-xs text-slate-500 mt-1 tabular-nums h-4">
        <template v-if="pitchData">
          {{ pitchData.frequency.toFixed(1) }} Hz ·
          {{ pitchData.cents > 0 ? `+${pitchData.cents}` : pitchData.cents }} cents
        </template>
      </div>
    </div>

    <!-- Barra de precisión (Medidor en cents) -->
    <div class="space-y-2">
      <div class="relative h-4 bg-slate-950 rounded-full border border-slate-800 overflow-hidden">
        <!-- Zona verde central (±5 cents) -->
        <div class="absolute inset-y-0 left-[45%] right-[45%] bg-emerald-500/20 border-x border-emerald-500/40" />
        <!-- Línea exacta de 0 cents -->
        <div class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-slate-600" />
        <!-- Aguja móvil -->
        <div
          class="absolute top-0.5 bottom-0.5 w-3 -ml-1.5 rounded-full transition-all duration-75"
          :class="pitchData ? tuningStatus.dot : 'bg-slate-600'"
          :style="{ left: `${needlePercent}%` }"
        />
      </div>

      <div class="flex justify-between text-[11px] text-slate-500 font-mono">
        <span>-50♭</span>
        <span>0</span>
        <span>+50♯</span>
      </div>
    </div>

    <!-- Error de micrófono si existe -->
    <p v-if="errorMsg" class="text-xs text-rose-400 bg-rose-950/60 border border-rose-800 rounded-lg p-2.5">
      {{ errorMsg }}
    </p>

    <!-- Referencia La4 + Botón Micrófono -->
    <div class="flex items-center justify-between gap-3">
      <label class="flex items-center gap-2 text-xs text-slate-400">
        <span>La4:</span>
        <select
          v-model.number="a4Ref"
          class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option :value="432">432 Hz</option>
          <option :value="440">440 Hz</option>
          <option :value="442">442 Hz</option>
          <option :value="444">444 Hz</option>
        </select>
      </label>

      <button
        @click="toggleMic"
        class="flex-1 py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-95"
        :class="isListening ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'"
      >
        <component :is="isListening ? MicOff : Mic" class="w-4 h-4" />
        <span>{{ isListening ? 'Apagar Micrófono' : 'Activar Afinador' }}</span>
      </button>
    </div>
  </section>
</template>