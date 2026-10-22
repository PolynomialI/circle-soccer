import { BallSkin } from './ball.js';

export const TEAMS = [
  { name: 'RED', main: '#ef4b4b', light: '#ff9a8f', dark: '#9e2424' },
  { name: 'BLUE', main: '#3d8bff', light: '#9cc4ff', dark: '#1d4fa8' },
];
const PU_COLORS = { speed: '#4fd1ff', mega: '#ff8a3d', giant: '#b77bff', energy: '#59e07a' };
const PU_NAMES = { speed: 'Speed', mega: 'Mega kick', giant: 'Giant', energy: 'Endless stamina' };
const HUD_H = 64;
const STATE = { normal: 0, dash: 1, slide: 2, recover: 3, stunned: 4 };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.init = null;
    this.ballSkin = new BallSkin();
    this.particles = [];
    this.floaters = [];
    this.banners = [];
    this.shake = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setMatch(init) {
    this.init = init;
    this.pitchCache = null;
    this.ballSkin = new BallSkin();
    this.particles = [];
    this.floaters = [];
    this.banners = [];
    this.shake = 0;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.pitchCache = null;
  }

  layout() {
    const f = this.init.field;
    this.worldW = f.width + 2 * (f.goalDepth + 25);
    this.worldH = f.height + 2 * (f.playerMargin + 6);
    this.scale = Math.min(this.w / this.worldW, (this.h - HUD_H - 8) / this.worldH);
    this.cx = this.w / 2;
    this.cy = HUD_H + (this.h - HUD_H) / 2;
  }

  // ---- static pitch (flat colours, cached) ---------------------------------------

  buildPitch() {
    const f = this.init.field;
    const c = document.createElement('canvas');
    const s = this.scale * this.dpr;
    c.width = Math.ceil(this.worldW * s);
    c.height = Math.ceil(this.worldH * s);
    const g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, c.width / 2, c.height / 2);

    const hw = f.width / 2;
    const hh = f.height / 2;
    const gw = f.goalWidth / 2;

    g.fillStyle = '#2b7a3a';
    roundRect(g, -this.worldW / 2, -this.worldH / 2, this.worldW, this.worldH, 18);
    g.fill();

    const bands = 12;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = i % 2 ? '#3a984a' : '#41a352';
      g.fillRect(-hw + (f.width / bands) * i, -hh, f.width / bands + 0.5, f.height);
    }

    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.strokeRect(-hw, -hh, f.width, f.height);
    g.beginPath();
    g.moveTo(0, -hh);
    g.lineTo(0, hh);
    g.stroke();
    const cr = Math.min(85, f.height * 0.16);
    g.beginPath();
    g.arc(0, 0, cr, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(0, 0, 4, 0, Math.PI * 2);
    g.fill();

    for (const side of [-1, 1]) {
      const boxD = f.width * 0.13;
      const boxH = gw + f.height * 0.17;
      g.strokeRect(side < 0 ? -hw : hw - boxD, -boxH, boxD, boxH * 2);
      const smallD = f.width * 0.045;
      g.strokeRect(side < 0 ? -hw : hw - smallD, -(gw + 20), smallD, (gw + 20) * 2);
      g.beginPath();
      g.arc(side * (hw - f.width * 0.1), 0, 3.5, 0, Math.PI * 2);
      g.fill();
      for (const sy of [-1, 1]) {
        g.beginPath();
        g.arc(side * hw, sy * hh, 14, sy < 0 ? (side < 0 ? 0 : Math.PI / 2) : (side < 0 ? -Math.PI / 2 : Math.PI), sy < 0 ? (side < 0 ? Math.PI / 2 : Math.PI) : (side < 0 ? 0 : -Math.PI / 2), false);
        g.stroke();
      }
    }

    // Goals: flat tinted net box. Red defends the left goal.
    for (const side of [-1, 1]) {
      const team = side < 0 ? TEAMS[0] : TEAMS[1];
      const x0 = side < 0 ? -hw - f.goalDepth : hw;
      g.fillStyle = 'rgba(15, 25, 20, 0.55)';
      g.fillRect(x0, -gw, f.goalDepth, gw * 2);
      g.fillStyle = hexAlpha(team.main, 0.22);
      g.fillRect(x0, -gw, f.goalDepth, gw * 2);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(side * hw, -gw);
      g.lineTo(side * (hw + f.goalDepth), -gw);
      g.lineTo(side * (hw + f.goalDepth), gw);
      g.lineTo(side * hw, gw);
      g.stroke();
      for (const sy of [-1, 1]) {
        g.beginPath();
        g.arc(side * hw, sy * gw, f.postRadius, 0, Math.PI * 2);
        g.fillStyle = '#f4f4f4';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.stroke();
      }
    }
    this.pitchCache = c;
  }

  // ---- per-frame drawing ------------------------------------------------------------

  draw(view, ctxInfo, dt) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#122a1b';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.init || !view) return;
    this.layout();
    if (!this.pitchCache) this.buildPitch();

    this.shake = Math.max(0, this.shake - dt * 30);
    const sx = (Math.random() * 2 - 1) * this.shake;
    const sy = (Math.random() * 2 - 1) * this.shake;

    const s = this.scale;
    ctx.drawImage(
      this.pitchCache,
      this.cx - (this.worldW * s) / 2 + sx,
      this.cy - (this.worldH * s) / 2 + sy,
      this.worldW * s,
      this.worldH * s,
    );
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.cx + sx), this.dpr * (this.cy + sy));

    const now = performance.now() / 1000;
    for (const pu of view.powerups) this.drawPowerup(pu, now);
    this.drawBallShadow(view.ball);
    for (const p of view.players) this.drawPlayerBase(p, ctxInfo, now);
    this.drawBall(view.ball, dt);
    for (const p of view.players) this.drawPlayerOverlay(p, ctxInfo, view.ball, now);
    this.updateParticles(dt);
    this.drawFloaters(now);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(view, ctxInfo, now);
  }

  drawPowerup(pu, now) {
    const ctx = this.ctx;
    const r = this.init.powerupRadius;
    if (pu.ttl < 3 && Math.floor(now * 8) % 2 === 0) return; // blink before vanishing
    const color = PU_COLORS[pu.type];
    const pulse = 1 + Math.sin(now * 5) * 0.08;
    const glow = ctx.createRadialGradient(pu.x, pu.y, r * 0.5, pu.x, pu.y, r * 2.1);
    glow.addColorStop(0, hexAlpha(color, 0.5));
    glow.addColorStop(1, hexAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, r * pulse, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();

    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const k = r * 0.5;
    ctx.beginPath();
    if (pu.type === 'speed') {
      for (const off of [-0.45, 0.35]) {
        ctx.moveTo((off - 0.3) * k, -0.7 * k);
        ctx.lineTo((off + 0.3) * k, 0);
        ctx.lineTo((off - 0.3) * k, 0.7 * k);
      }
      ctx.stroke();
    } else if (pu.type === 'mega') {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? k * 0.45 : k;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    } else if (pu.type === 'giant') {
      ctx.moveTo(0, k);
      ctx.lineTo(0, -k);
      ctx.moveTo(-0.6 * k, -0.35 * k);
      ctx.lineTo(0, -k);
      ctx.lineTo(0.6 * k, -0.35 * k);
      ctx.stroke();
    } else {
      ctx.moveTo(0.2 * k, -k);
      ctx.lineTo(-0.5 * k, 0.1 * k);
      ctx.lineTo(0.05 * k, 0.1 * k);
      ctx.lineTo(-0.2 * k, k);
      ctx.lineTo(0.5 * k, -0.15 * k);
      ctx.lineTo(-0.05 * k, -0.15 * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawPlayerBase(p, info, now) {
    const ctx = this.ctx;
    const r = info.roster.get(p.idx);
    if (!r) return;
    const team = TEAMS[r.team];

    if (p.state === STATE.dash || p.state === STATE.slide) {
      for (let k = 3; k >= 1; k--) {
        ctx.beginPath();
        ctx.arc(p.x - p.vx * 0.025 * k, p.y - p.vy * 0.025 * k, p.r * (1 - k * 0.08), 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(team.main, 0.18 - k * 0.04);
        ctx.fill();
      }
    }

    const fx = p.fx;
    if (fx) {
      const glowColor = fx[1] > 0 ? PU_COLORS.mega : fx[0] > 0 ? PU_COLORS.speed : fx[3] > 0 ? PU_COLORS.energy : PU_COLORS.giant;
      const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.8, p.x, p.y, p.r * 1.7);
      g.addColorStop(0, hexAlpha(glowColor, 0.55 + Math.sin(now * 8) * 0.15));
      g.addColorStop(1, hexAlpha(glowColor, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.ellipse(p.x + 3, p.y + 4, p.r, p.r * 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    const body = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
    body.addColorStop(0, team.light);
    body.addColorStop(1, p.state === STATE.stunned ? team.dark : team.main);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = team.dark;
    ctx.stroke();

    if (p.idx === info.me) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 3.5, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `700 ${Math.round(p.r * 0.85)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(r.num), p.x, p.y + 1);
  }

  drawPlayerOverlay(p, info, ball, now) {
    const ctx = this.ctx;
    const r = info.roster.get(p.idx);
    if (!r) return;
    const isMe = p.idx === info.me;
    let aimX = p.aimX;
    let aimY = p.aimY;
    let charge = p.charge;
    let ct = p.ct;
    if (isMe && info.localAim) {
      aimX = info.localAim.x;
      aimY = info.localAim.y;
    }
    if (isMe && info.localCharge !== undefined) {
      ct = info.localCharge ? info.localCharge.type : 0;
      charge = info.localCharge ? info.localCharge.value : 0;
    }

    // Aim arrow; turns gold when the ball is close enough to kick.
    const kickable = isMe && this.canKick(p, aimX, aimY, ball);
    const ar = p.r + 7;
    const ax = p.x + aimX * ar;
    const ay = p.y + aimY * ar;
    const px = -aimY;
    const py = aimX;
    ctx.beginPath();
    ctx.moveTo(ax + aimX * 8, ay + aimY * 8);
    ctx.lineTo(ax + px * 6, ay + py * 6);
    ctx.lineTo(ax - px * 6, ay - py * 6);
    ctx.closePath();
    ctx.fillStyle = kickable ? '#ffd447' : isMe ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)';
    ctx.fill();

    if (ct) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 4, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = ct === 2 ? '#7fe3ff' : `hsl(${50 - charge * 50}, 100%, 55%)`;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    if (p.state === STATE.stunned) {
      for (let i = 0; i < 3; i++) {
        const a = now * 5 + (i * Math.PI * 2) / 3;
        star(ctx, p.x + Math.cos(a) * p.r * 0.8, p.y - p.r - 6 + Math.sin(a) * 4, 4, '#ffe066');
      }
    }

    if (isMe) {
      const w = 36;
      const frac = Math.max(0, Math.min(1, p.stamina / this.init.staminaMax));
      const y = p.y + p.r + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(p.x - w / 2, y, w, 4);
      ctx.fillStyle = frac >= this.init.dashCost / this.init.staminaMax ? '#7cf29a' : '#f2b84b';
      ctx.fillRect(p.x - w / 2, y, w * frac, 4);
    }

    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(r.name, p.x + 1, p.y - p.r - 5);
    ctx.fillStyle = isMe ? '#ffe680' : '#ffffff';
    ctx.fillText(r.name, p.x, p.y - p.r - 6);
  }

  canKick(p, aimX, aimY, ball) {
    if (ball.z >= this.init.playerHeight) return false;
    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > p.r + this.init.ballRadius + this.init.kickReach) return false;
    return d < 1e-6 || (dx * aimX + dy * aimY) / d > -0.3;
  }

  drawBallShadow(b) {
    const ctx = this.ctx;
    const r = this.init.ballRadius;
    const lift = Math.min(b.z / 150, 0.6);
    ctx.beginPath();
    ctx.ellipse(b.x + 2 + b.z * 0.35, b.y + 3 + b.z * 0.35, r * (1 - lift * 0.4), r * 0.9 * (1 - lift * 0.4), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - lift)})`;
    ctx.fill();
  }

  drawBall(b, dt) {
    const r = this.init.ballRadius;
    this.ballSkin.update(b.x, b.y, r, b.spin, dt);
    this.ballSkin.draw(this.ctx, b.x, b.y, r * (1 + b.z / 110));
  }

  // ---- effects --------------------------------------------------------------------

  burst(x, y, color, count, speed, life = 0.6, size = 3) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: size * (0.6 + Math.random() * 0.8) });
    }
  }

  updateParticles(dt) {
    const ctx = this.ctx;
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      const f = Math.exp(-3 * dt);
      pt.vx *= f;
      pt.vy *= f;
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  floater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, t0: performance.now() / 1000 });
  }

  drawFloaters(now) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 15px system-ui, sans-serif';
    for (const f of this.floaters) {
      const t = now - f.t0;
      ctx.globalAlpha = Math.max(0, 1 - t / 1.2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(f.text, f.x + 1, f.y - 30 - t * 30 + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - 30 - t * 30);
    }
    ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => now - f.t0 < 1.2);
  }

  banner(text, sub, color, dur = 2.2) {
    this.banners = [{ text, sub, color, t0: performance.now() / 1000, dur }];
  }

  onEvent(ev, view, info, sound) {
    const byIdx = (i) => view.players.find((p) => p.idx === i);
    switch (ev.k) {
      case 'whistle':
        sound.whistle();
        this.banner('GO!', '', '#ffd447', 0.8);
        break;
      case 'kick': {
        sound.kick(ev.pw);
        if (ev.pw > 0.75) {
          this.shake = Math.max(this.shake, 3 * ev.pw);
          this.burst(view.ball.x, view.ball.y, '#ffffff', 10, 160, 0.35, 2.5);
        }
        break;
      }
      case 'bounce':
        sound.bounce(ev.s);
        break;
      case 'wall':
        sound.wall(ev.s);
        break;
      case 'post':
        sound.post(ev.s);
        this.shake = Math.max(this.shake, 4);
        break;
      case 'goal': {
        sound.goal();
        const team = TEAMS[ev.team];
        const hw = this.init.field.width / 2;
        const gx = ev.team === 0 ? hw : -hw;
        this.shake = 10;
        this.burst(gx, 0, team.main, 50, 420, 1.4, 5);
        this.burst(gx, 0, '#ffffff', 30, 380, 1.2, 4);
        let sub = '';
        if (ev.own) sub = `Own goal by ${ev.s}`;
        else if (ev.s) sub = ev.a ? `${ev.s} (assist ${ev.a})` : ev.s;
        this.banner('GOAL!', sub, team.main, 2.4);
        break;
      }
      case 'pickup': {
        sound.pickup();
        const p = byIdx(ev.p);
        if (p) {
          this.floater(p.x, p.y, `${PU_NAMES[ev.type]}!`, PU_COLORS[ev.type]);
          this.burst(p.x, p.y, PU_COLORS[ev.type], 18, 220, 0.6, 3);
        }
        break;
      }
      case 'tackle': {
        sound.tackle();
        const v = byIdx(ev.v);
        if (v) {
          this.burst(v.x, v.y, '#d8c79a', 14, 180, 0.5, 4);
          this.floater(v.x, v.y, 'TACKLED!', '#ffe066');
        }
        this.shake = Math.max(this.shake, 3);
        break;
      }
      case 'dash':
      case 'slide':
        sound.whoosh();
        break;
      case 'overtime':
        sound.whistle();
        this.banner('GOLDEN GOAL', 'Next goal wins', '#ffd447', 2.5);
        break;
      case 'end':
        sound.whistle(true);
        break;
    }
  }

  // ---- HUD -------------------------------------------------------------------------

  drawHud(view, info, now) {
    const ctx = this.ctx;
    const cx = this.w / 2;

    // Scoreboard
    const bw = 116;
    const mw = 120;
    const bh = 44;
    const y = 10;
    ctx.fillStyle = TEAMS[0].main;
    roundRect(ctx, cx - mw / 2 - bw, y, bw, bh, [10, 0, 0, 10]);
    ctx.fill();
    ctx.fillStyle = '#0f1d15';
    ctx.fillRect(cx - mw / 2, y, mw, bh);
    ctx.fillStyle = TEAMS[1].main;
    roundRect(ctx, cx + mw / 2, y, bw, bh, [0, 10, 10, 0]);
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(view.sc[0]), cx - mw / 2 - 14, y + bh / 2 + 1);
    ctx.textAlign = 'left';
    ctx.fillText(String(view.sc[1]), cx + mw / 2 + 14, y + bh / 2 + 1);
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.textAlign = 'left';
    ctx.fillText('RED', cx - mw / 2 - bw + 12, y + bh / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillText('BLUE', cx + mw / 2 + bw - 12, y + bh / 2 + 1);
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    if (view.ot) {
      ctx.fillStyle = '#ffd447';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText('GOLDEN', cx, y + 15);
      ctx.fillText('GOAL', cx, y + 31);
    } else {
      const t = Math.ceil(view.clk);
      ctx.fillStyle = t <= 10 && view.st === 'playing' ? '#ff9a8f' : '#ffffff';
      ctx.font = '800 24px ui-monospace, monospace';
      ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, cx, y + bh / 2 + 1);
    }

    // Corner info
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.init.mode}${info.spectator ? ' · spectating' : ''}`, 14, 22);
    ctx.textAlign = 'right';
    if (info.ping !== null) ctx.fillText(`${info.ping} ms`, this.w - 14, 22);
    ctx.fillText('Esc: menu', this.w - 14, 40);

    // Own stamina + active power-ups
    const me = view.players.find((p) => p.idx === info.me);
    if (me) {
      const bx = 16;
      const by = this.h - 30;
      const frac = Math.max(0, Math.min(1, me.stamina / this.init.staminaMax));
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, bx, by, 170, 14, 7);
      ctx.fill();
      ctx.fillStyle = frac >= this.init.dashCost / this.init.staminaMax ? '#7cf29a' : '#f2b84b';
      roundRect(ctx, bx, by, Math.max(14, 170 * frac), 14, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('STAMINA', bx, by - 9);
      if (me.fx) {
        let ex = bx + 184;
        ['speed', 'mega', 'giant', 'energy'].forEach((name, i) => {
          if (me.fx[i] <= 0) return;
          const label = `${PU_NAMES[name]} ${Math.ceil(me.fx[i])}s`;
          ctx.font = '700 12px system-ui, sans-serif';
          const w = ctx.measureText(label).width + 16;
          ctx.fillStyle = PU_COLORS[name];
          roundRect(ctx, ex, by - 3, w, 20, 10);
          ctx.fill();
          ctx.fillStyle = '#10140f';
          ctx.textAlign = 'left';
          ctx.fillText(label, ex + 8, by + 7);
          ex += w + 8;
        });
      }
    }

    // Big centre messages
    const midY = this.cy;
    if (view.st === 'countdown') {
      const n = Math.max(1, Math.ceil(view.tm));
      const frac = view.tm - Math.floor(view.tm);
      ctx.font = `900 ${Math.round(90 + frac * 30)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillText(String(n), cx + 3, midY + 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(n), cx, midY);
    }
    for (const b of this.banners) {
      const t = now - b.t0;
      if (t > b.dur) continue;
      const pop = Math.min(1, t / 0.15);
      const alpha = Math.min(1, (b.dur - t) / 0.3);
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(72 * (0.6 + 0.4 * pop))}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillText(b.text, cx + 3, midY - 20 + 3);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, cx, midY - 20);
      if (b.sub) {
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.sub, cx, midY + 30);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function star(ctx, x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
