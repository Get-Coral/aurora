import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from '@tanstack/react-router'
import Footer from '../components/Footer'
import Header from '../components/Header'
import { ErrorPage } from '../components/ErrorPage'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'
import { I18nProvider } from '../lib/i18n'

interface MyRouterContext {
  queryClient: QueryClient
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Aurora for Jellyfin',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
  errorComponent: RootErrorPage,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <I18nProvider>
          <Header />
          {children}
          <Footer />
          <Scripts />
        </I18nProvider>
      </body>
    </html>
  )
}

function NotFoundPage() {
  return (
    <I18nProvider>
      <ErrorPage variant="not-found" />
    </I18nProvider>
  )
}

function RootErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter()

  function handleRetry() {
    reset()
    void router.invalidate()
  }

  return (
    <I18nProvider>
      <ErrorPage variant="error" error={error} onRetry={handleRetry} />
    </I18nProvider>
  )
}
