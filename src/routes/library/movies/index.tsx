import { createFileRoute, redirect } from '@tanstack/react-router'
import { LibraryView } from '../../../components/LibraryView'
import { useI18n } from '../../../lib/i18n'
import { fetchSetupStatus } from '../../../server/functions'

type MovieSort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
type MovieSortOrder = 'Ascending' | 'Descending'

export const Route = createFileRoute('/library/movies/')({
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
  }),
  loaderDeps: ({ search }) => ({ sort: search.sort, order: search.order }),
  loader: async () => {
    const setupStatus = await fetchSetupStatus()
    if (!setupStatus.configured) {
      throw redirect({ to: '/setup' })
    }
  },
  component: MoviesLibraryPage,
})

function MoviesLibraryPage() {
  const { t } = useI18n()
  const search = Route.useSearch()

  return (
    <LibraryView
      type="Movie"
      title={t('route.movies.title')}
      subtitle={t('route.movies.subtitle')}
      search={search}
      genre={undefined}
    />
  )
}
