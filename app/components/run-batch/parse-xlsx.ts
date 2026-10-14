export type EmbeddedImagesByCell = Record<number, Record<number, File[]>>

type ZipEntry = {
  data: Uint8Array
  compression: number
}

const readZipEntries = async (file: File) => {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let endOffset = -1

  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0)
    throw new Error('Invalid Excel archive')

  const entryCount = view.getUint16(endOffset + 10, true)
  let directoryOffset = view.getUint32(endOffset + 16, true)
  const entries = new Map<string, ZipEntry>()

  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(directoryOffset, true) !== 0x02014b50)
      throw new Error('Invalid Excel archive directory')

    const compression = view.getUint16(directoryOffset + 10, true)
    const compressedSize = view.getUint32(directoryOffset + 20, true)
    const filenameLength = view.getUint16(directoryOffset + 28, true)
    const extraLength = view.getUint16(directoryOffset + 30, true)
    const commentLength = view.getUint16(directoryOffset + 32, true)
    const localHeaderOffset = view.getUint32(directoryOffset + 42, true)
    const filename = new TextDecoder().decode(bytes.slice(directoryOffset + 46, directoryOffset + 46 + filenameLength))

    const localFilenameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength
    entries.set(filename, {
      compression,
      data: bytes.slice(dataOffset, dataOffset + compressedSize),
    })
    directoryOffset += 46 + filenameLength + extraLength + commentLength
  }

  const getBytes = async (path: string) => {
    const entry = entries.get(path)
    if (!entry)
      return undefined
    if (entry.compression === 0)
      return entry.data
    if (entry.compression !== 8)
      throw new Error('Unsupported Excel compression')
    const DecompressionStreamClass = (window as any).DecompressionStream
    if (!DecompressionStreamClass)
      throw new Error('Excel decompression is unavailable in this browser')
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStreamClass('deflate-raw') as TransformStream)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return {
    async text(path: string) {
      const bytes = await getBytes(path)
      return bytes ? new TextDecoder().decode(bytes) : undefined
    },
    bytes: getBytes,
  }
}

const parseXml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror'))
    throw new Error('Invalid Excel XML')
  return doc
}

const elements = (parent: Document | Element, namespace: string, name: string): Element[] => Array.from(parent.getElementsByTagNameNS(namespace, name))
const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
const drawingMainNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'

const resolvePath = (baseFile: string, target: string) => {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseFile.slice(0, baseFile.lastIndexOf('/') + 1)}${target}`).split('/')
  const resolved: string[] = []
  parts.forEach((part) => {
    if (part === '..')
      resolved.pop()
    else if (part && part !== '.')
      resolved.push(part)
  })
  return resolved.join('/')
}

const columnIndex = (cellRef: string) => {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0].toUpperCase() || 'A'
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

const getRelationshipMap = (doc: Document) => {
  const result = new Map<string, string>()
  elements(doc, packageRelationshipNs, 'Relationship').forEach((item) => {
    result.set(item.getAttribute('Id') || '', item.getAttribute('Target') || '')
  })
  return result
}

export const parseXlsx = async (file: File): Promise<{ data: string[][]; images: EmbeddedImagesByCell }> => {
  const zip = await readZipEntries(file)
  const workbookText = await zip.text('xl/workbook.xml')
  const workbookRelsText = await zip.text('xl/_rels/workbook.xml.rels')
  if (!workbookText || !workbookRelsText)
    throw new Error('Excel workbook is missing')

  const workbook = parseXml(workbookText)
  const workbookRels = getRelationshipMap(parseXml(workbookRelsText))
  const firstSheet = elements(workbook, spreadsheetNs, 'sheet')[0]
  const sheetRelId = firstSheet?.getAttributeNS(relationshipNs, 'id')
  const sheetTarget = sheetRelId ? workbookRels.get(sheetRelId) : undefined
  if (!sheetTarget)
    throw new Error('Excel worksheet is missing')

  const sheetPath = resolvePath('xl/workbook.xml', sheetTarget)
  const sheetText = await zip.text(sheetPath)
  if (!sheetText)
    throw new Error('Excel worksheet is missing')
  const sheet = parseXml(sheetText)

  const sharedStringsText = await zip.text('xl/sharedStrings.xml')
  const sharedStrings = sharedStringsText
    ? elements(parseXml(sharedStringsText), spreadsheetNs, 'si').map(si => elements(si, spreadsheetNs, 't').map(t => t.textContent || '').join(''))
    : []

  const cellImageText = await zip.text('xl/cellimages.xml')
  const cellImages: EmbeddedImagesByCell = {}
  if (cellImageText) {
    const cellImageRelsText = await zip.text('xl/_rels/cellimages.xml.rels')
    const imageRelationships = cellImageRelsText ? getRelationshipMap(parseXml(cellImageRelsText)) : new Map<string, string>()
    const cellImageDoc = parseXml(cellImageText)
    const imageById = new Map<string, File>()

    for (const cellImage of elements(cellImageDoc, 'http://www.wps.cn/officeDocument/2017/etCustomData', 'cellImage')) {
      const pictureName = elements(cellImage, drawingNs, 'cNvPr')[0]?.getAttribute('name')
      const embedId = elements(cellImage, drawingMainNs, 'blip')[0]?.getAttributeNS(relationshipNs, 'embed')
      const mediaTarget = embedId ? imageRelationships.get(embedId) : undefined
      if (!pictureName || !mediaTarget)
        continue
      const mediaPath = resolvePath('xl/cellimages.xml', mediaTarget)
      const media = await zip.bytes(mediaPath)
      if (!media)
        continue
      const extension = mediaPath.split('.').pop()?.toLowerCase() || 'png'
      imageById.set(pictureName, new File([media], `${pictureName}.${extension}`, { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }))
    }

    for (const cell of elements(sheet, spreadsheetNs, 'c')) {
      const formula = elements(cell, spreadsheetNs, 'f')[0]?.textContent || ''
      const imageId = formula.match(/DISPIMG\("([^"]+)"/i)?.[1]
      const image = imageId ? imageById.get(imageId) : undefined
      if (!image)
        continue
      const ref = cell.getAttribute('r') || ''
      const rowIndex = Number(ref.match(/\d+$/)?.[0] || 0) - 2
      const colIndex = columnIndex(ref)
      if (rowIndex < 0)
        continue
      cellImages[rowIndex] ||= {}
      cellImages[rowIndex][colIndex] ||= []
      cellImages[rowIndex][colIndex].push(image)
    }
  }

  const rowElements = elements(sheet, spreadsheetNs, 'row')
  const rows = new Map<number, string[]>()
  let maxRow = 0
  rowElements.forEach((row) => {
    const rowNumber = Number(row.getAttribute('r'))
    maxRow = Math.max(maxRow, rowNumber)
    const values: string[] = []
    elements(row, spreadsheetNs, 'c').forEach((cell) => {
      const ref = cell.getAttribute('r') || ''
      const index = columnIndex(ref)
      const value = elements(cell, spreadsheetNs, 'v')[0]?.textContent || ''
      const type = cell.getAttribute('t')
      const inlineValue = elements(cell, spreadsheetNs, 'is').flatMap(item => elements(item, spreadsheetNs, 't')).map(item => item.textContent || '').join('')
      values[index] = type === 's' ? (sharedStrings[Number(value)] || '') : type === 'inlineStr' ? inlineValue : value
    })
    rows.set(rowNumber, values)
  })

  const data = Array.from({ length: maxRow }, (_, index) => rows.get(index + 1) || [])
  return { data, images: cellImages }
}
