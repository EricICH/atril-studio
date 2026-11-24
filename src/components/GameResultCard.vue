<script setup>
import { computed } from 'vue'
import { Trophy, Target, CheckCircle2, AlertCircle, XCircle, History, RotateCcw } from 'lucide-vue-next'

const props = defineProps({
  result: { type: Object, default: null },
  history: { type: Array, default: () => [] },
})

const emit = defineEmits(['practice-measure', 'retry'])

const grade = computed(() => {
  const acc = props.result?.accuracy ?? 0
  if (acc >= 90) return { label: 'Excelente', color: 'text-emerald-400', ring: 'border-emerald-500/50 bg-emerald-500/10' }
  if (acc >= 75) return { label: 'Muy bien', color: 'text-indigo-400', ring: 'border-indigo-500/50 bg-indigo-500/10' }
  if (acc >= 55) return { label: 'En progreso', color: 'text-amber-400', ring: 'border-amber-500/50 bg-amber-500/10' }
  return { label: 'A practicar lento', color: 'text-rose-400', ring: 'border-rose-500/50 bg-rose-500/10' }
})

function formatDate(ts) {
  return new Date(ts).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="space-y-4">
    <!-- Reporte de la última sesión -->
    <section
      v-if="result"
      class="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-5"
    >
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div
            class="w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center shrink-0"
            :class="grade.ring"
          >
            <span class="text-2xl font-black tabular-nums" :class="grade.color">
              {{ result.accuracy }}%
            </span>
            <span class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Puntaje</span>
          </div>

          <div>
            <div class="flex items-center gap-2">
              <Trophy class="w-4 h-4" :class="grade.color" />
              <h3 class="text-base font-bold text-white">{{ grade.label }}</h3>
            </div>
            <p class="text-xs text-slate-400 mt-0.5">
              Afinación: <strong class="text-slate-200">{{ result.pitchAccuracy }}%</strong> ·
              Ritmo: <strong class="text-slate-200">{{ result.rhythmAccuracy }}%</strong>
              <template v-if="result.avgCents !== null">
                · Desviación media: <strong class="text-slate-200">±{{ result.avgCents }} cents</strong>
              </template>
            </p>
          </div>
        </div>

        <button
          @click="emit('retry')"
          class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw class="w-3.5 h-3.5" />
          <span>Repetir práctica</span>
        </button>
      </div>

      <!-- Contadores verde / amarillo / rojo -->
      <div class="grid grid-cols-3 gap-3 text-center">
        <div class="rounded-xl bg-emerald-950/50 border border-emerald-800/60 p-3">
          <div class="flex items-center justify-center gap-1 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 class="w-3.5 h-3.5" />
            <span>Aciertos</span>
          </div>
          <div class="text-2xl font-black text-emerald-300 tabular-nums mt-1">{{ result.counts.hit }}</div>
        </div>

        <div class="rounded-xl bg-amber-950/50 border border-amber-800/60 p-3">
          <div class="flex items-center justify-center gap-1 text-amber-400 text-xs font-semibold">
            <AlertCircle class="w-3.5 h-3.5" />
            <span>Parciales</span>
          </div>
          <div class="text-2xl font-black text-amber-300 tabular-nums mt-1">{{ result.counts.partial }}</div>
        </div>

        <div class="rounded-xl bg-rose-950/50 border border-rose-800/60 p-3">
          <div class="flex items-center justify-center gap-1 text-rose-400 text-xs font-semibold">
            <XCircle class="w-3.5 h-3.5" />
            <span>Errores</span>
          </div>
          <div class="text-2xl font-black text-rose-300 tabular-nums mt-1">{{ result.counts.miss }}</div>
        </div>
      </div>

      <!-- Compases débiles con botón de salto directo -->
      <div v-if="result.weakMeasures?.length" class="space-y-2 pt-2 border-t border-slate-800">
        <div class="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <Target class="w-3.5 h-3.5" />
          <span>Compases sugeridos para reforzar:</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="m in result.weakMeasures"
            :key="m.measureIdx"
            @click="emit('practice-measure', m.measureIdx)"
            class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-xs text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            Practicar Compás {{ m.measureNumber }} ({{ m.accuracy }}%)
          </button>
        </div>
      </div>
    </section>

    <!-- Historial local guardado en Dexie -->
    <section
      v-if="history.length"
      class="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-2.5"
    >
      <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
        <History class="w-3.5 h-3.5 text-indigo-400" />
        <span>Historial local de esta obra</span>
      </div>

      <div class="flex flex-wrap gap-2">
        <div
          v-for="log in history.slice(0, 5)"
          :key="log.id"
          class="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center gap-2"
        >
          <span
            class="font-black tabular-nums"
            :class="log.accuracy >= 85 ? 'text-emerald-400' : log.accuracy >= 60 ? 'text-amber-400' : 'text-rose-400'"
          >
            {{ log.accuracy }}%
          </span>
          <span class="text-slate-500">·</span>
          <span class="text-slate-300">{{ log.tempoPercent }}% tempo</span>
          <span class="text-slate-500">·</span>
          <span class="text-slate-500 text-[11px]">{{ formatDate(log.date) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>