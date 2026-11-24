<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Dot,
  Beam,
  StaveTie,
  Curve,
  Annotation,
  Articulation,
  Fraction,
} from 'vexflow'

const props = defineProps({
  score: { type: Object, required: true },
  activePos: { type: Object, default: null },
  selectedPos: { type: Object, default: null },
  noteResults: { type: Object, default: () => ({}) },
  paperTheme: { type: String, default: 'light' },
})

const emit = defineEmits(['select-measure', 'select-event'])

const containerRef = ref(null)
let noteElementsMap = new Map()
let cursorRectEl = null
let activeElement = null
let selectedElement = null
let resizeObserver = null

const ARTICULATION_VEX_MAP = {
  staccato: 'articStaccatoAbove',
  accent: 'articAccentAbove',
  tenuto: 'articTenutoAbove',
}

const TECHNICAL_TEXT_MAP = {
  pizzicato: 'pizz.',
  arco: 'arco',
  letRing: 'l.v.',
}

function getBeatGroupsForTimeSignature(timeSig) {
  const num = Number(timeSig?.numerator) || 4
  const den = Number(timeSig?.denominator) || 4
  if (den === 8 && num % 3 === 0) {
    return [new Fraction(3, 8)]
  }
  return [new Fraction(1, den)]
}

function renderScore() {
  const container = containerRef.value
  if (!container || !props.score) return

  container.innerHTML = ''
  noteElementsMap.clear()
  activeElement = null
  selectedElement = null
  cursorRectEl = null

  const availableWidth = Math.max(320, container.clientWidth - 24)
  const measuresPerRow = availableWidth >= 820 ? 4 : availableWidth >= 560 ? 2 : 1
  const measureWidth = Math.floor((availableWidth - 20) / measuresPerRow)
  const rowHeight = 160
  const totalRows = Math.max(1, Math.ceil(props.score.measures.length / measuresPerRow))
  const totalHeight = Math.max(185, totalRows * rowHeight + 35)

  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(availableWidth, totalHeight)
  const context = renderer.getContext()

  const inkColor = props.paperTheme === 'light' ? '#0f172a' : '#e2e8f0'
  context.setFillStyle(inkColor)
  context.setStrokeStyle(inkColor)

  const svgEl = container.querySelector('svg')
  if (svgEl) {
    cursorRectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    cursorRectEl.setAttribute('rx', '6')
    cursorRectEl.setAttribute('fill', props.paperTheme === 'light' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(129, 140, 248, 0.28)')
    cursorRectEl.setAttribute('stroke', '#6366f1')
    cursorRectEl.setAttribute('stroke-width', '1.5')
    cursorRectEl.setAttribute('visibility', 'hidden')
    svgEl.appendChild(cursorRectEl)
  }

  const warningSet = new Set((props.score.warnings || []).map(w => w.measureNumber))
  const globalNoteRegistry = [] // { mIdx, eIdx, staveNote, ev }

  props.score.measures.forEach((measure, mIdx) => {
    const row = Math.floor(mIdx / measuresPerRow)
    const col = mIdx % measuresPerRow
    const x = 10 + col * measureWidth
    const y = 32 + row * rowHeight

    const stave = new Stave(x, y, measureWidth)

    if (col === 0) {
      stave.addClef(props.score.clef || 'treble')
      if (props.score.keySignature && props.score.keySignature !== 'C') {
        stave.addKeySignature(props.score.keySignature)
      }
    }
    if (mIdx === 0) {
      const { numerator, denominator } = props.score.timeSignature
      stave.addTimeSignature(`${numerator}/${denominator}`)
    }

    stave.setContext(context).draw()

    if (svgEl) {
      const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      hitRect.setAttribute('x', String(x))
      hitRect.setAttribute('y', String(y + 15))
      hitRect.setAttribute('width', String(measureWidth))
      hitRect.setAttribute('height', '100')
      hitRect.setAttribute('fill', warningSet.has(mIdx + 1) ? 'rgba(245, 158, 11, 0.12)' : 'transparent')
      hitRect.style.cursor = 'pointer'
      hitRect.addEventListener('click', () => emit('select-measure', mIdx))
      svgEl.insertBefore(hitRect, svgEl.firstChild)

      const numLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      numLabel.setAttribute('x', String(x + 4))
      numLabel.setAttribute('y', String(y + 16))
      numLabel.setAttribute('font-size', '11')
      numLabel.setAttribute('font-family', 'monospace')
      numLabel.setAttribute('fill', warningSet.has(mIdx + 1) ? '#d97706' : '#64748b')
      numLabel.textContent = warningSet.has(mIdx + 1) ? `${mIdx + 1} ⚠` : `${mIdx + 1}`
      svgEl.appendChild(numLabel)
    }

    if (!measure.events || measure.events.length === 0) return

    const staveNotes = measure.events.map((ev, eIdx) => {
      const clef = props.score.clef || 'treble'
      const isRest = ev.isRest || !ev.notes?.length
      const keys = isRest ? [clef === 'bass' ? 'd/3' : 'b/4'] : ev.notes.map(n => n.vexKey)
      const duration = isRest ? `${ev.duration}r` : ev.duration

      const note = new StaveNote({ keys, duration, clef })
      note.setStyle({ fillStyle: inkColor, strokeStyle: inkColor })

      if (!isRest) {
        ev.notes.forEach((nObj, kIdx) => {
          if (nObj.accidental) {
            try {
              note.addModifier(new Accidental(nObj.accidental), kIdx)
            } catch {}
          }
        })

        if (ev.articulation) {
          if (ARTICULATION_VEX_MAP[ev.articulation]) {
            try {
              const art = new Articulation(ARTICULATION_VEX_MAP[ev.articulation])
              art.setPosition(4)
              note.addModifier(art, 0)
            } catch {
              // Respaldo de texto si la versión de VexFlow no expone ese glifo SMuFL
              const fallback = new Annotation(ev.articulation)
              fallback.setVerticalJustification(Annotation.VerticalJustify.TOP)
              note.addModifier(fallback, 0)
            }
          } else if (TECHNICAL_TEXT_MAP[ev.articulation]) {
            try {
              const tech = new Annotation(TECHNICAL_TEXT_MAP[ev.articulation])
              tech.setVerticalJustification(Annotation.VerticalJustify.TOP)
              if (typeof tech.setStyle === 'function') {
                tech.setStyle({ fillStyle: inkColor, strokeStyle: inkColor })
              }
              note.addModifier(tech, 0)
            } catch {}
          }
        }

        if (ev.dynamic) {
          try {
            const dyn = new Annotation(ev.dynamic)
            dyn.setVerticalJustification(Annotation.VerticalJustify.BOTTOM)
            if (typeof dyn.setStyle === 'function') {
              dyn.setStyle({ fillStyle: inkColor, strokeStyle: inkColor })
            }
            note.addModifier(dyn, 0)
          } catch {}
        }
      }

      if (ev.dotted) {
        Dot.buildAndAttach([note], { all: true })
      }

      globalNoteRegistry.push({ mIdx, eIdx, staveNote: note, ev })
      return note
    })

    const voice = new Voice({
      num_beats: props.score.timeSignature.numerator,
      beat_value: props.score.timeSignature.denominator,
    }).setMode(Voice.Mode.SOFT)

    voice.addTickables(staveNotes)

    // Generar barras automáticas de corcheas y semicorcheas según la métrica
    let beams = []
    try {
      beams = Beam.generateBeams(staveNotes, {
        groups: getBeatGroupsForTimeSignature(props.score.timeSignature),
        beam_rests: false,
      })
    } catch {
      beams = []
    } 
    

    const formatWidth = Math.max(80, stave.getNoteEndX() - stave.getNoteStartX() - 16)
    new Formatter().joinVoices([voice]).format([voice], formatWidth)
    voice.draw(context, stave)

    beams.forEach((beam) => {
      beam.setContext(context).draw()
    })

    staveNotes.forEach((sn, eIdx) => {
      const el = sn.getSVGElement()
      if (el) {
        el.style.cursor = 'pointer'
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          emit('select-event', { measureIdx: mIdx, eventIdx: eIdx })
        })
        noteElementsMap.set(`${mIdx}-${eIdx}`, { el, y })
      }
    })
  })

  // Dibujar ligaduras de prolongación (ties) y curvas de fraseo (slurs) entre notas
  let pendingTieStart = null
  let pendingSlurStart = null

  globalNoteRegistry.forEach((entry) => {
    const { staveNote, ev } = entry

    if (ev.tieEnd && pendingTieStart) {
      const indices = Array.from({ length: Math.min(pendingTieStart.keys.length, staveNote.keys.length) }, (_, i) => i)
      if (indices.length > 0) {
        new StaveTie({
          first_note: pendingTieStart,
          last_note: staveNote,
          first_indices: indices,
          last_indices: indices,
        }).setContext(context).draw()
      }
      pendingTieStart = null
    }
    if (ev.tieStart) {
      pendingTieStart = staveNote
    }

    if (ev.slurEnd && pendingSlurStart) {
      new Curve(pendingSlurStart, staveNote, {
        thickness: 2,
        x_shift: 0,
        y_shift: 12,
        cps: [{ x: 0, y: 18 }, { x: 0, y: 18 }],
      }).setContext(context).draw()
      pendingSlurStart = null
    }
    if (ev.slurStart) {
      pendingSlurStart = staveNote
    }
  })

  applyNoteResults(props.noteResults)
  updateSelectedNote(props.selectedPos)
  updateKaraokeCursor(props.activePos)
}

