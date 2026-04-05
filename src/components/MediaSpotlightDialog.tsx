import { useQuery } from '@tanstack/react-query'
import { Check, Play, Plus, Star, X } from 'lucide-react'
import { isResumable, type DetailedMediaItem, type MediaItem } from '../lib/media'
import { fetchItemDetails, fetchSeriesDetails } from '../server/functions'

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
          aria-label="Close details"
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
              {detail.type === 'series' ? 'Series spotlight' : 'Movie spotlight'}
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
                No synopsis is available for this title yet.
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
                    <span>Studios</span>
                    <strong>{detail.studios.slice(0, 4).join(', ')}</strong>
                  </div>
                ) : null}
                {detail.tags.length ? (
                  <div className="detail-meta-block">
                    <span>Tags</span>
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
              onClick={() => onPlay?.(detail)}
              disabled={!onPlay}
            >
              <Play size={18} fill="currentColor" /> {resumable ? 'Resume now' : 'Play now'}
            </button>

            <button
              type="button"
              className="secondary-action"
              onClick={() => onToggleFavorite?.(detail)}
            >
              {detail.isFavorite ? (
                <>
                  <Check size={18} /> In My List
                </>
              ) : (
                <>
                  <Plus size={18} /> Add to My List
                </>
              )}
            </button>
          </div>
        </div>

        <div className="dialog-lower">
          <section className="detail-section">
            <div className="detail-section-head">
              <p className="eyebrow">Cast & crew</p>
              {loadingState ? <span className="detail-loading">Loading credits…</span> : null}
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
                    <span>{person.role ?? person.type ?? 'Cast'}</span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="detail-empty">No cast data is available for this title yet.</p>
            )}
          </section>

          {detail.type === 'series' ? (
            <section className="detail-section">
              <div className="detail-section-head">
                <p className="eyebrow">Episodes</p>
                {nextUp.length ? (
                  <span className="detail-loading">Next up ready</span>
                ) : null}
              </div>
              {nextUp.length ? (
                <div className="episode-highlight">
                  <div>
                    <span className="eyebrow">Continue with</span>
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
                    <Play size={18} fill="currentColor" /> {isResumable(nextUp[0]) ? 'Resume next up' : 'Play next up'}
                  </button>
                </div>
              ) : null}

              {episodes.length ? (
                <div className="episode-list">
                  {episodes.slice(0, 10).map((episode) => (
                    <button
                      key={episode.id}
                      type="button"
                      className="episode-row"
                      onClick={() => onPlay?.(episode)}
                    >
                      <div>
                        <strong>{episode.title}</strong>
                        <span>
                          {[
                            episode.seasonNumber ? `Season ${episode.seasonNumber}` : null,
                            episode.episodeNumber ? `Episode ${episode.episodeNumber}` : null,
                            episode.runtimeMinutes ? `${episode.runtimeMinutes}m` : null,
                          ]
                            .filter(Boolean)
                            .join(' • ')}
                        </span>
                      </div>
                      <span className="episode-progress">
                        {episode.progress
                          ? `${Math.round(episode.progress)}% watched`
                          : isResumable(episode)
                            ? 'Resume'
                            : 'Play'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="detail-empty">No episode list is available for this series in Jellyfin.</p>
              )}
            </section>
          ) : null}

          <section className="detail-section">
            <div className="detail-section-head">
              <p className="eyebrow">More like this</p>
            </div>
            {similar.length ? (
              <div className="similar-grid">
                {similar.slice(0, 6).map((similarItem) => (
                  <button
                    key={similarItem.id}
                    type="button"
                    className="similar-card"
                    onClick={() => onSelectSimilar?.(similarItem)}
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
              <p className="detail-empty">We could not find similar titles for this item.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
