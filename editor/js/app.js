/* 덱 편집기 — 덱을 불러와 차례·캔버스·노트·저장을 잇는다.
   갤러리에서는 editor/?deck=<덱 id>(GitHub 토큰으로 저장), 이 PC 에서는 slides edit 이 연 editor/?local=1#key=…(파일에 저장). */

import { download, h, objParticle } from './util.js';
import { A, DeckModel, PLACE } from './deck.js';
import { Arrange } from './arrange.js';
import { Boxes } from './boxes.js';
import { Canvas } from './canvas.js';
import { deleteDraft, getDraft, listDrafts, putDraft } from './drafts.js';
import { Formatter } from './format.js';
import { History } from './history.js';
import { LAYOUTS, makeSlide } from './layouts.js';
import { deckStyles } from './master.js';
import { Master } from './masterui.js';
import { PageLayout } from './pageui.js';
import { Pictures } from './picui.js';
import { Painter } from './painter.js';
import { Pick } from './pick.js';
import { Side } from './side.js';
import { openSource } from './source.js';
import { Tables } from './tables.js';
import { writeTermsRaw } from './terms.js';
import { Toc } from './toc.js';
import { Versions } from './verui.js';

const NOTES_MS = 700;
// 저장하지 않은 고침을 이 브라우저에 남기는 때(임시 저장본) — 손을 멈추고 QUIET 뒤, 계속 고쳐도 MAX 마다. 큰 덱은 더 드물게
const DRAFT_QUIET = 4000;
const DRAFT_MAX = 30000;
const BOOT_WAIT = 1500;          // 시작할 때 임시 저장본을 알리려고 브라우저 저장소를 기다리는 한도(멈춘 저장소에서 빈 화면이 길지 않게)
// 판 기록에서 고른 판 — 주소의 draft(임시 저장본)·ref(저장소의 커밋)·backup(이 PC 의 저장 전 판)
const VERSION_KEYS = { draft: '임시 저장본', ref: '저장소의 판', backup: '저장 전 판' };
const HINT = '글은 눌러서 바로 고칩니다(글을 고르지 않고 서식을 고르면 그 글 칸 전체에) · 상자는 테두리를 끌어 옮기고 손잡이로 '
  + '크기를 바꿉니다(Shift+누르기·빈 곳에서 끌기로 여럿을 골라 ‘배치 ▾’로 맞추기) · Esc 로 글 고치기를 마치면 Ctrl+C·V 로 상자를 '
  + '다른 장에 붙여 넣습니다 · 차례에서 장을 끌어 순서를 바꿉니다 · PageUp/PageDown 장 넘기기 · Ctrl+F 찾기 · Ctrl+Z 되돌리기 · '
  + 'Ctrl+S 저장';
