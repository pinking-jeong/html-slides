/* PPTX 받기 — 지금 편집한 덱을 PowerPoint 파일로. 덱 화면(스크립트 없는 iframe)에 그려진 대로 장마다 재어서
   - 글은 고칠 수 있는 글상자로(글자 서식·문단·글머리표·줄 간격·링크), 표는 표로(합친 칸·칸 색·테두리),
   - 그림은 그림으로(PNG·JPEG·GIF 는 원본 그대로), 도표(SVG)·그라데이션 배경은 화면의 두 배 해상도 그림으로,
   - 배경색·테두리·둥근 모서리는 도형으로, 발표자 노트는 노트로 옮긴다. 돌리거나 뒤집은 것(배치 ▾ 의 회전·대칭 — CSS rotate·
     scale 속성, transform)은 PowerPoint 의 회전·대칭으로, 도형 넣기의 선·화살표는 선 도형으로(pptxshape.js).
   덱 스크립트가 그리는 것(canvas·동영상·iframe)은 옮기지 못하고(동영상은 표지 그림만), 그림자·여러 겹 배경 같은 CSS 효과는
   단순하게 옮긴다 — 다 끝나면 무엇을 그림으로 바꿨거나 옮기지 못했는지와 쓴 글꼴을 알린다.
   만드는 도구: vendor/pptxgenjs(4.0.1, MIT, JSZip 포함) — 처음 누를 때만 불러온다. pptxgenjs 4.0.1 은 한 문단의 글 조각마다
   a:pPr 를 써서 PowerPoint 스키마에 어긋나므로, 만든 뒤 문단마다 맨 앞의 것 하나만 남긴다(tidy). */

import { textHosts } from './canvas.js';
import { A } from './deck.js';
import { isLine, layoutSize, lineShape, pose } from './pptxshape.js';

const LIB = new URL('../../vendor/pptxgenjs/pptxgen.bundle.js', import.meta.url).href;
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SVGNS = 'http://www.w3.org/2000/svg';
const DPI = 96;                  // CSS 1in = 96px
const PT = 0.75;                 // CSS 1px = 0.75pt
const SCALE = 2;                 // 그림으로 옮기는 도표·배경의 해상도(화면의 몇 배)
const MAX_PX = 4096;             // 그림 한 장의 긴 변 상한
const SKIP = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta', 'title', 'base', 'head']);
const MEDIA = new Set(['canvas', 'video', 'audio', 'iframe', 'object', 'embed']);
const EMBED = new Set(['img', 'svg', 'table', 'picture', ...MEDIA]);   // 글상자 안에 있어도 따로 옮기는 것
const BLOCK = new Set(['block', 'list-item', 'flex', 'grid', 'table', 'table-row', 'table-cell', 'table-caption',
  'flow-root', 'table-row-group', 'table-header-group', 'table-footer-group']);
const ALIGN = { left: 'left', start: 'left', right: 'right', end: 'right', center: 'center', justify: 'justify',
  '-webkit-center': 'center', '-webkit-left': 'left', '-webkit-right': 'right' };
const VALIGN = { middle: 'middle', bottom: 'bottom', 'text-bottom': 'bottom' };
const DASH = { dotted: 'sysDot', dashed: 'dash' };
const NUMBER = { decimal: 'arabicPeriod', 'decimal-leading-zero': 'arabicPeriod', 'lower-alpha': 'alphaLcPeriod',
  'lower-latin': 'alphaLcPeriod', 'upper-alpha': 'alphaUcPeriod', 'upper-latin': 'alphaUcPeriod',
  'lower-roman': 'romanLcPeriod', 'upper-roman': 'romanUcPeriod' };
const MARKS = { disc: '2022', circle: '25E6', square: '25AA' };
const PLAIN = '200B';            // 글머리표 없는 문단의 왼쪽 여백을 실어 보내는 보이지 않는 표시 — tidy 가 buNone 으로 바꾼다
const NBSP = String.fromCharCode(0xA0);
const NBHY = String.fromCharCode(0x2011);                            // 꺾이지 않는 붙임표
// 글자꼴로 그릴 것(그림 글자가 아니라) — ▶·◀ 에 글자꼴 선택자(FE0E)를 붙이고(LibreOffice), 따로 떼어 기호 글꼴로 적는다
// (PowerPoint 는 선택자를 보지 않고, 덱의 웹 글꼴을 깔지 않은 PC 에서는 그림 글자 글꼴로 테두리 친 재생 단추를 그린다)
const VS15 = String.fromCharCode(0xFE0E);
const EMOJI_LIKE = new RegExp(`([${String.fromCharCode(0x25B6, 0x25C0)}])(?![${String.fromCharCode(0xFE0E, 0xFE0F)}])`, 'g');
const glyphs = (s) => s.replace(EMOJI_LIKE, `$1${VS15}`);
const SYMBOL_FACE = 'Segoe UI Symbol';
const SYMBOL_SPLIT = new RegExp(`([${String.fromCharCode(0x25B6, 0x25C0)}]${VS15}?)`);
// 글꼴 목록의 일반 이름 → PowerPoint 에서 쓸 글꼴(한국어 덱 기준)
const GENERIC = { 'sans-serif': 'Malgun Gothic', 'system-ui': 'Malgun Gothic', 'ui-sans-serif': 'Malgun Gothic',
  serif: 'Batang', 'ui-serif': 'Batang', monospace: 'Consolas', 'ui-monospace': 'Consolas', cursive: 'Malgun Gothic',
  fantasy: 'Malgun Gothic', math: 'Cambria Math', emoji: 'Segoe UI Emoji' };
// SVG 를 따로 떼어 그릴 때 덱 CSS 대신 적어 넣는 계산된 속성
const SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'color', 'font-family',
  'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift',
  'letter-spacing', 'word-spacing', 'text-decoration', 'visibility', 'display', 'stop-color', 'stop-opacity',
  'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'mask', 'filter', 'paint-order', 'vector-effect',
  'shape-rendering', 'mix-blend-mode', 'transform', 'transform-origin', 'transform-box', 'white-space'];
const ROOT_SKIP = new Set(['opacity', 'transform', 'transform-origin', 'display', 'visibility']);

const px = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(v * 100) / 100;
const inch = (v) => Math.round((v / DPI) * 10000) / 10000;
const transp = (a) => Math.max(0, Math.min(100, Math.round((1 - a) * 100)));
const hex4 = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');
// XML 에 쓸 수 없는 글자 — 제어 문자(탭·줄바꿈 말고)·U+FFFE·U+FFFF 와 짝 없는 써로게이트. 덱 글·노트에 들어 있으면 만든
// 파일이 올바른 XML 이 아니어서 PowerPoint 가 '복구'하며 글을 버리므로, 다 만든 XML 에서 지운다(clean).
const span = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const XML_BAD = new RegExp(`[${span(0, 8)}${span(0xB, 0xC)}${span(0xE, 0x1F)}${span(0xFFFE, 0xFFFF)}]`, 'g');
const HIGH = span(0xD800, 0xDBFF);
const LOW = span(0xDC00, 0xDFFF);
const LONE = new RegExp(`[${HIGH}](?![${LOW}])|(?<![${HIGH}])[${LOW}]`, 'g');
export const clean = (xml) => xml.replace(XML_BAD, '').replace(LONE, String.fromCharCode(0xFFFD));

/* ---------- 도구 불러오기 */

let lib = null;

// pptxgenjs(그 안의 JSZip 과 함께) — 처음 부를 때만 <script> 로 불러온다(편집기의 CSP: 같은 출처 스크립트만)
export function loadLib() {
  if (window.PptxGenJS && window.JSZip) return Promise.resolve(window.PptxGenJS);
  if (!lib) {
    lib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => (window.PptxGenJS && window.JSZip ? resolve(window.PptxGenJS)
        : reject(new Error('PPTX 도구를 불러오지 못했습니다.')));
      s.onerror = () => reject(new Error('PPTX 도구(vendor/pptxgenjs)를 불러오지 못했습니다.'));
      document.head.append(s);
    }).catch((e) => {
      lib = null;
      throw e;
    });
  }
  return lib;
}

/* ---------- 색·글꼴 */

let probe = null;

// 계산된 색 → {hex: 'RRGGBB', a}, 투명하면 null. rgb()·rgba() 가 아닌 꼴(oklch 등)은 캔버스에 칠해 읽는다.
export function rgba(css) {
  const s = String(css || '').trim();
  if (!s || s === 'transparent' || s === 'none' || s === 'currentcolor') return null;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  let r;
  let g;
  let b;
  let a;
  if (m) {
    [r, g, b] = [m[1], m[2], m[3]].map(Number);
    a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  } else {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = 'rgba(0, 0, 0, 0)';
    probe.fillStyle = s;
    probe.fillRect(0, 0, 1, 1);
    [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    a /= 255;
  }
  if (!(a > 0.004)) return null;
  const h2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return { hex: `${h2(r)}${h2(g)}${h2(b)}`.toUpperCase(), a: Math.min(1, a) };
}

// CSS 글꼴 목록의 첫 글꼴(일반 이름은 PowerPoint 글꼴로). pptxgenjs 는 글꼴 이름을 XML 속성에 그대로 쓰므로 &<>" 는 뺀다.
export function face(list) {
  for (const raw of String(list || '').split(',')) {
    const f = raw.trim().replace(/^['"]|['"]$/g, '').replace(/[&<>"]/g, '').trim();
    if (!f || f.startsWith('-apple-') || f === 'BlinkMacSystemFont') continue;
    return GENERIC[f.toLowerCase()] || f;
  }
  return GENERIC['sans-serif'];
}

/* ---------- 만든 파일 다듬기 */

// 문단(a:p)마다 맨 앞의 a:pPr 하나만 남기고(pptxgenjs 4.0.1 은 글 조각마다 쓴다), 한국어 글꼴에 붙는 중국어 문자 집합
// 표시(charset -122·-120)를 떼고, 선 없음(line none)이 빈 a:ln 으로 남은 것을 noFill 로 적는다. 이어지는 번호 항목의
// 시작 번호(startAt="0")를 지우고(그래야 1. 2. 3. 으로 이어 센다), 보이지 않는 글머리표(PLAIN)는 여백만 남긴 buNone 으로,
// 글과 색이 다른 글머리표에는 그 색(buClr)을.
export function tidy(xml) {
  return xml
    .replace(/<a:p>([\s\S]*?)<\/a:p>/g, (m, body) => {
      let first = true;
      let out = body.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pp, off) => {
        const keep = first && off === 0;
        first = false;
        return keep ? pp : '';
      });
      // 글머리표 색 — pptxgenjs 는 쓰지 않아 문단 첫 글 조각의 언어 꼬리(-x-buRRGGBB)에 실어 보냈다
      const bu = /-x-bu([0-9A-F]{6})"/.exec(out);
      if (bu) {
        out = out.replace(/-x-bu[0-9A-F]{6}"/g, '"')
          .replace(/<a:(buSzPct|buFont|buChar|buAutoNum)\b/, `<a:buClr><a:srgbClr val="${bu[1]}"/></a:buClr><a:$1`);
      }
      return `<a:p>${out}</a:p>`;
    })
    .replace(/ startAt="0"/g, '')
    .replace(new RegExp(`<a:pPr\\b([^>]*)>((?:(?!</a:pPr>)[\\s\\S])*?)<a:buSzPct val="100000"/><a:buChar char="&#x${PLAIN};"/>`, 'g'),
      (m, attrs, mid) => `<a:pPr${attrs.replace(/ indent="-?\d+"/, ' indent="0"')}>${mid}<a:buNone/>`)
    .replace(/ pitchFamily="34" charset="-12[02]"/g, '')
    .replace(/<a:ln><\/a:ln>/g, '<a:ln><a:noFill/></a:ln>');
}

