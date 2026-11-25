/**
 * PDF cart adapter tests.
 * piecesToCart() is pure, so most tests feed it text pieces like the ones pdf.js returns.
 * The last group reads the real sample PDFs with pdf.js (Node build).
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { piecesToCart, parsePdfCart } from '../src/adapters/pdfCartAdapter.js'

// In Node, use pdf.js's Node build and its worker file instead of the browser ones
vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href,
}))

// One text piece, the way pdf.js gives it: text plus its position on the page
const COLUMN_X = [72, 203, 321, 439]
const piece = (text, x, y) => ({ page: 1, text, x, y, width: text.length * 5.5, height: 11 })
const row = (cells, y) => cells.map((text, i) => (text === null ? null : piece(text, COLUMN_X[i], y))).filter(Boolean)
const HEADER = row(['Product', 'Brand', 'Platform', 'Base Price'], 738)
const ORDER = piece('Order #OP-9921 | Date: 15 Jan 2025', 63, 769)

describe('reading table rows', () => {
  it('a good row becomes a cart item', () => {
    const result = piecesToCart([ORDER, ...HEADER, ...row(['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'], 714)])
    expect(result.error).toBeNull()
    expect(result.rowErrors).toEqual([])
    expect(result.items).toEqual([
      { itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 },
    ])
    expect(result.orderLine).toBe('Order #OP-9921 | Date: 15 Jan 2025')
  })

  it('a row with a missing price is skipped and reported with its row number', () => {
    const result = piecesToCart([
      ...HEADER,
      ...row(['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'], 714),
      ...row(['Bed Sheet Set', 'Natura Casa', 'Flipkart', null], 692),
    ])
    expect(result.items).toHaveLength(1)
    expect(result.rowErrors).toEqual(['Row 2 (Bed Sheet Set): price missing'])
  })

  it.each([
    ['Rs.1,299', 1299],
    ['Rs. 1,299', 1299],
    ['₹1,299', 1299],
    ['INR 1,299', 1299],
    ['1,299/-', 1299],
    ['Rs.1,29,999', 129999],
    ['1299.60', 1300],
  ])('cleans the price "%s" to %i', (price, expected) => {
    const result = piecesToCart([...HEADER, ...row(['Vase', 'LivSpace Pro', 'Noon', price], 714)])
    expect(result.items[0].basePrice).toBe(expected)
  })

  it.each([
    ['abc', 'price "abc" is not a number'],
    ['-Rs.449', 'price can\'t be negative (got "-Rs.449")'],
    ['0', 'price must be more than 0 (got "0")'],
  ])('rejects the price "%s"', (price, reason) => {
    const result = piecesToCart([...HEADER, ...row(['Vase', 'LivSpace Pro', 'Noon', price], 714)])
    expect(result.rowErrors).toEqual([`Row 1 (Vase): ${reason}`])
  })

  it('handles extra spaces: around cells, between words and between columns', () => {
    const result = piecesToCart([
      ...HEADER,
      // Words given as separate pieces, with leading / trailing spaces
      piece(' Cushion', 72, 714), piece('Cover ', 72 + 9 * 5.5 + 2, 714),
      piece('Natura', 203, 714), piece('Casa', 203 + 6 * 5.5 + 3, 714),
      piece('  Amazon India  ', 321, 714), piece(' Rs.1,299 ', 439, 714),
    ])
    expect(result.items[0]).toMatchObject({ product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 })
  })

  it('reads plain-text rows where columns are separated by several spaces', () => {
    const line = (text, y) => ({ page: 1, text, x: 63, y, width: text.length * 6, height: 10 })
    const result = piecesToCart([
      line('Product           Brand          Platform       Base Price', 745),
      line('──────────────────────────────────────────────', 735),
      line('Cushion Cover     Natura Casa    Amazon India   Rs.1,299', 720),
    ])
    expect(result.items[0]).toMatchObject({ product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 })
  })

  it('skips divider, total and note lines', () => {
    const result = piecesToCart([
      ...HEADER,
      piece('-'.repeat(60), 72, 726),
      ...row(['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'], 700),
      piece('Total Rs.599', 321, 680),
      piece('Thank you for shopping with us', 72, 660),
    ])
    expect(result.items).toHaveLength(1)
    expect(result.rowErrors).toEqual([])
  })

  it('no header row: clear error', () => {
    const result = piecesToCart(row(['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'], 714))
    expect(result.error).toBe("Couldn't find the Product / Brand / Platform / Base Price table.")
  })

  it('every row bad: no items and an error', () => {
    const result = piecesToCart([...HEADER, ...row(['Vase', 'LivSpace Pro', 'Noon', 'abc'], 714)])
    expect(result.items).toEqual([])
    expect(result.error).toBe('None of the rows could be read.')
  })
})

describe('file checks (before pdf.js runs)', () => {
  it.each([
    ['no file', null, 'No file selected.'],
    ['not a PDF', new File(['hello'], 'notes.txt', { type: 'text/plain' }), 'Please upload a PDF file (.pdf).'],
    ['empty file', new File([], 'cart.pdf', { type: 'application/pdf' }), 'This file is empty.'],
    ['over 5 MB', new File([new Uint8Array(6 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' }), 'This file is 6.0 MB. Please upload a PDF under 5 MB.'],
  ])('%s', async (_, file, message) => {
    expect((await parsePdfCart(file)).error).toBe(message)
  })
})

describe('real sample PDFs', () => {
  const samplePdf = (name) => {
    const path = fileURLToPath(new URL(`../sample-data/${name}`, import.meta.url))
    return new File([readFileSync(path)], name, { type: 'application/pdf' })
  }

  it('cart.pdf gives the same 6 items as cart.csv', async () => {
    const result = await parsePdfCart(samplePdf('cart.pdf'))
    expect(result.error).toBeNull()
    expect(result.rowErrors).toEqual([])
    expect(result.orderLine).toBe('Order #OP-9921 | Date: 15 Jan 2025')
    expect(result.items.map((i) => [i.product, i.basePrice])).toEqual([
      ['Cushion Cover', 1299], ['Bed Sheet Set', 849], ['Wall Shelf', 599],
      ['Ceramic Vase', 2499], ['Cutting Board', 449], ['Desk Organiser', 899],
    ])
  })

  it('cart-malformed.pdf loads the good rows and explains the bad ones', async () => {
    const result = await parsePdfCart(samplePdf('cart-malformed.pdf'))
    expect(result.items.map((i) => i.product)).toEqual(['Cushion Cover', 'Wall Shelf', 'Desk Organiser'])
    expect(result.rowErrors).toEqual([
      'Row 2 (Bed Sheet Set): price missing',
      'Row 4 (Ceramic Vase): price "abc" is not a number',
      'Row 5 (Cutting Board): price can\'t be negative (got "-Rs.449")',
    ])
  })

  it('a text file renamed to .pdf gives a clear error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // expected: pdf.js reports the broken file
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await parsePdfCart(new File(['not really a pdf'], 'fake.pdf', { type: 'application/pdf' }))
    expect(result.error).toBe("This file couldn't be read as a PDF. It may be damaged.")
  })
})
