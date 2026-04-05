import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Locale = 'en' | 'nl'

type MessageValue = string | ((params?: Record<string, string | number | undefined>) => string)

type MessageDictionary = Record<string, MessageValue>

const messages: Record<Locale, MessageDictionary> = {
  en: {
    'brand.wordmark': 'Aurora',
    'brand.forJellyfin': 'for Jellyfin',
    'nav.home': 'Home',
    'nav.continue': 'Continue',
    'nav.movies': 'Movies',
    'nav.series': 'Series',
    'nav.myList': 'My List',
    'locale.label': 'Language',
    'search.placeholder': 'Search your library',
    'search.close': 'Close search',
    'search.open': 'Open search',
    'search.searching': 'Searching…',
    'search.empty': 'No matching titles found.',
    'search.series': 'Series',
    'search.movie': 'Movie',
    'footer.builtWith': 'Built with',
    'footer.by': 'by',
    'footer.contribute': 'Contribute',
    'home.libraryPulse': 'Library pulse',
    'home.libraryPulseCopy': 'fresh arrivals across films and shows',
    'home.watchRhythm': 'Watch rhythm',
    'home.watchRhythmCopy': 'titles waiting where you left them',
    'home.tonightsLane': "Tonight's lane",
    'home.tonightsLaneCopy': 'picked from your Jellyfin collection',
    'home.curatedFallback': 'Curated',
    'home.continue.title': 'Resume your queue',
    'home.continue.subtitle': 'Keep momentum',
    'home.continue.emptyTitle': 'Your continue queue is still empty',
    'home.continue.emptyCopy':
      'Open a movie or episode from your library and Aurora will surface it here with progress and quick resume.',
    'home.movies.title': 'Recent movie arrivals',
    'home.movies.subtitle': 'Freshly added',
    'home.favorites.title': 'Favorites worth revisiting',
    'home.favorites.subtitle': 'Your picks',
    'home.favorites.emptyTitle': 'No favorites yet',
    'home.favorites.emptyCopy':
      'Mark a few movies as favorites in Jellyfin and Aurora will bring them together here.',
    'home.series.title': 'Series worth diving into',
    'home.series.subtitle': 'Just landed',
    'home.recommended.title': 'Because you watched this vibe',
    'home.recommended.subtitle': 'Similar energy',
    'home.recommended.emptyTitle': 'Recommendations will appear here',
    'home.recommended.emptyCopy':
      "Aurora uses Jellyfin's similar-title data to turn your current spotlight into a more personalized row.",
    'hero.resumeNow': 'Resume now',
    'hero.playNow': 'Play now',
    'hero.moreInfo': 'More info',
    'hero.cinematic': 'Cinematic',
    'hero.mood': 'Mood',
    'hero.readyTonight': 'Ready tonight',
    'hero.runtime': 'Runtime',
    'hero.freshPick': 'Fresh pick',
    'hero.release': 'Release',
    'hero.continueWatching': 'Continue watching',
    'hero.pickUpInstantly': 'Pick up instantly',
    'hero.episodeLabel': ({ seriesTitle, episodeNumber }) =>
      `${seriesTitle} • Episode ${episodeNumber ?? '?'}`,
    'hero.progressWatched': ({ progress }) => `${progress}% watched`,
    'hero.readyToResume': 'Ready to resume',
    'hero.open': 'Open',
    'hero.queueAfterThat': 'Queue after that',
    'hero.queueCopy': 'Hand-picked from your library',
    'hero.curatedByJellyfin': 'Curated by Jellyfin',
    'hero.curatedCopy': 'Streamlined for movie-night energy',
    'hero.alreadyFavorite': 'Already in your favorites',
    'section.browseMore': 'Browse more',
    'section.readyWhenYouAre': 'Ready when you are',
    'section.emptyTitle': 'Nothing here yet',
    'section.emptyCopy':
      'Start a title and your in-progress picks will show up here for quick access.',
    'card.series': 'Series',
    'card.tonight': 'Tonight',
    'card.feature': 'Feature',
    'card.favorite': 'Favorite',
    'card.resume': 'Resume',
    'card.play': 'Play',
    'card.details': 'Details',
    'card.addToMyList': 'Add to My List',
    'card.removeFromMyList': 'Remove from My List',
    'card.inMyList': 'In My List',
    'card.myList': 'My List',
    'card.instantlyAvailable': 'Instantly available',
    'dialog.closeDetails': 'Close details',
    'dialog.seriesSpotlight': 'Series spotlight',
    'dialog.movieSpotlight': 'Movie spotlight',
    'dialog.noSynopsis': 'No synopsis is available for this title yet.',
    'dialog.studios': 'Studios',
    'dialog.tags': 'Tags',
    'dialog.addToMyList': 'Add to My List',
    'dialog.inMyList': 'In My List',
    'dialog.castCrew': 'Cast & crew',
    'dialog.loadingCredits': 'Loading credits…',
    'dialog.noCast': 'No cast data is available for this title yet.',
    'dialog.episodes': 'Episodes',
    'dialog.nextUpReady': 'Next up ready',
    'dialog.continueWith': 'Continue with',
    'dialog.resumeNextUp': 'Resume next up',
    'dialog.playNextUp': 'Play next up',
    'dialog.playEpisode': 'Play',
    'dialog.noEpisodes': 'No episode list is available for this series in Jellyfin.',
    'dialog.moreLikeThis': 'More like this',
    'dialog.noSimilar': 'We could not find similar titles for this item.',
    'dialog.castFallback': 'Cast',
    'generic.season': 'Season',
    'generic.episode': 'Episode',
    'player.nowPlaying': 'Now playing',
    'player.close': 'Close player',
    'player.upNext': 'Up next',
    'player.inQueue': ({ count }) => `${count} in queue`,
    'player.notPlayable': 'This title is not directly playable yet.',
    'player.series': 'Series',
    'player.movie': 'Movie',
    'player.episode': 'Episode',
    'library.backHome': 'Back home',
    'library.myListSummary':
      'Everything you marked as a favorite in Jellyfin, collected into one streaming-style list.',
    'library.summary': ({ type }) =>
      `Explore your full ${type === 'movie' ? 'movie' : 'series'} library with sort controls and a scannable grid.`,
    'library.sortBy': 'Sort by',
    'library.direction': 'Direction',
    'library.sort.dateCreated': 'Recently added',
    'library.sort.premiereDate': 'Release date',
    'library.sort.communityRating': 'Top rated',
    'library.sort.sortName': 'Alphabetical',
    'library.order.desc': 'Descending',
    'library.order.asc': 'Ascending',
    'library.pageOf': ({ page, total }) => `Page ${page} of ${total}`,
    'library.previousPage': 'Previous page',
    'library.nextPage': 'Next page',
    'library.allMovies': 'All movies',
    'library.totalTitles': ({ count }) => `${count} total titles`,
    'route.myList.title': 'My List',
    'route.myList.subtitle': 'Saved for later',
    'route.movies.title': 'Movie library',
    'route.movies.subtitle': 'Browse the full catalog',
    'route.series.title': 'Series library',
    'route.series.subtitle': 'Browse the full catalog',
    'route.genre.title': ({ genre }) => `${genre} movies`,
    'route.genre.subtitle': 'Browse by genre',
  },
  nl: {
    'brand.wordmark': 'Aurora',
    'brand.forJellyfin': 'voor Jellyfin',
    'nav.home': 'Home',
    'nav.continue': 'Verderkijken',
    'nav.movies': 'Films',
    'nav.series': 'Series',
    'nav.myList': 'Mijn lijst',
    'locale.label': 'Taal',
    'search.placeholder': 'Zoek in je bibliotheek',
    'search.close': 'Zoeken sluiten',
    'search.open': 'Zoeken openen',
    'search.searching': 'Zoeken…',
    'search.empty': 'Geen overeenkomende titels gevonden.',
    'search.series': 'Serie',
    'search.movie': 'Film',
    'footer.builtWith': 'Gemaakt met',
    'footer.by': 'door',
    'footer.contribute': 'Bijdragen',
    'home.libraryPulse': 'Bibliotheekpuls',
    'home.libraryPulseCopy': 'nieuwe toevoegingen in films en series',
    'home.watchRhythm': 'Kijkritme',
    'home.watchRhythmCopy': 'titels die wachten waar je gebleven was',
    'home.tonightsLane': 'Vanavond',
    'home.tonightsLaneCopy': 'gekozen uit je Jellyfin-collectie',
    'home.curatedFallback': 'Gecureerd',
    'home.continue.title': 'Ga verder met je wachtrij',
    'home.continue.subtitle': 'Blijf in de flow',
    'home.continue.emptyTitle': 'Je verderkijkrij is nog leeg',
    'home.continue.emptyCopy':
      'Open een film of aflevering uit je bibliotheek en Aurora toont die hier met voortgang en snel hervatten.',
    'home.movies.title': 'Recent toegevoegde films',
    'home.movies.subtitle': 'Net toegevoegd',
    'home.favorites.title': 'Favorieten om opnieuw te kijken',
    'home.favorites.subtitle': 'Jouw picks',
    'home.favorites.emptyTitle': 'Nog geen favorieten',
    'home.favorites.emptyCopy':
      'Markeer een paar films als favoriet in Jellyfin en Aurora verzamelt ze hier.',
    'home.series.title': 'Series om in te duiken',
    'home.series.subtitle': 'Net binnen',
    'home.recommended.title': 'Omdat je deze sfeer keek',
    'home.recommended.subtitle': 'Gelijkaardige energie',
    'home.recommended.emptyTitle': 'Aanbevelingen verschijnen hier',
    'home.recommended.emptyCopy':
      'Aurora gebruikt vergelijkbare titels uit Jellyfin om je spotlight persoonlijker te maken.',
    'hero.resumeNow': 'Nu hervatten',
    'hero.playNow': 'Nu afspelen',
    'hero.moreInfo': 'Meer info',
    'hero.cinematic': 'Cinematisch',
    'hero.mood': 'Sfeer',
    'hero.readyTonight': 'Klaar voor vanavond',
    'hero.runtime': 'Speelduur',
    'hero.freshPick': 'Verse keuze',
    'hero.release': 'Release',
    'hero.continueWatching': 'Verderkijken',
    'hero.pickUpInstantly': 'Meteen verdergaan',
    'hero.episodeLabel': ({ seriesTitle, episodeNumber }) =>
      `${seriesTitle} • Aflevering ${episodeNumber ?? '?'}`,
    'hero.progressWatched': ({ progress }) => `${progress}% bekeken`,
    'hero.readyToResume': 'Klaar om te hervatten',
    'hero.open': 'Openen',
    'hero.queueAfterThat': 'Daarna in de rij',
    'hero.queueCopy': 'Gekozen uit je bibliotheek',
    'hero.curatedByJellyfin': 'Gecureerd door Jellyfin',
    'hero.curatedCopy': 'Gestroomlijnd voor filmavond-energie',
    'hero.alreadyFavorite': 'Al in je favorieten',
    'section.browseMore': 'Meer bekijken',
    'section.readyWhenYouAre': 'Klaar wanneer jij dat bent',
    'section.emptyTitle': 'Hier staat nog niets',
    'section.emptyCopy':
      'Start een titel en je voortgangstitels verschijnen hier voor snelle toegang.',
    'card.series': 'Serie',
    'card.tonight': 'Vanavond',
    'card.feature': 'Uitgelicht',
    'card.favorite': 'Favoriet',
    'card.resume': 'Hervat',
    'card.play': 'Speel af',
    'card.details': 'Details',
    'card.addToMyList': 'Toevoegen aan Mijn lijst',
    'card.removeFromMyList': 'Verwijderen uit Mijn lijst',
    'card.inMyList': 'In Mijn lijst',
    'card.myList': 'Mijn lijst',
    'card.instantlyAvailable': 'Direct beschikbaar',
    'dialog.closeDetails': 'Details sluiten',
    'dialog.seriesSpotlight': 'Seriespotlight',
    'dialog.movieSpotlight': 'Filmspotlight',
    'dialog.noSynopsis': 'Er is nog geen synopsis beschikbaar voor deze titel.',
    'dialog.studios': 'Studio’s',
    'dialog.tags': 'Tags',
    'dialog.addToMyList': 'Toevoegen aan Mijn lijst',
    'dialog.inMyList': 'In Mijn lijst',
    'dialog.castCrew': 'Cast & crew',
    'dialog.loadingCredits': 'Credits laden…',
    'dialog.noCast': 'Er zijn nog geen castgegevens voor deze titel.',
    'dialog.episodes': 'Afleveringen',
    'dialog.nextUpReady': 'Volgende staat klaar',
    'dialog.continueWith': 'Ga verder met',
    'dialog.resumeNextUp': 'Volgende hervatten',
    'dialog.playNextUp': 'Volgende afspelen',
    'dialog.playEpisode': 'Speel af',
    'dialog.noEpisodes': 'Er is geen afleveringslijst beschikbaar voor deze serie in Jellyfin.',
    'dialog.moreLikeThis': 'Meer zoals dit',
    'dialog.noSimilar': 'We konden geen gelijkaardige titels vinden voor dit item.',
    'dialog.castFallback': 'Cast',
    'generic.season': 'Seizoen',
    'generic.episode': 'Aflevering',
    'player.nowPlaying': 'Nu afgespeeld',
    'player.close': 'Speler sluiten',
    'player.upNext': 'Hierna',
    'player.inQueue': ({ count }) => `${count} in wachtrij`,
    'player.notPlayable': 'Deze titel is nog niet direct afspeelbaar.',
    'player.series': 'Serie',
    'player.movie': 'Film',
    'player.episode': 'Aflevering',
    'library.backHome': 'Terug naar home',
    'library.myListSummary':
      'Alles wat je als favoriet markeerde in Jellyfin, verzameld in één streamingstijl-lijst.',
    'library.summary': ({ type }) =>
      `Verken je volledige ${type === 'movie' ? 'film' : 'serie'}bibliotheek met sorteermogelijkheden en een scanbare grid.`,
    'library.sortBy': 'Sorteer op',
    'library.direction': 'Richting',
    'library.sort.dateCreated': 'Recent toegevoegd',
    'library.sort.premiereDate': 'Releasedatum',
    'library.sort.communityRating': 'Hoogst gewaardeerd',
    'library.sort.sortName': 'Alfabetisch',
    'library.order.desc': 'Aflopend',
    'library.order.asc': 'Oplopend',
    'library.pageOf': ({ page, total }) => `Pagina ${page} van ${total}`,
    'library.previousPage': 'Vorige pagina',
    'library.nextPage': 'Volgende pagina',
    'library.allMovies': 'Alle films',
    'library.totalTitles': ({ count }) => `${count} titels in totaal`,
    'route.myList.title': 'Mijn lijst',
    'route.myList.subtitle': 'Bewaard voor later',
    'route.movies.title': 'Filmbibliotheek',
    'route.movies.subtitle': 'Bekijk de volledige catalogus',
    'route.series.title': 'Seriesbibliotheek',
    'route.series.subtitle': 'Bekijk de volledige catalogus',
    'route.genre.title': ({ genre }) => `${genre}-films`,
    'route.genre.subtitle': 'Bladeren per genre',
  },
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en'

  const stored = window.localStorage.getItem('aurora-locale')
  if (stored === 'en' || stored === 'nl') return stored

  return navigator.language.toLowerCase().startsWith('nl') ? 'nl' : 'en'
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Record<string, string | number | undefined>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    setLocaleState(detectLocale())
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('aurora-locale', locale)
    }
  }, [locale])

  const value = useMemo<I18nContextValue>(() => {
    function t(key: string, params?: Record<string, string | number | undefined>) {
      const dictionary = messages[locale] ?? messages.en
      const entry = dictionary[key] ?? messages.en[key] ?? key

      if (typeof entry === 'function') {
        return entry(params)
      }

      return entry
    }

    return {
      locale,
      setLocale: setLocaleState,
      t,
    }
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider')
  }

  return context
}
