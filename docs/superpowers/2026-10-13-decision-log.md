# Decision log — Tier 1 pumpkin-carve build, 2026-10-12/13

Every decision made on the user's behalf during the subagent-driven execution of
`docs/superpowers/plans/2026-10-12-tier1-pumpkin-carve.md`, in the order made.
The spec is the binding authority; these are the calls it did not settle.

73 numbered rulings, 12 parked findings.

## Two rulings were reversed mid-build — read these before acting on the list

This log is chronological, so a superseded ruling still appears at its original
position. Two were reversed once evidence arrived:

- **F1 was reversed by R33.** F1 said to keep the `live.id = row.id` reassignment
  rather than widen `store.create()` to accept an id. That was wrong: the store's
  Map is keyed by the *original* id, so after the reassignment `store.get()`
  returned null and `store.remove()` was a silent no-op, leaking rooms. R33
  reverses it — `store.create()` now takes an optional id and the mutation is gone.
- **The "clear the session on taken-over" instruction was reversed by R44.**
  `localStorage` is shared across tabs, so clearing it in the taken-over tab wiped
  the live tab's session, and a refresh there created the duplicate player the
  requirement existed to prevent. R44 keeps the session and adds an explicit
  reclaim action instead.

Three bookkeeping errors were also made and self-caught during execution: a review
and a dispatch were recorded in the ledger before the call was actually made, and
Task 18 was implemented without its review being dispatched at all. None reached
the code; all three were caught within a turn or two. The lesson recorded at the
time: reconcile "implemented" and "reviewed" as a pair, and write the ledger line
only after the tool result returns.

## Numbered rulings

### F1
keep `live.id = row.id` reassignment after `store.create()` in T11 and T13

### F2
phase timings are duplicated as literals in T9 config, T10 tests, and T19's

### F3
T16's `CarveScreen` calls `integrityState(ratio, 0.55)` with a literal. The

### F4
add `addPlayer`, `setConnected`, `participants`, `reassignHostIfNeeded` to the

### F5
`GameModule` carries a 5th method `setPhase` beyond the spec's four. Already

### F6
T13 and T14 both edit `enterPhase`. T13 adds the `saveSnapshot` call; T14

### F7
T8 imports `asPlayerId`, `asRoomId`, `isNull`, `or` without using them.

### R1, load-bearing
replace `node:crypto` randomBytes with Web Crypto
`globalThis.crypto.getRandomValues` in BOTH packages/shared/src/ids.ts (Task 1) and
code.ts (Task 2). The plan mandated node:crypto, and the reviewer is right that it is
wrong: @tg/shared is a barrel, so the client importing CODE_LENGTH/normalizeCode pulls a
Node built-in into the Vite browser bundle. Web Crypto exists in Node 18+ and all target
browsers, so one isomorphic API serves both sides and @tg/shared stays environment-free.
Fixing now costs ~6 lines; fixing after Tasks 15-18 exist costs a client debugging
session. Cost if wrong: @types/node may become unnecessary at the root (harmless).

### R2
fix the modulo bias in generateCode via rejection sampling. Real correctness
defect, three lines. ids.ts is unaffected (64-char alphabet with `& 63` is unbiased).
Cost if wrong: none; rejection sampling is strictly more correct.

### R3, reviewer finding 3 answered not deferred
`carvedRatio` treating `stamp` as
removing area is CORRECT — stamps are cookie-cutter shapes that cut through the
pumpkin. `shape` is intentionally ignored for area purposes; it only affects
rasterization in the client canvas (Task 16). No change.

### R4, load-bearing
fix the labelPlayers collision. Input ['Sam','Sam','Sam (2)']
yields ['Sam','Sam (2)','Sam (2)'] — two players share an attribution label, which
defeats the function's stated purpose. The results screen (T18) attributes pumpkins by
label, so a collision misattributes work at the one moment it matters most. Fix: track
issued labels and keep incrementing until unused. Cost if wrong: none; strictly more
correct than the plan's version.

### R5
replace `a.id.localeCompare(b.id)` with plain `<`/`>` comparison in the sort
tie-break. localeCompare is locale-dependent, and this same tie-break pattern feeds
T5's createState, whose seeded gallery shuffle depends on a stable player order. Cheap
now, and it keeps T4 and T5 consistent. Cost if wrong: none.

