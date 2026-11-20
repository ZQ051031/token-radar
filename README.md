# Token Radar — token-radar-01

A token launch radar: it reads a sealed snapshot of the protocol universe, ranks the
pre-token protocols by an implied value, and shows a reader how to farm each one.

## How it works

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, scores every
pre-token protocol with the model in `lib/model.ts`, and writes:

- `board.json` — 200 ranked rows (the 40 watchlist protocols plus the 160 early ones
  below the watchlist floor, ranked by implied value), each with a seven-step farm plan.
- `data.js` — the same board in compact form for the dashboard.
- `dashboard/` — a static page: sortable, filterable, with a detail view per protocol.
- `screenshots/` — the board, a detail view and a filtered view.
- `dossier.json` — built with `buildDossier` from `vendor/makefun-board.ts`.

## The model (radar-2)

A pre-token protocol is priced the way the market prices a launched one of its kind:
its TVL times the median market-cap / TVL of launched protocols in the same category
(three or more of them), else the overall median — read out of the snapshot itself,
never a fixed constant. Growth, age with no token and chain breadth adjust it:

```
implied = round(tvl x multiple x growth x age x breadth)
```

No protocol name is special-cased. Live-token protocols are set aside with their
market caps shown; they are never mixed into the ranking.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The run is deterministic: the same
snapshot bytes always write the same output bytes.

## Layout

- `main.ts` — the entrypoint
- `lib/model.ts` — the value model, the board builder and the farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the three dossier screenshots
