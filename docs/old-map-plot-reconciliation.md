# Old Cemetery map record reconciliation

The original A–N polygons and their 84 plot positions per section were rendered
in the browser. Only separately saved layouts were returned by the plot API.
This caused the live Old Cemetery total to remain 456 although 1,548 positions
were represented across the active sections.

After deploying the updated backend and frontend, run from the repository root:

```powershell
python backend/manage.py sync_old_map_plots
python backend/manage.py sync_old_map_plots --apply
```

The first command previews the import in a rolled-back transaction. The second
persists it. The import is idempotent and locks the cemetery during execution.
It skips existing sections, historical rename sources, archived sections and
retired names. Existing plots, occupants, niches and their statuses are untouched.
New layout positions are available by default. This is plot layout status, not
the number of available niches inside each stack.

`api/data/old_map_sections.json` is a snapshot of the original map polygons.
Imported geometry retains its original two-sided ordering through the
`plot_layout` GeoJSON foreign member, so saving records does not rotate the grid
or lose the original niche-column search mapping. Explicit layout regeneration
removes this metadata and uses the newly requested grid.

On the audited database, 13 missing sections contain 1,092 positions. Together
with the existing 456 positions, this yields 1,548 persisted plot positions across
18 sections. The separate 6,192 niche records are not regenerated or changed.
New Cemetery is outside this import; empty mapped areas are not assumed to have
constructed niche capacity.

The plot summary endpoint also clears listing order before aggregating by status.
Otherwise ordering by section/plot number splits a status into separate groups,
and the resulting dictionary can report only the last group's count.
