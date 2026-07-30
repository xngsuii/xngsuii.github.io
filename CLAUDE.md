# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-page personal "home" site (Korean: 갠홈) — a static HTML/CSS/JS app with no build step, deployed via GitHub Pages at `https://xngsuii.github.io/`. Data (profile, cards, pair posts, archive, images) lives in Firestore instead of localStorage, so edits persist across reloads, browsers, and devices; only the admin account (Firebase Authentication) can write.

There is no package.json, no bundler, and no test runner — the site is plain files served as-is.

## Commands

There is no build/lint/test tooling in this repo. To preview locally:

```
py -m http.server 8790
```

then open `http://localhost:8790/`. Serve over HTTP (not `file://`) — the app loads `js/firebase-store.js` as an ES module and needs a real origin for Firebase Auth persistence and CORS.

There are no automated tests. Verify changes by loading the page in a browser and checking the browser console for errors — do this before committing (see Workflow notes below).

## Architecture

**File layout** — everything is hand-split from what used to be one monolithic HTML file:
- `index.html` — markup only
- `css/style.css` — all styles
- `js/main.js` — UI logic and rendering (view switching, cards, pair posts, archive, image adjuster widget, rich-text editing)
- `js/firebase-store.js` — the persistence layer (see below)
- `js/firebase-config.js` — Firebase project config + `ADMIN_UID` (safe to be public; not a secret — see Security model)
- `firestore.rules` — Firestore security rules (read: public, write: admin UID only); must be pasted into the Firebase console manually, this repo file is not auto-deployed

**Storage adapter contract** — `main.js` never talks to Firestore directly. It only calls `storageGet(key, fallback)` / `storageSet(key, value)` (defined in `main.js`, thin wrappers around `window.SiteStore`). All Firestore-specific behavior (chunking, image extraction, debouncing) lives entirely in `firebase-store.js` behind that same `get`/`set` shape. When adding a new piece of persisted state, add its key to `SCALAR_KEYS` (single doc field) or `LIST_KEYS` (one Firestore doc per array item, keyed by `item.id`) in `firebase-store.js` — don't invent a new storage path in `main.js`.

**Why data is split across documents** — Firestore caps documents at 1 MiB. `cards`, `pairPosts`, and `archive` are arrays that could grow large, so each array item is stored as its own document under `site/main/<key>/<id>` instead of one big array field. Small scalar fields (`profile`, `siteName`, `homeIntro`, `homeBanner`, `archiveSeqCounter`) live together in the single `site/main` doc.

**Image/blob handling** — Images are still authored as data URLs in `main.js` (via `fileToDataUrl`, which now actually calls `SiteStore.compressImage` — resizes to a max dimension and re-encodes as JPEG/PNG under a target size). Before any save, `firebase-store.js` walks the value (including `data:` URLs embedded inside rich-text HTML fields) and pulls each one out into `site/main/blobs/<sha256>`, replacing it in place with a `blob://<hash>` reference; large blobs are split into `parts` sub-documents to stay under the size cap. On load, references are inflated back into real data URLs before `main.js` ever sees the data — the UI layer is unaware this happens. Same-hash images are automatically deduplicated. Unreferenced blobs are garbage-collected after a full load completes (only when logged in as admin, and only if there are no unsaved local changes — see `collectGarbage`).

**Thumbnail rendering** — stored images are ~800–1800px, but most places display them at 60–430px. Drawing a 830px source into a 124px box makes Chrome downscale ~7x in one pass, which visibly aliases ("계단 현상"). `downscaleThumb`/`applyThumbBg` in `main.js` build a **display-only** variant by halving on a canvas until close to the target, cached per (source, 64px bucket); the target is `display width × devicePixelRatio × 1.25`, and sources that aren't at least 1.25x larger than that are left alone. `state` always keeps the original, so full-size views and the zoom/pan adjuster are unaffected. If thumbnails still look rough, fix the downscale path — **do not raise `compressImage`'s `maxDim`**, which only inflates storage and makes the ratio worse. Callers pass a fixed `boxPx` for fixed-size boxes and omit it to have the element measured (with a short retry, since hidden views report width 0). Note `requestAnimationFrame` never fires in a background tab, so this code deliberately uses `setTimeout` to wait for layout.

**Responsive layout** — the site was desktop-only until responsive support was added; all of it lives in `@media` blocks at the **end of `css/style.css`**, plus a handful of existing `:hover` rules wrapped in `@media (hover:hover)` inline. Two breakpoints: `769–1100px` (tablet — releases the 16:9 letterbox, keeps the sidebar) and `≤768px` (phone). **Nothing applies above 1100px, so the PC design is untouched** — when changing layout, verify at 1920×1080 that `.pd-tab-content` is still `580px`, `.pd-info-grid` `margin-top:10px`, and the pd-modal `720px` wide with the index tabs to its left.

