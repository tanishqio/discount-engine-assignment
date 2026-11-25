/**
 * RuleConfirmCard.jsx
 *
 * Shows one rule parsed from plain English before it is added.
 * Valid rule: its fields in plain words, a preview of what it does to the current cart,
 * and Confirm / Discard. Invalid rule: the validator's errors and Dismiss. It can't be confirmed.
 * The preview only reads the engine; it never changes it.
 */

import { ruleMatchesItem, processCart, applyCartDiscount, cartTotal } from '../engine/discountEngine.js'

const rs = (n) => `Rs.${n.toLocaleString('en-IN')}`

const SCOPE_LABEL = { brand: 'Brand', platform: 'Platform', cart: 'Whole cart' }

function sameRule(a, b) {
  return (
    a.scope === b.scope &&
    a.appliesTo.toLowerCase() === b.appliesTo.toLowerCase() &&
    a.type === b.type &&
    a.value === b.value &&
    a.stackable === b.stackable &&
    a.minCartValue === b.minCartValue
  )
}

// Plain-language lines about what this rule would do to the current cart
function previewLines(rule, cartItems, rules) {
  if (cartItems.length === 0) return ['Upload a cart to see how this rule affects it.']

  const lines = []
  let matchesItems = true

  if (rule.scope === 'cart') {
    const subtotal = cartTotal(processCart(cartItems, rules))
    lines.push(
      subtotal >= rule.minCartValue
        ? `Applies to the whole cart: your cart total (${rs(subtotal)}) already reaches ${rs(rule.minCartValue)}.`
        : `Applies to the whole cart once it reaches ${rs(rule.minCartValue)}. Your cart is ${rs(subtotal)} now (${rs(rule.minCartValue - subtotal)} more needed).`
    )
  } else {
    const count = cartItems.filter((item) => ruleMatchesItem(item, rule)).length
    matchesItems = count > 0
    lines.push(
      matchesItems
        ? `This rule will apply to ${count} item${count === 1 ? '' : 's'} in your cart.`
        : 'This rule matches no items in your current cart.'
    )
  }

  // Run the engine with and without the rule to show the effect on the final total
  const before = applyCartDiscount(processCart(cartItems, rules), rules).finalTotal
  const withRule = [...rules, rule]
  const after = applyCartDiscount(processCart(cartItems, withRule), withRule).finalTotal
  if (after !== before) {
    lines.push(`Final cart total: ${rs(before)} → ${rs(after)}`)
  } else if (matchesItems && rule.scope !== 'cart') {
    lines.push(`Your cart total stays ${rs(before)}: an existing offer already gives these items a bigger saving.`)
  } else {
    lines.push(`Your cart total stays ${rs(before)}.`)
  }

  const duplicate = rules.find((r) => sameRule(r, rule))
  if (duplicate) lines.push(`Note: this is the same as active rule ${duplicate.ruleId}.`)

  return lines
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#131A48', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

const button = (primary) => ({
  background: primary ? '#FF5800' : '#fff',
  color: primary ? '#fff' : '#131A48',
  border: primary ? 'none' : '1px solid #CECECE',
  borderRadius: 4, padding: '0.4rem 1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer',
})

export default function RuleConfirmCard({ result, cartItems, rules, onConfirm, onDiscard }) {
  if (!result.ok) {
    return (
      <div style={{ marginTop: 8, border: '1px solid #e57373', borderRadius: 6, padding: '0.7rem 0.9rem', background: '#fdf3f3' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#8a1a1a', marginBottom: 4 }}>This rule can't be added</div>
        {result.errors.map((error, i) => (
          <div key={i} style={{ fontSize: 12, color: '#5a1010' }}>• {error}</div>
        ))}
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onDiscard} style={button(false)}>Dismiss</button>
        </div>
      </div>
    )
  }

  const { rule } = result
  const lines = previewLines(rule, cartItems, rules)

  return (
    <div style={{ marginTop: 8, border: '1px solid #FF5800', borderRadius: 6, padding: '0.7rem 0.9rem', background: '#fffaf5' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48', marginBottom: 8 }}>Check this rule before adding it</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
        <Field label="Scope" value={SCOPE_LABEL[rule.scope]} />
        <Field label="Applies to" value={rule.scope === 'cart' ? 'Entire cart' : rule.appliesTo} />
        <Field label="Type" value={rule.type === 'percentage' ? 'Percentage' : 'Flat amount'} />
        <Field label="Value" value={rule.type === 'percentage' ? `${rule.value}% off` : `${rs(rule.value)} off`} />
        <Field label="Stackable" value={rule.stackable ? 'Yes, adds on top of other offers' : 'No'} />
        <Field label="Min cart value" value={rule.scope === 'cart' ? rs(rule.minCartValue) : 'Not needed'} />
      </div>
      <div style={{ marginTop: 8, padding: '0.5rem 0.6rem', background: '#fff', border: '1px dashed #f3c5a5', borderRadius: 4, fontSize: 12, color: '#131A48' }}>
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={onConfirm} style={button(true)}>Confirm</button>
        <button type="button" onClick={onDiscard} style={button(false)}>Discard</button>
      </div>
    </div>
  )
}
