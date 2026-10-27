// Draws the last week of player history as an SVG line chart with a hover readout.

const SVG = 'http://www.w3.org/2000/svg';
const W = 640;
const H = 230;
const PAD = { l: 34, r: 8, t: 10, b: 24 };
const ONLINE = '#ffd447';
const ROOMS = '#3d8bff';

function el(name, attrs, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceMax(v) {
  for (const s of [2, 4, 6, 8, 10, 20, 30, 40, 50, 100, 200, 500, 1000]) if (v <= s) return s;
  return Math.ceil(v / 1000) * 1000;
}

// Expands the sparse bucket list into one point per bucket across the whole week.
export function weekSeries(data) {
  const end = Math.floor(data.now / data.bucketMs) * data.bucketMs;
  const start = end - data.keepMs + data.bucketMs;
  const byTime = new Map(data.buckets);
  const points = [];
  for (let t = start; t <= end; t += data.bucketMs) {
    const b = byTime.get(t) || {};
    points.push({ t, o: b.o || 0, q: b.q || 0, p: b.p || 0, r: b.r || 0, s: b.s || 0, c: b.c || 0 });
  }
  return points;
}

export function renderHistory(container, points) {
  container.replaceChildren();
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Players online and private rooms over the last 7 days' });
  container.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  container.appendChild(tip);

  const top = niceMax(Math.max(2, ...points.map((p) => Math.max(p.o, p.r))));
  const x = (i) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);

  for (const v of [0, top / 2, top]) {
    el('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,0.1)' }, svg);
    const label = el('text', { x: PAD.l - 6, y: y(v) + 4, 'text-anchor': 'end', fill: '#9db5a4', 'font-size': 11 }, svg);
    label.textContent = String(v);
  }

  // A faint line at each local midnight, with the day's name in the middle of the day.
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const span = last - first || 1;
  const px = (t) => PAD.l + ((t - first) / span) * (W - PAD.l - PAD.r);
  const day = new Date(first);
  day.setHours(0, 0, 0, 0);
  for (let d = day.getTime(); d <= last; d += 86400000) {
    const mid = d + 43200000;
    if (d > first) el('line', { x1: px(d), x2: px(d), y1: PAD.t, y2: H - PAD.b, stroke: 'rgba(255,255,255,0.07)' }, svg);
    if (mid > first && mid < last) {
      const label = el('text', { x: px(mid), y: H - 6, 'text-anchor': 'middle', fill: '#9db5a4', 'font-size': 11 }, svg);
      label.textContent = new Date(mid).toLocaleDateString(undefined, { weekday: 'short' });
    }
  }

  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  el('path', { d: `${path('o')}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: 'rgba(255,212,71,0.15)' }, svg);
  el('path', { d: path('o'), fill: 'none', stroke: ONLINE, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  el('path', { d: path('r'), fill: 'none', stroke: ROOMS, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);

  const guide = el('line', { y1: PAD.t, y2: H - PAD.b, stroke: 'rgba(255,255,255,0.4)', visibility: 'hidden' }, svg);
  const dotO = el('circle', { r: 4, fill: ONLINE, visibility: 'hidden' }, svg);
  const dotR = el('circle', { r: 4, fill: ROOMS, visibility: 'hidden' }, svg);
  const hit = el('rect', { x: PAD.l, y: 0, width: W - PAD.l - PAD.r, height: H, fill: 'transparent' }, svg);

  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const sx = ((evt.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    const p = points[Math.max(0, Math.min(points.length - 1, i))];
    const xi = x(points.indexOf(p));
    for (const node of [guide, dotO, dotR]) node.setAttribute('visibility', 'visible');
    guide.setAttribute('x1', xi);
    guide.setAttribute('x2', xi);
    dotO.setAttribute('cx', xi);
    dotO.setAttribute('cy', y(p.o));
    dotR.setAttribute('cx', xi);
    dotR.setAttribute('cy', y(p.r));
    const when = new Date(p.t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    tip.textContent = `${when} · ${p.o} online · ${p.r} private room${p.r === 1 ? '' : 's'} (${p.p} players) · ${p.q} in quick play · ${p.s} practising`;
    tip.classList.remove('hidden');
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(box.width - half, (xi / W) * box.width))}px`;
  };
  const hide = () => {
    for (const node of [guide, dotO, dotR]) node.setAttribute('visibility', 'hidden');
    tip.classList.add('hidden');
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}
