/* 그림 줄이기 창 — 장 안의 그림(덱 파일에 든 data: 주소)을 큰 것부터 보이고, 장에 보이는 크기의 두 배로 줄인다(pictures.js).
   그림은 덱 파일 안에 그대로 둔다 — ‘HTML 받기’로 받은 파일에도 함께 들어 있게. 한 번 줄인 것이 되돌리기 한 칸이다.
   줄이는 동안에는 창을 닫지 않는다(닫기·Esc — 그래도 닫히면 다시 연다) — 끝난 결과가 말없이 덱에 들어가지 않게. */

import { naturalSize } from './insert.js';
import { fmtBytes, kindOf, RASTER, replaceData, scan, shrinkData, targetOf } from './pictures.js';
import { h } from './util.js';

const NAMES = {
  'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/bmp': 'BMP', 'image/gif': 'GIF',
  'image/svg+xml': 'SVG', 'image/avif': 'AVIF',
};
// 줄이지 않은 까닭(shrinkData 의 why) → 알림
const WHY = {
  gain: '줄여도 15% 넘게 작아지지 않습니다', animated: '움직이는 그림입니다', error: '이 브라우저가 그림을 다시 담지 못했습니다',
  skip: '줄일 수 있는 그림이 아닙니다',
};

// 쓰인 장 번호 — 많으면 앞의 몇 개만
function pagesOf(p) {
  const nums = [...new Set(p.uses.map((u) => u.slide + 1))];
  return nums.length > 6 ? `${nums.slice(0, 6).join('·')}… ${nums.length}곳` : nums.join('·');
}

// 줄여 볼 만한가 — 가져야 할 픽셀보다 1할 넘게 크거나, 1 MB 를 넘거나, 눌러 담지 않은 BMP
function shrinkable(p) {
  if (!RASTER.test(p.type) || p.animated || p.wrapped || p.elsewhere || !p.target) return false;
  return p.target.w * 1.1 < p.nat.w || p.target.h * 1.1 < p.nat.h || p.bytes > 1048576 || p.type === 'image/bmp';
}

function noteOf(p, loading) {
  if (!RASTER.test(p.type)) return 'GIF·SVG·AVIF 는 그대로 둡니다';
  if (p.wrapped) return '그림 주소가 줄바꿈으로 나뉘어 있어 그대로 둡니다';
  if (p.elsewhere) return '장 밖(스타일 글·쪽 레이아웃 등)에도 쓴 그림이라 그대로 둡니다';
  if (!p.nat) return loading ? '재는 중…' : '그림으로 읽히지 않습니다';
  if (p.animated) return '움직이는 그림이라 그대로 둡니다';
  if (!p.uses.some((u) => u.box.w > 0 && u.box.h > 0)) return '장에 보이지 않아 크기를 정할 수 없습니다';
  if (!p.target) return '제 크기로 보이는 곳이 있어(object-fit:none·배경 크기 auto 등) 그대로 둡니다';
  if (!p.can) return '이미 알맞은 크기입니다';
  return `줄이면 ${p.target.w}×${p.target.h}`;
}

export class Pictures {
  /* model: 덱, msg: 알림, settle(): 하던 편집을 마친다, commitSlides(fn): 여러 장을 고친 것을 되돌리기 한 칸으로 */
  constructor({ model, msg, settle, commitSlides }) {
    Object.assign(this, { model, msg, settle, commitSlides });
    this.items = [];
    this.busy = false;
    this.loading = false;
    this.seq = 0;                  // 연 차례 — 늦게 끝난 옛 재기가 새 목록을 덮지 않게
  }

