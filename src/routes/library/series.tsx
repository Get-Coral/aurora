import { createFileRoute } from '@tanstack/react-router'
import { LibraryView } from '../../components/LibraryView'
import { useI18n } from '../../lib/i18n'
import { fetchLibrary } from '../../server/functions'

type SeriesSort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
type SeriesSortOrder = 'Ascending' | 'Descending'

export const Route = createFileRoute('/library/series')({
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
        ? (search.sort as SeriesSort)
        : 'DateCreated',
    order:
      search.order === 'Ascending' || search.order === 'Descending'
        ? (search.order as SeriesSortOrder)
        : 'Descending',
  }),
  loaderDeps: ({ search }) => ({ page: search.page, sort: search.sort, order: search.order }),
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.ensureQueryData({
      queryKey: ['library', 'Series', deps.page, deps.sort, deps.order],
      queryFn: () =>
        fetchLibrary({
          data: { type: 'Series', page: deps.page, sortBy: deps.sort, sortOrder: deps.order },
        }),
    })
  },
  component: SeriesLibraryPage,
})

function SeriesLibraryPage() {
  const { t } = useI18n()
  const search = Route.useSearch()

  return (
    <LibraryView
      type="Series"
      title={t('route.series.title')}
      subtitle={t('route.series.subtitle')}
      search={search}
    />
  )
}
