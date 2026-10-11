/* 덱 편집기 — 덱을 불러와 차례·캔버스·노트·저장을 잇는다.
   갤러리에서는 editor/?deck=<덱 id>(GitHub 토큰으로 저장), 이 PC 에서는 slides edit 이 연 editor/?local=1#key=…(파일에 저장). */

import { download, h, objParticle } from './util.js';
import { A, DeckModel, PLACE } from './deck.js';
import { Canvas } from './canvas.js';
import { Formatter } from './format.js';
import { History } from './history.js';
import { altOf, checkPicture, naturalSize, PICTURE_WARN, placePicture, readPicture } from './insert.js';
import { LAYOUTS, makeSlide } from './layouts.js';
import { deckStyles } from './master.js';
import { Master } from './masterui.js';
import { Pick } from './pick.js';
import { Side } from './side.js';
import { openSource } from './source.js';
import { writeTermsRaw } from './terms.js';
import { Toc } from './toc.js';

const NOTES_MS = 700;
const HINT = '글은 눌러서 바로 고칩니다(글을 고르지 않고 서식을 고르면 그 글 칸 전체에) · 상자는 테두리를 끌어 옮기고 손잡이로 '
  + '크기를 바꿉니다 · 차례에서 장을 끌어 순서를 바꿉니다 · PageUp/PageDown 장 넘기기 · Ctrl+F 찾기 · Ctrl+Z 되돌리기 · Ctrl+S 저장';
const SHORTCUTS = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' };

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), back: $('back'), title: $('title'), where: $('where'), dirty: $('dirty'),
  undo: $('undo'), redo: $('redo'), present: $('present'), download: $('download'), save: $('save'),
  count: $('count'), add: $('add'), dup: $('dup'), del: $('del'), up: $('up'), down: $('down'), toc: $('toc'),
  canvas: $('canvas'), sheet: $('sheet'), frame: $('frame'), pos: $('pos'), hint: $('hint'), notes: $('notes'),
  loading: $('loading'), fail: $('fail'), failMsg: $('failMsg'), status: $('status'),
  tokenDlg: $('tokenDlg'), tokenForm: $('tokenForm'), token: $('token'), tokenErr: $('tokenErr'), tokenNew: $('tokenNew'),
  tokenCancel: $('tokenCancel'), cfDlg: $('cfDlg'), cfText: $('cfText'), cfCancel: $('cfCancel'),
  cfDownload: $('cfDownload'), cfOverwrite: $('cfOverwrite'),
  fBox: $('fBox'), bW: $('bW'), bH: $('bH'), bX: $('bX'), bY: $('bY'),
  addMenu: $('addMenu'), layMenu: $('layMenu'), layGrid: $('layGrid'),
  picBtn: $('picBtn'), picFile: $('picFile'), masterBtn: $('masterBtn'),
};
const fmtEls = {
  bar: $('fmt'), font: $('fFont'), size: $('fSize'), sizes: $('fSizes'), smaller: $('fSmaller'), bigger: $('fBigger'),
  bold: $('fBold'), italic: $('fItalic'), under: $('fUnder'), strike: $('fStrike'), color: $('fColor'), mark: $('fMark'),
  unmark: $('fUnmark'), left: $('fLeft'), center: $('fCenter'), right: $('fRight'), justify: $('fJustify'), clear: $('fClear'),
};

let source = null;
let model = null;
let canvas = null;
let pick = null;
let fmt = null;
let toc = null;
let hist = null;
let master = null;
let side = null;
let notesPending = null;
let saving = false;
let msgTimer = 0;

/* ---------- 알림 */

function msg(text, kind = '', ms = 6000, link = null) {
  const st = els.status;
  st.replaceChildren(text);
  if (link) {
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link.label;
    st.append(' ', a);
  }
  st.className = `status show${kind ? ` ${kind}` : ''}`;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => st.classList.remove('show'), ms);
}

// rescue: 편집 화면이 다른 문서로 넘어가 멈춘 경우 — 고친 덱(옛 문서)은 아직 손에 있으니 저장하지 않은 고침을 받아 두게 한다
function fail(message, rescue = false) {
  const keep = rescue && !!model && !!hist && isDirty();
  els.loading.hidden = true;
  els.app.hidden = true;
  $('failTitle').textContent = rescue ? '편집을 멈췄습니다' : '편집기를 열지 못했습니다';
  els.failMsg.textContent = keep ? `${message} 저장하지 않은 고침은 아래 단추로 HTML 파일로 받아 두세요.` : message;
  // 이 PC 편집(slides edit)에는 돌아갈 갤러리가 없다
  $('failBack').hidden = new URLSearchParams(location.search).get('local') === '1';
  $('failRescue').hidden = !keep;
  els.fail.hidden = false;
}

