# CommonGround

CommonGround is a small-group decision app built on DeepSpace 0.44.2, React, and Cloudflare Workers. Create a room, share an invitation, suggest options, rate how well they work for you, discuss them, and vote. Each person has one changeable vote; only the host can close voting.

## Run locally

The repository is already scaffolded and authenticated. Start the server if it is not running:

```sh
npm run dev
```

Open the URL printed by the CLI. `/` is the public introduction; `/home` requires sign-in. Room and invitation URLs use `/home?room=…` and `/home?invite=…`. Google/GitHub sign-in uses DeepSpace's existing authentication UI. The CLI login and browser user login are separate sessions.

No external database, auth provider integration, messaging service, or AI service was added. The original DecisionRoom MVP was deployed to https://decisionroom-fiona.app.space/ and published at https://github.com/fiona112/decisionroom. The new CommonGround changes are not yet pushed or deployed.

## How the app works

A **Worker** is the HTTP server. It checks the signed-in identity before accepting commands. A **Durable Object** is the app's single stateful backend: DeepSpace stores its records in SQLite and broadcasts accepted changes over WebSockets. React subscribes with `useQuery`, so another person's vote or comment appears without refreshing.

All domain writes go through `/api/actions/decision`. Ordinary record writes are denied for every role, including app admins. This is deliberate: simple row permissions cannot express rules such as “this option must belong to this room” or “only accept a vote while voting is open.” The server command checks these rules using the verified identity, ignoring any claimed user/host ID in the input.

The existing authenticated server action forwards to an internal command handler on the app's `RecordRoom`. `blockConcurrencyWhile` runs commands in order within that Durable Object. A vote cannot read “open,” wait while a close commits, and then write a late vote. There are no external network calls inside this critical section; it calls the SDK's record handlers locally, preserving validation, SQLite storage, and live broadcasts. This is a practical small-app design, not a high-volume multi-tenant architecture.

The internal command path is not exposed by the public Worker router. The Worker constructs its identity headers after authentication. Browser/agent record tool calls continue to use normal SDK permissions and cannot opt into privileged writes using spoofed headers.

## Data model

Every collection also has DeepSpace's record ID, creator, and created/updated timestamps.

| Collection | Main fields | Rules |
| --- | --- | --- |
| `rooms` | `teamId`, title, description, `hostId`, status, `closedAt` | `teamId` equals the room record ID; only host can close |
| `team_members` | `teamId`, `userId`, status | Unique `(teamId, userId)`; created only by room creation or a valid invitation |
| `invitations` | `teamId`, random UUID token | One invitation per room; readable only by room members |
| `suggestions` | `teamId`, title, description, `authorId` | Only members can add; voting must be open |
| `votes` | `teamId`, `userId`, `suggestionId` | Unique `(teamId, userId)`; changes update the existing vote |
| `ratings` | `teamId`, `userId`, `suggestionId`, `score` | Unique `(teamId, userId, suggestionId)`; scores are 1–5 and changeable until close |
| `comments` | `teamId`, body, `authorId` | Members can discuss before and after voting closes |

All seven collections use DeepSpace's `teamField` and `read: 'team'` permissions. Membership is checked on the server before records are sent to a browser. Knowing a room ID is not enough to read it. The shared app user roster exposes the SDK's public identity projection (names/images), but regular users do not get other users' emails.

The bundled messaging schemas are public-channel schemas. They would not make a room's discussion private, so this app uses its own `comments` collection with the same room membership permissions as votes and suggestions. This follows DeepSpace's documented approach for private discussions.

## MVP choices and limits

- Anyone holding an invitation can join after signing in. Members can copy/share it. Invitations do not expire; revocation and member removal are deferred.
- Votes are visible to room members, not secret ballots. The UI displays totals and highlights your own choice.
- One vote per person per room. Changing it replaces the earlier choice; there is no withdraw-vote button.
- Closing is final: suggestions and votes lock, while discussion remains available. Ties are shown explicitly; the app does not invent a tie-breaker.
- Up to 100 members and 50 suggestions per room, enforced by the server. These limits keep complete live results within bounded query sizes.
- Dashboard shows the latest 500 accessible rooms. Discussion shows the latest 100 comments, oldest first within that window; older comments remain stored.
- Titles are limited to 120 characters; descriptions and comments to 2,000. Empty/whitespace-only submissions are rejected by the backend.
- The UI preserves drafts on a network interruption and disables writes when the browser reports offline. It waits for a successful server response before showing a saved vote or clearing a comment.
- No editing/deleting suggestions, room deletion, ranked voting, notifications, attachments, AI, or analytics. Those would expand the five-day scope.
- Room creation uses compensating cleanup if one of its setup writes fails. It is not a multi-record database transaction. If a process dies during setup, orphaned setup records may need administrative repair.
- Vote updates and repeated joins are naturally repeatable. Room, option, and comment creation do not yet have durable idempotency keys; if a response is lost after saving, check the room before retrying.