/* ---------- 내보내기 */

/* 덱 → {blob, report}. 장마다 model.show 로 띄워 재므로, 다 끝나면(그만둬도) 처음 보던 장으로 돌린다 — 화면은 부른 쪽이
   다시 그린다. onSlide(i, n): 진행(i === n 이면 파일로 묶는 중), cancelled(): 참이면 도구를 불러오는 중이든 장을 옮기거나
   묶는 중이든 거기서 멈추고 null. */
export async function exportPptx({ model, title, onSlide, cancelled }) {
  const stop = () => !!(cancelled && cancelled());
  const PptxGenJS = await untilStopped(loadLib(), stop);
  if (!PptxGenJS) return null;
  const x = new Exporter(model, PptxGenJS, title);
  const keep = model.cur;
  const n = model.slides.length;
  try {
    for (let i = 0; i < n; i += 1) {
      if (stop()) return null;
      if (onSlide) onSlide(i, n);
      await x.slide(i);
    }
  } finally {
    model.show(keep);
  }
  if (stop()) return null;
  if (onSlide) onSlide(n, n);
  const blob = await x.finish(stop);
  return blob ? { blob, report: x.report() } : null;
}

// p 를 기다리되 그만두면 바로 null — 느린 망에서 도구를 불러오는 동안에도 그만두기를 받는다(불러오기는 뒤에서 마저 한다)
function untilStopped(p, stop) {
  let t = 0;
  const halt = new Promise((resolve) => {
    t = setInterval(() => { if (stop()) resolve(null); }, 100);
  });
  return Promise.race([p, halt]).finally(() => clearInterval(t));
}

// 그리기 한 번 — 숨긴 탭에서는 그리지 않아 requestAnimationFrame 이 멈추므로, 받는 동안 다른 탭으로 가도 잠깐 뒤 넘어간다
function frame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 200);
  });
}

