import { validateMeasures } from '../score/MusicXMLParser'
import { appendDurationToMeasures, getMeasureCapacity } from '../score/ScoreBuilder'

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const KEY_ALTERATIONS = {
  C: {},
  G: { F: 1 },
  D: { F: 1, C: 1 },
  A: { F: 1, C: 1, G: 1 },
  E: { F: 1, C: 1, G: 1, D: 1 },
  F: { B: -1 },
  Bb: { B: -1, E: -1 },
  Eb: { B: -1, E: -1, A: -1 },
  Ab: { B: -1, E: -1, A: -1, D: -1 },
}

function diatonicStepToNote(stepFromBottomLine, clef = 'treble', keySignature = 'C') {
  // Línea inferior: Mi4 (clave de Sol) o Sol2 (clave de Fa)
  const baseDiatonic = clef === 'bass' ? (2 * 7 + 4) : (4 * 7 + 2)
  const diatonic = Math.max(14, Math.min(48, baseDiatonic + stepFromBottomLine))

  const octave = Math.floor(diatonic / 7)
  const letter = LETTERS[((diatonic % 7) + 7) % 7]
  const alter = KEY_ALTERATIONS[keySignature]?.[letter] || 0
  const midi = (octave + 1) * 12 + LETTER_SEMITONES[letter] + alter
  const alterSymbol = alter === 1 ? '#' : alter === -1 ? 'b' : ''

  return {
    midi,
    vexKey: `${letter.toLowerCase()}${alterSymbol}/${octave}`,
    accidental: null, // Alteración ya implícita en la armadura
  }
}

// Paso 1: Detectar grupos de 5 líneas horizontales (pentagramas)
function detectStaves(binary, width, height) {
  const rowCounts = new Uint32Array(height)
  for (let y = 0; y < height; y++) {
    let count = 0
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      count += binary[rowOffset + x]
    }
    rowCounts[y] = count
  }

  const maxRow = Math.max(...rowCounts)
  if (maxRow < width * 0.25) return []

  const lineThreshold = Math.max(width * 0.28, maxRow * 0.52)
  const rawLines = []
  let inBand = false
  let bandStart = 0

  for (let y = 0; y < height; y++) {
    if (rowCounts[y] >= lineThreshold) {
      if (!inBand) {
        inBand = true
        bandStart = y
      }
    } else if (inBand) {
      const thickness = y - bandStart
      if (thickness <= Math.max(6, height * 0.012)) {
        rawLines.push({
          center: Math.round((bandStart + y - 1) / 2),
          thickness,
        })
      }
      inBand = false
    }
  }

  // Agrupar líneas consecutivas de espaciado uniforme en bloques de 5
  const staves = []
  let i = 0
  while (i <= rawLines.length - 5) {
    const group = rawLines.slice(i, i + 5)
    const gaps = [
      group[1].center - group[0].center,
      group[2].center - group[1].center,
      group[3].center - group[2].center,
      group[4].center - group[3].center,
    ]
    const avgGap = gaps.reduce((a, b) => a + b, 0) / 4
    const isUniform =
      avgGap >= 5 &&
      avgGap <= 45 &&
      gaps.every(g => Math.abs(g - avgGap) <= Math.max(2.5, avgGap * 0.28))

    if (isUniform) {
      // Encontrar margen izquierdo/derecho real del pentagrama
      const yMid = group[2].center
      let startX = 0
      let endX = width - 1
      for (let x = 0; x < width; x++) {
        if (binary[yMid * width + x]) { startX = x; break }
      }
      for (let x = width - 1; x >= 0; x--) {
        if (binary[yMid * width + x]) { endX = x; break }
      }

      const avgThickness = Math.max(1, Math.round(group.reduce((s, l) => s + l.thickness, 0) / 5))
      staves.push({
        lines: group.map(g => g.center),
        spaceH: avgGap,
        lineThickness: avgThickness,
        startX,
        endX,
      })
      i += 5
    } else {
      i++
    }
  }

  return staves
}

