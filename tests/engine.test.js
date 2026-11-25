/**
 * Engine tests: the brief's expected results, the cart-level offer and its threshold,
 * and the edge cases the brief asks about ("cart total just below the threshold").
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/engine/csvParser.js'
import {
  applyDiscounts,
  processCart,
  cartTotal,
  applyCartDiscount,
  calculateDiscountAmount,
  ruleMatchesItem,
} from '../src/engine/discountEngine.js'

const sample = (name) => readFileSync(new URL(`../sample-data/${name}`, import.meta.url), 'utf8')
const rules = parseRulesCSV(sample('rules.csv')).data
const cart = parseCartCSV(sample('cart.csv')).data

const rule = (overrides) => ({
  ruleId: 'R', scope: 'brand', appliesTo: 'B', type: 'flat', value: 10, stackable: false, minCartValue: null, ...overrides,
})
const cartRule = (overrides) => rule({ ruleId: 'C', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, minCartValue: 4000, ...overrides })
const item = (basePrice, overrides) => ({ itemId: 'X', product: 'P', brand: 'B', platform: 'P1', basePrice, ...overrides })
// A cart whose item discounts are already applied, with a given subtotal
const subtotalOf = (amount) => [{ finalPrice: amount }]

describe('brief: expected results for the sample data', () => {
  const results = processCart(cart, rules)
  const byId = Object.fromEntries(results.map((r) => [r.itemId, r]))

  it.each([
    ['ITEM-01', 1299, 1104, ['RULE-01'], ['RULE-02']], // 15% (Rs.195) beats Rs.150
    ['ITEM-02', 849, 629, ['RULE-02', 'RULE-03'], []], // Rs.150 off, then 10% stacked
    ['ITEM-03', 599, 509, ['RULE-01'], []],
    ['ITEM-04', 2499, 2499, [], []], // no rules match
    ['ITEM-05', 449, 382, ['RULE-01'], []],
    ['ITEM-06', 899, 809, ['RULE-03'], []], // stackable rule on its own
  ])('%s: Rs.%i -> Rs.%i', (id, base, final, applied, skipped) => {
    expect(byId[id].basePrice).toBe(base)
    expect(byId[id].finalPrice).toBe(final)
    expect(byId[id].totalDiscount).toBe(base - final)
    expect(byId[id].appliedRules).toEqual(applied)
    expect(byId[id].skippedRules).toEqual(skipped)
  })

  it('cart total 5932, cart offer RULE-04 saves 593, final total 5339', () => {
    const summary = applyCartDiscount(results, rules)
    expect(summary.subtotal).toBe(5932)
    expect(summary.cartOffer).toMatchObject({ ruleId: 'RULE-04', saved: 593 })
    expect(summary.finalTotal).toBe(5339)
    expect(summary.nudge).toBeNull()
  })

  it('cart offer row explains the maths', () => {
    expect(applyCartDiscount(results, rules).cartOffer.label).toBe('Rs.5,932 ≥ Rs.4,000 → 10% off entire cart → -Rs.593')
  })

  it('ITEM-01 rounds 1299 x 15% = 194.85 to Rs.195', () => {
    expect(calculateDiscountAmount(1299, rules[0])).toBe(195)
  })
})

describe('customer-facing offer text', () => {
  const results = processCart(cart, rules)

  it('explains why the winning offer was picked', () => {
    expect(results[0].reasoning).toBe('Platform offer: 15% off (saves Rs.195, better than the Rs.150 brand offer)')
  })
  it('marks stacked offers', () => {
    expect(results[1].reasoning).toBe('Brand offer: Rs.150 off + Platform offer: 10% off (stacked)')
  })
  it('gives ITEM-04 a meaningful "no offer" message', () => {
    expect(results[3].reasoning).toBe('No offers available for LivSpace Pro on Noon')
  })
  it('does not call a stackable rule "stacked" when it applies on its own', () => {
    expect(results[5].reasoning).toBe('Platform offer: 10% off')
  })
  it('stays accurate after a rule is added by the user', () => {
    const added = rule({ ruleId: 'RULE-CUSTOM-1', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, addedByUser: true })
    const withRule = processCart(cart, [...rules, added])
    expect(withRule[0].reasoning).toBe(
      'Platform offer: 15% off (saves Rs.195, better than the Rs.150 brand offer) + Brand offer: 20% off (stacked, added by you)'
    )
    expect(withRule[3].reasoning).toBe('No offers available for LivSpace Pro on Noon')
  })
})

describe('cart-level offer threshold', () => {
  it('Rs.3,999: no offer row, total unchanged, nudge "Add Rs.1 more"', () => {
    const summary = applyCartDiscount(subtotalOf(3999), rules)
    expect(summary.cartOffer).toBeNull()
    expect(summary.finalTotal).toBe(3999)
    expect(summary.nudge).toBe('Add Rs.1 more to get 10% off your cart')
  })

  it('Rs.4,000: offer applies (the condition is >=)', () => {
    const summary = applyCartDiscount(subtotalOf(4000), rules)
    expect(summary.cartOffer).toMatchObject({ ruleId: 'RULE-04', saved: 400 })
    expect(summary.finalTotal).toBe(3600)
    expect(summary.nudge).toBeNull()
  })

  it('Rs.4,001: offer applies', () => {
    const summary = applyCartDiscount(subtotalOf(4001), rules)
    expect(summary.cartOffer.saved).toBe(400)
    expect(summary.finalTotal).toBe(3601)
  })

  it('the threshold is checked against final item prices, not base prices', () => {
    // Base prices of the first 3 items add up to 2,747; after item offers they are 2,242
    const summary = applyCartDiscount(processCart(cart.slice(0, 3), rules), rules)
    expect(summary.subtotal).toBe(2242)
    expect(summary.nudge).toBe('Add Rs.1,758 more to get 10% off your cart')
  })

  it('no cart rules: no offer and no nudge', () => {
    const itemRules = rules.filter((r) => r.scope !== 'cart')
    const summary = applyCartDiscount(processCart(cart, itemRules), itemRules)
    expect(summary).toMatchObject({ subtotal: 5932, cartOffer: null, finalTotal: 5932, nudge: null })
  })

  it('several cart rules: the biggest saving wins', () => {
    const twoRules = [cartRule({ ruleId: 'SMALL', value: 5, minCartValue: 2000 }), cartRule({ ruleId: 'BIG', value: 10, minCartValue: 4000 })]
    expect(applyCartDiscount(subtotalOf(5932), twoRules).cartOffer.ruleId).toBe('BIG')
    expect(applyCartDiscount(subtotalOf(3000), twoRules).cartOffer).toMatchObject({ ruleId: 'SMALL', saved: 150 })
  })

  it('below every threshold: the nudge points to the nearest one', () => {
    const twoRules = [cartRule({ ruleId: 'BIG', value: 10, minCartValue: 4000 }), cartRule({ ruleId: 'SMALL', value: 5, minCartValue: 2000 })]
    expect(applyCartDiscount(subtotalOf(1500), twoRules).nudge).toBe('Add Rs.500 more to get 5% off your cart')
  })

  it('a flat cart rule bigger than the cart total brings it to 0, not below', () => {
    const summary = applyCartDiscount(subtotalOf(300), [cartRule({ type: 'flat', value: 99999, minCartValue: 100 })])
    expect(summary.cartOffer.saved).toBe(300)
    expect(summary.finalTotal).toBe(0)
  })

  it('an empty cart does not crash', () => {
    expect(applyCartDiscount([], rules)).toMatchObject({ subtotal: 0, cartOffer: null, finalTotal: 0 })
  })
})

describe('item rules: edge cases', () => {
  it('a flat discount bigger than the price gives a final price of 0, not negative', () => {
    const result = applyDiscounts(item(100), [rule({ value: 500 })])
    expect(result.finalPrice).toBe(0)
    expect(result.totalDiscount).toBe(100)
    expect(result.reasoning).toBe("Brand offer: Rs.500 off (capped so the price can't go below Rs.0)")
  })

  it('a stacked flat discount is also capped at 0', () => {
    const result = applyDiscounts(item(100), [
      rule({ ruleId: 'A', type: 'percentage', value: 50 }),
      rule({ ruleId: 'C', value: 80, stackable: true }),
    ])
    expect(result.finalPrice).toBe(0)
  })

  it('no matching rule: base price is kept', () => {
    const result = applyDiscounts(item(999, { brand: 'Zara', platform: 'Myntra' }), rules)
    expect(result).toMatchObject({ finalPrice: 999, totalDiscount: 0, appliedRules: [] })
    expect(result.reasoning).toBe('No offers available for Zara on Myntra')
  })

  it('several stackable rules apply one after another', () => {
    const result = applyDiscounts(item(1000), [
      rule({ ruleId: 'A', type: 'percentage', value: 10, stackable: true }),
      rule({ ruleId: 'C', value: 100, stackable: true }),
    ])
    expect(result.finalPrice).toBe(800) // 1000 - 10% = 900, then - 100
    expect(result.appliedRules).toEqual(['A', 'C'])
  })

  it('scope does not matter, only the rupee saving', () => {
    const result = applyDiscounts(item(500), [
      rule({ ruleId: 'BRAND', value: 100 }),
      rule({ ruleId: 'PLATFORM', scope: 'platform', appliesTo: 'P1', type: 'percentage', value: 10 }),
    ])
    expect(result.appliedRules).toEqual(['BRAND']) // Rs.100 beats 10% of 500 = Rs.50
    expect(result.skippedRules).toEqual(['PLATFORM'])
  })

  it('matching ignores case and extra spaces', () => {
    expect(ruleMatchesItem(item(100, { brand: '  natura casa ' }), rule({ appliesTo: 'Natura Casa' }))).toBe(true)
  })

  it('a cart rule never matches a single item', () => {
    expect(ruleMatchesItem(item(100), cartRule())).toBe(false)
  })

  it('cartTotal adds up final prices', () => {
    expect(cartTotal(processCart(cart, rules))).toBe(5932)
  })
})