## Code map

- `src/schemas/decision-schema.ts`: collections, read permissions, uniqueness constraints, shared types.
- `src/server/decision-commands.ts`: validated business rules and command dispatch.
- `src/actions/index.ts`: authenticated forwarding into the app RecordRoom.
- `worker.ts`: serialized command boundary; existing DeepSpace Worker assembly.
- `src/lib/decisions.ts`: authenticated HTTP command client.
- `src/lib/use-network-online.ts`: browser online/offline state.
- `src/pages/(app)/(protected)/home.tsx`: dashboard and invitation entry.
- `src/components/decisions/RoomView.tsx`: live options, results, close control, and discussion.
- `src/components/decisions/shared.tsx`: creation forms and loading/error feedback.
- `src/decisionroom.css`, `src/themes.css`: responsive layout and DecisionRoom theme.
- `tests/decisionroom.spec.ts`: real multi-user workflow and adversarial backend tests.

## Checks

```sh
npm run validate             # TypeScript + existing prerender unit tests
npm run lint
npm run build                # Local build only; does not deploy
npx deepspace test run e2e --port 5183
```

Use a free port different from the development server's port. The Playwright config starts its own server with `DECISIONROOM_TEST=true`; Vite then uses ephemeral Durable Object storage, leaving normal development records alone. Three usable test accounts are required for DecisionRoom tests. Existing test credentials stay in DeepSpace's local credential store, not in this repository. The three accounts created for verification can be reused in future runs.

The browser suite covers:

- Authentication gating and rejection of forged authentication.
- Three separate signed-in users, including an excluded outsider.
- UI room creation, actual invitation-link clipboard copy, invitation joining, and repeated joins.
- Suggestions, live vote totals, vote changes, live discussion, and reload persistence.
- Outsider reads of every domain collection before and after the room has content.
- Direct record-write rejection, spoofed identity/internal headers, cross-room voting, invalid inputs, and non-host closing.
- Eight concurrent votes from one person producing one vote row; close/vote races; immutability of votes after close.
- Offline indication, draft preservation, resuming after the browser goes online, and new messages becoming visible.
- Mobile layout at 390px, with no horizontal overflow, plus desktop/mobile screenshots.

Screenshots are written under `.deepspace/test-results/` (ignored by Git). The three unit tests cover existing prerender behavior; business-rule coverage is through the real browser/Worker tests, not an in-memory mock.

## Manual verification before release

1. Use real Google and GitHub accounts to sign in, including following an invitation while signed out. Confirm the invitation survives the OAuth round trip.
2. Try Safari/iOS and a second physical device on the eventual HTTPS address. Chromium desktop/mobile-size checks are not a substitute for actual mobile browsers.
3. Stop and restart the normal local dev server and confirm stored rooms survive. Automated reload checks cover browser refresh; test storage is intentionally ephemeral and does not test process-restart durability.
4. Exercise an actual WebSocket/network drop (Wi-Fi off or server restart) and reconnect. Chromium's offline emulation does not necessarily terminate an already-open WebSocket.
5. Check clipboard permission denial, keyboard-only navigation, and a screen reader. A selectable invitation URL is shown if clipboard access fails.
6. Run the suite again before release, then review schema/data migrations and deployment configuration. The original MVP was subsequently pushed and deployed; CommonGround still needs its own release verification.

## Documentation used

