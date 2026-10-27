# Changes ported to the latest capstone copy

Date: 2026-09-16

Target project: the nested `GraveTrakDemo/` directory containing this document's parent project, `frontend/` and `backend/`.

## Result

- Both cemeteries stay on one public map. Old Cemetery and New Cemetery move the camera without recreating the map. Initial bounds include both cemeteries. The latest copy already used OpenStreetMap; its tiles remain in use and attribution is visible.
- Guest and signed-in mobile maps have compact search controls and cemetery buttons. Grave details sit above the bottom menu, and floor cards use two columns. Directions hide the surrounding mobile controls and show the estimate, origin and Exit button.
- Directions retain a valid GPS origin even beyond two kilometers. Location requests retry once after timeout/unavailability; denied permission does not retry. If GPS fails, the route explicitly starts at the selected destination cemetery's entrance.
- The Mayor's Applications search filters applicant/deceased names, application IDs and contact information. It supports combined words and accent-insensitive matching, with filtered counts, empty results and Clear search. Changing the query clears bulk selection; Select All selects visible results.
- Homepage actions now include Find a Grave and Apply for Burial. A guest who chooses Apply signs in before reaching the application. Home links and Visit Homepage preserve existing sessions. Office accounts return to their existing dashboard modules.
- The inert landing contact form and placeholder contact details were replaced with visit/application guidance and working navigation actions.
- Route connections use a nearby-cell lookup and reuse the resulting graph during each navigation session. Removed redundant marker preparation, an unused map-view function/effect, artificial session-loading delays, repetitive success logs and the duplicate grave/application fetch in the office activation effects.
- Application list queries load the serializer's related records together. Detail responses and role-based access restrictions retain their existing behavior.
- Fixed Leaflet disposal errors found during browser review: queued redraws and zoom callbacks no longer access a canvas/map pane after page navigation destroys it.

## Latest features retained

Changes were applied to individual sections of the latest files. CPDO saved section layouts, saved pathways, ground plot data, separate office modules, dynamic floor counts and the distinct ground-stack/columbarium lookup remain present. The two office columbarium reconciliation flows were retained because their behavior differs.

No database migration, record deletion, account change or production deployment was performed.

## Validation

| Check | Result |
| --- | --- |
| Frontend `npm run build` | Passed |
| `node --test --test-isolation=none src/utils/migration.test.js` from `frontend/` | 7 tests passed |
| Backend `python manage.py check` | No issues |
| Actual old cemetery graph | 915 nodes / 3,298 directed edges; every edge, weight and ordering matches the original |
| Actual new cemetery graph | 4,026 nodes / 34,582 directed edges; every edge, weight and ordering matches the original |
| Read-only serialization of 20 current applications | Identical response; 21 queries reduced to 3 |
| Headless Chrome at 390px, 320px and desktop width | No runtime exceptions in the tested flows |

Browser checks covered guest and user maps, cemetery camera controls, distant GPS origins, new-cemetery GPS failure fallback, grave panel/menu clearance, six-floor ground stacks, mobile Directions/Exit, dark mode, homepage/apply/sign-in navigation, session-preserving user and Mayor home links, Mayor application search and browser Back/Forward. At 390px, the search bar stayed within 16px side margins and the grave panel cleared the bottom menu by 16px.

The local graph comparison measured approximately 50ms to 9ms for the old cemetery and 735ms to 70ms for the new cemetery. These are local single-run measurements, not a guarantee of phone performance.

## Review and backup

- Original copies of modified source files: `.tmp/migration-before/`
- Normalized comparison of existing files: `.tmp/migration-review.patch`
- Browser screenshots and results: `.tmp/browser-review/`
- Regression tests: `frontend/src/utils/migration.test.js`

`.tmp/` is ignored by Git so local backups and the isolated browser profile are not published. The comparison patch covers modified existing files; new helper, test and CSS files are listed separately below.

Modified files:

- `frontend/src/App.jsx`
- `frontend/src/api.js`
- `frontend/src/pages/PublicMapPage.jsx`
- `frontend/src/pages/LandingPage.jsx`
- `frontend/src/pages/LandingPage.css`
- `frontend/src/components/GravePanel.jsx`
- `frontend/src/components/admin/legacy/LegacyAdminWorkspace.jsx`
- `frontend/src/hooks/useLeafletMap.jsx`
- `backend/api/views.py`
- `.gitignore`

New implementation/test files:

- `frontend/src/pages/PublicMapMobile.css`
- `frontend/src/utils/applicationSearch.js`
- `frontend/src/utils/routeGraph.js`
- `frontend/src/utils/routeLocation.js`
- `frontend/src/utils/migration.test.js`

## Limits of verification

Browser checks used an isolated profile and mocked application/GPS/road-route responses, so they did not submit or alter real records. Live GPS accuracy, external routing availability, on-site walking directions and real-device touch behavior still need a physical phone check. Existing road routing uses a driving profile while displaying a walking estimate; that pre-existing limitation remains.

The production JavaScript bundle is still about 957kB before gzip, and the build reports a large-chunk warning. The migration improves identified repeated work; it does not claim that every source of lag is resolved. Broader office create/update workflows were preserved, but were not exercised against real data during this migration.