function rescue() {
  try {
    settle();
    download(model.serialize(), editedName());
  } catch (e) {
    els.failMsg.textContent = `파일을 만들지 못했습니다 — ${e.message}`;
  }
}

const isDirty = () => !!hist && (hist.dirty || !!canvas.pending || !!notesPending);

function refresh() {
  if (!model) return;
  const n = model.slides.length;
  const i = model.cur;
  els.undo.disabled = !hist.canUndo && !canvas.pending && !notesPending;
  els.redo.disabled = !hist.canRedo;
  els.del.disabled = n <= 1;
  els.up.disabled = i <= 0;
  els.down.disabled = i >= n - 1;
  els.count.textContent = `${n}장`;
  els.pos.textContent = `${i + 1} / ${n}`;
  const dirty = isDirty();
  els.dirty.hidden = !dirty;
  els.save.disabled = saving;
  els.save.textContent = saving ? '저장하는 중…' : '저장';
  document.title = `${dirty ? '● ' : ''}${source.title} — 덱 편집`;
}

/* ---------- 장 보기·바꾸기 */

function settle() {
  pick.end();
  canvas.stop();
  flushNotes();
}

function go(i, focusToc) {
  settle();
  model.show(i);
  canvas.arm();
  pick.clear();
  toc.select(model.cur, focusToc);
  showNotes();
  fmt.update();
  refresh();
  if (side) side.onSlide();                // 찾기·색인 탭이면 이 장의 그 말을 형광으로
}

/* ---------- 고른 상자의 자리·크기 칸 */

// 칸은 늘 자리를 차지한 채 보이고 숨는다(visibility) — 칸이 생기고 없어지며 서식 막대의 줄 수가 바뀌면 덱 화면의 배율이
// 바뀌어, 누르는 사이 상자가 포인터 밑에서 움직인다. force 면 고치는 중인 칸의 값도 지금 상자의 값으로(받지 않은 값 등).
function showBox(force = false) {
  const box = pick.box;
  els.fBox.classList.toggle('off', !box);
  if (!box) {
    // 숨긴 칸에 초점이 남으면 다음 키(PageDown 등)를 칸이 먹는다
    if (els.fBox.contains(document.activeElement)) document.activeElement.blur();
    return;
  }
  const g = pick.geom(box);
  const movable = pick.movable(box);
  for (const label of els.fBox.querySelectorAll('.pos-field')) label.classList.toggle('off', !movable);
  for (const [input, v] of [[els.bW, g.w], [els.bH, g.h], [els.bX, g.x], [els.bY, g.y]]) {
    if (force || document.activeElement !== input) input.value = String(v);
  }
}

function rerender(i, focusToc) {
  toc.render();
  if (side) side.changed();                // 덱이 바뀌었다 — 색인·찾기 결과를 다시
  go(i, focusToc);
}

// 여러 장을 한 번에 고친다(찾아 모두 바꾸기 등) — 바뀐 장마다 사본(edit)을 되돌리기 한 칸으로. 바뀐 장 수를 돌려준다.
function commitSlides(fn) {
  settle();
  const before = new Map(model.slides.map((s) => [s.getAttribute(A.id), model.snap(s)]));
  fn();
  const ops = [];
  for (const s of model.slides) {
    const id = s.getAttribute(A.id);
    const b = model.snap(s);
    if (before.has(id) && before.get(id) !== b) ops.push({ t: 'edit', id, a: before.get(id), b });
  }
  if (ops.length) hist.push(ops);
  rerender(model.cur);
  return ops.length;
}

// 지금 장 뒤에 새 장 — kind 는 레이아웃(layouts.js 의 LAYOUTS)
function addSlide(kind = 'title') {
  settle();
  const el = makeSlide(model, kind, model.current);
  const at = model.insert(el, model.cur + 1);
  const id = el.getAttribute(A.id);
  if (model.notesMode === 'json') model.notes.set(id, '');
  hist.push([{ t: 'ins', id, at, html: model.snap(el), notes: '', ws: model.sep }]);
  rerender(at);
  const label = (LAYOUTS.find((l) => l.key === kind) || LAYOUTS[0]).label;
  msg(`‘${label}’ 새 장을 넣었습니다 — 안내 글을 누르면 통째로 골라져 바로 고쳐 씁니다.`);
}

