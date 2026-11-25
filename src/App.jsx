/**
 * App.jsx
 *
 * Top-level component. Manages state for rules, cart items, and results.
 * Wires together CSV / PDF upload → parse → engine → display.
 */

import { useState, useMemo } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import CartSummary from './components/CartSummary.jsx'
import { parseRulesCSV, parseCartCSV } from './engine/csvParser.js'
import { processCart, applyCartDiscount } from './engine/discountEngine.js'
import PdfUploader from './components/PdfUploader.jsx'
import { parsePdfCart } from './adapters/pdfCartAdapter.js'
import RuleTextInput from './components/RuleTextInput.jsx'


// ── Column definitions ───────────────────────────────────────────

const RULES_COLUMNS = [
  { key: 'ruleId', label: 'Rule ID' },
  { key: 'scope', label: 'Scope', render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  { key: 'appliesTo', label: 'Applies To', render: (v, row) => row.scope === 'cart' ? 'Entire cart' : v },
  { key: 'type', label: 'Type', render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => row.type === 'percentage' ? `${v}% off` : `Rs.${v} off`,
  },
  { key: 'stackable', label: 'Stackable', render: (v) => (v ? 'Yes' : 'No') },
  { key: 'minCartValue', label: 'Condition', render: (v) => v ? `Cart total ≥ Rs.${v.toLocaleString('en-IN')}` : '-' }
]

const CART_COLUMNS = [
  { key: 'itemId', label: 'Item' },
  { key: 'product', label: 'Product' },
  { key: 'brand', label: 'Brand' },
  { key: 'platform', label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
]

const RESULTS_COLUMNS = [
  { key: 'itemId', label: 'Item' },
  { key: 'product', label: 'Product' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
  {
    key: 'finalPrice', label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
        Rs.{v.toLocaleString('en-IN')}
      </span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? (
        <span style={{ color: '#1e5c2c', fontWeight: 600 }}>Rs.{v.toLocaleString('en-IN')}</span>
      ) : (
        <span style={{ color: '#888' }}>—</span>
      ),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
        render: (v, row) => (
      <span style={{ color: row.appliedRules.length === 0 ? '#888' : '#131A48', fontStyle: row.appliedRules.length === 0 ? 'italic' : 'normal' }}>
        {v}
      </span>
    ),
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page: { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header: { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan: { color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main: { maxWidth: 960, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  btn: {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  totalRow: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '1rem', marginTop: '0.75rem', paddingTop: '0.75rem',
    borderTop: '2px solid #131A48',
  },
  totalLabel: { fontWeight: 700, fontSize: 14, color: '#131A48' },
  totalValue: { fontWeight: 700, fontSize: 16, color: '#131A48' },
  tag: (color, bg) => ({
    display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 6px',
    borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
  }),
}

// Rules added by typing get the next free id: RULE-CUSTOM-1, RULE-CUSTOM-2, ...
function nextCustomRuleId(rules) {
  const taken = new Set(rules.map((r) => r.ruleId))
  let n = 1
  while (taken.has(`RULE-CUSTOM-${n}`)) n += 1
  return `RULE-CUSTOM-${n}`
}



// ── Component ────────────────────────────────────────────────────

export default function App() {
  // Rules from the CSV and rules typed in plain English are kept apart, so a new CSV
  // doesn't wipe out rules the user added. The engine always gets both.
  const [csvRules, setCsvRules] = useState([])
  const [customRules, setCustomRules] = useState([])
  const rules = useMemo(() => [...csvRules, ...customRules], [csvRules, customRules])
  const [rulesErrors, setRulesErr] = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems] = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartFileName, setCartFileName] = useState('')

  const [cartNotice, setCartNotice] = useState('') // e.g. "Loaded 6 items from Order #OP-9921 ..."
  const [pdfLoading, setPdfLoading] = useState(false)

  // Results are worked out from the current cart and rules, so any change re-runs the engine.
  // "Calculate Discounts" only decides when to start showing them.
  const [showResults, setShowResults] = useState(false)
  const results = useMemo(
    () => (showResults && rules.length > 0 && cartItems.length > 0 ? processCart(cartItems, rules) : null),
    [showResults, cartItems, rules]
  )

  const isPdfCart = /\.pdf$/i.test(cartFileName)


  // ── Handlers ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setCsvRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
    setCartNotice('')
  }


  async function handlePdfLoad(file) {
    setPdfLoading(true)
    const { items, rowErrors, orderLine, error } = await parsePdfCart(file)
    setPdfLoading(false)

    if (items.length === 0) {
      // Nothing usable in this PDF: keep the current cart and explain why
      setCartItems([])
      setCartFileName('')
      setCartErrors([error, ...rowErrors])
      setCartNotice('')
      return
    }

    setCartItems(items) // replace the cart
    setCartErrors(rowErrors)
    setCartFileName(file.name)
    const skipped = rowErrors.length
    setCartNotice(
      `Loaded ${items.length} item${items.length === 1 ? '' : 's'}` +
      (orderLine ? ` from ${orderLine}` : '') +
      (skipped > 0 ? `, skipped ${skipped} row${skipped === 1 ? '' : 's'} (reasons below)` : '')
    )
    setShowResults(true) // re-run the engine right away with the current rules
  }

  function handleCalculate() {
    setShowResults(true)
  }


  // A rule typed in plain English was confirmed: add it and show the updated results
  function handleAddRule(rule) {
    const ruleId = nextCustomRuleId(rules)
    setCustomRules([...customRules, { ...rule, ruleId, addedByUser: true }])
    setShowResults(true)
    return ruleId
  }

  function handleRemoveRule(ruleId) {
    setCustomRules(customRules.filter((r) => r.ruleId !== ruleId))
  }

  // Same columns as before, plus "Added by you / Remove" on the custom rules
  const customIds = new Set(customRules.map((r) => r.ruleId))
  const rulesColumns = [
    ...RULES_COLUMNS,
    {
      key: 'actions',
      label: '',
      render: (_, row) =>
        customIds.has(row.ruleId) ? (
          <span style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
            <span style={{ color: '#888' }}>Added by you · </span>
            <button
              type="button"
              onClick={() => handleRemoveRule(row.ruleId)}
              style={{ background: 'none', border: 'none', padding: 0, color: '#c0392b', fontWeight: 700, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Remove
            </button>
          </span>
        ) : null,
    },
  ]


  const canCalculate = rules.length > 0 && cartItems.length > 0

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={csvRules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />
            <RuleTextInput cartItems={cartItems} rules={rules} onConfirm={handleAddRule} />
            {rules.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {rules.length} rule{rules.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={rulesColumns} rows={rules} />
              </div>
            )}
          </div>

          {/* Cart upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <CsvUploader
              label="cart.csv"
              description="Upload your cart CSV"
              onLoad={handleCartLoad}
              hasData={cartItems.length > 0 && !isPdfCart}
              fileName={cartFileName}
            />
            <PdfUploader
              onFile={handlePdfLoad}
              loading={pdfLoading}
              fileName={isPdfCart ? cartFileName : ''}
            />
            {cartNotice && (
              <div style={{ fontSize: 12, color: '#1e5c2c', marginTop: '0.5rem' }}>{cartNotice}</div>
            )}
            <ErrorBanner errors={cartErrors} />

            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button
            style={canCalculate ? S.btn : S.btnDisabled}
            onClick={handleCalculate}
            disabled={!canCalculate}
          >
            Calculate Discounts
          </button>
          {!canCalculate && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              Upload both files to calculate
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />
            {/*<div style={S.totalRow}>
              <span style={S.totalLabel}>Cart Total</span>
              <span style={S.totalValue}>Rs.{cartTotal(results).toLocaleString('en-IN')}</span>
            </div>*/}
            <CartSummary summary={applyCartDiscount(results, rules)} />
          </div>
        )}



      </div>
    </div>
  )
}