- [DeepSpace documentation index](https://docs.deep.space/llms.txt)
- [Permissions, including the one-vote-per-user and shared workspace examples](https://docs.deep.space/concepts/permissions.md)
- [Messaging and its public-chat example](https://docs.deep.space/guides/messaging.md)
- [Authentication](https://docs.deep.space/guides/authentication.md)
- [Schemas reference](https://docs.deep.space/sdk-reference/worker/schemas.md)
- [Durable Object rooms reference](https://docs.deep.space/sdk-reference/worker/rooms.md)
- [Testing](https://docs.deep.space/guides/testing.md)

`AGENTS.md` was read, and installed 0.44.2 types/CLI help were used to resolve version-specific details. No bundled DeepSpace `SKILL.md` was found in the repository, installed package, or local skill directories searched. No optional skill was installed.

## Production-readiness review — November 19, 2026

The local review found and fixed an inherited billing authorization issue: unconfigured integration requests previously defaulted to using the app owner's credentials. Both HTTP integration forwarding and server-action integration helpers now require an explicit entry in `src/integrations.ts`. The existing entries are user-billed; no owner-billed service is enabled. A browser regression test confirms an unconfigured OpenAI request is rejected locally.

The final checks passed: TypeScript, lint, three prerender unit tests, and all 15 Playwright tests. The adversarial tests now additionally open raw WebSockets: anonymous reads across all six original app collections return nothing, forged identity/role URL parameters grant no access, and direct record writes are refused for anonymous and signed-in clients. This describes the November 19 pre-release review of the original MVP. That original app was subsequently deployed; the CommonGround update has not been deployed.

Credential review: at the time of the original review, the repository had no commits or staged files. Source files eligible for a commit and browser build assets were scanned for private keys, JWT/provider-token literals, credential assignments, and matches to local secret values; none were found. `.dev.vars`, `.deepspace`, and build output are ignored. `.env` variants and private-key files are now ignored too. The generated server-side `dist/decisionroom/.dev.vars` is a local build artifact, not a browser asset; do not distribute the entire `dist` directory as a static website.

Remaining release qualifications are the manual checks above, plus these operational MVP limits: there is no app-specific rate limiter, storage-growth policy, invitation revocation, or load-test evidence; room creation is not a multi-record transaction; and creates do not have durable retry/idempotency keys. The single app Durable Object and serialized commands are intended for a small internship/demo workload. The original source was subsequently committed and deployed; this paragraph records the earlier review state.

## CommonGround update (November 19, 2026)

This codebase is being renamed from DecisionRoom to **CommonGround**: *Different preferences. Better decisions.* It preserves existing rooms, invitations, votes, and comments. The immutable `DEEPSPACE_APP_ID` is unchanged. The desired new hostname in `wrangler.toml` is `commonground-fiona.app.space`; **availability and successful deployment have not been verified**. The old deployment was `https://decisionroom-fiona.app.space/`.

### What's new: group fit

Every room member may give each suggestion a separate **optional 1–5 fit rating**. Ratings can change while the room is open, and each `(room, user, suggestion)` tuple is unique. Member-only reads and backend-only writes use the same private team permissions and serialized authenticated commands as ordinary voting. Ratings lock when the host closes the room. Existing single-choice voting is **still the only mechanism for final vote results**.

The Group fit panel sorts rated options by the **average of submitted scores** (`average / 5 × 100`, rounded for display), breaking equal averages by the number of distinct raters. It shows **X of Y members rated**, explicitly labels incomplete participation, and does not count missing ratings as zero. Percentages are descriptive, not probabilities, confidence measures, or automatically selected winners. Members can see ratings for their room; the interface only highlights their own per-option rating.

**Updated files:** `src/schemas/decision-schema.ts` (private `ratings` collection), `src/server/decision-commands.ts` (`rate` validation and enforcement), `src/components/decisions/RoomView.tsx` (rating buttons and live ranking), `src/lib/group-fit.ts` (pure calculation), `src/lib/group-fit.test.ts` (calculation unit tests), `tests/decisionroom.spec.ts` (end-to-end rating regression), plus branding, CSS, metadata, and deployment configuration.

**Important verification before pushing or deploying:** run `npm ci`, `npm run validate`, `npm run lint`, `npm run build`, and `npx deepspace test run e2e --port 5183` on the Mac. These CommonGround changes **have not yet passed local TypeScript/build/browser tests in the assistant's sandbox**, because dependencies could not be fully installed there. Verify OAuth, multi-user ratings, existing voting, room closing, and real-time updates on the new production URL after successful deployment. Do not interpret previously reported DecisionRoom test results as tests of this update.

**Scope tradeoff:** ratings are visible to other room members in the underlying records; this isn't anonymous preference collection. There is no required participation, rating withdrawal, weighted voting, or AI/external recommendation service. The calculation intentionally prioritizes a transparent comparison over a complicated or opaque fairness algorithm.
