/* 표 편집 — 글을 고치는 표 칸을 기준으로 행(위·아래)·열(왼쪽·오른쪽)을 넣고 지운다. 하나하나가 되돌리기 한 칸.
   - 새 칸은 옆 칸의 모양(칸 style·문단 모양)을 따르고 글은 비운다. 새 행은 누른 행과 같은 묶음(thead·tbody·tfoot)에 든다.
   - 표의 위·아래 끝 선(빌더 표 머리·끝 줄의 굵은 선 등 칸 style 에 적힌 것)은 늘 맨 위·맨 아래 줄에 남는다 — 끝 줄 아래에
     넣으면 끝 선이 새 줄로 옮겨 가고, 끝 줄을 지우면 그 위 줄이 끝 선을 받는다. 왼쪽·오른쪽 끝 선도 같다. 가운데 줄의 선은
     끝이 아닌 줄에서 읽는다 — 줄이 둘 이하라 알 수 없으면 아래(오른쪽) 선은 그대로 두고(빌더 표의 아래 선은 줄마다 같은
     구분선이다) 위(왼쪽) 끝 선만 맨 위(왼쪽) 줄에 남긴다.
   - 열 폭(colgroup > col)이 모두 px 이면 표 폭을, 모두 % 면 % 합을 그대로 두고 비율대로 다시 나눈다. 열 폭 목록이 열과 하나씩
     맞지 않는 표(col span·개수가 다른 것)는 열을 넣거나 지우지 않는다(폭이 엉뚱한 열로 옮겨 간다).
   - 칸을 합친 표(rowspan·colspan)와 줄마다 칸 수가 다른 표는 고치지 않는다(어느 칸이 어느 열인지 모호하다). */

import { textHosts } from './canvas.js';
import { A } from './deck.js';
import { Menu } from './menu.js';

const SHOW_TEXT = 4;
const KEEP = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);   // 새 칸에 남길 글 줄기(문단 등 블록)
const MIN_COL = 8;

const px = (v) => { const m = /^\s*([\d.]+)px\s*$/.exec(v || ''); return m ? parseFloat(m[1]) : null; };

// 열 폭들 → {unit: 'px'|'%', ws} — 모두 같은 단위(px 또는 %)의 양수일 때만, 아니면 null
function widths(cols) {
  const ms = cols.map((col) => /^\s*([\d.]+)(px|%)\s*$/.exec(col.style.width || ''));
  if (!ms.length || ms.some((m) => !m || !(parseFloat(m[1]) > 0) || m[2] !== ms[0][2])) return null;
  return { unit: ms[0][2], ws: ms.map((m) => parseFloat(m[1])) };
}
const sum = (a) => a.reduce((s, v) => s + v, 0);

// 복제한 요소에서 id·편집 표시를 뗀다(덱이 원래 둔 contenteditable 은 남긴다)
function clean(el) {
  el.removeAttribute('id');
  if (el.hasAttribute(A.ce)) {
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
  }
  for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-hse-')) el.removeAttribute(a.name);
}

// 칸 cell 을 본뜬 빈 칸 — 칸 요소(style·class)와 첫 글을 감싼 블록 줄기(빌더 표의 p.pp 등)만 남기고 글은 비운다
export function emptyLike(cell) {
  const d = cell.ownerDocument;
  const copy = cell.cloneNode(false);
  clean(copy);
  const w = d.createTreeWalker(cell, SHOW_TEXT);
  let t = w.nextNode();
  while (t && !t.data.trim()) t = w.nextNode();
  const chain = [];
  for (let n = t ? t.parentNode : null; n && n !== cell; n = n.parentNode) if (KEEP.has(n.tagName)) chain.unshift(n);
  let at = copy;
  for (const n of chain) {
    const c = n.cloneNode(false);
    clean(c);
    at.append(c);
    at = c;
  }
  at.append(d.createElement('br'));
  return copy;
}

// row 의 칸들의 한쪽(side) 테두리를 from 줄의 같은 열 칸 것으로 — 칸 style 에 적힌 것만. from 이 없으면 걷는다.
function edgeRow(row, from, side) {
  Array.from(row.cells).forEach((cell, k) => edgeCell(cell, from ? from.cells[k] : null, side));
}

function edgeCell(cell, src, side) {
  if (!cell) return;
  const p = `border-${side}`;
  const v = src ? src.style.getPropertyValue(p) : '';
  if (cell.style.getPropertyValue(p) === v) return;
  if (v) cell.style.setProperty(p, v);
  else cell.style.removeProperty(p);
  if (!cell.getAttribute('style')) cell.removeAttribute('style');
}

