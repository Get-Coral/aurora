import { useQuery } from '@tanstack/react-query'
import { Search, Sparkles, X } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../lib/media'
import { fetchSearch } from '../server/functions'

export default function Header() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query.trim())

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', deferredQuery],
    queryFn: () => fetchSearch({ data: { query: deferredQuery } }),
    enabled: deferredQuery.length > 1,
  })

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  function jumpToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function selectItem(item: MediaItem) {
    window.dispatchEvent(new CustomEvent('aurora:select-media', { detail: item }))
    setSearchOpen(false)
    setQuery('')
  }

  return (
    <header className="app-header">
      <nav className="page-wrap header-bar">
        <button
          type="button"
          className="brand-mark"
          onClick={() => jumpToSection('spotlight')}
        >
          <span className="brand-glyph">
            <Sparkles size={15} />
          </span>
          <span>
            Aurora <em>for Jellyfin</em>
          </span>
        </button>

        <div className="header-nav">
          {[
            { label: 'Home', id: 'spotlight' },
            { label: 'Continue', id: 'continue' },
            { label: 'Movies', id: 'movies' },
            { label: 'Series', id: 'series' },
          ].map(({ label, id }) => (
            <button
              key={id}
              type="button"
              className="nav-pill"
              onClick={() => jumpToSection(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="header-actions">
          {searchOpen ? (
            <div className="search-shell">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
                placeholder="Search your library"
                className="search-input"
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setSearchOpen(false)
                  setQuery('')
                }}
                aria-label="Close search"
              >
                <X size={16} />
              </button>

              {deferredQuery.length > 1 ? (
                <div className="search-results">
                  {isFetching ? <p className="search-state">Searching…</p> : null}
                  {!isFetching && results.length === 0 ? (
                    <p className="search-state">No matching titles found.</p>
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
                          {[item.type === 'series' ? 'Series' : 'Movie', item.year]
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
              aria-label="Open search"
            >
              <Search size={20} />
            </button>
          )}

          <div className="avatar-chip" aria-hidden="true">
            EL
          </div>
        </div>
      </nav>
    </header>
  )
}
