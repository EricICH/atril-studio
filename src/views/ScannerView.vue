<script setup>
import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import {
  Camera, Upload, ScanLine, Wifi, WifiOff, AlertTriangle, CheckCircle2,
  RotateCw, SlidersHorizontal, Play, Square, Edit3, Save, CloudUpload,
  Trash2, ChevronLeft, ChevronRight, Server
} from 'lucide-vue-next'
import { db } from '../core/storage/db'
import { useScoreStore } from '../stores/scoreStore'
import { ScorePlayer } from '../core/audio/ScorePlayer'
import {
  loadSourceDocument,
  renderSourceToCanvas,
  preprocessCanvas,
  canvasToPngBlob,
} from '../core/omr/ImagePreprocessor'
import { getOMRSettings, saveOMRSettings, runHybridOMR } from '../core/omr/HybridOMRService'
import { checkOnlineOMRHealth } from '../core/omr/OnlineOMRProvider'
import ScoreViewer from '../components/ScoreViewer.vue'

const emit = defineEmits(['open-in-editor', 'open-in-atril'])
const store = useScoreStore()
const player = new ScorePlayer()

// Estado del documento cargado
const sourceDoc = shallowRef(null)
const currentPage = ref(1)
const baseCanvas = shallowRef(null)
const preprocessed = shallowRef(null)
const previewCanvasRef = ref(null)
const showBinarized = ref(true)

// Ajustes de preprocesado
const rotationDeg = ref(0)
const thresholdBias = ref(0)

// Metadatos musicales para guiar al escáner
const scanTitle = ref('Partitura Escaneada')
const scanInstrument = ref('piano')
const scanClef = ref('treble')
const scanKey = ref('C')
const scanNumerator = ref(4)
const scanDenominator = ref(4)
const scanBpm = ref(96)

// Configuración OMR Híbrido
const savedCfg = getOMRSettings()
const omrMode = ref(savedCfg.mode) // 'auto' | 'offline' | 'online'
const endpointUrl = ref(savedCfg.endpointUrl)
const showServerConfig = ref(false)
const healthStatus = ref(null)
const isOnline = ref(navigator.onLine)

// Resultado del escaneo y vista previa
const isScanning = ref(false)
const scanResult = ref(null)
const scanError = ref('')
const isPlayingPreview = ref(false)
const activePos = ref(null)

// Cola offline para re-escanear en la nube luego
const queuedItems = ref([])
const queueMessage = ref('')

const updateNetwork = () => { isOnline.value = navigator.onLine }

async function loadQueue() {
  queuedItems.value = await db.omrQueue.orderBy('createdAt').reverse().toArray()
}

onMounted(async () => {
  window.addEventListener('online', updateNetwork)
  window.addEventListener('offline', updateNetwork)
  await loadQueue()
})

onUnmounted(() => {
  window.removeEventListener('online', updateNetwork)
  window.removeEventListener('offline', updateNetwork)
  player.stop()
})

function updateSettings() {
  saveOMRSettings({ mode: omrMode.value, endpointUrl: endpointUrl.value })
}

async function testEndpoint() {
  updateSettings()
  healthStatus.value = { checking: true, text: 'Probando conexión...' }
  const res = await checkOnlineOMRHealth(endpointUrl.value)
  healthStatus.value = { checking: false, ok: res.reachable, text: res.reason }
}

async function handleFileSelect(event) {
  const file = event.target.files?.[0]
  if (!file) return

  scanError.value = ''
  scanResult.value = null
  queueMessage.value = ''
  rotationDeg.value = 0
  thresholdBias.value = 0
  currentPage.value = 1

  try {
    sourceDoc.value = await loadSourceDocument(file)
    scanTitle.value = file.name.replace(/\.(png|jpe?g|webp|pdf)$/i, '')
    await renderPageAndPreprocess()
  } catch (err) {
    scanError.value = err.message || 'No se pudo abrir el archivo.'
  } finally {
    event.target.value = ''
  }
}

