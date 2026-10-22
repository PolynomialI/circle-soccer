# Circle Soccer

Wacky online multiplayer 2D football where every player is a circle. Quick Play 1v1 and 2v2 matchmaking, private rooms (1v1 / 2v2 / 3v3) with invite codes, server-authoritative physics, a big pitch with a camera that follows you, and a bouncy cartoon ball.

## Features

- **Modes:** Quick Play 1v1 and 2v2 queues, plus private rooms with a 5-letter code or invite link (`/?room=CODE`). Pick teams or spectate. The host chooses the mode and starts the match. Any number of matches, queues and rooms run at the same time.
- **Possession:** touch the ball to pick it up. It sticks in front of you and swings round to wherever you aim. An opponent who runs into it steals it; teammates pass through it.
- **Charged shots:** hold shoot to power up, then release. Charged shots skip along the grass, and very hard shots bounce off players instead of sticking.
- **Curve:** run sideways while striking and the ball bends that way (Magnus effect).
- **Lobs:** the ball has real height. It flies over players, bounces with decreasing hops, rolls to a stop, and can clip the crossbar.
- **Smart passes:** passes go to the teammate nearest your aim and lead their run.
- **Dash & slide tackle:** both cost stamina. Dashing shoves people; a slide knocks the ball loose and stuns opponents you hit.
- **Cartoon ball:** very bouncy walls, posts and ground, squash and stretch, and a speed trail.
- **Power-ups (rare):** Speed, Mega kick, Giant, Endless stamina. At most one on the pitch, every 25–40 seconds.
- **Rules:** 3-minute matches with golden goal if tied. Goals record the scorer, assist and own goals. A team that empties forfeits.
- **Settings:** every key can be rebound (saved in the browser), plus a volume control.

## Default controls

| Action | Key |
| --- | --- |
| Move | W A S D |
| Aim | Arrow keys (with none held, you aim where you run) |
| Shoot (hold to charge) | Space |
| Lob (hold to charge) | Q |
| Pass | E |
| Dash | Left Shift |
| Slide tackle | F |
| Menu | Esc |

## Run locally

Requires Node 20+.

```bash
npm install
npm start          # http://localhost:3000
npm test           # physics + multiplayer tests
```

Open two browser windows to play against yourself, or create a private room and start it alone to practise.

## Deploy on Render

1. Push this repo to GitHub.
2. In the Render dashboard choose **New → Blueprint**, pick this repo and click **Apply**. Render reads `render.yaml` and creates a free Node web service.
   - Or by hand: **New → Web Service**, pick the repo, Build Command `npm ci --omit=dev`, Start Command `npm start`, instance type Free.
3. Open the `https://<service>.onrender.com` URL and share it.

Notes: free Render services sleep after ~15 minutes without traffic, so the first visit after that takes about a minute. All rooms live in memory on one instance, so a redeploy or restart ends matches in progress.

## How it works

- `server/match.js`: one match. A fixed 60 Hz simulation with 4 physics substeps, plus the rules (countdown, goals, golden goal, forfeits) and snapshots.
- `server/physics.js`: circle and segment collision helpers.
- `server/lobby.js`: Socket.IO handling, matchmaking queues, private rooms, and the loop that steps every match and broadcasts 30 Hz snapshots.
- `server/config.js`: every gameplay number (speeds, powers, timings) in one place.
- `public/`: the browser client. Canvas rendering with interpolation between snapshots (`js/render.js`), the 3D-rolled soccer ball (`js/ball.js`), input and key bindings (`js/input.js`, `js/settings.js`), synthesized sound (`js/audio.js`), and UI and networking (`js/main.js`).
