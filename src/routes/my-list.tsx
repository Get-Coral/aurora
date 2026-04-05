import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { LibraryView } from '../components/LibraryView'
import { fetchMyList } from '../server/functions'

export const Route = createFileRoute('/my-list')({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData({
      queryKey: ['my-list'],
      queryFn: () => fetchMyList(),
    })
  },
  component: MyListPage,
})

function MyListPage() {
  const { data } = useSuspenseQuery({
    queryKey: ['my-list'],
    queryFn: () => fetchMyList(),
  })

  return (
    <LibraryView
      type="Movie"
      title="My List"
      subtitle="Saved for later"
      search={{ page: 0, sort: 'DateCreated' }}
      mode="my-list"
      customItems={data}
    />
  )
}
