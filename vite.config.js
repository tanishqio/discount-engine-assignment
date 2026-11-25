// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'

// export default defineConfig({
//   plugins: [react()],
// })


import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Lets `npm run dev` answer /api/parse-rule on your machine by running the same
// api/parse-rule.js file that Vercel runs in production. No Vercel CLI needed.
// The key is read from .env here, on the dev server only. It is never sent to the browser.
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      for (const name of ['GEMINI_API_KEY', 'GEMINI_MODEL']) {
        if (env[name] && !process.env[name]) process.env[name] = env[name]
      }

      server.middlewares.use('/api/parse-rule', async (req, res) => {
        // Read the request body (the real limit of 500 characters is checked in the function)
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 100_000) {
            res.statusCode = 413
            return res.end(JSON.stringify({ error: 'Request too large.' }))
          }
        }
        let body = raw
        try {
          body = raw ? JSON.parse(raw) : undefined
        } catch {
          // leave it as text: the function answers "The request body must be JSON."
        }

        // Add the two helpers Vercel gives functions: res.status() and res.json()
        res.status = (code) => {
          res.statusCode = code
          return res
        }
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
          return res
        }

        try {
          const { default: handler } = await server.ssrLoadModule('/api/parse-rule.js')
          await handler(Object.assign(req, { body }), res)
        } catch (err) {
          server.config.logger.error(`api/parse-rule crashed: ${err.message}`)
          if (!res.headersSent) res.status(500).json({ error: 'The local API crashed. See the terminal.' })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
})
