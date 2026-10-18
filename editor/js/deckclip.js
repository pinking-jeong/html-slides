/* 생성물 — 고치지 마세요. 덱 공통 클립보드(deckclip.js)의 ES 모듈 사본입니다. 빌더 덱 안의 편집기·편집 모드와 같은
   원본을 쓰므로, 고칠 것은 원본에서 고치고 sync_deckclip.py 로 다시 만듭니다. */
/* deckclip — 덱 편집기 공통 클립보드(복사·잘라내기·붙여 넣기). 원본은 이 파일 하나다.
   편집기 B(빌더 덱에 든 편집기, _deck_edit/editor/)·A(html-slides editor/js/deckclip.js — sync_deckclip.py 가 만든 사본)·
   C(편집 모드 edit_module.html)가 똑같이 싣는다. 덱 구조는 모른다 — 편집기가 넘기는 요소·무대 크기·고유 꼴(native)만 다룬다.

   복사 한 번에 시스템 클립보드(복사 이벤트의 clipboardData — 권한을 묻지 않고 iframe·아티팩트 안에서도 된다)에 셋을 쓴다.
   · text/plain — 글만.
   · text/html — 다른 프로그램이 받는 꼴. <html><body> 로 감싼 문서여야 PowerPoint 가 글자 크기를 그대로 받는다(조각만 주면
     px 를 버리고 18pt 로 맞춘다 — 2026-10-17 실험, Word·한글은 둘 다 그대로). 서식은 px 인라인, 그림은 PNG·JPEG data URI
     (SVG data URI 는 PowerPoint 가 못 그린다), 차트·선은 PNG 로 뽑아서, 표는 칸 너비를 적어서(한글이 너비 없는 표를 접는다).
     맨 앞 주석에 덱 페이로드(base64) — 사용자 지정 형식을 못 옮기는 브라우저 사이에서도 덱끼리는 편집 가능한 꼴로 넘어간다.
   · application/x-deckclip+json — 덱 페이로드. 같은 브라우저라면 출처가 달라도(다른 아티팩트·다른 사이트) 읽힌다.
   붙여 넣을 때는 페이로드 → HTML 주석 순서로 찾는다. 페이로드는 바깥에서 온 자료라 꼴만 확인해 넘기고, 넣기 전에 편집기마다
   자기 허용 목록으로 거른다(clean() 은 그런 거르기가 없는 편집기를 위한 것).

   페이로드 v2: {app:"deckclip", v:2, id, src:{editor, title, session}, stage:{w,h}, items:[{type, x, y, w, h, html, text, name,
   alt?, src?, png?, office?, rot?, flip?, line?, look?, native?:{fmt, html}}], blobs:{b0:"data:…"}, text, t}
   · type: text(글상자) · image(그림) · table(표) · graphic(차트·선·도형 — SVG) · box(섞인 것)
   · html: 덱과 상관없이 혼자 서는 꼴(계산된 서식을 인라인으로, 클래스 없음) · native: 같은 계열 편집기가 그대로 쓰는 꼴
   · png: graphic·box 를 그림으로 뽑은 것(다른 프로그램용) · office: image 가 PNG·JPEG·GIF 가 아닐 때 PNG 로 바꾼 것
   · rot·flip: 돌림(시계 방향 도)·대칭("h" 좌우·"v" 상하·"hv") — 이때 x·y·w·h 는 돌리기 전 상자(가운데를 축으로 돈다 —
     PowerPoint 와 같다). html·png 는 돌리지 않은 꼴이고, 받는 편집기가 자기 요소에 다시 입힌다(모르는 편집기는 건너뛴다).
   · line: 덱 편집기가 그린 선·화살표 {x1, y1, x2, y2(돌리기 전 상자 안 px), w, color, dash, arrow} — 다른 프로그램에 선 도형으로
   · look: 돌림·대칭을 구운 그림(다른 프로그램용 — 그림은 돌림 값을 실어 보낼 길이가 없다), 크기는 둘레 상자
   · 큰 data URI 는 blobs 에 한 번만 두고 문자열 안에서는 "deckclip:b0" 처럼 가리킨다. */

