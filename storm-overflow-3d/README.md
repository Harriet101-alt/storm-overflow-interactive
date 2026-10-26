# When it rains, it spills: interactive 3D storm overflow

An illustrative storm overflow in the browser (ArcGIS Maps SDK for JavaScript 5.1). Pick a storm,
play it, and watch the chamber fill, the weir spill, the street flood and the monitor log the spill.
It is not a real site and not a hydraulic model.

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Page and controls |
| `js/app.js` | Scene: static model, moving water, SDK rain, cameras, playback |
| `js/model.js` | Storage model: rain -> runoff, sewage, infiltration -> chamber level -> works / weir / street |
| `js/geometry.js` | Water meshes and surfaces; model metres -> longitude/latitude |
| `js/chart.js` | SVG chart of the run |
| `data/structure.json` | Static geometry from `src/cutaway.py` (regenerate: `python scripts\stages\build_overflow_web_model.py`) |
| `test/model.test.mjs` | Model tests: `node --test web/storm-overflow-3d/test/model.test.mjs` |

Run it locally (ES modules need a web server, not `file://`):

```powershell
cd web\storm-overflow-3d
python -m http.server 8765
# open http://127.0.0.1:8765/
```

Notes
- Weather (rain) works only in a global scene, so the model sits in one at an empty spot in the sea
  south-west of the Isles of Scilly, raised so the soil block stands on the ground like a diorama.
- Wet ground adds groundwater infiltration and slow rain-derived infiltration, which is why the same
  storm spills for much longer (Lipp & Dobson 2026). Sizes and rates are in `SITE` and `GROUND` in `js/model.js`.
