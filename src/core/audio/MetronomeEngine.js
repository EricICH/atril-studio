export class MetronomeEngine {
  constructor() {
    this.audioCtx = null
    this.isRunning = false
    this.bpm = 100 // Referencia estándar en negras (♩ = BPM)
    this.numerator = 4
    this.denominator = 4
    // Niveles de acento por pulso: 2 = Fuerte, 1 = Normal, 0 = Silencio
    this.accentPattern = [2, 1, 1, 1]
    this.volume = 0.8

    // Reloj de precisión (Lookahead + Cola sincronizada a pantalla)
    this.currentBeat = 0
    this.nextNoteTime = 0
    this.scheduleAheadTime = 0.1
    this.lookaheadMs = 20
    this.timerId = null
    this.rafId = null
    this.notesInQueue = []
    this.lastVisualBeat = -1

    this.onBeat = null
  }

  setBpm(newBpm) {
    this.bpm = Math.max(30, Math.min(260, Number(newBpm) || 100))
  }

  setTimeSignature(numerator, denominator, customPattern = null) {
    const num = Math.max(1, Math.min(16, Number(numerator) || 4))
    const den = [2, 4, 8, 16].includes(Number(denominator)) ? Number(denominator) : 4

    this.numerator = num
    this.denominator = den

    if (Array.isArray(customPattern) && customPattern.length === num) {
      this.accentPattern = [...customPattern]
    } else {
      // Ajusta el patrón manteniendo los acentos existentes si cambia el numerador
      const nextPattern = []
      for (let i = 0; i < num; i++) {
        if (i < this.accentPattern.length) {
          nextPattern.push(this.accentPattern[i])
        } else {
          nextPattern.push(i === 0 ? 2 : 1)
        }
      }
      this.accentPattern = nextPattern
    }

    if (this.currentBeat >= this.numerator) {
      this.currentBeat = 0
    }
  }

  setAccentAt(beatIndex, level) {
    if (beatIndex >= 0 && beatIndex < this.accentPattern.length) {
      this.accentPattern[beatIndex] = level
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, Number(val)))
  }

  async start(onBeatCallback) {
    if (this.isRunning) return
    this.onBeat = onBeatCallback

    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' })
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    this.isRunning = true
    this.currentBeat = 0
    this.lastVisualBeat = -1
    this.notesInQueue = []
    this.nextNoteTime = this.audioCtx.currentTime + 0.06

    this.timerId = setInterval(() => this.scheduler(), this.lookaheadMs)
    this.rafId = requestAnimationFrame(() => this.visualLoop())
  }

  stop() {
    this.isRunning = false
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.notesInQueue = []
    this.lastVisualBeat = -1
  }

  scheduler() {
    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      const level = this.accentPattern[this.currentBeat] ?? 1
      this.scheduleNote(this.currentBeat, level, this.nextNoteTime)
      this.advanceNote()
    }
  }

  scheduleNote(beatNumber, accentLevel, time) {
    // Guardamos el instante exacto de audio para sincronizar la interfaz
    this.notesInQueue.push({ beat: beatNumber, level: accentLevel, time })

    // Nivel 0 = Silencio (solo cuenta visualmente, no dispara audio)
    if (accentLevel === 0) return

    const isStrong = accentLevel === 2
    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(isStrong ? 1320 : 880, time)
    osc.frequency.exponentialRampToValueAtTime(isStrong ? 660 : 440, time + 0.025)

    // Ataque ultracorto (2ms) para evitar chasquidos y dar precisión rítmica
    const peakGain = Math.max(0.001, this.volume * (isStrong ? 1.0 : 0.6))
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.038)

    osc.connect(gain)
    gain.connect(this.audioCtx.destination)

    osc.start(time)
    osc.stop(time + 0.042)
  }

  advanceNote() {
    // Duración real del pulso según la unidad del compás (4 = negra, 8 = corchea, 16 = semicorchea)
    const secondsPerQuarter = 60.0 / this.bpm
    const secondsPerBeat = secondsPerQuarter * (4 / this.denominator)

    this.nextNoteTime += secondsPerBeat
    this.currentBeat = (this.currentBeat + 1) % this.numerator
  }

  // Sincronización visual cuadro a cuadro compensando la latencia real de la tarjeta de sonido
  visualLoop() {
    if (!this.isRunning) return

    const hardwareLatency = this.audioCtx.outputLatency || this.audioCtx.baseLatency || 0
    const audibleTime = this.audioCtx.currentTime - hardwareLatency

    let currentNote = null
    while (this.notesInQueue.length && this.notesInQueue[0].time <= audibleTime) {
      currentNote = this.notesInQueue.shift()
    }

    if (currentNote && this.onBeat) {
      this.lastVisualBeat = currentNote.beat
      this.onBeat(currentNote.beat, currentNote.level)
    }

    this.rafId = requestAnimationFrame(() => this.visualLoop())
  }
}