### R6
do NOT start Task 6 until Task 5's review clears. T6 surgically edits the same
pumpkin.ts that T5 just created, and T5's review is specifically scrutinizing reduce's
purity and seededShuffle's bias. Building T6 on an unverified state machine risks
reworking two tasks to save ~30s of wall clock. Cost if wrong: slightly less parallelism.

### R7, load-bearing
fix the Important finding by adding golden-vector tests. Nothing
currently pins the determinism that ruling R5 exists to provide — all 16 tests would pass
if someone reverted the tie-break to localeCompare or tweaked mulberry32. Six downstream
tasks share this state shape and T13's restart-recovery replays a persisted seed expecting
an identical slot order, so an unpinned guarantee is a silent time bomb. Tests only; no
production code changes. Cost if wrong: four extra tests.

### R8, plan defect, load-bearing
bump better-sqlite3 11.8.1 -> 13.0.3. Controller
verified empirically in a scratch dir: 13.0.3 installs from a PREBUILD (no compile, 2
packages) and runs correctly on this machine at Node 26 / ABI 147.
Alternatives rejected, with reasons:
- node:sqlite (verified working on Node 26) has NO drizzle-orm driver in any version up
to 0.45.4 — checked the package's exports map directly.
- drizzle's sqlite-proxy driver would work with node:sqlite but is async-only, which
forces every Repo method to become async and ripples into T10-T13, where RoomRuntime
calls the repo synchronously inside onPhaseEnter and dispatch. Large blast radius.
- libsql is another native dependency, i.e. the same class of risk we are escaping.
- pinning Node 22/24 locally imposes a toolchain downgrade on the user's machine for a
problem a version bump solves.
Keeping better-sqlite3 preserves Drizzle's SYNCHRONOUS API, so zero code changes beyond
the version. Task 20's node:22-slim base image still works: v13 publishes prebuilds for
Node 22, so no Dockerfile change is needed.
Cost if wrong: if 13.0.3 misbehaves under drizzle-orm 0.39.3's peer range, bump
drizzle-orm to 0.45.4 as well — our usage (select/insert/update/onConflictDoUpdate) is
stable across that span.

### R9
hold Task 7 until Task 6's review clears, same reasoning as R6 — T7's viewFor
calls T6's tally and edits the same pumpkin.ts. Cost if wrong: less parallelism.

### R10
hold Task 9 until BOTH T7 and T8 reviews clear. T9 adds the spectator arm to
the viewFor that T7 just wrote, and its store.ts sits beside T8's server package. Cost if
wrong: less parallelism.

### R11, load-bearing
fix both Important findings on T7.
(a) The id-substring security test is weaker than it looks: it runs only in vote-scariest,
with ZERO votes cast, for 3 viewers. `state.votes` is keyed by PlayerId, so a future
viewFor that accidentally spread `votes` into the voting payload would NOT be caught.
Harden: run the id check across all four vote phases WITH votes cast, and pin the
top-level voting view key set.
(b) `AWARD_BY_PHASE[state.phase]!` throws a TypeError on an unrecognised phase, and
setPhase casts any string without validating. A bad phase would crash viewFor inside
the server's broadcast loop, taking down a live game rather than degrading.
Cost if wrong: a handful of extra tests and one guard.

### R12, load-bearing
fix I1 — addPlayer and saveResult accept a workspaceId and a
roomId and never verify they belong together, and the DDL has no FKs to catch it. A caller
mixing sources silently writes a mis-tenanted row that listPlayers(B, roomA) would then
return. This is the cross-tenant leak the entire scoping rule exists to prevent, arriving
via the write path. Fix: scoped room lookup before insert, throw on mismatch (not a silent
no-op — a silent failure loses a player with no diagnostic), plus negative tests asserting
no row is left behind. Cost if wrong: one extra indexed SELECT per player join.

### R13
fix I2 — schema.ts declares 8 .references() but the DDL has no REFERENCES at
all. Two disagreeing descriptions of the same tables means the DB enforces none of the
tenancy relationships, and drizzle-kit would later emit a migration contradicting
production. Fix: add REFERENCES to the DDL, add PRAGMA foreign_keys = ON (without it
SQLite parses FKs then ignores them), give membership its natural composite PK, and add
room_snapshot to schema.ts so the drift is closed in both directions.
Cost if wrong: the FK pragma could surface a real insert-ordering bug — which is worth
finding now rather than in production, and the implementer is told to report it.

