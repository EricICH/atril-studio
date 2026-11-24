import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, seedSampleScoresIfEmpty } from '../core/storage/db'
import { parseMusicXML, validateMeasures } from '../core/score/MusicXMLParser'

export const useScoreStore = defineStore('scores', () => {
  const scores = ref([])
  const currentScore = ref(null)
  const practiceLogs = ref([])
  const pendingEditScore = ref(null)
  const isLoading = ref(false)

  async function loadLibrary() {
    isLoading.value = true
    try {
      await seedSampleScoresIfEmpty()
      scores.value = await db.scores.orderBy('createdAt').reverse().toArray()
      if (!currentScore.value && scores.value.length > 0) {
        await selectScore(scores.value[0])
      }
    } finally {
      isLoading.value = false
    }
  }

  async function selectScore(score) {
    currentScore.value = score
    await loadPracticeLogs(score?.id)
  }

  async function loadPracticeLogs(scoreId) {
    if (!scoreId) {
      practiceLogs.value = []
      return
    }
    const logs = await db.practiceLogs.where('scoreId').equals(scoreId).toArray()
    practiceLogs.value = logs.sort((a, b) => b.date - a.date).slice(0, 10)
  }

  async function savePracticeLog(logData) {
    const plain = JSON.parse(JSON.stringify({
      ...logData,
      date: Date.now(),
    }))
    const id = await db.practiceLogs.add(plain)
    practiceLogs.value.unshift({ ...plain, id })
    if (practiceLogs.value.length > 10) practiceLogs.value.pop()
  }

  // Crea una obra nueva o actualiza una existente en almacenamiento offline
  async function saveScore(scoreData) {
    const clean = JSON.parse(JSON.stringify(scoreData))
    clean.updatedAt = Date.now()
    if (!clean.createdAt) clean.createdAt = clean.updatedAt
    clean.warnings = validateMeasures(clean)

    if (clean.id) {
      await db.scores.put(clean)
      const idx = scores.value.findIndex(s => s.id === clean.id)
      if (idx !== -1) scores.value[idx] = clean
      else scores.value.unshift(clean)
      await selectScore(clean)
      return clean
    } else {
      delete clean.id
      const id = await db.scores.add(clean)
      const saved = { ...clean, id }
      scores.value.unshift(saved)
      await selectScore(saved)
      return saved
    }
  }

  async function importMusicXMLFile(file, instrument = 'piano') {
    const xmlText = await file.text()
    const parsed = parseMusicXML(xmlText, file.name, instrument)
    return await saveScore(parsed)
  }

  async function deleteScore(id) {
    await db.scores.delete(id)
    await db.practiceLogs.where('scoreId').equals(id).delete()
    scores.value = scores.value.filter(s => s.id !== id)
    if (currentScore.value?.id === id) {
      await selectScore(scores.value[0] || null)
    }
  }

  function setScoreForEditor(score) {
  pendingEditScore.value = JSON.parse(JSON.stringify(score))
}

function consumeScoreForEditor() {
  const data = pendingEditScore.value
  pendingEditScore.value = null
  return data
}

  return {
    scores,
    currentScore,
    practiceLogs,
    isLoading,
    pendingEditScore,
    loadLibrary,
    selectScore,
    loadPracticeLogs,
    savePracticeLog,
    saveScore,
    importMusicXMLFile,
    deleteScore,
    setScoreForEditor,
    consumeScoreForEditor
  }
})