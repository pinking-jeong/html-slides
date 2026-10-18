/* PPTX 받기(pptx.js)의 회전·대칭과 선 — 요소의 돌림·뒤집음(자기와 조상의 transform 과 CSS rotate·scale 속성 — 배치 ▾ 의
   회전·대칭이 쓰는 것)을 PowerPoint 의 rot·flipH 로, 덱 공통 편집 명령의 선·화살표(deckops.js — 도형 넣기)를 그림이 아닌
   PowerPoint 선 도형(화살촉·두께·대시까지)으로 옮긴다. */

import DeckOps from './deckops.js';

const PT = 0.75;                 // CSS 1px = 0.75pt
const DASH = { dotted: 'sysDot', dashed: 'dash' };
const ANGLE = /(-?[\d.]+)\s*(deg|turn|rad|grad)?\s*$/;

// CSS 각도 글('15deg'·'0.25turn'·'z 90deg' 등) → 도. 없거나 읽지 못하면 0
function degOf(v) {
  const m = ANGLE.exec(String(v || '').trim());
  if (!m || v === 'none') return 0;
  const n = parseFloat(m[1]);
  const u = m[2] || 'deg';
  return u === 'turn' ? n * 360 : u === 'rad' ? (n * 180) / Math.PI : u === 'grad' ? n * 0.9 : n;
}

// 2×2 선형 변형 [a, b, c, d](x' = a·x + c·y, y' = b·x + d·y)의 곱 p·q
const mul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3]];

// 요소 하나가 거는 변형의 선형 부분 — CSS 가 적용하는 차례(rotate → scale → transform)대로
function own(cs) {
  const t = degOf(cs.rotate) * (Math.PI / 180);
  let m = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)];
  const s = String(cs.scale || 'none').trim();
  if (s && s !== 'none') {
    const p = s.split(/\s+/).map(parseFloat);
    m = mul(m, [p[0], 0, 0, p.length > 1 ? p[1] : p[0]]);
  }
  if (cs.transform && cs.transform !== 'none') {
    try {
      const x = new DOMMatrixReadOnly(cs.transform);
      m = mul(m, [x.a, x.b, x.c, x.d]);
    } catch (e) { /* 읽지 못한 변형은 둔다 */ }
  }
  return m;
}

/* 요소의 돌림·뒤집음 — 자기부터 장(stop) 바로 아래 조상까지 모은 변형을 PowerPoint 꼴(뒤집은 뒤 돌린다)로 → {rot(도, 0.5° 안은 0),
   flipH, flipV, sx, sy}. 뒤집음은 좌우·상하 가운데 덜 돌려도 되는 쪽으로 적는다(좌우·상하 모두 뒤집은 것은 180° 회전과 같다).
   변형이 없으면 null. */
export function pose(e, stop, win) {
  let m = [1, 0, 0, 1];
  let any = false;
  for (let n = e; n && n !== stop && n.nodeType === 1; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if ((!cs.rotate || cs.rotate === 'none') && (!cs.scale || cs.scale === 'none') && (!cs.transform || cs.transform === 'none')) continue;
    m = mul(own(cs), m);
    any = true;
  }
  if (!any) return null;
  const det = m[0] * m[3] - m[1] * m[2];
  const sx = Math.hypot(m[0], m[1]);
  if (!(sx > 1e-6) || Math.abs(det) < 1e-9) return null;
  const deg = (y, x) => (Math.atan2(y, x) * 180) / Math.PI;
  let rot = deg(m[1], m[0]);
  let flipH = false;
  let flipV = false;
  if (det < 0) {
    // 좌우로 뒤집고 돌린 것(첫 열이 -cos·-sin) 또는 상하로 뒤집고 돌린 것(첫 열이 cos·sin)
    const h = deg(-m[1], -m[0]);
    if (Math.abs(h) <= Math.abs(rot)) { rot = h; flipH = true; } else flipV = true;
  }
  if (Math.abs(rot) <= 0.5) rot = 0;
  return { rot, flipH, flipV, sx, sy: Math.abs(det) / sx };
}

// 요소의 레이아웃 크기(돌리기 전, CSS px) — SVG 에는 offsetWidth 가 없어 계산된 크기로
export function layoutSize(e, cs) {
  if (typeof e.offsetWidth === 'number') return { w: e.offsetWidth, h: e.offsetHeight };
  const w = parseFloat(cs.width);
  const h = parseFloat(cs.height);
  return w > 0 && h > 0 ? { w, h } : null;
}

export const isLine = (e) => DeckOps.isLine(e);

/* 선·화살표(svg) → pptxgenjs addShape('line') 옵션. g: 그 svg 의 자리 {x, y, w, h, rot, flipH, flipV}(장 px), at: 자리 → 인치 옵션,
   transp: 불투명도 → 투명도(%). 선은 svg 가운데 가로로 그려져 있다(fitLine) — 선 끝(화살촉 끝)까지를 PowerPoint 선의 길이로. */
export function lineShape(svg, g, o, at, transp) {
  const f = DeckOps.boxFmt(svg);
  const ln = svg.querySelector('line');
  const hd = svg.querySelector('polygon');
  const vb = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const k = vb[2] > 0 ? g.w / vb[2] : 1;
  const x1 = (parseFloat(ln && ln.getAttribute('x1')) || 0) * k;
  const tip = hd ? parseFloat(String(hd.getAttribute('points')).trim().split(/[\s,]+/)[0]) : parseFloat(ln && ln.getAttribute('x2'));
  const x2 = (Number.isFinite(tip) ? tip : vb[2] || 0) * k;
  // 선의 가운데가 svg 가운데에서 비켜 있으면 돌린 만큼 그 가운데를 옮긴다(PowerPoint 는 제 가운데를 두고 돌린다)
  const off = (x1 + x2) / 2 - g.w / 2;
  const t = ((g.rot || 0) * Math.PI) / 180;
  const cx = g.x + g.w / 2 + off * Math.cos(t);
  const cy = g.y + g.h / 2 + off * Math.sin(t);
  const len = Math.max(0.5, x2 - x1);
  const line = { color: (f.line || '#000000').slice(1), width: Math.round(f.lineW * k * PT * 100) / 100, dashType: DASH[f.dash] || 'solid' };
  if (hd) line.endArrowType = 'triangle';
  if (o < 0.99) line.transparency = transp(o);
  return { ...at({ x: cx - len / 2, y: cy, w: len, h: 0, rot: g.rot, flipH: g.flipH, flipV: g.flipV }), line };
}
