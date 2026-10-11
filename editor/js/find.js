/* 찾기·바꾸기 — 덱의 글 칸(편집기가 고칠 수 있는 곳)에서 글을 찾고 바꾼다. 문단(블록)·줄바꿈(<br>)을 넘어 찾지는 않는다.
   바꾼 글은 그 글이 시작하는 글 마디의 서식을 따른다. 찾은 곳은 덱 화면에 형광으로 보인다(CSS Custom Highlight —
   덱 문서에 아무것도 넣지 않는다). */

import { textHosts } from './canvas.js';

// 글줄을 나누는 블록 — 줄마다 <div> 를 쓰는 글 칸도 줄끼리 이어 붙지 않게 div 를 넣는다
const BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, blockquote, div';
const SHOW = 1 | 4;                         // 요소 + 글
export const HIT = 'hse-hit';
export const CUR = 'hse-cur';

// 글 칸의 글을 글줄로 — [{nodes: [{t, at}], text}]. 문서 차례로 같은 블록에 이어 나오는 글 마디끼리 한 글줄(사이에 다른
// 블록이 끼면 끊는다). <br> 자리에는 '\n' 을 넣는다(글 마디는 없음) — 찾기 칸에는 줄바꿈을 넣을 수 없으니 찾은 곳이 줄을
// 넘지 않는다.
export function runsOf(host) {
  const runs = [];
  let run = null;
  let key = null;
  const w = host.ownerDocument.createTreeWalker(host, SHOW);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const text = n.nodeType === 3;
    if (text ? !n.data : n.localName !== 'br') continue;
    const blk = n.parentElement ? n.parentElement.closest(BLOCK_SEL) : null;
    const k = blk && host.contains(blk) ? blk : host;
    if (!run || k !== key) {
      run = { nodes: [], text: '' };
      key = k;
      runs.push(run);
    }
    if (text) {
      run.nodes.push({ t: n, at: run.text.length });
      run.text += n.data;
    } else {
      run.text += '\n';
    }
  }
  return runs.filter((r) => r.nodes.length);
}

// 글줄에서 q 가 나오는 자리들 [[시작, 끝]] — caseless 면 대소문자를 가리지 않는다(길이가 바뀌는 글자가 있으면 가린다)
export function matchesIn(text, q, caseless) {
  if (!q) return [];
  let hay = text;
  let needle = q;
  if (caseless) {
    const a = text.toLowerCase();
    const b = q.toLowerCase();
    if (a.length === text.length && b.length === q.length) { hay = a; needle = b; }
  }
  const out = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push([i, i + needle.length]);
  return out;
}

// 글줄 안의 [시작, 끝] → 덱 문서의 범위
export function rangeOf(doc, run, start, end) {
  const r = doc.createRange();
  const at = (k, after) => {
    for (const { t, at: a } of run.nodes) {
      const len = t.data.length;
      if (after ? k < a + len : k <= a + len) return [t, k - a];
    }
    const last = run.nodes[run.nodes.length - 1];
    return [last.t, last.t.data.length];
  };
  const [sn, so] = at(start, true);
  const [en, eo] = at(end, false);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}

// 덱 전체에서 찾기 → [{slide: 장 번호, hi: 글 칸 차례, ri: 글줄 차례, host, run, start, end, before, hit, after}]
export function findAll(model, q, caseless) {
  const out = [];
  model.slides.forEach((s, i) => {
    textHosts(s, model.family).forEach((host, hi) => {
      runsOf(host).forEach((run, ri) => {
        for (const [start, end] of matchesIn(run.text, q, caseless)) {
          out.push({ slide: i, hi, ri, host, run, start, end,
            before: run.text.slice(Math.max(0, start - 18), start), hit: run.text.slice(start, end),
            after: run.text.slice(end, end + 30) });
        }
      });
    });
  });
  return out;
}

// 찾은 곳 m 이 자리 a({slide, hi, ri, start}) 와 같거나 뒤인가 — 덱 차례(장 → 글 칸 → 글줄 → 글자)로
export const atOrAfter = (m, a) => (m.slide - a.slide || m.hi - a.hi || m.ri - a.ri || m.start - a.start) >= 0;

// 한 글줄 안의 [시작, 끝] 을 to 로 바꾼다 — 첫 글 마디에 새 글을 넣고 뒤 글 마디에서 나머지를 뺀다.
// 같은 글줄을 여러 곳 바꿀 때는 뒤에서부터 불러야 한다(앞 글 마디의 자리 at 이 그대로 맞게).
export function replaceIn(run, start, end, to) {
  const idx = (k, after) => {
    const i = run.nodes.findIndex(({ t, at }) => (after ? k < at + t.data.length : k <= at + t.data.length));
    return i < 0 ? run.nodes.length - 1 : i;
  };
  const si = idx(start, true);
  const ei = idx(end, false);
  const S = run.nodes[si];
  const E = run.nodes[ei];
  const so = start - S.at;
  const eo = end - E.at;
  if (si >= ei) {
    S.t.replaceData(so, Math.max(0, eo - so), to);
    return;
  }
  S.t.replaceData(so, S.t.data.length - so, to);
  for (let k = si + 1; k < ei; k += 1) run.nodes[k].t.data = '';
  E.t.deleteData(0, eo);
}

// 덱의 여러 곳을 바꾼다 — 같은 글줄 안에서는 뒤에서부터(앞 자리가 밀리지 않게)
export function replaceMatches(matches, to) {
  const byRun = new Map();
  for (const m of matches) {
    if (!byRun.has(m.run)) byRun.set(m.run, []);
    byRun.get(m.run).push(m);
  }
  for (const [run, list] of byRun) {
    list.sort((a, b) => b.start - a.start);
    for (const m of list) replaceIn(run, m.start, m.end, to);
  }
}

// 찾은 곳을 덱 화면에 형광으로 — cur 는 지금 고른 곳(진하게)
export function highlight(model, matches, cur) {
  const win = model.win;
  if (!win || !win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') return false;
  // 덱을 고친 뒤라 자리가 맞지 않는 것(지운 글 마디 등)은 건너뛴다 — 형광은 보이기만 하는 것이라 다음 찾기에서 바로잡힌다
  const range = (m) => {
    if (!m.run.nodes.every(({ t }) => t.isConnected)) return null;
    try { return rangeOf(model.doc, m.run, m.start, m.end); } catch (e) { return null; }
  };
  const ranges = matches.filter((m) => m.slide === model.cur).map(range).filter(Boolean);
  win.CSS.highlights.set(HIT, new win.Highlight(...ranges));
  const c = cur && cur.slide === model.cur ? range(cur) : null;
  if (c) win.CSS.highlights.set(CUR, new win.Highlight(c));
  else win.CSS.highlights.delete(CUR);
  return true;
}

export function unhighlight(model) {
  const win = model.win;
  if (win && win.CSS && win.CSS.highlights) {
    win.CSS.highlights.delete(HIT);
    win.CSS.highlights.delete(CUR);
  }
}
