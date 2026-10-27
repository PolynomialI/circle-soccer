# Circle Soccer

Wacky online multiplayer 2D football where every player is a circle. Quick Play 1v1 and 2v2 matchmaking, private rooms (1v1 / 2v2 / 3v3) with invite codes, server-authoritative physics, a big pitch with a camera that follows you, and a bouncy cartoon ball.

## Features

- **Modes:** Quick Play 1v1 and 2v2 queues, plus private rooms with a 5-letter code or invite link (`/?room=CODE`). Pick teams or spectate. The host chooses the mode and starts the match. Any number of matches, queues and rooms run at the same time.
- **Practice vs bots:** Singleplayer (just you and the ball) or 1v1 up to 8v8, where you and bot teammates take on a bot team. 4v4 and up use the 3v3 pitch. Pick a difficulty for each side: Home team (your bot teammates) and Away team (the opponents), each Easy, Intermediate, Hard or 2011 Barcelona. Bot teammates look for you: when you're open they pass to you, chipping it over a defender if the lane is blocked. Bots take on roles that depend on team size: a lone bot plays everywhere, a pair is a sweeper-keeper plus an attacker, and bigger teams have a keeper and defensive, midfield and attacking lines that shift with the ball. 2011 Barcelona is the strongest setting and plays tiki-taka: short passes in triangles, a high line and an instant counter-press.
- **Player History:** players online right now, plus a 7-day chart of players online and private rooms open (with quick-play and practice counts on hover) and how many private rooms were created that week.
- **Possession:** touch the ball to pick it up. It sticks in front of you and swings round to wherever you aim. An opponent who runs into it steals it; teammates pass through it.
- **Charged shots:** hold shoot to power up, then release. Shots stay on the grass, and very hard shots bounce off players instead of sticking. With Mega kick, shots take off, and a full-power one from distance can sail over the bar.
- **Curve:** run sideways while striking and the ball bends that way (Magnus effect).
- **Lobs:** the ball has real height. It flies over players, bounces with decreasing hops, rolls to a stop, and can clip the crossbar.
- **Smart passes:** passes go to the teammate nearest your aim and lead their run.
- **Dash & slide tackle:** both cost stamina. Dashing shoves people; a slide knocks the ball loose and stuns opponents you hit.
- **Cartoon ball:** very bouncy walls, posts and ground, squash and stretch, and a speed trail.
- **Power-ups (rare):** Speed, Mega kick, Giant, Endless stamina. At most one on the pitch, every 25–40 seconds. Active power-ups end when a goal is scored.
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

### Keeping player history across restarts

The web service forgets everything when it restarts, redeploys or sleeps, so the week of player history is saved in a free Render **Key Value** store when the `REDIS_URL` environment variable is set. Without it the game still works and the history simply starts over at each restart.

- Deployed with the Blueprint: `render.yaml` already creates the store (`circle-soccer-history`) and sets `REDIS_URL`. In the Blueprint, click **Sync** to pick up the change.
- Created the web service by hand: in Render choose **New → Key Value**, pick the Free plan and create it. Copy its **Internal Key Value URL**, then open the web service's **Environment** tab, add `REDIS_URL` with that URL and save. The service redeploys and the log shows `Player history: persistent store connected`.

Free Key Value stores keep data in memory, so a rare restart of the store itself would clear the history.

## How it works

- `server/match.js`: one match. A fixed 60 Hz simulation with 4 physics substeps, plus the rules (countdown, goals, golden goal, forfeits) and snapshots.
- `server/physics.js`: circle and segment collision helpers.
- `server/lobby.js`: Socket.IO handling, matchmaking queues, private rooms, and the loop that steps every match and broadcasts 30 Hz snapshots.
- `server/config.js`: every gameplay number (speeds, powers, timings) in one place.
- `server/bots.js`: the bot AI. Role templates per team size, difficulty profiles, and keeper, defender, midfielder, forward and solo behaviour. Bots send the same inputs a human does.
- `server/history.js`: the 7-day player history, optionally saved to Key Value / Redis.
- `public/`: the browser client. Canvas rendering with interpolation between snapshots (`js/render.js`), the 3D-rolled soccer ball (`js/ball.js`), input and key bindings (`js/input.js`, `js/settings.js`), synthesized sound (`js/audio.js`), and UI and networking (`js/main.js`).
