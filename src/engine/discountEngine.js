/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:    string       — e.g. "RULE-01"
 *   scope:     "brand" | "platform" | "cart"
 *   appliesTo: string       — e.g. "Natura Casa", "Amazon India"
 *   type:      "percentage" | "flat"
 *   value:     number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable: boolean
 *   minCartValue: number | null
 *   addedByUser?: boolean   set by the UI for rules typed in plain English (only changes the text)

 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 */

/**
 * Returns true if the rule applies to this cart item.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => s.trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 */
export function calculateDiscountAmount(price, rule) {
  if (rule.type === 'percentage') {
    return Math.round(price * rule.value / 100)
  }
  if (rule.type === 'flat') {
    return rule.value
  }
  return 0
}

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

// "Platform offer: 15% off" / "Brand offer: Rs.150 off"
function offerLabel(rule) {
  const scopeLabel = rule.scope === 'brand' ? 'Brand' : 'Platform'
  const amount = rule.type === 'percentage' ? `${rule.value}% off` : `${rs(rule.value)} off`
  return `${scopeLabel} offer: ${amount}`
}

/**
 * Builds the customer-facing text for one applied rule, only from what really happened:
 * the rupees it saved, the offer it beat, whether it stacked on top, and whether it was capped.
 */
function describeAppliedRule({ rule, saving }, { isFirst, beaten }) {
  const notes = []
  if (beaten) {
    notes.push(`saves ${rs(saving)}`)
    notes.push(
      saving > beaten.saving
        ? `better than the ${rs(beaten.saving)} ${beaten.rule.scope} offer`
        : `same saving as the ${beaten.rule.scope} offer`
    )
  }
  if (!isFirst) notes.push('stacked')
  if (rule.type === 'flat' && saving < rule.value) notes.push("capped so the price can't go below Rs.0")
  if (rule.addedByUser) notes.push('added by you')
  return notes.length > 0 ? `${offerLabel(rule)} (${notes.join(', ')})` : offerLabel(rule)
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all rules that match this item.
 *   2. Among non-stackable rules, pick the one giving the largest discount.
 *   3. Apply any stackable rules on top of that price.
 *   4. Build the reasoning string from what was applied.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  // No rules match — return base price with explanation
  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: `No offers available for ${item.brand} on ${item.platform}`,
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the non-stackable rule that gives the largest saving
  let winner = null
  let skipped = []

  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) =>
        calculateDiscountAmount(item.basePrice, b) -
        calculateDiscountAmount(item.basePrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  // Apply winner first, then stack on top. Record what each rule really saved.
  let price = item.basePrice
  const applied = [] // { rule, saving }

  if (winner) {
    const before = price
    price = Math.max(0, price - calculateDiscountAmount(price, winner))
    applied.push({ rule: winner, saving: before - price })
  }

  for (const rule of stackable) {
    const before = price
    price = Math.max(0, price - calculateDiscountAmount(price, rule))
    applied.push({ rule, saving: before - price })
  }

  const finalPrice = Math.round(price)

  // The best offer that lost to the winner, so the text can say why the winner was picked
  const runnerUp = skipped[0]
  const beaten = runnerUp
    ? { rule: runnerUp, saving: Math.min(item.basePrice, calculateDiscountAmount(item.basePrice, runnerUp)) }
    : null

  const reasoning = applied
    .map((part, i) => describeAppliedRule(part, { isFirst: i === 0, beaten: i === 0 && part.rule === winner ? beaten : null }))
    .join(' + ')


  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules: applied.map((part) => part.rule.ruleId),
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning,
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

export function applyCartDiscount(results, rules) {
  const total_cart_value = cartTotal(results);

  const cart_rules = rules.filter((r) => r.scope === "cart");
  if (cart_rules.length == 0) {
    return {
      subtotal: total_cart_value,
      cartOffer: null,
      finalTotal: total_cart_value,
      nudge: null
    }
  }

  let winning_offer = null;
  let NearestRule = null;
  for (const r of cart_rules) {

    if (total_cart_value >= r.minCartValue) {
      let saved = Math.min(total_cart_value, calculateDiscountAmount(total_cart_value, r));
      if (winning_offer === null || winning_offer.saved < saved) {
        winning_offer = { rule: r, saved: saved }
      }
    }

    if (!NearestRule) {
      NearestRule = r;
    }
    else if (Math.abs(NearestRule.minCartValue - total_cart_value) > Math.abs(r.minCartValue - total_cart_value)) {
      NearestRule = r;
    }
  }
  let final_total = total_cart_value;
  let final_nudge = null;
  let final_cart_offer = null;
  if (winning_offer) {
    final_total = total_cart_value - winning_offer.saved;
    final_cart_offer = { ruleId: winning_offer.rule.ruleId, saved: winning_offer.saved, label: "" };
    const offerText = winning_offer.rule.type === "percentage" ? `${winning_offer.rule.value}%` : `Rs.${winning_offer.rule.value.toLocaleString('en-IN')}`
    final_cart_offer.label = `Rs.${total_cart_value.toLocaleString('en-IN')} ≥ Rs.${winning_offer.rule.minCartValue.toLocaleString('en-IN')} → ${offerText} off entire cart → -Rs.${winning_offer.saved.toLocaleString('en-IN')}`
  } else {
    const offerText = NearestRule.type === "percentage" ? `${NearestRule.value}%` : `Rs.${NearestRule.value.toLocaleString('en-IN')}`
    final_nudge = `Add Rs.${(NearestRule.minCartValue - total_cart_value).toLocaleString('en-IN')} more to get ${offerText} off your cart`
  }

  return {
    subtotal: total_cart_value,
    cartOffer: final_cart_offer,
    nudge: final_nudge,
    finalTotal: final_total
  }
}
