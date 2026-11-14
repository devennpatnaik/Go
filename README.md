# go

Local play. The server stores games in Postgres when `DATABASE_URL` is set, and in memory otherwise.

```bash
env -u DATABASE_URL npm test
env -u DATABASE_URL npm run dev
```

GNU Go at level 10 is the game on the home screen. Online is not open yet. A finished solo game, including a resignation, updates the player's EGF GoR from the 30 kyu beginner rating. Stats stay with the signed-in person.

Analysis is GNU Go's `estimate_score` and `reg_genmove`. Two passes on a solo game end on GNU Go's `final_score`. Agreeing dead stones for Chinese area scoring is still open.

A display ad uses `NEXT_PUBLIC_ADSENSE_CLIENT` and `NEXT_PUBLIC_ADSENSE_SLOT` when both are set. Otherwise the page shows a labeled sample slot.

This machine has GNU Go at `/usr/games/gnugo`. A host without that binary can serve the pages, but it cannot play or analyze.
