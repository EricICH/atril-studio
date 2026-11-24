const KEY_FIFTHS_MAP = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  '0': 'C',
  '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#',
}

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const TYPE_TO_VEX = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
  '32nd': '32',
}

const ARTICULATION_TAG_MAP = {
  staccato: 'staccato',
  accent: 'accent',
  tenuto: 'tenuto',
  pizzicato: 'pizzicato',
  'down-bow': 'arco',
  'up-bow': 'arco',
}

function normalizeDynamicText(rawText) {
  const clean = String(rawText || '').trim().toLowerCase()
  if (['pp', 'p', 'mp', 'mf', 'f', 'ff'].includes(clean)) return clean
  return null
}

export function durationToQuarterBeats(duration, dotted = false) {
  const baseMap = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 }
  const base = baseMap[duration] ?? 1
  return dotted ? base * 1.5 : base
}

function durationFromQuarterBeats(beats) {
  if (beats >= 3.75) return { duration: 'w', dotted: false }
  if (beats >= 2.75) return { duration: 'h', dotted: true }
  if (beats >= 1.75) return { duration: 'h', dotted: false }
  if (beats >= 1.35) return { duration: 'q', dotted: true }
  if (beats >= 0.85) return { duration: 'q', dotted: false }
  if (beats >= 0.65) return { duration: '8', dotted: true }
  if (beats >= 0.4) return { duration: '8', dotted: false }
  return { duration: '16', dotted: false }
}

function alterToAccidental(alter) {
  if (alter === 1) return '#'
  if (alter === -1) return 'b'
  if (alter === 2) return '##'
  if (alter === -2) return 'bb'
  return null
}

// Revisa si cada compás suma exactamente lo que exige su cifra de compás
export function validateMeasures(score) {
  const warnings = []
  const expectedQuarterBeats = score.timeSignature.numerator * (4 / score.timeSignature.denominator)

  score.measures.forEach((measure, idx) => {
    const actualBeats = measure.events.reduce(
      (sum, ev) => sum + durationToQuarterBeats(ev.duration, ev.dotted),
      0
    )
    const diff = Math.abs(actualBeats - expectedQuarterBeats)
    if (diff > 0.05) {
      warnings.push({
        measureNumber: idx + 1,
        expected: expectedQuarterBeats,
        actual: Number(actualBeats.toFixed(2)),
      })
    }
  })

  return warnings
}

