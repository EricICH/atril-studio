const NOTES_ANGLO = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']

export function frequencyToNote(frequency, a4Ref = 440) {
  const midiFloat = 69 + 12 * Math.log2(frequency / a4Ref)
  const midiNote = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midiNote) * 100)
  const noteIndex = ((midiNote % 12) + 12) % 12
  const octave = Math.floor(midiNote / 12) - 1

  return {
    frequency,
    midiNote,
    cents,
    octave,
    anglo: NOTES_ANGLO[noteIndex],
    latin: NOTES_LATIN[noteIndex],
  }
}

export class PitchDetector {
  constructor() {
    this.audioCtx = null
    this.mediaStream = null
    this.analyser = null
    this.buffer = null
    this.rafId = null
    this.isRunning = false
    this.a4Ref = 440
    this.recentFreqs = []
  }

  setReferenceA4(hz) {
    this.a4Ref = Number(hz) || 440
  }

  async start(onPitchCallback) {
    if (this.isRunning) return

    // Pedimos audio crudo: los filtros de videollamada arruinan notas sostenidas
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
      video: false,
    })

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    this.audioCtx = new AudioContextClass()
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    const source = this.audioCtx.createMediaStreamSource(this.mediaStream)
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 2048
    this.buffer = new Float32Array(this.analyser.fftSize)
    source.connect(this.analyser)

    this.isRunning = true
    this.recentFreqs = []

    const loop = () => {
      if (!this.isRunning) return

      this.analyser.getFloatTimeDomainData(this.buffer)
      const rawFreq = this.detectPitchYIN(this.buffer, this.audioCtx.sampleRate)

      if (rawFreq && rawFreq >= 55 && rawFreq <= 1800) {
        const smoothed = this.smoothFrequency(rawFreq)
        onPitchCallback(frequencyToNote(smoothed, this.a4Ref))
      } else {
        onPitchCallback(null)
      }

      this.rafId = requestAnimationFrame(loop)
    }

    loop()
  }

  stop() {
    this.isRunning = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }
    if (this.audioCtx) {
      this.audioCtx.close()
      this.audioCtx = null
    }
    this.recentFreqs = []
  }

  // Suaviza micro-fluctuaciones pero reacciona al instante al cambiar de nota
  
  smoothFrequency(freq) {
    if (this.recentFreqs.length > 0) {
      const last = this.recentFreqs[this.recentFreqs.length - 1]
      const ratio = freq / last
      if (ratio > 1.045 || ratio < 0.955) {
        this.recentFreqs = []
      }
    }
    this.recentFreqs.push(freq)
    if (this.recentFreqs.length > 5) this.recentFreqs.shift()

    const sorted = [...this.recentFreqs].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  // Algoritmo YIN: evita errores de octava comunes en guitarra y voz
  detectPitchYIN(buffer, sampleRate) {
    // 1. Compuerta de ruido (RMS)
    let rms = 0
    for (let i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i]
    }
    rms = Math.sqrt(rms / buffer.length)
    if (rms < 0.015) return null

    const halfSize = Math.floor(buffer.length / 2)
    const minLag = Math.floor(sampleRate / 1800)
    const maxLag = Math.min(halfSize, Math.floor(sampleRate / 55))
    const yinBuffer = new Float32Array(maxLag)

    // 2. Función de diferencia
    for (let tau = 1; tau < maxLag; tau++) {
      let sum = 0
      for (let i = 0; i < halfSize; i++) {
        const delta = buffer[i] - buffer[i + tau]
        sum += delta * delta
      }
      yinBuffer[tau] = sum
    }

    // 3. Normalización de media acumulada
    yinBuffer[0] = 1
    let runningSum = 0
    for (let tau = 1; tau < maxLag; tau++) {
      runningSum += yinBuffer[tau]
      yinBuffer[tau] = runningSum === 0 ? 1 : (yinBuffer[tau] * tau) / runningSum
    }

    // 4. Búsqueda del primer mínimo local bajo el umbral
    const threshold = 0.15
    let tauEstimate = -1
    for (let tau = minLag; tau < maxLag; tau++) {
      if (yinBuffer[tau] < threshold) {
        while (tau + 1 < maxLag && yinBuffer[tau + 1] < yinBuffer[tau]) {
          tau++
        }
        tauEstimate = tau
        break
      }
    }

    if (tauEstimate === -1) return null

    // 5. Interpolación parabólica para precisión en cents
    let betterTau = tauEstimate
    if (tauEstimate > 0 && tauEstimate < maxLag - 1) {
      const s0 = yinBuffer[tauEstimate - 1]
      const s1 = yinBuffer[tauEstimate]
      const s2 = yinBuffer[tauEstimate + 1]
      const denom = 2 * s1 - s2 - s0
      if (Math.abs(denom) > 1e-6) {
        betterTau = tauEstimate + (s2 - s0) / (2 * denom)
      }
    }

    return sampleRate / betterTau
  }
}