### R14
also close the test-coverage gap the reviewer found — setRoomStatus, setHost
and setConnected all filter correctly but NO test would notice if the filter were removed.
Those are cross-tenant writes (B could flip A's room status, host, or player presence).
Negative test + mutation check for each.

### R15
hold Task 9 until Task 8's fix lands, so review-package ranges stay cleanly
separable per task. T9's own coupling to T8 is nil (its store.ts imports nothing from the
db layer), so this is purely bookkeeping hygiene after I already mis-ledgered one dispatch
tonight. Cost if wrong: a few seconds of serialization.

### R16
send that Minor back as fix round 2 rather than deferring it, even though the
skill says minors do not re-enter the loop. Reason: it is the SAME defect class that
ruling R13 existed to eliminate (DDL and schema.ts must agree), so a fix round that
re-introduces the drift it was closing is not actually done. One-line change. Bundled an
optional cleanup (membership_unique is now redundant with the composite PK).
Cost if wrong: one extra fix round on a one-line change.

### R17, ENDORSING the implementer's deviation
the brief's `joinedAt: Date.now()` is a
real plan defect. Two players joining within the same millisecond tie, and the sort
tie-break then falls to comparing random 21-char ids — making host handoff AND participant
order nondeterministic. Two of the brief's own store tests failed on it. Worse, that order
feeds createState's player index, which seeds each pumpkin's collapse threshold, so the
nondeterminism would have reached game state. Their fix (joinedAt strictly increasing per
room via Math.max(Date.now(), latest + 1)) is correct and stays.
Cost if wrong: joinedAt is no longer a true wall-clock timestamp. Nothing reads it as one;
it is an ordering key. Worth a comment saying so.

### R18
hold Task 10 until Task 9's review clears. T10's RoomRuntime is built directly
on T9's store API (participants, reassignHostIfNeeded, setConnected), and every review so
far has surfaced at least one Important finding — T4, T5, T7, T8 all did. Building the
runtime on an unverified store is the expensive version of saving 40 seconds.
Cost if wrong: less parallelism.

