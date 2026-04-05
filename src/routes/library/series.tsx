import { createFileRoute } from '@tanstack/react-router'
import { LibraryView } from '../../components/LibraryView'
import { fetchLibrary } from '../../server/functions'

type SeriesSort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'

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
  }),
  loaderDeps: ({ search }) => ({ page: search.page, sort: search.sort }),
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.ensureQueryData({
      queryKey: ['library', 'Series', deps.page, deps.sort],
      queryFn: () => fetchLibrary({ data: { type: 'Series', page: deps.page, sortBy: deps.sort } }),
    })
  },
  component: SeriesLibraryPage,
})

function SeriesLibraryPage() {
  const search = Route.useSearch()

  return (
    <LibraryView
      type="Series"
      title="Series library"
      subtitle="Browse the full catalog"
      search={search}
    />
  )
}
