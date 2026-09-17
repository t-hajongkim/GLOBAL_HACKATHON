# GLOBAL_HACKATHON

## 모여극장 · Pixel Meet

An original pixel-art cinema metaverse: walk around, take a seat, watch a
presentation, raise a hand, ask questions, and send live emoji reactions.
All artwork is original SVG/CSS; no game assets, external fonts, analytics,
or third-party hosted services are used.

## Run (Windows, Node.js 22.12+)

```powershell
npm install
npm run dev
```

Open **http://localhost:4317**. Vite proxies realtime traffic to the room
server on `127.0.0.1:4318`. Ctrl+C stops both processes.

The initial screen asks you to choose **Host** or **Attendee**.
Hosts name and create a new room and may select presentation materials before
opening it. Files finish uploading before the host enters the theater.
Attendees enter a host's invite link or room code; a missing room is never
created by an attendee. The invite URL preselects Attendee.
**먼저 체험해 보기** opens a clearly labeled demo with example attendees.
Actual rooms contain no simulated participants. Every browser tab joins separately.

| Action | Control |
| --- | --- |
| Walk / stand up | WASD, arrows, click the floor, or mobile direction buttons |
| Sit | Click an empty seat |
| Return to the entrance | 둘러보기 |
| Raise/lower hand | H or 손들기 |
| React | 1–6 or emoji buttons |
| Question | Q or question panel |
| Focus presentation | F; Escape returns |
| Present | Presenter-only slide arrows and 화면 공유 |
| Stream a Teams meeting window | Teams 창 공유 → select window → confirm preview |

The room creator is the Host/presenter. Leaving transfers the role to the next
actual participant and ends any screen share. Positions, seats, questions,
votes, hand raising, reactions, title, and slides synchronize in real time.

## Host materials and future agents

Hosts can upload up to **5 files, 10 MB each** when creating a room:
PDF, PPTX, DOCX, UTF-8 TXT/MD/CSV, PNG, and JPEG. The room's **자료** button lets
participants download the originals. This does not convert slides, run an AI
model, or automatically show the uploaded document on the theater screen.

The agent-facing contract is defined in `src\shared\protocol.ts`:

| Endpoint | Authorization | Result |
| --- | --- | --- |
| `POST /api/rooms/:roomId/materials?name=<URL-encoded-filename>` | Host session | Upload raw `application/octet-stream`; returns material metadata |
| `GET /api/rooms/:roomId/materials` | Room participant session | `{ roomId, materials: RoomMaterial[] }` |
| `GET /api/rooms/:roomId/materials/:materialId/content` | Room participant session | Original file, downloaded as attachment |

`room:join` now requires `role: "host" | "attendee"` and accepts an optional
`title` for new rooms. Its acknowledgement includes a private `accessToken`
and the server-assigned `role`. Send `Authorization: Bearer <accessToken>` to
the material endpoints. Tokens are not broadcast, stored in the URL, or kept
in localStorage. They expire on disconnect/leave and cannot access other rooms.
Choosing Host for an already occupied room does not grant host permissions.

`RoomMaterial` contains `id`, `roomId`, `name`, `mimeType`, `size`, `sha256`,
`createdAt`, `uploadedBy`, and a relative `contentUrl`. Socket `room:state`
includes metadata only, never file bytes or access tokens. A future agent
can join as an attendee, use its own session token, fetch materials, and
perform its own processing. Keep that socket connected while accessing files.
There is no public, unauthenticated file URL or implemented AI pipeline.

Original files are stored in ignored `data\uploads`, under generated IDs, and
deleted when the last real participant leaves. Room metadata and tokens are
in memory: restart does not restore rooms. A forced process crash may leave
inaccessible files in this directory; production requires an object store,
retention/cleanup policy, authentication, and document malware scanning.
Header validation is not a malware scanner; do not open untrusted downloads.

## Teams window streaming

This is a **continuous, live window capture**, not screenshots and not a
Teams/Graph API integration. It requires no Microsoft credentials or meeting
bot. The room presenter manually selects the Teams desktop window or web tab
in the browser's native picker; the application cannot select or identify a
Teams window automatically.

1. Join the actual Teams meeting and open the presentation in its own window
   where possible. Keep that window open, not minimized.
2. In Pixel Meet, click **Teams 창 공유 → Teams 창 선택**. Pick the Teams window
   or Teams browser tab, never Pixel Meet itself. Full-monitor selections are
   rejected when the browser identifies them.
3. Check the **private live preview** for unintended chats, participants, and
   notifications, then click **이 화면을 극장에 공유**.
4. All room participants, including later arrivals, receive the live video.
   **공유 중지**, the browser's stop-sharing control, or leaving the room ends it.

Before confirmation, captured media stays in the presenter's browser and is
not transmitted. Closing the dialog releases the preview. The browser must
request capture permission each time; organization capture policies still
apply. A minimized, closed, or protected Teams window may stop providing frames.

**Audio stays in Teams.** Teams mode requests no audio and removes any returned
audio tracks to prevent feedback/double playback. It neither records nor saves
the captured content. Generic **화면 공유** remains available with optional audio.
Teams participants, chat, and reactions are not automatically synchronized:
users join the Pixel Meet room separately using its invite link.

## Other devices

```powershell
npm run dev:lan
```

Open `http://<this-PC-LAN-IP>:4317` on the same trusted network. Windows
may need a user-approved firewall rule. A localhost link only works on this PC.

Starting screen capture requires **a desktop browser and HTTPS or localhost**.
For generic screen shares, viewers click **발표 소리 켜기** to unmute shared tab/system audio, if selected
in the browser picker. This application does not include microphone calls,
camera calls, or recording.

Screen sharing uses direct WebRTC, without external STUN/TURN servers.
Restrictive firewalls/NAT or different networks may require a separately
configured TURN service; this local prototype does not configure one.

## Build and run

```powershell
npm run build
npm start
```

Open **http://localhost:4318**. The Node server serves the built UI and realtime
endpoint together. Set `$env:HOST` and `$env:PORT` to override its loopback
address/port. Public deployment needs HTTPS, authentication, and WebSocket
proxying that preserves the original Host/Origin consistently.

Room state is in memory. The last real person leaving or a server restart
deletes the room's questions and other state. Capacity is one presenter plus
24 seats. Anyone with the room URL can join: this is a small-group prototype,
not an authenticated enterprise meeting service.

## Checks

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

Browser checks use the installed Microsoft Edge browser (`channel: 'msedge'`
in `playwright.config.ts`). Install Edge if that executable is missing.
The checks cover the demo, responsive layout, multi-client movement/seats,
questions, reactions, private Teams preview/cancellation/permission failures,
late viewers, advancing video frames, audio exclusion, browser stop-sharing,
and actual WebRTC transmission using a test-only canvas
capture stream instead of the operating system's screen-picker dialog.

To run browser checks against an already running production build instead of
the development server, set `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4318'`
before `npm run test:e2e`. This avoids rebuilds and hot reloads during a check.

`src\components` contains the UI/art; `src\hooks` contains realtime/media clients;
`src\shared\protocol.ts` defines typed events; `server` contains validation,
room state and integration tests; `e2e` contains browser scenarios.
