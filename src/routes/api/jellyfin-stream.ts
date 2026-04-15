import { createFileRoute } from '@tanstack/react-router'

const ALLOWED_PATH_PREFIXES = ['/videos/', '/audio/']

function isAllowedMediaPath(pathname: string) {
  return ALLOWED_PATH_PREFIXES.some((prefix) => pathname.toLowerCase().startsWith(prefix))
}

function buildProxyPath(path: string) {
  return `/api/jellyfin-stream?path=${encodeURIComponent(path)}`
}

function rewriteHlsUri(uri: string, playlistUrl: URL) {
  const trimmedUri = uri.trim()
  if (!trimmedUri || trimmedUri.startsWith('data:')) return uri

  let resolvedUri: URL
  try {
    resolvedUri = new URL(trimmedUri, playlistUrl)
  } catch {
    return uri
  }

  if (resolvedUri.origin !== playlistUrl.origin) return uri
  if (!isAllowedMediaPath(resolvedUri.pathname)) return uri

  return buildProxyPath(resolvedUri.pathname + resolvedUri.search)
}

function rewriteHlsManifest(manifest: string, playlistUrl: URL) {
  return manifest
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine) return line

      if (!trimmedLine.startsWith('#')) {
        return rewriteHlsUri(line, playlistUrl)
      }

      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
        return `URI="${rewriteHlsUri(uri, playlistUrl)}"`
      })
    })
    .join('\n')
}

function copyHeaderIfPresent(target: Headers, source: Headers, key: string) {
  const value = source.get(key)
  if (value) target.set(key, value)
}

function logProxyEvent(event: string, details: Record<string, unknown>) {
  console.info('[AuroraStreamProxy]', event, details)
}

async function proxyJellyfinStreamRequest(request: Request) {
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
  if (!isAllowedMediaPath(pathname)) {
    logProxyEvent('rejected-path', {
      method: request.method,
      pathname,
      search: parsedPath.search,
    })
    return new Response('Path not allowed.', { status: 400 })
  }

  // Strip any existing Jellyfin API key parameter casing; inject from server config.
  parsedPath.searchParams.delete('ApiKey')
  parsedPath.searchParams.delete('api_key')
  parsedPath.searchParams.set('api_key', settings.apiKey)

  const upstream = `${settings.url.replace(/\/+$/, '')}${parsedPath.pathname}${parsedPath.search}`

  const upstreamHeaders: Record<string, string> = {}
  const range = request.headers.get('range')
  const accept = request.headers.get('accept')
  if (range) upstreamHeaders.range = range
  if (accept) upstreamHeaders.accept = accept

  logProxyEvent('request', {
    method: request.method,
    pathname: parsedPath.pathname,
    search: parsedPath.search,
    range,
    accept,
  })

  const upstreamResponse = await fetch(upstream, {
    method: request.method,
    headers: upstreamHeaders,
  })

  logProxyEvent('response', {
    method: request.method,
    pathname: parsedPath.pathname,
    status: upstreamResponse.status,
    contentType: upstreamResponse.headers.get('content-type'),
    contentLength: upstreamResponse.headers.get('content-length'),
    contentRange: upstreamResponse.headers.get('content-range'),
    acceptRanges: upstreamResponse.headers.get('accept-ranges'),
  })

  const headers = new Headers()
  for (const key of [
    'content-type',
    'content-range',
    'accept-ranges',
    'cache-control',
    'last-modified',
    'etag',
    'content-disposition',
  ]) {
    copyHeaderIfPresent(headers, upstreamResponse.headers, key)
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? ''
  const isHlsManifest = /application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl/i.test(contentType)

  if (request.method !== 'HEAD' && isHlsManifest) {
    const rewrittenManifest = rewriteHlsManifest(await upstreamResponse.text(), parsedPath)
    headers.set('content-length', String(Buffer.byteLength(rewrittenManifest)))
    logProxyEvent('rewrite-manifest', {
      pathname: parsedPath.pathname,
      contentType,
    })

    return new Response(rewrittenManifest, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    })
  }

  copyHeaderIfPresent(headers, upstreamResponse.headers, 'content-length')

  return new Response(request.method === 'HEAD' ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  })
}

export const Route = createFileRoute('/api/jellyfin-stream')({
  server: {
    handlers: {
      GET: async ({ request }) => proxyJellyfinStreamRequest(request),
      HEAD: async ({ request }) => proxyJellyfinStreamRequest(request),
    },
  },
})
