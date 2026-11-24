import { parseMusicXML } from '../score/MusicXMLParser'

const DEFAULT_TIMEOUT_MS = 2500

export async function checkOnlineOMRHealth(endpointUrl) {
  if (!endpointUrl || !endpointUrl.trim()) {
    return { reachable: false, reason: 'Sin servidor OMR configurado.' }
  }

  const base = endpointUrl.trim().replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return {
      reachable: res.ok,
      reason: res.ok ? 'Servidor OMR disponible.' : `El servidor respondió HTTP ${res.status}.`,
    }
  } catch {
    clearTimeout(timer)
    return { reachable: false, reason: 'El servidor OMR no respondió a tiempo.' }
  }
}

export async function runOnlineOMR(pngBlob, options = {}, endpointUrl) {
  const base = endpointUrl.trim().replace(/\/+$/, '')
  const formData = new FormData()
  formData.append('file', pngBlob, 'score.png')
  formData.append('instrument', options.instrument || 'piano')
  formData.append('clef', options.clef || 'treble')

  const res = await fetch(`${base}/omr`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`Error del servidor OMR Online (HTTP ${res.status}).`)
  }

  const contentType = res.headers.get('content-type') || ''
  let xmlText = ''

  if (contentType.includes('application/json')) {
    const json = await res.json()
    xmlText = json.musicxml || json.xml || ''
  } else {
    xmlText = await res.text()
  }

  if (!xmlText || !xmlText.includes('<score-partwise')) {
    throw new Error('El servidor OMR no devolvió un MusicXML válido.')
  }

  const score = parseMusicXML(xmlText, options.title || 'Partitura Escaneada Online', options.instrument || 'piano')
  score.source = 'omr-online'

  return {
    success: true,
    origin: 'online',
    score,
    stats: {
      stavesDetected: 1,
      notesDetected: score.measures.reduce((acc, m) => acc + m.events.length, 0),
      measuresDetected: score.measures.length,
    },
    notice: 'Procesado en alta precisión con el servidor OMR Online. Revisa los compases marcados con ⚠ si existen.',
  }
}