### R19, load-bearing
fix Important 1 — nothing pins the joinedAt monotonicity that
R17 endorsed. Same failure class as R7: the guarantee is load-bearing (it determines host
handoff AND participant order, which seeds each pumpkin's collapse threshold) but a revert
to Date.now() would pass the suite INTERMITTENTLY, depending on whether two joins happen
to land in the same millisecond. Intermittent green is the worst kind. Fix: frozen-clock
test, backwards-clock test, and a per-room-not-global test. Cost if wrong: three tests.

### R20
fix Important 2 — host eligibility. reassignHostIfNeeded filtered only on
`connected`, so a spectator who joined mid-game could become host, and addPlayer could
promote a spectator straight to host when hostId was null. New ordering:
1. earliest-joined connected PARTICIPANT
2. else earliest-joined connected SPECTATOR  (someone present must be able to act;
a headless room with a human sitting in it is worse than a bystander host)
3. else null
Rationale: in Tier 1 the host's only power is starting the game, which happens in the
lobby where nobody is a spectator — so this is nearly harmless TODAY. But a host-gated
"start next round" is a predictable next feature, and then a bystander holding the
control is a real problem. One filter now versus revisiting it later.
Cost if wrong: a spectator host in the rare all-participants-disconnected case, which is
the deliberate fallback.

### R21, ENDORSING a deviation
the runtime takes the `RoomStore` INTERFACE rather than
the concrete InMemoryRoomStore. That is exactly what pre-flight ruling F4 existed to
enable; it stays.

### R22, ENDORSING two test-setup corrections
(a) the runtime test setup now adopts
the id of a repo.createRoom row, because MY ruling R12 made saveResult throw for a room
absent from the DB — a direct ripple of that decision into T10's test fixture, correctly
handled. (b) the labels test calls start() before adding the duplicate player, so that
player is a spectator; labelPlayers still labels spectators, so the 'A (2)' assertion
holds.

### R23, load-bearing, DESIGN CHANGE
fix I1 by folding the deadline into the snapshot
and DELETING the separate `timer` message from ServerMessage.
The bug: the client clears its stored deadline on every snapshot, and the timer was sent
only from enterPhase — so the broadcastSnapshot calls in dispatch, onConnect and
onDisconnect each blank the countdown for the whole room. One SUBMIT mid-carve kills
everyone's timer. My earlier F6/ordering fix only addressed phase entry, not mid-phase.
Why redesign instead of re-sending the timer: two sources of truth for the deadline is the
actual defect. Putting endsAt + serverNow in every snapshot makes the deadline part of
authoritative state, dissolves the snapshot-before-timer ordering contract entirely (that
test gets deleted — the condition it guarded no longer exists), and removes the whole
class of "a message got missed or clobbered" failures.
Timing: no client exists yet, so this costs nothing downstream now and is only ever more
expensive later. T14's brief must be updated to match — CARRY-FORWARD below.
Cost if wrong: snapshots grow by two numbers.

### R24
fix the controller-raised `reduce` defect at its source in shared/pumpkin.ts
(return state for unhandled action types) and KEEP the runtime guard as belt-and-braces.
The runtime try/catch alone would leave every other caller — tests, future transports,
game #2 — inheriting a function that returns undefined.

### R25
fix I2/I3 — setPhase's result is unguarded; a throw inside the setTimeout
callback escapes as an uncaught exception that can kill the process (Repo.saveResult
throws on a missing room, and it runs there); a throw mid-broadcast leaves some players
updated and others stale; and the bare `catch {}` makes a malformed payload and a real
reducer bug indistinguishable from "ignored" with nothing an operator can see.

### R26
fix I4 — RoomContext.setTimer shares the phase timer's slot and clears it, so
a game module calling setTimer inside onPhaseEnter silently cancels its own phase timer.
Latent for pumpkin, but this contract exists so game #2 plugs in without surprises, and
this is a trap laid for it. Plus a `disposed` flag (post-dispose dispatch currently
creates a fresh timer) and a guard on advancePhase-before-start.

### R27
fix I5 — allConnectedSubmitted returns true for zero connected participants,
so if everyone drops during carving the room advances instantly, races the vote phases on
timers, and persists an empty result with nobody watching. A brief all-hands wifi blip
would discard every unsubmitted carving. Change to stall on zero connected and let the
phase clock decide.

### R28
fix I6 — `started = true` is set before createState, so a throw there wedges
the room permanently behind "already started".

### R29, answering the implementer's question
module timers SHOULD be cleared when the
next phase starts. A timer armed during carving firing during voting would mutate state in
a phase that never asked for it; a game needing cross-phase timing re-arms in the next
onPhaseEnter. Clearing on phase change is the correct default, not a limitation.

### R30, load-bearing
(2) make re-join idempotent. POST /join now accepts an optional
playerToken; if it resolves to a player already in that room, return that same player
unchanged rather than creating a second one. Without this, a browser refresh produces a
duplicate player — duplicate presence, a second pumpkin, and a second vote. T9's
implementer flagged the risk; this fixes it server-side, where it is enforceable, rather
than trusting the client to never re-POST. Client session persistence still comes in
T14/T15 but is now layered on a safe endpoint.
Cost if wrong: a stolen token would let someone resume another player's session — but the
token is already the websocket credential, so this adds no new exposure.

### R31, my instruction's fault
the `guarded` helper I asked for converted two crashes
into permanent silent stalls — worse than the crash.
(a) timer-fired advancePhase: the phase timer has already fired and been nulled, so a
setPhase failure inside enterPhase logs and returns, and NOTHING will ever advance the
room again. Players watch a dead countdown with no explanation.
(b) start(): `started` is already true, so a setPhase failure returns normally and wedges
the room in lobby behind "already started" with no retry possible.
Fix per what the caller can do about it: (b) roll `started` back and RETHROW so the host
can press start again; (a) there is nobody to retry for the players, so log, broadcast the
existing ServerMessage `error` variant with code PHASE_FAILED, and move to the terminal
phase — a game that ends with a visible error is humanly recoverable, a frozen timer is
not. Plus: disposed checks on context().setTimer and start(), and truncate/strip newlines
from the client-controlled action.type before logging (log injection + flood).
Cost if wrong: a failed phase transition ends the game instead of hanging it.

### R32, ENDORSING a deviation
the route now checks room-exists (404) BEFORE validating
the display name, so an unknown code with an invalid name returns 404 rather than 400.
That is more correct, not less — you should not validate the body of a request to a
resource that does not exist. No brief test broke.

### R33, REVERSING my own pre-flight ruling F1
F1 said keep `live.id = row.id` and
just comment it, because widening store.create would ripple. That was wrong. store.create
registers the room in its Map under its OWN generated id, so reassigning live.id leaves
the Map key stale: store.get(ws, row.id) returns null and store.remove is a silent no-op,
so rooms leak with nothing to notice. The ripple I was avoiding is smaller than the bug I
accepted. Now: store.create takes an optional id, the route creates the DB row first and
passes row.id, and the mutation disappears.
Cost if wrong: one extra optional field on a store method.

### R34, load-bearing
unify the player id space. Beyond the mismatch I found,
repo.setHost writes a STORE player id into rooms.host_player_id — which is DB-player-id
space — so the persisted host pointer matches no player row at all, and it is rewritten on
every join including non-host joins. Root fix: Repo.addPlayer takes an optional id and the
route passes the store player's id, which corrects presence, host pointer, and the
restart-recovery key problem in one change. Also: only call setHost when the host changed.
Cost if wrong: nothing; it removes a whole class of silent no-op writes.

### R35
/start called twice currently throws out of runtime.start() and Fastify
answers 500. Return a clean 409 ALREADY_STARTED instead — a 500 tells the client nothing.

### R36, load-bearing
fix F1 — socket event handlers never check the event came from
the CURRENT socket, and connect() never closes an existing one. Traced failing sequence:
disconnect() then connect() before the old socket's async onclose fires -> the old onclose
orphans the live NEW socket and schedules a retry -> a SECOND connection opens. React
StrictMode's mount/unmount/mount produces exactly this, and T15 will call connect from an
effect, so this would fire on essentially every dev page load. Also: onclose does not
clear a pending retry before scheduling another (leaked timer, forked chain), and
disconnect() does not reset `attempt`.
Cost if wrong: a guard clause and a cleanup block.

### R37
fix F2 — require PROJECT-LEVEL jsdom config, not the per-file
@vitest-environment docblock. Four more tasks each add a DOM test file and would each have
to remember it; the guard test only protects its own file; and the `test` block in
packages/web/vite.config.ts is dead config that reads as if it works. The implementer must
then DELETE the docblock and guard test and show the suite still passes — that is the proof
the project config does the work. Doing this before T15 rather than after four more files.

### R38
fix F3 — connect/onclose are entirely untested, yet 4001-is-terminal,
never-give-up, reset-on-open and disconnect-cancels-retry are all stated constraints. A
fake WebSocket plus fake timers covers them and would have caught F1 unaided.

### R39
fold in three cheap items the next four tasks depend on: make a 4001 takeover
distinguishable from a deliberate disconnect (otherwise App shows "Connecting..." forever
and no screen can say "opened in another tab"); fix Timer's stale first frame (endsAt
null->value flashes 0:00 because ms is seeded once from useState); stop the rAF loop at
zero and render whole seconds rather than 60 frames per second.

