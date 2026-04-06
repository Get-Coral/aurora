# Changelog

## Unreleased

### Features

* add real local Capacitor build flow for Android and iOS
* emit a Capacitor-compatible SPA shell at `dist/client/index.html`
* move native runtime browsing flows off server functions for local app usage
* add Android hardware back handling for fullscreen, overlays, and route navigation
* rotate the home spotlight insight card through queue, favorites, and recent-arrival reasons

### Bug Fixes

* make mobile media details use a full-page scrollable sheet instead of a cramped modal
* hide the hero continue-watching side panel on tablet and mobile widths
* add the missing `mobile-web-app-capable` meta tag
* make `pnpm cap:run:android` prefer a valid JDK 21 path on macOS

### CI

* validate Capacitor sync and Android debug assembly in GitHub Actions using Java 21

### Documentation

* document Android back handling, Java 21 requirements, and native Android debug assembly

## [1.2.0](https://github.com/ElianCodes/aurora-ui/compare/v1.1.0...v1.2.0) (2026-04-05)


### Features

* add ambient mode ([2d5f7cc](https://github.com/ElianCodes/aurora-ui/commit/2d5f7cc9ae3240b5af0259a7d3b6c1fb35071f2c))
* add collection CRUD ([0bc6d74](https://github.com/ElianCodes/aurora-ui/commit/0bc6d740d173a5696c45d365c9ecf8dfafdfe473))
* add history and collections ([201d7f3](https://github.com/ElianCodes/aurora-ui/commit/201d7f3f412fa513577674edba3e4143863795bd))
* add TV mode toggle ([eeb94b2](https://github.com/ElianCodes/aurora-ui/commit/eeb94b2acfeda029b05ced3e1cac2f9d77e08e84))
* add watched status ([fbf844f](https://github.com/ElianCodes/aurora-ui/commit/fbf844f895a10301456eaa691f28a7c95a6f5beb))
* clean up homepage on TV mode ([c88d10f](https://github.com/ElianCodes/aurora-ui/commit/c88d10f968da93d127786acd6a4d665d2f81eb03))
* hide footer on TV mode ([219cab3](https://github.com/ElianCodes/aurora-ui/commit/219cab32bfb2722159a972daba57ac85a25a4b9e))
* improve TV mode ([6df90ac](https://github.com/ElianCodes/aurora-ui/commit/6df90acdff22f54a7fc8c5c3d190553e49e3b49b))
* make new render route for TVMode ([dfd945f](https://github.com/ElianCodes/aurora-ui/commit/dfd945f2ed1015648b0d03982e42cb07ec87359c))
* update collection UI ([9f6ad8a](https://github.com/ElianCodes/aurora-ui/commit/9f6ad8a8a02a8f8626e996eafed3dc48bcbabf70))
* update Episode selector UI ([5bc600b](https://github.com/ElianCodes/aurora-ui/commit/5bc600bcfc99773d858acce9b2d383be95c85524))


### Bug Fixes

* make selects better ([c6339d7](https://github.com/ElianCodes/aurora-ui/commit/c6339d725bb67186a483a1a9f537656640a9ed11))
* make text smooth transition ([3500946](https://github.com/ElianCodes/aurora-ui/commit/3500946d11d8a94bda36337788322665eb539ebf))
* make the ambient mode more ease in ([37a859c](https://github.com/ElianCodes/aurora-ui/commit/37a859cb45e1bfac5187ba1837a7171942ecc5f4))
* update animation style ([db05789](https://github.com/ElianCodes/aurora-ui/commit/db05789ed43b82f23d31602bb492c3741adb3829))
* update styling for non-tv mode ([7fb0e5f](https://github.com/ElianCodes/aurora-ui/commit/7fb0e5ff5ea27333de061d55cbd6c0d5df16f835))
* update watch state on modal close ([3f08d54](https://github.com/ElianCodes/aurora-ui/commit/3f08d54d47d9915237e20e4b60233a24c5d2acd4))

## [1.1.0](https://github.com/ElianCodes/aurora-ui/compare/v1.0.0...v1.1.0) (2026-04-05)


### Features

* add settings page ([0c4e7ae](https://github.com/ElianCodes/aurora-ui/commit/0c4e7aeb48896d3fb43a6f42c8845c03ac6cc2ca))
* add subtitle support ([b1a2484](https://github.com/ElianCodes/aurora-ui/commit/b1a2484ea87f4ee4334088c8ef88b1741eff5b0e))
* allow subtitles from opensubtitles ([b8a89bd](https://github.com/ElianCodes/aurora-ui/commit/b8a89bd10cf980d972fea7f448117f5b9873e1a3))
* do inifinite scrolling instead of pages ([a3276fd](https://github.com/ElianCodes/aurora-ui/commit/a3276fd69e065df48b2692cc4cb937c6309f2195))
* update Player UI ([eaac5c9](https://github.com/ElianCodes/aurora-ui/commit/eaac5c9a7c30892956b669e134f8e157ebe6e6f6))
* use Username in header ([3717a35](https://github.com/ElianCodes/aurora-ui/commit/3717a352d41ccceae9cedd4b8c66712361153da0))


### Bug Fixes

* add next episode button ([e370f83](https://github.com/ElianCodes/aurora-ui/commit/e370f8317e490aa13148920bfa03363f8108decf))
* allow old codex ([222c68e](https://github.com/ElianCodes/aurora-ui/commit/222c68ee5a714cdedec0e989c0dbfc120448c42a))
* correct episodes on shows ([51fcae6](https://github.com/ElianCodes/aurora-ui/commit/51fcae65bcb3d21a7782afdd75e73485620374ac))
* disable autoplay ([ca11a1c](https://github.com/ElianCodes/aurora-ui/commit/ca11a1ca4b478ed6b0f26f27448f19c96703b592))
* seed duration in progress bar ([514c75f](https://github.com/ElianCodes/aurora-ui/commit/514c75f5c8117688f651aa0cefc4530a0b001640))
* stop scrolling body when modal is open ([c4aaf19](https://github.com/ElianCodes/aurora-ui/commit/c4aaf196372020f9a931fa8eada4b85029ce6765))
* update buttons ([470d3a9](https://github.com/ElianCodes/aurora-ui/commit/470d3a9b4a41079c41f6d4f394b961e659059bcd))

## 1.0.0 (2026-04-05)


### Features

* add "My List" ([9059245](https://github.com/ElianCodes/aurora-ui/commit/9059245ba8af7011828b491caa79899487e6e899))
* add details tab ([c4a15b9](https://github.com/ElianCodes/aurora-ui/commit/c4a15b9ce3d63fe5b5a4e4c89d7cc575558774c4))
* add directional sorter ([8650310](https://github.com/ElianCodes/aurora-ui/commit/865031045e88f149be23e856777fc7bf5363cf80))
* add Docker ([e7b5380](https://github.com/ElianCodes/aurora-ui/commit/e7b53807a8697f5a363b9ce39954d302e4424f63))
* add error pages ([fa40956](https://github.com/ElianCodes/aurora-ui/commit/fa4095692e1e18d8675ff2ecb27fa92bcdbc521e))
* add movie & series tabs ([f3bf8b7](https://github.com/ElianCodes/aurora-ui/commit/f3bf8b751cd3ef33534377209deba78463480e6c))
* add new local first workflow ([7a0fdba](https://github.com/ElianCodes/aurora-ui/commit/7a0fdba922ebd045aa1891b51203b3d28f6abe60))
* add prefetch to media rendering ([3a1ab91](https://github.com/ElianCodes/aurora-ui/commit/3a1ab9105639a402044d0a97972c718cbc3b1b9e))
* add prototype ([4edfe48](https://github.com/ElianCodes/aurora-ui/commit/4edfe4817c075b024ee19acb74a3aa2560fc0036))
* add release please ([bc371a1](https://github.com/ElianCodes/aurora-ui/commit/bc371a1820147faeee50778822ee2891a60cc6c0))
* implement i18n system ([c066b7d](https://github.com/ElianCodes/aurora-ui/commit/c066b7d9dcd9201d67499c11fb8b6ff6e49ffc36))
* improve i18n system ([1a043ca](https://github.com/ElianCodes/aurora-ui/commit/1a043ca83a0061916713c7b1f2664b4826c45cc4))
* sync playback sessions ([7a43e2c](https://github.com/ElianCodes/aurora-ui/commit/7a43e2c8affbfc2cfbc5e79dc1ee5c4c717932a0))
* update datafetching ([7ff5603](https://github.com/ElianCodes/aurora-ui/commit/7ff5603e516905be6c887a1abd95daa2c564a909))
* update footer and homepage ([6f4c391](https://github.com/ElianCodes/aurora-ui/commit/6f4c39173d57a02390b96aee027700ffc59ada29))


### Bug Fixes

* add package name & update packages ([2bd582f](https://github.com/ElianCodes/aurora-ui/commit/2bd582f855dbc3d111f59280ac16afb98b1d79c5))
* make genre buttons work ([4a8c54e](https://github.com/ElianCodes/aurora-ui/commit/4a8c54eb00f20f6051f94a1a7f5aa067f18e6742))
* update padding on card-copy ([5c90f28](https://github.com/ElianCodes/aurora-ui/commit/5c90f285573d1092f00688554b5153442944bcf5))
* update server ([58338e4](https://github.com/ElianCodes/aurora-ui/commit/58338e4eb942ab97daf9445c8af641e31913396a))
* wrap buttons ([aeb2308](https://github.com/ElianCodes/aurora-ui/commit/aeb23081fc844a77b6e3f57843695de5a71f18f2))