const SHORTCUTS = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' };

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), back: $('back'), title: $('title'), where: $('where'), dirty: $('dirty'),
  undo: $('undo'), redo: $('redo'), present: $('present'), presenter: $('presenter'), download: $('download'), save: $('save'),
  count: $('count'), add: $('add'), dup: $('dup'), del: $('del'), up: $('up'), down: $('down'), toc: $('toc'),
  canvas: $('canvas'), sheet: $('sheet'), frame: $('frame'), pos: $('pos'), hint: $('hint'), notes: $('notes'),
  loading: $('loading'), fail: $('fail'), failMsg: $('failMsg'), status: $('status'),
  tokenDlg: $('tokenDlg'), tokenForm: $('tokenForm'), token: $('token'), tokenErr: $('tokenErr'), tokenNew: $('tokenNew'),
  tokenCancel: $('tokenCancel'), cfDlg: $('cfDlg'), cfText: $('cfText'), cfCancel: $('cfCancel'),
  cfDownload: $('cfDownload'), cfOverwrite: $('cfOverwrite'),
  fBox: $('fBox'), bW: $('bW'), bH: $('bH'), bX: $('bX'), bY: $('bY'),
  addMenu: $('addMenu'), layMenu: $('layMenu'), layGrid: $('layGrid'),
  picBtn: $('picBtn'), picFile: $('picFile'), masterBtn: $('masterBtn'), layoutBtn: $('layoutBtn'), versions: $('versions'),
};
const boxEls = { text: $('txtBtn'), dup: $('boxDup'), del: $('boxDel'), copy: $('boxCopy'), paste: $('boxPaste') };
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
let layout = null;
let boxes = null;
let arrange = null;
let painter = null;
let side = null;
let notesPending = null;
let saving = false;
let msgTimer = 0;
// 임시 저장본(drafts.js) — 이 창의 줄 하나를 고쳐 쓴다. 남기기·지우기는 draftChain 으로 차례대로(저장 뒤 지우기가 그 앞에
// 남기던 것보다 먼저 끝나지 않게)
let draftTimer = 0;
let draftId = 0;                 // 이 창의 임시 저장본(줄) 번호 — 처음 남길 때 생긴다
let drafted = '';                // 마지막으로 남긴 때의 고침 표시(editSig) — 같으면 다시 글로 만들지 않는다
let armed = '';                  // 남기려고 기다리는 고침 표시
let draftFirst = 0;              // 아직 남기지 않은 첫 고침의 시각 — 계속 고쳐도 DRAFT_MAX 안에 남기게
let draftSize = 0;               // 마지막으로 만든 글의 길이 — 큰 덱은 더 드물게 남긴다
let draftFail = 0;               // 잇따라 남기지 못한 수 — 못 쓰는 브라우저(사생활 보호 창 등)에서는 점점 드물게 해 본다
let draftChain = Promise.resolve();
let inputRev = 0;                // 글·메모를 칠 때마다 — 되돌리기 칸이 생기기 전의 고침도 알게
let restoredDraft = null;        // 임시 저장본을 다시 연 창이면 그 줄 {id, time} — 이 창에서 저장하면 그대로일 때 함께 지운다
let currentVersion = '';         // 이 창이 아는 지금 판(연 판·저장한 판) — 다시 연 임시 저장본의 바탕 판으로 바꿔 둔 것과 따로
let staleBase = false;           // 다시 연 임시 저장본이 지금 판보다 앞선 판에서 고친 것 — 저장할 때 바뀐 판을 덮어쓸지 묻는다
let leaving = false;             // 판 기록으로 다른 판을 여는 중 — 고침은 임시 저장본에 남겼으니 떠날 때 묻지 않는다

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
// 임시 저장본으로 남길 고침이 있나 — 판 기록에서 다시 연 판은 고치기 전에는 남기지 않는다(그 판은 이미 기록에 있다)
const draftable = () => !!hist && ((hist.dirty && hist.topSeq() !== 0) || !!canvas.pending || !!notesPending);

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
  els.versions.disabled = saving;       // 저장하는 사이 다른 판으로 떠나면 저장이 끊긴다
  document.title = `${dirty ? '● ' : ''}${source.title} — 덱 편집`;
  draftSoon();
}

/* ---------- 임시 저장본·판 기록 */

// 고침 표시 — 되돌리기 칸이 생기거나(seq) 되돌리거나(topSeq) 글·메모를 칠 때(inputRev) 바뀐다. 장만 넘길 때는 그대로라
// 덱을 다시 글로 만들지 않는다.
const editSig = () => `${hist.seq}:${hist.topSeq()}:${inputRev}`;

// 저장하지 않은 고침을 이 브라우저에 남긴다(drafts.js) — 손을 멈추고 몇 초 뒤, 계속 고쳐도 30초마다. 창이 닫히거나
// 브라우저가 멈춰도 판 기록에서 다시 연다.
function draftSoon() {
  if (!model || !hist || !draftable()) return;
  const sig = editSig();
  if (sig === drafted || sig === armed) return;          // 이미 남겼거나 남기려고 기다리는 고침
  armed = sig;
  const now = Date.now();
  if (!draftFirst) draftFirst = now;
  const mb = draftSize / 1048576;
  const slow = 1 + Math.min(draftFail, 4);
  const quiet = slow * Math.min(15000, DRAFT_QUIET + Math.max(0, mb - 1) * 1000);
  const max = slow * (mb > 5 ? 2 * DRAFT_MAX : DRAFT_MAX);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = 0;
    // 큰 덱은 글로 만드는 데 시간이 걸린다 — 손이 쉴 때
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => draftNow(), { timeout: 2000 });
    else draftNow();
  }, Math.max(0, Math.min(quiet, draftFirst + max - now)));
}