async function renderPageAndPreprocess() {
  if (!sourceDoc.value) return
  baseCanvas.value = await renderSourceToCanvas(sourceDoc.value, currentPage.value)
  applyPreprocess()
}

function applyPreprocess() {
  if (!baseCanvas.value) return
  preprocessed.value = preprocessCanvas(baseCanvas.value, {
    rotationDeg: rotationDeg.value,
    thresholdBias: thresholdBias.value,
  })
  drawPreview()
}

function drawPreview() {
  const target = previewCanvasRef.value
  const prep = preprocessed.value
  if (!target || !prep) return

  const src = showBinarized.value ? prep.binaryCanvas : prep.rotatedCanvas
  target.width = src.width
  target.height = src.height
  const ctx = target.getContext('2d')
  ctx.drawImage(src, 0, 0)
}

function rotate90() {
  rotationDeg.value = ((rotationDeg.value + 90 + 180) % 360) - 180
  applyPreprocess()
}

async function changePage(delta) {
  if (!sourceDoc.value) return
  const next = currentPage.value + delta
  if (next < 1 || next > sourceDoc.value.pageCount) return
  currentPage.value = next
  await renderPageAndPreprocess()
}

async function executeScan() {
  if (!preprocessed.value) return
  stopPreview()
  updateSettings()

  isScanning.value = true
  scanError.value = ''
  scanResult.value = null

  try {
    const result = await runHybridOMR(preprocessed.value, {
      mode: omrMode.value,
      endpointUrl: endpointUrl.value,
      title: scanTitle.value,
      instrument: scanInstrument.value,
      clef: scanClef.value,
      keySignature: scanKey.value,
      numerator: scanNumerator.value,
      denominator: scanDenominator.value,
      bpm: scanBpm.value,
    })

    if (!result.success) {
      scanError.value = result.error || 'No se pudo interpretar la partitura.'
    } else {
      scanResult.value = result
    }
  } catch (err) {
    scanError.value = err.message || 'Ocurrió un fallo inesperado al escanear.'
  } finally {
    isScanning.value = false
  }
}

async function saveToPendingQueue() {
  if (!preprocessed.value) return
  const blob = await canvasToPngBlob(preprocessed.value.rotatedCanvas)
  await db.omrQueue.add({
    filename: `${scanTitle.value}.png`,
    instrument: scanInstrument.value,
    clef: scanClef.value,
    keySignature: scanKey.value,
    blob,
    createdAt: Date.now(),
  })
  await loadQueue()
  queueMessage.value = 'Imagen guardada en cola local. Podrás re-escanearla en alta precisión cuando tengas conexión.'
}

async function loadFromQueue(item) {
  const file = new File([item.blob], item.filename, { type: 'image/png' })
  sourceDoc.value = await loadSourceDocument(file)
  scanTitle.value = item.filename.replace(/\.png$/i, '')
  scanInstrument.value = item.instrument || 'piano'
  scanClef.value = item.clef || 'treble'
  scanKey.value = item.keySignature || 'C'
  currentPage.value = 1
  rotationDeg.value = 0
  thresholdBias.value = 0
  await renderPageAndPreprocess()
}

async function removeFromQueue(id) {
  await db.omrQueue.delete(id)
  await loadQueue()
}

async function togglePreviewPlay() {
  if (!scanResult.value?.score) return
  if (isPlayingPreview.value) {
    stopPreview()
    return
  }
  player.setInstrument(scanResult.value.score.instrument || 'piano')
  player.setTempoScale(1.0)
  player.setMuteAudio(false)
  player.setClickTrack(true)
  player.setCountIn(false)

  isPlayingPreview.value = true
  await player.start(scanResult.value.score, 0, {
    onPositionChange: (pos) => { activePos.value = pos },
    onFinish: () => {
      isPlayingPreview.value = false
      activePos.value = null
    },
  })
}

function stopPreview() {
  player.stop()
  isPlayingPreview.value = false
  activePos.value = null
}

function openInQuickReviewEditor() {
  if (!scanResult.value?.score) return
  stopPreview()
  store.setScoreForEditor(scanResult.value.score)
  emit('open-in-editor')
}

