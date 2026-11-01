# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

The digest reader is `readNight(runsDir, night)` in `src/digest/reader.ts`; its shared
contract lives in `src/digest/types.ts`. It returns job-sorted rows, malformed-line
counts, and event counts by status. Missing nights return `null`; empty nights
return an empty digest. Other filesystem errors propagate.

Rows preserve original timestamp offsets and use event time for first/last events
(the later record wins timestamp ties). Owner and status come from the latest
event; the last reported error remains visible after recovery. Invalid JSON or
invalid records count as bad lines; a terminal newline is not an extra record.
The supplied run logs are read-only.