/* ---------- 새 장 레이아웃 고르기(＋ 새 장 옆 ▾) */

function fillLayouts() {
  els.layGrid.replaceChildren(...LAYOUTS.map((l) => {
    const b = h('button', { type: 'button', class: 'lay-item', role: 'menuitem', 'data-layout': l.key });
    b.innerHTML = l.svg;                  // layouts.js 의 고정 그림(사용자 글이 아니다)
    b.append(h('span', null, l.label));
    b.addEventListener('click', () => { closeLayouts(true); addSlide(l.key); });
    return b;
  }));
}

function openLayouts() {
  const acts = els.add.closest('.side-acts');
  els.layMenu.style.top = `${acts.offsetTop + acts.offsetHeight + 4}px`;
  els.layMenu.hidden = false;
  els.addMenu.setAttribute('aria-expanded', 'true');
  els.layMenu.querySelector('.lay-item').focus();
}

function closeLayouts(focusBack) {
  if (els.layMenu.hidden) return;
  els.layMenu.hidden = true;
  els.addMenu.setAttribute('aria-expanded', 'false');
  if (focusBack) els.addMenu.focus();
}

// 메뉴 — ←→↑↓ 한 칸씩(격자로 보여도 읽는 차례대로), Home·End, Esc 닫기(▾ 로 돌아감), Tab 은 닫고 다음으로
function onLayKey(e) {
  const items = Array.from(els.layMenu.querySelectorAll('.lay-item'));
  const i = items.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (step !== undefined) {
    e.preventDefault();
    items[i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + step))].focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    items[e.key === 'Home' ? 0 : items.length - 1].focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeLayouts(true);
  } else if (e.key === 'Tab') {
    closeLayouts(false);
  }
}

/* ---------- 그림 넣기 */

// 고른 그림 자리·그림이 있으면 그 자리에 바꿔 넣고, 아니면 지금 장 가운데에. 넣은 그림을 골라 바로 크기를 바꾸게 한다.
async function insertPicture(file) {
  const bad = checkPicture(file);
  if (bad) {
    msg(bad, 'warn');
    return;
  }
  const chosen = pick.box;
  let url = '';
  try {
    url = await readPicture(file);
  } catch (e) {
    msg(e.message, 'err');
    return;
  }
  const size = await naturalSize(url);
  if (!size) {
    msg('그림을 읽지 못했습니다 — 그림 파일이 아니거나 망가진 파일입니다.', 'warn');
    return;
  }
  if (pick.drag) pick.end();                // 읽는 사이 상자를 끌기 시작했으면 그 끌기를 마치고 넣는다
  const slide = model.current;              // 읽는 사이 장을 넘겼으면 지금 장에(고른 자리는 그 장에 있을 때만)
  let target = chosen && chosen.isConnected && slide.contains(chosen) && chosen.matches('[data-name="picture"], img, picture')
    ? chosen : null;
  // <picture> 안의 그림을 바꾸면 <source> 가 여전히 옛 그림을 보인다 — <picture> 째 바꾼다
  if (target && target.parentElement && target.parentElement.localName === 'picture' && model.family !== 'builder') {
    target = target.parentElement;
  }
  let img = null;
  canvas.change(() => { img = placePicture(model, slide, url, size, altOf(file.name), target); });
  pick.select(img);
  if (!img.complete) img.addEventListener('load', () => pick.place(), { once: true });
  if (file.size > PICTURE_WARN) {
    msg(`그림을 넣었습니다 — 그림(${(file.size / 1048576).toFixed(1)} MB)이 덱 파일 안에 들어가 파일도 그만큼 커집니다. `
      + '되도록 줄여서 넣으세요.', 'warn', 12000);
  } else {
    msg(model.family === 'builder' ? '그림을 넣었습니다 — 테두리를 끌어 옮기고 손잡이로 크기를 바꿉니다.'
      : '그림을 넣었습니다 — 손잡이로 크기를 바꿉니다.');
  }
}

