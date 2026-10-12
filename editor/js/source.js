/* 덱 원본을 어디서 읽고 어디에 쓰는가.
   - 갤러리: editor/?deck=<덱 id> — 저장소(GitHub)의 원본을 raw 로 읽고, 저장은 토큰으로 contents API 에 커밋한다.
     사이트에 실린 사본(검색 제외 표시가 들어간 것, 배포가 늦는 것)이 아니라 저장소 원본을 고친다.
     읽은 바이트로 git blob SHA 를 직접 계산해 '이 판을 고쳤다'고 보낸다 — 그 사이 다른 커밋이 있으면 409 로 막힌다.
   - 이 PC: editor/?local=1#key=… — slides edit 이 띄운 127.0.0.1 서버. 열쇠는 주소의 # 뒤로만 받고 곧바로 주소 창에서 지운다
     (새로 고침에 쓰도록 이 탭의 sessionStorage 에만 남긴다). */

import { b64, enc, fileName, fromUtf8, gitBlobSha, utf8 } from './util.js';

const API = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const KEY_RE = /(?:^#|&)key=([A-Za-z0-9_-]{16,128})(?:&|$)/;
const KEY_SLOT = 'hse-local-key';       // 새로 고쳐도 다시 열리게 — 이 탭에만 둔다(sessionStorage)
// slides edit 의 발표 화면 서버(편집기와 포트가 달라 출처가 다르다)
const PRESENT_RE = /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/deck-files\/[A-Za-z0-9_-]{16,128}\/\S+$/;
// 커밋 작성자 메일 — build_manifest.py·gallery.js 와 같은 식(개인 메일이 공개 기록에 남지 않게)
const NOREPLY_RE = /^[0-9]{1,12}\+[A-Za-z0-9][A-Za-z0-9-]{0,38}@users\.noreply\.github\.com$/;

const hasBom = (b) => b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;

// 저장할 바이트 — 원본에 BOM 이 있었으면 되붙인다(읽을 때 떼어 냈다)
function bytesOf(text, bom) {
  const body = utf8(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xEF, 0xBB, 0xBF], 0);
  out.set(body, 3);
  return out;
}

function fail(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  return Object.assign(err, extra || {});
}

export async function openSource(params, hash) {
  if (params.get('local') === '1') return openLocal(hash);
  const id = params.get('deck');
  if (id) return openGithub(id);
  throw fail('usage', '편집할 덱을 고르지 않았습니다 — 갤러리에서 덱 카드의 ⋯ 메뉴 → ‘편집기에서 열기’로 여세요.');
}

/* ---------- 갤러리(GitHub) */

