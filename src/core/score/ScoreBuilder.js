import { durationToQuarterBeats, validateMeasures } from './MusicXMLParser'

const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'])
const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b']

const KEY_TO_FIFTHS = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1,
  C: 0,
  G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
}

const VEX_TO_XML_TYPE = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  '8': 'eighth',
  '16': '16th',
  '32': '32nd',
}

const BEAT_FIGURES = [
  { beats: 4, duration: 'w', dotted: false },
  { beats: 3, duration: 'h', dotted: true },
  { beats: 2, duration: 'h', dotted: false },
  { beats: 1.5, duration: 'q', dotted: true },
  { beats: 1, duration: 'q', dotted: false },
  { beats: 0.75, duration: '8', dotted: true },
  { beats: 0.5, duration: '8', dotted: false },
  { beats: 0.25, duration: '16', dotted: false },
]

// Convierte un número MIDI a objeto de nota respetando la ortografía de la tonalidad
export function midiToScoreNote(midi, keySignature = 'C') {
  const safeMidi = Math.max(36, Math.min(96, Math.round(midi)))
  const idx = ((safeMidi % 12) + 12) % 12
  const octave = Math.floor(safeMidi / 12) - 1
  const table = FLAT_KEYS.has(keySignature) ? FLAT_NAMES : SHARP_NAMES
  const name = table[idx]
  const accidental = name.length > 1 ? name[1] : null

  return {
    midi: safeMidi,
    vexKey: `${name}/${octave}`,
    accidental,
  }
}