function duplicateSlide() {
  settle();
  const src = model.current;
  const { el, scripted } = model.duplicate(src);
  const notes = model.notesOf(src);
  const at = model.insert(el, model.cur + 1);
  const id = el.getAttribute(A.id);
  if (model.notesMode === 'json') model.notes.set(id, notes);
  hist.push([{ t: 'ins', id, at, html: model.snap(el), notes, ws: model.sep }]);
  rerender(at);
  if (scripted.length) {
    msg('장을 복제했습니다 — 이 장의 차트·위젯은 덱 스크립트가 그리는 것이라 복제한 장에서는 비어 보일 수 있습니다.', 'warn', 12000);
  } else {
    msg('장을 복제했습니다.');
  }
}

function deleteSlide(i = model.cur) {
  if (model.slides.length <= 1) {
    msg('마지막 한 장은 지울 수 없습니다.', 'warn');
    return;
  }
  settle();
  const el = model.slides[i];
  const title = model.titleOf(el) || `${i + 1}장`;
  const op = { t: 'del', id: el.getAttribute(A.id), at: i, html: model.snap(el), notes: model.notesOf(el) };
  const fromToc = toc.focused() >= 0;
  op.ws = model.remove(i);
  hist.push([op]);
  rerender(Math.min(i, model.slides.length - 1), fromToc);
  msg(`${objParticle(`‘${title}’ 장`)} 지웠습니다 — 되돌리기(Ctrl+Z)로 살릴 수 있습니다.`);
}

function moveSlide(from, to, focusToc) {
  const n = model.slides.length;
  if (to < 0 || to >= n || to === from) return;
  settle();
  const id = model.slides[from].getAttribute(A.id);
  model.move(from, to);
  hist.push([{ t: 'move', id, from, to }]);
  rerender(to, focusToc);
}

function renameSlide(i, title) {
  const s = model.slides[i];
  if (!s) return;
  settle();
  const before = model.titleOf(s);
  model.setTitle(s, title);
  hist.push([{ t: 'title', id: s.getAttribute(A.id), a: before, b: title }]);
  rerender(i, true);
}

/* ---------- 되돌리기 */

function applyOp(op, dir) {
  const fwd = dir === 'redo';
  const slide = () => model.byId(op.id);
  if (op.t === 'edit') model.restore(op.id, fwd ? op.b : op.a);
  else if (op.t === 'style') {
    const st = deckStyles(model)[op.i];
    if (st) st.textContent = fwd ? op.b : op.a;
  } else if (op.t === 'terms') writeTermsRaw(model.doc, fwd ? op.b : op.a);
  else if (op.t === 'notes') { if (slide()) model.setNotes(slide(), fwd ? op.b : op.a); }
  else if (op.t === 'title') { if (slide()) model.setTitle(slide(), fwd ? op.b : op.a); }
  else if (op.t === 'move') {
    const i = model.indexOfId(op.id);
    if (i >= 0) model.move(i, fwd ? op.to : op.from);
  } else if ((op.t === 'ins') === fwd) {
    model.insertHtml(op.html, op.at, op.notes, op.ws);
  } else {
    const i = model.indexOfId(op.id);
    if (i >= 0) model.remove(i);
  }
}

function travel(dir) {
  settle();
  const g = dir === 'undo' ? hist.undo() : hist.redo();
  if (!g) { refresh(); return; }
  const last = dir === 'undo' ? g.ops[0] : g.ops[g.ops.length - 1];
  let i = model.indexOfId(last.id);
  if (i < 0) i = Math.min(Number.isInteger(last.at) ? last.at : model.cur, model.slides.length - 1);
  rerender(i);
  master.refresh();                       // 모든 장에 대화창이 열려 있으면 보이는 값을 덱의 지금 값으로
  msg(dir === 'undo' ? '되돌렸습니다.' : '다시 했습니다.', '', 2500);
}

/* ---------- 노트 */

function showNotes() {
  const none = model.notesMode === 'none';
  els.notes.disabled = none;
  els.notes.value = none ? '' : model.notesOf(model.current);
  els.notes.placeholder = none ? '이 덱에는 발표자 노트 자리가 없습니다.' : '이 장의 발표자 노트';
}

function onNotesInput() {
  const s = model.current;
  const id = s.getAttribute(A.id);
  if (notesPending && notesPending.id !== id) flushNotes();
  if (!notesPending) notesPending = { id, before: model.notesOf(s), t: 0 };
  model.setNotes(s, els.notes.value);
  clearTimeout(notesPending.t);
  notesPending.t = setTimeout(flushNotes, NOTES_MS);
  refresh();
}