var DeckClip = (function () {
  "use strict";

  const MIME = "application/x-deckclip+json";
  const V = 2;
  const MARK = "deckclip:v2:";
  const MARK_RE = /<!--deckclip:v2:([A-Za-z0-9+/=]+)-->/;
  const REF_RE = /deckclip:(b\d{1,4})/g;
  const BLOB_RE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
  const INLINE_DATA = /data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}/g;
  const OFFICE_OK = /^data:image\/(?:png|jpeg|gif)[;,]/i;
  const BLOB_FIELDS = ["html", "src", "png", "office", "look"];   // 큰 data URI 를 blobs 로 빼 두는 칸
  const TYPES = new Set(["text", "image", "table", "graphic", "box"]);
  const LABEL = { text: "글상자", image: "그림", table: "표", graphic: "도형", box: "요소" };
  const MAX_ITEMS = 200;
  const MAX_STR = 20e6;          // 문자열 하나의 상한(글자)
  const MAX_TOTAL = 60e6;        // 페이로드 전체 상한
  const BLOB_MIN = 512;          // 이보다 짧은 data URI 는 제자리에 둔다
  const RASTER = 2;              // 차트·도형을 PNG 로 뽑는 배율
  const RASTER_EDGE = 4096;      // 뽑는 그림의 긴 변 상한(픽셀)
  const OFFSET = 16;             // 같은 자리에 이미 있으면 비켜 놓는 거리(무대 px)
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const SIDES = ["top", "right", "bottom", "left"];
  const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const SESSION = rid(12);
  const CACHE_MAX = 64;          // 그림 주소·바꾼 그림 기억은 이만큼만(오래된 것부터 버린다)
  const cache = new WeakMap();   // 요소 → {sig, png} — warm() 이 채우고 capture() 가 쓴다
  const urlData = new Map();     // 그림 주소 → data URI (warm() 이 받아 둔다)
  const conv = new Map();        // PNG·JPEG·GIF 가 아닌 그림 → PNG data URI(다른 프로그램용)

  function cacheSet(map, k, v) {
    map.delete(k);
    map.set(k, v);
    while (map.size > CACHE_MAX) map.delete(map.keys().next().value);
  }

  function rid(n) {
    const a = new Uint8Array(n);
    window.crypto.getRandomValues(a);
    return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  }

  function hash(s) {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
    return x.toString(36) + "." + s.length.toString(36);
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const isSvg = (n) => n.namespaceURI === SVG_NS;

  /* ── base64(UTF-8) ─────────────────────────────────────────────── */
  function b64(s) {
    const u = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function unb64(s) {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(u);
  }

  /* ── 계산된 서식을 인라인으로 — 상속되는 글 속성은 부모와 다를 때만, 나머지는 기본값이 아닐 때만 ─────────── */
  const INHERITED = ["color", "font-family", "font-size", "font-style", "font-weight", "font-variant-numeric", "letter-spacing",
    "line-height", "text-align", "text-transform", "white-space", "word-break", "overflow-wrap", "word-spacing", "list-style-type",
    "border-collapse", "text-indent", "line-break"];
  const FLEX = ["flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "row-gap", "column-gap"];
  const MISC = { "background-color": "rgba(0, 0, 0, 0)", opacity: "1", "vertical-align": "baseline", "text-decoration-line": "none",
    "table-layout": "auto", "object-fit": "fill", "box-sizing": "content-box", "font-feature-settings": "normal" };
  const SVG_PROPS = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
    "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "font-family", "font-size", "font-weight",
    "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "paint-order", "visibility"];
  const INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "s", "sub", "sup", "a", "small", "mark", "code", "font",
    "label", "abbr", "br", "img"]);
  const TABLE_DISPLAY = { table: "table", tr: "table-row", td: "table-cell", th: "table-cell", thead: "table-header-group",
    tbody: "table-row-group", tfoot: "table-footer-group", col: "table-column", colgroup: "table-column-group",
    caption: "table-caption", li: "list-item" };
  const BAD_VALUE = /url\s*\(|gradient\s*\(|image(?:-set)?\s*\(|element\s*\(|expression|javascript:|[\\<@]/i;

  function defaultDisplay(tag) { return TABLE_DISPLAY[tag] || (INLINE_TAGS.has(tag) ? "inline" : "block"); }

  function sides(cs, pre, post) {
    const v = SIDES.map((s) => cs.getPropertyValue(pre + s + post));
    return v.every((x) => x === v[0]) ? v[0] : v.join(" ");
  }

  function borderDecl(cs) {
    const one = (s) => {
      const st = cs.getPropertyValue("border-" + s + "-style");
      return st === "none" || st === "hidden" ? "" : cs.getPropertyValue("border-" + s + "-width") + " " + st + " " +
        cs.getPropertyValue("border-" + s + "-color");
    };
    const all = SIDES.map(one);
    if (all.every((x) => !x)) return "";
    if (all.every((x) => x === all[0])) return "border:" + all[0] + ";";
    return SIDES.map((s, i) => "border-" + s + ":" + (all[i] || "none") + ";").join("");
  }

  function radiusDecl(cs) {
    const v = CORNERS.map((c) => cs.getPropertyValue("border-" + c + "-radius"));
    if (v.every((x) => x === "0px")) return "";
    return "border-radius:" + (v.every((x) => x === v[0]) ? v[0] : v.join(" ")) + ";";
  }

  function htmlStyle(o, parentCs, root) {
    const win = o.ownerDocument.defaultView;
    const cs = win.getComputedStyle(o);
    const tag = o.localName;
    let s = "";
    const put = (p, v) => { if (v && !BAD_VALUE.test(v)) s += p + ":" + v + ";"; };
    for (const p of INHERITED) {
      const v = cs.getPropertyValue(p);
      if (root || !parentCs || parentCs.getPropertyValue(p) !== v) put(p, v);
    }
    const disp = cs.getPropertyValue("display");
    if (disp !== defaultDisplay(tag) || root) put("display", disp);
    if (/flex|grid/.test(disp)) for (const p of FLEX) put(p, cs.getPropertyValue(p));
    for (const [p, init] of Object.entries(MISC)) {
      const v = cs.getPropertyValue(p);
      if (v !== init) put(p, v);
    }
    const inline = disp === "inline";
    const mg = sides(cs, "margin-", ""), pd = sides(cs, "padding-", "");
    if (!root && (!inline || mg !== "0px")) put("margin", mg);
    if (!inline || pd !== "0px") put("padding", pd);
    s += borderDecl(cs) + radiusDecl(cs);
    if (/^(table|td|th|col)$/.test(tag) || tag === "img") put("width", cs.getPropertyValue("width"));
    if (tag === "img" || tag === "tr") put("height", cs.getPropertyValue("height"));
    return { s, cs };
  }

  function svgStyle(o, parentCs, root) {
    const cs = o.ownerDocument.defaultView.getComputedStyle(o);
    let s = "";
    for (const p of SVG_PROPS) {
      const v = cs.getPropertyValue(p);
      if (!v || (!root && parentCs && parentCs.getPropertyValue(p) === v)) continue;
      if (/url\s*\(/i.test(v) && !/^url\(\s*["']?#[\w-]+["']?\s*\)$/.test(v)) continue;   // 안쪽 그라디언트·화살표만
      s += p + ":" + v + ";";
    }
    const op = cs.getPropertyValue("opacity");
    if (op && op !== "1") s += "opacity:" + op + ";";
    if (cs.getPropertyValue("display") === "none") s += "display:none;";
    return { s, cs };
  }

  /* ── 그림 주소: data URI 면 그대로, 받아 둔 것이 있으면 그것, 아니면 절대 주소 ─────────────────────── */
  function srcOf(el) {
    if (el.localName === "canvas") { try { return el.toDataURL("image/png"); } catch (e) { return ""; } }   // 다른 출처가 섞이면 못 읽는다
    const im = el.localName === "img" ? el : el.querySelector("img");
    if (!im) return "";
    const s = im.getAttribute("src") || "";
    if (/^data:/i.test(s)) return s;
    const abs = im.currentSrc || im.src || s;
    return urlData.get(abs) || abs;
  }

  const DROP_LIVE = new Set(["script", "style", "template", "iframe", "object", "embed", "video", "audio", "input", "button",
    "textarea", "select", "foreignobject", "noscript", "link", "meta"]);
  const KEEP_HTML_ATTR = new Set(["colspan", "rowspan"]);

  function liveAttrs(c, tag, svg) {
    for (const a of Array.from(c.attributes)) {
      const n = a.name.toLowerCase();
      if (n === "style" || n.startsWith("on")) { c.removeAttribute(a.name); continue; }
      if (svg) { if (n === "class" || n.startsWith("data-") || n === "tabindex" || n === "contenteditable") c.removeAttribute(a.name); continue; }
      if (KEEP_HTML_ATTR.has(n) || (tag === "img" && (n === "alt" || n === "src"))) continue;
      c.removeAttribute(a.name);
    }
  }

  function canvasImg(o, c, doc) {
    let u = "";
    try { u = o.toDataURL("image/png"); } catch (e) { u = ""; }       // 다른 출처 그림이 섞인 캔버스는 못 읽는다
    const im = doc.createElement("img");
    if (u) im.setAttribute("src", u);
    c.replaceWith(im);
    return im;
  }

  // 원본 o 와 깊은 복제 c 를 함께 내려가며 서식을 인라인으로. 살아 있는 꼴(스크립트·입력 칸 등)은 뺀다.
  function inlineTree(o, c, parentCs, root) {
    const tag = o.localName;
    if (o.localName === "canvas") c = canvasImg(o, c, c.ownerDocument);
    const svg = isSvg(o);
    liveAttrs(c, c.localName, svg);
    const st = svg ? svgStyle(o, parentCs, root) : htmlStyle(o, parentCs, root);
    if (st.s) c.setAttribute("style", st.s);
    if (tag === "img" || tag === "canvas") {                       // 크기는 계산값(무대 px — 무대를 줄여 보여도 그대로)
      if (tag === "img") c.setAttribute("src", srcOf(o));
      c.setAttribute("width", String(Math.round(parseFloat(st.cs.getPropertyValue("width")) || 0)));
      c.setAttribute("height", String(Math.round(parseFloat(st.cs.getPropertyValue("height")) || 0)));
    }
    if (/^(table|td|th|col)$/.test(tag)) {
      const w = Math.round(parseFloat(st.cs.getPropertyValue("width")) || 0);
      if (w) c.setAttribute("width", String(w));
    }
    if (svg && tag === "svg" && !root && !(o.parentNode && isSvg(o.parentNode))) {   // HTML 안의 SVG — CSS 로 준 크기를 적는다
      const w = r2(parseFloat(st.cs.getPropertyValue("width")) || 0), h = r2(parseFloat(st.cs.getPropertyValue("height")) || 0);
      if (w && h) {
        c.setAttribute("width", String(w));
        c.setAttribute("height", String(h));
        c.setAttribute("style", (c.getAttribute("style") || "") + "width:" + w + "px;height:" + h + "px;");
      }
    }
    if (tag === "canvas") return;
    const oc = Array.from(o.children), cc = Array.from(c.children);
    for (let i = 0; i < oc.length && i < cc.length; i++) {
      const t = oc[i].localName.toLowerCase();
      if (DROP_LIVE.has(t)) { cc[i].remove(); continue; }
      if (t === "use" || (svg && t === "image" && !/^data:image\//i.test(oc[i].getAttribute("href") || ""))) { cc[i].remove(); continue; }
      inlineTree(oc[i], cc[i], st.cs, false);
    }
  }

  // 혼자 서는 꼴의 복제 — 뿌리에는 자리(left·top)를 적지 않고, 크기는 테두리까지 든 무대 px 로(box-sizing:border-box).
  // 잠깐 부모에 넣어 둔다 — 뿌리가 캔버스면 그림으로 바꿔 끼워야 하는데, 부모가 없으면 바꿔 끼우기가 아무것도 안 한다.
  function portableClone(el, b, clean) {
    const holder = el.ownerDocument.createElement("div");
    holder.appendChild(el.cloneNode(true));
    if (typeof clean === "function") clean(holder.firstElementChild);   // 편집 표시 떼기 — 요소를 빼거나 순서를 바꾸면 안 된다
    inlineTree(el, holder.firstElementChild, null, true);
    const c = holder.firstElementChild;
    c.remove();
    if (isSvg(c)) {
      c.setAttribute("xmlns", SVG_NS);
      c.setAttribute("width", String(r2(b.w)));
      c.setAttribute("height", String(r2(b.h)));
    }
    const s = (c.getAttribute("style") || "").replace(/(^|;)\s*(box-sizing|width|height)\s*:[^;]*/gi, "$1");
    c.setAttribute("style", s.replace(/;{2,}/g, ";").replace(/^;/, "") + "box-sizing:border-box;width:" + r2(b.w) + "px;height:" +
      r2(b.h) + "px;");
    return c;
  }

  /* ── 요소 하나 → 항목 ───────────────────────────────────────────── */
  function guessType(el) {
    const tag = el.localName;
    if (tag === "img" || tag === "canvas") return "image";
    if (tag === "svg") return "graphic";
    if (tag === "table") return "table";
    if (/^(canvas|video|iframe|object|embed)$/.test(tag)) return "box";
    const kids = el.querySelectorAll("img, svg, canvas, video, table, iframe");
    if (!kids.length) return (el.textContent || "").trim() ? "text" : "box";
    const own = (el.textContent || "").trim();
    if (kids.length === 1 && kids[0].localName === "table" && own === (kids[0].textContent || "").trim()) return "table";
    if (kids.length === 1 && kids[0].localName === "img" && !own) return "image";
    if (kids.length === 1 && kids[0].localName === "svg" && own === (kids[0].textContent || "").trim()) return "graphic";
    return "box";
  }

  function textOf(el, type) {
    if (type === "image") return "";
    if (type === "table") {
      const t = el.localName === "table" ? el : el.querySelector("table");
      return t ? Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => c.textContent.replace(/\s+/g, " ").trim()).join("\t")).join("\n") : "";
    }
    if (type === "graphic") return "";
    const s = typeof el.innerText === "string" ? el.innerText : el.textContent || "";
    return s.replace(/ /g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{2,}/g, "\n").trim();   // 문단마다 한 줄
  }

  function frameOf(o) {
    const r = o.stage.getBoundingClientRect();
    return { left: r.left, top: r.top, k: o.stageW / (r.width || o.stageW) || 1 };
  }

  function boxIn(el, f) {
    const e = el.getBoundingClientRect();
    return { x: (e.left - f.left) * f.k, y: (e.top - f.top) * f.k, w: e.width * f.k, h: e.height * f.k };
  }

  /* ── 돌림·대칭 — 편집기 셋은 CSS 개별 속성(rotate·scale)으로 적는다. 손으로 쓴 덱의 transform 도 읽는다 ─────────── */
  const ROT_MIN = 0.05;                                   // 이보다 작은 각(도)은 돌리지 않은 것으로
  const ANGLE_K = { deg: 1, rad: 180 / Math.PI, turn: 360, grad: 0.9 };
  const LINE_NAME = /^deckops:(line|arrow)$/;             // 덱 편집기(deckops)가 그린 선·화살표

  function degOf(v) {
    const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)(deg|rad|turn|grad)$/i.exec(String(v || "").trim());
    return m ? parseFloat(m[1]) * ANGLE_K[m[2].toLowerCase()] : 0;
  }

  // CSS rotate 계산값 → 도. 화면에 수직인 축(z)으로 도는 것만 — "30deg"·"z 30deg"·"0 0 1 30deg"
  function rotateOf(v) {
    const t = String(v || "").trim().split(/\s+/);
    if (t.length === 1) return degOf(t[0]);
    if (t.length === 2 && t[0] === "z") return degOf(t[1]);
    const z = +t[2];
    if (t.length === 4 && +t[0] === 0 && +t[1] === 0 && Number.isFinite(z) && z !== 0) return degOf(t[3]) * Math.sign(z);
    return 0;
  }

  const normDeg = (d) => { const x = ((d % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

  // 돌림·대칭 {rot: 시계 방향 도(-180, 180], fh·fv: 제자리에서 먼저 뒤집음, kx·ky: 크기 배율}. CSS 도 PowerPoint 도 뒤집은
  // 다음 돌린다(rotate·scale 의 순서). transform 은 행렬을 돌림 + 좌우 뒤집기로 나눠 보탠다(기울임은 버린다).
  function turnOf(el) {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    let rot = rotateOf(cs.getPropertyValue("rotate")), fh = false, fv = false, kx = 1, ky = 1;
    const sc = String(cs.getPropertyValue("scale") || "").trim();
    if (sc && sc !== "none") {
      const v = sc.split(/\s+/).map(Number), sx = Number.isFinite(v[0]) ? v[0] : 1;
      const sy = v.length > 1 && Number.isFinite(v[1]) ? v[1] : sx;
      fh = sx < 0;
      fv = sy < 0;
      kx = Math.abs(sx) || 1;
      ky = Math.abs(sy) || 1;
    }
    const tf = String(cs.getPropertyValue("transform") || "").trim();
    if (tf && tf !== "none" && typeof DOMMatrixReadOnly === "function") {
      try {
        const m = new DOMMatrixReadOnly(tf), det = m.a * m.d - m.b * m.c, s = Math.hypot(m.a, m.b);
        if (Math.abs(det) > 1e-9 && s > 1e-9) {
          const neg = det < 0, t = Math.atan2(neg ? -m.b : m.b, neg ? -m.a : m.a) * 180 / Math.PI;
          rot += fh !== fv ? -t : t;                    // 한 축만 뒤집혀 있으면 안쪽 돌림이 거꾸로 보인다
          if (neg) fh = !fh;
          kx *= s;
          ky *= Math.abs(det) / s;
        }
      } catch (e) { /* 읽지 못하는 변형은 돌리지 않은 것으로 */ }
    }
    const r = normDeg(rot);
    return { rot: Math.abs(r) < ROT_MIN ? 0 : r2(r), fh, fv, kx, ky };
  }

  const turned = (tn) => !!(tn && (tn.rot || tn.fh || tn.fv));

  // 편집기가 돌림을 요소 바깥(감싼 상자)에 두면 opts.turn(el) → {rot, fh, fv} 로 알려 준다(편집기 C). 없으면 요소에서 읽는다
  function turnFor(el, o) {
    const t = typeof o.turn === "function" ? o.turn(el) : null;
    if (!t || typeof t !== "object") return turnOf(el);
    const r = normDeg(Number(t.rot) || 0);
    return { rot: Math.abs(r) < ROT_MIN ? 0 : r2(r), fh: !!t.fh, fv: !!t.fv, kx: 1, ky: 1 };
  }

  // 돌리거나 뒤집은 요소의 상자 = 돌리기 전 상자. 화면 둘레 상자의 가운데(가운데를 축으로 도니 그대로다)에 레이아웃 크기
  // (변형과 상관없는 무대 px)를 놓는다. transform-origin 을 옮긴 요소는 조금 어긋날 수 있다.
  function turnedBox(el, f, tn) {
    const e = el.getBoundingClientRect();
    const cx = (e.left + e.width / 2 - f.left) * f.k, cy = (e.top + e.height / 2 - f.top) * f.k;
    let w = el.offsetWidth, h = el.offsetHeight;
    if (!(w > 0 && h > 0)) {                                       // SVG 처럼 offset 이 없는 요소
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      w = parseFloat(cs.width) || 0;
      h = parseFloat(cs.height) || 0;
    }
    w *= tn.kx;
    h *= tn.ky;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function boxFor(el, o, f, tn) {
    return (o.box && o.box(el)) || (turned(tn) ? turnedBox(el, f, tn) : boxIn(el, f));
  }

  // 덱 편집기(deckops)가 그린 선·화살표 → {x1, y1, x2, y2, w, color, dash, arrow} — 돌리기 전 상자 안 무대 px. 화살표의
  // 끝은 화살촉 끝(다각형 첫 점). 다른 프로그램에는 선 도형으로 보내고, 받는 덱은 선으로 알아보게 한다.
  function lineOf(el, b) {
    if (el.localName !== "svg" || !LINE_NAME.test(el.getAttribute("data-name") || "")) return null;
    const ln = el.querySelector("line"), hd = el.querySelector("polygon");
    if (!ln) return null;
    const vb = el.viewBox && el.viewBox.baseVal;
    const sx = vb && vb.width > 0 ? b.w / vb.width : 1, sy = vb && vb.height > 0 ? b.h / vb.height : 1;
    const at = (a) => parseFloat(ln.getAttribute(a)) || 0;
    let x2 = at("x2"), y2 = at("y2");
    const tip = hd ? String(hd.getAttribute("points") || "").trim().split(/[\s,]+/).slice(0, 2).map(Number) : [];
    if (tip.length === 2 && tip.every(Number.isFinite)) [x2, y2] = tip;
    const cs = el.ownerDocument.defaultView.getComputedStyle(ln), c = cssColor(cs.getPropertyValue("stroke"));
    const d0 = parseFloat(cs.getPropertyValue("stroke-dasharray"));          // "none" 이면 NaN
    return { x1: r2(at("x1") * sx), y1: r2(at("y1") * sy), x2: r2(x2 * sx), y2: r2(y2 * sy),
      w: r2((parseFloat(cs.getPropertyValue("stroke-width")) || 1) * Math.min(sx, sy)), color: c ? c.hex : "#000000",
      dash: !(d0 > 0) ? "solid" : d0 >= 4 ? "dashed" : "dotted", arrow: !!hd };
  }

  // 미리 뽑아 둔 그림이 아직 맞는지 — 요소 통째(뿌리의 서식·주소까지: 채우기·윤곽선을 바꾸면 다시 뽑는다)·크기·돌림.
  // 자리(left·top)는 그림을 바꾸지 않으니 뺀다 — 옮길 때마다 다시 뽑지 않게
  function sigOf(el, b, tn) {
    const root = el.cloneNode(false);
    if (root.style) { root.style.removeProperty("left"); root.style.removeProperty("top"); }
    return hash(root.outerHTML + el.innerHTML) + "|" + Math.round(b.w) + "x" + Math.round(b.h) +
      (turned(tn) ? "|" + tn.rot + (tn.fh ? "h" : "") + (tn.fv ? "v" : "") : "");
  }

  function itemOf(el, o, f) {
    const type = (o.type && o.type(el)) || guessType(el);
    if (!type || !TYPES.has(type)) return null;
    const tn = turnFor(el, o);
    const b = boxFor(el, o, f, tn);                                 // 테두리까지 든 상자(무대 px) — 돌렸으면 돌리기 전 상자
    if (!(b.w > 0 && b.h > 0)) return null;
    const it = { type, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) };
    if (tn.rot) it.rot = tn.rot;
    if (tn.fh || tn.fv) it.flip = (tn.fh ? "h" : "") + (tn.fv ? "v" : "");
    it.html = portableClone(el, b, o.clean).outerHTML;
    it.text = textOf(el, type);
    if (type === "image") {
      it.src = srcOf(el);
      const im = el.localName === "img" ? el : el.querySelector("img");
      it.alt = (im && im.getAttribute("alt")) || "";
      if (conv.has(it.src)) it.office = conv.get(it.src);
    }
    const c = cache.get(el), fresh = !!c && c.sig === sigOf(el, b, tn);
    if ((type === "graphic" || type === "box") && fresh && c.png) it.png = c.png;
    if (fresh && c.look && turned(tn)) it.look = c.look;
    const ln = type === "graphic" ? lineOf(el, b) : null;
    if (ln) it.line = ln;
    const nat = typeof o.native === "function" ? o.native(el) : null;
    if (nat && typeof nat.html === "string" && typeof nat.fmt === "string") it.native = { fmt: nat.fmt, html: nat.html };
    it.name = ((it.text || it.alt || "").split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 24)) || LABEL[type];
    return it;
  }

  /* opts: {stage, stageW, stageH, editor, title, type?(el), box?(el), native?(el), clean?(clone), turn?(el)} → 페이로드(동기).
     box 는 돌리기 전 상자(무대 px), turn 은 돌림이 요소 바깥에 있을 때 {rot, fh, fv} — warm() 도 같은 opts 를 받는다 */
  function capture(els, opts) {
    const o = Object.assign({}, opts);
    const f = frameOf(o);
    const items = [];
    for (const el of els) {
      const it = itemOf(el, o, f);
      if (it) items.push(it);
    }
    if (!items.length) return null;
    return pack({
      app: "deckclip", v: V, id: rid(10),
      src: { editor: String(o.editor || ""), title: String(o.title || "").slice(0, 200), session: SESSION },
      stage: { w: o.stageW, h: o.stageH }, items,
      text: items.map((i) => i.text).filter(Boolean).join("\n\n"), t: Date.now(),
    });
  }

  function pack(p) {
    const blobs = {}, rev = new Map();
    let n = 0;
    const sub = (s) => (typeof s !== "string" ? s : s.replace(INLINE_DATA, (u) => {
      if (u.length < BLOB_MIN) return u;
      let k = rev.get(u);
      if (!k) { k = "b" + n++; rev.set(u, k); blobs[k] = u; }
      return "deckclip:" + k;
    }));
    p.items = p.items.map((it) => {
      const o = copyItem(it);
      for (const f of BLOB_FIELDS) if (o[f]) o[f] = sub(o[f]);
      if (o.native) o.native = { fmt: o.native.fmt, html: sub(o.native.html) };
      return o;
    });
    p.blobs = blobs;
    return p;
  }

  /* ── 미리 준비(비동기): 차트·도형은 PNG 로, PNG·JPEG·GIF 가 아닌 그림은 PNG 로, 주소로 든 그림은 data URI 로 ───────── */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("그림을 열지 못했습니다"));
      im.src = src;
    });
  }

  function toPng(im, w, h, scale) {
    const k = Math.min(scale, RASTER_EDGE / Math.max(w, h, 1));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * k));
    cv.height = Math.max(1, Math.round(h * k));
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  }

  // 돌린 상자를 덮는 똑바른 상자의 크기
  function hull(w, h, rot) {
    const a = (rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return { w: w * c + h * s, h: w * s + h * c };
  }

  // 돌린 항목이 실제로 차지하는 똑바른 상자(b = 돌리기 전 상자, 가운데는 같다) — 무대·슬라이드 안으로 들일 때 이것으로 잰다
  function hullBox(b, rot) {
    if (!rot) return b;
    const s = hull(b.w, b.h, rot);
    return { x: b.x + (b.w - s.w) / 2, y: b.y + (b.h - s.h) / 2, w: s.w, h: s.h };
  }

  // 묶음(lo~hi)을 옮길 거리 — 바라는 만큼(want) 옮기되 끝(lim)을 넘으면 당기고, 0 앞으로 나가면 민다(둘 다면 0 쪽이 이긴다)
  function shiftInto(lo, hi, want, lim) {
    const d = hi + want > lim ? lim - hi : want;
    return lo + d < 0 ? -lo : d;
  }

  const span = (bs) => ({
    x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)),
    x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)),
  });

  // 그림을 상자(w×h)에 object-fit 대로 담은 크기
  function fitSize(im, w, h, fit) {
    const nw = im.naturalWidth || im.width || w, nh = im.naturalHeight || im.height || h;
    if (fit === "none") return { w: nw, h: nh };
    if (!/^(contain|cover|scale-down)$/.test(fit)) return { w, h };            // fill
    const q = fit === "cover" ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
    const k = fit === "scale-down" ? Math.min(1, q) : q;
    return { w: nw * k, h: nh * k };
  }

  // 돌림·대칭을 구운 그림(다른 프로그램용 — 그림은 돌림 값을 실어 보낼 길이가 없다). 크기는 둘레 상자, 바깥은 투명.
  // 캔버스도 뒤집은 다음 돌린다(CSS 와 같은 순서).
  function bake(im, w, h, tn, scale, fit) {
    const H = hull(w, h, tn.rot), k = Math.min(scale, RASTER_EDGE / Math.max(H.w, H.h, 1));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(H.w * k));
    cv.height = Math.max(1, Math.round(H.h * k));
    const g = cv.getContext("2d"), d = fitSize(im, w, h, fit);
    g.translate(cv.width / 2, cv.height / 2);
    g.rotate(tn.rot * Math.PI / 180);
    g.scale(tn.fh ? -1 : 1, tn.fv ? -1 : 1);
    if (d.w > w + 0.5 || d.h > h + 0.5) {                                     // cover·none — 상자 밖은 잘라 낸다
      g.beginPath();
      g.rect(-w * k / 2, -h * k / 2, w * k, h * k);
      g.clip();
    }
    g.drawImage(im, -d.w * k / 2, -d.h * k / 2, d.w * k, d.h * k);
    return cv.toDataURL("image/png");
  }

  function blobData(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error || new Error("읽지 못했습니다"));
      fr.readAsDataURL(blob);
    });
  }

  async function fetchData(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const b = await r.blob();
    if (!/^image\//.test(b.type)) throw new Error("그림이 아닙니다");
    return blobData(b);
  }

  async function convert(src) {
    if (!src || OFFICE_OK.test(src) || conv.has(src) || !/^data:image\//i.test(src)) return;
    const im = await loadImage(src);
    cacheSet(conv, src, toPng(im, im.naturalWidth || 400, im.naturalHeight || 300, 1));
  }

  function rasterSvgText(c, b) {
    if (isSvg(c)) return new XMLSerializer().serializeToString(c);
    const wrap = document.createElementNS(XHTML_NS, "div");
    wrap.setAttribute("style", "position:relative;overflow:hidden;width:" + b.w + "px;height:" + b.h + "px");
    wrap.appendChild(c);
    return '<svg xmlns="' + SVG_NS + '" width="' + b.w + '" height="' + b.h + '"><foreignObject x="0" y="0" width="' + b.w +
      '" height="' + b.h + '">' + new XMLSerializer().serializeToString(wrap) + "</foreignObject></svg>";
  }

  async function rasterize(el, b, clean) {
    const c = portableClone(el, b, clean);
    const im = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(rasterSvgText(c, b)));
    return toPng(im, b.w, b.h, RASTER);
  }

  function imagesIn(el) { return el.localName === "img" ? [el] : Array.from(el.querySelectorAll("img")); }

  async function warmOne(el, o, f) {
    const type = (o.type && o.type(el)) || guessType(el);
    if (!type) return;
    for (const im of imagesIn(el)) {
      const s = im.currentSrc || im.src;
      if (s && !/^data:/i.test(s) && !urlData.has(s)) {
        try { cacheSet(urlData, s, await fetchData(s)); } catch (e) { cacheSet(urlData, s, s); }   // 못 받으면 주소 그대로
      }
    }
    if (type === "image") {
      const src = srcOf(el);
      try { await convert(src); } catch (e) { /* 다른 프로그램에는 원래 그림으로 */ }
      await warmLook(el, o, f, conv.get(src) || src);
      return;
    }
    if (type !== "graphic" && type !== "box") return;
    const tn = turnFor(el, o), b = boxFor(el, o, f, tn);
    if (!(b.w > 0 && b.h > 0)) return;
    const sig = sigOf(el, b, tn), c = cache.get(el);
    if (c && c.sig === sig) return;
    let png = "", look = "";
    try { png = await rasterize(el, b, o.clean); } catch (e) { png = ""; }
    if (png && turned(tn)) { try { look = bake(await loadImage(png), b.w, b.h, tn, RASTER, "fill"); } catch (e) { look = ""; } }
    cache.set(el, { sig, png, look });
  }

  // 돌리거나 뒤집은 그림 — 다른 프로그램용으로 구워 둔다(덱끼리는 원래 그림 + 돌림 값으로 넘긴다)
  async function warmLook(el, o, f, src) {
    const tn = turnFor(el, o);
    if (!turned(tn) || !/^data:image\//i.test(src || "")) return;
    const b = boxFor(el, o, f, tn);
    if (!(b.w > 0 && b.h > 0)) return;
    const sig = sigOf(el, b, tn), c = cache.get(el);
    if (c && c.sig === sig) return;
    const im = await loadImage(src).catch(() => null);
    if (!im) return;
    const one = el.localName === "img" ? el : el.querySelector("img");
    const fit = one ? el.ownerDocument.defaultView.getComputedStyle(one).objectFit : "fill";
    const scale = Math.max(1, Math.min(RASTER * 2, (im.naturalWidth || b.w) / b.w));        // 원본 해상도를 되도록 살린다
    let look = "";
    try { look = bake(im, b.w, b.h, tn, scale, fit); } catch (e) { look = ""; }
    cache.set(el, { sig, png: "", look });
  }

  // 고르면 바로 불러 둔다 — 복사(Ctrl+C)는 이벤트 안에서 바로 써야 해서 기다릴 수 없다
  function warm(els, opts) {
    const o = Object.assign({}, opts);
    const f = frameOf(o);
    return Promise.all(Array.from(els, (el) => warmOne(el, o, f).catch(() => null)));
  }

  /* ── 쓰기 ─────────────────────────────────────────────────────── */
  function blobOf(p, s) {
    return typeof s !== "string" ? "" : s.replace(REF_RE, (m, k) => (p.blobs && typeof p.blobs[k] === "string" ? p.blobs[k] : ""));
  }

  function officePic(it) {
    if (it.look) return it.look;                                    // 돌림·대칭을 구운 그림
    if (it.type === "image") return it.office || it.src || "";
    return it.type === "graphic" || it.type === "box" ? it.png || "" : "";
  }

  // 다른 프로그램이 받는 HTML 도 공통 거르기를 지난다 — 보관해 둔 페이로드(가져온 파일 등)를 다시 복사할 때도 있어서
  function safeHtml(h) {
    const d = document.createElement("div");
    d.appendChild(clean(h));
    return d.innerHTML;
  }

  /* PowerPoint 는 HTML 글을 슬라이드 (0,0)에 '세로 가운데·줄 바꿈 끔' 도형으로 만든다 — 여러 줄이면 위가 슬라이드 밖으로
     넘치고 긴 문단은 한 줄로 늘어난다(2026-10-18 실측). 그래서 글 항목은 PowerPoint 만 읽는 VML 모양([if ppt])으로도 싣는다:
     덱 무대를 960pt 너비 슬라이드에 같은 비율로(자리·너비·글자 크기), 줄 바꿈, 덱의 세로 정렬, 바깥 상자의 바탕·고른 테두리·
     둥근 모서리(둥근 사각형·타원). Word·한글·브라우저는 [if ppt] 를 건너뛰고 [if !ppt] 쪽 보통 HTML 을 읽는다
     ([if gte vml 1]·[if gte mso 9] 는 Word 도 읽어 떠 있는 개체가 된다). VML 그림은 data URI 를 못 읽어 그림은 보통 HTML 로.
     여러 항목이면 VML 은 항목 순서(덱의 앞뒤 순서 — 뒤에 쓴 것이 위)대로, 보통 HTML 은 읽는 순서(위→아래·왼→오)대로. */
  const SLIDE_W = 960, SLIDE_H = 540, PX_PT = 0.75;
  const VML_NS = ' xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
  const NOT_TEXT = /<(?:table|img|svg|canvas|video|iframe)\b/i;
  const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
  const commentSafe = (s) => s.replace(/--(!?)>/g, "-&#45;$1>").replace(/<!\[/g, "&lt;![");   // 주석 안에 넣어도 닫히지 않게
  const PLAIN = { inset: "0pt,0pt,0pt,0pt", fill: null, line: null, lineW: 0, dash: "", anchor: "top", rad: { v: 0, pct: false } };
  let colorCtx = null;

  // CSS 색 하나 → {hex, a}(투명·못 읽으면 null). 캔버스에 칠해 읽어 oklch·color()·이름 색도 sRGB 로 받는다.
  function cssColor(c) {
    if (!c || (typeof CSS !== "undefined" && CSS.supports && !CSS.supports("color", c))) return null;
    try {
      if (!colorCtx) {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 1;
        colorCtx = cv.getContext("2d", { willReadFrequently: true });
      }
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = "rgba(0,0,0,0)";                               // 캔버스가 못 읽는 값(var()·inherit)은 무시되므로 투명에서
      colorCtx.fillStyle = c;
      colorCtx.fillRect(0, 0, 1, 1);
      const d = colorCtx.getImageData(0, 0, 1, 1).data;
      if (d[3] < 13) return null;                                         // 거의 투명(5% 아래)은 칠하지 않는다
      return { hex: "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join(""), a: d[3] / 255 };
    } catch (e) { return null; }
  }

  // 덱의 세로 정렬(세로 flex 는 justify-content, 가로 flex 는 align-items) → VML 글 정렬.
  // column-reverse 는 flex-start·normal 이 아래, flex-end 가 위다(start·end 는 쓰기 방향을 따라 뒤집히지 않는다).
  function vAnchor(s) {
    if (!/flex/.test(s.display)) return "top";
    const col = /column/.test(s.flexDirection), v = String((col ? s.justifyContent : s.alignItems) || "").trim();
    if (/center|space-around|space-evenly/.test(v)) return "middle";
    const flip = col && /reverse/.test(s.flexDirection) && !/(^|\s)(start|end)$/.test(v);
    return /end/.test(v) !== flip ? "bottom" : "top";
  }

  // 바깥 상자 꾸밈 → VML 모양 재료: 여백(+테두리)·바탕·고른 테두리·모서리 반지름·세로 정렬.
  function shapeOf(s) {
    const side = ["Top", "Right", "Bottom", "Left"];
    const bw = side.map((d) => parseFloat(s["border" + d + "Width"]) || 0);
    const bs = side.map((d) => s["border" + d + "Style"] || "none"), bc = side.map((d) => s["border" + d + "Color"]);
    const pad = side.map((d, i) => r1(Math.min(72, Math.max(0, ((parseFloat(s["padding" + d]) || 0) + bw[i]) * PX_PT))) + "pt");
    const same = (a) => a.every((v) => v === a[0]);
    const line = bw[0] > 0 && same(bw) && same(bs) && same(bc) && /^(solid|dashed|dotted)$/.test(bs[0]) ? cssColor(bc[0]) : null;
    const rad = String(s.borderTopLeftRadius || "").trim().split(/\s+/)[0];
    return {
      inset: [pad[3], pad[0], pad[1], pad[2]].join(","), fill: cssColor(s.backgroundColor), line, lineW: r1(bw[0] * PX_PT),
      dash: bs[0] === "dashed" ? "dash" : bs[0] === "dotted" ? "dot" : "", anchor: vAnchor(s),
      rad: { v: parseFloat(rad) || 0, pct: /%$/.test(rad) },
    };
  }

  // 모서리 반지름 → VML 모양 이름과 arcsize(짧은 변에 대한 비, 0.5 까지). b = 슬라이드 pt 자리.
  function corner(rad, b) {
    if (rad.pct && rad.v >= 50) return { tag: "oval", arc: 0 };
    const r = rad.pct ? rad.v / 100 * Math.min(b.w, b.h) : rad.v * PX_PT;
    return r > 0.5 ? { tag: "roundrect", arc: r3(Math.min(0.5, r / Math.max(1, Math.min(b.w, b.h)))) } : { tag: "", arc: 0 };
  }

  // 글 항목 하나 → VML 모양 재료(f = 글자 배율). 글도 보이는 꾸밈도 없으면 null — 싣지도, 묶음 자리 잡기에 넣지도 않는다.
  function pptPrep(html, f) {
    const t = document.createElement("template");
    t.innerHTML = html;
    const kids = Array.from(t.content.children);
    kids.forEach((el) => scaleNode(el, f));                                 // PowerPoint 는 px 를 0.75pt 로 읽는다
    const solo = kids.length === 1 &&
      Array.from(t.content.childNodes).every((c) => c === kids[0] || (c.nodeType === 3 && !c.data.trim()));
    const sh = solo ? shapeOf(kids[0].style) : PLAIN;
    if (solo) kids[0].style.padding = "0";                                  // 여백은 글상자 여백(inset)으로 옮겼다
    const text = !!t.content.textContent.trim();
    return text || sh.fill || sh.line ? { sh, text, html: t.innerHTML } : null;
  }

  // VML 모양 하나(b = 슬라이드 pt 자리, n = 몇째 모양). 글에 맞춤은 바탕·테두리가 안 보이는 상자에만 — 색 면·테두리
  // 상자는 덱 크기 그대로 둔다.
  function pptBox(pp, b, n, it) {
    const sh = pp.sh, c = corner(sh.rad, b), tag = c.tag || (pp.text ? "shape" : "rect"), shown = !!(sh.fill || sh.line);
    const head = "<v:" + tag + ' id="_x0000_s' + (1025 + n) + '"' + (tag === "shape" ? ' type="#_x0000_t202"' : "") +
      (tag === "roundrect" ? ' arcsize="' + c.arc + '"' : "") + ' style="position:absolute;left:' + r1(b.x) + "pt;top:" + r1(b.y) +
      "pt;width:" + r1(b.w) + "pt;height:" + r1(b.h) + "pt" + turnStyle(it) + ";v-text-anchor:" + sh.anchor + ';mso-wrap-style:square"' +
      (sh.fill ? ' filled="t" fillcolor="' + sh.fill.hex + '"' : ' filled="f"') +
      (sh.line ? ' stroked="t" strokecolor="' + sh.line.hex + '" strokeweight="' + sh.lineW + 'pt"' : ' stroked="f"') + ">";
    const stroke = sh.line ? (sh.dash ? ' dashstyle="' + sh.dash + '"' : "") +
      (sh.line.a < 0.99 ? ' opacity="' + r3(sh.line.a) + '"' : "") : "";
    const inner = (sh.fill && sh.fill.a < 0.99 ? '<v:fill opacity="' + r3(sh.fill.a) + '"/>' : "") +
      (stroke ? "<v:stroke" + stroke + "/>" : "") +
      (pp.text ? "<v:textbox" + (shown ? "" : ' style="mso-fit-shape-to-text:t"') + ' inset="' + sh.inset + '">' +
        commentSafe(pp.html) + "</v:textbox>" : "");
    return "<!--[if ppt]>" + head + inner + "</v:" + tag + "><![endif]-->";
  }

  // VML 은 돌린 다음 쪽 축으로 뒤집는다 — 한 축만 뒤집었으면 각을 거꾸로 적어야 PowerPoint 에서 덱과 같은 꼴·같은 각이 된다
  // (2026-10-18 실측: rotation:-45;flip:x → PowerPoint 회전 45°·좌우 대칭, rotation:15;flip:y → 345°·상하 대칭)
  function turnStyle(it) {
    const fh = /h/.test(it.flip || ""), fv = /v/.test(it.flip || ""), r = (fh !== fv ? -1 : 1) * (it.rot || 0);
    return (r ? ";rotation:" + r1(r) : "") + (fh || fv ? ";flip:" + (fh && fv ? "x y" : fh ? "x" : "y") : "");
  }

  // 선·화살표 → VML 선 — PowerPoint 가 선 도형으로 받는다(2026-10-18 실측: 화살촉·점선·굵기·색 그대로). 끝점 = 돌리기 전
  // 상자 안 끝점을 뒤집고 돌려 슬라이드 pt 로(b = pptPlace 가 묶음째 옮긴 상자 — 그 가운데를 축으로).
  // PowerPoint 는 from 이 왼쪽 위·to 가 오른쪽 아래일 때만 선을 받는다(거꾸로 적으면 길이 0 이 된다 — 같은 날 실측). 그래서
  // 둘레 상자의 두 모서리를 적고 방향은 flip 으로: flip:x 면 오른쪽에서, flip:y 면 아래에서 시작한다(화살촉은 끝 쪽 그대로).
  function pptLine(it, b, k, n) {
    const ln = it.line, fh = /h/.test(it.flip || ""), fv = /v/.test(it.flip || ""), a = (it.rot || 0) * Math.PI / 180;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, cos = Math.cos(a), sin = Math.sin(a);
    const pt = (x, y) => {
      const dx = (x - it.w / 2) * k * (fh ? -1 : 1), dy = (y - it.h / 2) * k * (fv ? -1 : 1);
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
    const p0 = pt(ln.x1, ln.y1), p1 = pt(ln.x2, ln.y2), fx = p0[0] > p1[0], fy = p0[1] > p1[1];
    const xy = (x, y) => r1(x) + "pt," + r1(y) + "pt";
    const flip = fx || fy ? "flip:" + (fx && fy ? "x y" : fx ? "x" : "y") + ";" : "";
    const dash = ln.dash === "dashed" ? ' dashstyle="dash"' : ln.dash === "dotted" ? ' dashstyle="dot"' : "";
    return '<!--[if ppt]><v:line id="_x0000_s' + (1025 + n) + '" from="' + xy(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])) +
      '" to="' + xy(Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])) + '" strokecolor="' + ln.color + '" strokeweight="' +
      r1(Math.max(0.25, ln.w * k)) + 'pt" style="position:absolute;' + flip + 'mso-wrap-style:none"><v:stroke' + dash +
      (ln.arrow ? ' endarrow="block"' : "") + ' endcap="round"/></v:line><![endif]-->';
  }

  // 무대 → 슬라이드 pt 자리. 묶음째 한 번만 옮겨 슬라이드 안으로(항목마다 끌어올리면 겹친다) — 돌린 항목은 실제로 차지하는
  // 둘레 상자로 잰다. 슬라이드보다 넓은 글상자는 슬라이드 너비로 줄이지만(글이 줄 바꿈), 돌린 것·선은 줄이면 꼴이 바뀌어 그대로 둔다.
  function pptPlace(list, k) {
    const bs = list.map((it) => {
      const free = !!(it.rot || it.line);
      return { x: it.x * k, y: it.y * k, w: free ? it.w * k : Math.min(SLIDE_W, it.w * k), h: it.h * k, free };
    });
    if (!bs.length) return bs;
    const g = span(bs.map((b, i) => hullBox(b, list[i].rot)));
    const dx = shiftInto(g.x0, g.x1, 0, SLIDE_W), dy = shiftInto(g.y0, g.y1, 0, SLIDE_H);
    return bs.map((b) => ({ x: b.free ? b.x + dx : Math.max(0, Math.min(b.x + dx, SLIDE_W - b.w)), y: b.y + dy, w: b.w, h: b.h }));
  }

  function officeHtml(p) {
    const used = new Set();
    const sw = p.stage && num(p.stage.w, 1, 1e5) ? p.stage.w : SLIDE_W / PX_PT, k = SLIDE_W / sw;
    const parts = p.items.map((it) => {                                     // 그림이면 주소, 아니면 걸러 낸 HTML
      const pic = officePic(it), src = blobOf(p, pic), ln = validLine(it.line);   // 선은 PowerPoint 에 선 도형으로
      if (src && /^(data:image\/|https?:)/i.test(src)) return { it, pic, src, ln };
      const html = safeHtml(blobOf(p, it.html));
      const vml = !ln && !!html.trim() && !NOT_TEXT.test(html);             // 표는 PowerPoint 도 표로 받는다
      return { it, html, vml, ln, pp: vml ? pptPrep(html, k / PX_PT) : null };
    });
    const vs = parts.filter((x) => x.pp || x.ln);                           // 항목 순서 = 겹침 순서
    const at = pptPlace(vs.map((x) => x.it), k);
    const shapes = vs.map((x, i) => (x.ln ? pptLine(x.it, at[i], k, i) : pptBox(x.pp, at[i], i, x.it))).join("");
    let body = "";
    for (const x of parts.slice().sort((a, b) => (a.it.y - b.it.y) || (a.it.x - b.it.x))) {
      let h;
      if (x.src) {
        const m = /^deckclip:(b\d+)$/.exec(x.pic);
        if (m) used.add(m[1]);
        const sz = x.it.look && x.pic === x.it.look ? hull(x.it.w, x.it.h, x.it.rot) : x.it;   // 구운 그림은 둘레 상자
        h = '<p style="margin:0 0 8px 0"><img ' + (m ? 'data-dc="' + m[1] + '" ' : "") + 'src="' + esc(x.src) + '" width="' +
          Math.round(sz.w) + '" height="' + Math.round(sz.h) + '" alt="' + esc(x.it.alt || x.it.name || "") + '"></p>';
      } else if (!x.vml) {
        h = x.html;
      } else {
        h = '<![if !ppt]><div style="vertical-align:top">' + x.html.replace(/<!\[/g, "&lt;![") + "</div><![endif]>";
      }
      body += x.ln ? "<![if !ppt]>" + h.replace(/<!\[/g, "&lt;![") + "<![endif]>" : h;   // 선 그림은 PowerPoint 밖에서만
    }
    const lite = Object.assign({}, p, { blobs: {} });
    for (const key of Object.keys(p.blobs || {})) if (!used.has(key)) lite.blobs[key] = p.blobs[key];
    return "<html" + (vs.length ? VML_NS : "") + '><head><meta charset="utf-8"></head><body><!--' + MARK +
      b64(JSON.stringify(lite)) + "-->" + shapes + body + "</body></html>";
  }

  function write(dt, p) {
    if (!dt || !p) return false;
    dt.setData("text/plain", p.text || "");
    dt.setData("text/html", officeHtml(p));
    try { dt.setData(MIME, JSON.stringify(p)); } catch (e) { /* 사용자 지정 형식을 못 쓰는 브라우저 — HTML 주석이 대신한다 */ }
    return true;
  }

  // 단추로 복사할 때 — 누름 처리 안에서 불러야 한다(브라우저가 복사 이벤트를 내 준다). 썼으면 true.
  // 창(window)의 잡기 단계에 걸어 편집기의 다른 복사 처리보다 먼저 받고, 거기서 멈춘다.
  function copyNow(p, doc) {
    const d = doc || document, w = d.defaultView || window;
    let done = false;
    const h = (e) => {
      if (!e.clipboardData) return;
      write(e.clipboardData, p);
      e.preventDefault();
      e.stopImmediatePropagation();
      done = true;
    };
    w.addEventListener("copy", h, true);
    try { d.execCommand("copy"); } catch (e) { done = false; } finally { w.removeEventListener("copy", h, true); }
    return done;
  }

  /* ── 읽기 ─────────────────────────────────────────────────────── */
  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const str = (v, max) => typeof v === "string" && v.length <= max;

  // 덱 편집기가 그린 선 — 값이 그대로 VML 속성에 들어가므로 꼴을 엄격하게
  function validLine(l) {
    return !!l && typeof l === "object" && ["x1", "y1", "x2", "y2"].every((k) => num(l[k], -1e5, 1e5)) && num(l.w, 0, 500) &&
      str(l.color, 7) && /^#[0-9a-f]{6}$/i.test(l.color) && str(l.dash, 6) && /^(solid|dashed|dotted)$/.test(l.dash) &&
      typeof l.arrow === "boolean";
  }

  function validItem(it) {
    if (!it || typeof it !== "object" || !TYPES.has(it.type)) return false;
    if (!num(it.x, -1e5, 1e5) || !num(it.y, -1e5, 1e5) || !num(it.w, 0.5, 1e5) || !num(it.h, 0.5, 1e5)) return false;
    if (!str(it.html, MAX_STR) || (it.text != null && !str(it.text, MAX_STR))) return false;
    for (const f of ["src", "png", "office", "alt", "name", "look"]) if (it[f] != null && !str(it[f], MAX_STR)) return false;
    if (it.native != null && !(it.native && str(it.native.fmt, 40) && str(it.native.html, MAX_STR))) return false;
    if (it.rot != null && !num(it.rot, -360, 360)) return false;
    if (it.flip != null && !(str(it.flip, 2) && /^(h|v|hv)$/.test(it.flip))) return false;
    if (it.line != null && !validLine(it.line)) return false;
    return true;
  }

  function valid(p) {
    if (!p || typeof p !== "object" || p.app !== "deckclip" || p.v !== V || !Array.isArray(p.items)) return false;
    if (!p.items.length || p.items.length > MAX_ITEMS || !p.stage || !num(p.stage.w, 1, 1e5) || !num(p.stage.h, 1, 1e5)) return false;
    if (p.blobs != null && (typeof p.blobs !== "object" || Array.isArray(p.blobs))) return false;
    if ((p.text != null && !str(p.text, MAX_STR)) || (p.src != null && (typeof p.src !== "object" || Array.isArray(p.src)))) return false;
    let total = 0;
    for (const v of Object.values(p.blobs || {})) { if (typeof v !== "string") return false; total += v.length; }
    for (const it of p.items) { if (!validItem(it)) return false; total += it.html.length + (it.native ? it.native.html.length : 0); }
    return total <= MAX_TOTAL;
  }

  function fromHtml(h) {
    const m = MARK_RE.exec(h);
    if (!m) return null;
    let p = null;
    try { p = JSON.parse(unb64(m[1])); } catch (e) { return null; }
    if (!p || typeof p !== "object") return null;
    p.blobs = p.blobs && typeof p.blobs === "object" ? p.blobs : {};
    const doc = new DOMParser().parseFromString(h, "text/html");      // 그림을 불러오지도 스크립트를 돌리지도 않는다
    for (const im of doc.querySelectorAll("img[data-dc]")) {
      const k = im.getAttribute("data-dc"), s = im.getAttribute("src") || "";
      if (/^b\d{1,4}$/.test(k) && !p.blobs[k] && BLOB_RE.test(s)) p.blobs[k] = s;
    }
    return p;
  }

  // 항목은 아는 칸만 옮긴다 — Object.assign 은 "__proto__" 칸을 프로토타입으로 받아 검사하지 않은 값이 물려 들어온다
  const ITEM_FIELDS = ["type", "x", "y", "w", "h", "html", "text", "name", "alt", "src", "png", "office", "rot", "flip", "look"];
  const LINE_FIELDS = ["x1", "y1", "x2", "y2", "w", "color", "dash", "arrow"];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function copyItem(it) {
    const o = {};
    for (const f of ITEM_FIELDS) if (own(it, f) && it[f] != null) o[f] = it[f];
    if (own(it, "native") && it.native && own(it.native, "fmt") && own(it.native, "html")) o.native = { fmt: it.native.fmt, html: it.native.html };
    if (own(it, "line") && it.line && typeof it.line === "object") {
      o.line = {};
      for (const f of LINE_FIELDS) if (own(it.line, f)) o.line[f] = it.line[f];
    }
    return o;
  }

  // 검사를 지난 페이로드를 새 객체로 — 아는 칸만, 꼴을 맞춰
  function normalize(p) {
    const blobs = {}, src = p.src || {};
    for (const k of Object.keys(p.blobs || {})) if (/^b\d{1,4}$/.test(k) && typeof p.blobs[k] === "string") blobs[k] = p.blobs[k];
    const s = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    return {
      app: "deckclip", v: V, id: s(p.id, 40),
      src: { editor: s(src.editor, 40), title: s(src.title, 200), session: s(src.session, 40) },
      stage: { w: p.stage.w, h: p.stage.h }, items: p.items.map(copyItem), blobs,
      text: typeof p.text === "string" ? p.text : "", t: num(p.t, 0, 1e15) ? p.t : 0,
    };
  }

  // 붙여 넣은 자료 → 덱 페이로드(없으면 null)
  function read(dt) {
    if (!dt) return null;
    let p = null;
    try { const j = dt.getData(MIME); if (j) p = JSON.parse(j); } catch (e) { p = null; }
    if (!valid(p)) p = null;
    if (!p) {
      let h = "";
      try { h = dt.getData("text/html") || ""; } catch (e) { h = ""; }
      if (h && h.indexOf(MARK) >= 0) p = fromHtml(h);
    }
    return valid(p) ? normalize(p) : null;
  }

  // 가리킴(deckclip:bN)을 실제 data URI 로 — 꼴이 맞지 않는 자료는 빈 글로
  function items(p) {
    const ok = {};
    for (const [k, v] of Object.entries(p.blobs || {})) if (/^b\d{1,4}$/.test(k) && BLOB_RE.test(v)) ok[k] = v;
    const sub = (s) => (typeof s !== "string" ? s : s.replace(REF_RE, (m, k) => (own(ok, k) ? ok[k] : "")));
    return p.items.map((it) => {
      const o = copyItem(it);
      for (const f of BLOB_FIELDS) if (o[f]) o[f] = sub(o[f]);
      if (o.native) o.native = { fmt: o.native.fmt, html: sub(o.native.html) };
      return o;
    });
  }

  /* ── 놓을 자리: 무대 크기가 다르면 비율대로, 같은 자리에 이미 있으면 비켜서, 무대 밖이면 묶음째 안으로 ───────────
     t = {w, h, taken?: [{x, y}], at?: {x, y}} — at 은 끌어다 놓은 점(묶음 가운데를 거기에, 비켜서기는 안 함).
     x/y/w/h 는 돌리기 전 상자, 무대 안으로 들일 때는 돌린 항목이 실제로 차지하는 둘레 상자로 잰다 */
  function place(p, t) {
    const list = items(p);
    if (!list.length) return [];
    const sw = p.stage.w, sh = p.stage.h;
    const k = Math.abs(sw - t.w) < 1 && Math.abs(sh - t.h) < 1 ? 1 : Math.min(t.w / sw, t.h / sh);
    let bs = list.map((it) => ({ x: it.x * k, y: it.y * k, w: it.w * k, h: it.h * k }));
    const at = t.at && num(t.at.x, -1e5, 1e5) && num(t.at.y, -1e5, 1e5) ? t.at : null;
    if (!at) {
      const taken = Array.isArray(t.taken) ? t.taken : [];
      const hit = (d) => bs.some((b) => taken.some((q) => Math.abs(q.x - (b.x + d)) < 1 && Math.abs(q.y - (b.y + d)) < 1));
      let d = 0;
      while (hit(d) && d < 40 * OFFSET) d += OFFSET;
      bs = bs.map((b) => ({ x: b.x + d, y: b.y + d, w: b.w, h: b.h }));
    }
    const g = span(bs.map((b, i) => hullBox(b, list[i].rot)));
    const dx = shiftInto(g.x0, g.x1, at ? at.x - (g.x0 + g.x1) / 2 : 0, t.w);
    const dy = shiftInto(g.y0, g.y1, at ? at.y - (g.y0 + g.y1) / 2 : 0, t.h);
    return list.map((it, i) => ({ item: it, k, x: r2(bs[i].x + dx), y: r2(bs[i].y + dy), w: r2(bs[i].w), h: r2(bs[i].h) }));
  }

  // 무대 크기가 다른 덱에 넣을 때 — HTML 요소의 px 값을 k 배로. SVG 는 바깥 크기(폭·높이)만 — 안은 viewBox 가 함께
  // 줄이고 늘린다(글자 크기·선 굵기까지 곱하면 두 번 커진다). viewBox 가 없으면 지금 크기로 달아 안도 함께 커지게.
  function scaleNode(root, k) {
    if (!root || Math.abs(k - 1) < 1e-3) return root;
    const fix = (s) => s.replace(/(-?\d*\.?\d+)px/g, (m, n) => r2(parseFloat(n) * k) + "px");
    const fixSize = (s) => s.replace(/(^|;)(\s*)(width|height)(\s*):(\s*)(-?\d*\.?\d+)px/gi,
      (m, a, b, p, c, d, n) => a + b + p + c + ":" + d + r2(parseFloat(n) * k) + "px");
    const walk = (n) => {
      if (n.nodeType !== 1) return;
      const svg = isSvg(n);
      if (svg && !n.getAttribute("viewBox")) {
        const w = n.getAttribute("width"), h = n.getAttribute("height");
        if (/^\d+(\.\d+)?$/.test(w || "") && /^\d+(\.\d+)?$/.test(h || "") && +w > 0 && +h > 0) n.setAttribute("viewBox", "0 0 " + w + " " + h);
      }
      const st = n.getAttribute("style");
      if (st) n.setAttribute("style", svg ? fixSize(st) : fix(st));
      for (const a of ["width", "height"]) {
        const v = n.getAttribute(a);
        if (v && /^\d+(\.\d+)?$/.test(v)) n.setAttribute(a, String(r2(parseFloat(v) * k)));
      }
      if (svg) return;
      for (const c of Array.from(n.children)) walk(c);
    };
    walk(root);
    return root;
  }

  /* ── 거르기(허용 목록) — 자기 거르기가 없는 편집기용. 결과는 문서 조각. id 는 새 이름으로 바꿔 덱의 id 를 가리지 못하게 ── */
  const OK_TAGS = new Set(["div", "p", "span", "b", "strong", "i", "em", "u", "s", "sub", "sup", "br", "small", "mark", "code",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "caption", "colgroup", "col", "thead", "tbody",
    "tfoot", "tr", "td", "th", "img", "figure", "figcaption", "svg", "g", "path", "line", "rect", "circle", "ellipse", "polyline",
    "polygon", "text", "tspan", "defs", "marker", "lineargradient", "radialgradient", "stop", "clippath", "image"]);
  const DROP_TAGS = new Set(["script", "style", "template", "iframe", "frame", "frameset", "object", "embed", "noscript", "link",
    "meta", "base", "form", "input", "button", "textarea", "select", "option", "audio", "video", "source", "track", "canvas",
    "foreignobject", "animate", "animatemotion", "animatetransform", "set", "use", "math", "applet", "dialog", "slot", "title",
    "desc", "noembed", "noframes", "xmp", "plaintext"]);            // 그 밖의 모르는 태그(링크 a 등)는 벗기고 글은 남긴다
  const OK_ATTRS = new Set(["style", "src", "alt", "width", "height", "colspan", "rowspan", "viewbox", "d", "points", "x", "y",
    "x1", "y1", "x2", "y2", "dx", "dy", "cx", "cy", "r", "rx", "ry", "fx", "fy", "transform", "fill", "stroke", "stroke-width",
    "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "fill-opacity", "fill-rule", "opacity",
    "font-size", "font-weight", "font-family", "font-style", "text-anchor", "dominant-baseline", "marker-start", "marker-mid",
    "marker-end", "markerwidth", "markerheight", "markerunits", "refx", "refy", "orient", "offset", "stop-color", "stop-opacity",
    "gradientunits", "gradienttransform", "spreadmethod", "preserveaspectratio", "clip-path", "clippathunits", "id", "href",
    "xmlns", "letter-spacing", "visibility", "paint-order", "textlength", "lengthadjust"]);
  const ID_TAGS = new Set(["marker", "lineargradient", "radialgradient", "clippath"]);
  const ATTR_OK = {
    width: /^\d+(\.\d+)?(px|%)?$/, height: /^\d+(\.\d+)?(px|%)?$/, colspan: /^\d{1,3}$/, rowspan: /^\d{1,3}$/,
    d: /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]*$/, points: /^[0-9.,\s+eE-]*$/, viewbox: /^[-0-9.,\s]*$/,
    transform: /^[a-zA-Z0-9.,\s()+-]*$/, id: /^[A-Za-z][\w-]{0,60}$/,
  };
  const REF_VALUE = /^url\(\s*["']?#([A-Za-z][\w-]{0,60})["']?\s*\)$/;

  // 서식 값에 쓸 수 있는 함수 — 색·계산·변형·그라디언트·필터처럼 바깥 자원을 부르지 않는 것만. 그 밖(image-set·image·
  // cross-fade·element·paint 등)이 든 선언은 버린다. url() 은 값 전체가 문서 안 가리킴(url(#id))일 때만.
  const STYLE_FN = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "light-dark",
    "calc", "min", "max", "clamp", "var", "round", "mod", "rem", "abs", "sign",
    "linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient",
    "repeating-conic-gradient", "translate", "translatex", "translatey", "translatez", "translate3d", "rotate", "rotatex", "rotatey",
    "rotatez", "rotate3d", "scale", "scalex", "scaley", "scalez", "scale3d", "skew", "skewx", "skewy", "matrix", "matrix3d",
    "perspective", "cubic-bezier", "steps", "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert",
    "opacity", "saturate", "sepia", "repeat", "minmax", "fit-content", "inset", "circle", "ellipse", "polygon"]);

  function styleFnsOk(v) {
    const re = /([a-z0-9-]*)\(/gi;
    let m;
    while ((m = re.exec(v))) {
      const f = m[1].toLowerCase();
      if (!/^-{0,2}[a-z]/.test(f)) continue;                       // 이름 없는 괄호 — 계산 안의 묶음
      if (f === "url") { if (!REF_VALUE.test(v)) return false; continue; }
      if (!STYLE_FN.has(f)) return false;
    }
    return true;
  }

  function cleanStyle(s) {
    const out = [];
    for (const decl of String(s).split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const p = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim();
      if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(p) || /expression|javascript:|behavior|binding|@import|\/\*|[\\<]/i.test(v)) continue;
      if (!styleFnsOk(v)) continue;
      if (p === "position" && !/^(absolute|relative|static)$/.test(v)) continue;
      out.push(p + ":" + v);
    }
    return out.join(";");
  }

  function attrAllowed(el, n, v) {
    if (!OK_ATTRS.has(n)) return false;
    const tag = el.localName.toLowerCase();
    if (n === "src") return tag === "img" && /^data:image\//i.test(v);
    if (n === "href") return (tag === "image" && /^data:image\//i.test(v)) || /^#[A-Za-z][\w-]{0,60}$/.test(v);
    if (n === "id") return ID_TAGS.has(tag) && ATTR_OK.id.test(v);
    if (n === "xmlns") return v === SVG_NS;
    if (/^(fill|stroke|marker-(start|mid|end)|clip-path)$/.test(n)) return !/url\s*\(/i.test(v) || REF_VALUE.test(v);
    if (n === "transform" && /url/i.test(v)) return false;
    return !ATTR_OK[n] || ATTR_OK[n].test(v.trim());
  }

  // 새 이름 = dc + 무작위 6자 + "-" + 원래 이름. 이미 바꾼 이름이면 앞머리만 갈아 끼운다 — 거듭 붙여 넣거나 저장분을 다시
  // 거를 때마다 길어지면 id 허용 길이(61자)를 넘겨 화살촉·그라디언트가 떨어진다
  const ID_PREFIX = /^(?:dc[a-z0-9]{6}-)+/;
  function renameIds(root) {
    const map = new Map();
    for (const el of root.querySelectorAll("[id]")) {
      const nid = "dc" + rid(6) + "-" + el.getAttribute("id").replace(ID_PREFIX, "");
      map.set(el.getAttribute("id"), nid);
      el.setAttribute("id", nid);
    }
    if (!map.size) return;
    const fix = (v) => v.replace(/url\(\s*["']?#([\w-]+)["']?\s*\)/g, (m, id) => (map.has(id) ? "url(#" + map.get(id) + ")" : m));
    for (const el of root.querySelectorAll("*")) {
      for (const a of Array.from(el.attributes)) {
        if (a.name === "href" && a.value[0] === "#" && map.has(a.value.slice(1))) el.setAttribute("href", "#" + map.get(a.value.slice(1)));
        else if (/url\(/.test(a.value)) el.setAttribute(a.name, fix(a.value));
      }
    }
  }

  // 편집기가 자기 상자 표시를 남길 때(opts.keep) — 클래스는 이름 글자만, 그 밖의 값은 짧고 꺾쇠·따옴표·주소 없이
  function keepValue(n, v) {
    if (n === "class") return /^[A-Za-z0-9_ -]{0,300}$/.test(v);
    return v.length <= 200 && !/[<>"'`\\]|javascript:|url\s*\(/i.test(v);
  }

  // 남기는 클래스에서도 덱의 짜임을 움직이는 것(장·현재 장·무대·편집기 표시 등)은 뗀다 — 붙여 넣은 상자 안 div.slide 를
  // 덱 스크립트가 장으로 세면 장 수·노트가 어긋난다
  const STRUCT_CLASS = /^(slides?|on|active|current|present|past|future|fragment|stage|deck|reveal|stage-.*|deck-.*|slide-.*|hs-.*|hsl.*|ed-.*|mw-.*|wg)$/i;

  function keepClasses(v) {
    return v.split(/\s+/).filter((c) => c && !STRUCT_CLASS.test(c)).join(" ");
  }

  /* opts: {keep?: RegExp — 더 남길 속성 이름(편집기 자신의 상자 표시: class·data-name 등), strict?: 요소가 하나라도 빠지거나
     벗겨지면 null — 고유 꼴(native)을 그대로 쓸지 정할 때} → 문서 조각(또는 null) */
  function clean(html, doc, opts) {
    const o = opts || {};
    const d = doc || document;
    const t = d.createElement("template");
    t.innerHTML = html;
    const tw = d.createTreeWalker(t.content, NodeFilter.SHOW_COMMENT);
    const cm = [];
    while (tw.nextNode()) cm.push(tw.currentNode);
    cm.forEach((c) => c.remove());
    let lost = 0;
    for (const el of Array.from(t.content.querySelectorAll("*"))) {
      if (!el.isConnected && !t.content.contains(el)) continue;
      const tag = el.localName.toLowerCase();
      if (DROP_TAGS.has(tag)) { el.remove(); lost++; continue; }
      if (!OK_TAGS.has(tag)) {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        el.remove();
        lost++;
        continue;
      }
      for (const a of Array.from(el.attributes)) {
        const n = a.name.toLowerCase();
        if (n === "style") { const s = cleanStyle(a.value); if (s) el.setAttribute("style", s); else el.removeAttribute("style"); continue; }
        if (o.keep && o.keep.test(n) && keepValue(n, a.value)) {
          if (n === "class") { const c = keepClasses(a.value); if (c) el.setAttribute("class", c); else el.removeAttribute("class"); }
          continue;
        }
        if (!attrAllowed(el, n, a.value)) el.removeAttribute(a.name);
      }
      if (tag === "img" && !el.hasAttribute("src")) { el.remove(); lost++; }   // 주소를 잃은 그림은 깨진 표시만 남는다
    }
    if (o.strict && lost) return null;
    renameIds(t.content);
    return t.content;
  }

  /* ── 다른 편집기에서 온 혼자 서는 꼴 → 빌더 덱 요소(.el) 꼴 — 빌더 덱을 고치는 편집기(B·A)가 함께 쓴다 ─────────── */
  const STYLE_SPLIT = /;(?![^(]*\))/;
  const TEXT_INHERIT = new Set(["color", "font-family", "font-size", "font-style", "font-weight", "font-variant-numeric",
    "letter-spacing", "line-height", "text-align", "text-transform", "white-space", "word-break", "overflow-wrap", "word-spacing",
    "text-indent", "line-break"]);
  const ROOT_KEEP = new Set(["background-color", "border", "border-top", "border-right", "border-bottom", "border-left", "border-radius",
    "padding", "opacity", "justify-content", "align-items"]);
  const LEAF = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption", "caption", "div"]);
  const HOLDER = new Set(["ul", "ol"]);           // 문단을 담기만 하는 것 — 항목마다 한 문단(앞에 • 또는 번호)

  function styleMap(s) {
    const m = new Map();
    for (const d of String(s || "").split(STYLE_SPLIT)) {
      const i = d.indexOf(":");
      if (i > 0) m.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim());
    }
    return m;
  }

  const styleStr = (m) => Array.from(m, ([k, v]) => k + ":" + v).join(";");

  function bullet(li) {
    const list = li.parentElement;
    if (!list || !HOLDER.has(list.localName)) return "";
    if (list.localName === "ul") return "• ";
    return (Array.from(list.children).filter((c) => c.localName === "li").indexOf(li) + 1) + ". ";
  }

  // 거른 글 뿌리 → {box: 상자 서식, paras: [{style, html}]} — 잎 블록마다 한 문단, 물려받는 글 서식을 문단마다 다 적는다
  // (덱마다 글 칸이 글자색 등을 따로 정하므로)
  function textParas(root) {
    const rs = styleMap(root.getAttribute("style"));
    const box = styleStr(new Map(Array.from(rs).filter(([k]) => ROOT_KEEP.has(k))));
    const paras = [];
    const blockKids = (n) => Array.from(n.children).filter((c) => LEAF.has(c.localName) || HOLDER.has(c.localName));
    const walk = (n, inh) => {
      const own = styleMap(n.getAttribute("style"));
      const next = new Map(inh);
      for (const [k, v] of own) if (TEXT_INHERIT.has(k)) next.set(k, v);
      const blocks = blockKids(n);
      if (n !== root && LEAF.has(n.localName) && !blocks.length) {
        const st = new Map(next);
        for (const k of ["margin", "padding", "background-color", "text-decoration-line"]) if (own.has(k)) st.set(k, own.get(k));
        if (!st.has("margin")) st.set("margin", "0px");
        const pre = n.localName === "li" ? esc(bullet(n)) : "";
        paras.push({ style: styleStr(st), html: pre + (n.innerHTML.trim() || (pre ? "" : "<br>")) });
        return;
      }
      if (!blocks.length) {                                             // 블록 없이 글만 든 것
        if (n.textContent.trim()) paras.push({ style: styleStr(next) + (next.size ? ";" : "") + "margin:0px", html: n.innerHTML });
        return;
      }
      for (const c of blocks) walk(c, next);
    };
    walk(root, new Map(Array.from(rs).filter(([k]) => TEXT_INHERIT.has(k))));
    return { box, paras };
  }

  // SVG 안의 화살촉 이름을 새로 — 붙인 덱의 다른 화살촉과 이름이 겹치지 않게(거르기들이 받는 꼴: m + 16진 8자)
  function markerIds(svg) {
    const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
    for (const m of svg.querySelectorAll("marker[id]")) {
      const old = m.getAttribute("id"), nid = "m" + hex();
      m.setAttribute("id", nid);
      for (const a of ["marker-start", "marker-end", "marker-mid"]) {
        for (const n of svg.querySelectorAll("[" + a + "]")) if (n.getAttribute(a).indexOf("#" + old + ")") >= 0) n.setAttribute(a, "url(#" + nid + ")");
      }
    }
  }

  function pictureHtml(src, alt) {
    return typeof src === "string" && /^data:image\/[a-z0-9.+-]+[;,]/i.test(src)
      ? '<img class="el" alt="' + esc(alt || "") + '" src="' + esc(src) + '" style="object-fit:contain">' : "";
  }

  // 거르기 전후 비교용 — 요소마다 태그·속성 이름·서식 선언 수(값은 거르기가 다듬을 수 있어 견주지 않는다).
  // xmlns 는 빼고 센다 — HTML 안 SVG 는 없어도 똑같이 그려지고, 이것만 지우는 거르기(B)가 있다
  function shape(root) {
    const one = (e) => e.localName + "[" + e.getAttributeNames().filter((a) => a !== "xmlns").sort().join(",") + "]" +
      String(e.getAttribute("style") || "").split(";").filter((d) => d.trim()).length;
    return [root, ...root.querySelectorAll("*")].map(one).join("|");
  }

  // 받는 빌더 덱 요소에 돌림·대칭을 다시 입힌다(CSS rotate·scale — 편집기 셋이 쓰는 꼴). flip = 뒤집기도 입힐지 —
  // 글상자는 돌리기만(덱 편집기는 글을 뒤집지 않는다), 표는 부르지 않는다(그대로).
  function withTurn(h, it, flip) {
    if (!h || !(it.rot || (flip && it.flip))) return h;
    const t = document.createElement("template");
    t.innerHTML = h;
    const el = t.content.firstElementChild;
    if (!el) return h;
    if (it.rot) el.style.setProperty("rotate", r2(it.rot) + "deg");
    if (flip && it.flip) el.style.setProperty("scale", (/h/.test(it.flip) ? "-1" : "1") + " " + (/v/.test(it.flip) ? "-1" : "1"));
    return t.innerHTML;
  }

  // 덱 편집기가 그린 선 — 받는 덱도 선으로 알아보게(크기를 바꾸면 다시 그리고 리본의 선 서식이 먹게) 이름표를 되붙이고,
  // 안쪽의 계산된 서식은 걷어 낸다(선 색·굵기·점선은 속성으로 적는다 — 서식이 남으면 속성을 가린다)
  function asLine(root, it) {
    const l = root.cloneNode(true);
    l.setAttribute("class", "el");
    l.setAttribute("data-name", it.line.arrow ? "deckops:arrow" : "deckops:line");
    for (const n of l.querySelectorAll("[style]")) n.removeAttribute("style");
    return l;
  }

  /* 항목(items() 가 푼 것) → 빌더 덱 요소 꼴(문자열, 없으면 ""). sanitize(html) → Element|null 은 그 편집기의 거르기 —
     차트(SVG)는 거르기에서 빠지는 것이 없을 때만 그대로 넣고, 아니면 그림으로. 결과도 넣기 전에 그 거르기로 다시 거른다.
     돌림·대칭(it.rot·it.flip)은 결과 요소에 다시 입힌다. */
  function toBuilder(it, k, sanitize) {
    const root = clean(it.html).firstElementChild;
    if (it.type === "image") return withTurn(pictureHtml(it.src || it.office || "", it.alt || it.name), it, true);
    if (!root) return withTurn(pictureHtml(it.png, it.name), it, true);
    scaleNode(root, k);
    if (it.type === "text") {
      const t = textParas(root);
      if (!t.paras.length) return withTurn(pictureHtml(it.png, it.name), it, true);
      return withTurn('<div class="el tx" style="' + esc(t.box) + '"><div class="tin">' +
        t.paras.map((p) => '<p class="pp" style="' + esc(p.style) + '">' + p.html + "</p>").join("") + "</div></div>", it, false);
    }
    if (it.type === "table") {
      const tb = root.localName === "table" ? root : root.querySelector("table");
      if (!tb) return pictureHtml(it.png, it.name);
      tb.classList.add("el");
      return tb.outerHTML;
    }
    if (it.type === "graphic" && root.localName === "svg") {
      markerIds(root);
      root.setAttribute("class", "el ch");
      const tries = it.line ? [asLine(root, it), root] : [root];       // 선으로 못 받는 거르기면 차트 꼴로
      for (const r of tries) {
        const before = shape(r);
        const n = typeof sanitize === "function" ? sanitize(r.outerHTML) : null;
        if (n && shape(n) === before) return withTurn(n.outerHTML, it, true);   // 거르기에서 빠진 것이 없을 때만 SVG 그대로
      }
    }
    return withTurn(pictureHtml(it.png, it.name) || (root.localName === "div" ? root.outerHTML.replace(/^<div/, '<div class="el"') : ""),
      it, true);
  }

  return Object.freeze({
    MIME, VERSION: V, LABEL, session: SESSION,
    capture, warm, write, copyNow, officeHtml, read, items, place, scaleNode, clean, guessType, textParas, toBuilder, turnOf,
    isOwn: (p) => !!(p && p.src && p.src.session === SESSION),
  });
})();

export default DeckClip;
