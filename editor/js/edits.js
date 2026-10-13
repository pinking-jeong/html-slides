/* 편집 기록 — 빌더 덱을 저장할 때 본문 끝에 남기는 <script type="application/json" id="deck-edits"> 와 상자 표식(data-hs-ref).
   원본(빌더가 만든 파일)을 다시 빌드하면 slides sync 가 이 기록으로 옛 빌드를 git 에서 찾아, 편집기에서 고친 곳만 새 빌드에
   다시 입힌다(tools/deckmerge.py — 빌더도 같은 곳을 바꿨으면 빌더 것을 따르고 알린다). 고친 곳 자체는 적지 않는다 — 옛 빌드·
   저장본·새 빌드를 견주면 드러난다. 기록에 드는 것
   - build: 편집을 시작한 빌드 파일의 git blob sha(옛 빌드를 찾는 열쇠). 불러온 파일에 기록이 있으면 그것을 이어받는다.
   - saved: 기록을 뺀 파일 글(BOM 없이)의 sha256 — 저장 뒤 편집기 밖에서 바뀌었나 알아보게.
   - complete·why: 불러온 파일의 기록이 그 파일과 맞지 않으면(편집기 밖에서 고친 뒤 연 것) false 와 그 까닭 — slides 는 그런
     덱에 다시 입히지 않는다(고친 곳을 다 알 수 없으므로).
   손대지 않고 저장하면 불러온 글 그대로 둔다(기록이 없던 덱은 고친 것이 있을 때만 기록을 더한다).
   상자 정체 — 장의 바로 아래 요소(쪽 레이아웃 자리 상자는 빼고). 표식이 있으면 그것, 없으면 표식 없는 상자끼리 DOM 차례로 센
   'n:이름#k'(data-name)·'u:태그#k'. 편집기에서 넣은 상자는 '+k'. 불러올 때 상자마다 세션 표(data-hse-ref="장 번호표|정체",
   저장할 때 떨어진다)를 달고, 저장할 때는 표식 없이 셌을 때 정체와 어긋나는 상자에만 data-hs-ref 를 단다 — 앞뒤 차례를 바꾸거나
   상자를 넣고 지워도 옛 빌드의 어느 상자였는지 deckmerge 가 같은 규칙으로 센다. 복제·복사한 상자는 asNew 로 새 상자가 된다. */

import { A } from './deck.js';
import { utf8 } from './util.js';

export const EDITS_ID = 'deck-edits';
const OPEN = '<script type="application/json" id="deck-edits">';
const EDITS_RE = /<script type="application\/json" id="deck-edits">([^<]*)<\/script>/g;
const LT = `${String.fromCharCode(92)}u003c`;        // JSON 을 <script> 에 넣을 때의 '<'
export const REF = 'data-hs-ref';
export const SESSION = 'data-hse-ref';                // 편집기 전용(data-hse-*) — 저장할 때 떨어진다
const REF_RE = /^(?:n:[\s\S]+|u:[a-z][a-z0-9-]*)#[1-9][0-9]{0,5}$|^\+[1-9][0-9]{0,5}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ZONE_POS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