function flushNotes() {
  const p = notesPending;
  if (!p) return;
  clearTimeout(p.t);
  notesPending = null;
  const s = model.byId(p.id);
  const now = s ? model.notesOf(s) : p.before;
  if (now !== p.before) hist.push([{ t: 'notes', id: p.id, a: p.before, b: now }]);
  canvas.resnap();
  refresh();
}

/* ---------- 저장 */

const editedName = () => `${String(source.fileName).replace(/\.html?$/i, '') || '발표자료'}_편집본.html`;

function askToken(error) {
  return new Promise((resolve) => {
    const dlg = els.tokenDlg;
    els.tokenErr.textContent = error || '';
    els.tokenErr.hidden = !error;
    els.tokenNew.href = source.tokenUrl;
    els.token.value = '';
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      els.tokenForm.removeEventListener('submit', onSubmit);
      els.tokenCancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const v = els.token.value.trim();
      if (!v) { els.token.focus(); return; }
      source.setToken(v);
      els.token.value = '';
      finish(true);
    };
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    els.tokenForm.addEventListener('submit', onSubmit);
    els.tokenCancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    els.token.focus();
  });
}

function conflict(text, message) {
  const dlg = els.cfDlg;
  els.cfText.textContent = `${message} ${source.kind === 'github'
    ? '덮어쓰면 저장소에 있던 그 판은 GitHub 의 바뀐 기록에 남습니다. 먼저 ‘편집본 HTML 받기’로 지금 편집을 파일로 받아 둘 수도 있습니다.'
    : '덮어쓰면 파일에 있던 그 판은 백업 폴더에 남습니다. 먼저 ‘편집본 HTML 받기’로 지금 편집을 파일로 받아 둘 수도 있습니다.'}`;
  const done = () => {
    els.cfDownload.removeEventListener('click', onDl);
    els.cfOverwrite.removeEventListener('click', onOver);
    els.cfCancel.removeEventListener('click', onCancel);
    if (dlg.open) dlg.close();
  };
  const onDl = () => download(text, editedName());
  const onOver = () => { done(); save(true); };
  const onCancel = () => done();
  els.cfDownload.addEventListener('click', onDl);
  els.cfOverwrite.addEventListener('click', onOver);
  els.cfCancel.addEventListener('click', onCancel);
  dlg.addEventListener('close', done, { once: true });
  dlg.showModal();
}

async function save(force) {
  if (saving || !model) return;
  settle();
  if (!source.hasToken() && !(await askToken())) return;
  let text = '';
  try {
    text = model.serialize();
  } catch (e) {
    msg(`저장할 파일을 만들지 못했습니다 — ${e.message}`, 'err', 12000);
    return;
  }
  const mark = hist.topSeq();
  let tokenError = '';
  saving = true;
  refresh();
  msg('저장하는 중…', '', 60000);
  try {
    const r = await source.save(text, { force: !!force });
    hist.savedSeq = mark;                 // 저장하는 사이에 고친 것은 여전히 '저장 안 함'
    const note = placeholderNote(placeholderSlides());
    msg(`${r.message}${note}`, note ? 'warn' : 'ok', 12000, r.link ? { href: r.link, label: '커밋 보기' } : null);
  } catch (e) {
    if (e.code === 'token') {
      if (e.forget) source.forgetToken();
      tokenError = e.message;
    } else if (e.code === 'conflict') {
      conflict(text, e.message);
    } else {
      msg(e.message, 'err', 15000);
    }
  } finally {
    saving = false;
    refresh();
  }
  if (!tokenError) return;
  if (await askToken(tokenError)) await save(force);
  else msg(`저장하지 않았습니다 — ${tokenError}`, 'err', 12000);
}

// 새 장의 안내 글(‘제목을 입력하세요’·그림 자리 등)을 그대로 둔 장의 번호
function placeholderSlides() {
  const texts = new Set([PLACE.title, PLACE.kicker, PLACE.body, PLACE.picture]);
  const out = [];
  model.slides.forEach((s, i) => {
    if (Array.from(s.querySelectorAll(`[${A.ph}]`)).some((el) => texts.has(el.textContent.trim()))) out.push(i + 1);
  });
  return out;
}

const placeholderNote = (left) => (left.length
  ? ` — ${left.length > 6 ? `${left.slice(0, 6).join('·')}장 등 ${left.length}개 장` : `${left.join('·')}장`}에 새 장의 안내 글이 그대로 남아 있습니다.`
  : '');