class Exporter {
  constructor(model, PptxGenJS, title) {
    this.model = model;
    this.win = model.win;
    this.doc = model.doc;
    const { w, h } = model.size;
    this.size = { w, h };
    this.pptx = new PptxGenJS();
    this.pptx.defineLayout({ name: 'DECK', width: w / DPI, height: h / DPI });
    this.pptx.layout = 'DECK';
    this.pptx.title = String(title || '');
    this.pptx.author = '';
    this.pptx.company = '';
    this.pptx.subject = '';
    // 언어 — pptxgenjs 가 XML 속성에 그대로 쓰므로 언어 표시 꼴(en·en-US 등)만 받는다
    const lang = String(this.doc.documentElement.getAttribute('lang') || 'ko').trim();
    this.lang = /^ko\b/i.test(lang) || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang) ? 'ko-KR' : lang;
    this.fonts = new Map();          // 쓴 글꼴 → 글 조각 수
    // 웹 글꼴(@font-face 로 불러 쓰는 글꼴) — 그 글꼴을 깔지 않은 PC 의 PowerPoint 는 다른 글꼴로 그린다
    this.web = new Set([...(this.doc.fonts || [])].map((f) => String(f.family).replace(/^['"]|['"]$/g, '').toLowerCase()));
    this.count = { slides: 0, text: 0, table: 0, img: 0, svg: 0, paint: 0, poster: 0, lost: 0, media: 0, shrunk: 0 };
    this.pen = null;                 // 글 폭을 재는 캔버스(대신 쓸 글꼴로 넓어지는 폭)
    this.cache = new Map();          // 그림 주소 → 데이터
    this.painted = new Map();        // 배경(계산된 CSS·크기) → 그린 그림의 데이터(못 그렸으면 null)
    this.k = 1;
    this.ox = 0;
    this.oy = 0;
    this.s = null;
    this.stage = null;               // 지금 옮기는 장 — 돌림·뒤집음은 그 안의 것만 모은다(pose)
    this.hosts = new Set();
    this.inCell = false;
    this.cellScale = 1;              // 표 칸 글자의 배율 — 열 폭을 나눠도 모자란 표는 1 보다 작다
  }

  async slide(i) {
    const el = this.model.show(i);
    await this.settle(el);
    const r = el.getBoundingClientRect();
    this.k = r.width > 1 ? this.size.w / r.width : 1;
    this.ox = r.left;
    this.oy = r.top;
    this.stage = el;
    this.s = this.pptx.addSlide();
    this.hosts = new Set(textHosts(el, this.model.family));
    await this.background(el);
    await this.pseudo(el, '::before', 1);
    await this.children(el, 1);
    await this.pseudo(el, '::after', 1);
    const notes = notesText(this.model, el);
    if (notes) this.s.addNotes(notes);
    this.count.slides += 1;
  }

  // 띄운 장의 글꼴이 다 올 때까지 — 웹 글꼴은 그 장에 쓰인 글자 묶음만 그때 불러오므로, 먼저 배치를 시켜 불러오게 하고
  // 기다린다(오래 걸리면 4초까지만). 장을 띄우면 덱의 등장 애니메이션·전환이 처음부터 다시 돌므로(투명하거나 밀려난 채 재지
  // 않게) 끝난 모습으로 보낸다. 그다음 그리기 한 번을 더 기다려 잰다.
  async settle(el) {
    el.getBoundingClientRect();
    this.still();
    const fonts = this.doc.fonts;
    if (fonts && fonts.status === 'loading') {
      await Promise.race([fonts.ready.catch(() => {}), new Promise((r) => { setTimeout(r, 4000); })]);
      this.still();
    }
    await frame();
  }

  // 덱의 애니메이션·전환을 끝난 모습으로 — 끝없이 도는 것(finish 가 못 함)은 그 자리에 멈춘다
  still() {
    const all = typeof this.doc.getAnimations === 'function' ? this.doc.getAnimations() : [];
    for (const a of all) {
      try {
        a.finish();
      } catch (e) {
        a.pause();
      }
    }
  }

  // 만든 파일을 다듬는다 — XML 에 쓸 수 없는 글자를 지우고(clean), 장·노트 XML 을 다듬고(tidy), 같은 그림(장마다 되풀이한
  // 배경 등 — pptxgenjs 는 장마다 따로 담는다)은 한 파일로 합친다. 그만두면(stop) null.
  async finish(stop) {
    const buf = await this.pptx.write({ outputType: 'arraybuffer', compression: false });
    if (stop()) return null;
    const zip = await window.JSZip.loadAsync(buf);
    const same = await sameMedia(zip);
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir || !/\.(xml|rels)$/.test(name)) continue;
      let xml = clean(await zip.file(name).async('string'));
      if (same.size && name.endsWith('.rels')) {
        xml = xml.replace(/Target="\.\.\/media\/([^"/]+)"/g, (m, f) => (same.has(f) ? `Target="../media/${same.get(f)}"` : m));
      }
      if (/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name)) xml = tidy(xml);
      zip.file(name, xml);
      if (stop()) return null;
    }
    for (const f of same.keys()) zip.remove(`ppt/media/${f}`);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: MIME });
    return stop() ? null : blob;
  }

  report() {
    const fonts = [...this.fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
    return { ...this.count, fonts, web: fonts.filter((f) => this.web.has(f.toLowerCase())) };
  }

  /* ---------- 자리 */

  // 요소의 자리(장 안, CSS px) {x, y, w, h, rot, flipH, flipV} — 돌리거나 뒤집은 요소(자기나 조상의 transform 과 CSS rotate·
  // scale 속성 — 돌린 상자 안의 글 칸도 함께 돈다)는 돌리기 전 크기와 가운데로. 크기가 없거나 장 밖이면 null.
  geom(e, cs, rect) {
    const r = rect || e.getBoundingClientRect();
    if (!(r.width > 0.5 && r.height > 0.5)) return null;
    let w = r.width;
    let h = r.height;
    let rot = 0;
    let flipH = false;
    let flipV = false;
    const p = rect ? null : pose(e, this.stage, this.win);
    const size = p && (p.rot || p.flipH || p.flipV) ? layoutSize(e, cs || this.win.getComputedStyle(e)) : null;
    if (size) {
      ({ rot, flipH, flipV } = p);
      w = size.w * p.sx;
      h = size.h * p.sy;
    }
    const cx = (r.left + r.width / 2 - this.ox) * this.k;
    const cy = (r.top + r.height / 2 - this.oy) * this.k;
    w *= this.k;
    h *= this.k;
    const g = { x: cx - w / 2, y: cy - h / 2, w, h, rot, flipH, flipV };
    if (g.x >= this.size.w || g.y >= this.size.h || g.x + g.w <= 0 || g.y + g.h <= 0) return null;
    return g;
  }

  // pptxgenjs 의 자리 옵션(인치)
  at(g) {
    const o = { x: inch(g.x), y: inch(g.y), w: inch(g.w), h: inch(g.h) };
    if (g.rot) o.rotate = Math.round(((g.rot % 360) + 360) % 360);
    if (g.flipH) o.flipH = true;
    if (g.flipV) o.flipV = true;
    return o;
  }

  /* ---------- 걷기 */

  // 형제는 z-index 순서로(같으면 문서 순서)
  ordered(el) {
    const kids = [...el.children].map((c, n) => {
      const cs = this.win.getComputedStyle(c);
      const z = cs.position === 'static' ? 0 : parseInt(cs.zIndex, 10);
      return { c, n, z: Number.isFinite(z) ? z : 0 };
    });
    kids.sort((a, b) => a.z - b.z || a.n - b.n);
    return kids.map((x) => x.c);
  }

  async children(el, op) {
    for (const c of this.ordered(el)) await this.visit(c, op);
  }

  async visit(e, op) {
    const tag = e.localName;
    if (SKIP.has(tag) || e.hasAttribute(A.ui) || e.hasAttribute(A.chrome)) return;
    const cs = this.win.getComputedStyle(e);
    if (cs.display === 'none') return;
    const o = op * (cs.opacity === '' ? 1 : px(cs.opacity));
    if (o < 0.01) return;
    const shown = cs.visibility === 'visible';
    const g = this.geom(e, cs);
    if (tag === 'svg') {
      if (shown && g) await this.svg(e, g, o);
      return;
    }
    if (tag === 'img') {
      if (shown && g) await this.img(e, cs, g, o);
      return;
    }
    if (MEDIA.has(tag)) {
      if (shown && g) await this.media(e, g, o);
      return;
    }
    if (shown && g) await this.box(e, cs, g, o);
    await this.pseudo(e, '::before', o);
    if (tag === 'table') {
      if (shown && g) await this.table(e, g, o);
    } else if (this.hosts.has(e) || directText(e)) await this.text(e, cs, g, o);
    else await this.children(e, o);
    await this.pseudo(e, '::after', o);
  }

  // 나란히 놓인 칸의 하나(text 가 나눈 것) — 제 자리의 글상자로
  async item(e, op) {
    const tag = e.localName;
    if (SKIP.has(tag) || e.hasAttribute(A.ui) || e.hasAttribute(A.chrome)) return;
    if (EMBED.has(tag)) {
      await this.visit(e, op);
      return;
    }
    const cs = this.win.getComputedStyle(e);
    if (cs.display === 'none') return;
    const o = op * (cs.opacity === '' ? 1 : px(cs.opacity));
    if (o < 0.01) return;
    const g = this.geom(e, cs);
    if (cs.visibility === 'visible' && g) await this.box(e, cs, g, o);
    await this.pseudo(e, '::before', o);
    await this.text(e, cs, g, o);
    await this.pseudo(e, '::after', o);
  }

  /* ---------- 꾸밈 상자(::before·::after) */

  // 글 없는 꾸밈(띠·점·꺾쇠 등) — 덱을 건드리지 않고 계산된 값으로 자리를 셈해 도형으로. 절대 자리의 것과, flex 줄의 맨 앞·끝
  // 칸으로 흐르는 것(이웃 칸의 자리에서 거꾸로 셈)만. 돌린 것 가운데 변 일부에만 테두리가 있는 것(꺾쇠)이나 배경 그림이 있는
  // 것은 그린 그림으로 돌려 놓는다. 글이 든 꾸밈(글머리표 등)은 글 쪽이 맡는다.
  async pseudo(e, which, op) {
    const cs = this.win.getComputedStyle(e, which);
    const content = cs.content;
    if (!content || content === 'none' || content === 'normal' || cs.display === 'none' || cs.visibility !== 'visible') return;
    const bg = rgba(cs.backgroundColor);
    const image = cs.backgroundImage && cs.backgroundImage !== 'none';
    if (!bg && !image && !hasBorder(cs)) return;
    const o = op * (cs.opacity === '' ? 1 : px(cs.opacity));
    if (o < 0.01) return;
    const bb = cs.boxSizing === 'border-box';
    const bw = px(cs.width) + (bb ? 0 : px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth));
    const bh = px(cs.height) + (bb ? 0 : px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth));
    if (!(bw > 0.5 && bh > 0.5)) return;
    const at = cs.position === 'absolute' || cs.position === 'fixed' ? this.placed(e, cs, bw, bh) : this.flowed(e, cs, which, bw, bh);
    if (!at) return;
    // 변형 — 기준점(transform-origin)을 두고 옮기고 돌리고 늘인 뒤의 가운데와 크기
    let { left, top } = at;
    let w = bw;
    let h = bh;
    let rot = 0;
    if (cs.transform && cs.transform !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(cs.transform);
        const [tx, ty] = String(cs.transformOrigin).split(' ').map(px);
        const cx = left + tx + m.a * (bw / 2 - tx) + m.c * (bh / 2 - ty) + m.e;
        const cy = top + ty + m.b * (bw / 2 - tx) + m.d * (bh / 2 - ty) + m.f;
        w = bw * Math.hypot(m.a, m.b);
        h = bh * Math.hypot(m.c, m.d);
        rot = (Math.atan2(m.b, m.a) * 180) / Math.PI;
        left = cx - w / 2;
        top = cy - h / 2;
      } catch (x) { /* 읽지 못한 변형은 둔다 */ }
    }
    const k = this.k;
    const g = { x: (left - this.ox) * k, y: (top - this.oy) * k, w: w * k, h: h * k, rot: Math.abs(rot) > 0.5 ? rot : 0 };
    if (!(g.w > 0.5 && g.h > 0.5) || g.x >= this.size.w || g.y >= this.size.h || g.x + g.w <= 0 || g.y + g.h <= 0) return;
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((s) => {
      const st = cs[`border${s}Style`];
      return st !== 'none' && st !== 'hidden' && px(cs[`border${s}Width`]) > 0.2;
    });
    if (g.rot && (image || (sides.length && sides.length < 4))) {
      const W = g.w * SCALE;
      const H = g.h * SCALE;
      const data = await raster(boxSvg(cs, bw, bh, W, H), W, H);
      if (data) {
        this.s.addImage({ data, ...this.at(g), transparency: o < 0.99 ? transp(o) : undefined });
        this.count.paint += 1;
      }
      return;
    }
    await this.box(e, cs, g, o);
  }

  // 절대 자리 꾸밈의 왼쪽 위(화면 px) — 담는 상자는 자리를 가진 가장 가까운 조상(자기 포함)의 안쪽 여백 상자, fixed 는 장
  placed(e, cs, bw, bh) {
    let cb = e;
    if (cs.position === 'absolute') {
      while (cb && cb.nodeType === 1 && this.win.getComputedStyle(cb).position === 'static') cb = cb.parentElement;
    } else cb = null;
    let left0 = this.ox;
    let top0 = this.oy;
    let cw = this.size.w / this.k;
    let ch = this.size.h / this.k;
    if (cb && cb.nodeType === 1) {
      const r = cb.getBoundingClientRect();
      const ccs = this.win.getComputedStyle(cb);
      left0 = r.left + px(ccs.borderLeftWidth);
      top0 = r.top + px(ccs.borderTopWidth);
      cw = cb.clientWidth;
      ch = cb.clientHeight;
    }
    const left = cs.left !== 'auto' ? left0 + px(cs.left) + px(cs.marginLeft)
      : cs.right !== 'auto' ? left0 + cw - px(cs.right) - px(cs.marginRight) - bw : null;
    const top = cs.top !== 'auto' ? top0 + px(cs.top) + px(cs.marginTop)
      : cs.bottom !== 'auto' ? top0 + ch - px(cs.bottom) - px(cs.marginBottom) - bh : null;
    return left === null || top === null ? null : { left, top };
  }

  // flex 줄(가로)의 맨 앞(::before)·맨 끝(::after) 칸으로 흐르는 꾸밈의 왼쪽 위 — 이웃 칸(글 조각이면 그 글)의 자리와
  // 사이(gap·바깥 여백)에서 거꾸로 셈하고, 세로는 align-self·align-items 대로. 그 밖의 흐름은 null(옮기지 않는다).
  flowed(e, cs, which, bw, bh) {
    const win = this.win;
    const pcs = win.getComputedStyle(e);
    if (!/flex/.test(pcs.display) || /column|reverse/.test(pcs.flexDirection)) return null;
    const nodes = [...e.childNodes].filter((n) => (n.nodeType === 3 ? /\S/.test(n.data)
      : n.nodeType === 1 && win.getComputedStyle(n).display !== 'none' && !/absolute|fixed/.test(win.getComputedStyle(n).position)));
    const n = which === '::before' ? nodes[0] : nodes[nodes.length - 1];
    const gap = px(pcs.columnGap);
    let left;
    if (!n) {
      const r = e.getBoundingClientRect();
      left = r.left + px(pcs.borderLeftWidth) + px(pcs.paddingLeft) + px(cs.marginLeft);
    } else {
      let nr;
      let nm = 0;
      if (n.nodeType === 1) {
        nr = n.getBoundingClientRect();
        nm = px(win.getComputedStyle(n)[which === '::before' ? 'marginLeft' : 'marginRight']);
      } else {
        const rg = this.doc.createRange();
        rg.selectNodeContents(n);
        nr = rg.getBoundingClientRect();
      }
      left = which === '::before' ? nr.left - nm - gap - px(cs.marginRight) - bw : nr.right + nm + gap + px(cs.marginLeft);
    }
    const r = e.getBoundingClientRect();
    const top0 = r.top + px(pcs.borderTopWidth) + px(pcs.paddingTop);
    const inner = e.clientHeight - px(pcs.paddingTop) - px(pcs.paddingBottom);
    const al = cs.alignSelf && cs.alignSelf !== 'auto' && cs.alignSelf !== 'normal' ? cs.alignSelf : pcs.alignItems;
    const top = /center/.test(al) ? top0 + (inner - bh + px(cs.marginTop) - px(cs.marginBottom)) / 2
      : /end/.test(al) ? top0 + inner - bh - px(cs.marginBottom) : top0 + px(cs.marginTop);
    return { left, top };
  }

  /* ---------- 상자: 배경·테두리 */

  // 배경색 → 도형, 배경 그림·그라데이션 → 그림, 테두리 → 선(네 변이 같으면) 또는 변마다 가는 도형
  async box(e, cs, g, o, rect = null) {
    const bg = rgba(cs.backgroundColor);
    const image = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : '';
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => {
      const style = cs[`border${s}Style`];
      const c = rgba(cs[`border${s}Color`]);
      const w = style === 'none' || style === 'hidden' || !c ? 0 : px(cs[`border${s}Width`]) * this.k;
      return { w, c, style };
    });
    const lined = sides.filter((s) => s.w > 0.2);
    if (!bg && !image && !lined.length) return;
    const shape = this.shapeOf(cs, g, rect);
    if (bg) {
      this.s.addShape(shape.name, {
        ...this.at(g), rectRadius: shape.r,
        fill: { color: bg.hex, transparency: transp(bg.a * o) }, line: { type: 'none' },
      });
    }
    if (image) await this.paint(e, cs, g, o);
    const same = lined.length === 4 && lined.every((s) => s.w === lined[0].w && s.c.hex === lined[0].c.hex
      && s.style === lined[0].style);
    if (same) {
      const s0 = lined[0];
      const inset = { ...g, x: g.x + s0.w / 2, y: g.y + s0.w / 2, w: Math.max(0.5, g.w - s0.w), h: Math.max(0.5, g.h - s0.w) };
      this.s.addShape(shape.name, {
        ...this.at(inset), rectRadius: shape.r,
        line: { color: s0.c.hex, width: r2(s0.w * PT), dashType: DASH[s0.style] || 'solid', transparency: transp(s0.c.a * o) },
      });
      return;
    }
    // 변마다 — 돌린 상자는 돌리기 전 자리로 그리고 같이 돌리지는 않는다(드묾)
    const [t, r, b, l] = sides;
    const bars = [];
    if (t.w > 0.2) bars.push([t, { x: g.x, y: g.y, w: g.w, h: t.w }]);
    if (b.w > 0.2) bars.push([b, { x: g.x, y: g.y + g.h - b.w, w: g.w, h: b.w }]);
    if (l.w > 0.2) bars.push([l, { x: g.x, y: g.y, w: l.w, h: g.h }]);
    if (r.w > 0.2) bars.push([r, { x: g.x + g.w - r.w, y: g.y, w: r.w, h: g.h }]);
    for (const [side, at] of bars) {
      this.s.addShape('rect', {
        ...this.at({ ...at, rot: 0 }), fill: { color: side.c.hex, transparency: transp(side.c.a * o) }, line: { type: 'none' },
      });
    }
  }

  // 모서리 반지름 → 도형 이름과 rectRadius(인치)
  shapeOf(cs, g, rect) {
    const radius = (v) => {
      const first = String(v || '0').split(' ')[0];
      return first.endsWith('%') ? (px(first) / 100) * Math.min(g.w, g.h) : px(first) * this.k;
    };
    const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((c) => cs[`border${c}Radius`]);
    const r = Math.max(...corners.map(radius));
    if (rect || r < 0.5) return { name: 'rect', r: undefined };
    const half = Math.min(g.w, g.h) / 2;
    // 네 모서리가 모두 50% 이상이면 타원 — CSS 의 % 반지름은 가로·세로를 따로 재어 긴 상자도 타원이다(도형 넣기의 타원)
    const oval = corners.every((v) => String(v || '').split(' ').every((x) => x.endsWith('%') && px(x) >= 50));
    if (oval || (r >= half - 0.5 && Math.abs(g.w - g.h) <= 1)) return { name: 'ellipse', r: undefined };
    return { name: 'roundRect', r: inch(Math.min(r, half)) };
  }

  // 배경 그림(그라데이션·url()) — 상자 크기 그대로 화면처럼 그려(SVG foreignObject) 그림으로. 못 그리면 첫 색만.
  async paint(e, cs, g, o) {
    const w = g.w / this.k;
    const h = g.h / this.k;
    const props = ['background-image', 'background-size', 'background-position', 'background-repeat', 'background-origin',
      'background-clip', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius',
      'border-bottom-left-radius'];
    let css = props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    const W = Math.max(1, Math.round(w * this.k * SCALE));
    const H = Math.max(1, Math.round(h * this.k * SCALE));
    // 같은 크기의 같은 배경(장마다 되풀이한 그라데이션·배경 그림)은 한 번만 그린다 — 받은 파일에서도 한 그림이 된다(finish)
    const key = `${css}|${w}x${h}|${W}x${H}`;
    let data = this.painted.get(key);
    if (data === undefined) {
      // url() 그림은 따로 그린 그림에서 불러오지 못하므로 data: 로 바꿔 넣는다
      const urls = [...cs.backgroundImage.matchAll(/url\(\s*"?([^")]+)"?\s*\)/g)].map((m) => m[1]);
      for (const u of urls) {
        const d = await this.fetchData(u);
        if (d) css = css.split(u).join(`data:${d}`);
      }
      const div = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;${escAttr(css)}"></div>`;
      const svg = `<svg xmlns="${SVGNS}" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">`
        + `<foreignObject x="0" y="0" width="${w}" height="${h}">${div}</foreignObject></svg>`;
      data = await raster(svg, W, H);
      this.painted.set(key, data);
    }
    if (data) {
      this.s.addImage({ data, ...this.at(g), transparency: o < 0.99 ? transp(o) : undefined });
      this.count.paint += 1;
      return;
    }
    const first = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(cs.backgroundImage);
    const c = first ? rgba(first[1].startsWith('#') ? hexCss(first[1]) : first[1]) : null;
    if (c) {
      this.s.addShape('rect', { ...this.at(g), fill: { color: c.hex, transparency: transp(c.a * o) }, line: { type: 'none' } });
    } else this.count.lost += 1;
  }

  /* ---------- 장 배경 */

  async background(el) {
    let bg = null;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      bg = rgba(this.win.getComputedStyle(e).backgroundColor);
      if (bg) break;
    }
    this.s.background = { color: bg ? bg.hex : 'FFFFFF' };
    const cs = this.win.getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      await this.paint(el, cs, { x: 0, y: 0, w: this.size.w, h: this.size.h, rot: 0 }, 1);
    }
  }

  /* ---------- 그림 */

  async img(e, cs, g, o) {
    if (!e.complete || !e.naturalWidth) {
      this.count.lost += 1;
      return;
    }
    const src = e.currentSrc || e.src;
    const vector = /^data:image\/svg|\.svg(?:[?#]|$)/i.test(src);
    const data = vector ? canvasOf(e, g.w * SCALE, g.h * SCALE) : await this.imageData(e, src);
    if (!data) {
      this.count.lost += 1;
      return;
    }
    const opts = { data, ...this.at(g) };
    if (o < 0.99) opts.transparency = transp(o);
    const fit = cs.objectFit;
    if (!vector && (fit === 'cover' || fit === 'contain' || fit === 'scale-down')) {
      opts.sizing = { type: fit === 'cover' ? 'cover' : 'contain', w: opts.w, h: opts.h };
      opts.w = e.naturalWidth / DPI;
      opts.h = e.naturalHeight / DPI;
    }
    if (this.shapeOf(cs, g).name === 'ellipse') opts.rounding = true;
    this.s.addImage(opts);
    this.count.img += 1;
  }

  // 그림의 데이터('image/png;base64,…') — PNG·JPEG·GIF 는 원본 바이트 그대로, 그 밖은 PNG 로
  async imageData(img, src) {
    if (this.cache.has(src)) return this.cache.get(src);
    let out = null;
    if (/^data:image\/(png|jpeg|gif);base64,/i.test(src)) out = src.slice(5);
    else {
      const d = await this.fetchData(src);
      if (d && /^image\/(png|jpeg|gif);/.test(d)) out = d;
    }
    if (!out) out = canvasOf(img, img.naturalWidth, img.naturalHeight);
    this.cache.set(src, out);
    return out;
  }

  // 같은 출처(또는 data:)의 파일 → 'type;base64,…'. 못 읽으면 null.
  async fetchData(url) {
    try {
      if (/^data:/i.test(url)) return url.slice(5);
      const u = new URL(url, this.doc.baseURI);
      if (u.origin !== location.origin && u.protocol !== 'blob:') return null;
      const r = await fetch(u.href, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const b = await r.blob();
      const type = b.type || 'application/octet-stream';
      return `${type};base64,${await base64(b)}`;
    } catch (e) {
      return null;
    }
  }

  // 도표(SVG) — 덱 CSS 를 계산된 값으로 적어 넣고 따로 떼어, 화면의 두 배 해상도 PNG 로(돌린 도표는 돌리기 전 크기로 그려 함께
  // 돌린다). 도형 넣기의 선·화살표는 그림이 아니라 PowerPoint 선으로.
  async svg(e, g, o) {
    if (isLine(e)) {
      this.s.addShape('line', lineShape(e, g, o, (x) => this.at(x), transp));
      return;
    }
    const markup = await this.svgMarkup(e, g.w / this.k, g.h / this.k);
    const data = markup ? await raster(markup, g.w * SCALE, g.h * SCALE) : null;
    if (!data) {
      this.count.lost += 1;
      return;
    }
    const opts = { data, ...this.at(g) };
    if (o < 0.99) opts.transparency = transp(o);
    this.s.addImage(opts);
    this.count.svg += 1;
  }

  async svgMarkup(svg, w, h) {
    const clone = svg.cloneNode(true);
    const inline = (from, to, root) => {
      const src = [from, ...from.querySelectorAll('*')];
      const dst = [to, ...to.querySelectorAll('*')];
      src.forEach((el, i) => {
        const cs = this.win.getComputedStyle(el);
        const decl = [];
        for (const p of SVG_PROPS) {
          if (root && i === 0 && ROOT_SKIP.has(p)) continue;
          const v = cs.getPropertyValue(p);
          if (v) decl.push(`${p}:${v}`);
        }
        if (dst[i]) dst[i].setAttribute('style', decl.join(';'));
      });
    };
    inline(svg, clone, true);
    // 바깥에 둔 정의(<use href="#…">·url(#…))를 끌어온다
    const want = [];
    const scan = (el) => {
      for (const a of el.attributes) {
        if (/^(xlink:)?href$/.test(a.name) && a.value.startsWith('#')) want.push(a.value.slice(1));
        for (const m of a.value.matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) want.push(m[1]);
      }
    };
    for (const el of [clone, ...clone.querySelectorAll('*')]) scan(el);
    const defs = [];
    const seen = new Set();
    while (want.length) {
      const id = want.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (clone.querySelector(`#${CSS.escape(id)}`)) continue;
      const src = this.doc.getElementById(id);
      if (!src || src.namespaceURI !== SVGNS) continue;
      const c = src.cloneNode(true);
      inline(src, c, false);
      for (const el of [c, ...c.querySelectorAll('*')]) scan(el);
      defs.push(c);
    }
    if (defs.length) {
      const d = this.doc.createElementNS(SVGNS, 'defs');
      d.append(...defs);
      clone.prepend(d);
    }
    // 그 안의 그림(<image>)은 따로 그린 SVG 에서 불러오지 못하므로 data: 로
    for (const im of clone.querySelectorAll('image')) {
      const href = im.getAttribute('href') || im.getAttribute('xlink:href') || '';
      if (!href || href.startsWith('data:')) continue;
      const d = await this.fetchData(href);
      if (d) {
        im.removeAttribute('xlink:href');
        im.setAttribute('href', `data:${d}`);
      } else im.remove();
    }
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    try {
      return new XMLSerializer().serializeToString(clone);
    } catch (e) {
      return null;
    }
  }

  async media(e, g, o) {
    const poster = e.localName === 'video' ? e.getAttribute('poster') : '';
    const d = poster ? await this.fetchData(poster) : null;
    if (d && /^image\//.test(d)) {
      this.s.addImage({ data: d, ...this.at(g), transparency: o < 0.99 ? transp(o) : undefined });
      this.count.poster += 1;
      return;
    }
    this.count.media += 1;
  }

  /* ---------- 글 */

  async text(host, cs, g, o) {
    // 0) 한 줄에 나란히 놓인 칸(flex·grid — 꼬리말의 쪽 번호, 알약, 키 상자, 카드 등)은 칸마다 제 자리의 글상자로 — 칸 사이에
    //    바로 든 글 조각도 그 글이 그려진 자리에
    const items = this.sideBySide(host, cs);
    if (items) {
      for (const it of items) {
        if (it.nodeType === 3) this.loose(it, host, cs);
        else await this.item(it, o);
      }
      return;
    }
    // 문단(재기만 한다) — 문단 흐름 밖에 떠 있는 것(절대 자리)은 따로 제 자리에 옮기므로 아래 1)에서 뺀다
    const paras = g ? this.paragraphs(host) : null;
    const floating = (d) => !!paras && paras.floaters.some((f) => f.contains(d));
    // 1) 글 속 상자(배경·테두리가 있는 span·p 등) — 줄마다 도형으로, 글상자보다 먼저(뒤에). 배경만 칠한 글 줄과 한 줄짜리
    //    배지(lit)는 글자 형광으로 옮겨 글과 함께 움직이게 하고, 글 없는 꾸밈(::before·::after)도 여기서
    for (const d of host.querySelectorAll('*')) {
      if (embedded(d, host) || floating(d)) continue;
      const dcs = this.win.getComputedStyle(d);
      if (dcs.display === 'none') continue;
      const lit = this.lit(d, dcs);
      if (dcs.visibility === 'visible' && !lit && (rgba(dcs.backgroundColor) || hasBorder(dcs))) {
        const rects = dcs.display === 'inline' ? [...d.getClientRects()] : [d.getBoundingClientRect()];
        for (const rc of rects) {
          const dg = this.geom(d, dcs, rc);
          if (dg) await this.box(d, dcs, dg, o, rects.length > 1 ? rc : null);
        }
      }
      await this.pseudo(d, '::before', o);
      await this.pseudo(d, '::after', o);
    }
    // 2) 글상자, 그다음 떠 있는 것
    if (paras && paras.some((p) => p.runs.some((r) => r.text.trim()))) this.addTextBox(host, cs, g, paras);
    for (const f of (paras && paras.floaters) || []) await this.item(f, o);
    // 3) 글 속 그림·도표·표 — 글상자 위에
    for (const d of host.querySelectorAll('img, svg, table, canvas, video, audio, iframe, object, embed')) {
      if (outerEmbed(d, host) && !floating(d)) await this.visit(d, o);
    }
  }

  // flex·grid 칸에서 둘 이상이 한 줄에 나란히 놓였으면 그 칸들(절대 자리의 것도, 칸 사이에 바로 든 글 조각도 함께) —
  // 아니면 null(한 글상자로)
  sideBySide(host, cs) {
    if (!/flex|grid/.test(cs.display) || /column/.test(cs.flexDirection)) return null;
    const items = [];
    const flow = [];
    for (const n of host.childNodes) {
      if (n.nodeType === 3) {
        if (!/\S/.test(n.data)) continue;
        const rg = this.doc.createRange();
        rg.selectNodeContents(n);
        items.push(n);
        flow.push(rg.getBoundingClientRect());
        continue;
      }
      if (n.nodeType !== 1 || SKIP.has(n.localName) || n.hasAttribute(A.ui)) continue;
      const ccs = this.win.getComputedStyle(n);
      if (ccs.display === 'none') continue;
      items.push(n);
      if (ccs.position !== 'absolute' && ccs.position !== 'fixed') flow.push(n.getBoundingClientRect());
    }
    for (let i = 1; i < flow.length; i += 1) {
      const a = flow[i - 1];
      const b = flow[i];
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > 0.5 * Math.min(a.height, b.height) && (b.left >= a.right - 1 || a.left >= b.right - 1)) return items;
    }
    return null;
  }

  // 나란히 놓인 칸 사이에 바로 든 글 조각 하나 — 그 글이 그려진 자리의 글상자로(여러 줄로 꺾였으면 그 폭에서 꺾이게)
  loose(n, host, cs) {
    const text = glyphs(transform(collapse(n.data, cs.whiteSpace).trim(), cs.textTransform));
    const rg = this.doc.createRange();
    rg.selectNodeContents(n);
    const r = rg.getBoundingClientRect();
    const g = text && cs.visibility === 'visible' ? this.geom(host, null, r) : null;
    if (!g) return;
    const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.25;
    const opts = this.runOpts(host, cs, host);
    this.s.addText(symbolRuns([{ text, options: { ...opts, align: 'left' } }]), {
      ...this.at(g), margin: 0, valign: 'middle', wrap: r.height > lh * 1.6, isTextBox: true,
    });
    this.count.text += 1;
  }

  addTextBox(host, cs, g, paras) {
    const k = this.k * PT;
    const pad = (s) => px(cs[`padding${s}`]) + px(cs[`border${s}Width`]);
    // 글머리표가 매달린 글상자는 왼쪽 안쪽 여백을 문단 여백으로 옮겼다(margins) — 상자에는 테두리만
    const margin = [paras.hang ? px(cs.borderLeftWidth) : pad('Left'), pad('Right'), pad('Bottom'), pad('Top')].map((v) => r2(v * k));
    // flex·grid 칸 앞에 흐르는 꾸밈(::before 점 등)이 글을 민 만큼 왼쪽 여백을 늘린다 — 왼쪽 정렬 한 문단일 때만
    if (/flex|grid/.test(cs.display) && !paras.hang && paras.length === 1 && paras[0].para.align === 'left') {
      const rg = this.doc.createRange();
      rg.selectNodeContents(host);
      const rr = rg.getBoundingClientRect();
      const push = rr.left - (host.getBoundingClientRect().left + pad('Left'));
      if (rr.width > 0 && push > 1) margin[0] = r2((pad('Left') + push) * k);
    }
    // 한 줄짜리 글은 줄을 바꾸지 않고(PowerPoint 글꼴이 조금 넓으면 엉뚱한 곳에서 꺾인다) 정한 줄 간격도 두지 않는다(글자를
    // 칸 아래로 민다 — 가운데 둔 번호·배지). 여러 줄이면 폭에 여유를 조금.
    const biggest = Math.max(...paras[0].runs.map((r) => r.opts.fontSize)) / k;
    const lh = px(this.win.getComputedStyle(paras[0].block).lineHeight) || biggest * 1.25;
    const inner = g.h / this.k - pad('Top') - pad('Bottom');
    const single = paras.length === 1 && !paras[0].runs.some((r) => r.soft) && inner < lh * 1.6;
    const runs = [];
    paras.forEach((p, pi) => {
      if (single) delete p.para.lineSpacing;
      p.runs.forEach((r, ri) => {
        const opt = { ...r.opts, ...p.para };
        delete opt.buColor;
        if (ri === 0 && p.para.buColor) opt.lang = `${opt.lang || 'en-US'}-x-bu${p.para.buColor}`;   // tidy 가 buClr 로
        if (r.soft) opt.softBreakBefore = true;
        if (ri === p.runs.length - 1 && pi < paras.length - 1) opt.breakLine = true;
        runs.push({ text: r.text, options: opt });
      });
    });
    let box = g;
    if (!single && !g.rot) {
      const extra = g.w * 0.03;
      const al = paras[0].para.align;
      box = { ...g, w: g.w + extra, x: al === 'center' ? g.x - extra / 2 : al === 'right' ? g.x - extra : g.x };
    }
    // 한 줄짜리 글이 상자 높이를 거의 다 채우면 위아래 가운데에 — CSS 는 줄 높이에서 남는 틈을 위아래에 반씩 두어 글자를 줄
    // 가운데에 그린다(정한 줄 간격이 없는 PowerPoint 의 줄이 상자보다 높거나 낮아도 글자가 제자리에)
    const valign = single && Math.abs(inner - lh) <= lh * 0.25 ? 'middle' : this.valignOf(host, cs);
    this.s.addText(symbolRuns(runs), {
      ...this.at(box), margin, valign, wrap: !single, isTextBox: true,
    });
    this.count.text += 1;
  }

  valignOf(host, cs) {
    if (cs.display === 'table-cell') return VALIGN[cs.verticalAlign] || 'top';
    if (/flex/.test(cs.display)) {
      const column = /column/.test(cs.flexDirection);
      const v = column ? cs.justifyContent : cs.alignItems;
      if (/center/.test(v)) return 'middle';
      if (/end/.test(v)) return 'bottom';
    }
    if (/grid/.test(cs.display) && /center/.test(cs.alignItems)) return 'middle';
    return 'top';
  }

  // 글 칸 → 문단들 [{block, para, runs: [{text, opts, soft}]}] — 블록 요소마다 문단, <br> 은 줄바꿈(같은 문단).
  // 문단 흐름 밖(절대 자리)의 것은 따로 — 문단의 왼쪽 여백에 둔 글자 하나(①·√·※)는 그 문단의 글머리표로(marks), 그 밖은
  // 제 자리의 글상자로(floaters, text 가 옮긴다). inline-flex·inline-grid 의 칸은 줄 안의 글로 잇고, 글 줄의 옆 여백·안쪽
  // 여백·칸 사이(3px 이상)는 빈칸 하나로.
  paragraphs(host) {
    const win = this.win;
    const paras = [];
    const marks = new Map();
    const floaters = [];
    let cur = null;
    const blockOf = (n) => {
      for (let e = n.parentElement; e && e !== host; e = e.parentElement) {
        if (BLOCK.has(win.getComputedStyle(e).display) && !inlineItem(win, e)) return e;
      }
      return host;
    };
    const start = (block) => {
      cur = { block, runs: [], para: null };
      paras.push(cur);
    };
    let soft = false;
    // 글 줄 사이의 빈칸(gap) — 줄바꿈 표시(soft)는 다음 글 조각이 가져가게 둔다. 정리 뒤 비면 버린다. 여는 괄호·따옴표
    // 뒤에는 두지 않고, 닫는 괄호·문장 부호가 바로 오면 걷는다(‘slides )’ 가 되지 않게).
    const space = (el) => {
      if (!cur || !cur.runs.length || /[([{「『《〈‘“]$/u.test(cur.runs[cur.runs.length - 1].text)) return;
      cur.runs.push({ text: ' ', opts: this.runOpts(el, win.getComputedStyle(el), cur.block), soft: false, gap: true });
    };
    const walk = (n) => {
      if (n.nodeType === 3) {
        const parent = n.parentElement;
        const pcs = win.getComputedStyle(parent);
        if (pcs.visibility !== 'visible') return;
        const mode = pcs.whiteSpace;
        const raw = collapse(n.data, mode);
        if (!raw) return;
        if (!cur) start(blockOf(n));
        const opts = this.runOpts(parent, pcs, cur.block);
        const parts = /^pre/.test(mode) || mode === 'break-spaces' ? raw.split('\n') : [raw];
        const last = cur.runs[cur.runs.length - 1];
        if (last && last.gap && /^[)\]}」』》〉’”.,:;!?…]/u.test(parts[0])) cur.runs.pop();
        parts.forEach((t, i) => {
          let s = glyphs(transform(t, pcs.textTransform));
          // 줄을 바꾸지 않는 코드 칩은 그 안의 빈칸·붙임표에서 꺾이지 않게
          if (mode === 'nowrap' && chipNowrap(win, parent)) s = s.replace(/ /g, NBSP).replace(/-/g, NBHY);
          cur.runs.push({ text: s, opts, soft: soft || i > 0 });
          soft = false;
        });
        return;
      }
      if (n.nodeType !== 1) return;
      const e = n;
      const tag = e.localName;
      if (SKIP.has(tag) || EMBED.has(tag) || e.hasAttribute(A.ui)) return;
      const ecs = win.getComputedStyle(e);
      if (ecs.display === 'none') return;
      if (ecs.position === 'absolute' || ecs.position === 'fixed') {
        const b = blockOf(e);
        const mark = marks.has(b) ? null : markOf(win, e, ecs, b);
        if (mark) marks.set(b, mark);
        else floaters.push(e);
        return;
      }
      if (tag === 'br') {
        // 빈 조각에 줄바꿈을 붙인다 — 문단 첫 조각 앞의 줄바꿈은 pptxgenjs 가 쓰지 않으므로, 문단이 <br> 로 시작하면
        // 빈 첫 조각을 두고, <br> 이 잇따르면 빈 줄마다 빈 조각을
        if (!cur) start(blockOf(e));
        if (!cur.runs.length || soft) {
          const pe = e.parentElement;
          cur.runs.push({ text: '', opts: this.runOpts(pe, win.getComputedStyle(pe), cur.block), soft });
        }
        soft = true;
        return;
      }
      const item = inlineItem(win, e);
      const block = BLOCK.has(ecs.display) && !item;
      const inl = !block && (item || /^inline/.test(ecs.display));
      const lead = inl ? side(ecs, 'Left') + (item && e.previousElementSibling ? px(win.getComputedStyle(e.parentElement).columnGap) : 0) : 0;
      if (lead >= 3) space(e.parentElement);
      if (block) {
        cur = null;
        soft = false;
        const before = pseudoText(win, e, '::before');
        if (before && !before.bullet) {
          start(e);
          cur.runs.push({ text: glyphs(before.text), opts: this.runOpts(e, before.cs, e), soft: false });
        }
      }
      for (const c of e.childNodes) walk(c);
      if (block) {
        cur = null;
        soft = false;
      } else if (inl && side(ecs, 'Right') >= 3) space(e.parentElement);
    };
    for (const c of host.childNodes) walk(c);
    // 문단 끝·<br> 앞뒤 빈칸 정리, 문단 성질(정렬·줄 간격·간격·글머리표), 왼쪽 여백
    const out = paras.filter((p) => p.runs.length);
    let prev = null;
    for (const p of out) {
      trimRuns(p.runs);
      p.runs = p.runs.filter((r) => r.text || !r.gap);
      p.para = this.paraOpts(p, host, prev, marks);
      prev = p;
    }
    this.margins(out, host);
    out.floaters = floaters;
    return out;
  }

  paraOpts(p, host, prev, marks) {
    const win = this.win;
    const block = p.block;
    const cs = win.getComputedStyle(block);
    const k = this.k * PT;
    const para = { align: this.alignOf(block, cs, host) };
    const lh = cs.lineHeight;
    if (lh && lh !== 'normal') para.lineSpacing = r2(px(lh) * k);
    // 문단 사이 — 앞 문단과의 실제 간격(바깥 여백·안쪽 여백)
    if (prev && prev.block !== block && block !== host && !prev.block.contains(block) && !block.contains(prev.block)) {
      const a = prev.block.getBoundingClientRect();
      const b = block.getBoundingClientRect();
      const gap = b.top + px(cs.paddingTop) - (a.bottom - px(win.getComputedStyle(prev.block).paddingBottom));
      if (gap > 0.5 && gap < 400) para.paraSpaceBefore = r2(gap * k);
    }
    // 글머리표 — 목록 항목(list-style), 목록 표시 없이 ::before 로 그린 표시, 문단 왼쪽 여백에 따로 둔 글자 하나(marks).
    // 들여 쓴 정도(indent)는 margins 가 문단을 다 본 뒤에 정한다.
    p.level = 0;
    for (let e = block.parentElement; e && e !== host; e = e.parentElement) if (e.localName === 'li') p.level += 1;
    const before = pseudoText(win, block, '::before');
    const item = cs.display === 'list-item';
    const str = /^"(\S)\s*"$/u.exec(cs.listStyleType || '');
    let bullet = null;
    let mark = null;                     // 표시(::marker·::before·따로 둔 글자)의 색
    if (item && NUMBER[cs.listStyleType]) {
      // 시작 번호는 이 글상자에서 그 목록이 (다시) 시작하는 항목에만 — 이어지는 항목에 적는 '0' 은 tidy 가 지운다
      p.list = block.closest('ol');
      const go = !!prev && prev.list === p.list && prev.level === p.level && !!prev.para.bullet && prev.para.bullet.type === 'number';
      bullet = { type: 'number', style: NUMBER[cs.listStyleType], startAt: go ? '0' : startOf(block, p.list) };
    } else if (item && MARKS[cs.listStyleType]) bullet = { characterCode: MARKS[cs.listStyleType] };
    else if (item && str && str[1].codePointAt(0) <= 0xffff) bullet = { characterCode: hex4(str[1].codePointAt(0)) };
    if (bullet) mark = rgba(win.getComputedStyle(block, '::marker').color);
    else if (before && before.bullet) {
      bullet = { characterCode: before.code };
      mark = rgba(before.cs.color);
    } else if (marks.has(block)) {
      bullet = { characterCode: marks.get(block).code };
      mark = marks.get(block).color;
    }
    if (bullet) para.bullet = bullet;
    // 표시의 색이 글과 다르면 글머리표 색으로(addTextBox 가 첫 글 조각에 실어 보내고 tidy 가 넣는다)
    const own = rgba(cs.color);
    if (bullet && mark && own && mark.hex !== own.hex) para.buColor = mark.hex;
    return para;
  }

  // 문단 정렬 — text-align 이 왼쪽이면, flex·grid 가 가운데·끝에 둔 글(번호 동그라미·배지)을 따른다. 글상자 칸 자신의 배치와,
  // 칸 안의 문단이면 그 부모의 배치까지 본다.
  alignOf(block, cs, host) {
    const al = ALIGN[cs.textAlign] || 'left';
    if (al !== 'left') return al;
    const place = (c) => {
      if (/grid/.test(c.display)) return `${c.justifyItems} ${c.justifyContent}`;
      if (/flex/.test(c.display)) return /column/.test(c.flexDirection) ? c.alignItems : c.justifyContent;
      return '';
    };
    const parent = block !== host ? block.parentElement : null;
    const v = `${place(cs)} ${parent ? place(this.win.getComputedStyle(parent)) : ''}`;
    if (/center/.test(v)) return 'center';
    if (/(^|\s)(flex-end|end|right)(\s|$)/.test(v)) return 'right';
    return al;
  }

  // 문단 왼쪽 여백 — 글머리표가 매달린 글상자는 테두리 안쪽에서 잰다(안쪽 여백까지 문단 여백으로 — addTextBox 가 왼쪽 안쪽
  // 여백을 테두리만큼으로 줄인다). 아니면 안쪽 여백 안에서. 글머리표 없는 문단의 여백(왼쪽·양쪽 정렬일 때만)은 보이지 않는
  // 글머리표(PLAIN)에 실어 보내고 tidy 가 글머리표 없음(buNone)으로 바꾼다.
  margins(out, host) {
    const win = this.win;
    const hb = host.getBoundingClientRect();
    const hcs = win.getComputedStyle(host);
    out.hang = out.some((p) => p.para.bullet);
    const origin = hb.left + px(hcs.borderLeftWidth) + (out.hang ? 0 : px(hcs.paddingLeft));
    const k = this.k * PT;
    for (const p of out) {
      const bcs = win.getComputedStyle(p.block);
      const left = (p.block.getBoundingClientRect().left + px(bcs.borderLeftWidth) + px(bcs.paddingLeft) - origin) * k;
      const b = p.para.bullet;
      if (b) {
        b.indent = r2(Math.max(8, left) / (p.level + 1));
        if (p.level) p.para.indentLevel = p.level;
      } else if (left > 0.75 && (p.para.align === 'left' || p.para.align === 'justify')) {
        p.para.bullet = { characterCode: PLAIN, indent: r2(left) };
      }
    }
  }

  runOpts(el, cs, block) {
    const win = this.win;
    let size = px(cs.fontSize);
    const o = { fontFace: face(cs.fontFamily), lang: this.lang };
    this.fonts.set(o.fontFace, (this.fonts.get(o.fontFace) || 0) + 1);
    const c = rgba(cs.color);
    o.color = c ? c.hex : '000000';
    if (parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold') o.bold = true;
    if (/italic|oblique/.test(cs.fontStyle)) o.italic = true;
    // 밑줄·취소선·위아래첨자·형광(글 줄의 배경)은 이어받지 않는 성질이라 문단까지 올라가며 본다
    let lit = null;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const ecs = e === el ? cs : win.getComputedStyle(e);
      const deco = ecs.textDecorationLine || '';
      if (/underline/.test(deco)) o.underline = { style: 'sng' };
      if (/line-through/.test(deco)) o.strike = 'sngStrike';
      const shift = o.superscript || o.subscript ? '' : shiftOf(win, e, ecs);
      if (shift) {
        o[shift === 'super' ? 'superscript' : 'subscript'] = true;
        if (e.parentElement) size = px(win.getComputedStyle(e.parentElement).fontSize);   // PowerPoint 가 줄여 그린다
      }
      if (e === block) break;
      if (!lit && this.lit(e, ecs)) lit = e;
    }
    if (lit) o.highlight = this.solid(rgba(win.getComputedStyle(lit).backgroundColor), lit.parentElement);
    const scale = this.inCell ? this.cellScale : 1;
    o.fontSize = Math.max(1, r2(size * PT * this.k * scale));
    if (cs.letterSpacing && cs.letterSpacing !== 'normal') {
      const ls = px(cs.letterSpacing) * PT * this.k * scale;
      if (Math.abs(ls) > 0.05) o.charSpacing = r2(ls);
    }
    // 링크 — 덱 밖의 주소(http·https·mailto)는 그대로, 덱 안의 자리(#id)는 그 자리가 든 장으로 가는 링크로. 그 밖의 상대
    // 주소는 편집기의 주소로 풀려(slides edit 에서는 실행 열쇠까지) 받은 파일에서는 쓸모가 없으므로 옮기지 않는다.
    const a = el.closest('a[href]');
    const href = a ? (a.getAttribute('href') || '').trim() : '';
    if (/^(https?:|mailto:)/i.test(href)) o.hyperlink = { url: a.href };
    else if (href.length > 1 && href.startsWith('#')) {
      const n = this.slideOf(href.slice(1));
      if (n) o.hyperlink = { slide: n };
    }
    return o;
  }

  // 덱 안의 자리(id) → 그 자리가 든 장의 번호(1부터), 없으면 0
  slideOf(id) {
    let key = id;
    try {
      key = decodeURIComponent(id);
    } catch (e) {
      key = id;
    }
    const t = this.doc.getElementById(key);
    return t ? this.model.slides.findIndex((s) => s === t || s.contains(t)) + 1 : 0;
  }

  // 글자 형광으로 옮기는 글 줄 — 배경을 칠한 inline(가는 테두리 1.5px 까지는 버리고 — 코드 칩을 도형으로 따로 두면
  // PowerPoint 에서 글과 어긋난다), 또는 글이 든 한 줄짜리 inline-block·inline-flex 배지. 표 칸 안에서는 테두리가 있어도
  // (칸 위에 도형을 따로 얹지 않는다)
  lit(e, cs) {
    if (!rgba(cs.backgroundColor)) return false;
    if (cs.display === 'inline') return this.inCell || !hasBorder(cs) || thinBorder(cs);
    if (!this.inCell && hasBorder(cs)) return false;
    if (!/^inline-(block|flex|grid)$/.test(cs.display) || !/\S/.test(e.textContent)) return false;
    const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.3;
    return e.getBoundingClientRect().height <= lh * 1.8 + px(cs.paddingTop) + px(cs.paddingBottom)
      + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  }

  // 반투명 색 → 바로 뒤의 불투명 바탕과 섞은 색(형광에는 투명도가 없다)
  solid(c, el) {
    if (c.a >= 0.99) return c.hex;
    let ground = 'FFFFFF';
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const b = rgba(this.win.getComputedStyle(e).backgroundColor);
      if (b && b.a >= 0.99) {
        ground = b.hex;
        break;
      }
    }
    const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
    return [0, 2, 4].map((i) => Math.round(ch(c.hex, i) * c.a + ch(ground, i) * (1 - c.a)).toString(16).padStart(2, '0'))
      .join('').toUpperCase();
  }

  /* ---------- 표 */

  async table(t, g, o) {
    const win = this.win;
    const rows = [...t.rows].filter((tr) => win.getComputedStyle(tr).display !== 'none');
    if (!rows.length) return;
    const occ = rows.map(() => []);
    const cells = [];
    rows.forEach((tr, r) => {
      let c = 0;
      for (const td of tr.cells) {
        if (win.getComputedStyle(td).display === 'none') continue;
        while (occ[r][c]) c += 1;
        const cs = Math.max(1, td.colSpan || 1);
        const rs = Math.max(1, Math.min(td.rowSpan || 1, rows.length - r));
        for (let i = 0; i < rs; i += 1) for (let j = 0; j < cs; j += 1) occ[r + i][c + j] = true;
        cells.push({ td, r, c, cs, rs });
        c += cs;
      }
    });
    const ncol = Math.max(1, ...occ.map((row) => row.length));
    // 열 폭 — 그 열에서 시작하는 칸의 왼쪽 끝으로
    const lefts = new Array(ncol).fill(null);
    let right = null;
    for (const x of cells) {
      const rc = x.td.getBoundingClientRect();
      if (lefts[x.c] === null || (x.cs === 1 && rc.left < lefts[x.c])) lefts[x.c] = rc.left;
      if (x.c + x.cs === ncol) right = right === null ? rc.right : Math.max(right, rc.right);
    }
    const tr0 = t.getBoundingClientRect();
    if (lefts[0] === null) lefts[0] = tr0.left;
    if (right === null) right = tr0.right;
    for (let j = 1; j < ncol; j += 1) {
      if (lefts[j] !== null) continue;
      let n = j + 1;
      while (n < ncol && lefts[n] === null) n += 1;
      const end = n < ncol ? lefts[n] : right;
      lefts[j] = lefts[j - 1] + (end - lefts[j - 1]) / (n - j + 1);
    }
    // 열 폭 — 표 폭은 화면 그대로(옆 상자·여백을 넘지 않게) 두고, 칸 글이 화면에서 한 줄인 열(숫자·짧은 머리)이 PowerPoint
    // 글꼴이 조금 넓어도 꺾이지 않게 열 사이에서 폭을 나눈다(fitColumns). 나눠도 모자라면 그 표의 글자를 조금 줄인다.
    const x0 = (lefts[0] - this.ox) * this.k;
    const widths = lefts.map((l, j) => Math.max(2, ((j + 1 < ncol ? lefts[j + 1] : right) - l) * this.k));
    const fit = this.fitColumns(cells, widths);
    const colW = fit.widths.map((w) => inch(w));
    const rowH = rows.map((tr) => inch(Math.max(2, tr.getBoundingClientRect().height * this.k)));
    let data;
    this.cellScale = fit.scale;
    try {
      data = rows.map((tr, r) => cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c)
        .map((x) => this.cell(x, tr, t, o)));
    } finally {
      this.cellScale = 1;
    }
    if (fit.scale < 1) this.count.shrunk += 1;
    this.s.addTable(data, {
      x: inch(x0), y: inch(g.y), w: r2(colW.reduce((a, b) => a + b, 0)), colW, rowH, autoPage: false,
    });
    this.count.table += 1;
    // 칸 안의 그림·도표·표는 표 위에 따로
    for (const d of t.querySelectorAll('img, svg, table, canvas, video, audio, iframe, object, embed')) {
      if (outerEmbed(d, t)) await this.visit(d, o);
    }
  }

  // 열 폭 나누기 — 글이 한 줄인 칸은 그 글 폭에 여유를 둔 폭(덱의 웹 글꼴이면 PowerPoint 가 대신 쓸 글꼴로 넓어지는 만큼까지,
  // 안쪽 여백까지)을 바라고, 모자란 만큼을 바라는 것보다 넓은 열(남는 만큼)과 여러 줄로 꺾인 칸이 있는 열(폭의 1/5 까지 — 그
  // 열의 한 줄 칸이 바라는 폭 아래로는 아니게)에서 고루 덜어 온다. 합은 그대로. 그래도 모자라면(모든 열이 글에 꼭 맞는 표)
  // 가장 모자란 열에 맞춰 표의 글자를 줄일 배율(0.85 까지)을 함께 돌려준다. → {widths, scale}
  fitColumns(cells, widths) {
    const n = widths.length;
    const need = new Array(n).fill(0);
    const text = new Array(n).fill(0);       // 바라는 폭 가운데 글 몫(안쪽 여백 빼고) — 글자를 줄일 배율을 셀 때
    const wraps = new Array(n).fill(false);
    for (const x of cells) {
      if (x.cs !== 1) continue;
      const m = this.cellLines(x.td);
      if (!m) continue;
      if (m.lines > 1) {
        wraps[x.c] = true;
        continue;
      }
      const cs = this.win.getComputedStyle(x.td);
      const t = (m.extra > 0 ? (m.width + m.extra) * 1.03 : m.width * 1.02) + 2;
      const all = t + px(cs.paddingLeft) + px(cs.paddingRight);
      if (all * this.k > need[x.c]) {
        need[x.c] = all * this.k;
        text[x.c] = t * this.k;
      }
    }
    const want = widths.map((w, j) => Math.max(0, need[j] - w));
    const give = widths.map((w, j) => Math.max(0, wraps[j] ? Math.min(w * 0.2, w - need[j]) : w - need[j]));
    const short = want.reduce((a, b) => a + b, 0);
    const pool = give.reduce((a, b) => a + b, 0);
    const moved = Math.min(short, pool);
    const out = moved < 0.5 ? widths : widths.map((w, j) => w + (want[j] / short) * moved - (give[j] / pool) * moved);
    let scale = 1;
    out.forEach((w, j) => {
      if (need[j] > w + 0.5 && text[j] > 0) scale = Math.min(scale, (w - (need[j] - text[j])) / text[j]);
    });
    return { widths: out, scale: Math.max(0.85, Math.floor(scale * 100) / 100) };
  }

  // 칸 글의 줄 — 글자 노드의 줄 조각과 줄 안 상자(칩·그림)를 문단마다 줄로 묶는다(칸 전체를 Range 로 재면 문단 상자까지 섞여
  // 줄을 셀 수 없다). → {lines: 가장 많이 꺾인 문단의 줄 수, width: 가장 넓은 줄의 폭(CSS px), extra: 그 줄을 PowerPoint 가
  // 대신 쓸 글꼴로 그리면 늘어나는 폭} — 글이 없으면 null
  cellLines(td) {
    const win = this.win;
    const table = td.closest('table');
    const blockOf = (e) => {
      for (; e && e !== td; e = e.parentElement) {
        if (BLOCK.has(win.getComputedStyle(e).display) && !inlineItem(win, e)) return e;
      }
      return td;
    };
    const boxes = new Map();                 // 문단 → 줄 조각 [{top, bottom, left, right, extra}]
    const add = (b, r, extra) => {
      if (!(r.width > 0.5 && r.height > 0.5)) return;
      if (!boxes.has(b)) boxes.set(b, []);
      boxes.get(b).push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, extra });
    };
    const rg = this.doc.createRange();
    const walker = this.doc.createTreeWalker(td, win.NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.data.trim() || el.closest('table') !== table) continue;    // 칸 안의 표는 따로 그린다
      const cs = win.getComputedStyle(el);
      if (cs.visibility !== 'visible') continue;
      rg.selectNodeContents(n);
      const rects = [...rg.getClientRects()];
      const extra = rects.length === 1 ? this.fallbackExtra(n.data, cs) : 0;
      for (const r of rects) add(blockOf(el), r, extra);
    }
    for (const e of td.querySelectorAll('*')) {
      if (e.closest('table') !== table) continue;
      const cs = win.getComputedStyle(e);
      const boxed = hasBorder(cs) || rgba(cs.backgroundColor) || px(cs.paddingLeft) + px(cs.paddingRight) > 0.5;
      if (!/^inline/.test(cs.display) || !(boxed || e.localName === 'img' || e.localName === 'svg')) continue;
      for (const r of e.getClientRects()) add(blockOf(e.parentElement), r, 0);
    }
    if (!boxes.size) return null;
    let lines = 0;
    let best = null;
    for (const list of boxes.values()) {
      const rows = [];
      for (const b of list.sort((p, q) => p.top - q.top)) {
        const row = rows.find((l) => Math.min(l.bottom, b.bottom) - Math.max(l.top, b.top)
          > 0.5 * Math.min(l.bottom - l.top, b.bottom - b.top));
        if (!row) {
          rows.push({ ...b });
          continue;
        }
        row.top = Math.min(row.top, b.top);
        row.bottom = Math.max(row.bottom, b.bottom);
        row.left = Math.min(row.left, b.left);
        row.right = Math.max(row.right, b.right);
        row.extra += b.extra;
      }
      lines = Math.max(lines, rows.length);
      for (const l of rows) if (!best || l.right - l.left + l.extra > best.right - best.left + best.extra) best = l;
    }
    return { lines, width: best.right - best.left, extra: Math.max(0, best.extra) };
  }

  // 덱의 웹 글꼴로 쓴 글을 PowerPoint 가 대신 쓸 글꼴로 그리면 늘어나는 폭(CSS px) — 웹 글꼴이 아니면 0
  fallbackExtra(text, cs) {
    if (!this.web.has(face(cs.fontFamily).toLowerCase())) return 0;
    const t = transform(collapse(text, cs.whiteSpace), cs.textTransform).trim();
    if (!t) return 0;
    if (!this.pen) this.pen = this.doc.createElement('canvas').getContext('2d');
    const font = (family) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${family}`;
    this.pen.font = font(cs.fontFamily);
    const web = this.pen.measureText(t).width;
    this.pen.font = font(`"${substitute(cs.fontFamily)}", sans-serif`);
    return this.pen.measureText(t).width - web;
  }

  cell(x, tr, table, o) {
    const win = this.win;
    const cs = win.getComputedStyle(x.td);
    const k = this.k * PT;
    let paras;
    this.inCell = true;                 // 칸 안의 배지는 테두리가 있어도 형광으로(lit)
    try {
      paras = this.paragraphs(x.td);
    } finally {
      this.inCell = false;
    }
    const runs = [];
    paras.forEach((p, pi) => {
      p.runs.forEach((r, ri) => {
        const opt = { ...r.opts, ...p.para };
        delete opt.bullet;
        delete opt.indentLevel;
        delete opt.buColor;
        if (r.soft) opt.softBreakBefore = true;
        if (ri === p.runs.length - 1 && pi < paras.length - 1) opt.breakLine = true;
        runs.push({ text: r.text, options: opt });
      });
    });
    let fill = null;
    for (let e = x.td; e && e !== table.parentElement; e = e.parentElement) {
      fill = rgba(win.getComputedStyle(e).backgroundColor);
      if (fill || e === table) break;
    }
    const side = (s) => {
      let scs = cs;
      let style = scs[`border${s}Style`];
      let w = style === 'none' || style === 'hidden' ? 0 : px(scs[`border${s}Width`]);
      if (!w && (s === 'Top' || s === 'Bottom')) {           // 표가 줄(tr)에 그은 선(border-collapse)
        scs = win.getComputedStyle(tr);
        style = scs[`border${s}Style`];
        w = style === 'none' || style === 'hidden' ? 0 : px(scs[`border${s}Width`]);
      }
      const c = rgba(scs[`border${s}Color`]);
      return w > 0.2 && c ? { type: DASH[style] === 'sysDot' ? 'dash' : DASH[style] || 'solid', pt: r2(w * k), color: c.hex }
        : { type: 'none' };
    };
    const opts = {
      valign: VALIGN[cs.verticalAlign] || 'top',
      // pptxgenjs 는 첫 값이 1 이상이면 pt, 아니면 인치로 읽는다 — 늘 인치로 주고 첫 값(위)은 1 아래로
      margin: ['Top', 'Right', 'Bottom', 'Left'].map((s, i) => {
        const v = inch(px(cs[`padding${s}`]) * this.k);
        return i === 0 ? Math.min(v, 0.99) : v;
      }),
      border: ['Top', 'Right', 'Bottom', 'Left'].map(side),
    };
    // 문단 끝 표시(endParaRPr)의 크기·글꼴 — 칸에 따로 주지 않으면 pptxgenjs 가 12pt 로 적어 그보다 작은 글의 마지막 줄이
    // 높아진다(표가 아래로 길어져 캡션에 겹친다). 칸에서 가장 작은 글자로 — 어느 줄도 글보다 높아지지 않게.
    const sized = runs.filter((r) => r.options.fontSize);
    if (sized.length) {
      const least = sized.reduce((a, b) => (b.options.fontSize < a.options.fontSize ? b : a));
      opts.fontSize = least.options.fontSize;
      opts.fontFace = least.options.fontFace;
    }
    if (x.cs > 1) opts.colspan = x.cs;
    if (x.rs > 1) opts.rowspan = x.rs;
    if (fill) opts.fill = { color: fill.hex, transparency: transp(fill.a * o) };
    if (paras[0]) opts.align = paras[0].para.align;
    return { text: runs.length ? symbolRuns(runs) : '', options: opts };
  }
}

/* ---------- 도움 함수 */

// 공백 다루기(white-space) — 보통은 이어진 빈칸·줄바꿈을 빈칸 하나로
function collapse(t, mode) {
  if (mode === 'pre' || mode === 'pre-wrap' || mode === 'break-spaces') return t.replace(/\r\n?/g, '\n');
  if (mode === 'pre-line') return t.replace(/[ \t\r\f]+/g, ' ').replace(/ ?\n ?/g, '\n');
  return t.replace(/[ \t\n\r\f]+/g, ' ');
}

// 문단 앞뒤와 줄바꿈 앞뒤의 빈칸을 떼고, 조각 사이에 겹친 빈칸을 하나로
function trimRuns(runs) {
  let prevSpace = true;
  for (const r of runs) {
    if (r.soft) prevSpace = true;
    if (prevSpace) r.text = r.text.replace(/^ +/, '');
    if (r.text) prevSpace = r.text.endsWith(' ');
  }
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    runs[i].text = runs[i].text.replace(/ +$/, '');
    if (runs[i].text) break;
  }
  for (let i = 1; i < runs.length; i += 1) {
    if (runs[i].soft && runs[i - 1].text) runs[i - 1].text = runs[i - 1].text.replace(/ +$/, '');
  }
}

function transform(t, mode) {
  if (mode === 'uppercase') return t.toUpperCase();
  if (mode === 'lowercase') return t.toLowerCase();
  if (mode === 'capitalize') return t.replace(/(^|\s)(\S)/g, (m, s, c) => s + c.toUpperCase());
  return t;
}

// ::before 의 글 — 짧은 표시가 따로 떠 있으면(절대 자리·띄움) 글머리표로, 아니면 글 앞에 붙는 글로
function pseudoText(win, el, which) {
  const cs = win.getComputedStyle(el, which);
  const m = /^"(.*)"$/s.exec(cs.content || '');
  if (!m || !m[1] || cs.display === 'none') return null;
  const text = m[1].replace(/\\"/g, '"');
  const floated = cs.position === 'absolute' || cs.position === 'fixed' || (cs.float && cs.float !== 'none');
  const cp = text.codePointAt(0);
  const one = [...text.trim()].length === 1 && cp <= 0xffff;
  if (floated && one) return { bullet: true, code: hex4(cp), cs };
  return floated ? null : { bullet: false, text, cs };
}

// 절대 자리에 둔 글자 하나(①·√·※)가 문단 b 의 왼쪽 여백 안에 있으면 {그 글자의 코드, 색} — 배경·테두리·그림이 없는 것만
function markOf(win, e, cs, b) {
  if (rgba(cs.backgroundColor) || hasBorder(cs) || e.querySelector('img, svg, canvas, video, picture, iframe, object, embed')) return null;
  const t = [...e.textContent.trim()];
  if (t.length !== 1 || t[0].codePointAt(0) > 0xffff) return null;
  const r = e.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const bcs = win.getComputedStyle(b);
  if (r.left < br.left - 1 || r.right > br.left + px(bcs.borderLeftWidth) + px(bcs.paddingLeft) + 1) return null;
  return { code: hex4(t[0].codePointAt(0)), color: rgba(cs.color) };
}

// 가로 flex 줄·inline-grid 의 칸 — 계산된 display 는 block 이어도 줄 안의 글로 다룬다(‘<kbd>←</kbd><kbd>→</kbd> 넘기기’).
// 세로 flex(column)·grid 의 칸은 문단으로 둔다.
function inlineItem(win, e) {
  const p = e.parentElement;
  if (!p) return false;
  const pcs = win.getComputedStyle(p);
  if (pcs.display === 'inline-grid') return true;
  return /^(inline-)?flex$/.test(pcs.display) && !/column/.test(pcs.flexDirection);
}

// 줄을 바꾸지 않는 글(white-space: nowrap)이 줄 안 요소(코드 칩)에서 왔는가 — 문단·표 칸 전체에 건 것이면 아니다(그 글은
// PowerPoint 가 빈칸에서 꺾게 둔다 — 대신 쓴 글꼴이 넓어 꺾일 수밖에 없을 때 낱말 가운데서 꺾지 않게)
function chipNowrap(win, el) {
  let top = el;
  for (let e = el.parentElement; e && win.getComputedStyle(e).whiteSpace === 'nowrap'; e = e.parentElement) top = e;
  return !BLOCK.has(win.getComputedStyle(top).display);
}

// ▶·◀ 를 따로 떼어 기호 글꼴의 글 조각으로 — 글 조각 목록 [{text, options}] → 새 목록(줄바꿈은 처음·마지막 조각에만)
function symbolRuns(runs) {
  const out = [];
  for (const r of runs) {
    const parts = typeof r.text === 'string' ? r.text.split(SYMBOL_SPLIT).filter(Boolean) : [];
    if (!parts.some((t) => SYMBOL_SPLIT.test(t))) {
      out.push(r);
      continue;
    }
    parts.forEach((t, i) => {
      const o = { ...r.options };
      if (i > 0) {
        delete o.softBreakBefore;
        if (o.lang) o.lang = o.lang.replace(/-x-bu[0-9A-F]{6}$/, '');
      }
      if (i < parts.length - 1) delete o.breakLine;
      if (SYMBOL_SPLIT.test(t)) o.fontFace = SYMBOL_FACE;
      out.push({ text: t, options: o });
    });
  }
  return out;
}

// 덱 글꼴을 깔지 않은 PC 의 PowerPoint 가 대신 쓸 글꼴 — 글꼴 목록의 일반 이름으로(없으면 맑은 고딕)
function substitute(list) {
  for (const raw of String(list || '').split(',').reverse()) {
    const g = raw.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
    if (GENERIC[g] && g !== 'emoji' && g !== 'math') return GENERIC[g];
  }
  return GENERIC['sans-serif'];
}

// 글 줄 한쪽의 바깥 여백·안쪽 여백·테두리(px)
function side(cs, s) {
  return px(cs[`margin${s}`]) + px(cs[`padding${s}`]) + px(cs[`border${s}Width`]);
}

// 번호 목록 항목의 번호 — value 속성, 아니면 목록의 시작 번호 + 앞선 항목 수
function startOf(li, ol) {
  const v = parseInt(li.getAttribute('value'), 10);
  if (Number.isFinite(v)) return Math.max(1, v);
  let n = ol && Number.isFinite(ol.start) ? ol.start : 1;
  for (let s = li.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === 'li') n += 1;
  return Math.max(1, n);
}

// 위·아래첨자 — <sup>·<sub>, vertical-align 의 super·sub, 또는 글자를 줄이고 수치로 올리거나 내린 글
function shiftOf(win, e, cs) {
  if (e.localName === 'sup' || cs.verticalAlign === 'super') return 'super';
  if (e.localName === 'sub' || cs.verticalAlign === 'sub') return 'sub';
  const v = parseFloat(cs.verticalAlign);
  const p = e.parentElement;
  if (!v || !p || px(cs.fontSize) > px(win.getComputedStyle(p).fontSize) * 0.95) return '';
  return v > 0 ? 'super' : 'sub';
}

// 요소에 바로 든 글이 있나
function directText(e) {
  for (const n of e.childNodes) if (n.nodeType === 3 && /\S/.test(n.data)) return true;
  return false;
}

// 테두리가 모두 가는가(1.5px 까지)
function thinBorder(cs) {
  return ['Top', 'Right', 'Bottom', 'Left'].every((s) => /none|hidden/.test(cs[`border${s}Style`]) || px(cs[`border${s}Width`]) <= 1.5);
}

function hasBorder(cs) {
  return ['Top', 'Right', 'Bottom', 'Left'].some((s) => {
    const st = cs[`border${s}Style`];
    return st !== 'none' && st !== 'hidden' && px(cs[`border${s}Width`]) > 0.2 && rgba(cs[`border${s}Color`]);
  });
}

// host 안에서 따로 옮기는 것(그림·도표·표) 또는 그 안에 든 것
function embedded(d, host) {
  for (let e = d; e && e !== host; e = e.parentElement) if (EMBED.has(e.localName)) return true;
  return false;
}

// host 안의 따로 옮기는 것 가운데 가장 바깥 것만(도표 안의 그림, 표 안의 표는 그 바깥 것이 맡는다)
function outerEmbed(d, host) {
  for (let e = d.parentElement; e && e !== host; e = e.parentElement) if (EMBED.has(e.localName)) return false;
  return true;
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 꾸밈 상자 하나를 그림으로(돌린 꺾쇠 등) — 배경과 변마다의 테두리·둥근 모서리를 계산된 값 그대로, w×h(px)를 W×H 로
function boxSvg(cs, w, h, W, H) {
  const props = ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
  for (const s of ['top', 'right', 'bottom', 'left']) props.push(`border-${s}-width`, `border-${s}-style`, `border-${s}-color`);
  const css = props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
  const div = `<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${w}px;height:${h}px;${escAttr(css)}"></div>`;
  return `<svg xmlns="${SVGNS}" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">`
    + `<foreignObject x="0" y="0" width="${w}" height="${h}">${div}</foreignObject></svg>`;
}

