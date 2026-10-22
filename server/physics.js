// Small 2D physics helpers. Bodies are plain objects with x, y, vx, vy, r and m.
// A body with m = Infinity is static.

export function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

export function normalize(x, y) {
  const l = len(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Resolves overlap and applies a restitution impulse between two circles.
// Returns the impulse magnitude (0 when the circles do not touch).
export function collideCircles(a, b, restitution) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rsum = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rsum * rsum) return 0;

  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1;
  const ny = d > 1e-9 ? dy / d : 0;
  const invA = 1 / a.m;
  const invB = 1 / b.m;
  const invSum = invA + invB;
  if (invSum === 0) return 0;

  const overlap = rsum - d;
  a.x -= nx * overlap * (invA / invSum);
  a.y -= ny * overlap * (invA / invSum);
  b.x += nx * overlap * (invB / invSum);
  b.y += ny * overlap * (invB / invSum);

  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return 1e-6; // touching but already separating
  const j = (-(1 + restitution) * rel) / invSum;
  a.vx -= j * nx * invA;
  a.vy -= j * ny * invA;
  b.vx += j * nx * invB;
  b.vy += j * ny * invB;
  return j;
}

// Circle against a fixed line segment. Pushes the circle out on whichever side
// its centre is on. Returns the normal speed it hit with (0 when no contact).
export function collideSegment(c, s, restitution) {
  const ex = s.x2 - s.x1;
  const ey = s.y2 - s.y1;
  const el2 = ex * ex + ey * ey;
  let t = el2 > 0 ? ((c.x - s.x1) * ex + (c.y - s.y1) * ey) / el2 : 0;
  t = clamp(t, 0, 1);
  const px = s.x1 + ex * t;
  const py = s.y1 + ey * t;
  const dx = c.x - px;
  const dy = c.y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= c.r * c.r) return 0;

  const d = Math.sqrt(d2);
  let nx, ny;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    const el = Math.sqrt(el2) || 1;
    nx = -ey / el;
    ny = ex / el;
  }
  c.x = px + nx * c.r;
  c.y = py + ny * c.r;

  const vn = c.vx * nx + c.vy * ny;
  if (vn >= 0) return 1e-6;
  c.vx -= (1 + restitution) * vn * nx;
  c.vy -= (1 + restitution) * vn * ny;
  return -vn;
}

// Keeps a circle inside an axis-aligned box, bouncing off the edges.
export function confineToBox(c, minX, minY, maxX, maxY, restitution) {
  if (c.x - c.r < minX) {
    c.x = minX + c.r;
    if (c.vx < 0) c.vx = -c.vx * restitution;
  } else if (c.x + c.r > maxX) {
    c.x = maxX - c.r;
    if (c.vx > 0) c.vx = -c.vx * restitution;
  }
  if (c.y - c.r < minY) {
    c.y = minY + c.r;
    if (c.vy < 0) c.vy = -c.vy * restitution;
  } else if (c.y + c.r > maxY) {
    c.y = maxY - c.r;
    if (c.vy > 0) c.vy = -c.vy * restitution;
  }
}
