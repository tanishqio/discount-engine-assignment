/**
 * RuleTextInput.jsx
 *
 * Text box where the merchant describes a discount in plain English.
 * The text goes through nlRuleAdapter (LLM + validateRule) and each parsed rule
 * is shown on a RuleConfirmCard. Only rules the user confirms are passed up with onConfirm(rule).
 */

import { useState } from 'react'
import { parseRuleText } from '../adapters/nlRuleAdapter.js'
import RuleConfirmCard from './RuleConfirmCard.jsx'

const MAX_LENGTH = 500 // same limit as the adapter and the server

const NOTICE_STYLES = {
  error: { background: '#fce8e8', border: '#e57373', color: '#5a1010' },
  unresolvable: { background: '#fff7e6', border: '#f0b429', color: '#7a4a00' },
  success: { background: '#f0faf2', border: '#7bc68a', color: '#1e5c2c' },
}

export default function RuleTextInput({ cartItems, rules, onConfirm }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null) // { kind, message, example }
  const [reason, setReason] = useState('') // what the AI understood
  const [cards, setCards] = useState([]) // parsed rules waiting for Confirm / Discard

  const length = text.trim().length

  function handleChange(e) {
    setText(e.target.value)
    // The cards belong to the old text, so clear them when the text changes
    if (cards.length > 0 || notice) {
      setCards([])
      setNotice(null)
      setReason('')
    }
  }

  async function handleParse() {
    if (loading) return
    setLoading(true)
    setCards([])
    setNotice(null)
    setReason('')

    const result = await parseRuleText(text, cartItems)
    setLoading(false)

    if (result.status === 'ok') {
      setReason(result.reason)
      setCards(result.results.map((r, i) => ({ ...r, key: `${Date.now()}-${i}` })))
    } else {
      setNotice({ kind: result.status, message: result.message, example: result.example })
    }
  }

  function handleKeyDown(e) {
    // Enter parses, Shift+Enter adds a new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleParse()
    }
  }

  function removeCard(card) {
    const remaining = cards.filter((c) => c !== card)
    setCards(remaining)
    if (remaining.length === 0) setReason('')
    return remaining
  }

  function handleConfirm(card) {
    const ruleId = onConfirm(card.rule)
    const remaining = removeCard(card)
    setNotice({ kind: 'success', message: `Added ${ruleId}. The results have been updated.` })
    if (remaining.length === 0) setText('')
  }

  const noticeStyle = notice ? NOTICE_STYLES[notice.kind] : null

  return (
    <div style={{ marginTop: '0.9rem' }}>
      <label htmlFor="rule-text" style={{ display: 'block', fontWeight: 700, fontSize: 12, color: '#131A48', marginBottom: 4 }}>
        Or describe a rule in plain English
      </label>
      <textarea
        id="rule-text"
        rows={2}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={loading}
        placeholder="e.g. 20% off for Natura Casa brand, stackable with other offers"
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13,
          padding: '0.5rem 0.6rem', border: '1px solid #CECECE', borderRadius: 4, color: '#131A48',
          background: loading ? '#f4f4f4' : '#fff',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 11, color: length > MAX_LENGTH ? '#c0392b' : '#888' }}>
          {length}/{MAX_LENGTH}
        </span>
        <button
          type="button"
          onClick={handleParse}
          disabled={loading}
          style={{
            background: loading ? '#CECECE' : '#131A48', color: '#fff', border: 'none', borderRadius: 4,
            padding: '0.45rem 1.1rem', fontSize: 12, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Parsing...' : 'Parse rule'}
        </button>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          style={{
            marginTop: 8, padding: '0.55rem 0.8rem', borderRadius: 4, fontSize: 12,
            background: noticeStyle.background, borderLeft: `3px solid ${noticeStyle.border}`, color: noticeStyle.color,
          }}
        >
          {notice.message}
          {notice.example && <div style={{ marginTop: 4, fontStyle: 'italic' }}>{notice.example}</div>}
        </div>
      )}

      {reason && cards.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
          <strong>AI understood:</strong> {reason}
        </div>
      )}

      {cards.map((card) => (
        <RuleConfirmCard
          key={card.key}
          result={card}
          cartItems={cartItems}
          rules={rules}
          onConfirm={() => handleConfirm(card)}
          onDiscard={() => removeCard(card)}
        />
      ))}
    </div>
  )
}
