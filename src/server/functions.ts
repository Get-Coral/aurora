import { createServerFn } from '@tanstack/react-start'

export const fetchSetupStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const { getConfigurationSummary } = await import('../lib/config-store')
  return getConfigurationSummary()
})

export const saveSetupConfiguration = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    url: string
    apiKey: string
    userId: string
    username: string
    password: string
  }) => input)
  .handler(async ({ data }) => {
    const { validateJellyfinSettings, saveJellyfinSettings, isAuroraConfigured } = await import('../lib/config-store')
    const validated = await validateJellyfinSettings({
      url: data.url,
      apiKey: data.apiKey,
      userId: data.userId,
      username: data.username,
      password: data.password,
    })

    saveJellyfinSettings(validated)

    return {
      configured: isAuroraConfigured(),
    }
  })

export const fetchContinueWatching = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getContinueWatching }, { fromJellyfin }] = await Promise.all([
    import('../lib/jellyfin'),
    import('../lib/media-server'),
  ])
  const items = await getContinueWatching()
  return items.map(fromJellyfin)
})

export const fetchFeatured = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getFeaturedItem }, { fromJellyfin }] = await Promise.all([
    import('../lib/jellyfin'),
    import('../lib/media-server'),
  ])
  const item = await getFeaturedItem()
  return item ? fromJellyfin(item) : null
})

export const fetchLatestMovies = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getLatestMedia }, { fromJellyfin }] = await Promise.all([
    import('../lib/jellyfin'),
    import('../lib/media-server'),
  ])
  const items = await getLatestMedia('Movie')
  return items.map(fromJellyfin)
})

export const fetchLatestSeries = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getLatestMedia }, { fromJellyfin }] = await Promise.all([
    import('../lib/jellyfin'),
    import('../lib/media-server'),
  ])
  const items = await getLatestMedia('Series')
  return items.map(fromJellyfin)
})

export const fetchFavoriteMovies = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getFavoriteItems }, { fromJellyfin }] = await Promise.all([
    import('../lib/jellyfin'),
    import('../lib/media-server'),
  ])
  const items = await getFavoriteItems('Movie')
  return items.map(fromJellyfin)
})

export const fetchMyList = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getFavoriteItems }, { fromJellyfin }] = await Promise.all([
    import('../lib/jellyfin'),
    import('../lib/media-server'),
  ])
  const [movies, series] = await Promise.all([
    getFavoriteItems('Movie'),
    getFavoriteItems('Series'),
  ])

  return [...movies, ...series].map(fromJellyfin)
})

export const fetchRecommendedFromItem = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const [{ getSimilarItems }, { fromJellyfin }] = await Promise.all([
      import('../lib/jellyfin'),
      import('../lib/media-server'),
    ])
    const items = await getSimilarItems(data.id)
    return items.map(fromJellyfin)
  })

export const fetchLibrary = createServerFn({ method: 'GET' })
  .inputValidator((input: {
    type: 'Movie' | 'Series'
    page?: number
    sortBy?: 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
    sortOrder?: 'Ascending' | 'Descending'
    genre?: string
    favoritesOnly?: boolean
  }) => input)
  .handler(async ({ data }) => {
    const [{ getLibraryItems }, { fromJellyfin }] = await Promise.all([
      import('../lib/jellyfin'),
      import('../lib/media-server'),
    ])
    const page = data.page ?? 0
    const result = await getLibraryItems(data.type, {
      sortBy: data.sortBy ?? 'DateCreated',
      sortOrder: data.sortOrder ?? 'Descending',
      limit: 24,
      startIndex: page * 24,
      genre: data.genre,
      filters: data.favoritesOnly ? 'IsFavorite' : undefined,
    })
    return {
      items: result.Items.map(fromJellyfin),
      total: result.TotalRecordCount,
      page,
    }
  })

export const fetchItem = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const [{ getItem }, { fromJellyfin }] = await Promise.all([
      import('../lib/jellyfin'),
      import('../lib/media-server'),
    ])
    const item = await getItem(data.id)
    return fromJellyfin(item)
  })