const hasEdge = (cell, side) => !!cell && !!cell.style.getPropertyValue(`border-${side}`);

export class Tables {
  constructor({ model, canvas, fmt, msg }) {
    Object.assign(this, { model, canvas, fmt, msg });
    this.menu = null;
  }

  attach({ button, menu }) {
    this.menu = new Menu({
      button, menu, deck: this.model.doc,
      onOpen: () => {
        const ok = !!this.where();
        for (const b of menu.querySelectorAll('[role="menuitem"]')) b.disabled = !ok;
        const hint = menu.querySelector('[data-tbl-hint]');
        if (hint) hint.hidden = ok;
      },
      onPick: (act) => this.run(act),
    });
    this.menu.attach();
  }

  run(act) {
    if (act === 'row-above') this.insertRow(false);
    else if (act === 'row-below') this.insertRow(true);
    else if (act === 'row-del') this.deleteRow();
    else if (act === 'col-left') this.insertCol(false);
    else if (act === 'col-right') this.insertCol(true);
    else if (act === 'col-del') this.deleteCol();
  }

  /* ---------- 어디서 */

  // 글을 고치는 표 칸 — {cell, table, rows, r: 행 번호, c: 열 번호}. 지금 장의 표 칸에 캐럿·선택이 있을 때만.
  where() {
    const cur = this.fmt.current();
    if (!cur) return null;
    const n = cur.range.startContainer;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const cell = el ? el.closest('td, th') : null;
    const slide = this.model.current;
    if (!cell || !slide.contains(cell)) return null;
    const table = cell.closest('table');
    if (!table || !slide.contains(table)) return null;
    const rows = Array.from(table.rows);
    const row = cell.parentElement;
    const r = rows.indexOf(row);
    if (r < 0) return null;
    return { cell, table, rows, r, c: Array.prototype.indexOf.call(row.cells, cell) };
  }

  // 고칠 수 있는 표인가 → 아니면 알리고 null. col: 열을 넣거나 지우려는가(열 폭 목록도 본다)
  check(col = false) {
    const w = this.where();
    if (!w) {
      this.msg('표 칸을 눌러 글을 고치는 중일 때 행·열을 넣고 지웁니다.', 'warn');
      return null;
    }
    const merged = w.rows.some((row) => Array.from(row.cells).some((c) => c.rowSpan > 1 || c.colSpan > 1));
    const ragged = w.rows.some((row) => row.cells.length !== w.rows[0].cells.length);
    if (merged || ragged) {
      this.msg(merged ? '칸을 합친 표는 행·열을 넣거나 지우지 않습니다(어느 칸이 어느 열인지 모호합니다).'
        : '행마다 칸 수가 다른 표는 행·열을 넣거나 지우지 않습니다.', 'warn', 8000);
      return null;
    }
    if (col && w.table.querySelector(':scope > colgroup > col') && !this.cols(w.table, w.rows[0].cells.length)) {
      this.msg('열 폭 목록(colgroup)이 열과 하나씩 맞지 않는 표(span 으로 묶어 적은 것 등)는 열을 넣거나 지우지 않습니다 — '
        + '폭이 엉뚱한 열로 옮겨 갑니다.', 'warn', 8000);
      return null;
    }
    return w;
  }

  // 한 번의 고치기 — 되돌리기 한 칸. 고친 뒤 새 칸에도 편집 표시를 붙이고 focus 칸에 캐럿을 둔다.
  edit(fn) {
    this.canvas.stop();
    let focus = null;
    this.canvas.change(() => { focus = fn(); });
    this.canvas.arm();
    if (focus && focus.isConnected) this.caret(focus);
  }

