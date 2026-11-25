/**
 * CartSummary.jsx
 * Summary rows under the results table:
 *   Cart total before offer, cart offer row (only if it applies), final cart total.
 * When the cart is below the threshold, a nudge row shows instead of the offer row.
 * Display only: all numbers and text come from applyCartDiscount().
 */

const rs = (n) => `Rs.${n.toLocaleString('en-IN')}`

// 4 columns: label | value or description | amount | tag
const row = (background) => ({
  display: 'grid',
  gridTemplateColumns: '1.6fr 3fr 1fr 1fr',
  gap: '1rem',
  alignItems: 'start',
  padding: '10px 12px',
  background,
  borderTop: '1px solid #efe6c4',
  fontSize: 13,
})

const label = { fontWeight: 700, color: '#131A48' }

const tag = {
  display: 'inline-block', padding: '2px 10px', borderRadius: 20,
  background: '#e3f4ea', color: '#1e5c2c', fontSize: 11, fontWeight: 700,
}

export default function CartSummary({ summary }) {
  const { subtotal, cartOffer, finalTotal, nudge } = summary

  return (
    <div style={{ marginTop: 8, border: '1px solid #CECECE', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ ...row('#fffbea'), borderTop: 'none' }}>
        <span style={label}>Cart Total before offer</span>
        <span style={label}>{rs(subtotal)}</span>
      </div>

      {cartOffer && (
        <div style={row('#fffbea')}>
          <span style={{ ...label, color: '#8a4b00' }}>Cart Offer: {cartOffer.ruleId}</span>
          <span style={{ color: '#666' }}>{cartOffer.label}</span>
          <span style={{ fontWeight: 700, color: '#1e5c2c' }}>{rs(cartOffer.saved)}</span>
          <span><span style={tag}>Cart offer</span></span>
        </div>
      )}

      {/* The engine only sets a nudge when no cart offer applied */}
      {nudge && (
        <div style={row('#fffbea')}>
          <span style={{ ...label, color: '#8a4b00' }}>Cart Offer</span>
          <span style={{ gridColumn: '2 / 5', color: '#8a4b00' }}>{nudge}</span>
        </div>
      )}

      <div style={row('#e8f5ec')}>
        <span style={label}>Final Cart Total</span>
        <span style={{ ...label, fontSize: 20 }}>{rs(finalTotal)}</span>
      </div>
    </div>
  )
}
