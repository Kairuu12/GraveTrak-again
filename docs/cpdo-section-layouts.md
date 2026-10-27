# CPDO section rows and sides

New sections default to **1 row — Front only**. Choose **2 rows — Front and back** for a double-sided building. Columns count positions along each side; levels count niches stacked upward. For example, 1 × 12 × 4 creates 12 map positions and 48 niche slots for a quadrilateral boundary.

The Create/Edit Section form includes a top-view schematic and capacity preview. Four-corner polygons produce the complete grid. Irregular boundaries retain the existing center-point clipping behavior for map positions; niche capacity remains the configured rectangular row/column/level arrangement, as described in the preview.

Migration `0038_section_layout_dimensions` adds nullable row/column fields without changing existing sections or records. Confirmed layout generation saves the dimensions. Older sections recover dimensions from saved plot labels in the frontend; the niche API retains its two-sided default for unconfigured legacy sections. A configured section's dimensions take precedence, including when callers omit `rows`.

Empty sections can change row counts. Occupied, assigned, or protected records prevent boundary/layout regeneration. Adding levels preserves niche IDs and occupants; reducing levels cannot remove protected niches.

Validation: backend API tests in `api.test_single_row_sections`, drawing/rename regression tests, frontend `sectionLayout.test.js` and `savedSectionLayout.test.js`, and the frontend production build.
