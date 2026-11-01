# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board,
and a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

The status board at `/` links to every night on disk, with ok/retry/fail event counts.
Open `/digest/2026-10-28` for the HTML digest or `/api/digest/2026-10-28`
for its JSON representation (`rows`, `badLines`, and `counts`). Both use the same
reader and job order. Missing nights return 404; empty nights show “nothing ran”
and return an empty JSON digest. Rows with three or more retries or a final failure
are highlighted. Pages are server-rendered with inline styles and no client scripts.

The digest reader is `readNight(runsDir, night)` in `src/digest/reader.ts`; its shared
contract lives in `src/digest/types.ts`. It returns job-sorted rows, malformed-line
counts, and event counts by status. Missing nights return `null`; empty nights
return an empty digest. Other filesystem errors propagate.

Rows preserve original timestamp offsets and use event time for first/last events
(the later record wins timestamp ties). Owner and status come from the latest
event; the last reported error remains visible after recovery. Invalid JSON or
invalid records count as bad lines; a terminal newline is not an extra record.
The supplied run logs are read-only.

## Public review preview

Enable GitHub Pages with GitHub Actions as its source, then run the
“Deploy digest preview” workflow manually. Its optional `marker` input is public
review data, not a secret: never enter an API key. The workflow starts rig and
exports `/digest/2026-10-28` with curl, then deploys the single HTML file through a
Pages artifact retained for one day. Neither the HTML nor the marker is committed.

After review and approval, run the same workflow with an empty marker to replace
the page at the same URL with “no marker set”. Disabling Pages takes the site
offline but does not recall downloaded copies.
