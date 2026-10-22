// A real soccer ball pattern: a truncated icosahedron (12 black pentagons, white hexagons)
// kept as a 3D orientation so it visibly rolls the way it moves.
// Axes: x right, y down (screen), z towards the camera.

const PHI = (1 + Math.sqrt(5)) / 2;

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function buildBall() {
  const ico = [];
  for (const a of [-1, 1]) {
    for (const b of [-PHI, PHI]) {
      ico.push([0, a, b], [a, b, 0], [b, 0, a]);
    }
  }
  const edges = [];
  const neighbors = ico.map(() => []);
  for (let i = 0; i < ico.length; i++) {
    for (let j = i + 1; j < ico.length; j++) {
      const d = Math.hypot(ico[i][0] - ico[j][0], ico[i][1] - ico[j][1], ico[i][2] - ico[j][2]);
      if (Math.abs(d - 2) < 1e-6) {
        edges.push([i, j]);
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }
  const at = (i, j, t) => norm([
    ico[i][0] + (ico[j][0] - ico[i][0]) * t,
    ico[i][1] + (ico[j][1] - ico[i][1]) * t,
    ico[i][2] + (ico[j][2] - ico[i][2]) * t,
  ]);

  // Each icosahedron vertex becomes a pentagon made of the points 1/3 along its edges.
  const pentagons = ico.map((v, i) => {
    const c = norm(v);
    const up = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const t1 = norm([up[1] * c[2] - up[2] * c[1], up[2] * c[0] - up[0] * c[2], up[0] * c[1] - up[1] * c[0]]);
    const t2 = [c[1] * t1[2] - c[2] * t1[1], c[2] * t1[0] - c[0] * t1[2], c[0] * t1[1] - c[1] * t1[0]];
    const corners = neighbors[i]
      .map((j) => at(i, j, 1 / 3))
      .map((p) => ({ p, a: Math.atan2(p[0] * t2[0] + p[1] * t2[1] + p[2] * t2[2], p[0] * t1[0] + p[1] * t1[1] + p[2] * t1[2]) }))
      .sort((x, y) => x.a - y.a)
      .map((x) => x.p);
    // Add bulged midpoints so the projected pentagons look round like on a real ball.
    const pts = [];
    corners.forEach((p, k) => {
      const q = corners[(k + 1) % corners.length];
      pts.push(p, norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]));
    });
    return { c, pts };
  });

  // Seams between neighbouring hexagons run along the middle third of each icosahedron edge.
  const seams = edges.map(([i, j]) => [at(i, j, 1 / 3), at(i, j, 2 / 3)]);
  return { pentagons, seams };
}

const MODEL = buildBall();

function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function qrotate(q, v) {
  const [w, x, y, z] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

function axisAngle(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), ax * s, ay * s, az * s];
}

export class BallSkin {
  constructor() {
    this.q = [1, 0, 0, 0];
    this.lastX = null;
    this.lastY = null;
  }

  // Roll by the distance moved since last frame; sidespin turns it around the vertical axis.
  update(x, y, radius, spin, dt) {
    if (this.lastX !== null) {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4 && dist < radius * 20) {
        // Rolling without slipping: axis is perpendicular to motion in the ground plane.
        this.q = qmul(axisAngle(-dy / dist, dx / dist, 0, dist / radius), this.q);
      }
    }
    if (spin) this.q = qmul(axisAngle(0, 0, 1, spin * dt * 6), this.q);
    const l = Math.hypot(...this.q);
    this.q = this.q.map((v) => v / l);
    this.lastX = x;
    this.lastY = y;
  }

  // stretchAngle/sx/sy squash and stretch the ball along a direction for a cartoon feel.
  draw(ctx, x, y, R, stretchAngle = 0, sx = 1, sy = 1) {
    ctx.save();
    ctx.translate(x, y);
    if (sx !== 1 || sy !== 1) {
      ctx.rotate(stretchAngle);
      ctx.scale(sx, sy);
      ctx.rotate(-stretchAngle);
    }

    const base = ctx.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R);
    base.addColorStop(0, '#ffffff');
    base.addColorStop(1, '#d4d8de');
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.save();
    ctx.clip();

    ctx.fillStyle = '#1c1f26';
    for (const pent of MODEL.pentagons) {
      if (qrotate(this.q, pent.c)[2] < -0.3) continue;
      ctx.beginPath();
      pent.pts.forEach((p, i) => {
        const r = qrotate(this.q, p);
        if (i === 0) ctx.moveTo(r[0] * R, r[1] * R);
        else ctx.lineTo(r[0] * R, r[1] * R);
      });
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(40, 44, 52, 0.45)';
    ctx.lineWidth = Math.max(0.6, R * 0.06);
    ctx.beginPath();
    for (const [a, b] of MODEL.seams) {
      const ra = qrotate(this.q, a);
      const rb = qrotate(this.q, b);
      if (ra[2] < 0 || rb[2] < 0) continue;
      ctx.moveTo(ra[0] * R, ra[1] * R);
      ctx.lineTo(rb[0] * R, rb[1] * R);
    }
    ctx.stroke();

    // Sphere shading: darker rim, soft highlight.
    const rim = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = rim;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    const hi = ctx.createRadialGradient(-R * 0.4, -R * 0.45, 0, -R * 0.4, -R * 0.45, R * 0.6);
    hi.addColorStop(0, 'rgba(255,255,255,0.55)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(0.8, R * 0.08);
    ctx.stroke();
    ctx.restore();
  }
}
