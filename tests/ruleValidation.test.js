/**
 * Validator tests: every rule, from the CSV or from the LLM, goes through validateRule()
 * before it reaches the engine. Bad rules must be rejected with readable errors.
 */
import { describe, it, expect } from 'vitest'
import { validateRule } from '../src/engine/ruleValidation.js'

const valid = (overrides) => ({
  ruleId: 'R', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: false, minCartValue: null, ...overrides,
})
const errorsFor = (raw) => {
  const result = validateRule(raw)
  expect(result.ok).toBe(false)
  return result.errors.join(' | ')
}

describe('accepts valid rules', () => {
  it.each([
    ['brand, percentage, stackable', { scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true }],
    ['platform, flat', { scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false }],
    ['cart, percentage, threshold', { scope: 'cart', appliesTo: null, type: 'percentage', value: 10, minCartValue: 5000 }],
    ['cart, flat', { scope: 'cart', type: 'flat', value: 200, minCartValue: 3000 }],
    ['percentage of exactly 100', valid({ value: 100 })],
  ])('%s', (_, raw) => {
    expect(validateRule(raw).ok).toBe(true)
  })

  it('cleans CSV-style strings into the engine shape', () => {
    const { rule } = validateRule({
      ruleId: ' RULE-04 ', scope: ' CART ', appliesTo: '', type: 'Percentage', value: '10', stackable: 'FALSE', minCartValue: '4,000',
    })
    expect(rule).toEqual({ ruleId: 'RULE-04', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 4000 })
  })

  it('trims names and squeezes inner spaces', () => {
    expect(validateRule(valid({ scope: 'brand', appliesTo: '  Natura   Casa ' })).rule.appliesTo).toBe('Natura Casa')
  })

  it.each([['TRUE', true], ['yes', true], ['1', true], [true, true], ['no', false], ['0', false], [false, false], [undefined, false], ['', false]])(
    'stackable %j -> %j',
    (input, expected) => {
      expect(validateRule(valid({ stackable: input })).rule.stackable).toBe(expected)
    }
  )

  it('gives a generated id to rules without one', () => {
    expect(validateRule(valid({ ruleId: undefined })).rule.ruleId).toMatch(/^RULE-CUSTOM-\d+$/)
  })

  it('ignores fields that do not belong to the rule', () => {
    expect(validateRule(valid({ minCartValue: 4000 })).rule.minCartValue).toBeNull() // only cart rules have a threshold
    expect(validateRule({ ...valid(), injected: 'x' }).rule).not.toHaveProperty('injected')
  })

  it('does not change the object it was given', () => {
    const raw = valid({ value: '15', appliesTo: ' Flipkart ' })
    validateRule(raw)
    expect(raw).toEqual(valid({ value: '15', appliesTo: ' Flipkart ' }))
  })
})

describe('rejects invalid rules with readable errors', () => {
  it.each([
    ['text value "20%"', valid({ value: '20%' }), /value must be a number greater than 0/],
    ['text value "abc"', valid({ value: 'abc' }), /value must be a number greater than 0/],
    ['text value "Rs.150"', valid({ type: 'flat', value: 'Rs.150' }), /value must be a number greater than 0/],
    ['value 0', valid({ value: 0 }), /value must be a number greater than 0/],
    ['negative value', valid({ value: -5 }), /value must be a number greater than 0/],
    ['NaN', valid({ value: NaN }), /value must be a number greater than 0/],
    ['boolean value', valid({ value: true }), /value must be a number greater than 0/],
    ['missing value', valid({ value: undefined }), /value is required/],
    ['percentage over 100', valid({ value: 150 }), /a percentage can't be more than 100/],
    ['cart rule without a threshold', { scope: 'cart', type: 'percentage', value: 10 }, /cart rules need a minimum cart value/],
    ['cart rule with threshold 0', { scope: 'cart', type: 'percentage', value: 10, minCartValue: 0 }, /minimum cart value must be a number greater than 0/],
    ['brand rule without a target', valid({ scope: 'brand', appliesTo: '' }), /brand rules need a brand name/],
    ['platform rule with only spaces as target', valid({ appliesTo: '   ' }), /platform rules need a platform name/],
    ['unknown scope', valid({ scope: 'shop' }), /scope must be brand, platform or cart/],
    ['unknown type', valid({ type: 'percent' }), /type must be percentage or flat/],
    ['unclear stackable', valid({ stackable: 'maybe' }), /stackable must be true or false/],
  ])('%s', (_, raw, message) => {
    expect(errorsFor(raw)).toMatch(message)
  })

  it.each([['null', null], ['undefined', undefined], ['a string', 'rule'], ['an array', []], ['a number', 5]])(
    'not an object: %s',
    (_, raw) => {
      expect(errorsFor(raw)).toMatch(/rule must be an object/)
    }
  )

  it('lists every problem at once', () => {
    expect(validateRule({ scope: 'brand', appliesTo: '', type: 'percent', value: '20%', stackable: 'maybe' }).errors).toHaveLength(4)
  })

  it('vague LLM output like {} is rejected', () => {
    expect(validateRule({}).errors).toEqual([
      'scope is required (brand, platform or cart)',
      'type is required (percentage or flat)',
      'value is required',
    ])
  })
})
