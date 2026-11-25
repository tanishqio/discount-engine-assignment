/**
 * Natural-language adapter tests, with a fake /api/parse-rule.
 * Checks the brief's examples, ambiguous text, invalid AI output, timeouts and multiple rules.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseRuleText } from '../src/adapters/nlRuleAdapter.js'

const CART = [
  { itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 },
  { itemId: 'ITEM-02', product: 'Bed Sheet Set', brand: 'Natura Casa', platform: 'Flipkart', basePrice: 849 },
  { itemId: 'ITEM-04', product: 'Ceramic Vase', brand: 'LivSpace Pro', platform: 'Noon', basePrice: 2499 },
]
const aiRule = (overrides) => ({
  scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null, ...overrides,
})

// Replace fetch with a fake server answer
function fakeServer(status, body) {
  const fetchMock = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('brief examples', () => {
  it('"20% off for Natura Casa brand, stackable with other offers"', async () => {
    fakeServer(200, { status: 'ok', rules: [aiRule()], reason: '20% off Natura Casa products.' })
    const result = await parseRuleText('20% off for Natura Casa brand, stackable with other offers', CART)
    expect(result.status).toBe('ok')
    expect(result.results[0].ok).toBe(true)
    expect(result.results[0].rule).toMatchObject({ scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true })
  })

  it('"Rs.100 flat discount on all Flipkart items"', async () => {
    fakeServer(200, { status: 'ok', rules: [aiRule({ scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false })], reason: 'r' })
    const { results } = await parseRuleText('Rs.100 flat discount on all Flipkart items', CART)
    expect(results[0].rule).toMatchObject({ scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false })
  })

  it('"10% off if cart value is more than Rs.5,000"', async () => {
    fakeServer(200, { status: 'ok', rules: [aiRule({ scope: 'cart', appliesTo: null, value: 10, stackable: false, minCartValue: 5000 })], reason: 'r' })
    const { results } = await parseRuleText('10% off if cart value is more than Rs.5,000', CART)
    expect(results[0].rule).toMatchObject({ scope: 'cart', appliesTo: '', type: 'percentage', value: 10, minCartValue: 5000 })
  })

  it('"Give a discount for big orders" is unresolvable, with a hint', async () => {
    fakeServer(200, { status: 'unresolvable', rules: [], reason: 'Please say how much discount to give.' })
    const result = await parseRuleText('Give a discount for big orders', CART)
    expect(result).toEqual({
      status: 'unresolvable',
      message: 'Please say how much discount to give.',
      example: "Try: '15% off on Amazon India items'",
    })
  })
})

describe('what is sent to the server', () => {
  it('sends the trimmed text and the brand / platform names from the cart', async () => {
    const fetchMock = fakeServer(200, { status: 'ok', rules: [aiRule()], reason: 'r' })
    await parseRuleText('  20% off Natura Casa  ', CART)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/parse-rule')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      text: '20% off Natura Casa',
      knownBrands: ['Natura Casa', 'LivSpace Pro'],
      knownPlatforms: ['Amazon India', 'Flipkart', 'Noon'],
    })
  })

  it.each([['empty', ''], ['only spaces', '   '], ['not text', null]])('%s text: clear message, no request', async (_, text) => {
    const fetchMock = fakeServer(200, {})
    expect(await parseRuleText(text, CART)).toEqual({ status: 'error', message: 'Please type a discount rule first.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('text over 500 characters: clear message, no request', async () => {
    const fetchMock = fakeServer(200, {})
    const result = await parseRuleText('x'.repeat(501), CART)
    expect(result.message).toBe('Please keep the rule under 500 characters (yours has 501).')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AI output is validated before use', () => {
  it('multiple rules in one sentence: each one is checked', async () => {
    fakeServer(200, {
      status: 'ok',
      reason: 'Two rules.',
      rules: [aiRule({ scope: 'platform', appliesTo: 'Amazon India', value: 15, stackable: false }), aiRule({ type: 'flat', value: 50 })],
    })
    const { results } = await parseRuleText('15% off on Amazon India and Rs.50 off Natura Casa', CART)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(new Set(results.map((r) => r.rule.ruleId)).size).toBe(2)
  })

  it('an invalid AI rule is rejected with the validator errors, the valid one is kept', async () => {
    fakeServer(200, { status: 'ok', reason: 'r', rules: [aiRule({ value: 150 }), aiRule({ scope: 'shop' }), aiRule()] })
    const { results } = await parseRuleText('some text', CART)
    expect(results.map((r) => r.ok)).toEqual([false, false, true])
    expect(results[0].errors).toEqual(["a percentage can't be more than 100, got 150"])
  })

  it('the AI cannot choose the rule id (it could overwrite RULE-01)', async () => {
    fakeServer(200, { status: 'ok', reason: 'r', rules: [aiRule({ ruleId: 'RULE-01' })] })
    const { results } = await parseRuleText('some text', CART)
    expect(results[0].rule.ruleId).toMatch(/^RULE-CUSTOM-\d+$/)
  })

  it('"ok" with no rules is treated as unresolvable', async () => {
    fakeServer(200, { status: 'ok', rules: [], reason: '' })
    expect((await parseRuleText('some text', CART)).status).toBe('unresolvable')
  })
})

describe('failures never crash the page', () => {
  it.each([
    ['not JSON at all', 200, '<html>oops</html>'],
    ['JSON with the wrong shape', 200, { status: 'maybe', rules: [] }],
    ['rules is not a list', 200, { status: 'ok', rules: 'none' }],
  ])('invalid response: %s', async (_, status, body) => {
    fakeServer(status, body)
    expect(await parseRuleText('some text', CART)).toEqual({ status: 'error', message: 'The AI returned an invalid response.' })
  })

  it('shows the server message for busy / slow / not set up', async () => {
    fakeServer(503, { error: 'The AI service is overloaded right now. Please try again in a moment.' })
    expect((await parseRuleText('some text', CART)).message).toBe('The AI service is overloaded right now. Please try again in a moment.')
  })

  it('network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await parseRuleText('some text', CART)).toEqual({ status: 'error', message: "Couldn't reach the rule parser, try again." })
  })

  it('timeout: gives up after 15 seconds', async () => {
    vi.useFakeTimers()
    // A server that never answers, until the request is cancelled
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })))
    const pending = parseRuleText('some text', CART)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toEqual({ status: 'error', message: "Couldn't reach the rule parser, try again." })
  })
})
