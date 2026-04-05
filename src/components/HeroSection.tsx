import { Clock3, Heart, Play, Sparkles, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isResumable, type MediaItem } from '../lib/media'
import { useI18n } from '../lib/i18n'

interface HeroSectionProps {
  item: MediaItem
  continueItem?: MediaItem | null
  companionItems?: MediaItem[]
  onPlay?: () => void
  onPlayContinue?: (item: MediaItem) => void
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
  onPlayContinue,
  onMoreInfo,
  onSelectCompanion,
}: HeroSectionProps) {
  const { t } = useI18n()
  const runtime = formatRuntime(item.runtimeMinutes)
  const metadata = [item.year, runtime, item.ageRating].filter(Boolean)
  const itemIsResumable = isResumable(item)
  const continueIsResumable = continueItem ? isResumable(continueItem) : false

  // Cross-fade: keep the previous backdrop visible while the new one fades in
  const [prevBackdropUrl, setPrevBackdropUrl] = useState<string | null>(null)
  const [fadeKey, setFadeKey] = useState(0)
  const prevItemIdRef = useRef(item.id)
  const prevBackdropRef = useRef(item.backdropUrl ?? null)

  useEffect(() => {
    if (item.id === prevItemIdRef.current) return
    // Capture the outgoing backdrop before updating refs
    setPrevBackdropUrl(prevBackdropRef.current)
    setFadeKey((k) => k + 1)
    prevItemIdRef.current = item.id
    prevBackdropRef.current = item.backdropUrl ?? null
  }, [item.id, item.backdropUrl])

  return (
    <section id="spotlight" className="hero-shell">
      {/* Outgoing backdrop sits underneath and fades out */}
      {prevBackdropUrl ? (
        <img
          src={prevBackdropUrl}
          alt=""
          className="hero-backdrop hero-backdrop-out"
          style={{ objectPosition: 'center 18%' }}
        />
      ) : null}
      {/* Incoming backdrop fades in on top */}
      {item.backdropUrl ? (
        <img
          key={fadeKey}
          src={item.backdropUrl}
          alt=""
          className="hero-backdrop hero-backdrop-in"
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
              <Play size={18} fill="currentColor" /> {itemIsResumable ? t('hero.resumeNow') : t('hero.playNow')}
            </button>
            <button className="secondary-action" onClick={onMoreInfo} type="button">
              {t('hero.moreInfo')}
            </button>
          </div>

          <div className="hero-stat-strip">
            <div>
              <span className="hero-stat-value">{item.genres[0] ?? t('hero.cinematic')}</span>
              <span className="hero-stat-label">{t('hero.mood')}</span>
            </div>
            <div>
              <span className="hero-stat-value">
                {runtime ?? t('hero.readyTonight')}
              </span>
              <span className="hero-stat-label">{t('hero.runtime')}</span>
            </div>
            <div>
              <span className="hero-stat-value">{item.year ?? t('hero.freshPick')}</span>
              <span className="hero-stat-label">{t('hero.release')}</span>
            </div>
          </div>
        </div>

        {continueItem ? (
          <aside className="continue-panel fade-up">
            <div className="hero-panel-head">
              <div>
                <p className="eyebrow">{t('hero.continueWatching')}</p>
                <strong>{t('hero.pickUpInstantly')}</strong>
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
                  ? t('hero.episodeLabel', {
                      seriesTitle: continueItem.seriesTitle,
                      episodeNumber: continueItem.episodeNumber ?? '?',
                    })
                  : continueItem.overview ?? t('hero.pickUpInstantly')}
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
                {continueItem.progress
                  ? t('hero.progressWatched', { progress: Math.round(continueItem.progress) })
                  : t('hero.readyToResume')}
              </span>
              <button
                className="secondary-action"
                onClick={() =>
                  continueIsResumable ? onPlayContinue?.(continueItem) : onMoreInfo?.()
                }
                type="button"
              >
                {continueIsResumable ? t('hero.resumeNow') : t('hero.open')}
              </button>
            </div>

            {companionItems.length ? (
              <div className="hero-queue">
                <div className="hero-panel-head">
                  <div>
                    <p className="eyebrow">{t('hero.queueAfterThat')}</p>
                    <strong>{t('hero.queueCopy')}</strong>
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
                          {[companion.type === 'series' ? t('player.series') : t('player.movie'), companion.year]
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
              <span>{t('hero.curatedByJellyfin')}</span>
              <strong>{t('hero.curatedCopy')}</strong>
              {item.isFavorite ? (
                <small>
                  <Heart size={14} fill="currentColor" /> {t('hero.alreadyFavorite')}
                </small>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
