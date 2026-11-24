import Dexie from 'dexie'
import { validateMeasures } from '../score/MusicXMLParser'

export const db = new Dexie('AtrilStudioDB')

db.version(1).stores({
  scores: '++id, title, instrument, createdAt, updatedAt',
  practiceLogs: '++id, scoreId, date, accuracy, instrument',
})

db.version(2).stores({
  scores: '++id, title, instrument, createdAt, updatedAt',
  practiceLogs: '++id, scoreId, date, accuracy, instrument',
  omrQueue: '++id, filename, createdAt',
})

// Ayudante compacto para construir notas de ejemplo
const n = (vexKey, midi, accidental = null) => ({ vexKey, midi, accidental })
const ev = (duration, notes, dotted = false) => ({
  isRest: notes.length === 0,
  duration,
  dotted,
  notes: [...notes].sort((a, b) => a.midi - b.midi),
})

const SAMPLE_SCORES = [
  {
    title: 'Oda a la Alegría (Tema)',
    composer: 'L. van Beethoven',
    instrument: 'piano',
    bpm: 108,
    clef: 'treble',
    keySignature: 'C',
    timeSignature: { numerator: 4, denominator: 4 },
    source: 'builtin',
    measures: [
      {
        number: 1,
        events: [
          ev('q', [n('c/4', 60), n('e/4', 64)]),
          ev('q', [n('e/4', 64)]),
          ev('q', [n('f/4', 65)]),
          ev('q', [n('g/4', 67)]),
        ],
      },
      {
        number: 2,
        events: [
          ev('q', [n('b/3', 59), n('g/4', 67)]),
          ev('q', [n('f/4', 65)]),
          ev('q', [n('e/4', 64)]),
          ev('q', [n('d/4', 62)]),
        ],
      },
      {
        number: 3,
        events: [
          ev('q', [n('c/4', 60), n('e/4', 64)]),
          ev('q', [n('c/4', 60)]),
          ev('q', [n('d/4', 62)]),
          ev('q', [n('e/4', 64)]),
        ],
      },
      {
        number: 4,
        events: [
          ev('q', [n('g/3', 55), n('e/4', 64)], true),
          ev('8', [n('d/4', 62)]),
          ev('h', [n('g/3', 55), n('d/4', 62)]),
        ],
      },
    ],
  },
  {
    title: 'Estudio Arpegiado en Mi Menor',
    composer: 'Tradicional Guitarra',
    instrument: 'guitar',
    bpm: 92,
    clef: 'treble',
    keySignature: 'G',
    timeSignature: { numerator: 3, denominator: 4 },
    source: 'builtin',
    measures: [
      {
        number: 1,
        events: [
          ev('8', [n('e/4', 64)]),
          ev('8', [n('g/4', 67)]),
          ev('8', [n('b/4', 71)]),
          ev('8', [n('e/5', 76)]),
          ev('8', [n('b/4', 71)]),
          ev('8', [n('g/4', 67)]),
        ],
      },
      {
        number: 2,
        events: [
          ev('8', [n('a/4', 69)]),
          ev('8', [n('c/5', 72)]),
          ev('8', [n('e/5', 76)]),
          ev('8', [n('c/5', 72)]),
          ev('8', [n('a/4', 69)]),
          ev('8', [n('e/4', 64)]),
        ],
      },
      {
        number: 3,
        events: [
          ev('8', [n('b/3', 59)]),
          ev('8', [n('f#/4', 66, '#')]),
          ev('8', [n('b/4', 71)]),
          ev('8', [n('d#/5', 75, '#')]),
          ev('8', [n('b/4', 71)]),
          ev('8', [n('f#/4', 66, '#')]),
        ],
      },
      {
        number: 4,
        events: [
          ev('h', [n('e/4', 64), n('g/4', 67), n('b/4', 71)], true),
        ],
      },
    ],
  },
  {
    title: 'Vocalise de Entonación (Do Mayor)',
    composer: 'Ejercicio Vocal',
    instrument: 'voice',
    bpm: 84,
    clef: 'treble',
    keySignature: 'C',
    timeSignature: { numerator: 4, denominator: 4 },
    source: 'builtin',
    measures: [
      {
        number: 1,
        events: [
          ev('h', [n('c/4', 60)]),
          ev('q', [n('d/4', 62)]),
          ev('q', [n('e/4', 64)]),
        ],
      },
      {
        number: 2,
        events: [
          ev('h', [n('f/4', 65)]),
          ev('h', [n('g/4', 67)]),
        ],
      },
      {
        number: 3,
        events: [
          ev('q', [n('a/4', 69)]),
          ev('q', [n('g/4', 67)]),
          ev('q', [n('f/4', 65)]),
          ev('q', [n('e/4', 64)]),
        ],
      },
      {
        number: 4,
        events: [
          ev('q', [n('d/4', 62)]),
          ev('h', [n('c/4', 60)]),
          ev('q', []), // Silencio de respiración
        ],
      },
    ],
  },
]

export async function seedSampleScoresIfEmpty() {
  const count = await db.scores.count()
  if (count > 0) return

  const now = Date.now()
  const rows = SAMPLE_SCORES.map((s, idx) => ({
    ...s,
    warnings: validateMeasures(s),
    createdAt: now + idx,
    updatedAt: now + idx,
  }))

  await db.scores.bulkAdd(rows)
}