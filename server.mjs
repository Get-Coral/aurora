import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile(filename) {
  const filePath = path.join(__dirname, filename)

  if (!fs.existsSync(filePath)) return

  const contents = fs.readFileSync(filePath, 'utf8')

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')

const { default: serverEntry } = await import('./dist/server/server.js')

const host = process.env.HOST ?? '0.0.0.0'
const port = Number.parseInt(process.env.PORT ?? '3000', 10)

function getOrigin(request) {
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(',')[0] ?? 'http'

  const forwardedHost = request.headers['x-forwarded-host']
  const hostHeader = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost ?? request.headers.host ?? `${host}:${port}`

  return `${protocol}://${hostHeader}`
}

const nodeServer = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', getOrigin(request))
    const headers = new Headers()

    for (const [key, value] of Object.entries(request.headers)) {
      if (value == null) continue
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item)
      } else {
        headers.set(key, value)
      }
    }

    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body:
        request.method && !['GET', 'HEAD'].includes(request.method.toUpperCase())
          ? Readable.toWeb(request)
          : undefined,
      duplex: 'half',
    })

    const webResponse = await serverEntry.fetch(webRequest)

    response.statusCode = webResponse.status
    response.statusMessage = webResponse.statusText

    webResponse.headers.forEach((value, key) => {
      response.setHeader(key, value)
    })

    if (!webResponse.body) {
      response.end()
      return
    }

    Readable.fromWeb(webResponse.body).pipe(response)
  } catch (error) {
    console.error(error)
    response.statusCode = 500
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end('Aurora failed to handle the request.')
  }
})

nodeServer.listen(port, host, () => {
  console.log(`Aurora listening on http://${host}:${port}`)
})
