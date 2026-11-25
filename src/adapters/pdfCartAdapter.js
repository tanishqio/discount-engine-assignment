/**
 * pdfCartAdapter.js
 *
 * PDF input adapter: turns an uploaded cart PDF into CartItem[] for the engine.
 * This is the only file that uses pdf.js. The engine never knows the cart came from a PDF.
 *
 * Expected PDF: a table with the columns Product, Brand, Platform, Base Price.
 * Anything above the header row (like "Order #OP-9921 | Date: 15 Jan 2025") is not an item.
 *
 *   parsePdfCart(file) -> { items, rowErrors, orderLine, error }
 *     items      CartItem[] built from the good rows (ITEM-01, ITEM-02, ...)
 *     rowErrors  one readable message per skipped row
 *     orderLine  the order/date line above the table, or null
 *     error      why nothing could be loaded, or null when at least one item was found
 *
 *   It never throws, so a bad file can't crash the page.
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const SAME_LINE = 3 // pieces whose y differs by 3 points or less are on the same line
const WORD_GAP = 0.7 // pieces closer than 0.7 x text height are words of the same cell

// Lines made only of dashes, dots, underscores or box-drawing characters (table dividers)
const DIVIDER_LINE = /^[\s\-_=.*~|+\u2010-\u2015\u2500-\u257F]+$/
// Summary lines such as "Total Rs.5,932" or "Subtotal: 5,932". They are not items.
const TOTAL_LINE = /^((sub|grand)\s*)?total\s*:?\s*(rs\.?|inr|\u20B9)?\s*\d/i
// Page footers added when a web page is printed to PDF ("file:///...  1/1")
const URL_LINE = /^(https?|file):\/\//i

// ---- 1. Read the PDF (the only part that uses pdf.js) ----

// pdf.js is large, so it's only downloaded the first time someone uploads a PDF
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  // pdf.js does the heavy work in a Web Worker. Vite gives us the worker file's URL.
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjsLib
}

async function readPdfPieces(file) {
  const pdfjsLib = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  // isEvalSupported: false is extra safety, because the file comes from the user
  const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false })
  try {
    const pdf = await loadingTask.promise
    const pieces = []
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const { items } = await page.getTextContent()
      for (const item of items) {
        // pdf.js adds empty pieces between cells, skip them
        if (typeof item.str !== 'string' || item.str.trim() === '') continue
        const text = item.str.replace(/\u00A0/g, ' ') // non-breaking space -> normal space
        const height = item.height || 10
        pieces.push({
          page: pageNum,
          text,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || text.length * height * 0.5, // a few PDFs don't report a width
          height,
        })
      }
    }
    return pieces
  } finally {
    loadingTask.destroy() // free the worker's memory
  }
}

// ---- 2. Turn text pieces into table rows (plain JavaScript, easy to test) ----

// Some PDFs give a whole row as one piece: "Cushion Cover    Natura Casa ...".
// Split it at runs of 2+ spaces, and estimate where each part starts.
function splitAtWideGaps(piece) {
  const charWidth = piece.width / piece.text.length
  const parts = []
  for (const match of piece.text.matchAll(/\S+( \S+)*/g)) {
    parts.push({
      ...piece,
      text: match[0],
      x: piece.x + match.index * charWidth,
      width: match[0].length * charWidth,
      wideGapBefore: parts.length > 0, // 2+ spaces before this part: always a new cell
    })
  }
  return parts
}

// Group pieces into lines (same page, same y), top to bottom, left to right.
// PDF y counts from the bottom of the page, so a bigger y is higher up.
function groupIntoLines(pieces) {
  const sorted = [...pieces].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const lines = []
  for (const piece of sorted) {
    const line = lines[lines.length - 1]
    if (line && line.page === piece.page && Math.abs(line.y - piece.y) <= SAME_LINE) {
      line.pieces.push(piece)
      line.y = piece.y // compare the next piece with this one, so small drifts stay on one line
    } else {
      lines.push({ page: piece.page, y: piece.y, pieces: [piece] })
    }
  }
  for (const line of lines) {
    line.pieces = line.pieces.flatMap(splitAtWideGaps).sort((a, b) => a.x - b.x)
    line.text = line.pieces.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim()
    line.cells = toCells(line.pieces)
  }
  return lines
}

// Join pieces that are only a word-space apart into one cell ("Natura" + "Casa", "Base" + "Price").
// Cells are separated by a bigger gap (table padding, or 2+ spaces in plain text).
function toCells(pieces) {
  const cells = []
  for (const piece of pieces) {
    const last = cells[cells.length - 1]
    const gap = last ? piece.x - (last.x + last.width) : Infinity
    if (last && !piece.wideGapBefore && gap < piece.height * WORD_GAP) {
      last.text += ' ' + piece.text
      last.width = piece.x + piece.width - last.x
    } else {
      cells.push({ text: piece.text, x: piece.x, width: piece.width })
    }
  }
  return cells
}

function looksLikeHeader(text) {
  const t = text.toLowerCase()
  return t.includes('product') && t.includes('brand') && t.includes('platform') && t.includes('price')
}

