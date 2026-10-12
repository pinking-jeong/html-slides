/* 쪽 레이아웃 대화창 — pagelayout.js 의 일을 화면에 잇는다. 창 안에서 고친 것은 초안이고, ‘모든 장에 적용’ 한 번이 되돌리기
   한 칸이다(설정·모양을 바꾸는 layout 연산 + 장 판을 절대 배치의 기준으로 삼느라 바뀐 장의 사본). 장마다의 자리 상자는
   설정에서 다시 그리므로(sync) 기록하지 않는다. 덱에 원래 있던 쪽 번호·꼬리말 지우기도 되돌리기 한 칸. */

import { h, subjParticle } from './util.js';
import { A, LOCK } from './deck.js';
import { firstFamily, FONTS } from './format.js';
import { altOf, checkPicture, naturalSize, readPicture } from './insert.js';
import {
  anchorSlide, anyOn, canStoreLayout, deckFooters, deckLook, deckPageNumbers, defaults, layoutRaw, MAX_LOGOS, normalize,
  overlapsOn, PAGE_FORMATS, pageText, POSITIONS, readLayout, readLayoutRaw, renderZones, writeLayoutRaw,
} from './pagelayout.js';

const $ = (id) => document.getElementById(id);
const ARM_MS = 4000;                   // 지우기·버리고 닫기는 한 번 더 눌러야 — 그 사이 시간
const LOGO_WARN = 512 * 1024;
const quoteFamily = (name) => (/^[A-Za-z][\w-]*$/.test(name) ? name : `"${name.replace(/["\\]/g, '')}"`);

export class PageLayout {
  /* model·hist, msg(글, 종류), settle(): 고치던 것 마무리, after(): 차례·캔버스 새로 그리기,
     commitSlides(fn): 여러 장 고치기를 되돌리기 한 칸으로(바뀐 장 수), fonts(): 덱 글꼴 [{name, stack}] */
  constructor({ model, hist, msg, settle, after, commitSlides, fonts }) {
    Object.assign(this, { model, hist, msg, settle, after, commitSlides, fonts });
    this.dlg = $('pageDlg');
    this.draft = null;
    this.images = new Map();
    this.dirty = false;
    this.armed = { close: 0, page: 0, foot: 0 };
    this.timers = {};
  }

  get doc() { return this.model.doc; }

  // 덱에 적힌 설정({s, images} · 없으면 null · 읽을 수 없으면 {bad}) — 읽을 때의 바탕은 모두 꺼진 기본값이라 설정에 없는
  // 것은 켜지지 않는다. 덱 모양은 재지 않는다(장을 바꿀 때마다 부르므로).
  current() { return readLayout(this.doc, defaults(this.model.size, { has: true })); }

  /* ---------- 장마다의 자리 상자 — 설정을 읽을 수 없으면 장에 있는 것을 그대로 둔다 */

  // 지금 덱의 장들을 설정대로 — 기록하지 않는다
  sync() {
    if (!canStoreLayout(this.doc)) return;
    const cur = this.current();
    if (cur && cur.bad) return;
    renderZones(this.doc, this.model.slides, cur && anyOn(cur.s) ? cur.s : null);
  }

  // 저장할 사본의 장들을 새 차례로(model.onSerialize)
  renderInto(slides) {
    if (!canStoreLayout(this.doc)) return;
    const cur = this.current();
    if (cur && cur.bad) return;
    if (cur || slides.some((s) => s.querySelector(':scope > [data-deck-layout]'))) {
      renderZones(this.doc, slides, cur && anyOn(cur.s) ? cur.s : null);
    }
  }

  /* ---------- 되돌리기(layout 연산) — 모양 글 속 큰 그림은 덱 모델의 표로 줄여 둔다 */

  pack(raw) { return raw ? { json: raw.json, css: raw.css === null ? null : this.model.assets.pack(raw.css) } : null; }
  unpack(raw) { return raw ? { json: raw.json, css: raw.css === null ? null : this.model.assets.unpack(raw.css) } : null; }
  undoOp(op, fwd) { writeLayoutRaw(this.doc, this.unpack(fwd ? op.b : op.a)); }

  /* ---------- 창 */