  // 칸의 첫 글자 앞(빈 칸이면 가장 안쪽 블록 안)에 캐럿
  caret(cell) {
    const host = textHosts(this.model.current, this.model.family).find((h) => h === cell || cell.contains(h) || h.contains(cell));
    if (!host) return;
    const d = this.model.doc;
    try { d.defaultView.focus(); } catch (e) { /* 초점을 못 옮겨도 캐럿은 둔다 */ }
    host.focus({ preventScroll: true });
    const w = d.createTreeWalker(cell, SHOW_TEXT);
    let t = w.nextNode();
    while (t && !t.data.trim()) t = w.nextNode();
    const r = d.createRange();
    if (t) r.setStart(t, 0);
    else {
      let n = cell;
      while (n.firstElementChild && n.firstElementChild.localName !== 'br') n = n.firstElementChild;
      r.setStart(n, 0);
    }
    r.collapse(true);
    const sel = d.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* ---------- 행 */

  insertRow(below) {
    const w = this.check();
    if (!w) return;
    const { rows, r, c } = w;
    const last = rows.length - 1;
    const at = below ? r + 1 : r;                     // 새 행이 들어갈 자리(넣은 뒤의 번호)
    const sec = rows[r].parentElement;                // 누른 행의 묶음(thead·tbody·tfoot)
    const up = at > 0 ? rows[at - 1] : null;
    const down = at <= last ? rows[at] : null;
    // 본뜰 행 — 새 자리 바로 위 행(누른 행과 같은 묶음이고 표의 맨 위 행이 아닐 때), 아니면 바로 아래 행(같은 묶음이거나, 맨 위
    // 머리 행 바로 아래에 넣을 때 — 본문의 첫 행으로), 아니면 누른 행. 새 행은 본뜬 행과 같은 묶음에 든다(본문 끝 행 아래에
    // 넣어도 tfoot·다음 tbody 로 가지 않고, 두 줄 머리 사이에 넣으면 머리에).
    let tpl = rows[r];
    if (up && up !== rows[0] && up.parentElement === sec) tpl = up;
    else if (down && (down.parentElement === sec || up === rows[0])) tpl = down;
    const place = (row) => {
      if (tpl === up) up.after(row);
      else if (tpl === down) down.before(row);
      else if (below) rows[r].after(row);
      else rows[r].before(row);
    };
    // 가운데 줄의 선(넣기 전) — 위 선은 맨 위가 아닌 줄, 아래 선은 맨 위도 맨 아래도 아닌 줄에서. 없으면 모른다.
    const topIn = last >= 1 ? rows[1] : null;
    const botIn = last >= 2 ? rows[last - 1] : null;
    this.edit(() => {
      const row = tpl.cloneNode(false);
      clean(row);
      for (const cell of tpl.cells) row.append(emptyLike(cell));
      place(row);
      // 위 끝 선은 맨 위 행에만 — 맨 위에 넣었으면 옛 맨 위 행의 것을, 맨 위 행을 본떠 그 아래에 넣었으면 새 행의 것을 가운데
      // 줄의 선으로(모르면 걷는다)
      if (at === 0) edgeRow(rows[0], topIn, 'top');
      else if (tpl === rows[0]) edgeRow(row, topIn, 'top');
      // 아래 끝 선은 맨 아래 행에만 — 가운데 줄의 아래 선을 알 때만 옮긴다(모르면 본뜬 그대로)
      if (botIn) {
        if (at > last) edgeRow(rows[last], botIn, 'bottom');
        else if (tpl === rows[last]) edgeRow(row, botIn, 'bottom');
      }
      return row.cells[Math.min(c, row.cells.length - 1)];
    });
    this.msg(below ? '아래에 행을 넣었습니다.' : '위에 행을 넣었습니다.', '', 3000);
  }

  deleteRow() {
    const w = this.check();
    if (!w) return;
    const { rows, r, c } = w;
    if (rows.length <= 1) {
      this.msg('표의 마지막 한 행은 지우지 않습니다 — 표째 지우려면 표 테두리를 눌러 고른 뒤 지우세요.', 'warn', 8000);
      return;
    }
    const last = rows.length - 1;
    this.edit(() => {
      const gone = rows[r];
      // 끝 행을 지우면 이웃 행이 끝 선을 받는다
      if (r === last && gone.cells.length && Array.from(gone.cells).some((x) => hasEdge(x, 'bottom'))) edgeRow(rows[r - 1], gone, 'bottom');
      if (r === 0 && Array.from(gone.cells).some((x) => hasEdge(x, 'top'))) edgeRow(rows[1], gone, 'top');
      gone.remove();
      const next = rows[r + 1] || rows[r - 1];
      return next.cells[Math.min(c, next.cells.length - 1)];
    });
    this.msg('행을 지웠습니다 — 되돌리기(Ctrl+Z)로 살릴 수 있습니다.', '', 4000);
  }

  /* ---------- 열 */

  // px 로 적힌 열 폭(colgroup > col) — 열 수와 같을 때만
  cols(table, n) {
    const cs = Array.from(table.querySelectorAll(':scope > colgroup > col'));
    return cs.length === n && cs.every((col) => !(col.span > 1)) ? cs : null;
  }

  // 열 폭을 합(total — px 이면 표 폭, % 면 바꾸기 전의 % 합)에 맞춰 비율대로 다시 나눈다. unit 은 바꾸기 전의 단위 — 모든
  // 열이 그 단위일 때만(아니면 그대로 둔다)
  refit(cols, unit, total) {
    const got = widths(cols);
    if (!got || got.unit !== unit || !(total > 0)) return;
    const all = sum(got.ws);
    const min = unit === 'px' ? MIN_COL : 1;
    const round = unit === 'px' ? Math.round : (v) => Math.round(v * 100) / 100;
    let acc = 0;
    cols.forEach((col, i) => {
      const v = i === cols.length - 1 ? Math.max(min, round(total - acc)) : Math.max(min, round((got.ws[i] * total) / all));
      acc += v;
      col.style.width = `${v}${unit}`;
    });
  }

  // 열 폭을 다시 나눌 기준 — {unit, total} 또는 null(열 폭 목록이 없거나 단위가 섞였다)
  basis(table, cols) {
    const got = cols ? widths(cols) : null;
    if (!got) return null;
    return { unit: got.unit, total: got.unit === 'px' ? (px(table.style.width) || sum(got.ws)) : sum(got.ws) };
  }

  insertCol(right) {
    const w = this.check(true);
    if (!w) return;
    const { table, rows, r, c } = w;
    const n = rows[0].cells.length;
    const last = n - 1;
    const at = right ? c + 1 : c;
    // 본뜰 열 — 맨 왼쪽·오른쪽에 넣으면 그 끝 열, 사이에 넣으면 바로 왼쪽 열(맨 왼쪽 열이면 바로 오른쪽 열)
    let k;
    if (at === 0) k = 0;
    else if (at > last) k = last;
    else k = at - 1 > 0 ? at - 1 : at;
    const cols = this.cols(table, n);
    const base = this.basis(table, cols);
    let focus = null;
    this.edit(() => {
      rows.forEach((row, i) => {
        const cells = Array.from(row.cells);               // 넣기 전의 칸들
        // 가운데 열의 선 — 왼쪽 선은 맨 왼쪽이 아닌 열, 오른쪽 선은 양 끝이 아닌 열에서(행과 같다)
        const leftIn = last >= 1 ? cells[1] : null;
        const rightIn = last >= 2 ? cells[last - 1] : null;
        const cell = emptyLike(cells[k]);
        if (at > last) cells[last].after(cell);
        else cells[at].before(cell);
        if (at === 0) edgeCell(cells[0], leftIn, 'left');             // 왼쪽 끝 선은 맨 왼쪽 열에만
        else if (k === 0) edgeCell(cell, leftIn, 'left');
        if (rightIn) {                                                 // 오른쪽 끝 선은 가운데 열의 선을 알 때만 옮긴다
          if (at > last) edgeCell(cells[last], rightIn, 'right');
          else if (k === last) edgeCell(cell, rightIn, 'right');
        }
        if (i === r) focus = cell;
      });
      if (cols) {
        const col = cols[k].cloneNode(false);
        clean(col);
        if (at > last) cols[last].after(col);
        else cols[at].before(col);
        if (base) this.refit(Array.from(table.querySelectorAll(':scope > colgroup > col')), base.unit, base.total);
      }
      return focus;
    });
    this.msg(right ? '오른쪽에 열을 넣었습니다.' : '왼쪽에 열을 넣었습니다.', '', 3000);
  }

  deleteCol() {
    const w = this.check(true);
    if (!w) return;
    const { table, rows, r, c } = w;
    const n = rows[0].cells.length;
    if (n <= 1) {
      this.msg('표의 마지막 한 열은 지우지 않습니다 — 표째 지우려면 표 테두리를 눌러 고른 뒤 지우세요.', 'warn', 8000);
      return;
    }
    const last = n - 1;
    const cols = this.cols(table, n);
    const base = this.basis(table, cols);
    this.edit(() => {
      let focus = null;
      rows.forEach((row, i) => {
        const cells = Array.from(row.cells);
        const gone = cells[c];
        if (c === last && hasEdge(gone, 'right')) edgeCell(cells[c - 1], gone, 'right');
        if (c === 0 && hasEdge(gone, 'left')) edgeCell(cells[1], gone, 'left');
        gone.remove();
        if (i === r) focus = cells[c + 1] || cells[c - 1];
      });
      if (cols) {
        cols[c].remove();
        if (base) this.refit(cols.filter((_, j) => j !== c), base.unit, base.total);
      }
      return focus;
    });
    this.msg('열을 지웠습니다 — 되돌리기(Ctrl+Z)로 살릴 수 있습니다.', '', 4000);
  }
}