export const fetchItemDetails = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const [{ getItem, getSimilarItems }, { fromJellyfin, fromJellyfinDetailed }] = await Promise.all([
      import('../lib/jellyfin'),
      import('../lib/media-server'),
    ])
    const [item, similar] = await Promise.all([
      getItem(data.id),
      getSimilarItems(data.id),
    ])

    return {
      item: fromJellyfinDetailed(item),
      similar: similar.map(fromJellyfin),
    }
  })

export const fetchSeriesDetails = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const [
      { getItem, getEpisodesForSeries, getNextUpForSeries, getSimilarItems },
      { fromJellyfin, fromJellyfinDetailed },
    ] = await Promise.all([
      import('../lib/jellyfin'),
      import('../lib/media-server'),
    ])
    const [item, episodes, nextUp, similar] = await Promise.all([
      getItem(data.id),
      getEpisodesForSeries(data.id),
      getNextUpForSeries(data.id),
      getSimilarItems(data.id),
    ])

    return {
      item: fromJellyfinDetailed(item),
      episodes: episodes.map(fromJellyfin),
      nextUp: nextUp.map(fromJellyfin),
      similar: similar.map(fromJellyfin),
    }
  })

export const fetchSearch = createServerFn({ method: 'GET' })
  .inputValidator((input: { query: string }) => input)
  .handler(async ({ data }) => {
    if (!data.query.trim()) return []
    const [{ searchItems }, { fromJellyfin }] = await Promise.all([
      import('../lib/jellyfin'),
      import('../lib/media-server'),
    ])
    const items = await searchItems(data.query)
    return items.map(fromJellyfin)
  })

export const fetchUsername = createServerFn({ method: 'GET' }).handler(async () => {
  const { getEffectiveJellyfinSettings } = await import('../lib/config-store')
  return getEffectiveJellyfinSettings()?.username ?? ''
})

export const saveSettings = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    url: string
    apiKey: string
    userId: string
    username: string
    password: string
  }) => input)
  .handler(async ({ data }) => {
    const { validateJellyfinSettings, saveJellyfinSettings, getEffectiveJellyfinSettings, isAuroraConfigured } = await import('../lib/config-store')
    const existing = getEffectiveJellyfinSettings()
    const settings = {
      url: data.url,
      apiKey: data.apiKey || existing?.apiKey || '',
      userId: data.userId,
      username: data.username,
      password: data.password || existing?.password || '',
    }
    const validated = await validateJellyfinSettings(settings)
    saveJellyfinSettings(validated)
    return { configured: isAuroraConfigured() }
  })

export const fetchOpenSubtitlesKey = createServerFn({ method: 'GET' }).handler(async () => {
  const { getOpenSubtitlesApiKey } = await import('../lib/config-store')
  return getOpenSubtitlesApiKey()
})

export const saveOpenSubtitlesKey = createServerFn({ method: 'POST' })
  .inputValidator((input: { apiKey: string }) => input)
  .handler(async ({ data }) => {
    const { saveOpenSubtitlesApiKey } = await import('../lib/config-store')
    saveOpenSubtitlesApiKey(data.apiKey)
    return { ok: true }
  })

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', nl: 'Nederlands', de: 'Deutsch', fr: 'Français', es: 'Español',
  it: 'Italiano', pt: 'Português', 'pt-pt': 'Português (PT)', 'pt-br': 'Português (BR)',
  ru: 'Русский', pl: 'Polski', cs: 'Čeština', sk: 'Slovenčina', hu: 'Magyar',
  ro: 'Română', bg: 'Български', hr: 'Hrvatski', sr: 'Srpski', sl: 'Slovenščina',
  sv: 'Svenska', no: 'Norsk', da: 'Dansk', fi: 'Suomi', el: 'Ελληνικά',
  tr: 'Türkçe', ar: 'العربية', he: 'עברית', zh: '中文', 'zh-cn': '中文(简)', 'zh-tw': '中文(繁)',
  ja: '日本語', ko: '한국어', th: 'ภาษาไทย', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
  vi: 'Tiếng Việt', uk: 'Українська', et: 'Eesti', lv: 'Latviešu', lt: 'Lietuvių',
}

