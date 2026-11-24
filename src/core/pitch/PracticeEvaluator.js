const INSTRUMENT_PROFILES = {
  piano: {
    perfectCents: 25,
    okCents: 45,
    maxHitAttackRatio: 0.45,
    transposeDownOctave: false,
  },
  guitar: {
    perfectCents: 30,
    okCents: 50,
    maxHitAttackRatio: 0.5,
    transposeDownOctave: true, // La guitarra suena una octava abajo de lo escrito
  },
  voice: {
    perfectCents: 38, // Tolerancia al vibrato natural
    okCents: 55,
    maxHitAttackRatio: 0.55,
    transposeDownOctave: false,
  },
}

const NOTES_LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']

export function midiToLatinName(midi) {
  const idx = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTES_LATIN[idx]}${octave}`
}

export class PracticeEvaluator {
  constructor() {
    this.reset()
  }

  reset() {
    this.score = null
    this.instrument = 'piano'
    this.allowOctaveShift = false
    this.activeWindow = null
    this.evaluatedEvents = []
    this.resultsMap = {}
    this.onNoteEvaluated = null
  }

  start(score, options = {}) {
    this.reset()
    this.score = score
    this.instrument = options.instrument || score?.instrument || 'piano'
    this.allowOctaveShift = Boolean(options.allowOctaveShift)
    this.onNoteEvaluated = options.onNoteEvaluated || null
  }

  getProfile() {
    return INSTRUMENT_PROFILES[this.instrument] || INSTRUMENT_PROFILES.piano
  }

  // Se invoca cada vez que el cursor Karaoke avanza a una nueva nota
  onPositionChange({ measureIdx, eventIdx, durationMs }) {
    this.finalizeCurrentWindow()

    const measure = this.score?.measures?.[measureIdx]
    const event = measure?.events?.[eventIdx]
    if (!event) return

    // Los silencios no suman ni restan puntaje
    if (event.isRest || !event.notes?.length) {
      this.activeWindow = null
      return
    }

    const expectedMidis = event.notes.map(n => n.midi)
    const minFrames = durationMs <= 340 ? 2 : 3

    this.activeWindow = {
      key: `${measureIdx}-${eventIdx}`,
      measureIdx,
      eventIdx,
      expectedMidis,
      durationMs: durationMs || 500,
      startTime: performance.now(),
      minFrames,
      matchedSamples: [],
      liveEmitted: false,
    }
  }

  // Recibe la nota captada por PitchDetector cuadro a cuadro
  feedPitch(pitchData) {
    if (!this.activeWindow || !pitchData) return

    const profile = this.getProfile()
    const isMatch = this.matchesExpected(pitchData.midiNote, this.activeWindow.expectedMidis, profile)

    if (!isMatch) return

    this.activeWindow.matchedSamples.push({
      cents: Math.abs(pitchData.cents),
      timestamp: performance.now(),
    })

    // Feedback visual inmediato apenas confirmamos estabilidad mínima de la nota
    if (!this.activeWindow.liveEmitted && this.activeWindow.matchedSamples.length >= this.activeWindow.minFrames) {
      this.activeWindow.liveEmitted = true
      const preview = this.scoreWindow(this.activeWindow)
      this.resultsMap[this.activeWindow.key] = preview.status
      if (this.onNoteEvaluated) {
        this.onNoteEvaluated(this.activeWindow.key, preview.status, this.getLiveStats())
      }
    }
  }

  matchesExpected(detectedMidi, expectedMidis, profile) {
    return expectedMidis.some((target) => {
      if (this.allowOctaveShift) {
        return ((detectedMidi % 12) + 12) % 12 === ((target % 12) + 12) % 12
      }
      if (detectedMidi === target) return true
      if (profile.transposeDownOctave && detectedMidi === target - 12) return true
      return false
    })
  }

  scoreWindow(win) {
    const profile = this.getProfile()

    if (win.matchedSamples.length < win.minFrames) {
      return {
        key: win.key,
        measureIdx: win.measureIdx,
        status: 'miss',
        pitchScore: 0,
        rhythmScore: 0,
        totalScore: 0,
        avgCents: null,
      }
    }

    const avgCents =
      win.matchedSamples.reduce((sum, s) => sum + s.cents, 0) / win.matchedSamples.length

    const firstHitDelayMs = Math.max(0, win.matchedSamples[0].timestamp - win.startTime)

    // Calificación de afinación (0 a 1)
    let pitchScore = 0.55
    if (avgCents <= profile.perfectCents) pitchScore = 1.0
    else if (avgCents <= profile.okCents) pitchScore = 0.75

    // Calificación rítmica de ataque (0 a 1)
    const idealAttackMs = Math.min(260, Math.max(150, win.durationMs * profile.maxHitAttackRatio))
    let rhythmScore = 0.45
    if (firstHitDelayMs <= idealAttackMs) rhythmScore = 1.0
    else if (firstHitDelayMs <= win.durationMs * 0.8) rhythmScore = 0.7

    // Ponderación: 60% afinación/nota + 40% ritmo
    const totalScore = pitchScore * 0.6 + rhythmScore * 0.4
    const status = pitchScore === 1.0 && rhythmScore === 1.0 ? 'hit' : 'partial'

    return {
      key: win.key,
      measureIdx: win.measureIdx,
      status,
      pitchScore,
      rhythmScore,
      totalScore,
      avgCents: Math.round(avgCents),
    }
  }

  finalizeCurrentWindow() {
    if (!this.activeWindow) return

    const result = this.scoreWindow(this.activeWindow)
    this.evaluatedEvents.push(result)
    this.resultsMap[result.key] = result.status

    if (this.onNoteEvaluated) {
      this.onNoteEvaluated(result.key, result.status, this.getLiveStats())
    }

    this.activeWindow = null
  }

  getLiveStats() {
    const total = this.evaluatedEvents.length
    if (total === 0) return { accuracy: 0, hit: 0, partial: 0, miss: 0, total: 0 }

    let sumTotal = 0
    let hit = 0
    let partial = 0
    let miss = 0

    for (const item of this.evaluatedEvents) {
      sumTotal += item.totalScore
      if (item.status === 'hit') hit++
      else if (item.status === 'partial') partial++
      else miss++
    }

    return {
      accuracy: Math.round((sumTotal / total) * 100),
      hit,
      partial,
      miss,
      total,
    }
  }

  getCurrentExpectedLabel() {
    if (!this.activeWindow?.expectedMidis?.length) return '--'
    return this.activeWindow.expectedMidis.map(midiToLatinName).join(' + ')
  }

  finish() {
    this.finalizeCurrentWindow()

    const total = this.evaluatedEvents.length
    if (total === 0) return null

    let sumTotal = 0
    let sumPitch = 0
    let sumRhythm = 0
    let centsCount = 0
    let centsSum = 0
    const counts = { total, hit: 0, partial: 0, miss: 0 }
    const byMeasure = new Map()

    for (const ev of this.evaluatedEvents) {
      sumTotal += ev.totalScore
      sumPitch += ev.pitchScore
      sumRhythm += ev.rhythmScore
      counts[ev.status]++

      if (ev.avgCents !== null) {
        centsSum += ev.avgCents
        centsCount++
      }

      if (!byMeasure.has(ev.measureIdx)) {
        byMeasure.set(ev.measureIdx, { sum: 0, count: 0, misses: 0 })
      }
      const mStats = byMeasure.get(ev.measureIdx)
      mStats.sum += ev.totalScore
      mStats.count++
      if (ev.status !== 'hit') mStats.misses++
    }

    // Identificar compases por debajo de 80% para ofrecer práctica dirigida
    const weakMeasures = []
    byMeasure.forEach((stats, measureIdx) => {
      const mAccuracy = Math.round((stats.sum / stats.count) * 100)
      if (mAccuracy < 80) {
        weakMeasures.push({
          measureIdx,
          measureNumber: measureIdx + 1,
          accuracy: mAccuracy,
          misses: stats.misses,
        })
      }
    })
    weakMeasures.sort((a, b) => a.accuracy - b.accuracy)

    return {
      accuracy: Math.round((sumTotal / total) * 100),
      pitchAccuracy: Math.round((sumPitch / total) * 100),
      rhythmAccuracy: Math.round((sumRhythm / total) * 100),
      avgCents: centsCount > 0 ? Math.round(centsSum / centsCount) : null,
      counts,
      weakMeasures,
    }
  }
}