### R40, load-bearing
fix F1 — accepted sockets have no 'error' handler, and in the ws
library an error event with no listener is RETHROWN as an uncaught exception. One
malformed or oversized frame from any single client would take down the whole process and
every game on it — the exact inverse of the constraint I wrote ("a bad frame must not end
someone's game"). Fix: ws.on('error') per socket, a sane maxPayload on the server, and a
test that the process survives an emitted error.

### R41
fix F2 — two tests cannot fail. "does not let a message body choose who acts"
only asserts the socket stays open, and since no game has started dispatch returns early,
so the core anti-cheat property (by comes from the authenticated socket, never the body)
has NO effective test. Required: start the game, send an action carrying a forged `by`,
and assert the submission landed on the sender. Also add the missing positive case that an
action reaches dispatch at all over the wire. The "no second presence entry" test must be
made meaningful or deleted — a test that cannot fail is worse than none, because it reads
as coverage.

### R42, game-day risk
fix F3 — there is no ping/keepalive, and during the 180s carve
phase the server sends NOTHING (carving is deliberately private, so no snapshots fan out).
An idle proxy or load balancer will drop a silent websocket, so on deployed infrastructure
players would lose their connection mid-carve while the room still thinks they are there.
Add a 30s ping with pong tracking, terminate on a missed pong, clear the interval in
transport.close().

### R43, game-day risk, closing a deferred observation rather than leaving it
Ruling (R43, game-day risk, closing a deferred observation rather than leaving it):
maxPayload at 256 KiB depends on an assumption nothing enforces. 12 bytes/point holds only
if coordinates are ROUNDED; raw pointer-handler floats run 35-40 bytes/point, capping a
stroke list near 6-7k points, while a 3-minute carve at 60Hz can reach ~10k. There is no
rounding or point cap anywhere — not in the SUBMIT/DRAFT reducers, not in the client. So an
enthusiastic carver could be closed with 1009 at the moment of submit and LOSE THEIR
PUMPKIN. Two-part fix: (a) coordinate quantization + point thinning is REQUIRED in Task 16
(the carve screen, not yet built — the right place and the real fix); (b) raise maxPayload
to 1 MiB so a client-side bug cannot cost someone their work. Declined to add a reducer
point cap: that is a shared-package change and stroke sizing belongs on the client.
Cost if wrong: a hostile client can buffer 1 MiB instead of 256 KiB per frame.

### R44, REVERSING my own instruction
do NOT clear the session on `taken-over`. I told
them to, and they flagged it correctly: localStorage is shared across tabs, so clearing in
the taken-over tab wipes the LIVE tab's session, and a refresh there creates the duplicate
player this requirement exists to prevent. Also revert the message copy and flip the test,
and add an explicit reclaim button — re-joining with the stored token returns the same
player and closes the other tab's socket with 4001, which is the existing mechanism pointed
the other way.

### R45, load-bearing
my session requirement was defeating itself through the error
path. The client cleared the session on EVERY non-NETWORK error, so a 502/503 during a
deploy (surfacing as `HTTP 502` with no body code) wiped a good token; and after a kept
failure the user landed on a join form whose manual submit sends NO token, creating a
duplicate and overwriting the stored session. Fix: clear ONLY on a definitive
ROOM_NOT_FOUND; on any other failure keep the session and offer a retry that re-attempts
with the token; if falling back to the form, prefill the name AND pass the stored token.

### R46
fix the stranded state — if the websocket never opens or ends closed after a
successful re-join, view stays null and the user sits on "Connecting..." with no Leave and
no retry. Give that state an exit.

### R47
fix the offline marker — opacity 0.5 on the whole <li> dims the textual
"offline" marker, which exists precisely so the state is not conveyed by styling alone.
Dim the name only.

### R48, ENDORSING an unrequested change
/start now returns 409 for a restored room
that has state but no started runtime. Without it the host could restart a game in
progress before any socket reconnected, wiping every carved pumpkin. Correct and in the
spirit of the resume work.

### R49
fix it in two places, belt and braces — reorder /start so the 409 precedes any
runtime creation, AND have runtimeFor resume an existing unstarted runtime when the room
has state (safe because resume() is idempotent). Plus REQUIRE the integration test the
re-review asked for: unit tests passing while the HTTP route silently leaves production
without a clock is exactly the gap that produced the bug. Plus clamp the armed remainder to
the phase's configured duration (a backward system clock could otherwise arm a timeout
above 2^31-1 ms, which Node fires after 1ms — turning a long wait into an instant advance).