/* 지금 고침을 이 창의 줄에 쓴다(draftChain 안에서만) — 남겼으면 true, 남길 고침이 없거나 남기지 못했으면 false.
   force: 마지막으로 남긴 뒤 고친 것이 없어도 다시 쓴다(떠나기 전 — 그 사이 다른 창이 오래된 줄을 정리했을 수도 있다).
   판 기록 창이 열린 동안에는 오래된 줄을 정리하지 않는다 — 창에 보이는 줄을 고르는 사이 그 줄이 지워지지 않게. */
async function writeDraft(force) {
  if (!model || !hist || !draftable()) return false;
  const sig = editSig();
  if (!force && draftId && sig === drafted) return true;
  let text = '';
  try {
    text = model.serialize();
  } catch (e) {
    return false;
  }
  draftSize = text.length;
  const id = await putDraft(source.draftKey, text, { slides: model.slides.length, base: source.version }, draftId,
    !$('verDlg').open);
  if (!id) {
    draftFail += 1;
    return false;
  }
  draftFail = 0;
  draftId = id;
  drafted = sig;
  return true;
}

// 지금 고침을 임시 저장본으로 — 앞서 맡긴 남기기·지우기가 끝난 뒤에(draftChain)
function draftNow(force = false) {
  clearTimeout(draftTimer);
  draftTimer = 0;
  armed = '';
  draftFirst = 0;
  const job = draftChain.then(() => writeDraft(force));
  draftChain = job.catch(() => false);
  return job;
}

// 저장했으니 이 창의 임시 저장본과 이 창이 다시 연 임시 저장본을 지운다 — 다른 창·다른 때의 것은 그대로 두고, 다시 연
// 줄도 그 뒤 다른 창이 고쳐 썼으면 둔다. 저장하는 사이에 더 고친 것이 있으면 이 창의 줄은 지우지 않고 지금 고침으로
// 고쳐 쓴다(바탕 판은 방금 저장한 판) — 그 고침의 임시 저장본이 끊기지 않게. 고쳐 쓰지 못해도 지우지 않고 다시 해 본다.
function dropDrafts() {
  clearTimeout(draftTimer);
  draftTimer = 0;
  armed = '';
  draftFirst = 0;
  const gone = restoredDraft;
  restoredDraft = null;
  const job = draftChain.then(async () => {
    if (gone) await deleteDraft(gone.id, gone.time);
    if (draftable()) {
      if (!(await writeDraft(true))) draftSoon();
      return;
    }
    const id = draftId;
    draftId = 0;
    drafted = '';
    if (id) await deleteDraft(id);
  });
  draftChain = job.catch(() => {});
  return job;
}

// 주소의 판 표시(판 기록이 적는다)로 고른 판의 글 — {text, label, draftId?, base?}, 고른 판이 없으면 null.
// 임시 저장본이면 그 줄 번호와 그 고침의 바탕 판(base)도 — 바탕 판이 지금 판과 다르면 저장할 때 묻게 한다.
async function restoreFrom(params) {
  for (const [k, label] of Object.entries(VERSION_KEYS)) {
    const id = params.get(k);
    if (!id) continue;
    if (k === 'draft') {
      const d = await getDraft(id);
      if (!d || d.deck !== source.draftKey) {
        throw new Error('그 임시 저장본을 찾지 못했습니다 — 저장해서 지웠거나 다른 브라우저의 것일 수 있습니다.');
      }
      return { text: d.text, label, draftId: d.id, time: d.time, base: typeof d.base === 'string' ? d.base : '' };
    }
    if ((k === 'ref') !== (source.kind === 'github')) continue;   // 저장소의 판은 갤러리에서, 저장 전 판은 이 PC 에서만
    return { text: await source.readAt(id), label };
  }
  return null;
}

