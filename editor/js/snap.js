/* 맞춤선 — 상자를 끌어 옮기거나 크기를 바꿀 때, 상자의 가장자리·가운데를 장의 가장자리·가운데와 다른 상자의 가장자리·가운데에
   붙인다. 좌표는 덱 화면의 px(getBoundingClientRect)이고, 붙는 거리는 편집기 화면에서 SNAP_PX 만큼(배율로 나눠 덱 px 로). */

export const SNAP_PX = 6;

const uniq = (vs) => [...new Set(vs.map((v) => Math.round(v * 2) / 2))];

// 붙을 선 — 장(가장자리·가운데)과 다른 상자들(가장자리·가운데). 상자들은 {left, top, width, height} 를 가진 것.
export function snapLines(slide, rects) {
  const xs = [slide.left, slide.left + slide.width / 2, slide.left + slide.width];
  const ys = [slide.top, slide.top + slide.height / 2, slide.top + slide.height];
  for (const r of rects) {
    if (!(r.width > 0 || r.height > 0)) continue;
    xs.push(r.left, r.left + r.width / 2, r.left + r.width);
    ys.push(r.top, r.top + r.height / 2, r.top + r.height);
  }
  return { xs: uniq(xs), ys: uniq(ys) };
}

// 움직이는 상자의 자리들(cands — 가장자리·가운데) 가운데 선(lines)에 가장 가까운 것까지의 거리. tol 보다 멀면 0.
export function nearest(cands, lines, tol) {
  let best = null;
  for (const c of cands) {
    for (const l of lines) {
      const d = l - c;
      if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best === null ? 0 : best;
}

// 붙은 뒤 실제로 맞닿은 선 — 화면에 그려 보일 것
export function touching(cands, lines, eps = 0.75) {
  return lines.filter((l) => cands.some((c) => Math.abs(l - c) <= eps));
}

// 상자 여럿을 감싸는 사각형 — {left, top, width, height}
export function union(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}
