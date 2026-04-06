import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toggleFavoriteRuntime } from '../lib/runtime-functions'

export function useFavoriteAction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; isFavorite: boolean }) =>
      toggleFavoriteRuntime({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })
}