function downloadNow() {
  settle();
  try {
    download(model.serialize(), editedName());
    const note = placeholderNote(placeholderSlides());
    msg(`지금 편집한 덱을 HTML 파일로 받았습니다(저장소·원본 파일은 그대로입니다)${note}`, note ? 'warn' : '');
  } catch (e) {
    msg(`파일을 만들지 못했습니다 — ${e.message}`, 'err', 12000);
  }
}

/* ---------- 키 */

// fromFrame: 캔버스(덱 iframe)에서 온 키 — 방향키로도 장을 넘긴다. inText: 글 칸·노트 칸에서 쓰는 중.
// field: 덱에 원래 있던 입력 칸(input 등)에서 쓰는 중 — 글만 받는 칸이라 서식 단축키도 쓰지 않는다.
// Ctrl+F 찾기 · Ctrl+H 바꾸기 — 왼쪽 칸의 찾기 탭으로(브라우저의 찾기 대신). fromDeck: 덱 화면에서 눌렀다(덱의 고른 글을
// 찾을 말로). 상자를 끄는 동안에는 쓰지 않는다(끌기를 마저 하거나 Esc 로 거둔 뒤).
function findKey(e, fromDeck) {
  const k = (e.key || '').toLowerCase();
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (k !== 'f' && k !== 'h')) return false;
  e.preventDefault();
  if (pick.drag) return true;
  side.openFind(k === 'h', fromDeck);
  return true;
}

function onKey(e, inText, fromFrame, field = false) {
  // 상자를 끄는 동안에는 키를 쓰지 않는다(Esc 는 끌기 취소) — 장을 넘기거나 되돌리면 끌던 상자의 장과 기록이 엇갈린다
  if (pick.drag) {
    e.preventDefault();
    pick.key(e);
    return;
  }
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  const k = (e.key || '').toLowerCase();
  if (mod && (k === 'z' || k === 'y')) {
    e.preventDefault();
    travel(k === 'y' || e.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (mod && k === 's') {
    e.preventDefault();
    save(false);
    return;
  }
  // 대화창이 열린 동안 덱 키(Delete·방향키·장 넘기기·서식)는 쓰지 않는다 — 초점이 창 밖(body)으로 빠져도 창 뒤의 상자를
  // 지우거나 장을 넘기지 않게
  if (document.querySelector('dialog[open]')) return;
  if (findKey(e, fromFrame)) return;
  // 서식 단축키 — 덱의 글(또는 고른 상자)에. 노트 칸에서는 쓰지 않는다(글만 받는 칸이다).
  const fmtKey = mod && !e.shiftKey && (SHORTCUTS[e.code] || e.code === 'BracketLeft' || e.code === 'BracketRight');
  if (fmtKey && !(inText && (!fromFrame || field))) {
    e.preventDefault();
    if (SHORTCUTS[e.code]) fmt.run(SHORTCUTS[e.code]);
    else fmt.step(e.code === 'BracketRight' ? 1 : -1);
    return;
  }
  if (inText) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (fromFrame && !field) canvas.stop();
      else e.target.blur();
    }
    return;
  }
  // 고른 상자가 있으면 방향키는 상자를 옮기고 Delete 는 상자를 지운다
  if (pick.key(e)) {
    e.preventDefault();
    return;
  }
  if (e.altKey || mod) return;
  const next = e.key === 'PageDown' || (fromFrame && (e.key === 'ArrowRight' || e.key === 'ArrowDown'));
  const prev = e.key === 'PageUp' || (fromFrame && (e.key === 'ArrowLeft' || e.key === 'ArrowUp'));
  if (next || prev) {
    e.preventDefault();
    go(model.cur + (next ? 1 : -1));
  } else if (fromFrame && (e.key === 'Home' || e.key === 'End')) {
    e.preventDefault();
    go(e.key === 'Home' ? 0 : model.slides.length - 1);
  }
}