  attach() {
    const form = this.dlg.querySelector('form');
    form.addEventListener('submit', (e) => e.preventDefault());
    // 창 안의 칸을 고치면 초안에 — 적용하기 전까지 덱은 그대로
    form.addEventListener('input', (e) => { if (!e.target.closest('#pLogos')) this.collect(); });
    form.addEventListener('change', (e) => { if (!e.target.closest('#pLogos')) this.collect(); });
    $('pApply').addEventListener('click', () => this.apply());
    $('pClear').addEventListener('click', () => this.clearAll());
    $('pLogoAdd').addEventListener('click', () => $('pLogoFile').click());
    $('pLogoFile').addEventListener('change', () => {
      const file = $('pLogoFile').files && $('pLogoFile').files[0];
      $('pLogoFile').value = '';
      if (file) this.addLogo(file);
    });
    $('pOldPageDel').addEventListener('click', () => this.removeOld('page'));
    $('pOldFootDel').addEventListener('click', () => this.removeOld('foot'));
    $('pClose').addEventListener('click', () => this.close());
    // Esc — 적용하지 않은 바뀜이 있으면 한 번은 알리고 멈춘다
    this.dlg.addEventListener('cancel', (e) => { if (!this.closeOk()) e.preventDefault(); });
    for (const [id, list] of [['pPagePos', POSITIONS], ['pFootPos', POSITIONS]]) {
      $(id).replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
    }
    $('pPageFmt').replaceChildren(...PAGE_FORMATS.map((f) => h('option', { value: f }, pageText({ fmt: f, start: 1 }, 2, 12))));
  }

  open() {
    this.settle();
    if (!canStoreLayout(this.doc)) {
      this.msg('이 덱에는 같은 이름(deck-layout)의 다른 요소가 있어 쪽 레이아웃을 덱에 적을 수 없습니다.', 'warn', 12000);
      return;
    }
    this.load();
    if (this.current()?.bad) {
      this.say('덱에 적힌 쪽 레이아웃 설정을 읽지 못했습니다(손으로 고치다 깨졌거나 다른 판의 것입니다) — 장에 있던 쪽 번호·로고는 '
        + '그대로 둡니다. ‘모든 장에 적용’하면 이 창의 설정으로 덮어쓰고, ‘모두 걷기’는 설정과 자리 상자를 걷습니다.', 'warn');
    } else {
      this.say('', '');
    }
    this.render();
    this.dlg.showModal();
  }

  // 초안을 덱의 지금 설정으로(없거나 읽을 수 없으면 덱 모양에 맞춘 기본값)
  load() {
    const cur = this.current();
    if (cur && !cur.bad) {
      this.draft = structuredClone(cur.s);
      this.images = new Map(cur.images);
    } else {
      this.draft = defaults(this.model.size, deckLook(this.model));
      this.images = new Map();
    }
    this.dirty = false;
  }

  // 창이 열린 채 되돌렸으면(Ctrl+Z) 덱의 지금 값으로 — 적용하지 않은 초안이 있으면 초안은 두고 원래 쪽 번호 수만
  refresh() {
    if (!this.dlg.open) return;
    if (!this.dirty) {
      this.load();
      this.render();
    } else {
      this.renderOld();
    }
  }

  say(text, kind) {
    const st = $('pStatus');
    st.textContent = text;
    st.className = `m-status${kind ? ` ${kind}` : ''}`;
    if (text) this.msg(text, kind);
  }

  render() {
    const d = this.draft;
    $('pPageOn').checked = d.page.on;
    $('pPageFmt').value = d.page.fmt;
    $('pPagePos').value = d.page.pos;
    $('pPagePt').value = String(d.page.pt);
    $('pPageColor').value = d.page.color.toLowerCase();
    $('pPageStart').value = String(d.page.start);
    $('pPageCover').checked = d.page.cover;
    $('pFootOn').checked = d.foot.on;
    $('pFootText').value = d.foot.text;
    $('pFootPos').value = d.foot.pos;
    $('pFootPt').value = String(d.foot.pt);
    $('pFootColor').value = d.foot.color.toLowerCase();
    $('pFootCover').checked = d.foot.cover;
    $('pMx').value = String(d.mx);
    $('pMy').value = String(d.my);
    this.renderFonts();
    this.renderLogos();
    this.renderOld();
    this.renderSample();
  }

