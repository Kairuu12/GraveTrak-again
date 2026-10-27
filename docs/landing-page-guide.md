# Landing page connections

Updated 2026-09-16.

The landing page now highlights three services: grave search, directions and burial applications. It includes a three-step visitor guide, cemetery shortcuts, the application document checklist and expandable FAQs.

## Connected actions

| Action | Destination |
| --- | --- |
| Find a Grave / Choose a destination / Try grave search | `/map`, with Old Cemetery as the default view |
| Old Cemetery preview or coverage button | `/map?cemetery=old` |
| New Cemetery preview or coverage button | `/map?cemetery=new` |
| Apply for Burial, guest | `/apply` redirects to `/login?next=apply`, then opens the application form after login |
| Apply for Burial, signed-in user | `/apply` opens the application form |
| Open Dashboard, office account | Existing `/admin` role dashboard |
| My workspace | `/map` for users; `/admin` for office accounts |

The cemetery query parameter controls the initial camera focus. Both cemetery layers remain on the same map, and a regular `/map` visit still defaults to Old Cemetery.

## Shared data and cleanup

- The preview draws the existing base cemetery layouts as SVG. Old Cemetery data is shared with the public map through `src/data/cemeteryLayout.js`; New Cemetery uses the existing `anothermap.json`.
- The preview is labeled as a layout preview. Current records and saved section updates remain available through the actual map; no live occupancy or availability is implied by preview colors.
- The checklist and application form import the same six-document list from `src/data/burialRequirements.js`.
- Replaced the generic map illustration, repeated feature descriptions, redundant About content and obsolete contact-form styling.
- No unverified contact number, email, visiting hours or approval promises were added.
- New landing styles are scoped to `.landing-page`.

## Verification

- Production build passed. Existing large-bundle warning remains.
- Extracted Old Cemetery coordinates and document definitions match their original values exactly.
- Headless Chrome confirmed both cemetery links focus the correct actual map center at zoom 19; reload preserves the New Cemetery link; regular map visits default to Old Cemetery.
- Checked preview switching, service links, FAQs, six requirements, guest login/application flow and signed-in application access.
- Desktop, 390px and 320px layouts were captured and checked; mobile had no horizontal overflow.
- Browser tests used mock API records and did not alter real application data. No runtime exceptions were reported.

Local review screenshots and results: `.tmp/landing-review/`. Original source snapshots: `.tmp/landing-before/`.