function applyNoteResults(results) {
  noteElementsMap.forEach(({ el }, key) => {
    el.classList.remove('game-note-hit', 'game-note-partial', 'game-note-miss')
    const status = results?.[key]
    if (status === 'hit') el.classList.add('game-note-hit')
    else if (status === 'partial') el.classList.add('game-note-partial')
    else if (status === 'miss') el.classList.add('game-note-miss')
  })
}

function updateSelectedNote(pos) {
  if (selectedElement) {
    selectedElement.classList.remove('editor-note-selected')
    selectedElement = null
  }
  if (!pos) return
  const entry = noteElementsMap.get(`${pos.measureIdx}-${pos.eventIdx}`)
  if (!entry) return
  selectedElement = entry.el
  selectedElement.classList.add('editor-note-selected')
}

function updateKaraokeCursor(pos) {
  if (activeElement) {
    activeElement.classList.remove('karaoke-note-active')
    activeElement = null
  }

  if (!pos || !cursorRectEl) {
    if (cursorRectEl) cursorRectEl.setAttribute('visibility', 'hidden')
    return
  }

  const entry = noteElementsMap.get(`${pos.measureIdx}-${pos.eventIdx}`)
  if (!entry) return

  activeElement = entry.el
  activeElement.classList.add('karaoke-note-active')

  try {
    const bbox = entry.el.getBBox()
    cursorRectEl.setAttribute('x', String(bbox.x - 6))
    cursorRectEl.setAttribute('y', String(entry.y + 22))
    cursorRectEl.setAttribute('width', String(Math.max(22, bbox.width + 12)))
    cursorRectEl.setAttribute('height', '92')
    cursorRectEl.setAttribute('visibility', 'visible')

    entry.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch {
    // Ignorar si el SVG aún no está medible
  }
}

watch(() => [props.score, props.paperTheme], () => renderScore(), { deep: true })
watch(() => props.activePos, (val) => updateKaraokeCursor(val))
watch(() => props.selectedPos, (val) => updateSelectedNote(val), { deep: true })
watch(() => props.noteResults, (val) => applyNoteResults(val), { deep: true })

onMounted(() => {
  renderScore()
  resizeObserver = new ResizeObserver(() => renderScore())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
})
</script>

<template>
  <div
    class="rounded-2xl border overflow-x-auto transition-colors p-3"
    :class="paperTheme === 'light'
      ? 'bg-stone-50 border-stone-300 shadow-inner'
      : 'bg-slate-950 border-slate-800'"
  >
    <div ref="containerRef" class="w-full min-h-48" />
  </div>
</template>

<style>
.karaoke-note-active path,
.karaoke-note-active rect {
  fill: #4f46e5 !important;
  stroke: #4f46e5 !important;
}

.editor-note-selected path,
.editor-note-selected rect,
.editor-note-selected ellipse {
  fill: #0891b2 !important;
  stroke: #0891b2 !important;
}

.game-note-hit path,
.game-note-hit rect,
.game-note-hit ellipse {
  fill: #10b981 !important;
  stroke: #10b981 !important;
}

.game-note-partial path,
.game-note-partial rect,
.game-note-partial ellipse {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}

.game-note-miss path,
.game-note-miss rect,
.game-note-miss ellipse {
  fill: #f43f5e !important;
  stroke: #f43f5e !important;
}
</style>