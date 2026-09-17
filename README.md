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

The initial view is explicitly a **demo** with example attendees/questions.
Choose **초대하기 → 실제 미팅룸 만들기** and share the resulting link.
Actual rooms contain no fake attendees. Every browser tab joins separately;
the profile button changes your name and avatar.

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

The first person is the presenter. Leaving transfers the role to the next
actual participant and ends any screen share. Positions, seats, questions,
votes, hand raising, reactions, title, and slides synchronize in real time.

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

## AI Q&A assistant

Attendees can privately ask a chatbot questions during the session via a
floating widget. It answers only from whatever background context the host
has shared with the room (set via the `room:context` event; the host-facing
UI for authoring that context is a separate effort). Each attendee's chat is
private to their own browser tab and is not persisted or broadcast.

The server calls an OpenAI-compatible chat-completions endpoint, configured
via environment variables:

- `AI_API_KEY` — bearer token for the LLM provider (falls back to `GITHUB_TOKEN`
  if unset; a `models:read`-scoped token works with the default GitHub Models
  endpoint below).
- `AI_API_BASE_URL` — defaults to `https://models.github.ai/inference`. Point
  this at any OpenAI-compatible endpoint, including Copilot's, if you have
  access to one.
- `AI_MODEL` — defaults to `openai/gpt-4o-mini`.

Without a configured key, the widget still opens but returns a clear
"not configured yet" error instead of an answer.

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