export function parseMusicXML(xmlText, fallbackTitle = 'Partitura Importada', instrument = 'piano') {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')

  if (doc.querySelector('parsererror')) {
    throw new Error('El archivo no es un MusicXML válido.')
  }

  const title =
    doc.querySelector('work > work-title')?.textContent?.trim() ||
    doc.querySelector('movement-title')?.textContent?.trim() ||
    fallbackTitle.replace(/\.(musicxml|xml)$/i, '')

  const composer =
    doc.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ||
    'Autor desconocido'

  const part = doc.querySelector('part')
  if (!part) {
    throw new Error('No se encontró ninguna parte musical dentro del archivo.')
  }

  let divisions = 1
  let bpm = 100
  let clef = 'treble'
  let keySignature = 'C'
  let timeSignature = { numerator: 4, denominator: 4 }

  // Detectar tempo si viene especificado en el archivo
  const soundTempo = doc.querySelector('sound[tempo]')?.getAttribute('tempo')
  const perMinute = doc.querySelector('metronome > per-minute')?.textContent
  if (soundTempo && !Number.isNaN(Number(soundTempo))) {
    bpm = Math.round(Number(soundTempo))
  } else if (perMinute && !Number.isNaN(Number(perMinute))) {
    bpm = Math.round(Number(perMinute))
  }

  const measureNodes = Array.from(part.querySelectorAll('measure'))
  const measures = []

  measureNodes.forEach((mNode, mIndex) => {
    const divText = mNode.querySelector('attributes > divisions')?.textContent
    if (divText) divisions = Math.max(1, Number(divText))

    if (mIndex === 0) {
      const fifths = mNode.querySelector('attributes > key > fifths')?.textContent
      if (fifths !== undefined && fifths !== null && KEY_FIFTHS_MAP[fifths.trim()]) {
        keySignature = KEY_FIFTHS_MAP[fifths.trim()]
      }

      const beats = mNode.querySelector('attributes > time > beats')?.textContent
      const beatType = mNode.querySelector('attributes > time > beat-type')?.textContent
      if (beats && beatType) {
        timeSignature = { numerator: Number(beats), denominator: Number(beatType) }
      }

      const clefSign = mNode.querySelector('attributes > clef > sign')?.textContent?.trim()
      if (clefSign === 'F') clef = 'bass'
    }

    const events = []
    let primaryVoice = null
    const noteNodes = Array.from(mNode.querySelectorAll(':scope > note'))

    noteNodes.forEach((nNode) => {
      // Ignorar adornos sin duración real (grace notes)
      if (nNode.querySelector('grace')) return

      // Mantener solo la voz principal y pentagrama 1 para evitar colisiones rítmicas
      const staff = nNode.querySelector('staff')?.textContent?.trim()
      if (staff && staff !== '1') return

      const voice = nNode.querySelector('voice')?.textContent?.trim() || '1'
      if (!primaryVoice) primaryVoice = voice
      if (voice !== primaryVoice) return

      const isChord = Boolean(nNode.querySelector('chord'))
      const isRest = Boolean(nNode.querySelector('rest'))

      const rawType = nNode.querySelector('type')?.textContent?.trim()
      const rawDuration = Number(nNode.querySelector('duration')?.textContent || divisions)
      const dotted = Boolean(nNode.querySelector('dot'))

      let duration = TYPE_TO_VEX[rawType]
      let finalDotted = dotted

      if (!duration) {
        const inferred = durationFromQuarterBeats(rawDuration / divisions)
        duration = inferred.duration
        finalDotted = inferred.dotted
      }

      const tieTypes = Array.from(nNode.querySelectorAll('tie')).map(t => t.getAttribute('type'))
      const slurTypes = Array.from(nNode.querySelectorAll('notations > slur')).map(s => s.getAttribute('type'))
      const dynamicEl = nNode.querySelector('notations > dynamics > *')
      const dynamicTag = dynamicEl ? normalizeDynamicText(dynamicEl.tagName) : null

      let articulation = null
      for (const [xmlTag, appArt] of Object.entries(ARTICULATION_TAG_MAP)) {
        if (
          nNode.querySelector(`notations > articulations > ${xmlTag}`) ||
          nNode.querySelector(`notations > technical > ${xmlTag}`)
        ) {
          articulation = appArt
          break
        }
      }

      let noteObj = null
      if (!isRest) {
        const step = nNode.querySelector('pitch > step')?.textContent?.trim() || 'C'
        const octave = Number(nNode.querySelector('pitch > octave')?.textContent || 4)
        const alter = Number(nNode.querySelector('pitch > alter')?.textContent || 0)

        const midi = (octave + 1) * 12 + (STEP_TO_SEMITONE[step] ?? 0) + alter
        const accidental = alterToAccidental(alter)
        const vexKey = `${step.toLowerCase()}${accidental || ''}/${octave}`

        noteObj = { midi, vexKey, accidental }
      }

      // Si pertenece a un acorde, se agrupa en el evento anterior
      if (isChord && events.length > 0 && noteObj && !events[events.length - 1].isRest) {
        events[events.length - 1].notes.push(noteObj)
        events[events.length - 1].notes.sort((a, b) => a.midi - b.midi)
      } else {
        events.push({
          isRest,
          duration,
          dotted: finalDotted,
          notes: noteObj ? [noteObj] : [],
          tieStart: tieTypes.includes('start'),
          tieEnd: tieTypes.includes('stop'),
          slurStart: slurTypes.includes('start'),
          slurEnd: slurTypes.includes('stop'),
          dynamic: dynamicTag,
          articulation,
        })
      }
    })

    // Si el compás vino vacío, colocar silencio de redonda
    if (events.length === 0) {
      events.push({ isRest: true, duration: 'w', dotted: false, notes: [] })
    }

    measures.push({ number: mIndex + 1, events })
  })

  const score = {
    title,
    composer,
    instrument,
    bpm,
    clef,
    keySignature,
    timeSignature,
    measures,
    source: 'musicxml',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  score.warnings = validateMeasures(score)
  return score
}