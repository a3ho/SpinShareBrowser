# Journal - glm (Part 1)

> AI development session journal
> Started: 2026-10-23

---



## Session 1: Introduce Trellis and build GLM deep knowledge base
<!-- trellis-session: v=2 fp=99988cc356069d09 -->

**Date**: 2026-10-23
**Task**: Introduce Trellis and build GLM deep knowledge base
**Branch**: `main`

### Summary

trellis init (--zcode, developer glm); rewrote bootstrap task into GLM deep-knowledge task; authored 21-file layered spec library under .trellis/spec/ (backend/frontend/release/guides) from the 2026-10-23 full source read; AGENTS.md became session entry with local-verification discipline (CI quota exhausted); all 151 python + 12 JS suites green; committed locally without push

### Git Commits

| Hash | Message |
|------|---------|
| `a780487` | chore: introduce Trellis harness and GLM knowledge base |
| `2783425` | chore(task): archive 00-bootstrap-guidelines |

### Testing

- [OK] python -m unittest discover -s tests -p 'test_*.py' (151 OK); all 12 node test_*.cjs suites pass

### Status

[OK] **Completed**

### Next Steps

- Next feature/fix work should run through task.py create; remember trellis-bridge plugin is optional for hook injection


## Session 2: Add header-player volume control
<!-- trellis-session: v=2 fp=c9a502a764baf2cd -->

**Date**: 2026-10-23
**Task**: Add header-player volume control
**Branch**: `main`

### Summary

Designed and shipped the player volume control end to end: quiet speaker button + anchored slider popover in the app's anchored-overlay language, wheel/mute/keyboard interactions, config persistence via new /v1/player-volume, drag-region exclusion budget 5->6, full a11y, 154 py + 12 JS suites green, verified live against an isolated instance including reload-restore and popover geometry

### Git Commits

| Hash | Message |
|------|---------|
| `5e7191d` | feat: add volume control to the header player |

### Testing

- [OK] python -m unittest discover (154 OK); all 12 node test_*.cjs suites; live browser verification

### Status

[OK] **Completed**

### Next Steps

- Release task: bump to 2.2.0 per release/index.md checklist, fold in release-notes-draft.md


## Session 3: Volume feature accepted by user
<!-- trellis-session: v=2 fp=c37f28b96700a03b -->

**Date**: 2026-10-23
**Task**: Volume feature accepted by user
**Branch**: `main`

### Summary

User accepted the header-player volume control after live review. Demo instance shut down cleanly, temp state removed. Feature awaits release as 2.2.0 (draft changelog entry in .trellis/tasks/archive/2026-10/10-23-player-volume/release-notes-draft.md).

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 4: SpinShare user-system research
<!-- trellis-session: v=2 fp=38d3f9a584f0902d -->

**Date**: 2026-10-23
**Task**: SpinShare user-system research
**Branch**: `main`

### Summary

Researched whether SpinShare Browser can integrate the SpinShare user system. Verdict: Connect API (token via 6-digit code) is third-party-friendly but gated behind a privately approved ConnectApp ApiKey; reviews read/write fully feasible once approved; playlists read-only (write endpoint broken server-side); favorites do not exist in SpinShare at all; upload/settings are website-only. Report + external spec layer added; no product code touched.

### Git Commits

| Hash | Message |
|------|---------|
| `6bf8560` | docs: research SpinShare user-system integration feasibility |
| `de2a50f` | chore(task): archive 10-23-user-system-research |

### Testing

- [OK] 154 python tests OK (no code changes)

### Status

[OK] **Completed**

### Next Steps

- If user obtains a ConnectApp ApiKey via SpinShare Discord, implement per report section 5 sketch

---

## Session 5: Session-channel roadmap + frontend build pipeline (phase 1/8)

**Date**: 2026-10-23
**Task**: 10-23-frontend-build-pipeline (+ roadmap decomposition for 8-phase session-client blueprint)
**Branch**: `main`

### Summary

User rulings absorbed: favorites==Playlists, session channel is permanent (assume Connect API never fixed), frontend UX is the top priority (memory + AGENTS.md section added). Decomposed the full-client blueprint into 8 Trellis tasks with complete PRDs (frontend-UX gate baked into every UI task). Implemented phase 1: web/ four-file runtime inline assembly replaced by modular sources web/src (25 JS modules + 13 CSS layers) assembled by zero-dependency scripts/build_web.py into the same signed-in artifacts (banner + byte-identical concatenation; --check drift gate). Runtime contract unchanged (server still inlines five files into browser.html). build.py gains dynamic WEB_SRC_FILES glob; .gitignore whitelist opened for web/src. Cross-verified upstream master for the playlist form channel (create requires cover else silent no-op; add-song replace-set by array index; remove-song route is view-free) and recorded in external spec.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: modular web sources with build-time assembly (8-task roadmap PRDs included) |