/* ---------- sha256(동기 — 저장 글을 만드는 serialize 가 동기라서) */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(bytes) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const n = bytes.length;
  const total = Math.ceil((n + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000));     // 길이(비트)의 윗 32비트 = n·8 / 2^32
  dv.setUint32(total - 4, (n * 8) >>> 0);
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = W[i - 15];
      const y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0]; let b = H[1]; let c = H[2]; let d = H[3];
    let e = H[4]; let f = H[5]; let g = H[6]; let h = H[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

/* ---------- 기록 읽기 */

// 덱 글(BOM 없이)의 편집 기록 → {ov, plain, raw, at}: 기록, 기록 요소를 뺀 글, 그 요소의 글, 뺀 자리. 없거나 둘 이상이거나
// 꼴이 틀리면 ov=null·raw=null(글 그대로).
export function readEdits(text) {
  const found = Array.from(text.matchAll(EDITS_RE));
  const none = { ov: null, plain: text, raw: null, at: 0 };
  if (found.length !== 1) return none;
  const m = found[0];
  let ov = null;
  try { ov = JSON.parse(m[1]); } catch (e) { ov = null; }
  const ok = ov && typeof ov === 'object' && !Array.isArray(ov) && ov.v === 1 && typeof ov.build === 'string'
    && SHA1_RE.test(ov.build) && typeof ov.saved === 'string' && SHA256_RE.test(ov.saved)
    && typeof ov.complete === 'boolean' && (ov.why === undefined || Array.isArray(ov.why));
  if (!ok) return none;
  return { ov, plain: text.slice(0, m.index) + text.slice(m.index + m[0].length), raw: m[0], at: m.index };
}

// 기록의 saved 가 이 글과 맞는가 — 줄바꿈만 바뀐 것(slides edit 이 파일의 줄바꿈에 맞춰 쓴 것)도 맞는 것으로
// (tools/deckmerge.py 의 saved_ok 와 같게)
function savedFits(plain, saved) {
  if (sha256Hex(utf8(plain)) === saved) return true;
  const lf = plain.replace(/\r\n/g, '\n');
  return sha256Hex(utf8(lf)) === saved || sha256Hex(utf8(lf.replace(/\n/g, '\r\n'))) === saved;
}

/* ---------- 상자 정체 */

const isZone = (el) => el.localName === 'div' && el.classList.contains('hsl')
  && ZONE_POS.includes(el.getAttribute('data-deck-layout'));
const groupOf = (el) => {
  const name = el.getAttribute('data-name');
  return name !== null ? `n:${name}` : `u:${el.localName.toLowerCase()}`;
};

// 장의 상자들과 그 정체 → [[정체, 요소]] (tools/deckmerge.py 의 boxes 와 같은 규칙)
export function boxesOf(slide) {
  const counts = new Map();
  const seen = new Set();
  const out = [];
  for (const el of Array.from(slide.children)) {
    if (isZone(el)) continue;
    const ref = el.getAttribute(REF);
    let ident;
    if (ref !== null && REF_RE.test(ref)) {
      ident = ref;
    } else {
      const g = groupOf(el);
      const k = (counts.get(g) || 0) + 1;
      counts.set(g, k);
      ident = `${g}#${k}`;
    }
    if (seen.has(ident)) {
      let k = 1;
      while (seen.has(`${ident}~${k}`)) k += 1;
      ident = `${ident}~${k}`;
    }
    seen.add(ident);
    out.push([ident, el]);
  }
  return out;
}

// 복제·복사·붙여 넣기·다른 장에 옮겨 적은 상자 — 옛 빌드의 어느 상자도 아니다(세션 표·표식을 떼어 새 상자로)
export function asNew(root) {
  for (const n of [root, ...root.querySelectorAll(`[${SESSION}],[${REF}]`)]) {
    n.removeAttribute(SESSION);
    n.removeAttribute(REF);
  }
}

export class Edits {
  constructor(model) {
    this.model = model;
    this.on = model.family === 'builder';
    this.build = '';
    this.complete = true;
    this.why = [];
    this.loaded = null;           // 불러온 글 — {sha: 기록을 뺀 글의 sha256, raw: 기록 요소 글, at: 그 자리}
    this.edited = () => true;     // 연 뒤 고친 것이 있나(app.js 가 되돌리기 기록으로 단다)
  }

  /* 불러온 글(text)과 그 글이 나온 빌드 파일의 git blob sha(blob) — 글에 기록이 있으면 그 build 를 이어받고, 기록이 그 글과
     맞지 않으면 complete=false. 장마다 상자에 세션 표를 단다. */
  begin(text, blob) {
    if (!this.on) return;
    const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const { ov, plain, raw, at } = readEdits(src);
    const sha = sha256Hex(utf8(plain));
    this.loaded = { sha, raw, at };
    if (ov) {
      const fits = sha === ov.saved || savedFits(plain, ov.saved);
      this.build = ov.build;
      this.complete = ov.complete && fits;
      this.why = (ov.why || []).filter((w) => typeof w === 'string').slice(0, 20);
      if (!fits) this.why.push('편집 기록을 남긴 뒤 편집기 밖에서 바뀐 파일을 열어 고쳤습니다');
    } else {
      this.build = SHA1_RE.test(String(blob || '')) ? String(blob) : '';
    }
    for (const s of this.model.slides) {
      const sid = s.getAttribute(A.id);
      for (const [ident, el] of boxesOf(s)) el.setAttribute(SESSION, `${sid}|${ident}`);
    }
  }

  // 저장할 사본에서 지난 기록을 뗀다 — 저장할 때마다 새로 쓴다
  strip(root) {
    if (!this.on) return;
    for (const n of root.querySelectorAll(`script#${EDITS_ID}`)) n.remove();
  }

  /* 저장할 사본의 장들(새 차례)에 표식을 단다 — 세션 표로 옛 정체를 찾고(같은 장의 것, 처음 나온 것만 — 복제본은 새 상자),
     표식 없이 셌을 때 어긋나는 상자와 새 상자('+k')에만 data-hs-ref 를 남긴다. */
  mark(slides) {
    if (!this.on) return;
    for (const s of slides) {
      const sid = s.getAttribute(A.id);
      const seen = new Set();
      const used = new Set();
      const items = [];
      for (const el of Array.from(s.children)) {
        if (isZone(el)) continue;
        const ses = el.getAttribute(SESSION) || '';
        const bar = ses.indexOf('|');
        let ident = null;
        if (bar > 0 && ses.slice(0, bar) === sid) {
          const id = ses.slice(bar + 1);
          if (!seen.has(id) && !id.includes('~')) {
            seen.add(id);
            ident = id;
          }
        }
        if (ident && ident.startsWith('+')) used.add(Number(ident.slice(1)));
        items.push([el, ident]);
      }
      let next = 1;
      const counts = new Map();
      for (const [el, ident0] of items) {
        let ident = ident0;
        if (!ident) {
          while (used.has(next)) next += 1;
          used.add(next);
          ident = `+${next}`;
        }
        let mark = null;
        if (ident.startsWith('+')) {
          mark = ident;
        } else {
          const g = groupOf(el);
          const here = `${g}#${(counts.get(g) || 0) + 1}`;
          if (here === ident) counts.set(g, (counts.get(g) || 0) + 1);
          else mark = ident;
        }
        if (mark) el.setAttribute(REF, mark);
        else el.removeAttribute(REF);
      }
    }
  }

  /* 저장 글(out — token 자리에 기록이 들어간다)을 봉한다: token 을 뺀 글의 sha256 을 담은 기록을 그 자리에. 불러온 글과
     같으면(손대지 않음) 불러온 글 그대로, 기록이 없던 덱을 고치지 않았으면 기록 없이, build 를 모르면 기록 없이(그 덱은 다시
     빌드되면 지금처럼 덮지 않고 알린다). */
  seal(out, token) {
    if (!out.includes(token)) return out;
    const plain = out.replace(token, '');
    if (!this.on) return plain;
    const sha = sha256Hex(utf8(plain));
    const L = this.loaded;
    if (L && sha === L.sha) return L.raw ? plain.slice(0, L.at) + L.raw + plain.slice(L.at) : plain;
    // 기록이 없던 덱을 고치지 않았으면 — 다시 쓰며 생긴 차이(hidden="" 등)만으로 기록을 붙이지 않는다
    if (L && !L.raw && !this.edited()) return plain;
    if (!SHA1_RE.test(this.build)) return plain;
    const json = JSON.stringify({ v: 1, build: this.build, saved: sha, complete: this.complete, why: this.why })
      .replace(/</g, LT);
    return out.replace(token, () => `${OPEN}${json}</script>`);
  }
}
