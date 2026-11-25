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

    // Estado interno de segmentación
    this.hasStartedFirstNote = false
    this.activeMidi = null // null = silencio
    this.segmentStartTime = 0
    this.lastValidPitchTime = 0
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
    this.lastValidPitchTime = 0
    this.candidateMidi = undefined
    this.candidateFrames = 0

    await this.pitchDetector.start((pitch) => {
      if (this.onPitchLive) this.onPitchLive(pitch)
      if (!this.isRecording || this.inCountIn) return
      this.processPitchFrame(pitch)
    })

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
          const beatMs = (60 / this.bpm) * (4 / this.denominator) * 1000
          setTimeout(() => {
            if (!this.isRecording) return
            this.inCountIn = false
            this.segmentStartTime = performance.now()
            this.lastValidPitchTime = this.segmentStartTime
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
    let detectedMidi = pitch ? pitch.midiNote + this.octaveOffset : null

    if (detectedMidi !== null) {
      this.lastValidPitchTime = now
    }

    // Si estamos sosteniendo una nota y hay un hueco de pitch < 130 ms (muy común en guitarra),
    // mantenemos la nota activa para evitar silencios falsos
    if (detectedMidi === null && this.activeMidi !== null) {
      const gapMs = now - this.lastValidPitchTime
      if (gapMs < 130) {
        this.candidateMidi = undefined
        this.candidateFrames = 0
        return
      }
    }

    // Si estamos dentro de la misma nota (o tolerancia de ±1 semitono en guitarra para evitar vibrato/armónico),
    // consolidamos sobre la nota activa
    if (
      detectedMidi !== null &&
      this.activeMidi !== null &&
      Math.abs(detectedMidi - this.activeMidi) <= 1
    ) {
      detectedMidi = this.activeMidi
    }

    if (detectedMidi === this.activeMidi) {
      this.candidateMidi = undefined
      this.candidateFrames = 0
      return
    }

    if (detectedMidi === this.candidateMidi) {
      this.candidateFrames++
    } else {
      this.candidateMidi = detectedMidi
      this.candidateFrames = 1
    }

    // Exigimos más frames para cambiar a una nota nueva (5) o a silencio (6) y evitar notas fantasma
    const requiredFrames = detectedMidi === null ? 6 : 5
    if (this.candidateFrames < requiredFrames) return

    // Evitar segmentos de menos de 90 ms (ataques/ruidos breves)
    const elapsedMs = now - this.segmentStartTime
    if (this.hasStartedFirstNote && this.segmentStartTime > 0 && elapsedMs >= 90) {
      this.commitSegment(this.activeMidi, elapsedMs)
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

    // Cuantización conservadora: evita inflar notas cortas a figuras largas
    let quantizedBeats = Math.round(rawBeats / q) * q

    if (quantizedBeats === 0 && midi !== null && rawBeats >= q * 0.55) {
      quantizedBeats = q
    }

    // Solo insertamos silencios intencionales de al menos 1 pulso/rejilla completa
    if (midi === null && quantizedBeats < Math.max(q, 1)) return
    if (midi !== null && quantizedBeats < q) return

    if (this.onChunkCommitted) {
      this.onChunkCommitted({
        isRest: midi === null,
        midi,
        beats: quantizedBeats,
      })
    }
  }

  stop(commitLast = true) {
    if (
      commitLast &&
      this.isRecording &&
      !this.inCountIn &&
      this.hasStartedFirstNote &&
      this.activeMidi !== null
    ) {
      const elapsedMs = performance.now() - this.segmentStartTime
      if (elapsedMs >= 90) {
        this.commitSegment(this.activeMidi, elapsedMs)
      }
    }

    this.isRecording = false
    this.inCountIn = false
    this.metronome.stop()
    this.pitchDetector.stop()
  }
}