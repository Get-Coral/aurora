import { createFileRoute, redirect } from '@tanstack/react-router'
import { LibraryView } from '../../../components/LibraryView'
import { useI18n } from '../../../lib/i18n'
import { fetchLibrary, fetchSetupStatus } from '../../../server/functions'

type MovieSort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
type MovieSortOrder = 'Ascending' | 'Descending'

export const Route = createFileRoute('/library/movies/')({
  validateSearch: (search: Record<string, unknown>) => ({
    page:
      typeof search.page === 'number'
        ? search.page
        : typeof search.page === 'string'
          ? Number.parseInt(search.page, 10) || 0
          : 0,
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
  loaderDeps: ({ search }) => ({ page: search.page, sort: search.sort, order: search.order }),
  loader: async ({ context: { queryClient }, deps }) => {
    const setupStatus = await fetchSetupStatus()

    if (!setupStatus.configured) {
      throw redirect({ to: '/setup' })
    }

    await queryClient.ensureQueryData({
      queryKey: ['library', 'Movie', deps.page, deps.sort, deps.order, undefined],
      queryFn: () =>
        fetchLibrary({
          data: { type: 'Movie', page: deps.page, sortBy: deps.sort, sortOrder: deps.order },
        }),
    })
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
