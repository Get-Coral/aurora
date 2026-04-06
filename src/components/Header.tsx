import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Settings, Sparkles, X } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../lib/media'
import { useI18n } from '../lib/i18n'
import { fetchSearchRuntime, fetchUsernameRuntime } from '../lib/runtime-functions'
import { useTvMode } from '../lib/tv-mode'

export default function Header() {
  const { t } = useI18n()
  const { tvMode } = useTvMode()

  const { data: username = '' } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => fetchUsernameRuntime(),
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query.trim())

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', deferredQuery],
    queryFn: () => fetchSearchRuntime({ data: { query: deferredQuery } }),
    enabled: deferredQuery.length > 1,
  })

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  function selectItem(item: MediaItem) {
    window.dispatchEvent(new CustomEvent('aurora:select-media', { detail: item }))
    setSearchOpen(false)
    setQuery('')
  }

  return (
    <header className="app-header">
      <nav className="page-wrap header-bar">
        <Link to="/" className="brand-mark" data-tv-focusable="true">
          <span className="brand-glyph">
            <Sparkles size={15} />
          </span>
          <span>
            {t('brand.wordmark')} <em>{t('brand.forJellyfin')}</em>
          </span>
        </Link>

        <div className="header-nav">
          <Link to="/" className="nav-pill" activeProps={{ className: 'nav-pill nav-pill-active' }} data-tv-focusable="true">
            {t('nav.home')}
          </Link>
          <Link
            to="/library/movies"
            search={{ sort: 'DateCreated', order: 'Descending', ratings: '', decade: '', minScore: 0, watchStatus: undefined }}
            className="nav-pill"
            activeProps={{ className: 'nav-pill nav-pill-active' }}
            data-tv-focusable="true"
          >
            {t('nav.movies')}
          </Link>
          <Link
            to="/library/series"
            search={{ sort: 'DateCreated', order: 'Descending', ratings: '', decade: '', minScore: 0, watchStatus: undefined }}
            className="nav-pill"
            activeProps={{ className: 'nav-pill nav-pill-active' }}
            data-tv-focusable="true"
          >
            {t('nav.series')}
          </Link>
          {!tvMode ? (
            <Link
              to="/collections"
              className="nav-pill"
              activeProps={{ className: 'nav-pill nav-pill-active' }}
              data-tv-focusable="true"
            >
              {t('nav.collections')}
            </Link>
          ) : null}
          <Link
            to="/my-list"
            className="nav-pill"
            activeProps={{ className: 'nav-pill nav-pill-active' }}
            data-tv-focusable="true"
          >
            {t('nav.myList')}
          </Link>
        </div>

        <div className="header-actions">
          {searchOpen ? (
            <div className="search-shell">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
                placeholder={t('search.placeholder')}
                className="search-input"
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setSearchOpen(false)
                  setQuery('')
                }}
                aria-label={t('search.close')}
              >
                <X size={16} />
              </button>

              {deferredQuery.length > 1 ? (
                <div className="search-results">
                  {isFetching ? <p className="search-state">{t('search.searching')}</p> : null}
                  {!isFetching && results.length === 0 ? (
                    <p className="search-state">{t('search.empty')}</p>
                  ) : null}
                  {results.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="search-result"
                      onClick={() => selectItem(item)}
                    >
                      <div className="search-result-copy">
                        <strong>{item.title}</strong>
                        <span>
                          {[item.type === 'series' ? t('search.series') : t('search.movie'), item.year]
                            .filter(Boolean)
                            .join(' • ')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="icon-button"
              aria-label={t('search.open')}
              data-tv-focusable="true"
            >
              <Search size={20} />
            </button>
          )}

          <Link
            to="/settings"
            className="icon-button"
            aria-label={t('nav.settings')}
            data-tv-focusable="true"
          >
            <Settings size={20} />
          </Link>

          <Link
            to="/admin"
            className="avatar-chip"
            aria-label="Admin dashboard"
            title={username || 'Admin'}
            data-tv-focusable="true"
          >
            {username.slice(0, 2).toUpperCase() || '??'}
          </Link>
        </div>
      </nav>
    </header>
  )
}
