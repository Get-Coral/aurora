# Meta Horizon Store listing: Aurora Cinema

Everything for the store listing of the Quest app (app ID `1402783709591721`). Text goes into the
dashboard's submission form by hand; images are uploaded from `images/`.

## Text

| Field | English | Dutch |
|---|---|---|
| Name | [`en-US/title.txt`](en-US/title.txt) | [`nl-NL/title.txt`](nl-NL/title.txt) |
| Short description | [`en-US/short_description.txt`](en-US/short_description.txt) | [`nl-NL/short_description.txt`](nl-NL/short_description.txt) |
| Long description | [`en-US/full_description.txt`](en-US/full_description.txt) | [`nl-NL/full_description.txt`](nl-NL/full_description.txt) |

## Images

Made by [`scripts/quest/store_assets.py`](../../scripts/quest/store_assets.py) from the theater's
own environments, with film frames from the public Jellyfin demo server (public domain and Creative
Commons; see [`images/CREDITS.md`](images/CREDITS.md)). Run it again after re-rendering an
environment.

| Dashboard asset | File | Size |
|---|---|---|
| Hero | `images/hero.png` | 3000 × 900 |
| Cover landscape | `images/cover_landscape.png` | 2560 × 1440 |
| Cover square | `images/cover_square.png` | 1440 × 1440 |
| Cover portrait | `images/cover_portrait.png` | 1008 × 1440 |
| Mini landscape | `images/mini_landscape.png` | 1080 × 360 |
| Icon | `images/icon.png` | 512 × 512 |
| Logo (transparent) | `images/logo.png` | wordmark |
| Screenshots | `images/screenshot_*.png` | 2560 × 1440 |

## Other submission fields

| Field | Answer |
|---|---|
| Type | App |
| Category | Entertainment (media and video) |
| Price | Free |
| In-app purchases, ads | None |
| Comfort rating | Comfortable: seated or standing, no artificial movement |
| Play area / modes | Sitting, standing |
| Player modes | Single user |
| Input | Touch controllers, hand tracking |
| Internet | Required: connects to the viewer's own Jellyfin server or IPTV provider |
| Languages | English, Dutch |
| Website | https://github.com/Get-Coral/aurora |
| Support | aurora@getcoral.dev, https://github.com/Get-Coral/aurora/issues |
| Privacy policy | https://getcoral.dev/apps/aurora/privacy (source: [`docs/privacy-policy.md`](../../docs/privacy-policy.md)) |
| Data use | No data collected by the developer: no accounts, analytics, ads or tracking. Server and IPTV logins are stored on the device only. |

### Age rating (IARC questionnaire)

Aurora Cinema ships no content of its own: everything comes from the viewer's own Jellyfin server or
IPTV provider. Answer the questionnaire for the app itself (no violence, language and so on), and
answer **yes** where it asks whether users can reach unrestricted online content or media. That adds
the usual "unrestricted internet" descriptor.

## Builds

Upload with Meta's `ovr-platform-util` (see the Quest section of the main README). The Quest build
is signed with its own upload key, separate from the Play Store's.
