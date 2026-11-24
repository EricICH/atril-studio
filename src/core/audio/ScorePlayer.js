import { durationToQuarterBeats } from '../score/MusicXMLParser'

const DYNAMIC_GAIN_MAP = {
  pp: 0.14,
  p: 0.28,
  mp: 0.45,
  mf: 0.65,
  f: 0.85,
  ff: 1.0,
}

export class ScorePlayer {
  constructor() {
    this.audioCtx = null
    this.masterGain = null
    this.roomBus = null
    this.noiseBuffer = null

    this.isPlaying = false
    this.instrument = 'piano'
    this.tempoScale = 1.0
    this.muteAudio = false
    this.clickTrack = true
    this.countIn = true

    this.score = null
    this.bpm = 100
    this.measureIdx = 0
    this.eventIdx = 0
    this.nextEventTime = 0
    this.lookaheadSec = 0.12
    this.scheduleIntervalMs = 25
    this.timerId = null
    this.visualRafId = null

    this.visualQueue = []
    this.onCountIn = null
    this.onPositionChange = null
    this.onFinish = null

    // Estado de ligadura activa por altura MIDI
    this.activeTiedNotes = new Map() // midi -> { stopAt, gainNode, oscList, currentPeak }
  }

  ensureContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      this.audioCtx = new AudioCtx()
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume()
    }
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.createAttackNoiseBuffer()
    }
    if (!this.masterGain) {
      this.masterGain = this.audioCtx.createGain()
      this.masterGain.gain.value = this.muteAudio ? 0 : 0.88

      // Red de ecos cortos difusos para simular acústica de sala / resonancia de caja
      const roomMixer = this.audioCtx.createGain()
      roomMixer.gain.value = 0.24

      const delayTimes = [0.029, 0.047, 0.073]
      delayTimes.forEach((dt, idx) => {
        const delay = this.audioCtx.createDelay(0.25)
        delay.delayTime.value = dt

        const fb = this.audioCtx.createGain()
        fb.gain.value = 0.22 - idx * 0.04

        const lp = this.audioCtx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 2600 - idx * 450

        const tapGain = this.audioCtx.createGain()
        tapGain.gain.value = 0.35 / (idx + 1)

        this.masterGain.connect(delay)
        delay.connect(lp)
        lp.connect(fb)
        fb.connect(delay)
        lp.connect(tapGain)
        tapGain.connect(roomMixer)
      })

      this.masterGain.connect(this.audioCtx.destination)
      roomMixer.connect(this.audioCtx.destination)

      this.roomBus = this.masterGain
    }
  }

  createAttackNoiseBuffer() {
    const length = Math.floor(this.audioCtx.sampleRate * 0.08)
    const buffer = this.audioCtx.createBuffer(1, length, this.audioCtx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      // Decaimiento rápido para simular púa, martillo o inicio de consonante/aire
      const env = Math.pow(1 - i / length, 2.5)
      data[i] = (Math.random() * 2 - 1) * env
    }
    return buffer
  }

  setInstrument(inst) {
    this.instrument = inst || 'piano'
  }

  setTempoScale(scale) {
    this.tempoScale = Math.max(0.25, Math.min(2.5, Number(scale) || 1))
  }

  setMuteAudio(muted) {
    this.muteAudio = Boolean(muted)
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(this.muteAudio ? 0 : 0.88, this.audioCtx.currentTime, 0.02)
    }
  }

  setClickTrack(enabled) {
    this.clickTrack = Boolean(enabled)
  }

  setCountIn(enabled) {
    this.countIn = Boolean(enabled)
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  triggerClick(time, isDownbeat = false) {
    if (!this.clickTrack || this.muteAudio || !this.audioCtx || !this.roomBus) return

    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(isDownbeat ? 1240 : 860, time)
    osc.frequency.exponentialRampToValueAtTime(isDownbeat ? 520 : 380, time + 0.035)

    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(isDownbeat ? 0.22 : 0.13, time + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.042)

    osc.connect(gain)
    gain.connect(this.roomBus)

    osc.start(time)
    osc.stop(time + 0.048)
  }

  triggerAttackTransient(actualStart, gainAmount, highpassFreq = 1200, duration = 0.025) {
    if (!this.noiseBuffer || gainAmount <= 0.002) return
    const src = this.audioCtx.createBufferSource()
    src.buffer = this.noiseBuffer

    const hp = this.audioCtx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(highpassFreq, actualStart)

    const g = this.audioCtx.createGain()
    g.gain.setValueAtTime(Math.min(0.25, gainAmount), actualStart)
    g.gain.exponentialRampToValueAtTime(0.0001, actualStart + duration)

    src.connect(hp)
    hp.connect(g)
    g.connect(this.roomBus)

    src.start(actualStart)
    src.stop(actualStart + duration + 0.01)
  }

  // Sintetiza una nota con parciales armónicos, resonancia de cuerpo y articulación
  triggerInstrumentNote(midi, startTime, durationSec, eventMeta = {}) {
    if (this.muteAudio || !this.audioCtx || !this.roomBus) return

    const {
      dynamic = null,
      articulation = null,
      tieStart = false,
      tieEnd = false,
      strumOffsetSec = 0,
    } = eventMeta

    const actualStart = startTime + strumOffsetSec
    const baseDyn = dynamic && DYNAMIC_GAIN_MAP[dynamic] !== undefined ? DYNAMIC_GAIN_MAP[dynamic] : 0.65

    let gainLevel = baseDyn
    let effectiveDuration = durationSec
    let releaseTail = 0.22
    let attackTime = 0.012

    // Ajustes por articulación / técnica profesional
    if (articulation === 'staccato') {
      effectiveDuration = Math.min(durationSec * 0.42, Math.max(0.07, durationSec - 0.08))
      releaseTail = 0.05
    } else if (articulation === 'accent') {
      gainLevel = Math.min(1.0, baseDyn * 1.28)
      attackTime = 0.004
    } else if (articulation === 'tenuto') {
      effectiveDuration = durationSec * 0.98
      releaseTail = 0.16
    } else if (articulation === 'pizzicato') {
      effectiveDuration = Math.min(durationSec * 0.32, 0.13)
      releaseTail = 0.05
      attackTime = 0.003
    } else if (articulation === 'arco') {
      attackTime = 0.055
      releaseTail = 0.24
    } else if (articulation === 'letRing') {
      releaseTail = Math.max(1.35, durationSec * 1.8)
    }

    // Si viene ligada desde la nota anterior de la misma altura, extender la anterior sin re-atacar
    if (tieEnd && this.activeTiedNotes.has(midi)) {
      const prev = this.activeTiedNotes.get(midi)
      const newEnd = actualStart + effectiveDuration + releaseTail
      if (prev && prev.gainNode && prev.oscList) {
        prev.gainNode.gain.cancelScheduledValues(actualStart)
        prev.gainNode.gain.setValueAtTime(Math.max(0.001, prev.currentPeak), actualStart)
        prev.gainNode.gain.exponentialRampToValueAtTime(0.0001, newEnd)
        prev.oscList.forEach((o) => {
          try { o.stop(newEnd + 0.03) } catch {}
        })
        if (!tieStart) {
          this.activeTiedNotes.delete(midi)
        } else {
          prev.stopAt = newEnd
        }
        return
      }
    }

    const freq = this.midiToFreq(midi)
    const noteGain = this.audioCtx.createGain()
    const filter = this.audioCtx.createBiquadFilter()
    const oscs = []

    const fundOsc = this.audioCtx.createOscillator()
    const h2Osc = this.audioCtx.createOscillator()
    const h3Osc = this.audioCtx.createOscillator()
    const h2Gain = this.audioCtx.createGain()
    const h3Gain = this.audioCtx.createGain()

    if (this.instrument === 'guitar') {
      // Cuerda vibrante: fundamental + 2º armónico cálido + 3º armónico sutil con leve desafinación orgánica
      fundOsc.type = 'triangle'
      h2Osc.type = 'sine'
      h3Osc.type = 'sine'

      fundOsc.frequency.setValueAtTime(freq, actualStart)
      h2Osc.frequency.setValueAtTime(freq * 2 * 1.0012, actualStart)
      h3Osc.frequency.setValueAtTime(freq * 3 * 0.9985, actualStart)

      h2Gain.gain.setValueAtTime(articulation === 'pizzicato' ? 0.12 : 0.28, actualStart)
      h2Gain.gain.exponentialRampToValueAtTime(0.02, actualStart + Math.max(0.15, effectiveDuration + releaseTail * 0.7))

      h3Gain.gain.setValueAtTime(articulation === 'pizzicato' ? 0.05 : 0.11, actualStart)
      h3Gain.gain.exponentialRampToValueAtTime(0.005, actualStart + Math.max(0.1, effectiveDuration * 0.8 + releaseTail * 0.4))

      // Resonancia cálida de caja de guitarra y decaimiento natural de cuerda al aire
      filter.type = 'lowpass'
      const startCutoff = Math.min(6200, freq * (4.5 + gainLevel * 2.2))
      const endCutoff = Math.max(320, freq * 1.4)
      filter.frequency.setValueAtTime(startCutoff, actualStart)
      filter.frequency.exponentialRampToValueAtTime(endCutoff, actualStart + effectiveDuration + releaseTail)
      filter.Q.setValueAtTime(1.15, actualStart)

      if (!eventMeta.articulation && durationSec >= 0.4) {
        releaseTail = Math.max(releaseTail, 0.85)
      }

      this.triggerAttackTransient(
        actualStart,
        gainLevel * (articulation === 'pizzicato' ? 0.14 : 0.09),
        1400,
        articulation === 'pizzicato' ? 0.015 : 0.022
      )

      oscs.push(fundOsc, h2Osc, h3Osc)
      fundOsc.connect(filter)
      h2Osc.connect(h2Gain)
      h2Gain.connect(filter)
      h3Osc.connect(h3Gain)
      h3Gain.connect(filter)
    } else if (this.instrument === 'voice') {
      // Timbre vocal con formantes suaves y leve vibrato natural en notas largas
      fundOsc.type = 'sawtooth'
      h2Osc.type = 'triangle'
      h3Osc.type = 'sine'

      fundOsc.frequency.setValueAtTime(freq, actualStart)
      h2Osc.frequency.setValueAtTime(freq * 2, actualStart)
      h3Osc.frequency.setValueAtTime(freq * 1.002, actualStart) // grosor vocal sutil

      if (durationSec >= 0.55 && articulation !== 'staccato' && articulation !== 'pizzicato') {
        const lfo = this.audioCtx.createOscillator()
        const lfoGain = this.audioCtx.createGain()
        lfo.type = 'sine'
        lfo.frequency.setValueAtTime(5.2, actualStart + 0.18)
        lfoGain.gain.setValueAtTime(0.0001, actualStart)
        lfoGain.gain.linearRampToValueAtTime(freq * 0.006, actualStart + 0.35)
        lfo.connect(lfoGain)
        lfoGain.connect(fundOsc.frequency)
        lfo.start(actualStart + 0.18)
        lfo.stop(actualStart + effectiveDuration + releaseTail + 0.02)
        oscs.push(lfo)
      }

      h2Gain.gain.setValueAtTime(0.22, actualStart)
      h3Gain.gain.setValueAtTime(0.32, actualStart)

      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(Math.max(480, freq * 2.1), actualStart)
      filter.Q.setValueAtTime(1.4, actualStart)

      attackTime = Math.max(attackTime, 0.045)
      this.triggerAttackTransient(actualStart, gainLevel * 0.04, 1800, 0.025)

      oscs.push(fundOsc, h2Osc, h3Osc)
      fundOsc.connect(filter)
      h2Osc.connect(h2Gain)
      h2Gain.connect(filter)
      h3Osc.connect(h3Gain)
      h3Gain.connect(filter)
    } else {
      // Piano: ataque percutido de martillo + armónicos con decaimiento progresivo
      fundOsc.type = 'triangle'
      h2Osc.type = 'sine'
      h3Osc.type = 'sine'

      fundOsc.frequency.setValueAtTime(freq, actualStart)
      h2Osc.frequency.setValueAtTime(freq * 2, actualStart)
      h3Osc.frequency.setValueAtTime(freq * 3, actualStart)

      h2Gain.gain.setValueAtTime(0.24, actualStart)
      h2Gain.gain.exponentialRampToValueAtTime(0.04, actualStart + Math.max(0.12, effectiveDuration * 0.8 + releaseTail * 0.5))

      h3Gain.gain.setValueAtTime(0.1, actualStart)
      h3Gain.gain.exponentialRampToValueAtTime(0.004, actualStart + Math.max(0.08, effectiveDuration * 0.45))

      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(Math.min(7200, freq * (5 + gainLevel * 2)), actualStart)
      filter.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 1.8), actualStart + effectiveDuration + releaseTail)

      if (!eventMeta.articulation && durationSec >= 0.45) {
        releaseTail = Math.max(releaseTail, 0.42)
      }

      this.triggerAttackTransient(actualStart, gainLevel * 0.07, 1600, 0.015)

      oscs.push(fundOsc, h2Osc, h3Osc)
      fundOsc.connect(filter)
      h2Osc.connect(h2Gain)
      h2Gain.connect(filter)
      h3Osc.connect(h3Gain)
      h3Gain.connect(filter)
    }

    const peak = Math.max(0.015, gainLevel * 0.4)
    const sustainLevel = Math.max(0.003, peak * (this.instrument === 'guitar' ? 0.48 : 0.58))
    const totalEnd = actualStart + effectiveDuration + releaseTail

    noteGain.gain.setValueAtTime(0.0001, actualStart)
    noteGain.gain.linearRampToValueAtTime(peak, actualStart + attackTime)
    noteGain.gain.exponentialRampToValueAtTime(
      sustainLevel,
      actualStart + Math.max(attackTime + 0.02, effectiveDuration * 0.65)
    )
    noteGain.gain.exponentialRampToValueAtTime(0.0001, totalEnd)

    filter.connect(noteGain)
    noteGain.connect(this.roomBus)

    oscs.forEach((o) => {
      o.start(actualStart)
      o.stop(totalEnd + 0.03)
    })

    if (tieStart) {
      this.activeTiedNotes.set(midi, {
        stopAt: totalEnd,
        gainNode: noteGain,
        oscList: oscs,
        currentPeak: sustainLevel,
      })
    }
  }

  getEventDurationSec(ev, timeSignature) {
    const qBeats = durationToQuarterBeats(ev.duration, ev.dotted)
    const beatFactor = 4 / (timeSignature?.denominator || 4)
    const quarterSec = 60 / (this.bpm * this.tempoScale)
    return qBeats * beatFactor * quarterSec
  }

  async start(score, startMeasureIdx = 0, callbacks = {}) {
    this.stop()
    if (!score || !score.measures?.length) return

    this.ensureContext()
    this.score = score
    this.bpm = score.bpm || 100
    this.measureIdx = Math.max(0, Math.min(startMeasureIdx, score.measures.length - 1))
    this.eventIdx = 0
    this.visualQueue = []
    this.activeTiedNotes.clear()

    this.onCountIn = callbacks.onCountIn || null
    this.onPositionChange = callbacks.onPositionChange || null
    this.onFinish = callbacks.onFinish || null

    this.isPlaying = true
    let scheduleCursor = this.audioCtx.currentTime + 0.05

    if (this.countIn) {
      const num = score.timeSignature?.numerator || 4
      const den = score.timeSignature?.denominator || 4
      const beatSec = (60 / (this.bpm * this.tempoScale)) * (4 / den)

      for (let b = 1; b <= num; b++) {
        const beatTime = scheduleCursor + (b - 1) * beatSec
        this.triggerClick(beatTime, b === 1)
        this.visualQueue.push({
          type: 'countIn',
          beat: b,
          total: num,
          time: beatTime,
        })
      }
      scheduleCursor += num * beatSec
    }

    this.nextEventTime = scheduleCursor

    this.timerId = setInterval(() => this.scheduler(), this.scheduleIntervalMs)
    this.startVisualLoop()
  }

  scheduler() {
    if (!this.isPlaying || !this.score || !this.audioCtx) return

    while (this.nextEventTime < this.audioCtx.currentTime + this.lookaheadSec) {
      if (this.measureIdx >= this.score.measures.length) {
        this.scheduleFinish(this.nextEventTime)
        break
      }

      const measure = this.score.measures[this.measureIdx]
      const events = measure.events || []

      if (this.eventIdx >= events.length) {
        this.measureIdx++
        this.eventIdx = 0
        continue
      }

      const ev = events[this.eventIdx]
      const durationSec = this.getEventDurationSec(ev, this.score.timeSignature)

      if (this.eventIdx === 0) {
        this.triggerClick(this.nextEventTime, true)
      }

      if (!ev.isRest && ev.notes?.length) {
        const isGuitarStrum = this.instrument === 'guitar' && ev.notes.length > 1
        ev.notes.forEach((nObj, nIdx) => {
          this.triggerInstrumentNote(nObj.midi, this.nextEventTime, durationSec, {
            dynamic: ev.dynamic || null,
            articulation: ev.articulation || null,
            tieStart: Boolean(ev.tieStart),
            tieEnd: Boolean(ev.tieEnd),
            strumOffsetSec: isGuitarStrum ? nIdx * 0.016 : 0,
          })
        })
      }

      this.visualQueue.push({
        type: 'note',
        measureIdx: this.measureIdx,
        eventIdx: this.eventIdx,
        durationMs: Math.round(durationSec * 1000),
        time: this.nextEventTime,
      })

      this.nextEventTime += durationSec
      this.eventIdx++
    }
  }

  scheduleFinish(finishTime) {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    this.visualQueue.push({
      type: 'finish',
      time: finishTime,
    })
  }

  startVisualLoop() {
    const tick = () => {
      if (!this.isPlaying || !this.audioCtx) return
      const now = this.audioCtx.currentTime

      while (this.visualQueue.length > 0 && this.visualQueue[0].time <= now) {
        const item = this.visualQueue.shift()
        if (item.type === 'countIn' && this.onCountIn) {
          this.onCountIn(item.beat, item.total)
        } else if (item.type === 'note' && this.onPositionChange) {
          this.onPositionChange({
            measureIdx: item.measureIdx,
            eventIdx: item.eventIdx,
            durationMs: item.durationMs,
          })
        } else if (item.type === 'finish') {
          this.stop()
          if (this.onFinish) this.onFinish()
          return
        }
      }

      this.visualRafId = requestAnimationFrame(tick)
    }

    this.visualRafId = requestAnimationFrame(tick)
  }

  stop() {
    this.isPlaying = false
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    if (this.visualRafId) {
      cancelAnimationFrame(this.visualRafId)
      this.visualRafId = null
    }
    this.visualQueue = []
    this.activeTiedNotes.clear()
  }
}