/**
 * nlRuleAdapter.js
 *
 * Text input adapter: turns a merchant's plain-English rule into DiscountRule objects.
 * It sends the text to our serverless function (api/parse-rule.js), which calls the LLM.
 * Every rule the LLM returns goes through validateRule(), the same gate the CSV uses,
 * before the UI can show it. Nothing here touches the engine.
 *
 *   parseRuleText(text, cartItems) returns one of:
 *     { status: 'ok', reason, results: [{ ok: true, rule } or { ok: false, errors, raw }] }
 *     { status: 'unresolvable', message, example }   (example is null if the message already has one)
 *     { status: 'error', message }
 *
 *   It never throws, so a bad answer can't crash the page.
 */

import { validateRule } from '../engine/ruleValidation.js'

const API_URL = '/api/parse-rule'
const MAX_TEXT_LENGTH = 500 // same limit as the server
const TIMEOUT_MS = 15_000 // longer than the server's own 10-second limit, so its clearer message arrives first
const MAX_RULES = 10

const CANT_REACH = "Couldn't reach the rule parser, try again."
const INVALID_RESPONSE = 'The AI returned an invalid response.'

// Unique, non-empty brand or platform names from the current cart
function uniqueNames(items, key) {
  const names = items
    .map((item) => item?.[key])
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim())
  return [...new Set(names)]
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function parseRuleText(text, cartItems = []) {
  // 1. Check the text here too, so we don't waste an AI request
  const cleanText = typeof text === 'string' ? text.trim() : ''
  if (!cleanText) {
    return { status: 'error', message: 'Please type a discount rule first.' }
  }
  if (cleanText.length > MAX_TEXT_LENGTH) {
    return {
      status: 'error',
      message: `Please keep the rule under ${MAX_TEXT_LENGTH} characters (yours has ${cleanText.length}).`,
    }
  }

  // The cart's names help the AI tell a brand from a platform
  const items = Array.isArray(cartItems) ? cartItems : []
  const knownBrands = uniqueNames(items, 'brand')
  const knownPlatforms = uniqueNames(items, 'platform')

  // 2. Ask the server, with a time limit
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  let bodyText
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, knownBrands, knownPlatforms }),
      signal: controller.signal,
    })
    bodyText = await response.text()
  } catch {
    // No network, server not running, or our own time limit ran out
    return { status: 'error', message: CANT_REACH }
  } finally {
    clearTimeout(timer)
  }

  // 3. Read the answer
  let data
  try {
    data = JSON.parse(bodyText)
  } catch {
    if (response.status === 404) {
      return { status: 'error', message: "The rule parser isn't available here. Please try again later." }
    }
    return { status: 'error', message: INVALID_RESPONSE }
  }

  if (!response.ok) {
    // The server already sends a readable message (busy, too slow, not set up, ...)
    const message = isObject(data) && typeof data.error === 'string' && data.error.trim()
      ? data.error.trim()
      : 'Something went wrong while reading the rule. Please try again.'
    return { status: 'error', message }
  }

  if (!isObject(data) || !Array.isArray(data.rules) || (data.status !== 'ok' && data.status !== 'unresolvable')) {
    return { status: 'error', message: INVALID_RESPONSE }
  }

  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''

  // 4. Not enough information: show the AI's reason plus an example (unless it already gave one)
  if (data.status === 'unresolvable' || data.rules.length === 0) {
    const message = data.status === 'unresolvable'
      ? reason || 'Please describe the discount more specifically.'
      : "The AI couldn't find a discount rule in that text."
    const alreadyHasExample = /\b(try|for example|e\.g\.|such as)\b/i.test(message)
    const example = alreadyHasExample ? null : `Try: '15% off on ${knownPlatforms[0] || 'Flipkart'} items'`
    return { status: 'unresolvable', message, example }
  }

  // 5. Check every rule with the same validator as the CSV.
  // The AI never chooses the rule id, so it can't overwrite an existing rule like RULE-01.
  const results = data.rules.slice(0, MAX_RULES).map((raw) => {
    const check = validateRule(isObject(raw) ? { ...raw, ruleId: undefined } : raw)
    return check.ok ? { ok: true, rule: check.rule } : { ok: false, errors: check.errors, raw }
  })

  return { status: 'ok', reason, results }
}