interface OpenSubtitleResult {
  id: string
  language: string
  label: string
  fileId: number
}

export const searchOnlineSubtitles = createServerFn({ method: 'GET' })
  .inputValidator((input: {
    title: string
    year?: number
    season?: number
    episode?: number
  }) => input)
  .handler(async ({ data }): Promise<OpenSubtitleResult[]> => {
    const { getOpenSubtitlesApiKey } = await import('../lib/config-store')
    const apiKey = getOpenSubtitlesApiKey()
    if (!apiKey) return []

    const params = new URLSearchParams({
      query: data.title,
      order_by: 'download_count',
      order_direction: 'desc',
    })
    if (data.year) params.set('year', String(data.year))
    if (data.season) params.set('season_number', String(data.season))
    if (data.episode) params.set('episode_number', String(data.episode))

    const res = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`, {
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'Aurora v1.0.0' },
    }).catch(() => null)

    if (!res?.ok) return []

    const json = await res.json() as {
      data: Array<{
        id: string
        attributes: {
          language: string
          release: string
          download_count: number
          files: Array<{ file_id: number }>
        }
      }>
    }

    // Take the most-downloaded subtitle per language (already sorted by download_count desc)
    const seenLanguages = new Set<string>()
    return json.data
      .filter((s) => s.attributes.files[0]?.file_id)
      .filter((s) => {
        if (seenLanguages.has(s.attributes.language)) return false
        seenLanguages.add(s.attributes.language)
        return true
      })
      .slice(0, 12)
      .map((s) => ({
        id: s.id,
        language: s.attributes.language,
        label: LANGUAGE_NAMES[s.attributes.language] ?? s.attributes.language.toUpperCase(),
        fileId: s.attributes.files[0].file_id,
      }))
  })

function srtToVtt(srt: string): string {
  return `WEBVTT\n\n${srt.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

export const fetchOnlineSubtitle = createServerFn({ method: 'POST' })
  .inputValidator((input: { fileId: number }) => input)
  .handler(async ({ data }) => {
    const { getOpenSubtitlesApiKey } = await import('../lib/config-store')
    const apiKey = getOpenSubtitlesApiKey()
    if (!apiKey) throw new Error('No OpenSubtitles API key configured')

    const linkRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'Aurora v1.0.0' },
      body: JSON.stringify({ file_id: data.fileId }),
    })

    if (!linkRes.ok) throw new Error('Failed to get subtitle download link')
    const { link } = await linkRes.json() as { link: string }

    const subtitleRes = await fetch(link)
    if (!subtitleRes.ok) throw new Error('Failed to download subtitle')
    const raw = await subtitleRes.text()

    const content = raw.trimStart().startsWith('WEBVTT') ? raw : srtToVtt(raw)
    return { content }
  })

export const markPlayed = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; played: boolean }) => input)
  .handler(async ({ data }) => {
    const { setPlayed } = await import('../lib/jellyfin')
    const result = await setPlayed(data.id, data.played)
    return { id: data.id, played: result.Played }
  })

export const toggleFavorite = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; isFavorite: boolean }) => input)
  .handler(async ({ data }) => {
    const { setFavorite } = await import('../lib/jellyfin')
    const result = await setFavorite(data.id, data.isFavorite)
    return { id: data.id, isFavorite: result.IsFavorite }
  })

export const beginPlaybackSession = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { createPlaybackSession } = await import('../lib/jellyfin')
    return createPlaybackSession(data.id)
  })

export const reportPlaybackState = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    id: string
    positionTicks: number
    playSessionId?: string
    mediaSourceId?: string
    sessionId?: string
    isPaused?: boolean
    isStopped?: boolean
    played?: boolean
  }) => input)
  .handler(async ({ data }) => {
    const { syncPlaybackState } = await import('../lib/jellyfin')
    return syncPlaybackState({
      itemId: data.id,
      positionTicks: data.positionTicks,
      playSessionId: data.playSessionId,
      mediaSourceId: data.mediaSourceId,
      sessionId: data.sessionId,
      isPaused: data.isPaused,
      isStopped: data.isStopped,
      played: data.played,
    })
  })
