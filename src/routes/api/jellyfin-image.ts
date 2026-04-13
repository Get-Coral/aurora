import { createFileRoute } from '@tanstack/react-router'

const ALLOWED_IMAGE_TYPES = new Set([
  'Primary',
  'Art',
  'Backdrop',
  'Banner',
  'Logo',
  'Thumb',
  'Disc',
  'Box',
  'Screenshot',
  'Menu',
  'Chapter',
  'BoxRear',
  'Profile',
])

function parsePositiveInt(value: string | null, min: number, max: number) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(max, parsed))
}

function copyHeaderIfPresent(target: Headers, source: Headers, key: string) {
  const value = source.get(key)
  if (value) {
    target.set(key, value)
  }
}

export const Route = createFileRoute('/api/jellyfin-image' as any)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getEffectiveJellyfinSettings } = await import('../../lib/config-store')
        const settings = getEffectiveJellyfinSettings()

        if (!settings) {
          return new Response('Aurora is not configured.', { status: 503 })
        }

        const requestUrl = new URL(request.url)
        const itemId = requestUrl.searchParams.get('itemId')?.trim()
        const type = requestUrl.searchParams.get('type')?.trim() ?? 'Primary'

        if (!itemId || itemId.length > 128) {
          return new Response('Missing or invalid itemId.', { status: 400 })
        }

        if (!ALLOWED_IMAGE_TYPES.has(type)) {
          return new Response('Unsupported image type.', { status: 400 })
        }

        const width = parsePositiveInt(requestUrl.searchParams.get('width'), 1, 4096)
        const fillWidth = parsePositiveInt(requestUrl.searchParams.get('fillWidth'), 1, 4096)
        const quality = parsePositiveInt(requestUrl.searchParams.get('quality'), 1, 100)

        const upstream = new URL(`${settings.url.replace(/\/+$/, '')}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(type)}`)
        upstream.searchParams.set('api_key', settings.apiKey)

        if (width != null) {
          upstream.searchParams.set('maxWidth', String(width))
        }

        if (fillWidth != null) {
          upstream.searchParams.set('fillWidth', String(fillWidth))
        }

        if (quality != null) {
          upstream.searchParams.set('quality', String(quality))
        }

        const accept = request.headers.get('accept')
        const upstreamResponse = await fetch(upstream, {
          method: 'GET',
          headers: accept ? { accept } : undefined,
        })

        const headers = new Headers()
        copyHeaderIfPresent(headers, upstreamResponse.headers, 'content-type')
        copyHeaderIfPresent(headers, upstreamResponse.headers, 'content-length')
        copyHeaderIfPresent(headers, upstreamResponse.headers, 'cache-control')
        copyHeaderIfPresent(headers, upstreamResponse.headers, 'etag')
        copyHeaderIfPresent(headers, upstreamResponse.headers, 'last-modified')
        copyHeaderIfPresent(headers, upstreamResponse.headers, 'expires')

        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers,
        })
      },
    },
  },
})
