import { timingSafeEqual } from 'node:crypto';

/**
 * The desktop app runs this server on 127.0.0.1 and shows it in its own
 * window. Listening on loopback keeps other machines out, but not the web
 * pages open in the user's browser: they can send requests to any local
 * port, and with DNS rebinding even read the answers. So in the desktop app
 * the server only answers its own window:
 *
 * - the Host header must be the loopback address and port, which a rebound
 *   domain can't fake;
 * - the window opens `/__aurora-desktop?token=…` with a secret made for this
 *   launch, which sets a SameSite=Strict cookie, and every other request must
 *   carry that cookie, which cross-site requests never do. Only the built
 *   client files (the same for everyone) are served without it.
 */

export const DESKTOP_ENTRY_PATH = '/__aurora-desktop';
const COOKIE = 'aurora_desktop';

function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/**
 * Returns null when no token is set (a normal server), else a check that
 * returns null to let a request through or the response to send instead.
 */
export function createDesktopGuard({ token, port }) {
  if (!token) return null;
  const expected = Buffer.from(token);
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const matches = (value) => {
    const given = Buffer.from(value ?? '');
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  return function check(headers, url, { publicFile = false } = {}) {
    if (!allowedHosts.has(headers.host ?? '')) return { status: 403 };
    if (url.pathname === DESKTOP_ENTRY_PATH) {
      if (!matches(url.searchParams.get('token'))) return { status: 403 };
      // A page that moves on to "/" itself rather than a redirect: the window
      // arrives here from its splash screen, a different site, and a Strict
      // cookie isn't sent along a redirect from there. Replacing the entry
      // also keeps the token out of the history.
      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
          'cache-control': 'no-store',
        },
        body: '<!doctype html><script>location.replace("/")</script>',
      };
    }
    // The built client files are public anyway, and the browser fetches some
    // (the web manifest) without cookies.
    if (publicFile) return null;
    return matches(readCookie(headers.cookie, COOKIE)) ? null : { status: 403 };
  };
}
