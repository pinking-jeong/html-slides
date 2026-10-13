/* 숫자 감사 칸 — 왼쪽 칸의 ‘숫자’ 탭. 덱의 숫자에서 어긋나 보이는 곳(audit.js)을 묶어 보이고, 장 번호를 누르면 그 장으로
   가서 그 숫자들을 형광으로 보인다(장을 넘겨도 고른 것은 계속). 덱을 고치면 조금 뒤 다시 살핀다(side.js 가 부른다).
   고치지는 않는다 — 틀렸다는 뜻이 아니라 살펴볼 곳이다. */

import { h } from './util.js';
import { auditNumbers } from './audit.js';
import { highlight } from './find.js';

const $ = (id) => document.getElementById(id);
const GROUPS = [['값', ['round', 'value']], ['표의 합', ['sum']], ['표기', ['style']]];
const MAX_SLIDES = 40;
const MAX_FINDINGS = 300;            // 이보다 많으면 앞의 것만 보이고 나머지는 수만

const slidesOf = (f) => [...new Set(f.occ.map((n) => n.slide))].sort((a, b) => a - b);
// 찾은 곳마다 열쇠 — 종류·제목·장들(제목이 같은 곳이 여럿일 수 있어 같은 열쇠는 차례 번호를 붙인다)
function keysOf(findings) {
  const seen = new Map();
  return findings.map((f) => {
    const base = `${f.kind}|${f.title}|${slidesOf(f).join(',')}`;
    const k = seen.get(base) || 0;
    seen.set(base, k + 1);
    return `${base}#${k}`;
  });
}

export class NumPanel {
  // model, go(i): 장으로
  constructor({ model, go }) {
    Object.assign(this, { model, go });
    this.result = null;
    this.keys = [];
    this.picked = -1;          // 고른 찾은 곳(findings 의 번호) — 그 숫자들을 형광으로
    this.stale = false;        // 덱을 고친 뒤 아직 다시 살피지 않았다(side.changed 가 켠다)
  }

  attach() {
    $('numRun').addEventListener('click', () => this.run({ fresh: true }));     // 단추는 기억해 둔 것 없이 처음부터
    $('numList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      this.picked = Number(b.dataset.f);
      for (const li of $('numList').querySelectorAll('li[data-f]')) {
        const on = li.dataset.f === b.dataset.f;
        li.classList.toggle('cur', on);
        if (on) li.setAttribute('aria-current', 'true');
        else li.removeAttribute('aria-current');
      }
      this.go(Number(b.dataset.go));            // 장을 넘기면 side.onSlide → light()(고친 뒤면 먼저 다시 살핀다)
      this.light();
    });
  }

  // 다시 살핀다 — 고른 것과 키보드 자리는 같은 열쇠의 찾은 곳으로 이어 간다. fresh: 장마다 기억해 둔 것을 쓰지 않는다.
  run({ fresh = false } = {}) {
    const box = $('numList');
    const was = box.contains(document.activeElement) ? document.activeElement : null;
    const focus = was && was.dataset.f !== undefined ? { key: this.keys[Number(was.dataset.f)], go: was.dataset.go } : null;
    const keep = this.picked >= 0 ? this.keys[this.picked] : null;
    this.result = auditNumbers(this.model, { fresh });
    this.keys = keysOf(this.result.findings);
    this.stale = false;
    this.picked = keep ? this.keys.indexOf(keep) : -1;
    this.render();
    if (was) {
      const i = focus && focus.key ? this.keys.indexOf(focus.key) : -1;
      const again = i >= 0
        ? box.querySelector(`button[data-f="${i}"][data-go="${focus.go}"]`) || box.querySelector(`li[data-f="${i}"] button`)
        : null;
      (again || box).focus();
    }
    this.light();
  }

  render() {
    const { count, findings } = this.result;
    const sum = findings.length
      ? `숫자 ${count}개를 살펴 ${findings.length}곳을 짚었습니다 — 살펴볼 곳일 뿐 틀렸다는 뜻은 아닙니다.`
      : `숫자 ${count}개를 살폈습니다 — 어긋나 보이는 곳이 없습니다.`;
    if ($('numSum').textContent !== sum) $('numSum').textContent = sum;     // 바뀔 때만(화면 읽기 프로그램이 같은 말을 되풀이하지 않게)
    const out = [];
    const listed = findings.map((f, i) => [f, i]).slice(0, MAX_FINDINGS);
    for (const [name, kinds] of GROUPS) {
      const list = listed.filter(([f]) => kinds.includes(f.kind));
      if (!list.length) continue;
      out.push(h('h3', { class: 'ix-h' }, name));
      out.push(h('ul', { class: 'ix num' }, ...list.map(([f, i]) => {
        const slides = slidesOf(f);
        const cur = i === this.picked;
        return h('li', { 'data-f': String(i), class: cur ? 'cur' : null, 'aria-current': cur ? 'true' : null },
          h('span', { class: 'ix-t' }, h('b', { class: 'num-t' }, f.title), h('span', { class: 'num-d' }, f.detail)),
          h('span', { class: 'ix-n' }, ...slides.slice(0, MAX_SLIDES).map((s) => h('button', {
            type: 'button', class: 'ix-go', 'data-go': String(s), 'data-f': String(i), title: `${s + 1}장으로 — 그 숫자를 형광으로`,
            'aria-label': `${f.title} — ${s + 1}장`,
          }, String(s + 1))), slides.length > MAX_SLIDES ? h('span', { class: 'ix-more' }, `외 ${slides.length - MAX_SLIDES}`) : null));
      })));
    }
    if (findings.length > MAX_FINDINGS) {
      out.push(h('p', { class: 'ix-more' }, `외 ${findings.length - MAX_FINDINGS}곳 — 앞의 곳을 고친 뒤 다시 살피면 이어서 보입니다.`));
    }
    if (!out.length) out.push(h('p', { class: 'ix-empty' }, count ? '짚을 곳이 없습니다.' : '덱에서 살필 숫자를 찾지 못했습니다.'));
    $('numList').replaceChildren(...out);
  }

  // 고른 찾은 곳의 숫자들 가운데 이 장의 것을 형광으로
  light() {
    const f = this.result && this.result.findings[this.picked];
    highlight(this.model, f ? f.occ : [], null);
  }
}
