/* 그림 줄이기 — 덱 안의 그림(data: 주소)을 보이는 크기에 맞게 줄여 덱 파일을 가볍게 한다. 덱은 한 파일 그대로 둔다(‘HTML 받기’로
   받은 파일에도 그림이 함께 들어 있게 — 그림을 따로 떼면 그 파일만 옮겼을 때 그림이 빠진다).
   - 넣을 때(shrinkFile): 사진·그림(PNG·JPG·WebP·BMP)이 장 크기의 두 배(2560×1440)보다 크면 그 안으로 줄여 넣고, 크기는
     맞아도 파일이 1.5 MB 를 넘으면 같은 크기로 다시 담는다.
   - ‘그림 줄이기’ 창(scan → targetOf → shrinkData → replaceData): 장 안의 그림마다 크기·본래 픽셀·보이는 크기·쓰인 장을 보이고,
     보이는 크기의 2배(고해상도 화면·프로젝터에서도 선명하게)로 줄인다. 맞춤에 따라 — 상자 안에 맞춘 그림(object-fit:contain,
     SVG 의 meet)은 짧은 쪽이, 채워 자르거나 늘인 그림(cover·fill, SVG 의 slice)은 긴 쪽이 두 배가 되게. 제 크기로 보이는
     그림(object-fit:none, 배경 크기 auto·길이)은 줄이면 보이는 크기가 바뀌어 그대로 둔다. 같은 그림을 여러 곳에 썼으면 가장
     크게 필요한 곳에 맞춰 함께 바꾼다.
   - 줄이는 방식: 사진(JPEG·WebP 바탕)은 WebP(품질 0.86 — JPEG 은 JPEG 0.86 과 견줘 작은 것), 그림·스크린숏(PNG·BMP)은 PNG 와
     WebP(품질 0.92) 가운데 작은 것. 줄이든 같은 크기로 다시 담든 원래보다 15% 넘게 작아질 때만 바꾼다. 움직이는 그림(GIF·APNG·
     움직이는 WebP)·SVG·AVIF 는 건드리지 않는다 — 다시 담으면 첫 장면만 남는다. 그림의 꼴은 붙은 이름이 아니라 바이트로 본다
     (브라우저도 바이트로 알아본다 — 이름만 PNG 인 움직이는 GIF 를 한 장면으로 만들지 않게).
   - 장 밖(머리말·스타일 글·쪽 레이아웃 등)에도 쓴 그림, 주소가 줄바꿈으로 나뉜 그림은 줄이지 않는다 — 장 안만 바꾸면 파일에
     옛 그림이 그대로 남거나, 주소의 앞부분만 바꾸게 된다. */

export const SHRINK_MAX = { w: 2560, h: 1440 };      // 넣을 때 줄이는 한도(장 1280×720 의 두 배)
const GAIN = 0.85;                                   // 이만큼 이하로 작아질 때만 바꾼다
const HEAVY = 1.5 * 1048576;                         // 넣을 때 크기는 맞아도 이보다 무거우면 같은 크기로 다시 담는다
export const RASTER = /^image\/(png|jpeg|webp|bmp)$/;
const DATA_RE = /data:image\/(png|jpeg|webp|bmp|gif|svg\+xml|avif)(?:;[\w.+-]{1,40}=[\w.+-]{1,80}){0,4};base64,[A-Za-z0-9+/=]+/g;

// data: 주소 → {type, bytes}
function decode(uri) {
  const m = /^data:([\w.+-]+\/[\w.+-]+)(?:;[^,;]*)*;base64,(.*)$/s.exec(uri);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase(), bytes };
}

export const byteSize = (uri) => {
  const i = uri.indexOf(',');
  const b64 = uri.slice(i + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
};

const blobToUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('그림을 읽지 못했습니다.'));
  r.readAsDataURL(blob);
});

const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, q));