  renderFonts() {
    const sel = $('pFont');
    const opts = [h('option', { value: '' }, '장의 글꼴 그대로')];
    const seen = new Set(['']);
    const add = (value, label) => {
      if (seen.has(value)) return;
      seen.add(value);
      opts.push(h('option', { value }, label));
    };
    for (const f of this.fonts()) add(f.stack, `${f.name}(이 덱)`);
    for (const [name, label, generic] of FONTS) add(`${quoteFamily(name)}, ${generic}`, label);
    if (this.draft.font && !seen.has(this.draft.font)) add(this.draft.font, `${firstFamily(this.draft.font)}(지금)`);
    sel.replaceChildren(...opts);
    sel.value = this.draft.font;
  }

  renderSample() {
    const n = this.model.slides.length;
    const p = this.draft.page;
    $('pPageSample').textContent = `둘째 장: ${pageText(p, 1, n)} · 마지막 장: ${pageText(p, n - 1, n)}`;
  }

  // 덱에 원래 있던 쪽 번호·꼬리말의 수와 지우기 단추
  renderOld() {
    // [종류, 목록, 이름, 이름+과/와, 이름+은/는]
    const kinds = [['page', deckPageNumbers(this.model), '쪽 번호', '쪽 번호와', '쪽 번호는'],
      ['foot', deckFooters(this.model), '꼬리말', '꼬리말과', '꼬리말은']];
    for (const [kind, list, label, withP, topicP] of kinds) {
      const cap = kind === 'page' ? 'Page' : 'Foot';
      const slides = new Set(list.map((el) => this.model.slides.findIndex((s) => s.contains(el)))).size;
      $(`pOld${cap}`).textContent = list.length
        ? `덱에 원래 있던 ${label}: ${slides}개 장 — 여기서 넣는 ${withP} 겹치면 지우세요.`
        : `덱에 원래 있던 ${topicP} 없습니다.`;
      const b = $(`pOld${cap}Del`);
      b.hidden = !list.length;
      b.textContent = `원래 ${label} 지우기`;
      this.armed[kind] = 0;
    }
  }

  /* ---------- 칸 → 초안 */

  collect() {
    const d = this.draft;
    const n = (id) => $(id).value;
    // 숫자 칸을 비웠거나 숫자가 아니면 그 전 값 그대로(0 으로 읽지 않게)
    const v = (id, prev) => { const s = $(id).value.trim(); const x = Number(s); return s && Number.isFinite(x) ? x : prev; };
    d.page = {
      ...d.page, on: $('pPageOn').checked, fmt: n('pPageFmt'), pos: n('pPagePos'), pt: v('pPagePt', d.page.pt),
      color: n('pPageColor').toUpperCase(), start: v('pPageStart', d.page.start), cover: $('pPageCover').checked,
    };
    d.foot = {
      ...d.foot, on: $('pFootOn').checked, text: n('pFootText'), pos: n('pFootPos'), pt: v('pFootPt', d.foot.pt),
      color: n('pFootColor').toUpperCase(), cover: $('pFootCover').checked,
    };
    d.mx = v('pMx', d.mx);
    d.my = v('pMy', d.my);
    d.font = n('pFont');
    // 꼬리말 글을 쓰기 시작하면 ‘꼬리말 넣기’를 켠다
    if (d.foot.text.trim() && document.activeElement === $('pFootText') && !d.foot.on) {
      d.foot.on = true;
      $('pFootOn').checked = true;
    }
    this.dirty = true;
    this.armed.close = 0;
    this.renderSample();
  }

  /* ---------- 로고 */

  renderLogos() {
    $('pLogos').replaceChildren(...this.draft.logos.map((l) => this.logoRow(l)));
    $('pLogoNone').hidden = this.draft.logos.length > 0;
    $('pLogoAdd').disabled = this.draft.logos.length >= MAX_LOGOS;
  }

