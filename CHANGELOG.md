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

## [1.8.2](https://github.com/Get-Coral/aurora/compare/v1.8.1...v1.8.2) (2026-04-19)


### Bug Fixes

* allow season switching ([26a3487](https://github.com/Get-Coral/aurora/commit/26a34878c70cb807ec033cb5e39a4c453df044bb))

## [1.8.1](https://github.com/Get-Coral/aurora/compare/v1.8.0...v1.8.1) (2026-04-19)


### Bug Fixes

* allow search from every page ([57dc1ee](https://github.com/Get-Coral/aurora/commit/57dc1eef4fbd396c3b4374c1661c8ef8929195bf))

## [1.8.0](https://github.com/Get-Coral/aurora/compare/v1.7.0...v1.8.0) (2026-04-19)


### Features

* add User switching ([c2c7a33](https://github.com/Get-Coral/aurora/commit/c2c7a33e79a16996cbc354eb803f6c22860d1c42))
* allow user switching ([c580308](https://github.com/Get-Coral/aurora/commit/c58030870239860442f53a9de2ac3f1d6b8bea38))
* implement user images and profiles ([3362539](https://github.com/Get-Coral/aurora/commit/33625398c21a27ce2470b201020372f4475fe758))
* update Jellyfin dependency to version 1.6.2 and implement profile management features ([e40a4b5](https://github.com/Get-Coral/aurora/commit/e40a4b528d814e278b6eff5c068e527ef7ccd058))


### Bug Fixes

* remove image upload ([da91bf5](https://github.com/Get-Coral/aurora/commit/da91bf5d60a0ac6262713f605eb856509a4b2348))

## [1.7.0](https://github.com/Get-Coral/aurora/compare/v1.6.0...v1.7.0) (2026-04-15)


### Features

* add quality selector ([98af33f](https://github.com/Get-Coral/aurora/commit/98af33f938a2925d690897e39042a8d2877ac2c9))
* enhance jellyfin stream proxy with path validation and HLS manifest rewriting ([adf4a46](https://github.com/Get-Coral/aurora/commit/adf4a462ef4b0003ebffba1d456747b6f64c54af))


### Bug Fixes

* linting ([5df9c44](https://github.com/Get-Coral/aurora/commit/5df9c447996c903c978bacf27a5cc50fa8ad7a8d))
* make loading faster for Safari / HLS ([a318a0d](https://github.com/Get-Coral/aurora/commit/a318a0d3ea4950527278281388ae5a70c21aac0a))

## [1.6.0](https://github.com/Get-Coral/aurora/compare/v1.5.0...v1.6.0) (2026-04-14)


### Features

* enhance subtitle functionality with RAF sync and offset adjustments ([c72f626](https://github.com/Get-Coral/aurora/commit/c72f626e1a41e6e6bd1a08af6291c862bfb657ad))
* implement jellyfin stream proxy for secure URL handling and playback session management ([2a9d447](https://github.com/Get-Coral/aurora/commit/2a9d44768d87c90043cf68807e0797a7d7b460da))
* improve streaming mode and params + scrubbing behaviour ([9b67e07](https://github.com/Get-Coral/aurora/commit/9b67e07634cf5115990b9eff6332217cb09ee913))


### Bug Fixes

* improve service worker installation by handling individual asset failures ([3ad2fea](https://github.com/Get-Coral/aurora/commit/3ad2feadb9792eb6ce8c5bf2af1557f47f56adcd))

## [1.5.0](https://github.com/Get-Coral/aurora/compare/v1.4.1...v1.5.0) (2026-04-13)


### Features

* cache images ([4a86660](https://github.com/Get-Coral/aurora/commit/4a8666054e05159a417b987b795d91f2768ba7cd))
* implement graceful shutdown and connection management for the server ([a406081](https://github.com/Get-Coral/aurora/commit/a406081e2a4fbcc4336dd2004f63ecbea8c52803))
* proxy images through API ([4c66b85](https://github.com/Get-Coral/aurora/commit/4c66b858569d71fe517b767fd66a46f55eb09c1e))


### Bug Fixes

* remove unnecessary type assertion in jellyfin-image route ([836a8da](https://github.com/Get-Coral/aurora/commit/836a8da540b9de609e763b7e99ce3f4bb3f2defb))
* use global defaults ([261671a](https://github.com/Get-Coral/aurora/commit/261671abe8bea588796a39e41641ce3d48567c04))
* use global defaults ([1208152](https://github.com/Get-Coral/aurora/commit/1208152ac8e5ca59dc2cc04a3c525f287bfb0d73))

## [1.4.1](https://github.com/Get-Coral/aurora/compare/v1.4.0...v1.4.1) (2026-04-12)


### Bug Fixes

* update Docker publish workflow integration ([371fbf2](https://github.com/Get-Coral/aurora/commit/371fbf20aa89fc107d4036767692c7a80e31d49f))
* use @get-coral/jellyfin instead of local ([de1868c](https://github.com/Get-Coral/aurora/commit/de1868c101a5637074a5c5ccfd414bf93a0836ec))
* use @get-coral/jellyfin instead of local ([ecb6da3](https://github.com/Get-Coral/aurora/commit/ecb6da394cef434dbcb85f28cd3f9db7314e9198))

## [1.4.0](https://github.com/ElianCodes/aurora-ui/compare/v1.3.0...v1.4.0) (2026-04-08)


### Features

* add IOS app ([f24dbcb](https://github.com/ElianCodes/aurora-ui/commit/f24dbcb0eb4de65510aeab0e78af937d8bcc7ff5))
* add IOS app ([079838a](https://github.com/ElianCodes/aurora-ui/commit/079838a8d81325de7c6264852dc3fac1782783cf))
* improve player behaviour ([d575362](https://github.com/ElianCodes/aurora-ui/commit/d57536250107ddfe24469eee40098514bee98ef3))
* improve player behaviour ([aebf546](https://github.com/ElianCodes/aurora-ui/commit/aebf546391ec5f8feccbb8230afaecf10731d60a))


### Bug Fixes

* center align footer elements and adjust setup shell styling for better UX ([8e91e9b](https://github.com/ElianCodes/aurora-ui/commit/8e91e9b6919853f222f1bf11668ac112ec32c1d5))
* enhance standalone mode detection for Capacitor ([96aebb4](https://github.com/ElianCodes/aurora-ui/commit/96aebb4a54cc1a318f837c0cff6b013e0354e442))
* improve filtering & genres ([119795a](https://github.com/ElianCodes/aurora-ui/commit/119795a292252e773a035f31e39bf8b10ab5ac18))
* update player bounds ([b428cef](https://github.com/ElianCodes/aurora-ui/commit/b428cefe926393af4c776cc063b0e56b9e69196a))
* update safe header ([bf4b1b8](https://github.com/ElianCodes/aurora-ui/commit/bf4b1b8dbec98bc653691d40fd662ba50e89f0ec))

## [1.3.0](https://github.com/ElianCodes/aurora-ui/compare/v1.2.0...v1.3.0) (2026-04-06)


### Features

* add "open bug report" button ([f0f2179](https://github.com/ElianCodes/aurora-ui/commit/f0f21791cb8ef39db4986fa988b4611a0f0ebbb0))
* add Admin screen ([d18f841](https://github.com/ElianCodes/aurora-ui/commit/d18f841b30d548ad088dbe45cb457a3c507c2563))
* add Service Worker ([3c99f3a](https://github.com/ElianCodes/aurora-ui/commit/3c99f3ab3774a1dadc6fe7bfd7b6cdcfd05c5ccd))
* add user & library manager ([0d10ab1](https://github.com/ElianCodes/aurora-ui/commit/0d10ab16833952a2dc765d865430f1728c148e63))
* allow back-button use in Android devices ([8b1d9af](https://github.com/ElianCodes/aurora-ui/commit/8b1d9af6b707444134e28780ba7d75a30f87360d))
* allow clicks in menu for mobile ([327792d](https://github.com/ElianCodes/aurora-ui/commit/327792d97a245cd4a36034d53d12ad1669e70ec3))
* enable prerendering ([6c14b79](https://github.com/ElianCodes/aurora-ui/commit/6c14b79b550c1c93c47f633d13f25c6fc8c2b69c))
* improve setup system ([cd602b0](https://github.com/ElianCodes/aurora-ui/commit/cd602b06476a12185073ff86d111d0d6e1e8a047))
* improve styling for TV navigation ([e0be1a7](https://github.com/ElianCodes/aurora-ui/commit/e0be1a7b3b887bf0dc8592053aec1c5ebb51bfb8))
* **native:** add local capacitor app runtime ([641157b](https://github.com/ElianCodes/aurora-ui/commit/641157b3f1111e7e3f620caea600ba780cb0556a))
* serve app over http ([adbea48](https://github.com/ElianCodes/aurora-ui/commit/adbea48ae51c7e051ab0713816fa1a11a8b362c3))
* update runtime for admin panel ([7734444](https://github.com/ElianCodes/aurora-ui/commit/7734444abcb6bb8ce29ca169066dfaa6f2c3786b))
* update small cards on homepage ([b17338d](https://github.com/ElianCodes/aurora-ui/commit/b17338d999427950f220937f272c2484e4bcae32))


### Bug Fixes

* disable PWA status header in dev ([c6a8458](https://github.com/ElianCodes/aurora-ui/commit/c6a8458b866ea13ac74070356c11d7d47a8f485b))
* empty spaces in library ([61e1844](https://github.com/ElianCodes/aurora-ui/commit/61e18444b7ed01005ef68b8bf9f28ffd0a2dd021))
* hide header on setup ([c5d367f](https://github.com/ElianCodes/aurora-ui/commit/c5d367f44585f1c48630b3873d53185239f1a87c))
* hide resume now in mobile & tablet devices ([861da41](https://github.com/ElianCodes/aurora-ui/commit/861da41e20229ac7f57a2571cf4b6884712e7078))
* improve behaviour on mobile for movie detail cards ([9990b21](https://github.com/ElianCodes/aurora-ui/commit/9990b2109866c0709f61db2fe7fd405780417722))
* improve header on Mobile ([919263e](https://github.com/ElianCodes/aurora-ui/commit/919263ead2b74004d4fda92dc47f9fe3a5adfe55))
* route not bahaving correctly ([016d5f1](https://github.com/ElianCodes/aurora-ui/commit/016d5f1335f5deb7119d4141c870bb5283ce85d5))
* update styling for mobile ([a765278](https://github.com/ElianCodes/aurora-ui/commit/a765278c8a344a258de3ec0d0a55e40276977023))

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