// 바이트로 본 그림 꼴 — 붙은 이름(파일 종류·data: 주소의 type)과 다를 수 있다. 모르면 ''.
export function sniff(u) {
  const at = (i, s) => u.length >= i + s.length && Array.from(s).every((c, k) => u[i + k] === c.charCodeAt(0));
  if (u.length >= 4 && u[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (u.length >= 3 && u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, 'BM')) return 'image/bmp';
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'image/avif';
  return '';
}

// 움직이는 그림인가 — APNG(첫 IDAT 앞의 acTL)·움직이는 WebP(VP8X 의 애니메이션 표, ANIM·ANMF 덩이). type 은 sniff 로 본 꼴.
export function animated(bytes, type) {
  const u = bytes;
  const tag = (i) => String.fromCharCode(u[i], u[i + 1], u[i + 2], u[i + 3]);
  if (type === 'image/png') {
    for (let i = 8; i + 8 <= u.length;) {
      const len = u[i] * 16777216 + u[i + 1] * 65536 + u[i + 2] * 256 + u[i + 3];
      const t = tag(i + 4);
      if (t === 'acTL') return true;
      if (t === 'IDAT' || t === 'IEND') return false;
      i += 12 + len;
    }
    return false;
  }
  if (type === 'image/webp') {
    if (u.length < 21 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return false;
    if (tag(12) === 'VP8X' && (u[20] & 2)) return true;
    for (let i = 12; i + 8 <= u.length;) {
      const t = tag(i);
      if (t === 'ANIM' || t === 'ANMF') return true;
      const len = u[i + 4] + u[i + 5] * 256 + u[i + 6] * 65536 + u[i + 7] * 16777216;
      i += 8 + len + (len % 2);
    }
  }
  return false;
}

// 덱 안의 그림(data: 주소)의 꼴(바이트로 본 것, 모르면 붙은 이름)과 움직이는 그림인지 → {type, animated}
export function kindOf(uri) {
  try {
    const d = decode(uri);
    if (!d) return { type: '', animated: false };
    const type = sniff(d.bytes) || d.type;
    return { type, animated: animated(d.bytes, type) };
  } catch (e) {
    return { type: '', animated: false };
  }
}

// blob(그림) → 폭·높이를 (w, h) 로 줄인 캔버스. createImageBitmap 의 고품질 줄이기를 쓰고, 안 되면 그리기로.
async function scaled(blob, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    g.drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  } catch (e) {
    const bmp = await createImageBitmap(blob);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return c;
  }
}

// 줄인 크기 — (w, h) 를 (mw, mh) 안에 비율을 지켜(커지지는 않게)
export const within = (w, h, mw, mh) => {
  const s = Math.min(1, mw / w, mh / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
};

/* 그림(blob, 종류 type, 본래 크기 nat)을 (mw, mh) 안으로 줄여 다시 담는다 → {url, size, w, h}, 15% 넘게 작아지지 않으면 null.
   브라우저가 어느 꼴로도 담지 못하면 Error. from: 원래 바이트 수. */
async function recode(blob, type, nat, mw, mh, from) {
  const to = within(nat.w, nat.h, mw, mh);
  const canvas = await scaled(blob, to.w, to.h);
  const tries = type === 'image/png' || type === 'image/bmp' ? [['image/png'], ['image/webp', 0.92]]
    : type === 'image/jpeg' ? [['image/webp', 0.86], ['image/jpeg', 0.86]] : [['image/webp', 0.86]];
  let best = null;
  for (const [t, q] of tries) {
    const b = await toBlob(canvas, t, q);
    if (b && b.type === t && (!best || b.size < best.size)) best = b;
  }
  if (!best) throw new Error('이 브라우저는 그림을 그 꼴로 다시 담지 못합니다.');
  if (best.size > from * GAIN) return null;
  return { url: await blobToUrl(best), size: best.size, w: to.w, h: to.h };
}

// 넣을 때 줄여 볼 그림인가 — 장 크기의 두 배보다 크거나 1.5 MB 를 넘는 사진·그림(붙은 이름으로 — 꼴은 shrinkFile 이 바이트로 본다)
export const bigPicture = (file, nat) => RASTER.test(file.type) && !!nat
  && (nat.w > SHRINK_MAX.w || nat.h > SHRINK_MAX.h || file.size > HEAVY);

// 넣을 그림 파일 — 크면 SHRINK_MAX 안으로 줄인(무겁기만 하면 같은 크기로 다시 담은) data: 주소. 줄일 것이 없으면 null.
export async function shrinkFile(file, nat) {
  if (!bigPicture(file, nat)) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes) || file.type;
    if (!RASTER.test(type) || animated(bytes, type)) return null;
    return await recode(file, type, nat, SHRINK_MAX.w, SHRINK_MAX.h, file.size);
  } catch (e) {
    return null;
  }
}