### R50, ENDORSING an off-list commit
pnpm-lock.yaml was staged though not on the
allowed list. Correct — moving tsx to dependencies changes the lockfile and
--frozen-lockfile would fail without it.

### R51
fix F1 — the anonymity test's positive control is weak. It only scans
container.textContent, so a leak through aria-label/title/alt/data-* would PASS, and
`players` is [] so a leak via players is never exercised. On the project's most
security-sensitive property that is not good enough. Fix: populate both labels and players,
scan ATTRIBUTES as well as text, and make the control a control over the real component
(render a deliberately leaky variant and prove the scan catches it).

### R52
fix F2 — inline `outline: 'none'` on unselected cards beats :focus-visible, and
there are no :focus rules anywhere, so keyboard focus is invisible and the grid is unusable
without a mouse. Stop using outline for selection; use a border/box-shadow/check instead.

### R53
fix F3 — aria-label="Pumpkin N" REPLACES the button's content, so a screen
reader never hears "Yours", "Collapsed" or "Sagging" — exactly the state information the
no-colour-alone rule exists to convey — and it now swallows the results screen's carver
captions too.

### R54, PROMOTED from Minor because T18 now depends on it
PumpkinThumb is always an
interactive button with aria-pressed, so the results screen's static thumbs are focusable
no-ops announced as toggles, and `disabled` dims them to 0.55 which reads as "yours" rather
than "display only". Add a real non-interactive mode and separate dimming from disabling.

