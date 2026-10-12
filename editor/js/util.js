/* 편집기 공용 도우미 — 요소 만들기, 글자 다듬기, 바이트·해시. */

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// 저장소 안 경로 → 주소. 한글·띄어쓰기 이름도 마디마다 따로 인코딩한다.
export const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
export const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const fileName = (p) => String(p).split('/').pop();

export function escHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const encoder = new TextEncoder();
export const utf8 = (s) => encoder.encode(s);
// BOM 은 TextDecoder 가 떼어 낸다 — 저장할 때 BOM 없이 쓴다.
export const fromUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

// git 이 파일 내용에 붙이는 이름(blob SHA-1) — GitHub 에 저장할 때 '이 판을 고쳤다'는 표시로 보낸다.
// 받은 바이트로 직접 계산하므로, 읽는 사이에 다른 커밋이 끼어도 엉뚱한 판을 덮어쓰지 않는다.
export async function gitBlobSha(bytes) {
  const head = encoder.encode(`blob ${bytes.length}${String.fromCharCode(0)}`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

export async function sha256Hex(bytes) {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 한국어 목적격 조사 — 받침이 있으면 '을', 없으면 '를'
export function objParticle(word) {
  const c = String(word).charCodeAt(String(word).length - 1) - 0xAC00;
  return word + (c >= 0 && c < 11172 && c % 28 ? '을' : '를');
}

// 한국어 주격 조사 — 받침이 있으면 '이', 없으면 '가'
export function subjParticle(word) {
  const c = String(word).charCodeAt(String(word).length - 1) - 0xAC00;
  return word + (c >= 0 && c < 11172 && c % 28 ? '이' : '가');
}

// 시각(밀리초) → ‘2026-10-12 19:05’(이 컴퓨터의 시각)
export function stamp(ms) {
  const d = new Date(Number(ms) || 0);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 받는 파일은 octet-stream 으로 — 브라우저가 text/html 덩어리를 이 출처의 문서로 열어 덱 스크립트를 돌리는 일이 없게
export function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