function bind() {
  els.add.addEventListener('click', () => addSlide());
  els.addMenu.addEventListener('click', () => (els.layMenu.hidden ? openLayouts() : closeLayouts(true)));
  els.layMenu.addEventListener('keydown', onLayKey);
  // 고르기 창 밖(편집기·덱 화면)을 누르면 닫는다
  const outside = (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('#layMenu, #addMenu')) closeLayouts(false);
  };
  document.addEventListener('pointerdown', outside, true);
  model.doc.addEventListener('pointerdown', () => closeLayouts(false), true);
  els.picBtn.addEventListener('click', () => els.picFile.click());
  els.picFile.addEventListener('change', () => {
    const file = els.picFile.files && els.picFile.files[0];
    els.picFile.value = '';               // 같은 파일을 다시 골라도 change 가 나게
    if (file) insertPicture(file);
  });
  els.masterBtn.addEventListener('click', () => master.open());
  els.dup.addEventListener('click', duplicateSlide);
  els.del.addEventListener('click', () => deleteSlide());
  els.up.addEventListener('click', () => moveSlide(model.cur, model.cur - 1));
  els.down.addEventListener('click', () => moveSlide(model.cur, model.cur + 1));
  els.undo.addEventListener('click', () => travel('undo'));
  els.redo.addEventListener('click', () => travel('redo'));
  els.save.addEventListener('click', () => save(false));
  els.download.addEventListener('click', downloadNow);
  els.notes.addEventListener('input', onNotesInput);
  els.notes.addEventListener('blur', flushNotes);
  for (const [input, field] of [[els.bW, 'w'], [els.bH, 'h'], [els.bX, 'x'], [els.bY, 'y']]) {
    // 받지 않은 값(최소보다 작은 크기 등)·반올림한 값은 칸에도 실제 값으로 되돌린다
    input.addEventListener('change', () => { pick.set(field, parseFloat(input.value)); showBox(true); });
  }
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const k = (e.key || '').toLowerCase();
    if (mod && ['z', 'y', 's'].includes(k)) {
      // Ctrl+S 는 어느 칸에서든 저장(브라우저의 ‘페이지 저장’ 대신) — 토큰 등 다른 대화창이 열려 있을 때만 빼고.
      // Ctrl+Z·Y 는 서식 막대의 칸(크기·자리 숫자, 글꼴 — 칸은 Enter·떠날 때 바로 입히므로 칸 안의 되돌리기는 쓸 일이 없다),
      // ‘모든 장에’ 창(한 번 적용한 것이 되돌리기 한 칸 — 크기 숫자 칸 안만 그 칸의 것), 색인·찾기 칸의 글 칸이 아닌 것(체크
      // 칸·단추)에서 편집기의 것. 찾기·색인의 글 칸 안에서는 그 칸의 되돌리기(쓰던 글)다. 창이 열린 채 초점이 창 밖(body)으로
      // 빠졌어도 같다.
      const typing = (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'color', 'range'].includes(t.type))
        || t instanceof HTMLTextAreaElement;
      const num = t instanceof HTMLInputElement && t.type === 'number';
      const inFmt = t instanceof Element && t.closest('#fmt');
      const inMaster = $('masterDlg').open
        && (t === document.body || t === document.documentElement || (t instanceof Element && t.closest('#masterDlg')));
      const inPanel = t instanceof Element && t.closest('#sideTabs, #panIdx, #panFind');
      const otherDialog = Array.from(document.querySelectorAll('dialog[open]')).some((d) => d.id !== 'masterDlg');
      if (k === 's' ? !otherDialog : (inFmt || (inMaster && !num) || (inPanel && !typing))) {
        onKey(e, false, false);
        return;
      }
    }
    if (document.querySelector('dialog[open]')) return;                                 // 창이 열린 동안 덱 키는 쉰다
    if (findKey(e, false)) return;                                                      // 찾기 칸 안에서도 Ctrl+F·H
    if (t instanceof Element && t.closest('#sideTabs, #panIdx, #panFind') && !mod) return;   // 색인·찾기 칸의 키는 그 칸의 것
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || (t instanceof Element && t.closest('dialog'))) return;
    if (t instanceof Element && t.closest('#toc') && !e.ctrlKey && !e.metaKey) return;   // 차례는 제 키를 쓴다
    if (t instanceof Element && t.closest('#layMenu') && !e.ctrlKey && !e.metaKey) return;   // 레이아웃 고르기 창도
    onKey(e, t === els.notes, false);
  });
  window.addEventListener('beforeunload', (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // 덱 문서가 다른 주소로 바뀌면(자동 이동 설정 등) 편집을 멈춘다 — 그 문서는 이 덱이 아니다
  els.frame.addEventListener('load', () => fail('덱 문서가 다른 주소로 바뀌어 편집을 멈췄습니다(자동으로 넘어가는 설정이 있는 덱일 수 있습니다).', true));
  $('failDownload').addEventListener('click', rescue);
}

/* ---------- 시작 */

async function boot() {
  // 다른 창이 연 편집기(window.opener)나 다른 페이지 안에 든 편집기는 쓰지 않는다 — 같은 출처에서 도는 덱 스크립트가 그런
  // 창을 손대 토큰을 가로챌 수 있다. 다만 이것만으로 다 막지는 못한다(README 의 ‘편집기와 토큰’).
  if (window.top !== window || window.opener) {
    fail('다른 창이나 페이지가 연 편집기는 쓰지 않습니다(토큰·열쇠를 지키려는 것입니다) — 편집기 주소를 브라우저에서 바로 '
      + '열거나 갤러리의 덱 카드 ⋯ 메뉴에서 다시 여세요.');
    return;
  }
  try {
    source = await openSource(new URLSearchParams(location.search), location.hash);
  } catch (e) {
    fail(e.message);
    return;
  }
  els.title.textContent = source.title;
  els.where.textContent = source.label;
  els.back.hidden = source.kind !== 'github';
  els.present.hidden = !source.presentUrl;
  if (source.presentUrl) els.present.href = source.presentUrl;
  document.title = `${source.title} — 덱 편집`;
  model = new DeckModel(els.frame);
  try {
    await model.load(source.text, source.base);
  } catch (e) {
    fail(e.message);
    return;
  }
  source.text = '';
  hist = new History(applyOp);
  canvas = new Canvas({
    box: els.canvas, sheet: els.sheet, frame: els.frame, model,
    onCommit: (op) => {
      hist.push([op]);
      const i = model.indexOfId(op.id);
      if (i >= 0) toc.updateTitle(i);
      if (pick) pick.place();
      refresh();
      if (side) side.changed();
    },
    onKey: (e, inText, field) => onKey(e, inText, true, field),
    onInput: () => { if (pick) pick.place(); refresh(); if (side) side.changed(); },
    onFit: () => { if (pick) pick.place(); },
  });
  pick = new Pick({
    layer: $('pickLayer'), bar: fmtEls.bar, canvas, model,
    onSelect: () => { showBox(); if (fmt) fmt.update(); },
    onPlace: () => showBox(),
  });
  // 자리 칸(왼쪽·위)은 상자를 옮길 수 있는 빌더 덱에만 — 덱마다 한 번 정해 서식 막대의 폭이 바뀌지 않게
  for (const label of els.fBox.querySelectorAll('.pos-field')) label.hidden = model.family !== 'builder';
  canvas.attach();
  pick.attach();
  fmt = new Formatter({ els: fmtEls, canvas, model, pick, msg });
  fmt.attach();
  // 모든 장에 한꺼번에 — 적용할 때마다 차례·캔버스를 새로 그리되, 고른 상자가 남아 있으면 다시 고른다(이어서 ‘모두 지우기’ 등)
  master = new Master({
    model, hist, pick, msg, settle,
    after: () => {
      const box = pick.box;
      rerender(model.cur);
      if (box && box.isConnected && model.current.contains(box)) pick.select(box);
    },
  });
  master.attach();
  fillLayouts();
  toc = new Toc({ list: els.toc, model, onGo: go, onMove: moveSlide, onDelete: deleteSlide, onRename: renameSlide });
  toc.render();
  // 왼쪽 칸의 색인·찾기 탭
  side = new Side({
    model, msg, settle, go: (i) => go(i), change: (fn) => canvas.change(fn), commitSlides,
    pushOp: (op) => { hist.push([op]); refresh(); },
  });
  side.attach();
  bind();
  go(0);
  els.hint.textContent = HINT;
  els.loading.hidden = true;
  els.app.classList.add('ready');
  // 시험용 손잡이 — 토큰 등 저장소 정보는 내놓지 않는다
  window.__hse = Object.freeze({
    state: () => ({
      cur: model.cur, n: model.slides.length, family: model.family, notesMode: model.notesMode, size: { ...model.size },
      titles: model.slides.map((s) => model.titleOf(s)), dirty: isDirty(), undo: hist.undoStack.length,
      redo: hist.redoStack.length, saving, scale: canvas.scale, box: pick.box ? pick.geom(pick.box) : null,
    }),
    serialize: () => { settle(); return model.serialize(); },
    notes: () => model.slides.map((s) => model.notesOf(s)),
  });
}

boot();