### R55, ENDORSING a correction to MY brief
the brief's tests contradicted its own
component — winner cards AND the gallery both render each carver's name, so
getByText('Jocelyn') would throw on multiple matches and the 2-button count was wrong. The
implementer scoped the queries with within() and added group/region landmarks, which is
the right fix and also improves the screen's semantics.

### R56
the attribute scan itself is sound (verified to walk every descendant and
every attribute, no regex g-flag hazard) but NEITHER control proves it. The data- control
sits on a hand-built ROOT div, so deleting the querySelectorAll walk would still pass it;
and the caption control asserts only "length > 0", which textContent alone satisfies, so
it never establishes the nested aria-label was the thing caught. The nested-attribute path
— the realistic regression of someone threading a label into a child — is therefore
unpinned. Fix: move the data- control to a NESTED child, make the controls assert WHICH
source leaked, and add an assertion that the real render yields an EMPTY hit list so the
scan is shown to discriminate in both directions.

### R57, data loss, highest priority of the night
submit() latches sentRef, cancels
the pending save and calls clearDraft BEFORE establishing the send happened — and dispatch
silently drops the message when the socket is not OPEN. A connection blip at the deadline
or on a click therefore loses the pumpkin entirely: never sent, draft deleted, sentRef
blocking any retry so Submit is permanently inert, and a reconnect snapshot does not
re-arm the auto-submit. Before this round a second click worked, so it is a regression.
Fix: do not latch or clear until the send demonstrably went out; make dispatch report
success; retry on reconnect.

### R58, second data-loss path
the draft-clearing effect keys off !inCarving, and the
store's initial view is null, so a transient null view (initial mount, or a reconnect
before the first snapshot) clears the draft. Only clear on an actual non-carving view.

### R59, the budget this task exists to protect
carvedRatio still runs per painted
frame. ~0.7M iterations (2-3ms) at a 20px brush, but at MAX brush (size 0.25, ~357 cells
per point) a full pumpkin is ~5M iterations — 10-20ms per frame, blowing the 16ms budget
and producing exactly the mushy drag the ref design prevents. Throttle the meter recompute
to ~10Hz; keep painting at full rate.

### R60
the "pumpkin is full" cue is a conditionally mounted role="status", which
screen readers commonly miss when inserted together with its content. Render the container
permanently. Also isFull counts the active stroke while extendStroke keeps accepting
points for it — make them agree.

### R61, test strength
the ordering test calls the real carvedRatio as oracle (good)
but ALSO reimplements the grid rule, and its radius is max(size/2, 1/64) where carvedRatio
uses max(size, 1/64)/2 — these differ below size 0.031, which includes the minimum slider
value 0.03. The test uses 0.2 so it cannot see it. And it never exercises
PumpkinPainter.sync, so the painter's own ordering is untested.

### R62
fix the Important finding — a winner whose slot is MISSING from `gallery`
falls into the `winner && entry` else-branch and prints "No votes cast" while
winner.votes > 0. The screen then asserts the opposite of the truth about the one thing it
exists to report. It needs a malformed view to trigger and is untested, but as the reviewer
put it: this screen is the payoff and it should not lie. Fix: separate "no winner at all"
from "winner whose pumpkin is unavailable". Folded in three cheap items (empty-string label
slipping through `??`; the all-undecided test not asserting the gallery renders; the
non-interactive assertion not covering winner-card thumbs).

### R63
the Path2D stub + recording getContext in the painter ordering test is
JUSTIFIED despite this project's "a mocked context only tests the mock" rule. Recording
operation ORDER is the only way to test ordering under jsdom, the test makes no
rasterization claim, and rasterization is covered by Task 19's Playwright run. Noted
limitation: the stub's fill ignores Path2D fills, so stamp ordering is uncovered.