// 주소에서 판 표시를 지운다(저장한 뒤·고른 판을 열지 못했을 때) — 새로 고치면 지금 판이 열리게
function dropVersionParams() {
  const u = new URL(location.href);
  if (!Object.keys(VERSION_KEYS).some((k) => u.searchParams.has(k))) return;
  for (const k of Object.keys(VERSION_KEYS)) u.searchParams.delete(k);
  try { history.replaceState(history.state, '', u.href); } catch (e) { /* 주소는 못 바꿔도 편집은 된다 */ }
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
  if (boxes) boxes.update();
  refresh();
  if (side) side.onSlide();                // 찾기·색인 탭이면 이 장의 그 말을 형광으로
}

/* ---------- 고른 상자의 자리·크기 칸 */

// 칸은 늘 자리를 차지한 채 보이고 숨는다(visibility) — 칸이 생기고 없어지며 서식 막대의 줄 수가 바뀌면 덱 화면의 배율이
// 바뀌어, 누르는 사이 상자가 포인터 밑에서 움직인다. force 면 고치는 중인 칸의 값도 지금 상자의 값으로(받지 않은 값 등).
// 상자를 여럿 골랐으면 숨기고(맞추기는 ‘배치 ▾’에서), 잠근 상자면 값만 보이고 고치지 못하게 한다.
function showBox(force = false) {
  const list = pick.boxes;
  const box = list.length === 1 ? list[0] : null;
  els.fBox.classList.toggle('off', !box);
  if (!box) {
    // 숨긴 칸에 초점이 남으면 다음 키(PageDown 등)를 칸이 먹는다
    if (els.fBox.contains(document.activeElement)) document.activeElement.blur();
    return;
  }
  const g = pick.geom(box);
  const movable = pick.movable(box);
  const locked = pick.locked(box);
  for (const label of els.fBox.querySelectorAll('.pos-field')) label.classList.toggle('off', !movable);
  for (const [input, v] of [[els.bW, g.w], [els.bH, g.h], [els.bX, g.x], [els.bY, g.y]]) {
    input.disabled = locked;
    if (force || document.activeElement !== input) input.value = String(v);
  }
}