Phone-specific structure worth knowing before editing:
- `.app-window` flips to `flex-direction:column`, which turns the left/right punch-hole margins into top/bottom strips with no markup change. Height is `100vh` then `100dvh` (the second line is the iOS address-bar fix; keep both).
- The sidebar becomes a fixed off-canvas drawer toggled by `#mobileMenuBtn`. z-index order is deliberate: ☰ `56` > backdrop `55`, both < drawer `60` < `.modal-overlay` `100`, so the drawer never covers a modal and the ☰ never covers the drawer.
- The `.pd-index-tabs` (INFO/GALLERY/LOG) can't stay at `right:100%` on a phone, so `.pd-modal-wrap` becomes a column and they render as a horizontal strip **below** the modal. On tablet they stay on the left, which is why `.pd-modal` there is `min(720px, calc(100vw - 168px))` — the tabs are drawn outside a centered modal, so the modal must be narrower than `viewport - 2 × tab width` or they slide off-screen.
- **`galleryPerPage()` in `main.js` must stay in sync with `.gallery-grid`'s column count in CSS**: 15 (5 cols) desktop, 9 (3 cols) phone, 6 on phones under 720px tall. Row count is implicit, so only the JS number changes between the last two. `initResponsiveWatch()` re-renders on breakpoint change.

**Touch input** — HTML5 drag-and-drop does not fire on touch at all, and four features depend on it (card order, profile meta rows, gallery thumbnails, folder-tab drops). Rather than rewrite them, `initTouchDrag()` in `main.js` is one delegated `pointerdown` listener that long-presses (400 ms) any `[draggable="true"]` element and then **dispatches `MouseEvent`s named `dragstart`/`dragover`/`dragleave`/`drop`/`dragend`** at the right targets. The existing handlers are plain listeners, so they run unchanged — including the gallery's dwell-on-arrow page flip. If you add a new drag site, just set `draggable="true"` and it works; don't add touch code. Elements inside `[contenteditable="true"]` are skipped so iOS text selection still works. Wheel-only interactions (Home page flip, gallery paging) got touch equivalents too: swipe handlers plus tappable `︽`/`︾` arrows (`pointer-events` is opened up on phones only — their tap padding is horizontal-only so it can't cover the first thumbnail row).

**Write batching** — `main.js` calls `storageSet` very frequently (e.g. on every `input` blur). `firebase-store.js` debounces actual Firestore writes (~1.2s), diffs against the last-saved JSON per document so unchanged items aren't rewritten, and only marks a change as "saved" after the write actually succeeds (a failed write keeps the key `dirty` and retries automatically) — this was a deliberate fix for a bug where failures were recorded as successes and silently dropped edits.

**Save-state visibility** — `SiteStore.onSaveState(cb)` fires `'saving' | 'saved' | 'error'`; `main.js` renders this as a fixed indicator (bottom-right) via `initSaveIndicator()`. Don't reintroduce silent failure here — if you touch the flush/retry logic in `firebase-store.js`, make sure errors still propagate to this indicator rather than only `console.error`.

**Auth model** — Firebase Authentication (email/password), not the old hardcoded `CREDENTIALS` object (removed). `window.SiteStore.isAdmin` is true only when the signed-in user's UID matches `ADMIN_UID` from `firebase-config.js`; the client-side check is a convenience, the Firestore security rules in `firestore.rules` are the actual enforcement point. `js/main.js`'s login modal collects an email (not a username) — see `loginErrorMessage()` for the mapping from Firebase auth error codes to Korean UI messages if you need to add a new one (e.g. new failure codes from console changes like unauthorized domain).

**GitHub Pages deployment** — this repo must be named exactly `xngsuii.github.io` to serve from the domain root (user site, not project site); renaming it changes the site URL, and Firebase's authorized-domains list (console → Authentication → Settings) must contain whatever domain the site is actually served from or login will fail with `auth/unauthorized-domain`.

## Terminology

The user may refer to the two UI states by their badge labels:
- **LOCKED** = 보기 모드 (view mode) — visitor state, nothing editable
- **UNLOCKED** = 편집 모드 (edit mode) — admin signed in, `body.logged-in` is set and `[data-editonly]` controls appear

## Cache busting

`index.html` references its assets with a version query — `css/style.css?v=N`, `js/main.js?v=N`, `js/firebase-store.js?v=N` (and `firebase-store.js` imports `./firebase-config.js?v=N`). **Bump every one of those `N`s together whenever you change a CSS or JS file.** GitHub Pages serves the HTML with a short cache but assets with a long one, so without a bump a returning visitor gets new HTML with stale JS — and since `main.js` wires up elements at top level, a mismatch used to kill the whole script. The top-level init blocks now bail out politely when their elements are missing, but that only degrades gracefully; it does not make the page correct. The version bump is the actual fix.

## Workflow notes

- **Do not commit without testing first, and confirm with the user before committing.** Since there's no automated test suite, "testing" means actually loading the page (local server or the live site) and exercising the change in a browser — check the console for errors and confirm the save indicator behaves correctly for anything touching storage.
- **When a change touches color** (CSS colors, inline styles, color pickers, theme variables in `:root`), always print the affected HTML color codes (hex/rgba) in the response, not just describe the color.