### R64, the project's most load-bearing assertion
the canvas check reads real pixels
via getImageData + FNV, which is the right mechanism, but it proves "pixels changed" not
"the cuts were rasterized". `before` is captured right after toBeVisible with no wait for
the first paint, so a late first paint makes blank->pumpkin satisfy the assertion even if
the drag drew nothing; and ANY repaint satisfies it (the meter redraw, a glow overlay, the
second drag). Nothing asserts the canvas is non-blank or that pixels changed INSIDE the
drag path. Since this is the only place in the project where the carve rasterization ever
executes, the assertion must carry that weight: establish a non-blank baseline, then
assert pixels changed at sampled points ALONG the drag path.

### R65
the README will mislead the user tomorrow. Line ~33 still claims the e2e and
playtest scripts "land with the task" — they exist now. And NOTHING documents the Node 26
playwright-install extraction hang, its Node 22 workaround, the browser cache location, or
the reuseExistingServer stale-server risk. The reviewer's words: "the user will hit it on a
fresh machine." Folded the two banked README items from the deployment review into the
same round (move the HA warning above the deploy block; soften present-tense production
claims) so one agent owns the file.

### R66
tighten the per-phase click race — the test reads a count of other cards and
then clicks, so a phase flip between those steps fails it, inside a 15s phase with a 10s
slack while the host also scans two pages. Restructure so the click resolves against a
locator evaluated at click time. Also derive SLACK and the early-exit bound from the
imported phase durations, and have the GUEST vote too (currently its own-card disabling
and vote path are never exercised, and every phase burns its full 15s).

## Parked findings (code left standing, with reasoning)

- Ruling: install pnpm 10.34.7 globally via npm — Node 26 no longer bundles corepack, and

- Task 5: parked — `action.strokes` is stored by reference, so a caller mutating the array it passed would alter state — Ruling: code stands. On the server, strokes arrive from JSON.parse of a socket frame and no caller retains the array. A defensive copy would cost an allocation per stroke submit for a hazard that cannot occur in this architecture.

- Task 5: parked — `state.pumpkins[by]` is truthy for by='constructor'/'toString', bypassing the unknown-player guard — Ruling: code stands. `by` is never user input; it comes from the authenticated socket and is always a 21-char server-issued id, so the string 'constructor' can never reach it. Object.hasOwn would be marginally more robust; noted for the final review to triage.

- Task 10: parked — a failed saveResult at results is logged and the history record lost — Ruling: acceptable. Results still render from in-memory state, so players see their winners; only the persisted record is missed.

- Task 11: parked — a token-only request returns 200 for a valid token and 400 for an invalid one, a weak validity oracle — Ruling: code stands. The token is an unguessable 21-char id, so the practical risk is nil.

- Task 14: parked — the clock offset includes one-way latency so the countdown runs slightly short — Ruling: acceptable. Sub-100ms on a LAN/Zoom call against a 180s phase.

- Task 12: parked — on-demand runtimes are never disposed — Ruling: acceptable. Pre-start they hold no timers and the store holds the room object anyway.

- Task 16: parked — carvedRatio uses an ELLIPTICAL footprint (dy normalised over 80 cells) while the renderer draws circles, so the meter and picture differ ~25% in y — Ruling: code stands for now. It predates this diff and changing carvedRatio would shift every collapse threshold and invalidate the seeded golden vectors' meaning. FLAGGED for the final review.

- Task 18: parked — `view as ResultsView` is an unchecked cast — Ruling: safe in practice, since App routes on view.kind === 'results'.

- Ruling: park — README does not note DATABASE_URL is CWD-relative, so `pnpm dev` from the repo root and from packages/server use different files. Prod is unaffected (absolute /data). Cost if wrong: brief confusion about which db file is live.

- Ruling: park — the error banner has no dismiss for non-terminal errors (e.g. NO_RUNTIME), so it lingers until the phase changes. Cost if wrong: a stale banner, no loss.

- Ruling: park — the I3 effect key ignores stroke contents. Sound today because the gallery is frozen while the vote screen is mounted. Cost if wrong: a stale thumbnail if a future game mutates a gallery entry in place.
