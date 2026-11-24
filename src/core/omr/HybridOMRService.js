import { canvasToPngBlob } from './ImagePreprocessor'
import { runLocalOMR } from './LocalOMREngine'
import { checkOnlineOMRHealth, runOnlineOMR } from './OnlineOMRProvider'

const STORAGE_KEY_URL = 'atril_omr_endpoint_url'
const STORAGE_KEY_MODE = 'atril_omr_mode'

export function getOMRSettings() {
  return {
    endpointUrl: localStorage.getItem(STORAGE_KEY_URL) || '',
    mode: localStorage.getItem(STORAGE_KEY_MODE) || 'auto', // 'auto' | 'offline' | 'online'
  }
}

export function saveOMRSettings({ endpointUrl, mode }) {
  if (endpointUrl !== undefined) {
    localStorage.setItem(STORAGE_KEY_URL, endpointUrl.trim())
  }
  if (mode) {
    localStorage.setItem(STORAGE_KEY_MODE, mode)
  }
}

export async function runHybridOMR(preprocessed, options = {}) {
  const settings = getOMRSettings()
  const mode = options.mode || settings.mode
  const endpointUrl = (options.endpointUrl ?? settings.endpointUrl).trim()
  const isOnline = navigator.onLine

  // 1. Modo Solo Offline (decisión explícita del usuario)
  if (mode === 'offline') {
    const localRes = runLocalOMR(preprocessed, options)
    return {
      ...localRes,
      fallbackReason: 'Modo Solo Offline activado por el usuario.',
    }
  }

  // 2. Intentar Online si hay internet y servidor configurado
  let fallbackReason = ''

  if (!isOnline) {
    fallbackReason = 'Sin conexión a internet.'
  } else if (!endpointUrl) {
    fallbackReason = 'No hay servidor OMR Online configurado.'
  } else {
    const health = await checkOnlineOMRHealth(endpointUrl)
    if (health.reachable) {
      try {
        const pngBlob = await canvasToPngBlob(preprocessed.rotatedCanvas)
        return await runOnlineOMR(pngBlob, options, endpointUrl)
      } catch (err) {
        fallbackReason = err.message || 'Fallo al procesar en el servidor OMR Online.'
      }
    } else {
      fallbackReason = health.reason
    }
  }

  // 3. Si el usuario forzó Online, no degradamos silenciosamente: devolvemos error claro
  if (mode === 'online') {
    return {
      success: false,
      origin: 'online',
      error: `No se pudo ejecutar el OMR Online: ${fallbackReason} Puedes cambiar a modo Offline o guardar la imagen en la cola pendiente.`,
    }
  }

  // 4. Modo Automático: respaldo local transparente con aviso de calidad
  const localRes = runLocalOMR(preprocessed, options)
  return {
    ...localRes,
    fallbackReason: `Se usó respaldo Local Offline (${fallbackReason})`,
  }
}