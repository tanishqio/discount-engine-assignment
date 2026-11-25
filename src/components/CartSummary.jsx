/**
 * CartSummary.jsx
 * Shows the cart total, the cart offer row (only if it applies),
 * the final total, and a nudge when the cart is below an offer threshold.
 * Display only: all numbers and text come from applyCartDiscount().
 */

const rs = (n) => `Rs.${n.toLocaleString('en-IN')}`

const row = {
  display: 'flex', justifyContent: 'space-between', gap: '1rem',
  padding: '0.4rem 0', fontSize: 13, color: '#131A48',
}

export default function CartSummary({ summary }) {
  const { subtotal, cartOffer, finalTotal, nudge } = summary

  return (
    <div style={{ marginTop: '0.75rem', marginLeft: 'auto', maxWidth: 420 }}>
      <div style={row}>
        <span>Cart total before offer</span>
        <span>{rs(subtotal)}</span>
      </div>

      {cartOffer && (
        <div style={{ ...row, color: '#1e5c2c', fontWeight: 600 }}>
          <span>{cartOffer.label}</span>
          <span>−{rs(cartOffer.saved)}</span>
        </div>
      )}

      <div style={{ ...row, borderTop: '2px solid #131A48', marginTop: 4, paddingTop: 8, fontWeight: 700, fontSize: 15 }}>
        <span>Final cart total</span>
        <span>{rs(finalTotal)}</span>
      </div>

      {/* The engine only sets a nudge when no cart offer applied */}
      {nudge && (
        <div style={{ marginTop: 8, padding: '0.5rem 0.75rem', background: '#fff7e6', borderLeft: '3px solid #FF5800', borderRadius: 4, fontSize: 12, color: '#7a4a00' }}>
          {nudge}
        </div>
      )}
    </div>
  )
}
