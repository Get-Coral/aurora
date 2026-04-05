import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, CheckCircle, Circle, Play, Plus, Star, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { isResumable, type DetailedMediaItem, type MediaItem } from '../lib/media'
import { fetchItemDetails, fetchSeriesDetails, markPlayed } from '../server/functions'
import { useTvMode } from '../lib/tv-mode'
import { useLockBodyScroll } from './useLockBodyScroll'
import { usePrefetchMediaDetails } from './usePrefetchMediaDetails'

interface MediaSpotlightDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  onPlay?: (item: MediaItem, queue?: MediaItem[]) => void
  onSelectSimilar?: (item: MediaItem) => void
  onToggleFavorite?: (item: MediaItem) => void
}

function formatRuntime(minutes?: number) {
  if (!minutes) return null
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`
}

export function MediaSpotlightDialog({
  item,
  open,
  onClose,
  onPlay,
  onSelectSimilar,
  onToggleFavorite,
}: MediaSpotlightDialogProps) {
  const { t } = useI18n()
  const { tvMode } = useTvMode()
  useLockBodyScroll(open)
  const prefetchMediaDetails = usePrefetchMediaDetails()
  const [playedOverrides, setPlayedOverrides] = useState<Record<string, boolean>>({})
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)

  useEffect(() => {
    setSelectedSeason(null)
  }, [item?.id])

  const markPlayedMutation = useMutation({
    mutationFn: (vars: { id: string; played: boolean }) => markPlayed({ data: vars }),
  })

  function handleToggleWatched(episode: MediaItem) {
    const current = playedOverrides[episode.id] ?? episode.played ?? false
    setPlayedOverrides((prev) => ({ ...prev, [episode.id]: !current }))
    markPlayedMutation.mutate({ id: episode.id, played: !current })
  }

  function handleToggleItemWatched() {
    const current = playedOverrides[detail.id] ?? detail.played ?? false
    setPlayedOverrides((prev) => ({ ...prev, [detail.id]: !current }))
    markPlayedMutation.mutate({ id: detail.id, played: !current })
  }

  const { data, isLoading } = useQuery({
    queryKey: ['item-details', item?.id],
    queryFn: () => fetchItemDetails({ data: { id: item!.id } }),
    enabled: open && Boolean(item?.id) && item?.type !== 'series',
  })

  const { data: seriesData, isLoading: seriesLoading } = useQuery({
    queryKey: ['series-details', item?.id],
    queryFn: () => fetchSeriesDetails({ data: { id: item!.id } }),
    enabled: open && Boolean(item?.id) && item?.type === 'series',
  })

  if (!open || !item) return null

  const detail: DetailedMediaItem =
    (item.type === 'series' ? seriesData?.item : data?.item) ??
    { ...item, cast: [], studios: [], tags: [] }
  const similar = item.type === 'series' ? (seriesData?.similar ?? []) : (data?.similar ?? [])
  const episodes = item.type === 'series' ? (seriesData?.episodes ?? []) : []
  const nextUp = item.type === 'series' ? (seriesData?.nextUp ?? []) : []
  const loadingState = item.type === 'series' ? seriesLoading : isLoading
  const resumable = isResumable(detail)

  const seasons = [...new Set(episodes.map((e) => e.seasonNumber ?? 1))].sort((a, b) => a - b)
  const activeSeason = selectedSeason ?? nextUp[0]?.seasonNumber ?? seasons[0] ?? 1
  const seasonEpisodes = episodes.filter((e) => (e.seasonNumber ?? 1) === activeSeason)

  const metadata = [
    detail.year,
    formatRuntime(detail.runtimeMinutes),
    detail.ageRating,
  ].filter(Boolean)

  function playAction() {
    if (item.type === 'series') {
      const target = nextUp[0] ?? episodes[0] ?? detail
      const targetIdx = episodes.findIndex((e) => e.id === target.id)
      onPlay?.(target, targetIdx >= 0 ? episodes.slice(targetIdx) : episodes)
    } else {
      onPlay?.(detail)
    }
  }

  const playLabel = item.type === 'series'
    ? (isResumable(nextUp[0] ?? episodes[0] ?? detail) ? t('hero.resumeNow') : t('hero.playNow'))
    : (resumable ? t('hero.resumeNow') : t('hero.playNow'))

  // ── TV mode: full-screen detail view ──────────────────────────────────────
  if (tvMode) {
    return (
      <div className="tv-detail-shell" role="dialog" aria-modal="true" aria-labelledby="aurora-dialog-title">
        {detail.backdropUrl ? (
          <img src={detail.backdropUrl} alt="" className="tv-detail-backdrop" />
        ) : null}
        <div className="tv-detail-overlay" />

        <button
          type="button"
          className="icon-button tv-detail-close"
          onClick={onClose}
          aria-label={t('dialog.closeDetails')}
        >
          <X size={22} />
        </button>

        <div className="tv-detail-content page-wrap">
          <div className="tv-detail-copy">
            {detail.logoUrl ? (
              <img src={detail.logoUrl} alt={detail.title} className="hero-logo" />
            ) : (
              <h2 id="aurora-dialog-title" className="tv-detail-title">{detail.title}</h2>
            )}

            <div className="dialog-meta">
              {metadata.map((entry) => <span key={entry}>{entry}</span>)}
              {detail.rating != null ? (
                <span className="dialog-rating">
                  <Star size={14} fill="currentColor" /> {detail.rating.toFixed(1)}
                </span>
              ) : null}
            </div>

            {detail.overview ? (
              <p className="tv-detail-overview">{detail.overview}</p>
            ) : null}

            <div className="tv-detail-actions">
              <button
                type="button"
                className="primary-action"
                onClick={playAction}
                disabled={!onPlay || (item.type === 'series' && loadingState)}
              >
                <Play size={20} fill="currentColor" /> {playLabel}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => onToggleFavorite?.(detail)}
              >
                {detail.isFavorite ? (
                  <><Check size={18} /> {t('dialog.inMyList')}</>
                ) : (
                  <><Plus size={18} /> {t('dialog.addToMyList')}</>
                )}
              </button>
              {item.type !== 'series' ? (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={handleToggleItemWatched}
                >
                  {(playedOverrides[detail.id] ?? detail.played) ? (
                    <><CheckCircle size={18} /> {t('dialog.markUnwatched')}</>
                  ) : (
                    <><Circle size={18} /> {t('dialog.markWatched')}</>
                  )}
                </button>
              ) : null}
            </div>

            {detail.genres.length ? (
              <div className="chip-row">
                {detail.genres.slice(0, 5).map((genre) => (
                  <span key={genre} className="genre-chip">{genre}</span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="tv-detail-lower">
            {item.type === 'series' ? (
              <div className="tv-episodes-section">
                <div className="tv-episodes-head">
                  <p className="tv-detail-section-label">{t('dialog.episodes')}</p>
                  {seasons.length > 1 ? (
                    <div className="tv-season-tabs">
                      {seasons.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`tv-season-tab${activeSeason === s ? ' tv-season-tab-active' : ''}`}
                          onClick={() => setSelectedSeason(s)}
                        >
                          {t('generic.season')} {s}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {seriesLoading ? (
                  <p className="tv-detail-section-label" style={{ opacity: 0.5 }}>{t('dialog.loadingCredits')}</p>
                ) : seasonEpisodes.length === 0 ? (
                  <p className="tv-detail-section-label" style={{ opacity: 0.5 }}>{t('dialog.noEpisodes')}</p>
                ) : (
                  <div className="tv-episode-list">
                    {seasonEpisodes.map((episode) => {
                      const isNextUp = nextUp[0]?.id === episode.id
                      const globalIdx = episodes.indexOf(episode)
                      return (
                        <button
                          key={episode.id}
                          type="button"
                          className={`tv-episode-row${isNextUp ? ' tv-episode-next-up' : ''}${episode.played ? ' tv-episode-watched' : ''}`}
                          onClick={() => onPlay?.(episode, globalIdx >= 0 ? episodes.slice(globalIdx) : [episode])}
                        >
                          <div className="tv-episode-thumb-wrap">
                            {episode.backdropUrl ?? episode.posterUrl ? (
                              <img
                                src={episode.backdropUrl ?? episode.posterUrl}
                                alt=""
                                className="tv-episode-thumb"
                              />
                            ) : (
                              <div className="tv-episode-thumb tv-episode-thumb-fallback">
                                <span>{episode.episodeNumber}</span>
                              </div>
                            )}
                            {episode.played ? (
                              <div className="tv-episode-watched-overlay">
                                <CheckCircle size={20} />
                              </div>
                            ) : episode.progress ? (
                              <div className="tv-episode-progress">
                                <div className="tv-episode-progress-fill" style={{ width: `${episode.progress}%` }} />
                              </div>
                            ) : null}
                          </div>
                          <div className="tv-episode-info">
                            <span className="tv-episode-num">
                              {t('generic.episode')} {episode.episodeNumber}
                              {isNextUp ? <span className="tv-episode-next-badge">{t('dialog.nextUpReady')}</span> : null}
                            </span>
                            <strong className="tv-episode-title">{episode.title}</strong>
                            {episode.runtimeMinutes ? (
                              <span className="tv-episode-runtime">{episode.runtimeMinutes}m</span>
                            ) : null}
                          </div>
                          <Play size={18} fill="currentColor" className="tv-episode-play-icon" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {detail.cast.length > 0 ? (
              <div>
                <p className="tv-detail-section-label">{t('dialog.castCrew')}</p>
                <div className="tv-detail-scroll-row">
                  {detail.cast.map((person) => (
                    <div key={person.id} className="tv-cast-card">
                      {person.imageUrl ? (
                        <img src={person.imageUrl} alt={person.name} className="tv-cast-photo" />
                      ) : (
                        <div className="tv-cast-photo-fallback">{person.name.slice(0, 1)}</div>
                      )}
                      <strong>{person.name}</strong>
                      {person.role ? <span>{person.role}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {similar.length > 0 ? (
              <div>
                <p className="tv-detail-section-label">{t('dialog.moreLikeThis')}</p>
                <div className="tv-detail-scroll-row">
                  {similar.slice(0, 12).map((similarItem) => (
                    <button
                      key={similarItem.id}
                      type="button"
                      className="tv-similar-card"
                      onClick={() => onSelectSimilar?.(similarItem)}
                      onMouseEnter={() => void prefetchMediaDetails(similarItem).catch(() => undefined)}
                      onFocus={() => void prefetchMediaDetails(similarItem).catch(() => undefined)}
                    >
                      {similarItem.posterUrl ? (
                        <img src={similarItem.posterUrl} alt={similarItem.title} className="tv-similar-poster" />
                      ) : (
                        <div className="tv-similar-poster-fallback" />
                      )}
                      <strong>{similarItem.title}</strong>
                      <span>{[similarItem.year, similarItem.ageRating].filter(Boolean).join(' • ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  // ── Regular dialog ─────────────────────────────────────────────────────────
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aurora-dialog-title"
      >
        <button
          type="button"
          className="icon-button dialog-close"
          onClick={onClose}
          aria-label={t('dialog.closeDetails')}
        >
          <X size={18} />
        </button>

        <div className="dialog-hero">
          {item.backdropUrl ? (
            <img src={item.backdropUrl} alt="" className="dialog-hero-image" />
          ) : (
            <div className="dialog-hero-fallback" />
          )}
          <div className="dialog-hero-overlay" />
        </div>

        <div className="dialog-body">
          {detail.posterUrl ? (
            <img src={detail.posterUrl} alt={detail.title} className="dialog-poster-thumb" />
          ) : null}

          <p className="eyebrow">
            {detail.type === 'series' ? t('dialog.seriesSpotlight') : t('dialog.movieSpotlight')}
          </p>
          <h2 id="aurora-dialog-title" className="dialog-title">{detail.title}</h2>

          <div className="dialog-meta">
            {metadata.map((entry) => (
              <span key={entry}>{entry}</span>
            ))}
            {detail.rating != null ? (
              <span className="dialog-rating">
                <Star size={14} fill="currentColor" /> {detail.rating.toFixed(1)}
              </span>
            ) : null}
          </div>

          <div className="dialog-actions">
            <button
              type="button"
              className="primary-action"
              onClick={playAction}
              disabled={!onPlay || (item.type === 'series' && loadingState)}
            >
              <Play size={18} fill="currentColor" /> {playLabel}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => onToggleFavorite?.(detail)}
            >
              {detail.isFavorite ? (
                <><Check size={18} /> {t('dialog.inMyList')}</>
              ) : (
                <><Plus size={18} /> {t('dialog.addToMyList')}</>
              )}
            </button>
            {item.type !== 'series' ? (
              <button
                type="button"
                className="secondary-action"
                onClick={handleToggleItemWatched}
              >
                {(playedOverrides[detail.id] ?? detail.played) ? (
                  <><CheckCircle size={18} /> {t('dialog.markUnwatched')}</>
                ) : (
                  <><Circle size={18} /> {t('dialog.markWatched')}</>
                )}
              </button>
            ) : null}
          </div>

          <p className="dialog-overview">
            {detail.overview || t('dialog.noSynopsis')}
          </p>

          {detail.genres.length ? (
            <div className="chip-row">
              {detail.genres.slice(0, 5).map((genre) => (
                <span key={genre} className="genre-chip">{genre}</span>
              ))}
            </div>
          ) : null}

          {detail.studios.length || detail.tags.length ? (
            <div className="detail-meta-inline">
              {detail.studios.length ? (
                <span className="detail-meta-item">
                  <span className="detail-meta-label">{t('dialog.studios')}</span>
                  {detail.studios.slice(0, 3).join(', ')}
                </span>
              ) : null}
              {detail.tags.length ? (
                <span className="detail-meta-item">
                  <span className="detail-meta-label">{t('dialog.tags')}</span>
                  {detail.tags.slice(0, 5).join(', ')}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="dialog-lower">
          {detail.type === 'series' ? (
            <section className="detail-section">
              <div className="detail-section-head">
                <p className="eyebrow">{t('dialog.episodes')}</p>
                {nextUp.length ? (
                  <span className="detail-loading">{t('dialog.nextUpReady')}</span>
                ) : null}
              </div>
              {nextUp.length ? (
                <div className="episode-highlight">
                  <div>
                    <span className="eyebrow">{t('dialog.continueWith')}</span>
                    <h3>{nextUp[0].title}</h3>
                    <p>
                      {[
                        nextUp[0].seriesTitle,
                        nextUp[0].seasonNumber ? `S${nextUp[0].seasonNumber}` : null,
                        nextUp[0].episodeNumber ? `E${nextUp[0].episodeNumber}` : null,
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </p>
                  </div>
                  <button type="button" className="primary-action" onClick={() => {
                    const idx = episodes.findIndex((e) => e.id === nextUp[0].id)
                    onPlay?.(nextUp[0], idx >= 0 ? episodes.slice(idx) : episodes)
                  }}>
                    <Play size={18} fill="currentColor" /> {isResumable(nextUp[0]) ? t('dialog.resumeNextUp') : t('dialog.playNextUp')}
                  </button>
                </div>
              ) : null}

              {episodes.length ? (
                <div className="episode-list">
                  {episodes.slice(0, 20).map((episode) => {
                    const isPlayed = playedOverrides[episode.id] ?? episode.played ?? false
                    return (
                      <div key={episode.id} className={`episode-row${isPlayed ? ' episode-row-watched' : ''}`}>
                        <button
                          type="button"
                          className="episode-row-body"
                          onClick={() => {
                            const idx = episodes.indexOf(episode)
                            onPlay?.(episode, episodes.slice(idx))
                          }}
                        >
                          <div>
                            <strong>{episode.title}</strong>
                            <span>
                              {[
                                episode.seasonNumber ? `${t('generic.season')} ${episode.seasonNumber}` : null,
                                episode.episodeNumber ? `${t('generic.episode')} ${episode.episodeNumber}` : null,
                                episode.runtimeMinutes ? `${episode.runtimeMinutes}m` : null,
                              ]
                                .filter(Boolean)
                                .join(' • ')}
                            </span>
                          </div>
                          <span className="episode-progress">
                            {isPlayed
                              ? t('dialog.playEpisode')
                              : episode.progress
                                ? t('hero.progressWatched', { progress: Math.round(episode.progress) })
                                : isResumable(episode)
                                  ? t('card.resume')
                                  : t('dialog.playEpisode')}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="icon-button episode-watched-toggle"
                          onClick={() => handleToggleWatched(episode)}
                          aria-label={isPlayed ? t('dialog.markUnwatched') : t('dialog.markWatched')}
                        >
                          {isPlayed ? <CheckCircle size={16} /> : <Circle size={16} />}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="detail-empty">{t('dialog.noEpisodes')}</p>
              )}
            </section>
          ) : null}

          <section className="detail-section">
            <div className="detail-section-head">
              <p className="eyebrow">{t('dialog.castCrew')}</p>
              {loadingState ? <span className="detail-loading">{t('dialog.loadingCredits')}</span> : null}
            </div>
            {detail.cast.length ? (
              <div className="cast-grid">
                {detail.cast.map((person) => (
                  <article key={person.id} className="cast-card">
                    {person.imageUrl ? (
                      <img src={person.imageUrl} alt={person.name} className="cast-photo" />
                    ) : (
                      <div className="cast-photo cast-photo-fallback">
                        <span>{person.name.slice(0, 1)}</span>
                      </div>
                    )}
                    <strong>{person.name}</strong>
                    <span>{person.role ?? person.type ?? t('dialog.castFallback')}</span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="detail-empty">{t('dialog.noCast')}</p>
            )}
          </section>

          <section className="detail-section">
            <div className="detail-section-head">
              <p className="eyebrow">{t('dialog.moreLikeThis')}</p>
            </div>
            {similar.length ? (
              <div className="similar-grid">
                {similar.slice(0, 6).map((similarItem) => (
                  <button
                    key={similarItem.id}
                    type="button"
                    className="similar-card"
                    onClick={() => onSelectSimilar?.(similarItem)}
                    onMouseEnter={() => void prefetchMediaDetails(similarItem).catch(() => undefined)}
                    onFocus={() => void prefetchMediaDetails(similarItem).catch(() => undefined)}
                  >
                    {similarItem.posterUrl ? (
                      <img
                        src={similarItem.posterUrl}
                        alt={similarItem.title}
                        className="similar-poster"
                      />
                    ) : (
                      <div className="similar-poster similar-poster-fallback" />
                    )}
                    <strong>{similarItem.title}</strong>
                    <span>{[similarItem.year, similarItem.ageRating].filter(Boolean).join(' • ')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="detail-empty">{t('dialog.noSimilar')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
