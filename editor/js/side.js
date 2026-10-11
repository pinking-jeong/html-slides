/* 왼쪽 칸의 색인·찾기 — 차례 옆 탭. 색인의 장 번호·찾기 결과를 누르면 그 장으로 가서 그 말을 덱 화면에 형광으로 보인다.
   찾기: Enter·↓ 다음, Shift+Enter·↑ 앞, ‘바꾸기’ 지금 것, ‘모두 바꾸기’ 덱 전체(되돌리기 한 칸). Ctrl+F 찾기, Ctrl+H 바꾸기. */

import { h } from './util.js';
import { buildIndex, canStoreTerms, readTermsRaw, readUserTerms, tidyTerm, wholeWord, writeUserTerms } from './terms.js';
import { atOrAfter, findAll, highlight, unhighlight, replaceMatches } from './find.js';

const $ = (id) => document.getElementById(id);
const REBUILD_MS = 400;
const TABS = [['toc', 'tabToc', 'panToc'], ['idx', 'tabIdx', 'panIdx'], ['find', 'tabFind', 'panFind']];

export class Side {
  /* model, go(i): 장으로, msg, settle(): 고치던 것 마무리, change(fn): 지금 장을 되돌리기 한 칸으로 고치기,
     commitSlides(fn): 여러 장을 한 칸으로(바뀐 장 수를 돌려준다), pushOp(op): 되돌리기 칸에 바로 넣기 */
  constructor({ model, go, msg, settle, change, commitSlides, pushOp }) {
    Object.assign(this, { model, go, msg, settle, change, commitSlides, pushOp });
    this.tab = 'toc';
    this.matches = [];
    this.cur = -1;
    this.term = null;          // 색인에서 누른 말 — 그 장에서 형광으로
    this.timer = 0;
    this.stale = false;        // 덱을 고친 뒤 아직 다시 찾지 않았다 — 찾은 자리(글 마디·글자 번호)가 옛것일 수 있다
    this.index = null;         // 만들어 둔 색인 — 덱이 바뀌면 버린다(거르기 칸은 이것으로 다시 그린다)
  }