// 덱 안의 그림 하나를 target(픽셀) 안으로 → {url, size, w, h}, 바꾸지 않으면 {why}: 'gain'(15% 넘게 작아지지 않음)·
// 'animated'(움직이는 그림)·'error'(브라우저가 다시 담지 못함)·'skip'(줄일 그림이 아님)
export async function shrinkData(uri, nat, target) {
  try {
    const d = decode(uri);
    const type = d ? sniff(d.bytes) || d.type : '';
    if (!d || !RASTER.test(type) || !nat || !target) return { why: 'skip' };
    if (animated(d.bytes, type)) return { why: 'animated' };
    const r = await recode(new Blob([d.bytes], { type }), type, nat, target.w, target.h, d.bytes.length);
    return r || { why: 'gain' };
  } catch (e) {
    return { why: 'error' };
  }
}

/* ---------- 덱 안의 그림 찾기 */

// 그림을 쓰는 속성 — SVG 의 <image>·<feImage> 는 href, 그 밖(<img>·<source>·<video>)은 src·srcset·poster. 둘 다 style 의 url(…).
const svgImage = (el) => el.localName === 'image' || el.localName === 'feImage';
const attrsOf = (el) => (svgImage(el) ? ['href', 'xlink:href', 'style'] : ['src', 'srcset', 'poster', 'style']);

// 요소가 그림을 쓰는 곳 → [{attr, uri, wrapped}] — wrapped: 주소가 줄바꿈(공백)으로 나뉘어 앞부분만 잡힌 것(브라우저는 공백을
// 빼고 읽어 그림이 보이지만, 잡힌 앞부분만으로는 다시 담지도 바꾸지도 못한다)
function usesOf(el) {
  const out = [];
  for (const a of attrsOf(el)) {
    const v = el.getAttribute(a);
    if (!v || !v.includes('data:image/')) continue;
    for (const m of v.matchAll(DATA_RE)) {
      const end = m.index + m[0].length;
      out.push({ attr: a, uri: m[0], wrapped: /^\s+[A-Za-z0-9+/]{8}/.test(v.slice(end, end + 24)) });
    }
  }
  return out;
}

// 보이는 상자 — 배치 크기와 화면의 크기(transform: scale 등이 들어간 것) 가운데 큰 쪽(작게 잡아 흐려지지 않게)
const boxOf = (el) => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(Math.max(el.offsetWidth || 0, r.width)), h: Math.round(Math.max(el.offsetHeight || 0, r.height)) };
};

/* 그 쓰임이 장에 보이는 상자(CSS px)와 맞춤 — fit: 'contain'(상자 안에 맞춤)·'cover'(채워 자름)·'fill'(늘임)·'fixed'(제 크기로
   보임 — 줄이면 보이는 크기가 바뀐다). <picture> 의 <source> 는 그 안의 <img> 가 보인다. */
function placeOf(el, attr, win) {
  if (attr === 'style') {
    const size = win.getComputedStyle(el).backgroundSize.trim();
    const fit = size === 'cover' ? 'cover' : size === 'contain' ? 'contain' : size === '100% 100%' ? 'fill' : 'fixed';
    return { box: boxOf(el), fit };
  }
  if (svgImage(el)) {
    // 폭·높이를 하나도 정하지 않은 <image> 는 그림의 픽셀 크기로 그려진다 — 줄이면 보이는 크기도 준다(계산된 스타일은 그린
    // 크기를 주므로 속성·style 로 본다. 하나만 정했으면 다른 쪽은 그림의 비율로 따라와 줄여도 그대로)
    const set = (k) => el.hasAttribute(k) || !!el.style[k];
    if (!set('width') && !set('height')) return { box: boxOf(el), fit: 'fixed' };
    const par = (el.getAttribute('preserveAspectRatio') || '').trim();
    return { box: boxOf(el), fit: /^none\b/.test(par) ? 'fill' : /\bslice\b/.test(par) ? 'cover' : 'contain' };
  }
  // srcset 의 그림은 픽셀 수를 적어 둔 너비(1600w)·배율(2x)로 크기를 셈한다 — 줄이면 보이는 크기가 바뀔 수 있다
  if (attr === 'srcset') return { box: boxOf(el), fit: 'fixed' };
  const shown = el.localName === 'source' ? (el.parentElement && el.parentElement.querySelector('img')) : el;
  if (!shown) return { box: { w: 0, h: 0 }, fit: 'fixed' };
  const of = win.getComputedStyle(shown).objectFit;
  const fit = of === 'cover' ? 'cover' : of === 'contain' || of === 'scale-down' ? 'contain' : of === 'none' ? 'fixed' : 'fill';
  return { box: boxOf(shown), fit };
}