  attach({ button, dialog }) {
    this.dlg = dialog;
    this.list = dialog.querySelector('#picList');
    this.sum = dialog.querySelector('#picSum');
    this.status = dialog.querySelector('#picStatus');
    this.status.tabIndex = -1;     // 줄인 뒤 결과 줄로 초점을 옮긴다(목록을 다시 그리면 누른 단추가 사라진다)
    this.all = dialog.querySelector('#picAll');
    this.closeBtn = dialog.querySelector('#picClose');
    button.addEventListener('click', () => this.open());
    this.all.addEventListener('click', () => this.shrink(this.items.filter((p) => p.can)));
    this.closeBtn.addEventListener('click', () => { if (!this.busy) dialog.close(); });
    dialog.addEventListener('cancel', (e) => { if (this.busy) e.preventDefault(); });
    // 그래도 닫히면(브라우저는 잇따른 Esc 를 막지 못하게 두기도 한다) 줄이는 동안에는 다시 연다
    dialog.addEventListener('close', () => { if (this.busy) dialog.showModal(); });
    this.list.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('button[data-i]') : null;
      const p = b ? this.items[Number(b.dataset.i)] : null;
      if (p) this.shrink([p]);
    });
  }

  say(text, kind = '') {
    this.status.textContent = text;
    this.status.className = `m-status${kind ? ` ${kind}` : ''}`;
  }

  async open() {
    if (this.busy) return;
    this.say('');
    if (!this.dlg.open) this.dlg.showModal();
    await this.load();
  }

  // 장의 그림을 다시 찾고(보이는 크기·맞춤도 잰다) 그림마다 본래 픽셀·움직이는 그림인지를 잰다
  async load() {
    const seq = ++this.seq;
    this.settle();
    this.items = scan(this.model);
    this.loading = true;
    this.render();
    for (const p of this.items) {
      p.nat = await naturalSize(p.uri);
      const kind = kindOf(p.uri);            // 꼴은 바이트로 — 이름만 PNG 인 움직이는 GIF 등
      if (kind.type) p.type = kind.type;
      p.animated = kind.animated;
    }
    if (seq !== this.seq) return;
    for (const p of this.items) {
      p.target = targetOf(p);
      p.can = shrinkable(p);
    }
    this.loading = false;
    this.render();
  }

  render() {
    const total = this.items.reduce((s, p) => s + p.bytes, 0);
    this.sum.textContent = this.items.length
      ? `장 안의 그림 ${this.items.length}개 · 모두 ${fmtBytes(total)} — 큰 것부터`
      : '장 안에 덱 파일에 든 그림이 없습니다.';
    this.list.replaceChildren(...this.items.map((p, i) => h('li', null,
      h('img', { class: 'p-thumb', src: p.uri, alt: '' }),
      h('span', { class: 'v-time' }, fmtBytes(p.bytes)),
      h('span', { class: 'v-what' }, [NAMES[p.type] || p.type, p.nat ? `${p.nat.w}×${p.nat.h}` : '',
        p.shown.w > 0 ? `보이는 크기 ${p.shown.w}×${p.shown.h}` : '', `${pagesOf(p)}장`].filter(Boolean).join(' · ')),
      h('span', { class: 'v-meta' }, noteOf(p, this.loading)),
      p.can ? h('button', { type: 'button', class: 'btn small', 'data-i': String(i), disabled: this.busy }, '줄이기') : null)));
    this.all.disabled = this.busy || this.loading || !this.items.some((p) => p.can);
    this.closeBtn.disabled = this.busy;
    if (this.busy) this.dlg.setAttribute('aria-busy', 'true');
    else this.dlg.removeAttribute('aria-busy');
  }

  // 그림들을 줄여 한꺼번에 바꾼다 — 되돌리기 한 칸. 줄이지 못한 것은 까닭별로 센다.
  async shrink(list) {
    if (this.busy || this.loading || !list.length) return;
    this.busy = true;
    this.render();
    const pairs = [];
    const skipped = new Map();
    let from = 0;
    let to = 0;
    let broke = '';
    try {
      for (const [k, p] of list.entries()) {
        this.say(`줄이는 중… ${k + 1} / ${list.length}`);
        const r = await shrinkData(p.uri, p.nat, p.target);
        if (r.url) {
          pairs.push([p.uri, r.url]);
          from += p.bytes;
          to += r.size;
        } else {
          skipped.set(r.why, (skipped.get(r.why) || 0) + 1);
        }
      }
    } catch (e) {
      broke = e && e.message ? e.message : String(e);
    }
    let put = false;
    let lost = '';
    try {
      if (pairs.length) this.commitSlides(() => { for (const [a, b] of pairs) replaceData(this.model, a, b); });
      put = pairs.length > 0;
    } catch (e) {
      lost = e && e.message ? e.message : String(e);
    } finally {
      this.busy = false;
    }
    if (this.dlg.open) await this.load();
    else this.render();
    const why = [...skipped].map(([w, n]) => `${WHY[w] || w}${list.length > 1 ? ` ${n}개` : ''}`).join(', ');
    const stop = broke ? ` 줄이다가 멈췄습니다(${broke}).` : '';
    let text;
    let kind;
    if (lost) {
      text = `줄인 그림을 덱에 넣다가 멈췄습니다(${lost}) — 덱의 그림을 확인하세요.`;
      kind = 'err';
    } else if (put) {
      text = `그림 ${pairs.length}개를 줄였습니다 — ${fmtBytes(from)} → ${fmtBytes(to)}. 창을 닫고 되돌리기(Ctrl+Z) 한 번으로 `
        + `돌아갑니다.${why ? ` 줄이지 않은 것: ${why}.` : ''}${stop}`;
      kind = broke ? 'warn' : 'ok';
    } else {
      text = `줄이지 않았습니다 — ${why || '줄일 그림이 없습니다'}.${stop}`;
      kind = 'warn';
    }
    this.say(text, kind);
    if (this.dlg.open) this.status.focus();
    else this.msg(text, kind, 9000);
  }
}
