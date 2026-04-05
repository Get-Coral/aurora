import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { LibraryView } from '../components/LibraryView'
import { useI18n } from '../lib/i18n'
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
  const { t } = useI18n()
  const { data } = useSuspenseQuery({
    queryKey: ['my-list'],
    queryFn: () => fetchMyList(),
  })

  return (
    <LibraryView
      type="Movie"
      title={t('route.myList.title')}
      subtitle={t('route.myList.subtitle')}
      search={{ page: 0, sort: 'DateCreated' }}
      mode="my-list"
      customItems={data}
    />
  )
}
