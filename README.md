# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bowxxx/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bowxxx/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: every protocol DefiLlama records with no token, ranked by what its launch would be worth. The model derives its base multiple from the snapshot itself — the median market-cap-per-TVL of the live-token protocols the snapshot prices — then scores each protocol on its TVL, seven-day growth, age with no token, and chain breadth. No protocol name is special-cased. The board covers all 40 watchlist protocols plus every other qualifying pre-token protocol below the floor (198 rows), each with a six-step farm plan carrying concrete costs and times. The dashboard is a static page with no network: sortable and filterable board, a detail view per protocol with the full value breakdown, a live-token tab kept apart from the ranking, and the model's derivation stated on the page.

## Run it

```sh
# <kit-dir> is the unpacked token-radar-01 kit, whose input/snapshot.json is the sealed snapshot
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit-dir>/input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html` in a browser (it reads `../data.js`) to use the radar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8bevpj6h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