async function openGithub(id) {
  let data = null;
  try {
    const r = await fetch('../decks.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    throw fail('list', `덱 목록(decks.json)을 읽지 못했습니다 — ${e.message}`);
  }
  const d = (Array.isArray(data.decks) ? data.decks : []).find((x) => String(x.id || x.path || '') === id);
  if (!d) throw fail('missing', '목록에 없는 덱입니다 — 숨긴 덱이거나 아직 배포되지 않았을 수 있습니다.');
  if (d.kind !== 'file' && d.kind !== 'dir') {
    throw fail('kind', 'HTML 덱만 편집할 수 있습니다 — PDF·PPTX 는 원래 프로그램에서 고쳐 같은 이름으로 다시 올리세요.');
  }
  const path = String(d.path || '');
  if (!path.startsWith('decks/') || path.split('/').some((p) => p === '..' || p === '.' || p === '')) {
    throw fail('path', '덱 경로가 이상해 열지 않습니다.');
  }
  const site = data.site || {};
  if (!(typeof site.repo === 'string' && REPO_RE.test(site.repo))) {
    throw fail('repo', 'site.json 에 저장소(repo)가 없어 어디에 저장할지 모릅니다.');
  }
  const branch = typeof site.branch === 'string' && BRANCH_RE.test(site.branch) ? site.branch : 'main';
  const a = site.author;
  const author = a && typeof a.name === 'string' && typeof a.email === 'string' && NOREPLY_RE.test(a.email)
    ? { name: a.name, email: a.email } : null;
  const src = new GithubSource({ repo: site.repo, branch, author, path, deck: d });
  await src.read();
  return src;
}

class GithubSource {
  constructor({ repo, branch, author, path, deck }) {
    Object.assign(this, { repo, branch, author, path, deck });
    this.kind = 'github';
    this.token = '';        // 페이지 메모리에만 둔다(어디에도 적지 않음)
    this.sha = null;
    this.text = '';
    this.bom = false;
  }

  get title() { return String(this.deck.title || this.deck.name || fileName(this.path)); }
  get label() { return `GitHub ${this.repo} · ${this.path}`; }
  get fileName() { return fileName(this.path); }
  get base() { return new URL(`../${enc(this.path.split('/').slice(0, -1).join('/'))}/`, location.href).href; }
  get presentUrl() { return new URL(`../${enc(this.path)}`, location.href).href; }
  // 발표자 보기(presenter.html) — 편집기가 덱을 찾은 이름(id, 없으면 path)으로
  get presenterUrl() { return new URL(`presenter.html?deck=${encodeURIComponent(String(this.deck.id || this.deck.path))}`, location.href).href; }
  get historyUrl() { return `https://github.com/${this.repo}/commits/${enc(this.branch)}/${enc(this.path)}`; }
  get tokenUrl() {
    const q = new URLSearchParams({
      name: 'html-slides 덱 편집', description: `${this.repo} 덱 고치기(contents 쓰기만)`,
      target_name: this.repo.split('/')[0], expires_in: '90', contents: 'write',
    });
    return `https://github.com/settings/personal-access-tokens/new?${q}`;
  }
  hasToken() { return !!this.token; }
  setToken(t) { this.token = String(t || '').trim(); }
  forgetToken() { this.token = ''; }

  async gh(url, opts = {}) {
    try {
      return await fetch(url, {
        ...opts, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(opts.headers || {}) },
      });
    } catch (e) {
      throw fail('network', 'GitHub 에 닿지 못했습니다 — 인터넷 연결을 확인하고 다시 해 보세요.');
    }
  }

  contentsUrl() { return `${API}/repos/${this.repo}/contents/${enc(this.path)}`; }

  // 원본 바이트 → {bytes, sha}. 1 MB 넘는 파일도 읽히도록 raw 형식으로 받는다.
  async fetchRaw() {
    const r = await this.gh(`${this.contentsUrl()}?ref=${encodeURIComponent(this.branch)}`,
      { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw await this.apiError(r, 'read');
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { bytes, sha: await gitBlobSha(bytes) };
  }

  async read() {
    const got = await this.fetchRaw();
    if (!got) throw fail('missing', `저장소에서 ${this.path} 를 찾지 못했습니다 — 지웠거나 이름을 바꿨을 수 있습니다.`);
    this.sha = got.sha;
    this.bom = hasBom(got.bytes);
    this.text = fromUtf8(got.bytes);
  }

  // force: 그 사이 바뀐 저장소의 판을 덮어쓴다(바뀐 판은 GitHub 기록에 남는다)
  async save(text, { force } = {}) {
    if (!this.token) throw fail('token', '저장하려면 GitHub 토큰이 필요합니다.');
    let sha = this.sha;
    if (force) {
      const cur = await this.fetchRaw();
      sha = cur ? cur.sha : null;
    }
    const bytes = bytesOf(text, this.bom);
    const body = { message: `docs: 덱 고침 — ${this.fileName}(웹 편집기)`, content: b64(bytes), branch: this.branch };
    if (sha) body.sha = sha;
    if (this.author) {
      body.author = { ...this.author };
      body.committer = { ...this.author };
    }
    const r = await this.gh(this.contentsUrl(),
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await this.apiError(r, 'save');
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    this.sha = (j && j.content && typeof j.content.sha === 'string') ? j.content.sha : await gitBlobSha(bytes);
    const link = j && j.commit && typeof j.commit.html_url === 'string' && j.commit.html_url.startsWith('https://github.com/')
      ? j.commit.html_url : null;
    return { message: '저장했습니다 — 갤러리와 발표 화면에는 배포가 끝난 뒤(1~2분) 보입니다.', link };
  }

  async apiError(r, phase) {
    let msg = '';
    try {
      const j = await r.json();
      msg = j && typeof j.message === 'string' ? j.message.slice(0, 200) : '';
    } catch (e) { /* 본문 없음 */ }
    if (r.status === 401) return fail('token', '토큰이 맞지 않거나 기한이 지났습니다 — 새 토큰을 넣어 주세요.', { forget: true });
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') {
      return fail('rate', 'GitHub 요청 한도에 걸렸습니다 — 잠시 뒤 다시 해 보세요.');
    }
    if (r.status === 403) {
      return fail('token', '이 토큰으로는 이 저장소에 쓸 수 없습니다 — 토큰의 Contents 권한이 ‘Read and write’ 인지 확인하세요.', { forget: true });
    }
    if (r.status === 404 && phase === 'save') {
      return fail('token', `이 토큰으로는 저장소(${this.repo})가 보이지 않습니다 — 토큰을 만들 때 Repository access 에서 이 저장소를 골랐는지 확인하세요.`, { forget: true });
    }
    if (r.status === 409 || (r.status === 422 && /sha/i.test(msg))) {
      return fail('conflict', '편집기를 연 뒤에 저장소의 이 덱이 바뀌었습니다.');
    }
    if (r.status === 413) return fail('size', '파일이 너무 커서 GitHub 가 받지 않았습니다.');
    return fail('http', `GitHub 이 ${phase === 'save' ? '저장을' : '요청을'} 받지 않았습니다(HTTP ${r.status}${msg ? ` — ${msg}` : ''}).`);
  }
}

/* ---------- 이 PC(slides edit) */

async function openLocal(hash) {
  const m = KEY_RE.exec(hash || '');
  let key = m ? m[1] : '';
  if (key) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 주소를 못 바꿔도 편집은 된다 */ }
    try { sessionStorage.setItem(KEY_SLOT, key); } catch (e) { /* 막혀 있으면 새로 고칠 때 주소를 다시 열면 된다 */ }
  } else {
    try { key = sessionStorage.getItem(KEY_SLOT) || ''; } catch (e) { key = ''; }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) key = '';
  }
  if (!key) throw fail('usage', '이 PC 편집 열쇠가 주소에 없습니다 — slides edit 이 알려 준 주소를 그대로 여세요.');
  const src = new LocalSource(key);
  await src.read();
  return src;
}

