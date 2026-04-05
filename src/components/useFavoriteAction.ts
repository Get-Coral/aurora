import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toggleFavorite } from '../server/functions'

export function useFavoriteAction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; isFavorite: boolean }) =>
      toggleFavorite({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })
}
