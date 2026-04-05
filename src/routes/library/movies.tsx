import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/movies')({
  component: MoviesRouteLayout,
})

function MoviesRouteLayout() {
  return <Outlet />
}
