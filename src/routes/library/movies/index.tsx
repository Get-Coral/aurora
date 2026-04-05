import { createFileRoute } from '@tanstack/react-router'
import { LibraryView } from '../../../components/LibraryView'
import { fetchLibrary } from '../../../server/functions'

type MovieSort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'

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
  }),
  loaderDeps: ({ search }) => ({ page: search.page, sort: search.sort }),
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.ensureQueryData({
      queryKey: ['library', 'Movie', deps.page, deps.sort, undefined],
      queryFn: () => fetchLibrary({ data: { type: 'Movie', page: deps.page, sortBy: deps.sort } }),
    })
  },
  component: MoviesLibraryPage,
})

function MoviesLibraryPage() {
  const search = Route.useSearch()

  return (
    <LibraryView
      type="Movie"
      title="Movie library"
      subtitle="Browse the full catalog"
      search={search}
      genre={undefined}
    />
  )
}