  attach() {
    for (const [key, id] of TABS) $(id).addEventListener('click', () => this.show(key));
    // 탭 줄 — ←→ 로 옆 탭(탭을 고르면 바로 그 칸이 보인다), Home·End
    $('sideTabs').addEventListener('keydown', (e) => {
      const order = TABS.map(([k]) => k);
      const at = order.indexOf(this.tab);
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: order.length - 1 }[e.key];
      if (to === undefined || !e.target.closest('[role="tab"]')) return;
      e.preventDefault();
      this.show(order[(to + order.length) % order.length], true);
    });
    $('idxFilter').addEventListener('input', () => this.renderIndex());
    $('idxAdd').addEventListener('submit', (e) => { e.preventDefault(); this.addTerm($('idxTerm').value); });
    $('idx').addEventListener('click', (e) => this.onIndexClick(e));
    const q = $('findQ');
    q.addEventListener('input', () => this.search());
    $('findCase').addEventListener('change', () => this.search());
    const enter = (e) => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;   // 한글 조합을 끝내는 Enter 는 빼고
    q.addEventListener('keydown', (e) => {
      if (enter(e)) { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
    });
    $('findTo').addEventListener('keydown', (e) => {
      if (enter(e)) { e.preventDefault(); this.replaceOne(); }
    });
    $('findPrev').addEventListener('click', () => this.step(-1));
    $('findNext').addEventListener('click', () => this.step(1));
    $('findOne').addEventListener('click', () => this.replaceOne());
    $('findEvery').addEventListener('click', () => this.replaceAll());
    $('hits').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hit]');
      if (b) this.pick(Number(b.dataset.hit));
    });
  }

  /* ---------- 탭 */

  show(key, focus) {
    this.tab = key;
    for (const [k, tab, pan] of TABS) {
      const on = k === key;
      $(tab).setAttribute('aria-selected', String(on));
      $(tab).tabIndex = on ? 0 : -1;
      $(pan).hidden = !on;
    }
    if (focus) $(TABS.find(([k]) => k === key)[1]).focus();
    if (key === 'idx') { this.term = null; this.renderIndex(); }
    if (key === 'find') this.search();
    else this.lightOff();
  }

  // 찾기 열기(Ctrl+F) — replace 면 바꿀 글 칸에(Ctrl+H). 덱 화면에서 눌렀고(fromDeck) 고른 짧은 글이 있으면 그 글을 찾는다 —
  // 찾기 칸 등 덱 밖에서 누르면 덱에 남아 있는 옛 고름으로 찾을 말을 덮어쓰지 않는다.
  openFind(replace, fromDeck = false) {
    // 고른 글은 글 고치기를 마무리(settle — 글 칸에서 초점을 뺀다)하기 전에 읽는다
    const sel = fromDeck ? this.model.doc.getSelection() : null;
    const picked = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    this.settle();
    if (picked && picked.length <= 80 && !picked.includes('\n')) $('findQ').value = picked;
    this.show('find');
    const el = $(replace ? 'findTo' : 'findQ');
    el.focus();
    el.select();
  }

  // 덱이 바뀐 뒤(글 고치기·되돌리기·장 더하기 등) — 보이는 칸만 조금 뒤에 다시
  changed() {
    clearTimeout(this.timer);
    this.stale = true;
    this.index = null;
    if (this.tab === 'toc') return;
    this.timer = setTimeout(() => {
      if (this.tab === 'idx') this.renderIndex();
      else if (this.tab === 'find') this.search(true);
    }, REBUILD_MS);
  }

  // 장을 넘긴 뒤 — 그 장의 찾은 곳·색인 말을 형광으로(덱을 고친 뒤면 먼저 다시 찾는다)
  onSlide() {
    if (this.tab === 'find') {
      if (this.stale) this.search(true);
      else this.light();
    } else if (this.tab === 'idx' && this.term) this.lightTerm(this.term);
    else this.lightOff();
  }

  lightOff() { if (this.model.doc) unhighlight(this.model); }

  /* ---------- 색인 */

  renderIndex() {
    const box = $('idx');
    // 다시 그려도 키보드 자리를 지킨다 — 눌렀던 말의 같은 단추로
    const was = box.contains(document.activeElement) ? document.activeElement : null;
    const keep = was ? { term: was.closest('li')?.dataset.term ?? null, go: was.dataset.go ?? null, del: was.hasAttribute('data-del') } : null;
    if (!this.index) this.index = buildIndex(this.model);
    const { sections, terms, more } = this.index;
    const f = $('idxFilter').value.trim().toLowerCase();
    const nums = (list) => h('span', { class: 'ix-n' }, ...list.slice(0, 40).map((i) => h('button', {
      type: 'button', class: 'ix-go', 'data-go': String(i), title: `${i + 1}장으로`,
    }, String(i + 1))), list.length > 40 ? h('span', { class: 'ix-more' }, `외 ${list.length - 40}`) : null);
    const out = [];
    const secs = sections.filter((s) => !f || s.name.toLowerCase().includes(f));
    if (secs.length) {
      out.push(h('h3', { class: 'ix-h' }, '절'));
      out.push(h('ul', { class: 'ix' }, ...secs.map((s) => h('li', null,
        h('span', { class: 'ix-t' }, s.name), nums(s.slides)))));
    }
    let head = '';
    let list = null;
    for (const t of terms) {
      if (f && !t.term.toLowerCase().includes(f)) continue;
      if (t.head !== head) {
        head = t.head;
        out.push(h('h3', { class: 'ix-h' }, head));
        list = h('ul', { class: 'ix' });
        out.push(list);
      }
      list.append(h('li', { 'data-term': t.term },
        h('span', { class: 'ix-t' }, t.term, t.user ? h('span', { class: 'ix-mine', title: '더한 말' }, '★') : null),
        t.slides.length ? nums(t.slides) : h('span', { class: 'ix-none' }, '덱에 없음'),
        t.user ? h('button', { type: 'button', class: 'ix-del', 'data-del': t.term, title: '색인에서 빼기', 'aria-label': `${t.term} 색인에서 빼기` }, '×') : null));
    }
    if (!out.length) out.push(h('p', { class: 'ix-empty' }, f ? '맞는 말이 없습니다.' : '색인에 넣을 말이 없습니다 — 아래에서 더하세요.'));
    if (more) out.push(h('p', { class: 'ix-empty' }, `말이 많아 자주 나오는 것만 보입니다(${more}개 뺌).`));
    box.replaceChildren(...out);
    if (keep) {
      const row = keep.term !== null ? Array.from(box.querySelectorAll('li[data-term]')).find((li) => li.dataset.term === keep.term) : box;
      const again = row && (keep.del ? row.querySelector('[data-del]') : keep.go !== null ? row.querySelector(`[data-go="${keep.go}"]`) : null);
      (again || box).focus();               // 그 말이 없어졌으면(뺀 말 등) 색인 목록에 머문다 — Ctrl+Z 가 덱으로 가게
    }
  }

  onIndexClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) { this.removeTerm(del.dataset.del); return; }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    const li = go.closest('li');
    this.term = li && li.dataset.term ? li.dataset.term : null;
    this.go(Number(go.dataset.go));
    if (this.term) this.lightTerm(this.term);
  }

  // 색인 말을 이 장에서 형광으로 — 영문·숫자 말은 색인이 센 것처럼 낱말째로만
  lightTerm(term) {
    const here = findAll(this.model, term, false)
      .filter((m) => m.slide === this.model.cur && wholeWord(term, m.run.text, m.start, m.end));
    highlight(this.model, here, null);
  }

  // 사람이 더한 말을 바꾼다 — 되돌리기는 덱의 그 자리 글을 글자 그대로(a: 전, b: 뒤, 없으면 null). 바꿨으면 true.
  setTerms(next) {
    const doc = this.model.doc;
    if (!canStoreTerms(doc)) {
      this.msg('이 덱에는 같은 이름(deck-index)의 다른 요소가 있어, 더한 말을 덱에 적을 수 없습니다.', 'warn', 12000);
      return false;
    }
    if (JSON.stringify(readUserTerms(doc)) === JSON.stringify(next)) return false;
    const a = readTermsRaw(doc);
    writeUserTerms(doc, next);
    this.pushOp({ t: 'terms', a, b: readTermsRaw(doc) });
    this.index = null;
    this.renderIndex();
    return true;
  }

  addTerm(raw) {
    const term = tidyTerm(raw || '');        // 읽을 때와 같게 다듬어 넣는다(앞뒤 괄호·따옴표 등)
    if (!term) return;
    if (term.length > 60) { this.msg('색인에 넣을 말은 60자 안으로 적으세요.', 'warn'); return; }
    const now = readUserTerms(this.model.doc);
    if (now.includes(term)) { this.msg(`‘${term}’ — 이미 색인에 있습니다.`); return; }
    if (!this.setTerms([...now, term])) return;
    $('idxTerm').value = '';
    this.msg(`‘${term}’ — 색인에 넣었습니다. 저장하면 덱 파일에 함께 남습니다.`, 'ok');
  }

  removeTerm(term) {
    this.setTerms(readUserTerms(this.model.doc).filter((t) => t !== term));
  }

  /* ---------- 찾기 */

  // 다시 찾는다 — keep 이 true 면 지금 고른 곳부터(고친 뒤 다시 셀 때), 자리({slide, hi, ri, start})면 그 자리부터
  search(keep) {
    clearTimeout(this.timer);
    this.stale = false;
    const q = $('findQ').value;
    const caseless = !$('findCase').checked;
    const from = keep === true ? this.matches[this.cur] : keep || null;
    this.matches = q ? findAll(this.model, q, caseless) : [];
    if (from) {
      const i = this.matches.findIndex((m) => atOrAfter(m, from));
      this.cur = this.matches.length ? (i < 0 ? 0 : i) : -1;      // 뒤에 없으면 처음으로 돌아간다
    } else {
      const i = this.matches.findIndex((m) => m.slide >= this.model.cur);   // 지금 장부터
      this.cur = this.matches.length ? (i < 0 ? 0 : i) : -1;
    }
    this.renderHits();
    this.light();
  }

  renderHits() {
    const list = $('hits');
    const had = list.contains(document.activeElement);
    const n = this.matches.length;
    $('findPos').textContent = n ? `${this.cur + 1} / ${n}` : ($('findQ').value ? '없음' : '');
    const active = document.activeElement;
    for (const id of ['findPrev', 'findNext', 'findOne', 'findEvery']) $(id).disabled = !n;
    // 꺼진 단추에 있던 초점은 찾기 칸으로 — body 로 빠지면 다음 Delete·방향키가 덱의 고른 상자에 간다
    if (active instanceof HTMLButtonElement && active.disabled) $('findQ').focus();
    const shown = this.matches.slice(0, 200);
    list.replaceChildren(...shown.map((m, i) => h('li', null, h('button', {
      type: 'button', class: `hit${i === this.cur ? ' cur' : ''}`, 'data-hit': String(i), 'aria-current': i === this.cur ? 'true' : null,
    }, h('span', { class: 'hit-n' }, `${m.slide + 1}`), h('span', { class: 'hit-t' },
      m.before.length >= 18 ? '…' : '', m.before, h('mark', null, m.hit), m.after)))));
    if (n > shown.length) list.append(h('li', { class: 'ix-empty' }, `외 ${n - shown.length}곳`));
    if (had) (list.querySelector('.hit.cur') || list).focus();        // 다시 그려도 고른 곳(없으면 목록)에 머문다
  }

  light() {
    highlight(this.model, this.matches, this.matches[this.cur] || null);
  }

  pick(i) {
    if (!this.matches.length) return;
    this.cur = (i + this.matches.length) % this.matches.length;
    const m = this.matches[this.cur];
    if (m.slide !== this.model.cur) this.go(m.slide);
    this.renderHits();
    this.light();
    const b = $('hits').querySelector('.hit.cur');
    if (b) b.scrollIntoView({ block: 'nearest' });
  }

  step(d) {
    if (!this.matches.length || this.stale) {
      const had = this.matches.length;
      this.search(true);
      if (!this.matches.length) return;
      if (!had) { this.pick(this.cur); return; }   // 처음 찾았으면 그 첫 곳으로
    }
    this.pick(this.cur + d);
  }

  // 지금 것 하나 — 찾은 뒤 글을 고쳤을 수 있어 바로 다시 찾아 그 자리를 쓴다. 다른 장의 것이면 먼저 그 장으로만 간다.
  replaceOne() {
    if (!$('findQ').value) return;
    this.search(true);
    const m = this.matches[this.cur];
    if (!m) return;
    if (m.slide !== this.model.cur) { this.pick(this.cur); return; }
    const to = $('findTo').value;
    this.change(() => replaceMatches([m], to));
    // 바꾼 글 바로 뒤부터 — 바꾼 글에 찾는 말이 들어 있어도(‘장’→‘장면’) 같은 자리를 다시 바꾸지 않게
    this.search({ slide: m.slide, hi: m.hi, ri: m.ri, start: m.start + to.length });
    // 바꾼 곳 다음 것으로 — 그 장이 아니면 그 장으로 간다
    const next = this.matches[this.cur];
    if (next && next.slide !== this.model.cur) this.pick(this.cur);
  }

  replaceAll() {
    const q = $('findQ').value;
    if (!q) return;
    const to = $('findTo').value;
    const caseless = !$('findCase').checked;
    const all = findAll(this.model, q, caseless);
    if (!all.length) { this.search(); return; }
    const slides = this.commitSlides(() => replaceMatches(all, to));
    this.msg(`${all.length}곳을 바꿨습니다(${slides}개 장 — 되돌리기 Ctrl+Z 한 번).`, 'ok');
    this.search();
  }
}
