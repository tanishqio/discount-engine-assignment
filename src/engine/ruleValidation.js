/**
 * ruleValidation.js
 *
 * One place that checks every discount rule before it reaches the engine.
 * Used by the CSV parser now, and by the text/LLM rule input later.
 *
 * Input: a raw rule using the engine's field names. Values can be strings
 * (from CSV) or numbers/booleans (from the LLM):
 *   { ruleId, scope, appliesTo, type, value, stackable, minCartValue }
 *
 * Output:
 *   { ok: true, rule }     -> clean DiscountRule, safe for the engine
 *   { ok: false, errors }  -> list of readable error messages
 *
 * A valid rule:
 *   - scope is brand, platform or cart
 *   - type is percentage or flat
 *   - value is a number greater than 0 (a percentage can't be more than 100)
 *   - brand/platform rules need a target name (appliesTo)
 *   - cart rules need a minimum cart value greater than 0
 *   - stackable is true/false (missing means false)
 *   - a missing ruleId gets a generated one (RULE-CUSTOM-1, RULE-CUSTOM-2, ...)
 */

const SCOPES = ['brand', 'platform', 'cart']
const TYPES = ['percentage', 'flat']
const TRUE_WORDS = ['true', 'yes', '1']
const FALSE_WORDS = ['false', 'no', '0']

// Counter for generated ids. Lives for the browser session (no persistence needed).
let customCount = 0

// true for undefined, null, '' and '   '
function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === ''
}

// Accepts 4000, "4000", "4,000", "12.5". Anything else ("20%", "Rs.150", "-5", true) gives NaN.
function toNumber(v) {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return NaN
  const s = v.replace(/,/g, '').trim()
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

export function validateRule(raw) {
  // The LLM might return null, a string or an array instead of an object
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['rule must be an object with scope, type and value'] }
  }

  const errors = []

  // scope
  const scope = String(raw.scope ?? '').trim().toLowerCase()
  if (isBlank(raw.scope)) {
    errors.push('scope is required (brand, platform or cart)')
  } else if (!SCOPES.includes(scope)) {
    errors.push(`scope must be brand, platform or cart, got "${raw.scope}"`)
  }

  // type
  const type = String(raw.type ?? '').trim().toLowerCase()
  if (isBlank(raw.type)) {
    errors.push('type is required (percentage or flat)')
  } else if (!TYPES.includes(type)) {
    errors.push(`type must be percentage or flat, got "${raw.type}"`)
  }

  // value
  const value = toNumber(raw.value)
  if (isBlank(raw.value)) {
    errors.push('value is required')
  } else if (!Number.isFinite(value) || value <= 0) {
    errors.push(`value must be a number greater than 0, got "${raw.value}"`)
  } else if (type === 'percentage' && value > 100) {
    errors.push(`a percentage can't be more than 100, got ${value}`)
  }

  // appliesTo: only brand/platform rules need it. Cart rules apply to the whole cart.
  let appliesTo = ''
  if (scope === 'brand' || scope === 'platform') {
    if (typeof raw.appliesTo !== 'string' || raw.appliesTo.trim() === '') {
      errors.push(`${scope} rules need a ${scope} name (applies to)`)
    } else {
      appliesTo = raw.appliesTo.trim().replace(/\s+/g, ' ') // "Natura   Casa" -> "Natura Casa"
    }
  }

  // minCartValue: only cart rules need it. Other rules get null.
  let minCartValue = null
  if (scope === 'cart') {
    minCartValue = toNumber(raw.minCartValue)
    if (isBlank(raw.minCartValue)) {
      errors.push('cart rules need a minimum cart value')
    } else if (!Number.isFinite(minCartValue) || minCartValue <= 0) {
      errors.push(`minimum cart value must be a number greater than 0, got "${raw.minCartValue}"`)
    }
  }

  // stackable: missing means false, anything unclear is an error
  let stackable = false
  if (!isBlank(raw.stackable)) {
    const s = String(raw.stackable).trim().toLowerCase()
    if (TRUE_WORDS.includes(s)) {
      stackable = true
    } else if (!FALSE_WORDS.includes(s)) {
      errors.push(`stackable must be true or false, got "${raw.stackable}"`)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // ruleId: generated only for valid rules, so failed rules don't use up numbers
  let ruleId = String(raw.ruleId ?? '').trim()
  if (ruleId === '') {
    customCount += 1
    ruleId = `RULE-CUSTOM-${customCount}`
  }

  return { ok: true, rule: { ruleId, scope, appliesTo, type, value, stackable, minCartValue } }
}