async function saveAndOpenInAtril() {
  if (!scanResult.value?.score) return
  stopPreview()
  await store.saveScore(scanResult.value.score)
  emit('open-in-atril')
}
</script>

<template>
  <div class="space-y-4">
    <!-- Cabecera y selector de Modo OMR Híbrido -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <ScanLine class="w-5 h-5 text-indigo-400" />
            <span>Escáner OMR Híbrido (Foto / PDF)</span>
          </h2>
          <p class="text-xs text-slate-400">
            Usa servidor Online cuando haya conexión o procesa 100% local sin internet
          </p>
        </div>

        <button
          @click="showServerConfig = !showServerConfig"
          class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer"
        >
          <Server class="w-3.5 h-3.5 text-indigo-400" />
          <span>Servidor Online</span>
        </button>
      </div>

      <!-- Selector de 3 modos -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <button
          @click="omrMode = 'auto'; updateSettings()"
          class="p-3 rounded-xl border text-left transition-colors cursor-pointer"
          :class="omrMode === 'auto'
            ? 'bg-indigo-600/20 border-indigo-500 text-white'
            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'"
        >
          <div class="font-bold flex items-center gap-1.5">
            <Wifi class="w-3.5 h-3.5 text-emerald-400" />
            <span>Automático (Híbrido)</span>
          </div>
          <p class="text-[11px] opacity-80 mt-0.5">Online si hay servidor activo; si no, respaldo local.</p>
        </button>

        <button
          @click="omrMode = 'offline'; updateSettings()"
          class="p-3 rounded-xl border text-left transition-colors cursor-pointer"
          :class="omrMode === 'offline'
            ? 'bg-amber-600/20 border-amber-500 text-white'
            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'"
        >
          <div class="font-bold flex items-center gap-1.5">
            <WifiOff class="w-3.5 h-3.5 text-amber-400" />
            <span>Solo Offline (Local)</span>
          </div>
          <p class="text-[11px] opacity-80 mt-0.5">Sin internet. Precisión reducida en fotos complejas.</p>
        </button>

        <button
          @click="omrMode = 'online'; updateSettings()"
          class="p-3 rounded-xl border text-left transition-colors cursor-pointer"
          :class="omrMode === 'online'
            ? 'bg-emerald-600/20 border-emerald-500 text-white'
            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'"
        >
          <div class="font-bold flex items-center gap-1.5">
            <CloudUpload class="w-3.5 h-3.5 text-emerald-400" />
            <span>Forzar Online</span>
          </div>
          <p class="text-[11px] opacity-80 mt-0.5">Alta precisión. Requiere internet y endpoint activo.</p>
        </button>
      </div>

      <!-- Panel desplegable para configurar el servidor OMR Online gratuito -->
      <div
        v-if="showServerConfig"
        class="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-2.5 text-xs"
      >
        <div class="font-semibold text-slate-200">Endpoint de Servidor OMR Online (ej. Hugging Face Space con OEMER/Audiveris)</div>
        <div class="flex flex-wrap gap-2">
          <input
            v-model="endpointUrl"
            @change="updateSettings"
            placeholder="https://tu-usuario-omr.hf.space"
            class="flex-1 min-w-56 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
          />
          <button
            @click="testEndpoint"
            class="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
          >
            Probar conexión
          </button>
        </div>
        <p v-if="healthStatus" :class="healthStatus.ok ? 'text-emerald-400' : 'text-amber-400'">
          {{ healthStatus.text }}
        </p>
        <p class="text-[11px] text-slate-500">
          Contrato esperado: <code>GET /health</code> (200 OK) y <code>POST /omr</code> (campo <code>file</code> PNG → devuelve texto MusicXML).
        </p>
      </div>

      <!-- Botones de carga de Foto / Cámara / PDF -->
      <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
        <label class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer">
          <Upload class="w-4 h-4" />
          <span>Subir Imagen o PDF</span>
          <input type="file" accept="image/*,.pdf" class="hidden" @change="handleFileSelect" />
        </label>

        <label class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer">
          <Camera class="w-4 h-4" />
          <span>Tomar Foto</span>
          <input type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect" />
        </label>

        <span v-if="!isOnline" class="text-xs text-amber-400 ml-auto flex items-center gap-1">
          <WifiOff class="w-3.5 h-3.5" /> Sin red: operando en modo local
        </span>
      </div>
    </section>

    <!-- Error si existe -->
    <div v-if="scanError" class="text-xs text-rose-300 bg-rose-950/70 border border-rose-800 rounded-xl p-3.5">
      {{ scanError }}
    </div>

    <!-- Área de Preprocesado y Escaneo -->
    <section
      v-if="sourceDoc"
      class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <SlidersHorizontal class="w-4 h-4 text-indigo-400" />
          <span>Preprocesado: {{ sourceDoc.name }}</span>
        </div>

        <!-- Paginación si es PDF multipágina -->
        <div v-if="sourceDoc.pageCount > 1" class="flex items-center gap-2 text-xs">
          <button @click="changePage(-1)" :disabled="currentPage <= 1" class="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40 cursor-pointer">
            <ChevronLeft class="w-4 h-4" />
          </button>
          <span class="tabular-nums text-slate-300">Página {{ currentPage }} / {{ sourceDoc.pageCount }}</span>
          <button @click="changePage(1)" :disabled="currentPage >= sourceDoc.pageCount" class="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40 cursor-pointer">
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Controles de enderezado y contraste -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-slate-950/70 border border-slate-800 rounded-xl p-3">
        <div class="space-y-1">
          <div class="flex justify-between text-slate-400">
            <span>Enderezar ángulo</span>
            <span class="font-mono text-slate-200">{{ rotationDeg }}°</span>
          </div>
          <input
            v-model.number="rotationDeg"
            @input="applyPreprocess"
            type="range" min="-15" max="15" step="0.5"
            class="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        <div class="space-y-1">
          <div class="flex justify-between text-slate-400">
            <span>Contraste tinta / papel</span>
            <span class="font-mono text-slate-200">{{ thresholdBias > 0 ? `+${thresholdBias}` : thresholdBias }}</span>
          </div>
          <input
            v-model.number="thresholdBias"
            @input="applyPreprocess"
            type="range" min="-60" max="60" step="5"
            class="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        <div class="flex items-center justify-end gap-2">
          <button
            @click="rotate90"
            class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <RotateCw class="w-3.5 h-3.5" /> 90°
          </button>
          <button
            @click="showBinarized = !showBinarized; drawPreview()"
            class="px-3 py-1.5 rounded-lg border cursor-pointer"
            :class="showBinarized ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-300'"
          >
            {{ showBinarized ? 'Vista B/N' : 'Vista Original' }}
          </button>
        </div>
      </div>

      <!-- Metadatos base para guiar la lectura -->
      <div class="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
        <input
          v-model="scanTitle"
          placeholder="Título"
          class="col-span-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
        />
        <select v-model="scanInstrument" class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-200">
          <option value="piano">Piano</option>
          <option value="guitar">Guitarra</option>
          <option value="voice">Voz</option>
        </select>
        <select v-model="scanClef" class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-200">
          <option value="treble">Clave de Sol</option>
          <option value="bass">Clave de Fa</option>
        </select>
        <select v-model="scanKey" class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-200">
          <option v-for="k in ['C','G','D','A','E','F','Bb','Eb','Ab']" :key="k" :value="k">Tonalidad {{ k }}</option>
        </select>
        <div class="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2">
          <input v-model.number="scanNumerator" type="number" min="1" max="12" class="w-9 bg-transparent text-center font-bold" />
          <span>/</span>
          <select v-model.number="scanDenominator" class="bg-transparent font-bold">
            <option :value="4">4</option>
            <option :value="8">8</option>
          </select>
        </div>
      </div>

      <!-- Vista previa del documento preprocesado -->
      <div class="max-h-80 overflow-auto rounded-xl border border-slate-700 bg-white p-2">
        <canvas ref="previewCanvasRef" class="max-w-full h-auto mx-auto" />
      </div>

      <!-- Botones principales de acción -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <button
          @click="saveToPendingQueue"
          class="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <CloudUpload class="w-4 h-4 text-amber-400" />
          <span>Guardar en cola Online</span>
        </button>

        <button
          @click="executeScan"
          :disabled="isScanning"
          class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2 cursor-pointer"
        >
          <ScanLine class="w-4 h-4" />
          <span>{{ isScanning ? 'Interpretando partitura...' : 'Interpretar Partitura' }}</span>
        </button>
      </div>

      <p v-if="queueMessage" class="text-xs text-emerald-300">{{ queueMessage }}</p>
    </section>

    <!-- Resultado del Escaneo + Revisión Rápida -->
    <section
      v-if="scanResult?.score"
      class="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span
            class="px-2.5 py-1 rounded-full text-xs font-bold"
            :class="scanResult.origin === 'online'
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              : 'bg-amber-950 text-amber-400 border border-amber-800'"
          >
            {{ scanResult.origin === 'online' ? 'OMR Online' : 'OMR Local Offline' }}
          </span>
          <span class="text-xs text-slate-400">
            {{ scanResult.stats.stavesDetected }} pentagrama(s) · {{ scanResult.stats.notesDetected }} eventos · {{ scanResult.stats.measuresDetected }} compases
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            @click="togglePreviewPlay"
            class="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            :class="isPlayingPreview ? 'bg-rose-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-emerald-300'"
          >
            <component :is="isPlayingPreview ? Square : Play" class="w-3.5 h-3.5 fill-current" />
            <span>{{ isPlayingPreview ? 'Detener' : 'Escuchar' }}</span>
          </button>

          <button
            @click="openInQuickReviewEditor"
            class="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Edit3 class="w-3.5 h-3.5" />
            <span>Corregir en Editor (Revisión Rápida)</span>
          </button>

          <button
            @click="saveAndOpenInAtril"
            class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Save class="w-3.5 h-3.5" />
            <span>Guardar y abrir en Atril</span>
          </button>
        </div>
      </div>

      <!-- Aviso honesto de calidad/precisión -->
      <div
        class="rounded-xl p-3 text-xs border flex items-start gap-2"
        :class="scanResult.origin === 'online'
          ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300'
          : 'bg-amber-950/50 border-amber-800/70 text-amber-200'"
      >
        <component :is="scanResult.origin === 'online' ? CheckCircle2 : AlertTriangle" class="w-4 h-4 shrink-0 mt-0.5" />
        <div class="space-y-1">
          <div v-if="scanResult.fallbackReason" class="font-bold">{{ scanResult.fallbackReason }}</div>
          <div>{{ scanResult.notice }}</div>
          <div v-if="scanResult.score.warnings?.length" class="text-amber-300 font-semibold">
            Compases con duración incompleta (⚠): {{ scanResult.score.warnings.map(w => w.measureNumber).join(', ') }}
          </div>
        </div>
      </div>

      <ScoreViewer
        :score="scanResult.score"
        :active-pos="activePos"
        paper-theme="light"
      />
    </section>

    <!-- Cola local de imágenes pendientes para re-escanear online -->
    <section
      v-if="queuedItems.length"
      class="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-2.5"
    >
      <h3 class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
        <CloudUpload class="w-3.5 h-3.5 text-amber-400" />
        <span>Cola pendiente para re-escanear Online ({{ queuedItems.length }})</span>
      </h3>

      <div class="flex flex-wrap gap-2">
        <div
          v-for="item in queuedItems"
          :key="item.id"
          class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
        >
          <button @click="loadFromQueue(item)" class="text-indigo-300 hover:underline font-medium cursor-pointer">
            {{ item.filename }}
          </button>
          <button @click="removeFromQueue(item.id)" class="text-slate-500 hover:text-rose-400 cursor-pointer">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>