### Testing

- [OK] splitter: byte-identical reassembly of app.js (3169 lines/25 modules) + interface.css (920/13)
- [OK] python -m unittest discover: 154 OK
- [OK] 12/12 node test_*.cjs
- [OK] build.py --qa: 111 source snapshot files incl. 38 web/src modules; installer built
- [OK] isolated instance E2E: real catalog sync, filter interaction, cards render; visual check PASS

### Status

[OK] **Completed**

### Next Steps

- Phase 2/8: session-client module (embedded login, DPAPI cookie store, form driver, serial write queue)

---

## Session 6: Session client module (phase 2/8)

**Date**: 2026-10-24
**Task**: 10-23-session-client
**Branch**: `main`

### Summary

Implemented the session channel foundation. src/session_client.py: DPAPI-encrypted session store (state/session.dat, entropy-pinned, cookie values never logged), urllib client replaying the login window's exact UA, stdlib HTMLParser contracts (form[_token] CSRF, playlist_N checkbox groups, login-page detection via /login URL or _username form, identity via user-actions /user/{id}/charts + public /api/user/{id}), serial WriteQueue (1.2s min gap, no auto-retry). desktop.py: runtime pywebview login window (spinsha.re/login, user types credentials on the real site incl. 2FA), watcher captures cookies via real CookieManager (HttpOnly included), verifies, clears shared-profile cookies, closes. Endpoints /v1/session/status|login|logout + bootstrap session block; settings-panel thin-slice UI (web/src/js/session.js, en/zh locales). 18 new contract tests (fake-site HTTP server, DPAPI roundtrip, queue spacing, endpoint gating).

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: spinsha.re session channel with login window and write queue |

### Testing

- [OK] tests.test_session_client: 18/18 (after fixing HTMLParser boolean-attribute bug and login-busy state leak caught by tests)
- [OK] full suite: 172 tests OK in 22.3s (Node 12/12)
- [OK] headless instance: status 200, login 409 session_window_unavailable, page embeds session bootstrap
- [OK] desktop instance E2E: login window opened real spinsha.re login page (computer-use verified), close-window cancel path reset loginActive; settings panel account section rendered (browser-use)
- Note: an earlier 10-min suite hang was environmental (concurrent desktop instance), documented in spec lessons

### Status

[OK] **Completed** (code side)

### Next Steps

- Owner-assisted final login E2E (real account): connect -> status shows username -> session.dat is DPAPI ciphertext -> disconnect clears
- Phase 3/8: playlists-favorites on top of submit_write + form driver

---

## Session 7: Session login E2E on production (owner-assisted) + three real bugs fixed

**Date**: 2026-10-24
**Task**: 10-23-session-client (final verification)
**Branch**: `main`

### Summary

Owner logged in on the real spinsha.re through the login window. Three production-only bugs surfaced and were fixed with regression tests: (1) pywebview 6.2.1 get_cookies() returns SimpleCookie objects, not cookiejar.Cookie — added normalize_webview_cookies(); (2) complete_login cleared login_active on every failed attempt, making the UI report "cancelled" while the watcher kept polling — now only success/cancel/disconnect clears it; (3) production templates differ from the open-source mirror (no user-actions/item-user markers) — identity now read from the login window's live DOM (aside /user/{id} links) and Python only resolves the username via the public API. Final state: auto-capture without re-login (shared WebView2 profile), status connected as 刘易手 (userId 1074), session.dat is DPAPI ciphertext with zero plaintext leak, and a fresh-process urllib replay of the stored session returns the signed-in production homepage — the whole write-channel foundation is proven against production (nginx, no Cloudflare interference).

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | fix: session capture against production (cookie shape, flag, DOM identity) |

### Testing

- [OK] tests.test_session_client 19/19; full suite 173 OK; Node 12/12
- [OK] real E2E: login -> connected true -> DPAPI ciphertext -> urllib replay authed -> window auto-closed

### Status

[OK] **Completed** — phase 2/8 fully closed including owner verification

### Next Steps

- Phase 3/8: playlists-favorites (design drafts to owner first); E2E state dir tmp/agent-e2e keeps the live session for phase-3 verification

---

## Session 8: Playlists & favorites (phase 3/8)

**Date**: 2026-10-24
**Task**: 10-23-playlists-favorites
**Branch**: `main`

### Summary

