<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Music, Gauge, Mic, FolderOpen, ScanLine, Wifi, WifiOff } from 'lucide-vue-next'
import { useScoreStore } from './stores/scoreStore'
import LibraryView from './views/LibraryView.vue'
import ScannerView from './views/ScannerView.vue'
import AtrilView from './views/AtrilView.vue'
import AmanuenseView from './views/AmanuenseView.vue'
import MetronomePanel from './components/MetronomePanel.vue'
import TunerPanel from './components/TunerPanel.vue'

const scoreStore = useScoreStore()
const activeTab = ref('atril')
const isOnline = ref(navigator.onLine)

const updateOnlineStatus = () => {
  isOnline.value = navigator.onLine
}

onMounted(async () => {
  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
  await scoreStore.loadLibrary()
})

onUnmounted(() => {
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
})

const tabs = [
  { id: 'library', label: 'Biblioteca', icon: FolderOpen },
  { id: 'scanner', label: 'Escáner', icon: ScanLine },
  { id: 'atril', label: 'Atril', icon: Music },
  { id: 'tools', label: 'Herramientas', icon: Gauge },
  { id: 'amanuense', label: 'Amanuense', icon: Mic },
]
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <!-- Barra superior -->
    <header class="border-b border-slate-800 bg-slate-900/80 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Music class="w-6 h-6 text-indigo-400" />
        <h1 class="text-lg font-bold tracking-tight">Atril Studio</h1>
      </div>

      <div
        class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
        :class="isOnline ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'"
      >
        <component :is="isOnline ? Wifi : WifiOff" class="w-3.5 h-3.5" />
        <span>{{ isOnline ? 'Online (OMR híbrido listo)' : 'Modo Offline Local' }}</span>
      </div>
    </header>

    <!-- Área de trabajo principal -->
    <main class="flex-1 p-4 md:p-6 max-w-5xl w-full mx-auto">
      <LibraryView v-if="activeTab === 'library'" @open-score="activeTab = 'atril'" />
      <ScannerView
        v-else-if="activeTab === 'scanner'"
        @open-in-editor="activeTab = 'amanuense'"
        @open-in-atril="activeTab = 'atril'"
      />
      <AtrilView v-else-if="activeTab === 'atril'" />

      <div v-else-if="activeTab === 'tools'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetronomePanel />
        <TunerPanel />
      </div>

      <AmanuenseView v-else @open-in-atril="activeTab = 'atril'" />
    </main>

    <!-- Navegación inferior -->
    <nav class="border-t border-slate-800 bg-slate-900 px-2 py-2 sticky bottom-0 z-20">
      <div class="max-w-5xl mx-auto grid grid-cols-5 gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="flex flex-col items-center justify-center py-2 px-1 rounded-lg transition-colors cursor-pointer"
          :class="activeTab === tab.id ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'"
        >
          <component :is="tab.icon" class="w-5 h-5 mb-1" />
          <span class="text-[11px] font-medium truncate max-w-full">{{ tab.label }}</span>
        </button>
      </div>
    </nav>
  </div>
</template>