function hexCss(h) {
  const x = h.length <= 5 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1);
  const n = (i) => parseInt(x.slice(i, i + 2), 16);
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${x.length >= 8 ? n(6) / 255 : 1})`;
}

// 그림 요소를 캔버스에 그려 PNG 로 — 다른 출처라 읽지 못하면 null
function canvasOf(img, W, H) {
  const s = Math.min(1, MAX_PX / Math.max(W, H, 1));
  const w = Math.max(1, Math.round(W * s));
  const h = Math.max(1, Math.round(H * s));
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png').slice(5);
  } catch (e) {
    return null;
  }
}

// SVG 글 → PNG('image/png;base64,…'). 못 그리면 null.
function raster(svg, W, H) {
  const s = Math.min(1, MAX_PX / Math.max(W, H, 1));
  const w = Math.max(1, Math.round(W * s));
  const h = Math.max(1, Math.round(H * s));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png').slice(5));
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// 만든 파일 안의 같은 그림 → Map(지울 이름 → 남길 이름, ppt/media/ 아래 이름) — 확장자와 내용(SHA-256)이 같은 것. 해시를
// 쓸 수 없는 곳(안전한 출처가 아님)이면 합치지 않는다.
async function sameMedia(zip) {
  const same = new Map();
  if (!(globalThis.crypto && globalThis.crypto.subtle)) return same;
  const first = new Map();
  for (const name of Object.keys(zip.files)) {
    const m = /^ppt\/media\/([^/]+)$/.exec(name);
    if (!m || zip.files[name].dir) continue;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await zip.file(name).async('uint8array')));
    const key = `${m[1].split('.').pop()}:${Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    if (first.has(key)) same.set(m[1], first.get(key));
    else first.set(key, m[1]);
  }
  return same;
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// 발표자 노트 → 글(HTML 노트는 글만)
function notesText(model, slide) {
  let t = String(model.notesOf(slide) || '');
  if (!t.trim()) return '';
  if (model.notesHtml) {
    const d = new DOMParser().parseFromString(`<body>${t}</body>`, 'text/html');
    for (const br of d.querySelectorAll('br')) br.replaceWith('\n');
    for (const p of d.querySelectorAll('p, div, li')) p.append('\n');
    t = d.body.textContent;
  }
  return t.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
