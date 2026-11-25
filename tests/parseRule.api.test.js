/**
 * Serverless function tests (api/parse-rule.js), with a fake Gemini.
 * Checks input limits, the key check, the model fallback, bad AI output and the 10-second limit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../api/parse-rule.js'

const MAIN_MODEL = 'gemini-3.5-flash-lite'
const FALLBACK_MODEL = 'gemini-3.1-flash-lite'

// Minimal stand-ins for Vercel's req / res
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: undefined }
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}
async function call(body, method = 'POST') {
  const res = fakeRes()
  await handler({ method, body }, res)
  return res
}

// A Gemini answer whose output text is `text`
const geminiAnswer = (text) => new Response(JSON.stringify({
  steps: [{ type: 'model_output', content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text) }] }],
}), { status: 200 })
const geminiError = (status, message = 'error') => new Response(JSON.stringify({ error: { code: status, message } }), { status })
const OK = { status: 'ok', rules: [{ scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false, minCartValue: null }], reason: 'Rs.100 off.' }

// fetch answers in order; returns the mock so tests can check which model was asked
function fakeGemini(...answers) {
  const fetchMock = vi.fn(async () => answers.shift() ?? geminiError(500))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const modelsAsked = (fetchMock) => fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).model)

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_FALLBACK_MODEL
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('input checks', () => {
  it('only POST is allowed', async () => {
    const res = await call(undefined, 'GET')
    expect(res.statusCode).toBe(405)
  })
  it.each([['missing', {}], ['empty', { text: '' }], ['spaces', { text: '   ' }], ['not text', { text: 42 }]])(
    '%s text -> 400',
    async (_, body) => {
      const res = await call(body)
      expect(res).toMatchObject({ statusCode: 400, body: { error: 'Please type a discount rule first.' } })
    }
  )
  it('over 500 characters -> 400', async () => {
    const res = await call({ text: 'x'.repeat(501) })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/under 500 characters/)
  })
  it('missing API key -> 500 with a clear message, Gemini not called', async () => {
    delete process.env.GEMINI_API_KEY
    const fetchMock = fakeGemini()
    const res = await call({ text: 'Rs.100 off Flipkart' })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/missing API key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the request to Gemini', () => {
  it('sends the key in a header (never in the URL) and asks for JSON only', async () => {
    const fetchMock = fakeGemini(geminiAnswer(OK))
    await call({ text: 'Rs.100 off Flipkart', knownPlatforms: ['Flipkart'] })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).not.toContain('key=')
    expect(options.headers['x-goog-api-key']).toBe('test-key')
    const sent = JSON.parse(options.body)
    expect(sent.response_format.mime_type).toBe('application/json')
    expect(sent.store).toBe(false)
    expect(JSON.parse(sent.input)).toMatchObject({ text: 'Rs.100 off Flipkart', knownPlatforms: ['Flipkart'] })
  })
})

describe('answers', () => {
  it('passes a good answer through', async () => {
    fakeGemini(geminiAnswer(OK))
    const res = await call({ text: 'Rs.100 off Flipkart' })
    expect(res).toMatchObject({ statusCode: 200, body: OK })
  })
  it('"unresolvable" always comes back with no rules', async () => {
    fakeGemini(geminiAnswer({ status: 'unresolvable', rules: OK.rules, reason: 'Missing amount.' }))
    const res = await call({ text: 'Give a discount for big orders' })
    expect(res.body).toEqual({ status: 'unresolvable', rules: [], reason: 'Missing amount.' })
  })
  it.each([['broken JSON', '{"status": "ok", '], ['plain text', 'Sure! Here is your rule.'], ['wrong shape', { status: 'maybe', rules: [] }]])(
    '%s from the AI -> 502 "invalid response"',
    async (_, text) => {
      fakeGemini(geminiAnswer(text))
      const res = await call({ text: 'Rs.100 off Flipkart' })
      expect(res).toMatchObject({ statusCode: 502, body: { error: 'The AI returned an invalid response.' } })
    }
  )
})

describe('Gemini failures', () => {
  it('main model busy (503) -> tries the second free model', async () => {
    const fetchMock = fakeGemini(geminiError(503), geminiAnswer(OK))
    const res = await call({ text: 'Rs.100 off Flipkart' })
    expect(res.statusCode).toBe(200)
    expect(modelsAsked(fetchMock)).toEqual([MAIN_MODEL, FALLBACK_MODEL])
  })
  it('both models busy -> 503 with a clear message', async () => {
    fakeGemini(geminiError(503), geminiError(503))
    const res = await call({ text: 'Rs.100 off Flipkart' })
    expect(res).toMatchObject({ statusCode: 503, body: { error: 'The AI service is overloaded right now. Please try again in a moment.' } })
  })
  it('a wrong key is not retried and gives a setup message', async () => {
    const fetchMock = fakeGemini(geminiError(400, 'API key not valid. Please pass a valid API key.'))
    const res = await call({ text: 'Rs.100 off Flipkart' })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/API key rejected/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('Gemini never answers -> 504 after 10 seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })))
    const pending = call({ text: 'Rs.100 off Flipkart' })
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await pending
    expect(res).toMatchObject({ statusCode: 504, body: { error: 'The AI took too long to answer. Please try again.' } })
  })
  it('error messages never contain the API key', async () => {
    fakeGemini(geminiError(500), geminiError(500))
    const res = await call({ text: 'Rs.100 off Flipkart' })
    expect(JSON.stringify(res.body)).not.toContain('test-key')
  })
})
