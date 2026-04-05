import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, CheckCircle, Circle, Play, Plus, Star, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { isResumable, type DetailedMediaItem, type MediaItem } from '../lib/media'
import { fetchItemDetails, fetchSeriesDetails, markPlayed } from '../server/functions'
import { useLockBodyScroll } from './useLockBodyScroll'
import { usePrefetchMediaDetails } from './usePrefetchMediaDetails'

interface MediaSpotlightDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  onPlay?: (item: MediaItem) => void
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
  useLockBodyScroll(open)
  const prefetchMediaDetails = usePrefetchMediaDetails()
  const [playedOverrides, setPlayedOverrides] = useState<Record<string, boolean>>({})

  const markPlayedMutation = useMutation({
    mutationFn: (vars: { id: string; played: boolean }) => markPlayed({ data: vars }),
  })

  function handleToggleWatched(episode: MediaItem) {
    const current = playedOverrides[episode.id] ?? episode.played ?? false
    setPlayedOverrides((prev) => ({ ...prev, [episode.id]: !current }))
    markPlayedMutation.mutate({ id: episode.id, played: !current })
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

  const metadata = [
    detail.year,
    formatRuntime(detail.runtimeMinutes),
    detail.ageRating,
  ].filter(Boolean)

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
          <div className="dialog-copy">
            <p className="eyebrow">
              {detail.type === 'series' ? t('dialog.seriesSpotlight') : t('dialog.movieSpotlight')}
            </p>
            <h2 id="aurora-dialog-title" className="dialog-title">
              {detail.title}
            </h2>

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

            {detail.overview ? (
              <p className="dialog-overview">{detail.overview}</p>
            ) : (
              <p className="dialog-overview">
                {t('dialog.noSynopsis')}
              </p>
            )}

            {detail.genres.length ? (
              <div className="chip-row">
                {detail.genres.slice(0, 5).map((genre) => (
                  <span key={genre} className="genre-chip">
                    {genre}
                  </span>
                ))}
              </div>
            ) : null}

            {detail.studios.length || detail.tags.length ? (
              <div className="detail-meta-grid">
                {detail.studios.length ? (
                  <div className="detail-meta-block">
                    <span>{t('dialog.studios')}</span>
                    <strong>{detail.studios.slice(0, 4).join(', ')}</strong>
                  </div>
                ) : null}
                {detail.tags.length ? (
                  <div className="detail-meta-block">
                    <span>{t('dialog.tags')}</span>
                    <strong>{detail.tags.slice(0, 6).join(', ')}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="dialog-sidebar">
            {detail.posterUrl ? (
              <img src={detail.posterUrl} alt={detail.title} className="dialog-poster" />
            ) : (
              <div className="dialog-poster dialog-poster-fallback">
                <span>{detail.title.slice(0, 1)}</span>
              </div>
            )}

            <button
              type="button"
              className="primary-action"
              onClick={() => {
                const target = item.type === 'series' ? (nextUp[0] ?? episodes[0] ?? detail) : detail
                onPlay?.(target)
              }}
              disabled={!onPlay || (item.type === 'series' && loadingState)}
            >
              <Play size={18} fill="currentColor" />{' '}
              {item.type === 'series'
                ? (isResumable(nextUp[0] ?? episodes[0] ?? detail) ? t('hero.resumeNow') : t('hero.playNow'))
                : (resumable ? t('hero.resumeNow') : t('hero.playNow'))}
            </button>

            <button
              type="button"
              className="secondary-action"
              onClick={() => onToggleFavorite?.(detail)}
            >
              {detail.isFavorite ? (
                <>
                  <Check size={18} /> {t('dialog.inMyList')}
                </>
              ) : (
                <>
                  <Plus size={18} /> {t('dialog.addToMyList')}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="dialog-lower">
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
                  <button type="button" className="primary-action" onClick={() => onPlay?.(nextUp[0])}>
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
                          onClick={() => onPlay?.(episode)}
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