Full playlist read/write shipped on the session channel. src/playlists.py (create with generated pure-Python PNG cover + CSRF multipart + before/after diff verify; delete; replace-set membership with title-mapped checkbox indexes parsed from the song page overlay; zero-view-cost remove route). Local endpoints /v1/playlists(+/{id}, /create, /delete, /song). Frontend: top-bar entry (login-gated, drag-region excluded), my-playlists dialog (cover/title/count/open/two-step delete/create), per-card "add to playlist" metric button rendered after every render(), anchored picker popover (checkbox list + save + inline create with pre-check), playlist filter view chip integrated into rebuild. Production E2E on the owner's account: first add round exposed the checkbox-order trap (server overlay order is reverse of the API list order — writes landed in the wrong playlist; diff verification caught the misreport, account restored via the view-free remove route, mapping rewritten to titles with the trap reproduced in the fake-site test). Final E2E sequence passed completely: create 828 (real cover upload) -> add 15394+15392 -> remove 15394 -> delete 828; the owner's own playlist 827 untouched throughout. Also fixed: validateRuntimeConfig frozen projection dropped the session key; render()-time playlist button mounting; cjs extraction sandbox compat via typeof guard.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: playlist favorites over the session channel (read, create, delete, membership) |

### Testing

- [OK] tests.test_playlists.py 12/12 (stateful fake reproducing cover-required quirk + reversed-order trap); test_playlists.cjs 7/7
- [OK] full suite 185 OK; Node 13/13
- [OK] production E2E full sequence + account restoration verified via public API reads
- [OK] UI walkthrough: top-bar entry, dialog with live data, card buttons with accessible names, picker visual PASS (screenshot review)

### Status

[OK] **Completed**

### Next Steps

- Phase 4/8: playlist sync-to-game (diff-only installs through the transactional pipeline)

---

## Session 9: Playlist sync-to-game (phase 4/8)

**Date**: 2026-10-24
**Task**: 10-23-playlist-sync-install
**Branch**: `main`

### Summary

Shipped the differentiating feature: one-click playlist sync to the game. Frontend module playlist-sync.js: preview diff (playlist songs vs catalog coverage vs batch presence check via /v1/installations/check), then a serial install loop reusing the single-install machinery (startInstallation + installationPending + activity dock), 1.2s spacing between submissions, stop = no further submissions while the in-flight job is never killed (red line 9), per-song failure tolerance with end summary. Dialog states: preview/running/done; closing the dialog never aborts the loop. E2E on production with a sandboxed install directory (customDirectory + installDirectoryConfirmed in the isolated instance config): created a 2-song test playlist, sync preview correct (2 to install), both songs downloaded and installed through the real transactional pipeline (jobs complete, srtb files verified on disk), done-state dialog visual PASS; test playlist deleted and config restored afterwards.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: one-click playlist sync to game with preview and serial installs |

### Testing

- [OK] test_playlist_sync.cjs 4/4 (preview diff, serial order + spacing, stop semantics, directory gate)
- [OK] Node 14/14; full Python suite 185 OK
- [OK] production E2E with sandboxed target: 2 real installs, files verified, cleanup complete

### Status

[OK] **Completed**

### Next Steps

- Phase 5/8: reviews-write; phase 6 notifications; phase 7 home; phase 8 upload

---

## Session 10: Reviews write/delete (phase 5/8)

**Date**: 2026-10-24
**Task**: 10-23-reviews-write
**Branch**: `main`

### Summary