class LocalSource {
  constructor(key) {
    this.kind = 'local';
    this.key = key;
    this.hash = '';
    this.name = '';
    this.path = '';
    this.text = '';
    this.present = '';
  }

  get title() { return this.name; }
  get label() { return `이 PC · ${this.path}`; }
  get fileName() { return this.name; }
  get base() { return `${location.origin}/deck-files/${this.key}/`; }
  // 저장된 파일을 덱 스크립트가 도는 보통 화면으로 — 편집기·저장과는 다른 출처(포트)에서 연다
  get presentUrl() { return this.present || null; }
  get presenterUrl() { return null; }        // 발표자 보기는 갤러리(decks.json)의 덱만
  get historyUrl() { return null; }
  hasToken() { return true; }

  async api(method, body, headers) {
    try {
      return await fetch('/api/deck', {
        method, body, cache: 'no-store', credentials: 'omit',
        headers: { 'X-HSE-Key': this.key, ...(headers || {}) },
      });
    } catch (e) {
      throw fail('network', '이 PC 편집 서버에 닿지 못했습니다 — slides edit 창을 닫았다면 ‘내려받기’로 고친 판을 받아 두고 다시 실행하세요.');
    }
  }

  async read() {
    const r = await this.api('GET');
    if (!r.ok) throw await this.error(r);
    const head = (k) => { try { return decodeURIComponent(r.headers.get(k) || ''); } catch (e) { return ''; } };
    this.hash = r.headers.get('X-HSE-Hash') || '';
    this.name = head('X-HSE-Name');
    this.path = head('X-HSE-Path');
    const present = r.headers.get('X-HSE-Present') || '';
    this.present = PRESENT_RE.test(present) ? present : '';
    this.text = fromUtf8(new Uint8Array(await r.arrayBuffer()));
  }

  async save(text, { force } = {}) {
    const r = await this.api('PUT', utf8(text), {
      'Content-Type': 'text/html; charset=utf-8', 'If-Match': this.hash, ...(force ? { 'X-HSE-Force': '1' } : {}),
    });
    if (!r.ok) throw await this.error(r);
    const j = await r.json();
    this.hash = String(j.hash || '');
    // 저장 전 판이 있는 곳은 slides edit 창에 적힌다 — 알림은 짧게
    const kept = typeof j.backup === 'string' && j.backup ? ' · 저장 전 판은 백업 폴더에 남겼습니다' : '';
    return { message: `저장했습니다 — ${this.name}${kept}`, link: null };
  }

  async error(r) {
    let msg = '';
    try { const j = await r.json(); msg = j && typeof j.error === 'string' ? j.error : ''; } catch (e) { /* 본문 없음 */ }
    if (r.status === 409) return fail('conflict', '편집기를 연 뒤에 파일이 다른 곳에서 바뀌었습니다.');
    if (r.status === 403) return fail('key', '이 PC 편집 서버가 요청을 거절했습니다 — slides edit 이 알려 준 주소로 다시 여세요.');
    return fail('http', `저장하지 못했습니다(HTTP ${r.status}${msg ? ` — ${msg}` : ''}).`);
  }
}