// Paso 2: Extraer notas y compases dentro de un pentagrama detectado
function extractSymbolsFromStaff(binary, width, height, staff, clef, keySignature) {
  const { lines, spaceH, lineThickness, startX, endX } = staff
  const yTop = Math.max(0, Math.round(lines[0] - spaceH * 2.5))
  const yBot = Math.min(height - 1, Math.round(lines[4] + spaceH * 2.5))
  const bandH = yBot - yTop + 1

  // Omitir zona inicial (clave, armadura y cifra de compás)
  const contentStartX = Math.min(endX, Math.round(startX + spaceH * 4.8))
  const contentEndX = Math.max(contentStartX, Math.round(endX - spaceH * 0.8))

  // 2A. Copiar banda y remover líneas finas del pentagrama preservando notas/plicas
  const cleaned = new Uint8Array(width * bandH)
  for (let y = 0; y < bandH; y++) {
    const srcOffset = (yTop + y) * width
    cleaned.set(binary.subarray(srcOffset, srcOffset + width), y * width)
  }

  const maxStaffRun = lineThickness + 2
  for (const lineY of lines) {
    const localY = lineY - yTop
    for (let x = startX; x <= endX; x++) {
      if (!cleaned[localY * width + x]) continue
      let top = localY
      let bot = localY
      while (top > 0 && cleaned[(top - 1) * width + x]) top--
      while (bot < bandH - 1 && cleaned[(bot + 1) * width + x]) bot++
      if (bot - top + 1 <= maxStaffRun) {
        for (let yy = top; yy <= bot; yy++) {
          cleaned[yy * width + x] = 0
        }
      }
    }
  }

  // 2B. Detectar barras divisorias de compás (líneas verticales que cruzan las 5 líneas)
  const barlinesX = []
  const staffHeight = lines[4] - lines[0]
  const yLine0 = lines[0] - yTop
  const yLine4 = lines[4] - yTop
  const minMeasureWidth = spaceH * 6.5

  for (let x = contentStartX; x <= contentEndX; x++) {
    let dark = 0
    for (let y = yLine0; y <= yLine4; y++) {
      if (binary[(yTop + y) * width + x]) dark++
    }
    // Una barra de compás cruza de forma continua de la línea 1 a la 5
    if (dark < staffHeight * 0.96) continue

    // Verificar que no sea una plica con cabeza de nota pegada a izquierda o derecha
    let attachedBlobRows = 0
    const sideOffset = Math.max(3, Math.round(spaceH * 0.45))
    for (let y = yLine0; y <= yLine4; y++) {
      const hasLeft = x - sideOffset >= 0 && cleaned[y * width + (x - sideOffset)]
      const hasRight = x + sideOffset < width && cleaned[y * width + (x + sideOffset)]
      if (hasLeft || hasRight) attachedBlobRows++
    }
    if (attachedBlobRows > spaceH * 0.55) continue

    // Evitar dobles detecciones y exigir ancho mínimo de compás
    if (barlinesX.length === 0 || x - barlinesX[barlinesX.length - 1] >= minMeasureWidth) {
      barlinesX.push(x)
    }
  }

  // 2C. Erosión direccional para separar cabezas de nota rellenas de plicas y corchetes
  const minRun = Math.max(3, Math.round(spaceH * 0.42))
  const headsMask = new Uint8Array(width * bandH)

  for (let y = 1; y < bandH - 1; y++) {
    const rowOff = y * width
    for (let x = contentStartX; x <= contentEndX; x++) {
      if (!cleaned[rowOff + x]) continue

      // Medir grosor horizontal y vertical local alrededor del píxel
      let hRun = 1
      for (let dx = 1; dx <= minRun && x - dx >= 0 && cleaned[rowOff + x - dx]; dx++) hRun++
      for (let dx = 1; dx <= minRun && x + dx < width && cleaned[rowOff + x + dx]; dx++) hRun++
      if (hRun < minRun) continue

      let vRun = 1
      for (let dy = 1; dy <= minRun && y - dy >= 0 && cleaned[(y - dy) * width + x]; dy++) vRun++
      for (let dy = 1; dy <= minRun && y + dy < bandH && cleaned[(y + dy) * width + x]; dy++) vRun++
      if (vRun < minRun) continue

      headsMask[rowOff + x] = 1
    }
  }

  // 2D. Componentes conectados (BFS) sobre las cabezas aisladas
  const visited = new Uint8Array(width * bandH)
  const detectedHeads = []
  const minW = Math.max(3, spaceH * 0.45)
  const maxW = spaceH * 2.1
  const minH = Math.max(3, spaceH * 0.42)
  const maxH = spaceH * 1.75

  for (let y = 0; y < bandH; y++) {
    for (let x = contentStartX; x <= contentEndX; x++) {
      const idx = y * width + x
      if (!headsMask[idx] || visited[idx]) continue

      const queue = [idx]
      visited[idx] = 1
      let minX = x, maxX = x, minY = y, maxY = y
      let sumX = 0, sumY = 0, area = 0

      while (queue.length) {
        const cur = queue.pop()
        const cy = Math.floor(cur / width)
        const cx = cur - cy * width
        sumX += cx
        sumY += cy
        area++
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy

        const neighbors = [cur - 1, cur + 1, cur - width, cur + width]
        for (const nIdx of neighbors) {
          if (nIdx >= 0 && nIdx < visited.length && headsMask[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1
            queue.push(nIdx)
          }
        }
      }

      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      const fillRatio = area / (bw * bh)

      if (bw >= minW && bw <= maxW && bh >= minH && bh <= maxH && fillRatio >= 0.35) {
        const cx = sumX / area
        const cyGlobal = yTop + sumY / area

        // Ignorar marcas demasiado cercanas a una barra divisoria
        const nearBarline = barlinesX.some(bx => Math.abs(bx - cx) < spaceH * 0.4)
        if (nearBarline) continue

        // Detectar si existe barra de unión horizontal (corchea) arriba o abajo de la plica
        const hasBeam = checkBeamNearNote(cleaned, width, bandH, Math.round(cx), Math.round(sumY / area), spaceH)
        const step = Math.round((lines[4] - cyGlobal) / (spaceH / 2))
        const noteObj = diatonicStepToNote(step, clef, keySignature)

        detectedHeads.push({
          cx,
          cy: cyGlobal,
          duration: hasBeam ? '8' : 'q',
          note: noteObj,
        })
      }
    }
  }

  // Ordenar de izquierda a derecha y agrupar notas simultáneas en acordes
  detectedHeads.sort((a, b) => a.cx - b.cx)
  const events = []
  const chordToleranceX = spaceH * 0.65

  for (const head of detectedHeads) {
    const prev = events[events.length - 1]
    if (prev && Math.abs(head.cx - prev.cx) <= chordToleranceX) {
      if (!prev.notes.some(n => n.midi === head.note.midi)) {
        prev.notes.push(head.note)
        prev.notes.sort((a, b) => a.midi - b.midi)
      }
    } else {
      events.push({
        cx: head.cx,
        duration: head.duration,
        notes: [head.note],
      })
    }
  }

  return { events, barlinesX }
}

function checkBeamNearNote(cleaned, width, bandH, cx, cy, spaceH) {
  const beamRangeTop = Math.max(0, Math.round(cy - spaceH * 3.8))
  const beamRangeBot = Math.min(bandH - 1, Math.round(cy + spaceH * 3.8))
  const checkW = Math.max(4, Math.round(spaceH * 0.9))

  for (let y = beamRangeTop; y <= beamRangeBot; y++) {
    if (Math.abs(y - cy) < spaceH * 1.4) continue
    let thickRows = 0
    for (let dy = 0; dy < 3 && y + dy < bandH; dy++) {
      let dark = 0
      for (let x = Math.max(0, cx - checkW); x <= Math.min(width - 1, cx + checkW); x++) {
        if (cleaned[(y + dy) * width + x]) dark++
      }
      if (dark >= checkW * 1.4) thickRows++
    }
    if (thickRows >= 2) return true
  }
  return false
}

export function runLocalOMR(preprocessed, options = {}) {
  const {
    title = 'Partitura Escaneada',
    instrument = 'piano',
    clef = 'treble',
    keySignature = 'C',
    numerator = 4,
    denominator = 4,
    bpm = 96,
  } = options

  const { binary, width, height } = preprocessed
  const staves = detectStaves(binary, width, height)
  const timeSignature = { numerator: Number(numerator) || 4, denominator: Number(denominator) || 4 }

  if (staves.length === 0) {
    return {
      success: false,
      origin: 'local',
      error: 'No se detectaron pentagramas claros en la imagen. Ajusta el contraste, endereza la foto o usa el modo Online.',
      stats: { stavesDetected: 0, notesDetected: 0 },
    }
  }

  const allMeasures = []
  let totalNotes = 0

  staves.forEach((staff) => {
    const { events, barlinesX } = extractSymbolsFromStaff(binary, width, height, staff, clef, keySignature)
    totalNotes += events.length

    if (events.length === 0) return

    // Si hay barras divisorias claras, agrupar por compás real; si no, agrupar por capacidad rítmica
    if (barlinesX.length >= 2) {
      const buckets = []
      let currentBucket = []
      let barIdx = 0

      for (const ev of events) {
        while (barIdx < barlinesX.length && ev.cx > barlinesX[barIdx]) {
          if (currentBucket.length > 0) {
            buckets.push(currentBucket)
            currentBucket = []
          }
          barIdx++
        }
        currentBucket.push({
          isRest: false,
          duration: ev.duration,
          dotted: false,
          notes: ev.notes,
        })
      }
      if (currentBucket.length > 0) buckets.push(currentBucket)

      buckets.forEach((bEvents) => {
        allMeasures.push({ number: allMeasures.length + 1, events: bEvents })
      })
    } else {
      events.forEach((ev) => {
        const beats = ev.duration === '8' ? 0.5 : 1
        appendDurationToMeasures(allMeasures, { isRest: false, notes: ev.notes, beats }, timeSignature)
      })
    }
  })

  if (allMeasures.length === 0) {
    allMeasures.push({
      number: 1,
      events: [{ isRest: true, duration: 'w', dotted: false, notes: [] }],
    })
  }

  // Re-enumerar compases y validar duración rítmica
  allMeasures.forEach((m, idx) => { m.number = idx + 1 })

  const score = {
    title,
    composer: 'Escaneo Local (OMR)',
    instrument,
    bpm: Number(bpm) || 96,
    clef,
    keySignature,
    timeSignature,
    measures: allMeasures,
    source: 'omr-local',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  score.warnings = validateMeasures(score)
  const capacity = getMeasureCapacity(timeSignature)

  return {
    success: true,
    origin: 'local',
    score,
    stats: {
      stavesDetected: staves.length,
      notesDetected: totalNotes,
      measuresDetected: allMeasures.length,
      expectedBeatsPerBar: capacity,
    },
    notice:
      'Escaneo procesado localmente (Offline). La precisión puede ser reducida en fotos con sombras, acordes complejos o manuscritos: usa "Corregir en Editor" para afinar los compases marcados con ⚠.',
  }
}