import { createFileRoute, redirect } from '@tanstack/react-router'
import { LibraryView } from '../../../../components/LibraryView'
import { useI18n } from '../../../../lib/i18n'
import { fetchSetupStatusRuntime } from '../../../../lib/runtime-functions'

type MovieSort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
type MovieSortOrder = 'Ascending' | 'Descending'

export const Route = createFileRoute('/library/movies/genre/$genre')({
  validateSearch: (search: Record<string, unknown>) => ({
    sort:
      search.sort === 'SortName' ||
      search.sort === 'DateCreated' ||
      search.sort === 'PremiereDate' ||
      search.sort === 'CommunityRating'
        ? (search.sort as MovieSort)
        : 'DateCreated',
    order:
      search.order === 'Ascending' || search.order === 'Descending'
        ? (search.order as MovieSortOrder)
        : 'Descending',
    ratings: typeof search.ratings === 'string' ? search.ratings : '',
    decade: typeof search.decade === 'string' ? search.decade : '',
    minScore: typeof search.minScore === 'number' ? search.minScore : 0,
  }),
  loaderDeps: ({ search }) => search,
  loader: async () => {
    const setupStatus = await fetchSetupStatusRuntime()
    if (!setupStatus.configured) {
      throw redirect({ to: '/setup' })
    }
  },
  component: MovieGenrePage,
})

function MovieGenrePage() {
  const { t } = useI18n()
  const search = Route.useSearch()
  const { genre } = Route.useParams()

  return (
    <LibraryView
      type="Movie"
      title={t('route.genre.title', { genre })}
      subtitle={t('route.genre.subtitle')}
      search={search}
      genre={genre}
    />
  )
}
