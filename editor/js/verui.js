/* 판 기록 — 이 덱의 이전 판을 골라 편집기에 다시 연다. 저장해야 그 판이 새 판이 되고, 저장하지 않으면 아무것도 바뀌지 않는다.
   - 이 브라우저의 임시 저장본(drafts.js): 저장하지 않은 고침을 편집 창마다 하나씩 남긴 것(덱마다 최근 5개 창, 그 창에서
     저장하면 그 창의 것만 지운다).
   - 저장소의 판(갤러리에서 연 덱): 이 덱 파일을 바꾼 커밋 — 최근 30개.
   - 이 PC 의 저장 전 판(slides edit): 저장할 때마다 그 앞의 파일을 남긴 것 — 최근 30개와, 이번에 고치기 시작하기 전의 판.
   불러오기는 주소에 판을 적어 편집기를 다시 연다. 저장하지 않은 고침이 있으면 먼저 묻고 그 고침을 임시 저장본에 남긴다 —
   남기지 못하면(사생활 보호 창 등) 고침이 사라진다고 알리고 한 번 더 묻는다. */

import { listDrafts } from './drafts.js';
import { h, stamp } from './util.js';

const GO = '불러오기';
const LEAVE_WAIT = 15000;          // 남기기가 끝나지 않으면(브라우저 저장소가 멈춤 등) 이만큼 기다리고 남기지 못했다고 본다

export class Versions {
  /* source: 덱을 읽고 쓰는 곳(source.js), msg: 알림, isDirty(): 저장하지 않은 고침이 있나,
     beforeLeave(discard): 떠나기 전에 지금 고침을 임시 저장본으로 — 떠나도 되면 true(discard: 남기지 못해도 버리고 떠난다),
     current(): 이 창이 아는 지금 판 — 임시 저장본이 그보다 옛 판에서 고친 것인지 견준다 */
  constructor({ source, msg, isDirty, beforeLeave, current }) {
    Object.assign(this, { source, msg, isDirty, beforeLeave, current });
    this.dlg = null;
    this.want = null;              // 묻는 중인 불러오기 {kind, id, label, from(누른 단추), discard}
    this.seq = 0;                  // 연 차례 — 늦게 온 옛 목록이 새 목록을 덮지 않게
  }