// Find the 4 columns in the header. Every header cell becomes a column, so values under
// extra columns (like "Qty") are ignored instead of being mixed into the wrong field.
function findColumns(cells) {
  const pick = (regex) => cells.find((cell) => regex.test(cell.text))
  const product = pick(/product/i)
  const brand = pick(/brand/i)
  const platform = pick(/platform/i)
  const price = pick(/base\s*price/i) || pick(/price/i)

  const found = [product, brand, platform, price]
  if (found.includes(undefined) || new Set(found).size !== 4) return null

  return cells.map((cell) => ({
    center: cell.x + cell.width / 2,
    field:
      cell === product ? 'product'
        : cell === brand ? 'brand'
          : cell === platform ? 'platform'
            : cell === price ? 'basePrice'
              : null,
  }))
}

function nearestColumn(columns, center) {
  let best = columns[0]
  for (const column of columns) {
    if (Math.abs(column.center - center) < Math.abs(best.center - center)) best = column
  }
  return best
}

// Match each cell to a column. If the row has exactly one cell per column, match them
// left to right (this also works for plain-text tables whose columns don't line up).
// Otherwise a cell goes under the header it sits closest to, so a missing value stays missing.
function readRow(line, columns) {
  const parts = { product: [], brand: [], platform: [], basePrice: [] }
  const inOrder = line.cells.length === columns.length

  line.cells.forEach((cell, i) => {
    const column = inOrder ? columns[i] : nearestColumn(columns, cell.x + cell.width / 2)
    if (column.field) parts[column.field].push(cell.text)
  })

  const join = (texts) => texts.join(' ').replace(/\s+/g, ' ').trim()
  return {
    product: join(parts.product),
    brand: join(parts.brand),
    platform: join(parts.platform),
    basePrice: join(parts.basePrice),
  }
}

// "Rs.1,299" / "₹1,299" / "1,299/-" -> 1299. Returns { price } or { problem }.
function parsePrice(raw) {
  if (raw === '') return { problem: 'price missing' }
  const cleaned = raw
    .replace(/rs\.?|inr|\u20B9/gi, '')
    .replace(/,/g, '')
    .replace(/\/-$/, '')
    .trim()
  if (cleaned.startsWith('-')) return { problem: `price can't be negative (got "${raw}")` }
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { problem: `price "${raw}" is not a number` }
  const price = Math.round(Number(cleaned)) // whole rupees, same as the CSV cart parser
  if (price <= 0) return { problem: `price must be more than 0 (got "${raw}")` }
  return { price }
}

function result({ items = [], rowErrors = [], orderLine = null, error = null }) {
  return { items, rowErrors, orderLine, error }
}

// Pure function: text pieces in, cart items and row errors out
export function piecesToCart(pieces) {
  const lines = groupIntoLines(pieces)

  const headerIndex = lines.findIndex((line) => looksLikeHeader(line.text) && findColumns(line.cells))
  if (headerIndex === -1) {
    return result({ error: "Couldn't find the Product / Brand / Platform / Base Price table." })
  }
  const columns = findColumns(lines[headerIndex].cells)
  const orderLine = lines.slice(0, headerIndex).map((line) => line.text).find((text) => /order/i.test(text)) || null

  const items = []
  const rowErrors = []
  let rowNum = 0

  for (const line of lines.slice(headerIndex + 1)) {
    // Not item rows: dividers, the header repeated on a new page, totals, page footers
    if (DIVIDER_LINE.test(line.text) || looksLikeHeader(line.text) || TOTAL_LINE.test(line.text) || URL_LINE.test(line.text)) continue

    const row = readRow(line, columns)
    // A line with only one filled column is a note, footer or wrapped text, not an item row
    if (Object.values(row).filter(Boolean).length <= 1) continue

    rowNum += 1
    const problems = []
    if (!row.product) problems.push('product missing')
    if (!row.brand) problems.push('brand missing')
    if (!row.platform) problems.push('platform missing')
    const { price, problem } = parsePrice(row.basePrice)
    if (problem) problems.push(problem)

    if (problems.length > 0) {
      const name = row.product ? ` (${row.product})` : ''
      rowErrors.push(`Row ${rowNum}${name}: ${problems.join(', ')}`)
    } else {
      items.push({
        itemId: `ITEM-${String(items.length + 1).padStart(2, '0')}`,
        product: row.product,
        brand: row.brand,
        platform: row.platform,
        basePrice: price,
      })
    }
  }

  if (rowNum === 0) {
    return result({ orderLine, error: 'The table has no item rows.' })
  }
  if (items.length === 0) {
    return result({ rowErrors, orderLine, error: 'None of the rows could be read, so your cart was not changed.' })
  }
  return result({ items, rowErrors, orderLine })
}

// ---- 3. Main entry: file checks, then read, then parse ----

export async function parsePdfCart(file) {
  if (!file) return result({ error: 'No file selected.' })

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (!isPdf) return result({ error: 'Please upload a PDF file (.pdf).' })
  if (file.size === 0) return result({ error: 'This file is empty.' })
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return result({ error: `This file is ${mb} MB. Please upload a PDF under 5 MB.` })
  }

  let pieces
  try {
    pieces = await readPdfPieces(file)
  } catch (err) {
    if (err?.name === 'PasswordException') {
      return result({ error: 'This PDF is password-protected. Please upload an unlocked copy.' })
    }
    console.warn('PDF read failed:', err)
    return result({ error: "This file couldn't be read as a PDF. It may be damaged." })
  }

  if (pieces.length === 0) {
    return result({ error: 'This PDF has no readable text. It may be a scanned image.' })
  }

  try {
    return piecesToCart(pieces)
  } catch (err) {
    console.error('PDF cart parsing failed:', err)
    return result({ error: 'Something went wrong while reading this PDF.' })
  }
}
