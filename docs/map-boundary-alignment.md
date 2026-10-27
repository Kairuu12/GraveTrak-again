# Old Cemetery west-side alignment

The west corner, adjoining northwest endpoint and southwest endpoint now follow
OpenStreetMap's Lucena Public Cemetery outline, way **262146173**, inspected
2026-10-25: https://www.openstreetmap.org/way/262146173.
Source attribution: © OpenStreetMap contributors (ODbL).

This aligns the blue overlay with the shaded Map basemap. It is a visual tracing
correction, not a surveyed/legal boundary determination. The remaining five
vertices, section shapes, plot coordinates and pathways are unchanged. The short
extra closing segment was replaced by the exact starting point, removing the kink.

Public/admin views share `frontend/src/data/oldCemeteryBoundary.json`. Migration
0037 applies the matching boundary to backend containment validation, only when
the stored boundary still equals the original seeded shape. Custom boundaries
are left alone; the migration is reversible. Regression tests assert that the
frontend and backend copies match.
