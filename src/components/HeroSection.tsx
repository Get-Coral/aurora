import { Clock3, Heart, Play, Sparkles, Star } from 'lucide-react'
import type { MediaItem } from '../lib/media'

interface HeroSectionProps {
  item: MediaItem
  continueItem?: MediaItem | null
  companionItems?: MediaItem[]
  onPlay?: () => void
  onMoreInfo?: () => void
  onSelectCompanion?: (item: MediaItem) => void
}

function formatRuntime(minutes?: number) {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function HeroSection({
  item,
  continueItem,
  companionItems = [],
  onPlay,
  onMoreInfo,
  onSelectCompanion,
}: HeroSectionProps) {
  const runtime = formatRuntime(item.runtimeMinutes)
  const metadata = [item.year, runtime, item.ageRating].filter(Boolean)

  return (
    <section id="spotlight" className="hero-shell">
      {item.backdropUrl ? (
        <img
          src={item.backdropUrl}
          alt=""
          className="hero-backdrop"
          style={{ objectPosition: 'center 18%' }}
        />
      ) : (
        <div className="hero-backdrop-fallback" />
      )}

      <div className="hero-backdrop-overlay" />

      <div className="hero-content page-wrap">
        <div className="hero-copy fade-up">
          {item.genres.length > 0 ? (
            <p className="eyebrow hero-kicker">
              {item.genres.slice(0, 3).join(' • ')}
            </p>
          ) : null}

          {item.logoUrl ? (
            <img src={item.logoUrl} alt={item.title} className="hero-logo" />
          ) : (
            <h1 className="hero-title">{item.title}</h1>
          )}

          <div className="hero-meta">
            {metadata.map((entry) => (
              <span key={entry}>{entry}</span>
            ))}
            {item.rating != null ? (
              <span className="hero-rating">
                <Star size={14} fill="currentColor" /> {item.rating.toFixed(1)}
              </span>
            ) : null}
          </div>

          {item.overview ? (
            <p className="hero-overview">{item.overview}</p>
          ) : null}

          <div className="hero-actions">
            <button className="primary-action" onClick={onPlay} type="button">
              <Play size={18} fill="currentColor" /> Play now
            </button>
            <button className="secondary-action" onClick={onMoreInfo} type="button">
              More info
            </button>
          </div>

          <div className="hero-stat-strip">
            <div>
              <span className="hero-stat-value">{item.genres[0] ?? 'Cinematic'}</span>
              <span className="hero-stat-label">Mood</span>
            </div>
            <div>
              <span className="hero-stat-value">
                {runtime ?? 'Ready tonight'}
              </span>
              <span className="hero-stat-label">Runtime</span>
            </div>
            <div>
              <span className="hero-stat-value">{item.year ?? 'Fresh pick'}</span>
              <span className="hero-stat-label">Release</span>
            </div>
          </div>
        </div>

        {continueItem ? (
          <aside className="continue-panel fade-up">
            <div className="hero-panel-head">
              <div>
                <p className="eyebrow">Continue watching</p>
                <strong>Pick up instantly</strong>
              </div>
              <Clock3 size={18} />
            </div>
            <div className="continue-media">
              {continueItem.backdropUrl ?? continueItem.posterUrl ? (
                <img
                  src={continueItem.backdropUrl ?? continueItem.posterUrl}
                  alt={continueItem.title}
                  className="continue-image"
                />
              ) : (
                <div className="continue-image continue-image-fallback" />
              )}
            </div>

            <div className="continue-copy">
              <h2>{continueItem.title}</h2>
              <p>
                {continueItem.seriesTitle
                  ? `${continueItem.seriesTitle} • Episode ${continueItem.episodeNumber ?? '?'}`
                  : continueItem.overview ?? 'Pick up where you left off.'}
              </p>
            </div>

            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${continueItem.progress ?? 0}%` }}
              />
            </div>

            <div className="continue-footer">
              <span>
                {continueItem.progress ? `${Math.round(continueItem.progress)}% watched` : 'Ready to resume'}
              </span>
              <button className="secondary-action" onClick={onMoreInfo} type="button">
                Open
              </button>
            </div>

            {companionItems.length ? (
              <div className="hero-queue">
                <div className="hero-panel-head">
                  <div>
                    <p className="eyebrow">Queue after that</p>
                    <strong>Hand-picked from your library</strong>
                  </div>
                  <Sparkles size={18} />
                </div>
                <div className="hero-queue-list">
                  {companionItems.slice(0, 3).map((companion) => (
                    <button
                      key={companion.id}
                      type="button"
                      className="hero-queue-item"
                      onClick={() => onSelectCompanion?.(companion)}
                    >
                      {companion.posterUrl ? (
                        <img
                          src={companion.posterUrl}
                          alt={companion.title}
                          className="hero-queue-poster"
                        />
                      ) : (
                        <div className="hero-queue-poster hero-queue-poster-fallback" />
                      )}
                      <span>
                        <strong>{companion.title}</strong>
                        <em>
                          {[companion.type === 'series' ? 'Series' : 'Movie', companion.year]
                            .filter(Boolean)
                            .join(' • ')}
                        </em>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        ) : (
          <aside className="hero-orbit">
            <div className="orbit-card">
              <span>Curated by Jellyfin</span>
              <strong>Streamlined for movie-night energy</strong>
              {item.isFavorite ? (
                <small>
                  <Heart size={14} fill="currentColor" /> Already in your favorites
                </small>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
