<script setup>
import { ref } from 'vue'
import { Upload, Music, Trash2, Play, AlertTriangle, CheckCircle2 } from 'lucide-vue-next'
import { useScoreStore } from '../stores/scoreStore'

const emit = defineEmits(['open-score'])
const store = useScoreStore()

const importInstrument = ref('piano')
const importError = ref('')
const importSuccess = ref('')

const instrumentLabels = {
  piano: 'Piano',
  guitar: 'Guitarra',
  voice: 'Voz',
}

async function handleFileChange(event) {
  importError.value = ''
  importSuccess.value = ''
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const saved = await store.importMusicXMLFile(file, importInstrument.value)
    importSuccess.value = `Importada "${saved.title}" (${saved.measures.length} compases) en almacenamiento offline.`
    event.target.value = ''
  } catch (err) {
    importError.value = err.message || 'No se pudo leer el archivo MusicXML.'
  }
}

function openInAtril(score) {
  store.selectScore(score)
  emit('open-score')
}
</script>

<template>
  <div class="space-y-6">
    <!-- Panel de importación local -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 class="text-lg font-bold text-slate-100">Biblioteca Offline</h2>
        <p class="text-xs text-slate-400">
          Importa archivos <code class="text-indigo-300">.musicxml</code> o <code class="text-indigo-300">.xml</code> (exportables desde MuseScore, Finale o Sibelius). Se guardan en tu dispositivo.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="importInstrument"
          class="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="piano">Instrumento: Piano</option>
          <option value="guitar">Instrumento: Guitarra</option>
          <option value="voice">Instrumento: Voz</option>
        </select>

        <label class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer transition-colors">
          <Upload class="w-4 h-4" />
          <span>Importar MusicXML</span>
          <input type="file" accept=".musicxml,.xml" class="hidden" @change="handleFileChange" />
        </label>
      </div>
    </section>

    <p v-if="importError" class="text-xs text-rose-300 bg-rose-950/70 border border-rose-800 rounded-xl p-3">
      {{ importError }}
    </p>
    <p v-if="importSuccess" class="text-xs text-emerald-300 bg-emerald-950/70 border border-emerald-800 rounded-xl p-3">
      {{ importSuccess }}
    </p>

    <!-- Listado de obras guardadas -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <article
        v-for="score in store.scores"
        :key="score.id"
        class="rounded-2xl border bg-slate-900/60 p-5 flex flex-col justify-between gap-4 transition-colors"
        :class="store.currentScore?.id === score.id ? 'border-indigo-500/70' : 'border-slate-800 hover:border-slate-700'"
      >
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                <Music class="w-4 h-4" />
              </div>
              <div>
                <h3 class="font-bold text-slate-100 leading-tight">{{ score.title }}</h3>
                <p class="text-xs text-slate-400">{{ score.composer }}</p>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5 pt-1 text-[11px] font-medium">
            <span class="px-2 py-0.5 rounded-md bg-slate-800 text-indigo-300">
              {{ instrumentLabels[score.instrument] || score.instrument }}
            </span>
            <span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">
              {{ score.timeSignature.numerator }}/{{ score.timeSignature.denominator }} · {{ score.bpm }} BPM
            </span>
            <span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">
              {{ score.measures.length }} comp.
            </span>
          </div>

          <!-- Estado de validación rítmica -->
          <div class="pt-1">
            <span
              v-if="score.warnings?.length"
              class="inline-flex items-center gap-1 text-[11px] text-amber-400"
            >
              <AlertTriangle class="w-3.5 h-3.5" />
              {{ score.warnings.length }} compás(es) con duración incompleta
            </span>
            <span v-else class="inline-flex items-center gap-1 text-[11px] text-emerald-400">
              <CheckCircle2 class="w-3.5 h-3.5" />
              Compases válidos
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-slate-800/80">
          <button
            @click="openInAtril(score)"
            class="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Play class="w-3.5 h-3.5 fill-current" />
            <span>Abrir en Atril</span>
          </button>

          <button
            @click="store.deleteScore(score.id)"
            title="Eliminar obra"
            class="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 hover:text-rose-400 text-slate-400 transition-colors cursor-pointer"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </article>
    </div>
  </div>
</template>