# Why overflows spill: interactive drivers map

One map of England's 434 river catchments (299 analysed), replacing the four-panel Pro layout.
Pick a measure from the list; the bars rank them by how closely they track spill hours per
overflow (Spearman rho). "Against spill hours" shows the measure and spill hours together in one
3x3 colour key (the palette of the Pro bivariate maps). Hover a catchment or a dot for its values; click
for its profile (where it sits among the analysed catchments on every measure).

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Page |
| `js/app.js` | Map (ArcGIS Maps SDK for JavaScript 5.1), measure list, legend, scatter, profile |
| `js/stats.js` | Class breaks, Spearman, percentiles, Arcade renderer expressions |
| `data/catchments.geojson` | From `propy.bat scripts\stages\export_drivers_web.py` (the `drivers-web` stage) |
| `test/stats.test.mjs` | `node --test web/spill-drivers-map/test/stats.test.mjs` |

Run it locally:

```powershell
cd web\spill-drivers-map
python -m http.server 8766
# open http://127.0.0.1:8766/
```

The basemap is Esri's public World Light Gray Canvas tiles (no API key). Catchment outlines are
generalised 60 m and projected with `ETRS_1989_To_WGS_1984 + OSGB_1936_To_ETRS_1989_1`.