  logoRow(l) {
    const touch = () => { this.dirty = true; this.armed.close = 0; };
    const alt = h('input', { type: 'text', value: l.alt, maxlength: '100', placeholder: '그림 설명(예: 기관 이름)', 'aria-label': '그림 설명' });
    alt.addEventListener('input', () => { l.alt = alt.value; touch(); });
    const pos = h('select', { 'aria-label': '자리' }, ...POSITIONS.map(([v, label]) => h('option', { value: v }, label)));
    pos.value = l.pos;
    pos.addEventListener('change', () => { l.pos = pos.value; touch(); });
    const hh = h('input', { type: 'number', min: '8', max: '400', step: '1', value: String(l.h), 'aria-label': '높이(px)' });
    hh.addEventListener('change', () => { const x = Number(hh.value); if (hh.value.trim() && Number.isFinite(x)) l.h = x; touch(); });
    const cover = h('input', { type: 'checkbox' });
    cover.checked = l.cover;
    cover.addEventListener('change', () => { l.cover = cover.checked; touch(); });
    const del = h('button', { type: 'button', class: 'btn ghost small' }, '빼기');
    del.addEventListener('click', () => {
      this.draft.logos = this.draft.logos.filter((x) => x !== l);
      this.images.delete(l.id);
      touch();
      this.renderLogos();
      $('pLogoAdd').focus();
    });
    return h('div', { class: 'p-logo', 'data-logo': l.id },
      h('img', { class: 'p-thumb', src: this.images.get(l.id) || '', alt: '' }),
      alt,
      h('label', null, '자리 ', pos),
      h('label', null, '높이 ', hh, ' px'),
      h('label', { class: 'm-check' }, cover, ' 표지에도'),
      del);
  }

  async addLogo(file) {
    if (this.draft.logos.length >= MAX_LOGOS) { this.say(`로고는 ${MAX_LOGOS}개까지 넣습니다.`, 'warn'); return; }
    const bad = checkPicture(file);
    if (bad) { this.say(bad, 'warn'); return; }
    let url = '';
    try {
      url = await readPicture(file);
    } catch (e) {
      this.say(e.message, 'err');
      return;
    }
    const size = await naturalSize(url);
    if (!size) { this.say('그림을 읽지 못했습니다 — 그림 파일이 아니거나 망가진 파일입니다.', 'warn'); return; }
    const used = new Set(this.draft.logos.map((l) => l.id));
    let id = '';
    do { id = Math.random().toString(36).slice(2, 8); } while (!/^[a-z0-9]{1,12}$/.test(id) || used.has(id));
    const taken = new Set(this.draft.logos.map((l) => l.pos));
    const pos = ['tr', 'tl', 'br', 'bl', 'tc', 'bc'].find((p) => !taken.has(p)) || 'tr';
    this.draft.logos.push({
      id, alt: altOf(file.name).slice(0, 100), pos, h: Math.max(16, Math.round(this.model.size.h * 0.05)),
      ratio: Math.round((size.w / size.h) * 100) / 100, cover: true,
    });
    this.images.set(id, url);
    this.dirty = true;
    this.armed.close = 0;
    this.renderLogos();
    if (file.size > LOGO_WARN) {
      this.say(`그림을 더했습니다 — 그림이 큽니다(${Math.round(file.size / 1024)} KB). 덱에 한 번만 들어가지만 되도록 작게(가로 600px `
        + '안팎) 줄여 넣으세요. ‘모든 장에 적용’을 누르면 들어갑니다.', 'warn');
    } else {
      this.say('그림을 더했습니다 — ‘모든 장에 적용’을 누르면 모든 장에 들어갑니다.', '');
    }
  }

  /* ---------- 적용 = 되돌리기 한 칸 */

  write(raw, extra = () => {}) {
    const m = this.model;
    const before = readLayoutRaw(this.doc);
    const snaps = new Map(m.slides.map((s) => [s.getAttribute(A.id), m.snap(s)]));
    extra();
    writeLayoutRaw(this.doc, raw);
    const ops = [{ t: 'layout', a: this.pack(before), b: this.pack(raw) }];
    for (const s of m.slides) {
      const id = s.getAttribute(A.id);
      const b = m.snap(s);
      if (snaps.has(id) && snaps.get(id) !== b) ops.push({ t: 'edit', id, a: snaps.get(id), b });
    }
    this.hist.push(ops);
    this.after();
  }