function rerender(i, focusToc) {
  settle();
  if (layout) layout.sync();               // 장마다의 쪽 레이아웃(쪽 번호 등)을 지금 차례로 — 설정에서 다시 그리는 것이라 기록하지 않는다
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
  else if (op.t === 'layout') layout.undoOp(op, fwd);
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
  master.refresh();                       // 모든 장에·쪽 레이아웃 창이 열려 있으면 보이는 값을 덱의 지금 값으로
  layout.refresh();
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
  inputRev += 1;
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
    // 저장했으니 이 창의 임시 저장본은 지우고 주소의 판 표시도 지운다(새로 고치면 지금 판)
    staleBase = false;
    currentVersion = source.version;
    dropDrafts();
    dropVersionParams();
    const note = placeholderNote(placeholderSlides());
    msg(`${r.message}${note}`, note ? 'warn' : 'ok', 12000, r.link ? { href: r.link, label: '커밋 보기' } : null);
  } catch (e) {
    if (e.code === 'token') {
      if (e.forget) source.forgetToken();
      tokenError = e.message;
    } else if (e.code === 'conflict') {
      conflict(text, staleBase ? '이 임시 저장본을 고친 뒤에 저장된 덱이 바뀌었습니다.' : e.message);
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

// 배치 단축키 → 썼으면 true. ‘]’·‘[’ 은 Shift 를 누르면 글자가 바뀌므로 키 자리(code)로 본다.
function arrangeKey(e, k) {
  if (k === 'a' && !e.shiftKey) arrange.selectAll();
  else if (k === 'g') { if (e.shiftKey) arrange.ungroup(); else arrange.group(); }
  else if (e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) arrange.order(e.code === 'BracketRight' ? 'front' : 'back');
  else return false;
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
  // Ctrl+D 복제 — 글을 고치는 중에도(글에서는 쓸 일이 없는 키다). 노트·덱의 입력 칸에서는 쓰지 않는다.
  if (mod && !e.shiftKey && k === 'd' && !(inText && (!fromFrame || field))) {
    e.preventDefault();
    boxes.duplicate();
    return;
  }
  // 서식 붓 — Esc 는 먼저 붓을 끈다(글 고치기·상자 고르기는 그대로). Ctrl+Shift+C 집기·V 입히기는 글을 고치는 중에도.
  if (e.key === 'Escape' && painter.mode) {
    e.preventDefault();
    painter.off();
    return;
  }
  if (!(inText && (!fromFrame || field)) && painter.key(e)) {
    e.preventDefault();
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
  // 배치 — 글을 고치는 중이 아닐 때: Ctrl+A 이 장의 상자 모두 · Ctrl+G 묶기 · Ctrl+Shift+G 묶음 풀기 · Ctrl+Shift+] 맨 앞 · [ 맨 뒤
  if (mod && arrangeKey(e, k)) {
    e.preventDefault();
    return;
  }
  // 고른 상자 복사·잘라내기·붙여 넣기(Ctrl+C·X·V) — 글을 고치는 중이 아닐 때
  if (boxes.key(e)) {
    e.preventDefault();
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
  // 막대 단추는 누를 때 초점을 옮기지 않는다(덱의 선택을 지키려고) — 노트 칸에 치던 글이 기록을 기다리는 채면 이어지는 상자·
  // 서식 고치기의 ‘고치기 전’ 사본에 섞여 되돌리기가 어긋난다. 막대를 누르는 순간 노트를 먼저 기록한다.
  for (const bar of [fmtEls.bar, $('obar')]) bar.addEventListener('pointerdown', flushNotes, true);
  els.picBtn.addEventListener('click', () => els.picFile.click());
  els.picFile.addEventListener('change', () => {
    const file = els.picFile.files && els.picFile.files[0];
    els.picFile.value = '';               // 같은 파일을 다시 골라도 change 가 나게
    if (file) boxes.picture(file);
  });
  els.masterBtn.addEventListener('click', () => master.open());
  els.layoutBtn.addEventListener('click', () => layout.open());
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
      const inFmt = t instanceof Element && t.closest('#fmt, #obar');
      const loose = t === document.body || t === document.documentElement;
      const inMaster = $('masterDlg').open && (loose || (t instanceof Element && t.closest('#masterDlg')));
      // 쪽 레이아웃 창은 글 칸(꼬리말 글·그림 설명)·숫자 칸 안이 아니면 편집기의 되돌리기
      const inPage = $('pageDlg').open && (loose || (t instanceof Element && t.closest('#pageDlg')));
      const inPanel = t instanceof Element && t.closest('#sideTabs, #panIdx, #panFind');
      const otherDialog = Array.from(document.querySelectorAll('dialog[open]')).some((d) => d.id !== 'masterDlg' && d.id !== 'pageDlg');
      if (k === 's' ? !otherDialog : (inFmt || (inMaster && !num) || (inPage && !typing) || (inPanel && !typing))) {
        onKey(e, false, false);
        return;
      }
    }
    if (document.querySelector('dialog[open]')) return;                                 // 창이 열린 동안 덱 키는 쉰다
    if (findKey(e, false)) return;                                                      // 찾기 칸 안에서도 Ctrl+F·H
    if (t instanceof Element && t.closest('#sideTabs, #panIdx, #panFind') && !mod) return;   // 색인·찾기 칸의 키는 그 칸의 것
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || (t instanceof Element && t.closest('dialog'))) return;
    if (t instanceof Element && t.closest('#toc') && !e.ctrlKey && !e.metaKey) return;   // 차례는 제 키를 쓴다
    if (t instanceof Element && t.closest('#layMenu, [role="menu"]') && !e.ctrlKey && !e.metaKey) return;   // 펼침 메뉴도
    onKey(e, t === els.notes, false);
  });
  window.addEventListener('beforeunload', (e) => {
    if (leaving || !isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // 뒤로 가기로 이 창이 되살아나면(bfcache) 떠날 때 다시 묻는다
  window.addEventListener('pageshow', () => { leaving = false; });
  // 창을 숨기거나 닫을 때 임시 저장본을 바로 남긴다(닫히는 중이면 다 쓰지 못할 수도 있다)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') draftNow(); });
  window.addEventListener('pagehide', () => { draftNow(); });
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
  // 판 기록에서 고른 판이면 그 판의 글로 연다 — 저장은 여전히 지금 판 위에(저장해야 그 판이 새 판이 된다)
  let restored = null;
  let restoreErr = '';
  try {
    restored = await restoreFrom(new URLSearchParams(location.search));
  } catch (e) {
    restoreErr = e.message;
    dropVersionParams();
  }
  if (restored) source.text = restored.text;
  els.title.textContent = source.title;
  els.where.textContent = source.label;
  els.back.hidden = source.kind !== 'github';
  els.present.hidden = !source.presentUrl;
  if (source.presentUrl) els.present.href = source.presentUrl;
  els.presenter.hidden = !source.presenterUrl;
  if (source.presenterUrl) els.presenter.href = source.presenterUrl;
  document.title = `${source.title} — 덱 편집`;
  model = new DeckModel(els.frame);
  try {
    await model.load(source.text, source.base);
  } catch (e) {
    if (restored) dropVersionParams();      // 새로 고치면 지금 판이 열리게
    fail(restored ? `고른 판을 열지 못했습니다 — ${e.message} 새로 고치면 지금 판을 엽니다.` : e.message);
    return;
  }
  source.text = '';
  hist = new History(applyOp);
  currentVersion = source.version;
  if (restored) {
    hist.savedSeq = -1;                 // 다시 연 판은 ‘저장 안 함’ — 저장해야 그 판이 새 판이 된다
    restoredDraft = restored.draftId ? { id: restored.draftId, time: restored.time } : null;
    // 임시 저장본을 고친 뒤 저장된 덱이 바뀌었으면, 그 고침의 바탕 판 위에 저장하려 한다 — 저장할 때 바뀐 판을 모르고
    // 덮어쓰지 않고 충돌로 알려 어떻게 할지 묻는다
    staleBase = !!restored.base && restored.base !== source.version && source.rebase(restored.base);
  }
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
    onInput: () => { inputRev += 1; if (pick) pick.place(); refresh(); if (side) side.changed(); },
    onFit: () => { if (pick) pick.place(); },
  });
  pick = new Pick({
    layer: $('pickLayer'), bar: fmtEls.bar, canvas, model, msg,
    onSelect: () => { showBox(); if (fmt) fmt.update(); if (boxes) boxes.update(); if (painter) painter.update(); },
    onPlace: () => showBox(),
  });
  // 자리 칸(왼쪽·위)은 옮길 수 있는 상자(빌더 상자·흐름 덱에 넣은 글상자)를 골랐을 때만 보인다(showBox) — 칸은 늘 자리를
  // 차지해 서식 막대의 폭이 바뀌지 않는다
  canvas.attach();
  pick.attach();
  fmt = new Formatter({ els: fmtEls, canvas, model, pick, msg });
  fmt.attach();
  boxes = new Boxes({ model, canvas, pick, fmt, msg, els: boxEls });
  boxes.attach();
  // 배치(맞추기·같은 간격·앞뒤 순서·묶기·잠그기) · 표의 행·열 · 서식 복사
  arrange = new Arrange({ model, canvas, pick, msg });
  arrange.attach({ button: $('arrBtn'), menu: $('arrMenu') });
  const tables = new Tables({ model, canvas, fmt, msg });
  tables.attach({ button: $('tblBtn'), menu: $('tblMenu') });
  painter = new Painter({ model, canvas, pick, fmt, msg, button: $('fPaint') });
  painter.attach();
  // 쪽 레이아웃(쪽 번호·꼬리말·로고) — 장마다의 자리 상자는 설정에서 그리고, 저장할 사본에는 새 차례로 다시 그린다
  layout = new PageLayout({
    model, hist, msg, settle, commitSlides, fonts: () => fmt.deckFonts,
    after: () => {
      const box = pick.box;
      rerender(model.cur);
      if (box && box.isConnected && model.current.contains(box)) pick.select(box);
    },
  });
  layout.attach();
  model.onSerialize = (root, slides) => layout.renderInto(slides);
  layout.sync();
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
  // 그림 줄이기 — 장 안의 그림을 장에 보이는 크기의 두 배로(한 번이 되돌리기 한 칸)
  const pictures = new Pictures({ model, msg, settle, commitSlides });
  pictures.attach({ button: $('picShrinkBtn'), dialog: $('picDlg') });
  fillLayouts();
  toc = new Toc({ list: els.toc, model, onGo: go, onMove: moveSlide, onDelete: deleteSlide, onRename: renameSlide });
  toc.render();
  // 왼쪽 칸의 색인·찾기 탭
  side = new Side({
    model, msg, settle, go: (i) => go(i), change: (fn) => canvas.change(fn), commitSlides,
    pushOp: (op) => { hist.push([op]); refresh(); },
  });
  side.attach();
  // 판 기록 — 임시 저장본·저장소의 판·이 PC 의 저장 전 판을 골라 다시 연다
  // 떠나기 전에 지금 고침을 임시 저장본으로 꼭 다시 쓴다 — 떠나도 되면(남겼거나 남길 고침이 없거나, 버리기로 했으면) true.
  // 남기지 못했으면 false — 판 기록 창이 고침이 사라진다고 알리고 다시 묻는다. 버리기로 했으면 남기기를 기다리지 않는다.
  const versions = new Versions({
    source, msg, isDirty: draftable, current: () => currentVersion,
    beforeLeave: async (discard) => {
      settle();
      const kept = draftNow(true);
      leaving = !!discard || !draftable() || (await kept);
      if (leaving) setTimeout(() => { leaving = false; }, 5000);   // 떠나지 못했으면 다시 묻게
      return leaving;
    },
  });
  versions.attach({ button: els.versions, dialog: $('verDlg') });
  bind();
  go(0);
  els.hint.textContent = HINT;
  // 다시 연 판·임시 저장본 알림 — 편집기가 준비됐다고 알리기(ready) 전에. 다시 연 임시 저장본보다 나중에 남긴 것(이 창이
  // 멈추기 전에 더 고친 것 등)이 있으면 함께 알린다. 브라우저 저장소가 멈추면 알림만 건너뛴다(BOOT_WAIT).
  const drafts = () => Promise.race([listDrafts(source.draftKey), new Promise((r) => { setTimeout(() => r([]), BOOT_WAIT); })]);
  const rd = restoredDraft;              // 기다리는 사이 저장하면 비워진다
  if (restored) {
    const newer = !!rd && (await drafts()).some((d) => d.id !== rd.id && d.time > rd.time);
    const more = newer ? ' 이보다 나중에 남긴 임시 저장본도 있습니다 — 위쪽 ‘판 기록’에서 고를 수 있습니다.' : '';
    msg(staleBase
      ? `${objParticle(restored.label)} 열었습니다 — 이 고침을 한 뒤에 저장된 덱이 바뀌었습니다. 저장할 때 그 바뀐 판을 `
        + `덮어쓸지 묻습니다(저장하지 않으면 아무것도 바뀌지 않습니다).${more}`
      : `${objParticle(restored.label)} 열었습니다 — 저장해야 이 판이 새 판이 됩니다(저장하지 않으면 아무것도 바뀌지 않습니다).${more}`,
    'warn', 15000);
  } else if (restoreErr) {
    msg(`고른 판을 열지 못해 지금 판을 열었습니다 — ${restoreErr}`, 'err', 15000);
  } else if ((await drafts()).length) {
    msg('이 덱의 임시 저장본이 있습니다 — 위쪽 ‘판 기록’에서 다시 열 수 있습니다.', 'warn', 12000);
  }
  els.loading.hidden = true;
  els.app.classList.add('ready');
  // 시험용 손잡이 — 토큰 등 저장소 정보는 내놓지 않는다
  window.__hse = Object.freeze({
    state: () => ({
      cur: model.cur, n: model.slides.length, family: model.family, notesMode: model.notesMode, size: { ...model.size },
      titles: model.slides.map((s) => model.titleOf(s)), dirty: isDirty(), undo: hist.undoStack.length,
      redo: hist.redoStack.length, saving, scale: canvas.scale, box: pick.box ? pick.geom(pick.box) : null,
      clip: !!boxes.clip, sel: pick.boxes.length, paint: painter.mode,
    }),
    serialize: () => { settle(); return model.serialize(); },
    notes: () => model.slides.map((s) => model.notesOf(s)),
    draft: () => draftNow(),
  });
}

boot();
