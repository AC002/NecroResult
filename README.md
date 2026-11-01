# NecroResult

Static web app for writing a Necromunda battle report for a [Munda Manager](https://www.mundamanager.com) campaign: who took out whom, with what, and which special actions earned XP. It produces a JSON report and a plain-text summary.

Live: <https://ac002.github.io/NecroResult/>. It is plain HTML, CSS and ES modules, with no build step and no dependencies.

## Usage

1. Paste a campaign link (`https://www.mundamanager.com/campaigns/<id>`), the API `/data` URL or a bare campaign id, then press **Load**. The default campaign loads when the page opens.
2. **Gangs & Players**: tick the 1–2 gangs that fought.
3. **Rosters**: enter each selected gang's fighters once and press **Save roster** (see below).
4. **Casualties**: one row per casualty: WHO → WITH WHAT → WHO (victim) → RESULT → XP.
5. **Special actions**: one row per action (e.g. Rally) and its XP.
6. Press **Generate report**. Fix any listed errors, then use **Copy JSON**, **Copy text** or **Download JSON** (`battle-report-YYYY-MM-DD.json`).

The draft (link, gangs and rows) is saved in this browser automatically.

## Data limitation and roster format

Munda Manager's public endpoint (`/api/campaigns/<id>/data?format=json`) lists campaigns, players and gangs, but **no fighters or weapons**, and gang pages need a login. You therefore enter rosters by hand. They are stored in `localStorage` (`necroresult.roster.<gangId>`) per browser. If the API ever adds a gang `fighters` array, those fighters are used automatically and shown read-only.

```
# one fighter per line: Name: weapon, weapon
Bob: Lasgun, Fighting knife
Joe: Autopistol
Silent Kasia
```

| Rule | Behaviour |
|---|---|
| Blank lines, lines starting with `#` | ignored |
| No `:` | fighter with no weapons (can still attack **Unarmed**) |
| Split | on the first `:`; weapons separated by `,` and trimmed |
| Duplicate weapons | dropped, case-insensitive (the first spelling is kept) |
| Duplicate fighter names | merged, case-insensitive (union of weapons) |

**Export rosters** saves all rosters to `necroresult-rosters.json`, for example to move them to another browser or share them with the group. **Import rosters** loads that file and replaces the rosters of the gangs it contains. An invalid file is rejected and nothing is changed.

## Report JSON (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-01T12:34:56.000Z",
  "campaign": { "id": "d6abc5f8-…", "name": "Rebelia w Gnieździe Myszy", "url": "https://www.mundamanager.com/campaigns/d6abc5f8-…" },
  "gangs": [{ "id": "93766ae9-…", "name": "Ściągacze Długów", "type": "House Delaque", "owner": "Sir_Spaghetti" }],
  "casualties": [{
    "attacker": { "gangId": "…", "gangName": "Ściągacze Długów", "fighter": "Bob" },
    "weapon": "Lasgun",
    "victim":   { "gangId": "…", "gangName": "SIEĆ", "fighter": "Joe" },
    "result": "Out of action",
    "xp": 2
  }],
  "specialActions": [{ "fighter": { "gangId": "…", "gangName": "Ściągacze Długów", "fighter": "Bob" }, "action": "Rally", "xp": 1 }]
}
```

| Field | Values |
|---|---|
| `weapon` | one of the attacker's roster weapons, or `Unarmed` |
| `result` | `Out of action` \| `Seriously injured` |
| `action` | one of `SPECIAL_ACTIONS` |
| `xp` | integer ≥ 0 |

## Configuration

Settings live in `js/config.js`. To add a special action, add it to `SPECIAL_ACTIONS` there; the UI and validation pick it up automatically. Casualty results (`CASUALTY_RESULTS`) and the max number of gangs (`MAX_GANGS`) are defined in the same file.

## Development

| Task | Command |
|---|---|
| Run locally | `python -m http.server 8000` or `npx serve`, then open <http://localhost:8000/>. ES modules do not load from `file://` |
| Tests | `npm test` (Node 22+, `node:test`, no dependencies) |

| File | Role |
|---|---|
| `js/campaign.js` | link parsing, API fetch, normalization |
| `js/roster.js` | roster text format, storage, import/export |
| `js/report.js` | validation, report JSON and text |
| `js/app.js` | the only DOM/`localStorage` code |

## Deploy (GitHub Pages)

Push to GitHub, then go to **Settings → Pages → Deploy from a branch** and choose `main` / `(root)`. `.nojekyll` is included, and all paths are relative, so the site works under `/NecroResult/`.

## Attribution and fair use

Campaign data comes from the [Munda Manager](https://www.mundamanager.com) public API. This project is not affiliated with Munda Manager. The API allows **10 requests per minute** per IP, so the app fetches only on page open and when you press **Load**. If you hit the limit, wait a minute and try again.
