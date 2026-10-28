# Interactive 3D storm overflow

An illustrative storm overflow in the browser (ArcGIS Maps SDK for JavaScript 5.1). The panel holds
only the controls: storm presets, rain intensity and duration, dry or wet ground, playback, camera
views and labels. Choosing a storm starts playback at the start of the rain, so the rain shows at once.
It is not a real site and not a hydraulic model.

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Page and controls |
| `js/app.js` | Scene: static model, moving water, SDK rain, cameras, playback |
| `js/model.js` | Storage model: rain -> runoff, sewage, infiltration -> chamber level -> works / weir / street |
| `js/chart.js` | SVG chart of the run: rain, street flooding, flow to the works, spill |
| `js/geometry.js` | Water meshes and surfaces; model metres -> longitude/latitude |
| `data/structure.json` | Static geometry from `src/cutaway.py` (regenerate: `python scripts\stages\build_overflow_web_model.py`) |
| `test/model.test.mjs` | Model tests: `node --test web/storm-overflow-3d/test/model.test.mjs` |

Run it locally (ES modules need a web server, not `file://`):

```powershell
cd web\storm-overflow-3d
python -m http.server 8765
# open http://127.0.0.1:8765/
```

URL options
- `?embed`: for the StoryMap; the panel drops its title.
- `?compact`: for a small box such as an Experience Builder Embed widget. The panel is replaced by
  one slim icon bar (storm, play, time, status, labels), only five one-word labels are kept
  (Sewer, Weir, To works, Monitor, River), and the heavy shower plays on a loop until the viewer
  pauses or scrubs it (no autoplay with "reduce motion" set).

Notes
- Weather (rain) works only in a global scene, so the model sits in one at an empty spot in the sea
  south-west of the Isles of Scilly, raised so the soil block stands on the ground like a diorama.
- Wet ground adds groundwater infiltration and slow rain-derived infiltration, which is why the same
  storm spills for much longer (Lipp & Dobson 2026). Sizes and rates are in `SITE` and `GROUND` in `js/model.js`.
