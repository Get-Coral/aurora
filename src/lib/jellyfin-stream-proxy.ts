/**
 * Converts a full Jellyfin stream URL into a local proxy URL that the browser
 * can reach even when the Jellyfin server is on a private network (e.g. NAS
 * accessed over VPN). The api_key is stripped from the proxy URL and re-added
 * server-side by the /api/jellyfin-stream handler.
 */
export function jellyfinStreamProxyUrl(jellyfinUrl: string): string {
  let url: URL
  try {
    url = new URL(jellyfinUrl)
  } catch {
    return jellyfinUrl
  }
  url.searchParams.delete('api_key')
  return `/api/jellyfin-stream?path=${encodeURIComponent(url.pathname + url.search)}`
}

/**
 * Sets StartTimeTicks on a stream URL, whether it is a direct Jellyfin URL or
 * a /api/jellyfin-stream proxy URL. The proxy URL encodes the real Jellyfin
 * path inside its `path` query param, so we must modify it there.
 */
export function setStreamStartTicks(streamUrl: string, ticks: number): string {
  if (streamUrl.startsWith('/api/jellyfin-stream')) {
    const outer = new URL(streamUrl, 'http://x')
    const rawPath = outer.searchParams.get('path')
    if (!rawPath) return streamUrl
    const inner = new URL(rawPath, 'http://x')
    inner.searchParams.set('StartTimeTicks', String(ticks))
    outer.searchParams.set('path', inner.pathname + inner.search)
    return outer.pathname + outer.search
  }
  const url = new URL(streamUrl)
  url.searchParams.set('StartTimeTicks', String(ticks))
  return url.toString()
}
