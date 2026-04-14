import { createFileRoute } from '@tanstack/react-router'

const ALLOWED_PATH_PREFIXES = ['/Videos/', '/Audio/']

function copyHeaderIfPresent(target: Headers, source: Headers, key: string) {
  const value = source.get(key)
  if (value) target.set(key, value)
}

export const Route = createFileRoute('/api/jellyfin-stream')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getEffectiveJellyfinSettings } = await import('../../lib/config-store')
        const settings = getEffectiveJellyfinSettings()

        if (!settings) {
          return new Response('Aurora is not configured.', { status: 503 })
        }

        const requestUrl = new URL(request.url)
        const rawPath = requestUrl.searchParams.get('path')

        if (!rawPath) {
          return new Response('Missing path parameter.', { status: 400 })
        }

        let parsedPath: URL
        try {
          parsedPath = new URL(rawPath, 'http://x')
        } catch {
          return new Response('Invalid path parameter.', { status: 400 })
        }

        const pathname = parsedPath.pathname
        if (!ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
          return new Response('Path not allowed.', { status: 400 })
        }

        // Strip any api_key from the incoming path; inject from server config
        parsedPath.searchParams.delete('api_key')
        parsedPath.searchParams.set('api_key', settings.apiKey)

        const upstream = `${settings.url.replace(/\/+$/, '')}${parsedPath.pathname}${parsedPath.search}`

        const upstreamHeaders: Record<string, string> = {}
        const range = request.headers.get('range')
        if (range) upstreamHeaders['range'] = range

        const upstreamResponse = await fetch(upstream, {
          method: 'GET',
          headers: upstreamHeaders,
        })

        const headers = new Headers()
        for (const key of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'cache-control',
          'last-modified',
          'etag',
        ]) {
          copyHeaderIfPresent(headers, upstreamResponse.headers, key)
        }

        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers,
        })
      },
    },
  },
})
