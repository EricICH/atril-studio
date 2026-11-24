import { MetronomeEngine } from '../audio/MetronomeEngine'
import { PitchDetector } from './PitchDetector'

export class AmanuenseEngine {
  constructor() {
    this.metronome = new MetronomeEngine()
    this.pitchDetector = new PitchDetector()

    this.isRecording = false
    this.inCountIn = false
    this.countInBeatsLeft = 0

    // Configuración musical
    this.bpm = 90
    this.numerator = 4
    this.denominator = 4
    this.quantizeBeats = 0.5 // 1 = negra, 0.5 = corchea, 0.25 = semicorchea
    this.octaveOffset = 0    // +12 para guitarra (se escribe una octava arriba)

    // Estado interno de segmentación (estabilidad de nota vs silencio)
    this.hasStartedFirstNote = false
    this.activeMidi = null // null = silencio
    this.segmentStartTime = 0
    this.candidateMidi = undefined
    this.candidateFrames = 0

    // Callbacks
    this.onCountIn = null
    this.onBeat = null
    this.onPitchLive = null
    this.onChunkCommitted = null
  }

  async start(options = {}) {
    this.stop(false)

    this.bpm = Number(options.bpm) || 90
    this.numerator = Number(options.numerator) || 4
    this.denominator = Number(options.denominator) || 4
    this.quantizeBeats = Number(options.quantizeBeats) || 0.5
    this.octaveOffset = Number(options.octaveOffset) || 0

    this.onCountIn = options.onCountIn || null
    this.onBeat = options.onBeat || null
    this.onPitchLive = options.onPitchLive || null
    this.onChunkCommitted = options.onChunkCommitted || null

    this.hasStartedFirstNote = false
    this.activeMidi = null
    this.segmentStartTime = 0
    this.candidateMidi = undefined
    this.candidateFrames = 0

    // 1. Encender micrófono primero para validar permisos antes de la cuenta
    await this.pitchDetector.start((pitch) => {
      if (this.onPitchLive) this.onPitchLive(pitch)
      if (!this.isRecording || this.inCountIn) return
      this.processPitchFrame(pitch)
    })

    // 2. Arrancar metrónomo con 1 compás de cuenta regresiva
    this.isRecording = true
    this.inCountIn = options.countIn !== false
    this.countInBeatsLeft = this.inCountIn ? this.numerator : 0

    this.metronome.setBpm(this.bpm)
    this.metronome.setTimeSignature(this.numerator, this.denominator)
    this.metronome.setVolume(options.clickMuted ? 0 : 0.65)

    await this.metronome.start((beatIdx) => {
      if (this.inCountIn) {
        const currentCount = this.numerator - this.countInBeatsLeft + 1
        if (this.onCountIn) this.onCountIn(currentCount, this.numerator)
        this.countInBeatsLeft--

        if (this.countInBeatsLeft <= 0) {
          // Termina la cuenta al completar el último pulso del compás de preparación
          const beatMs = (60 / this.bpm) * (4 / this.denominator) * 1000
          setTimeout(() => {
            if (!this.isRecording) return
            this.inCountIn = false
            this.segmentStartTime = performance.now()
            if (this.onCountIn) this.onCountIn(0, this.numerator)
          }, Math.max(50, beatMs - 40))
        }
        return
      }

      if (this.onBeat) this.onBeat(beatIdx)
    })
  }

  processPitchFrame(pitch) {
    const now = performance.now()
    const detectedMidi = pitch ? pitch.midiNote + this.octaveOffset : null

    // Si seguimos en la misma nota (o silencio), reiniciamos el candidato
    if (detectedMidi === this.activeMidi) {
      this.candidateMidi = undefined
      this.candidateFrames = 0
      return
    }

    // Estabilidad: exigir 3 cuadros seguidos para cambiar de nota (4 para cortar a silencio)
    if (detectedMidi === this.candidateMidi) {
      this.candidateFrames++
    } else {
      this.candidateMidi = detectedMidi
      this.candidateFrames = 1
    }

    const requiredFrames = detectedMidi === null ? 4 : 3
    if (this.candidateFrames < requiredFrames) return

    // Confirmado cambio real de estado: cerrar y cuantizar el segmento anterior
    if (this.hasStartedFirstNote && this.segmentStartTime > 0) {
      this.commitSegment(this.activeMidi, now - this.segmentStartTime)
    }

    if (detectedMidi !== null) {
      this.hasStartedFirstNote = true
    }

    this.activeMidi = detectedMidi
    this.segmentStartTime = now
    this.candidateMidi = undefined
    this.candidateFrames = 0
  }

  commitSegment(midi, durationMs) {
    const secondsPerQuarter = 60 / this.bpm
    const rawBeats = (durationMs / 1000) / secondsPerQuarter
    const q = this.quantizeBeats
    let quantizedBeats = Math.round(rawBeats / q) * q

    // Evitar perder notas muy breves reales si superan el 40% de la rejilla
    if (quantizedBeats === 0 && midi !== null && rawBeats >= q * 0.4) {
      quantizedBeats = q
    }

    // Ignorar silencios demasiado cortos (respiraciones o micro-cortes entre notas)
    if (quantizedBeats < q) return

    if (this.onChunkCommitted) {
      this.onChunkCommitted({
        isRest: midi === null,
        midi,
        beats: quantizedBeats,
      })
    }
  }

  stop(commitLast = true) {
    if (commitLast && this.isRecording && !this.inCountIn && this.hasStartedFirstNote && this.activeMidi !== null) {
      this.commitSegment(this.activeMidi, performance.now() - this.segmentStartTime)
    }

    this.isRecording = false
    this.inCountIn = false
    this.metronome.stop()
    this.pitchDetector.stop()
  }
}