/* 장들의 그림 → [{uri, type, bytes, uses: [{slide: 번호, el, attr, box, fit}], shown: {w, h}, wrapped, elsewhere}] — 큰 것부터.
   보이는 크기는 장마다 잠깐 보여 재고(model.show) 처음 장으로 돌아간다. 쪽 레이아웃의 자리 상자(설정에서 다시 그리는 것)는 보지
   않는다. elsewhere: 장 밖(머리말·스타일 글·쪽 레이아웃 등)에도 쓰인 그림 — 장 안만 바꾸면 옛 그림이 파일에 남는다. */
export function scan(model) {
  const byUri = new Map();
  const back = model.cur;
  model.slides.forEach((s, i) => {
    let shownSlide = false;
    for (const el of [s, ...s.querySelectorAll('*')]) {
      if (el.closest('[data-deck-layout]')) continue;
      const list = usesOf(el);
      if (!list.length) continue;
      if (!shownSlide) { model.show(i); shownSlide = true; }
      for (const { attr, uri, wrapped } of list) {
        let p = byUri.get(uri);
        if (!p) {
          const m = /^data:([\w.+-]+\/[\w.+-]+)/.exec(uri);
          p = { uri, type: m ? m[1] : '', bytes: byteSize(uri), uses: [], shown: { w: 0, h: 0 }, wrapped: false };
          byUri.set(uri, p);
        }
        if (wrapped) p.wrapped = true;
        const { box, fit } = placeOf(el, attr, model.win);
        p.uses.push({ slide: i, el, attr, box, fit });
        p.shown.w = Math.max(p.shown.w, box.w);
        p.shown.h = Math.max(p.shown.h, box.h);
      }
    }
  });
  model.show(back);
  // 문서 전체에서 같은 주소가 나온 수 — 장 안에서 센 쓰임보다 많으면 장 밖에도 있다
  const all = new Map();
  if (byUri.size) {
    for (const m of model.doc.documentElement.outerHTML.matchAll(DATA_RE)) all.set(m[0], (all.get(m[0]) || 0) + 1);
  }
  for (const p of byUri.values()) p.elsewhere = (all.get(p.uri) || 0) > p.uses.length;
  return [...byUri.values()].sort((a, b) => b.bytes - a.bytes);
}

/* 그림이 가져야 할 픽셀(p.nat 이 있어야) — 보이는 곳마다 상자의 두 배를 맞춤대로 채우는 배율 가운데 가장 큰 것. 제 크기로
   보이는 곳이 있거나 보이는 곳이 없으면 null(줄이지 않는다). */
export function targetOf(p) {
  if (!p.nat || !(p.nat.w > 0 && p.nat.h > 0)) return null;
  let s = 0;
  for (const u of p.uses) {
    if (u.fit === 'fixed') return null;           // 지금 숨은 곳이라도 — 보이게 되면 줄인 크기로 보인다
    if (!(u.box.w > 0 && u.box.h > 0)) continue;
    const sx = (u.box.w * 2) / p.nat.w;
    const sy = (u.box.h * 2) / p.nat.h;
    s = Math.max(s, u.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy));
  }
  if (!s) return null;
  const k = Math.min(1, s);
  const up = (v) => Math.ceil(v - 1e-6);              // 셈의 끝자리 오차로 한 픽셀 커지지 않게
  return { w: Math.min(p.nat.w, up(p.nat.w * k)), h: Math.min(p.nat.h, up(p.nat.h * k)) };
}

// 장 안에서 그림 주소 from 을 to 로 — 바꾼 곳 수
export function replaceData(model, from, to) {
  let n = 0;
  for (const s of model.slides) {
    for (const el of [s, ...s.querySelectorAll('*')]) {
      for (const a of attrsOf(el)) {
        const v = el.getAttribute(a);
        if (v && v.includes(from)) {
          el.setAttribute(a, v.split(from).join(to));
          n += 1;
        }
      }
    }
  }
  return n;
}

export const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
