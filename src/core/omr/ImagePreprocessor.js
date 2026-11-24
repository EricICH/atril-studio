import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export async function loadSourceDocument(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

  if (isPdf) {
    const arrayBuffer = await file.arrayBuffer()
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    return {
      type: 'pdf',
      name: file.name,
      pageCount: pdfDoc.numPages,
      pdfDoc,
      imageBitmap: null,
    }
  }

  const url = URL.createObjectURL(file)
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('No se pudo cargar la imagen seleccionada.'))
    el.src = url
  })
  URL.revokeObjectURL(url)

  return {
    type: 'image',
    name: file.name,
    pageCount: 1,
    pdfDoc: null,
    imageEl: img,
  }
}

// Dibuja la imagen o la página elegida del PDF en un canvas base
export async function renderSourceToCanvas(sourceDoc, pageNumber = 1, maxWidth = 1400) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  if (sourceDoc.type === 'pdf') {
    const page = await sourceDoc.pdfDoc.getPage(pageNumber)
    const unscaled = page.getViewport({ scale: 1 })
    const scale = Math.min(2.2, maxWidth / unscaled.width)
    const viewport = page.getViewport({ scale })

    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas
  }

  const img = sourceDoc.imageEl
  const scale = Math.min(1, maxWidth / img.naturalWidth)
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

// Umbral automático de Otsu para separar tinta negra de papel con sombras
function computeOtsuThreshold(grayData) {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < grayData.length; i++) {
    histogram[grayData[i]]++
  }

  const total = grayData.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * histogram[t]

  let sumB = 0
  let wB = 0
  let maxVariance = 0
  let threshold = 160

  for (let t = 0; t < 256; t++) {
    wB += histogram[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break

    sumB += t * histogram[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const variance = wB * wF * (mB - mF) * (mB - mF)

    if (variance > maxVariance) {
      maxVariance = variance
      threshold = t
    }
  }

  return threshold
}

// Aplica rotación + binarización y devuelve canvas listo y matriz binaria (1 = tinta, 0 = papel)
export function preprocessCanvas(sourceCanvas, { rotationDeg = 0, thresholdBias = 0 } = {}) {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))

  const outW = Math.round(sourceCanvas.width * cos + sourceCanvas.height * sin)
  const outH = Math.round(sourceCanvas.width * sin + sourceCanvas.height * cos)

  const rotatedCanvas = document.createElement('canvas')
  rotatedCanvas.width = outW
  rotatedCanvas.height = outH
  const rCtx = rotatedCanvas.getContext('2d', { willReadFrequently: true })
  rCtx.fillStyle = '#ffffff'
  rCtx.fillRect(0, 0, outW, outH)
  rCtx.translate(outW / 2, outH / 2)
  rCtx.rotate(rad)
  rCtx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2)

  const imgData = rCtx.getImageData(0, 0, outW, outH)
  const data = imgData.data
  const pixelCount = outW * outH
  const gray = new Uint8Array(pixelCount)

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }

  const autoT = computeOtsuThreshold(gray)
  const finalThreshold = Math.max(40, Math.min(235, autoT + thresholdBias))

  const binaryCanvas = document.createElement('canvas')
  binaryCanvas.width = outW
  binaryCanvas.height = outH
  const bCtx = binaryCanvas.getContext('2d')
  const binImgData = bCtx.createImageData(outW, outH)
  const binary = new Uint8Array(pixelCount)

  for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
    const isInk = gray[p] < finalThreshold ? 1 : 0
    binary[p] = isInk
    const v = isInk ? 0 : 255
    binImgData.data[i] = v
    binImgData.data[i + 1] = v
    binImgData.data[i + 2] = v
    binImgData.data[i + 3] = 255
  }

  bCtx.putImageData(binImgData, 0, 0)

  return {
    width: outW,
    height: outH,
    rotatedCanvas,
    binaryCanvas,
    binary,
    thresholdUsed: finalThreshold,
  }
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('No se pudo generar la imagen PNG.'))
    }, 'image/png')
  })
}