export function createBlankScore({
  title = 'Nueva Composición',
  composer = 'Mi Obra',
  instrument = 'piano',
  bpm = 96,
  clef = 'treble',
  keySignature = 'C',
  numerator = 4,
  denominator = 4,
} = {}) {
  const score = {
    title,
    composer,
    instrument,
    bpm: Number(bpm) || 96,
    clef,
    keySignature,
    timeSignature: {
      numerator: Number(numerator) || 4,
      denominator: Number(denominator) || 4,
    },
    measures: [{ number: 1, events: [] }],
    source: 'editor',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  score.warnings = validateMeasures(score)
  return score
}

export function getMeasureCapacity(timeSignature) {
  return timeSignature.numerator * (4 / timeSignature.denominator)
}

export function getMeasureUsedBeats(measure) {
  return (measure?.events || []).reduce(
    (sum, ev) => sum + durationToQuarterBeats(ev.duration, ev.dotted),
    0
  )
}

// Descompone una duración en negras en figuras válidas de partitura
export function decomposeBeatsToFigures(beats) {
  const result = []
  let remaining = Math.round(beats * 4) / 4

  while (remaining >= 0.24) {
    const match = BEAT_FIGURES.find(f => f.beats <= remaining + 0.01)
    if (!match) break
    result.push({ duration: match.duration, dotted: match.dotted })
    remaining = Math.round((remaining - match.beats) * 4) / 4
  }

  return result
}

// Inserta un evento respetando la capacidad del compás (divide automáticamente si cruza barra)
export function appendDurationToMeasures(measures, { isRest, notes, beats }, timeSignature) {
  const capacity = getMeasureCapacity(timeSignature)
  let remaining = Math.round(beats * 4) / 4

  if (measures.length === 0) {
    measures.push({ number: 1, events: [] })
  }

  while (remaining >= 0.24) {
    let lastMeasure = measures[measures.length - 1]
    const used = getMeasureUsedBeats(lastMeasure)
    let spaceLeft = Math.round((capacity - used) * 4) / 4

    if (spaceLeft < 0.24) {
      lastMeasure = { number: measures.length + 1, events: [] }
      measures.push(lastMeasure)
      spaceLeft = capacity
    }

    const slice = Math.min(remaining, spaceLeft)
    const figures = decomposeBeatsToFigures(slice)

    if (figures.length === 0) break

    for (const fig of figures) {
      lastMeasure.events.push({
        isRest,
        duration: fig.duration,
        dotted: fig.dotted,
        notes: isRest ? [] : notes.map(n => ({ ...n })),
      })
    }

    remaining = Math.round((remaining - slice) * 4) / 4
  }
}

// Inserta una figura puntual desde el editor manual (abre nuevo compás si ya no cabe)
export function appendManualEvent(score, { isRest, duration, dotted, notes }) {
  const capacity = getMeasureCapacity(score.timeSignature)
  const evBeats = durationToQuarterBeats(duration, dotted)

  if (score.measures.length === 0) {
    score.measures.push({ number: 1, events: [] })
  }

  let targetIdx = score.measures.length - 1
  const used = getMeasureUsedBeats(score.measures[targetIdx])

  if (used > 0 && used + evBeats > capacity + 0.02) {
    score.measures.push({ number: score.measures.length + 1, events: [] })
    targetIdx = score.measures.length - 1
  }

  score.measures[targetIdx].events.push({
    isRest,
    duration,
    dotted,
    notes: isRest ? [] : notes.map(n => ({ ...n })),
  })

  return {
    measureIdx: targetIdx,
    eventIdx: score.measures[targetIdx].events.length - 1,
  }
}

// Rellena con silencios cualquier compás incompleto
export function fillIncompleteMeasuresWithRests(score) {
  const capacity = getMeasureCapacity(score.timeSignature)
  score.measures.forEach((measure) => {
    const used = getMeasureUsedBeats(measure)
    const missing = Math.round((capacity - used) * 4) / 4
    if (missing >= 0.24) {
      const figs = decomposeBeatsToFigures(missing)
      figs.forEach((fig) => {
        measure.events.push({
          isRest: true,
          duration: fig.duration,
          dotted: fig.dotted,
          notes: [],
        })
      })
    }
  })
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Genera un archivo .musicxml estándar exportable a MuseScore, Finale o Sibelius
export function exportToMusicXML(score) {
  const divisions = 4 // 1 negra = 4 divisiones (soporta hasta semicorcheas exactas)
  const fifths = KEY_TO_FIFTHS[score.keySignature] ?? 0
  const clefSign = score.clef === 'bass' ? 'F' : 'G'
  const clefLine = score.clef === 'bass' ? '4' : '2'

  const ARTICULATION_TO_XML = {
    staccato: { bucket: 'articulations', tag: 'staccato' },
    accent: { bucket: 'articulations', tag: 'accent' },
    tenuto: { bucket: 'articulations', tag: 'tenuto' },
    pizzicato: { bucket: 'technical', tag: 'pizzicato' },
    arco: { bucket: 'technical', tag: 'down-bow' },
    letRing: { bucket: 'notations', tag: 'laissez-vibrer' },
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`
  xml += `<score-partwise version="3.1">\n`
  xml += `  <work><work-title>${escapeXml(score.title)}</work-title></work>\n`
  xml += `  <identification><creator type="composer">${escapeXml(score.composer)}</creator></identification>\n`
  xml += `  <part-list>\n`
  xml += `    <score-part id="P1"><part-name>${escapeXml(score.instrument || 'Piano')}</part-name></score-part>\n`
  xml += `  </part-list>\n`
  xml += `  <part id="P1">\n`

  score.measures.forEach((measure, idx) => {
    xml += `    <measure number="${idx + 1}">\n`
    if (idx === 0) {
      xml += `      <attributes>\n`
      xml += `        <divisions>${divisions}</divisions>\n`
      xml += `        <key><fifths>${fifths}</fifths></key>\n`
      xml += `        <time><beats>${score.timeSignature.numerator}</beats><beat-type>${score.timeSignature.denominator}</beat-type></time>\n`
      xml += `        <clef><sign>${clefSign}</sign><line>${clefLine}</line></clef>\n`
      xml += `      </attributes>\n`
      xml += `      <direction placement="above">\n`
      xml += `        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type>\n`
      xml += `        <sound tempo="${score.bpm}"/>\n`
      xml += `      </direction>\n`
    }

    const events = measure.events.length
      ? measure.events
      : [{ isRest: true, duration: 'w', dotted: false, notes: [] }]

    events.forEach((ev) => {
      const qBeats = durationToQuarterBeats(ev.duration, ev.dotted)
      const xmlDuration = Math.max(1, Math.round(qBeats * divisions))
      const xmlType = VEX_TO_XML_TYPE[ev.duration] || 'quarter'

      const hasNotations =
        ev.tieStart || ev.tieEnd || ev.slurStart || ev.slurEnd || ev.dynamic || ev.articulation

        ev.notes.forEach((nObj, nIdx) => {
          const [rawPitch, rawOct] = nObj.vexKey.split('/')
          const step = rawPitch[0].toUpperCase()
          const alter = rawPitch.includes('#') ? 1 : rawPitch.includes('b') ? -1 : 0
          const octave = Number(rawOct) || 4

          xml += `      <note>\n`
          if (nIdx > 0) xml += `        <chord/>\n`
          xml += `        <pitch>\n`
          xml += `          <step>${step}</step>\n`
          if (alter !== 0) xml += `          <alter>${alter}</alter>\n`
          xml += `          <octave>${octave}</octave>\n`
          xml += `        </pitch>\n`
          xml += `        <duration>${xmlDuration}</duration>\n`
          if (ev.tieStart) xml += `        <tie type="start"/>\n`
          if (ev.tieEnd) xml += `        <tie type="stop"/>\n`
          xml += `        <voice>1</voice>\n`
          xml += `        <type>${xmlType}</type>\n`
          if (ev.dotted) xml += `        <dot/>\n`

          if (nIdx === 0 && hasNotations) {
            xml += `        <notations>\n`
            if (ev.tieStart) xml += `          <tied type="start"/>\n`
            if (ev.tieEnd) xml += `          <tied type="stop"/>\n`
            if (ev.slurStart) xml += `          <slur type="start" number="1"/>\n`
            if (ev.slurEnd) xml += `          <slur type="stop" number="1"/>\n`
            if (ev.dynamic) {
              xml += `          <dynamics><${ev.dynamic}/></dynamics>\n`
            }
            if (ev.articulation && ARTICULATION_TO_XML[ev.articulation]) {
              const artCfg = ARTICULATION_TO_XML[ev.articulation]
              if (artCfg.bucket === 'notations') {
                xml += `          <${artCfg.tag}/>\n`
              } else {
                xml += `          <${artCfg.bucket}><${artCfg.tag}/></${artCfg.bucket}>\n`
              }
            }
            xml += `        </notations>\n`
          }
          xml += `      </note>\n`
        })

      if (ev.isRest || !ev.notes?.length) {
        xml += `      <note>\n`
        xml += `        <rest/>\n`
        xml += `        <duration>${xmlDuration}</duration>\n`
        xml += `        <voice>1</voice>\n`
        xml += `        <type>${xmlType}</type>\n`
        if (ev.dotted) xml += `        <dot/>\n`
        xml += `      </note>\n`
      } else {
        ev.notes.forEach((nObj, nIdx) => {
          const [rawPitch, rawOct] = nObj.vexKey.split('/')
          const step = rawPitch[0].toUpperCase()
          const alter = rawPitch.includes('#') ? 1 : rawPitch.includes('b') ? -1 : 0
          const octave = Number(rawOct) || 4

          xml += `      <note>\n`
          if (nIdx > 0) xml += `        <chord/>\n`
          xml += `        <pitch>\n`
          xml += `          <step>${step}</step>\n`
          if (alter !== 0) xml += `          <alter>${alter}</alter>\n`
          xml += `          <octave>${octave}</octave>\n`
          xml += `        </pitch>\n`
          xml += `        <duration>${xmlDuration}</duration>\n`
          xml += `        <voice>1</voice>\n`
          xml += `        <type>${xmlType}</type>\n`
          if (ev.dotted) xml += `        <dot/>\n`
          xml += `      </note>\n`
        })
      }
    })

    xml += `    </measure>\n`
  })

  xml += `  </part>\n`
  xml += `</score-partwise>\n`
  return xml
}