Review publishing over the session channel. src/reviews.py (post with before/after diff verification returning the new review id; delete with disappearance verification; 2000-char cap) + /v1/reviews/add|delete endpoints. Frontend reviews-write.js: compose section inside the per-card review drawer (recommend checkbox + textarea + post), local insertion on success (no full reload), own-review mode with badge and two-step delete removing the row locally, session-expiry handling, and an own-chart pre-block (production SongController silently ignores self-reviews — discovered live when the E2E on the owner's own chart returned post_unverified; guard added with a friendly message). Production E2E on chart 15394 (PRD sequence): post 22369 -> publicly visible via API -> delete -> gone.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: review publishing and deletion over the session channel |

### Testing

- [OK] tests.test_reviews.py 5/5 (stateful fake with the add-form quirk + self-review silent-ignore); test_reviews_write.cjs 5/5
- [OK] full suite 190 OK; Node 16/16
- [OK] production E2E post->verify->delete; compose-section visual walkthrough PASS (screenshot review)

### Status

[OK] **Completed**

### Next Steps

- Phase 6/8: notifications read/clear

---

## Session 11: Notifications (phase 6/8)

**Date**: 2026-10-24
**Task**: 10-23-notifications
**Branch**: `main`

### Summary

Notification reading and clearing over the session channel. src/notifications.py parses the authed homepage's notification dropdown (each item is one anchor that IS the clear route; the cover URL carries the song fileReference for jump resolution) with disappearance verification on clears. Endpoints GET /v1/notifications + POST clear/clear-all. Frontend: top-bar bell (login-gated, unread dot after first fetch), anchored popover fetching ONLY on open (no timers, red line), per-row jump (single-song focus reusing the playlist filter machinery) and clear, clear-all. Production E2E: fetch (0 items), clear-all no-op, UI walkthrough with live empty state. A chained-edit-script failure silently dropped the manifest and locale wiring (missing key broke the startup chain and hid the bell); diagnosed from the page state and completed.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: notification reading and clearing over the session channel |

### Testing

- [OK] tests.test_notifications.py 4/4 (stateful fake with real anchor-per-item shape)
- [OK] full suite 194 OK; Node 17/17
- [OK] production E2E fetch/clear-all; UI walkthrough: bell, popover, live empty state

### Status

[OK] **Completed**

### Next Steps

- Phase 7/8: home recentering (design directions first); phase 8: chart upload

---

## Session 12: Home recentering C2 (phase 7/8)

**Date**: 2026-10-24
**Task**: 10-23-home-recentering
**Branch**: `main`

### Summary

Two rounds of interactive design drafts (7 directions total) converged on the owner's ruling: browsing stays the protagonist and playlists are profile-level content. Selected C2: personal content in the topbar + filter pills. Implemented: filter form restyled into a compact pill row (pure CSS, all control ids unchanged); topbar account chip (avatar + username, login-gated) opening a personal menu (my playlists / my charts / my reviews / sign out); bookmark button retired; playlistFilter gained a kind field so personal views don't carry the playlist prefix; my-charts view (local catalog uploader filter) and my-reviews view (live public API, 60s cache). Fixed a pipeline subtlety found in verification: personal views must run through the full apply() pipeline after visibly resetting the date preset to all-time — rebuild() alone reuses the date-compacted set and showed 0 cards. Visual walkthrough PASS (account chip, menu, pills, views).

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: C2 home recentering with account menu and filter pills |

### Testing

- [OK] full suite 194 OK; Node all green
- [OK] live verification: chip renders with username, menu works, my-charts shows 5/5 owner charts, my-reviews shows 48/48

### Status

[OK] **Completed**

### Next Steps

- Phase 8/8: chart upload (real E2E needs an actual SRXD backup from the owner; contract tests cover the machinery)

---

## Session 13: Chart upload (phase 8/8) + repeated-pitfall gates

**Date**: 2026-10-24
**Task**: 10-23-chart-upload
**Branch**: `main`

### Summary

Final phase shipped. src/upload.py (options parse from the upload page, streaming multipart upload with local zip validation and before/after chart-list diff verification, metadata update without zip, delete with diff verify), native GetOpenFileNameW zip picker (choose_zip_file + desktop.choose_zip + manager.file_picker), endpoints /v1/upload/options|pick|start|update|delete. Frontend: upload dialog in the settings language (live production DLC/publication options), account-menu upload entry, two-step delete buttons on own charts inside the my-charts view. Contract tests 8/8 against a stateful fake (multipart construction, local rejections, update-without-zip, foreign-chart rejection, delete verify, expired session). Real upload E2E deferred to the owner supplying an actual SRXD backup zip. Mid-phase the app booted to a dead idle page: the third locale-key-missing occurrence ("Required DLC" vs existing "Requires DLC") killed setupLanguage and the whole startup chain — per the owner's same-day directive, this class is now gated by UICatalogCompletenessTests (static scan of every data-ui-static/data-ui-attr/m() literal against both catalogs, with source-escape decoding), and repeated-pitfalls.md gained the full defense list.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: chart upload with native zip picker and own-chart management |

### Testing

- [OK] tests.test_upload.py 8/8; UICatalogCompletenessTests gate live (12/12 in test_web_resources)
- [OK] full suite 203 OK; Node all green
- [OK] UI walkthrough: browse 6 cards ready; my-charts view 5 cards + 5 delete buttons; upload dialog with live options

### Status

[OK] **Completed** — the 8-phase session-channel blueprint (2026-10-23/24) is fully delivered

### Next Steps

- Owner-supplied SRXD backup for the real upload E2E
- Release 2.2.0 when the owner decides (versioning policy + README/CHANGELOG/DESIGN updates)

---

## Session 14: Popover quality overhaul (sprint 1, task 1/5)

**Date**: 2026-10-24
**Task**: 10-24-popover-quality
**Branch**: `main`

### Summary

Owner-reported UX debt on the playlist picker and notifications popover fixed at the architectural level. Bookmark button moved from the metrics row into the card actions group (matching download/delete buttons, styled as an outline action). Picker rewritten: opens instantly from cache (~7ms measured, previously multi-second network wait), membership confirmed by a background refresh that updates checkboxes in place while preserving user toggles (touched-set), save disabled until membership is confirmed or the user acts. Both pickers rebuilt on the app's anchored-popover language: reading-popover surface quality (inner card #25262e, radius 12, shadow), tag-panel anchor following (rAF loop, viewport guard, flip above/below), grow-in animation from the anchor. Two latent guard bugs found and fixed live: hidden tabs report a zero viewport (guard must skip, not close) and topbar anchors legitimately sit above --top (off-screen check now 0, --top clamps position only). New regression tests: instant open, in-place refresh, toggle preservation; harness checklist extended (getComputedStyle/rAF/rect mocks).

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | fix: anchored popover architecture for playlist picker and notifications |

### Testing

- [OK] test_playlists.cjs 8/8 (2 new: instant open + toggle preservation); full suite 203 OK; Node all green
- [OK] live verification: 7ms open, options arrive in place, bell popover anchored with empty state; screenshot review

### Status

[OK] **Completed**

### Next Steps

- Task 2/5: interaction-logic (filter area fixes + control audit)

---

## Session 15: Filter interaction logic (sprint 1, task 2/5)

**Date**: 2026-10-24
**Task**: 10-24-interaction-logic
**Branch**: `main`

### Summary

Owner-directed filter interaction overhaul. Reset filters moved from the collapsible summary row (next to Update data) into the actions row beside Apply, restyled as a pill button. Apply and Reset are now dirty-state gated: a clean, ready form disables both (first run before any query stays enabled); Apply keeps its existing dirty label/highlight ("Apply changes" + pink). Reset additionally goes quiet when the form matches a captured startup-defaults snapshot (captureDefaultCriteria at boot). The gating surfaced a real TDZ bug first (clean used before dirty's declaration — caught by the extraction test before any manual run) and required updating test_catalog_ui's old contract ("apply always usable") to the new directive-driven one. Live verification: clean → both disabled; check a difficulty → Apply enables as "应用更改" with pending highlight, Reset enables; uncheck → both quiet again. Control audit across the app (search/tags/choice menus/pagination/reviews/volume/account/upload/picker/sync) found the remaining controls already correctly gated; the apply/reset pair was the offender.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | fix: dirty-state gating and reset relocation in the filter bar |

### Testing

- [OK] test_catalog_ui contract updated and passing; full suite 203 OK; Node all green
- [OK] live: clean/dirty/reset-defaults transitions verified with real clicks

### Status

[OK] **Completed**

### Next Steps

- Sprint 2: settings redesign + chart auto-update

---

## Session 16: Settings & topbar cleanup (sprint 2, task 3/5)

**Date**: 2026-10-24
**Task**: 10-24-settings-topbar-cleanup
**Branch**: `main`

### Summary

Settings dialog redesigned per owner directives: header X button removed; bottom-right Quit app replaced by an OK button that closes the dialog (same closeSettings path with the closing animation and settingsBusy guards); section spacing fixed (directory vs account rows now breathe via per-section margins); topbar language selector removed entirely (language lives only in Settings, wired through the settings-language select). Dangling references cleaned in i18n.js/settings.js/window-regions.js (ui-language lists trimmed, exit binding removed). The OK button's closing animation stalls in a backgrounded IAB tab (Web Animations pause off-screen — same limitation as the old X, documented; cannot occur in the real always-visible desktop window). DOM verification: no topbar language, no X, no exit, OK present and bound, dialog opens with new spacing. Screenshot surface was unavailable in this session (timed out on all attempts); visual confirmation deferred to the owner's next walkthrough.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | fix: settings dialog OK action, no X/quit, section spacing, topbar language removed |

### Testing

- [OK] test_focus_modality select list updated; full suite 203 OK; Node all green
- [OK] live DOM verification of all removals/additions; OK closes via the standard animation path

### Status

[OK] **Completed**

### Next Steps

- Task 4/5: chart auto-update engine + settings toggle

---

## Session 17: Chart auto-update (sprint 2, task 4/5)

**Date**: 2026-10-24
**Task**: 10-24-chart-auto-update
**Branch**: `main`

### Summary

Installed-chart auto-update engine shipped. Semantics (owner clarified 2026-10-24): when local content differs from the cloud's latest, bring local to the cloud's version. Protection layer via a persisted baseline (update-baseline.json, {fileReference: last-known catalog hash}): up-to-date files refresh the baseline; untouched-but-cloud-moved files (baseline == local hash) reinstall through the standard transactional queue; locally modified files (baseline != local hash) are never touched; unknown-provenance first sightings follow the owner's literal rule (update) and the baseline makes later passes precise; charts removed upstream stay. Config autoUpdateCharts (default off) plumbed through defaults/validation/maintenance/bootstrap; POST /v1/auto-update toggle endpoint (close-behavior pattern); pass runs on a SpinShareAutoUpdate thread after any successful manual/automatic catalog sync when enabled; reinstalls go through manager.submit so the whole cooldown/transaction/activity pipeline applies unchanged. Settings UI: "保持已安装谱面为最新" toggle in a new data section with a one-line explanation. Red-line 1 amendment recorded in red-lines.md. Circular-import pitfall avoided via late binding (auto_update imported by spinshare_portable).

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: installed-chart auto-update with baseline protection and settings toggle |

### Testing

- [OK] tests.test_auto_update.py 10/10 (planning rules incl. user-edit protection, baseline IO, disabled pass, live pass with real queue submission + seeded cache, toggle endpoint 400/200/409)
- [OK] full suite 213 OK; Node all green; build_web --check clean

### Status

[OK] **Completed**

### Next Steps

- Task 5/5: user profiles (design directions first)

---

## Session 18: User profiles (sprint 3, task 5/5) — blueprint complete

**Date**: 2026-10-24
**Task**: 10-24-user-profiles
**Branch**: `main`

### Summary

Final sprint-1/2/3 task shipped: in-app user profiles (Direction B selected by the owner: gradient banner derived deterministically from userId + floating avatar + pill segments). web/src/js/user-profile.js fetches the four public user APIs directly (CSP already allows), LRU-cached per user. Tabs: Charts (real song cards through compact()+createChartCard with full install/review/cover states), Playlists (open into the existing filter view; sync-to-game available from ANY user's playlists — completing the sync feature's full reach), Reviews (title+verdict+date+comment list), SpinPlays (link list). My profile = same structure with an Upload chart button; entries: account menu "My profile" (replacing the two old items), charter names on cards (keyboard accessible), review author links now navigate in-app. E2E against production: own profile (刘易手: 5 charts, 48 reviews, 1 playlist with sync button), other profile (StoneTyph: 22 charts, no upload button), all four tabs, close restores browsing, charter-name click navigates.

### Git Commits

| Hash | Message |
|------|---------|
| (this session) | feat: in-app user profiles with banner, tabs, and full navigation |

### Testing

- [OK] full suite 213 OK; Node all green; locale completeness gate passed (707 keys)
- [OK] production E2E: own profile all tabs, other profile, charter entry, close/restore

### Status

[OK] **Completed** — all 5 tasks of the 2026-10-24 sprint delivered

### Next Steps

- Release 2.3.0 (owner decision on timing)

---

## Session 19: Quality doctrine (analysis-only, no code)

**Date**: 2026-10-24
**Task**: 10-24-quality-doctrine
**Branch**: `main`

### Summary
Owner reported 8 new defects in 2.3.1. This session is pure analysis/design — no code changes. Each defect's root cause was traced beyond the surface symptom to a violated higher-order principle. 8 principles (P1-P8) were distilled and documented permanently in spec/guides/quality-principles.md. A self-critique identified 5 systemic patterns causing repeated defects: (1) E2E verification停留在DOM属性层 not visual layer, (2) treating green tests as "done" when tests only cover scenarios I imagined, (3) fragmentary fixes that don't trace full chains, (4) hand-written popover positioning per-instance, (5) no all-mode screenshot walkthrough before delivery. 4 follow-up tasks created: window-regions-engine (maximized fix + unified popover engine + system-browser login), interaction-components (switch standardization + zero-review full-chain + copy hierarchy + predictive loading), review-layout (expanded-mode visual design), release-gate (state-matrix checklist as a permanent gate). The quality principles are now mandatory reading before any UI task.

### Git Commits
None (analysis-only)

### Testing
N/A

### Status
[OK] **Completed** — analysis delivered, follow-up tasks created

### Next Steps
- Task 10a: window-regions-engine (P0)
- Task 10b: interaction-components (P0)
- Task 10c: review-layout (P1)
- Task 10d: release-gate (P1)

---

## Session 20: Quality doctrine implementation (tasks 10a-10d)

**Date**: 2026-10-24
**Tasks**: 10-24-window-regions-engine, 10-24-interaction-components, 10-24-review-layout, 10-24-release-gate
**Branch**: `main`

### Summary
All 4 follow-up tasks from the quality doctrine completed. 10a: maximized window regions fixed with DPI-tolerant viewport check + delayed frontend re-publish; unified popover engine created (popover-engine.js) replacing 3 hand-written position functions across account/notifications/playlist-picker (with rAF tracking, hidden-page guard, topbar-anchor guard, grow animation, forced reflow); login window improved with 2s fast-poll detection. 10b: settings switch standardized to plain accent-color checkbox with single change listener (removed double-trigger); chart auto-update renamed to "谱面自动更新" with help tooltip (P3 info hierarchy); playlist data preloaded immediately on login (P6 predictive loading). 10c: review layout improved — inline mode gets head/body separation with subtle border, pinned mode gets card-like rounded separation. 10d: release gate checklist created (spec/guides/release-gate.md) with state matrix, visual walkthrough list, functional checks, and the 5-step self-review protocol.

### Git Commits
| Hash | Message |
|------|---------|
| 3c1dcf0 | feat: window regions maximize fix, unified popover engine, improved login UX |
| 8429912 | fix: settings switch standard component, playlist preload, auto-update tooltip, filter button labels |
| a6e731b | fix: remove terminal stop from auto-update tooltip locale |
| 529bc75 | fix: improved review layout separation in inline and pinned modes |

### Testing
- [OK] 213 Python + all Node tests green throughout

### Status
[OK] **All 4 tasks completed**

### Next Steps
- Build 2.3.2 installer and hand to owner for verification
- Apply the release gate checklist before delivery

---

## 2026-10-25 — 9 个用户反馈问题的真正根因修复 + 真机验证（glm）

### 背景
用户两次反馈同样 9 个问题，原话"你修一遍之后和没修一样的"。元根因：此前只在 IAB 浏览器验证，真机窗口行为（最大化拖拽区、浮窗定位）从未被真正测过；且 2.3.3 发布时重构误删了登录捕获方法。

### 根因与修复（全部已验证）
1. **登录提前超时**：`_try_capture_session`/`_close_login_window` 在 3c1dcf0 重构中被删而调用点保留 → watcher 线程 20s 后 AttributeError → cancel_login。已从 7f6bea3 恢复 + `tests/test_desktop_login.py` 5 个假时钟回归测试。真机验证：原生登录窗口（非系统浏览器）、70s 无提前超时、关窗后干净取消。
2. **最大化顶栏死区**：`_update_frame_region` 的视口匹配检查在最大化瞬间失配 → 无排除区的整条拖拽区盖住控件。改为始终应用布局（顶栏布局与视口无关）+ 修正测试断言方向。真机像素差分验证播放按钮响应。
3. **自动更新单行**：label 包裹 checkbox 的单行结构，DOM rect 验证。
4. **开关不能操作**：`APP_CONFIG` 冻结，直接赋值静默 no-op → UI 读旧值弹回。改为模块级 `let`（与 closeBehavior/previewVolume 同模式）+ `tests/test_auto_update.cjs` 冻结配置回归测试。双向切换 + 服务端落盘验证。
5. **0评论抽屉**：`syncReviewVisibility` 强制关闭空抽屉的行已移除。登录态点击打开（composer + 空态文案）DOM 验证。
6. **浮窗位置错**：双根因——(a) 引擎 `document.hidden` 守卫挡掉后台窗口的首次定位；(b) UA popover 样式表 `inset:0;margin:auto` 把账户菜单垂直居中到 438px。修复：守卫只判零视口 + `.account-menu` 补 `inset:auto` + 引擎内联 `right/bottom/margin` 中和。DOM 精确验证 gap=8。`tests/test_popover_engine.cjs` 7 个回归测试。
7. **歌单预加载**：登录即 fetchMyPlaylists，收藏点击 347ms 即开且带缓存数据，背景刷新不关浮层。
8. **展开评论布局**：内联模式 head/body 分离 + 边框 + 底色（529bc75 的样式已生效），样式审计 + 面板截图确认。
9. **未登录 0评论禁用**：`empty&&unsigned` 门控。隔离未登录实例验证 disabled。

### 验证方法论（重要）
- 位置断言：DOM rect（浏览器）或像素差分（真机 numpy diff）；视觉模型只描述不定位。
- 服务端启动时内联 bundle：改前端后必须重启实例再验证。
- 隔离实例矩阵：登录态（tmp/agent-e2e）+ 未登录态（tmp/agent-debug，拷贝 charts-cache.json 后本地数据可用）。

### 测试
- [OK] 218 Python（+5 login watcher、test_desktop_frame 断言修正）
- [OK] 全部 Node cjs（+test_auto_update.cjs 3 个、+test_popover_engine.cjs 7 个）
- [OK] build_web --check 无漂移

### Spec 回写
repeated-pitfalls.md 新增 #7-#11 并修正 #6（UA popover 劫持、冻结 APP_CONFIG、方法删除调用残留、运行中 bundle 内联、视觉坐标不可信）。

### 状态
代码完成待提交；2.3.4 构建到 dist/ 进行中。

## 2026-10-25（晚）— 2.3.4 正式发布（glm）

网络恢复后走完发布流程：

- **发布检查单补课**：browser_smoke 自音量功能落地后就没再跑过——冒烟夹具配置缺 `playerVolume` → `audio.volume=undefined` → 整个启动脚本崩溃（真机永不触发，因服务端始终下发该字段）。修了双保险：前端缺省回退到 1（format-covers.js），夹具补齐 playerVolume/autoUpdateCharts/session 与真实配置同形。修后 5 场景全过。installer_cancel_smoke 4 场景（en/zh × cancel/retry，私有桌面）全过。
- **正式构建**：dist/ 四件套，purpose=release，commit c6d4f052，哈希核对一致。
- **发布**：push main（57 提交）+ tag v2.3.4 → GitHub Release（双语 CHANGELOG 条目）→ 公开附件哈希逐一核对 MATCH → 按只留最新政策删除 v2.1.1 Release+远端 tag+本地 tag。线上现仅 v2.3.4。
- 教训（已入 pitfalls #11 精神）：**冒烟脚本本身也要随功能演进维护**——发布检查单里躺着没人跑的冒烟=没有防线。

### 状态
[OK] 2.3.4 已正式发布并完成公开核对。dist/ 留有本地安装包（含旧版本历史文件，未动）。

## 2026-10-25（深夜）— 2.3.4 七项外场反馈修复 → 2.3.5（glm）

- **#1 播放器全状态死**：真因是前后端数量契约漂移——登录态（铃铛+头像）+播放器出现时发布 7-8 个排除矩形，后端 valid_frame_layout 上限 6 → 400 拒收且无提示 → always-apply 把没有播放器矩形的旧布局钉死。修：上限 6→12（测试同步），发布端去掉与 .topbar-actions 重叠的铃铛/头像两个冗余选择器（固定 6 个）。教训入 pitfalls #12。
- **#3 评论门控**：syncReviewSessionState 挂进 syncSessionControls；busy 期间视为未登录（登出请求飞行中即刻禁用 0 评论按钮）；composer 重渲染不设 readingVisible 门槛（第一遍 busy 关抽屉、第二遍必须仍能清理，否则重开 >0 评论再现旧 composer——测试中现场抓到）；禁用态悬停反馈用 :not(:disabled) 消除。
- **#4 问号浮窗**：auto-update help 从裸 showPopover()（UA 样式表甩到左上角）改为与 catalog/close help 同款的 hover + 锚定定位 + 互斥 + Escape。
- **#5 更名**：更新数据→同步谱面库（en: Sync chart library），帮助文案改为"从 spinsha.re 云端拉取"语义，6 个 locale 键双语同步。
- **#6 我的主页**：双根因——profileIdentity/myReviewIdentity 读冻结 APP_CONFIG.session（启动后登录永远 null，pitfalls #8 再犯）；视图嵌在它自己要隐藏的 #chart-panel 里（0×0 渲染）。前者改读活跃 sessionAccount，后者移出面板。test_user_profile.cjs 4 断言。
- **#7 上传选 zip**：choose_zip 被 3c1dcf0 删除（同一次重构的第三个受害者，pitfalls #9 升级为两次事故）→ 从 116dd71 原样恢复。
- **#2 默认浏览器登录**：技术上不可行（会话捕获必须拥有渲染引擎；外部浏览器 cookie 不可读，Connect API 无 ApiKey）——已向用户呈报取舍。
- 验证：孪生浏览器 DOM 精确验证 #3/4/5/6（含登出全链路、未登录重开 >0 抽屉、主页 1544×1374 渲染）；真机 #1/#7 因前台被占用（用户在用机）留待安装后走查——根因链已由代码+单测双重建死。
- 发布：2.3.5 版本六处一致性、CHANGELOG 双语、218 Python + 全 Node + build check + browser_smoke 5 + installer_cancel_smoke 4 全绿。