  attach({ button, dialog }) {
    this.dlg = dialog;
    this.lists = { drafts: dialog.querySelector('#verDrafts'), repo: dialog.querySelector('#verRepo') };
    this.repoH = dialog.querySelector('#verRepoH');
    this.repoHelp = dialog.querySelector('#verRepoHelp');
    this.ask = dialog.querySelector('#verAsk');
    this.askText = dialog.querySelector('#verAskText');
    this.go = dialog.querySelector('#verGo');
    this.liveEl = dialog.querySelector('#verLive');
    button.addEventListener('click', () => this.open());
    dialog.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('button[data-kind]') : null;
      if (b) this.pick(b.dataset.kind, b.dataset.id, b.dataset.label, b);
    });
    this.go.addEventListener('click', () => {
      if (this.want) this.leave(this.want.kind, this.want.id, !!this.want.discard);
    });
    dialog.querySelector('#verStay').addEventListener('click', () => {
      const from = this.want && this.want.from;
      this.unask();
      if (from && from.isConnected) from.focus();       // 숨긴 물음 칸에 머물던 초점을 고른 단추로
      else this.dlg.focus();
    });
    dialog.querySelector('#verClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => this.unask());
    // 남기고 떠나는 동안에는 Esc 로 창을 닫지 않는다
    dialog.addEventListener('cancel', (e) => { if (dialog.getAttribute('aria-busy') === 'true') e.preventDefault(); });
  }

  // 화면 낭독기에 알림(창 안의 보이지 않는 알림 칸)
  live(text) {
    if (this.liveEl) this.liveEl.textContent = text;
  }

  async open() {
    this.unask();
    const seq = ++this.seq;
    const local = this.source.kind === 'local';
    this.repoH.textContent = local ? '이 PC 의 저장 전 판' : '저장소의 판';
    this.repoHelp.textContent = local
      ? '저장할 때마다 그 앞의 파일을 남긴 것입니다(최근 30개와, 이번에 고치기 시작하기 전의 판). 시각은 남긴 때입니다.'
      : '이 덱 파일을 바꾼 커밋입니다(최근 30개). GitHub 에서 바뀐 곳을 볼 수도 있습니다.';
    for (const l of Object.values(this.lists)) {
      l.setAttribute('aria-busy', 'true');
      l.replaceChildren(h('li', { class: 'v-empty' }, '불러오는 중…'));
    }
    this.live('판 기록을 불러오는 중…');
    if (!this.dlg.open) this.dlg.showModal();
    const [drafts, repo] = await Promise.all([
      listDrafts(this.source.draftKey),
      this.source.versions().then((v) => v, (e) => e),
    ]);
    if (seq !== this.seq || !this.dlg.open) return;
    const base = this.current ? this.current() : this.source.version;
    this.fill(this.lists.drafts, drafts.map((d) => ({
      kind: 'draft', id: String(d.id), time: stamp(d.time), what: d.slides ? `${d.slides}장` : '',
      meta: d.base && base && d.base !== base ? '지금 판보다 옛 판에서 고친 것' : '', warn: true,
      label: `임시 저장본(${stamp(d.time)})`,
    })), '임시 저장본이 없습니다.');
    const repoName = local ? '저장 전 판' : '저장소의 판';
    if (repo instanceof Error) {
      this.lists.repo.replaceChildren(h('li', { class: 'v-empty err' }, repo.message));
      this.lists.repo.setAttribute('aria-busy', 'false');
      this.live(`임시 저장본 ${drafts.length}개 · ${repoName}을 불러오지 못했습니다 — ${repo.message}`);
      return;
    }
    this.fill(this.lists.repo, repo.map((v, i) => ({
      kind: local ? 'backup' : 'ref', id: v.id, time: stamp(v.time), what: v.what, meta: v.meta, link: v.link,
      label: `${repoName}(${stamp(v.time)})`, now: !local && i === 0,
    })), local ? '저장 전 판이 아직 없습니다 — 처음 저장할 때 생깁니다.' : '이 덱을 바꾼 커밋을 찾지 못했습니다.');
    this.live(`판 기록을 불러왔습니다 — 임시 저장본 ${drafts.length}개, ${repoName} ${repo.length}개.`);
  }

  fill(list, rows, empty) {
    list.setAttribute('aria-busy', 'false');
    if (!rows.length) {
      list.replaceChildren(h('li', { class: 'v-empty' }, empty));
      return;
    }
    list.replaceChildren(...rows.map((r) => h('li', null,
      h('span', { class: 'v-time' }, r.time),
      h('span', { class: 'v-what' }, r.what || ''),
      r.meta ? h('span', { class: `v-meta${r.warn ? ' warn' : ''}` }, r.meta) : null,
      r.link ? h('a', { class: 'v-link', href: r.link, target: '_blank', rel: 'noopener' }, 'GitHub') : null,
      r.now ? h('span', { class: 'v-now' }, '지금 판')
        : h('button', {
          type: 'button', class: 'btn small', 'data-kind': r.kind, 'data-id': r.id, 'data-label': r.label,
          'aria-label': `${r.label} ${GO}`,
        }, GO))));
  }

  pick(kind, id, label, from = null) {
    if (!this.isDirty()) {
      this.leave(kind, id);
      return;
    }
    this.want = { kind, id, label, from, discard: false };
    this.go.textContent = GO;
    this.askText.textContent = `저장하지 않은 고침이 있습니다 — ${label}을 불러올까요? 지금 고침은 임시 저장본으로 남깁니다.`;
    this.ask.hidden = false;
    this.go.focus();
  }

  unask() {
    this.want = null;
    if (this.ask) this.ask.hidden = true;
    if (this.go) this.go.textContent = GO;
  }

  // 남기고 떠나는 동안 창의 단추를 쉬게 한다
  busy(on) {
    this.dlg.setAttribute('aria-busy', on ? 'true' : 'false');
    for (const b of this.dlg.querySelectorAll('button')) b.disabled = on;
  }

  async leave(kind, id, discard = false) {
    this.busy(true);
    this.live('지금 고침을 남기고 고른 판을 여는 중…');
    let ok = false;
    let timer = 0;
    try {
      ok = await Promise.race([
        this.beforeLeave(discard),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), LEAVE_WAIT); }),
      ]);
    } catch (e) {
      ok = false;
    }
    clearTimeout(timer);
    if (!ok) {
      // 지금 고침을 남기지 못했다 — 떠나면 사라지니 알리고 한 번 더 묻는다(그 사이 창을 닫았으면 그대로 둔다)
      this.busy(false);
      if (!this.dlg.open) return;
      const from = this.want && this.want.from;
      const label = (this.want && this.want.label) || '고른 판';
      this.want = { kind, id, label, from, discard: true };
      this.askText.textContent = '지금 고침을 이 브라우저에 남기지 못했습니다(사생활 보호 창이거나 저장 공간이 모자랄 수 '
        + `있습니다) — 그래도 ${label}을 불러오면 저장하지 않은 고침은 사라집니다. 먼저 저장하거나 ‘HTML 받기’로 받아 두세요.`;
      this.go.textContent = '고침을 버리고 불러오기';
      this.ask.hidden = false;
      this.go.focus();
      this.live(this.askText.textContent);
      return;
    }
    const u = new URL(location.href);
    for (const k of ['ref', 'draft', 'backup']) u.searchParams.delete(k);
    u.searchParams.set(kind, id);
    location.assign(u.href);
    setTimeout(() => this.busy(false), 3000);              // 떠나지 못했으면(브라우저가 막는 등) 창을 다시 쓰게
  }
}