  apply() {
    this.settle();
    const s = normalize(this.draft, defaults(this.model.size));
    s.logos = s.logos.filter((l) => this.images.has(l.id));
    const on = anyOn(s);
    const raw = on ? layoutRaw(s, this.images) : null;
    if (JSON.stringify(readLayoutRaw(this.doc)) === JSON.stringify(raw)) {
      this.draft = s;
      this.dirty = false;
      this.render();
      this.say('바뀐 것이 없습니다.', '');
      return;
    }
    // 장 판이 절대 배치의 기준이 아니면(덱 CSS 에 position 이 없으면) 기준으로 — 자리 상자가 장 위에 놓이게
    this.write(raw, () => { if (on) for (const sl of this.model.slides) anchorSlide(this.model, sl); });
    this.draft = s;
    this.dirty = false;
    this.render();
    const n = this.model.slides.length;
    if (!on) {
      this.say('넣을 것을 모두 꺼서 쪽 레이아웃을 덱에서 뺐습니다(되돌리기 Ctrl+Z).', 'ok');
      return;
    }
    const done = `모든 장(${n}장)에 적용했습니다 — 새로 넣는 장에도 붙고, 저장할 때 쪽 번호를 새 차례로 매깁니다(되돌리기 Ctrl+Z).`;
    // 지금 장(보이는 장)에서 덱의 글·그림과 겹치면 알린다 — 자리·여백을 바꾸거나 덱의 그 글을 옮기게
    const hits = overlapsOn(this.model.current);
    if (hits.length) {
      const name = { page: '쪽 번호', foot: '꼬리말', logo: '로고' };
      const what = [...new Set(hits.map((x) => name[x.kind]))].join('·');
      this.say(`${done} 다만 지금 장에서 ${subjParticle(what)} 덱의 ‘${hits[0].text}’ 부분과 겹칩니다 — 자리나 가장자리 여백을 바꾸세요.`, 'warn');
    } else {
      this.say(done, 'ok');
    }
  }

  clearAll() {
    this.settle();
    if (!readLayoutRaw(this.doc)) {
      this.say('덱에 쪽 레이아웃이 없습니다.', '');
      return;
    }
    this.write(null);
    this.load();
    this.render();
    this.say('쪽 레이아웃(쪽 번호·꼬리말·로고)을 모든 장에서 걷었습니다(되돌리기 Ctrl+Z).', 'ok');
  }

  // 덱에 원래 있던 쪽 번호·꼬리말 — 한 번 더 눌러야 지운다. 잠근 상자(배치 ▾)는 두고 알린다.
  removeOld(kind) {
    const found = kind === 'page' ? deckPageNumbers(this.model) : deckFooters(this.model);
    const list = found.filter((el) => !el.hasAttribute(LOCK));
    const locked = found.length - list.length;
    const label = kind === 'page' ? '쪽 번호' : '꼬리말';
    const b = $(kind === 'page' ? 'pOldPageDel' : 'pOldFootDel');
    if (!list.length) {
      this.renderOld();
      if (locked) this.say(`덱에 원래 있던 ${label}${kind === 'page' ? '는' : '은'} 모두 잠근 상자라 지우지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푼 뒤 지우세요.`, 'warn');
      return;
    }
    if (Date.now() - this.armed[kind] > ARM_MS) {
      this.armed[kind] = Date.now();
      b.textContent = `한 번 더 누르면 ${list.length}곳을 지웁니다`;
      clearTimeout(this.timers[kind]);
      this.timers[kind] = setTimeout(() => { if (this.dlg.open) this.renderOld(); }, ARM_MS);
      return;
    }
    const n = this.commitSlides(() => { for (const el of list) el.remove(); });
    this.renderOld();
    this.say(`${n}개 장에서 덱에 원래 있던 ${label}${kind === 'page' ? '를' : '을'} 지웠습니다(되돌리기 Ctrl+Z).`
      + `${locked ? ` 잠근 상자 ${locked}곳은 두었습니다.` : ''}`, 'ok');
    (b.hidden ? $('pApply') : b).focus();
  }

  /* ---------- 닫기 — 적용하지 않은 바뀜이 있으면 한 번은 알린다 */

  closeOk() {
    if (!this.dirty || Date.now() - this.armed.close <= ARM_MS) return true;
    this.armed.close = Date.now();
    this.say('적용하지 않은 바뀜이 있습니다 — ‘모든 장에 적용’을 누르거나, 한 번 더 닫으면 버리고 닫습니다.', 'warn');
    return false;
  }

  close() {
    if (this.closeOk()) this.dlg.close();
  }
}
