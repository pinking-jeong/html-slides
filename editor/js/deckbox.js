/* 생성물 — 고치지 마세요. 덱 공통 편집 명령(deckbox.js)의 ES 모듈 사본입니다. 빌더 덱 안의 편집기·편집 모드와 같은
   원본(_deck_edit/deckops/)을 쓰므로, 고칠 것은 원본에서 고치고 sync_deckops.py 로 다시 만듭니다. */
/* deckbox — 덱 편집기 공통 상자·도형 명령(deckops.js 의 짝 — 이 파일을 먼저 싣는다). 편집기는 DeckOps 로 이 이름들을
   함께 부른다(DeckOps 가 다시 내보낸다).
   · 색 읽기 — rgba·hex(캔버스가 읽으니 oklch·color-mix 도 된다).
   · 배치 — 장에 맞추기(돌린 상자는 보이는 테두리 기준), 앞뒤 순서, 회전(CSS rotate 속성 — transform 함수를 막는 거르기도
     지난다), 대칭(scale 속성), 돌린 상자의 크기 바꾸기(반대쪽 모서리 고정). 좌표는 편집기가 준다(boxOf 같은 것).
   · 도형 — 사각형·둥근 사각형·타원은 '채운 글상자'(글을 쓸 수 있고 다른 덱·PowerPoint 로 도형째 옮겨진다), 선·화살표는 SVG
     (크기를 바꾸면 fitLine 으로 다시 그려 화살촉이 찌그러지지 않게). 채우기·윤곽선·투명도, 서식 복사의 상자 몫.
   DOM 만 바꾼다. 무엇을 골랐는지·되돌리기·저장은 편집기 몫이다. */

var DeckBox = (function () {
  "use strict";

  const SHAPE_FILL = "#4472C4";       // PowerPoint 기본 도형(Office 테마 강조 1) — 채우기·윤곽선·글
  const SHAPE_LINE = "#2F528F";
  const SHAPE_TEXT = "#FFFFFF";
  const LINE_NAME = { line: "deckops:line", arrow: "deckops:arrow" };

  const win = (n) => ((n && n.ownerDocument) || document).defaultView || window;
  const css = (el) => win(el).getComputedStyle(el);
  const r2 = (v) => Math.round(v * 100) / 100;
  const isEl = (n) => !!n && n.nodeType === 1;

  // 색 → #RRGGBB(+ 알파). 캔버스가 읽으니 oklch·color-mix 도 된다. 못 읽거나 투명하면 null
  let ctx2d = null;
  function rgba(c) {
    if (!c || c === "transparent") return null;
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c.trim());
    let r, g, b, a;
    if (m) {
      r = +m[1]; g = +m[2]; b = +m[3];
      a = m[4] == null ? 1 : m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : +m[4];
    } else {
      if (!ctx2d) {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 1;
        ctx2d = cv.getContext("2d", { willReadFrequently: true });
      }
      if (!ctx2d) return null;
      ctx2d.clearRect(0, 0, 1, 1);
      ctx2d.fillStyle = "rgba(0,0,0,0)";
      ctx2d.fillStyle = c;
      ctx2d.fillRect(0, 0, 1, 1);
      const d = ctx2d.getImageData(0, 0, 1, 1).data;
      r = d[0]; g = d[1]; b = d[2]; a = d[3] / 255;
    }
    if (!(a > 0.01)) return null;
    const h = (v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase();
    return { hex: "#" + h(r) + h(g) + h(b), a: r2(a), r, g, b };
  }
  const hex = (c) => { const v = rgba(c); return v ? v.hex : null; };

  /* ── 상자: 맞추기·순서·회전·대칭 ─────────────────────────────────────── */
  function angle(el) {
    const v = (el.style.rotate || "").trim();
    if (!v || v === "none") return 0;
    const m = /(-?[\d.]+)\s*(deg|turn|rad|grad)?\s*$/.exec(v);
    if (!m) return 0;
    const n = parseFloat(m[1]), u = m[2] || "deg";
    return u === "turn" ? n * 360 : u === "rad" ? n * 180 / Math.PI : u === "grad" ? n * 0.9 : n;
  }

  function setAngle(el, deg) {
    let d = ((Math.round(deg * 100) / 100) % 360 + 360) % 360;
    if (d > 180) d -= 360;
    if (Math.abs(d) < 0.005) el.style.removeProperty("rotate");
    else el.style.setProperty("rotate", d + "deg");
    return d;
  }

  function flipOf(el) {
    const p = (el.style.scale || "").trim().split(/\s+/).filter(Boolean).map(parseFloat);
    const x = p.length ? p[0] : 1, y = p.length > 1 ? p[1] : x;
    return { h: x < 0, v: y < 0 };
  }

  function flip(el, axis) {
    const f = flipOf(el);
    if (axis === "h") f.h = !f.h; else f.v = !f.v;
    if (!f.h && !f.v) el.style.removeProperty("scale");
    else el.style.setProperty("scale", (f.h ? "-1" : "1") + " " + (f.v ? "-1" : "1"));
    return f;
  }

  // 돌린 상자가 보이는 테두리(축 맞춘 상자)
  function seen(b, deg) {
    const t = deg * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    const w = b.w * c + b.h * s, h = b.w * s + b.h * c;
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
  }

  // 장(W×H)에 맞추기 — b: 돌리기 전 상자 {x,y,w,h}. 새 {x,y} 를 돌려준다
  function alignBox(b, deg, mode, W, H) {
    const v = seen(b, deg);
    let dx = 0, dy = 0;
    if (mode === "left") dx = -v.x;
    else if (mode === "center") dx = (W - v.w) / 2 - v.x;
    else if (mode === "right") dx = W - v.w - v.x;
    else if (mode === "top") dy = -v.y;
    else if (mode === "middle") dy = (H - v.h) / 2 - v.y;
    else if (mode === "bottom") dy = H - v.h - v.y;
    return { x: r2(b.x + dx), y: r2(b.y + dy) };
  }

  // 앞뒤 순서 — 같은 부모 안 상자(isBox)끼리의 문서 순서(뒤에 있을수록 위). 움직였으면 true
  function order(el, how, isBox) {
    const sibs = Array.from(el.parentNode.children).filter(isBox), i = sibs.indexOf(el);
    if (i < 0) return false;
    const last = sibs.length - 1;
    let ref;
    if (how === "front" || how === "forward") {
      if (i === last) return false;
      ref = sibs[how === "front" ? last : i + 1].nextSibling;
    } else {
      if (i === 0) return false;
      ref = sibs[how === "back" ? 0 : i - 1];
    }
    el.parentNode.insertBefore(el, ref);
    return true;
  }

  // 돌린 상자의 크기를 손잡이로 바꿀 때 — 화면 이동량을 상자 축으로 돌려 바꾼 뒤 반대쪽 모서리가 제자리에 남게 옮긴다.
  // resize(b, dx, dy) 는 편집기의 '돌리지 않은 상자 크기 바꾸기'(손잡이 방향·최소 크기·비율 유지)
  function resizeTurned(b, deg, dx, dy, resize) {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    const nb = resize(b, dx * c + dy * s, -dx * s + dy * c);
    const lx = nb.x + nb.w / 2 - (b.x + b.w / 2), ly = nb.y + nb.h / 2 - (b.y + b.h / 2);
    const cx = b.x + b.w / 2 + lx * c - ly * s, cy = b.y + b.h / 2 + lx * s + ly * c;
    return { x: cx - nb.w / 2, y: cy - nb.h / 2, w: nb.w, h: nb.h };
  }

  /* ── 도형 ─────────────────────────────────────────────────────── */
  const SHAPES = [["rect", "사각형"], ["round", "모서리가 둥근 사각형"], ["oval", "타원"], ["line", "선"], ["arrow", "화살표"]];
  // 선·화살표 표지 — data-name 의 'deckops:' 는 예약 값이다(빌더 덱에서 data-name 은 상자 이름이기도 하다 — 편집기 A 의
  // '모든 장에'는 이 이름을 상자 이름으로 보지 않는다). 공통 클립보드(deckclip.js LINE_NAME)도 같은 표지를 읽는다
  const isLine = (el) => isEl(el) && el.localName === "svg" && /^deckops:(line|arrow)$/.test(el.getAttribute("data-name") || "");

  // 채운 글상자 꼴 도형의 상자 서식(편집기가 자리·크기를 덧붙인다)
  function shapeStyle(kind, w, h) {
    const rad = kind === "oval" ? "50%" : kind === "round" ? Math.round(Math.min(w, h) / 6) + "px" : "0px";
    return "background-color:" + SHAPE_FILL + ";border:1.5px solid " + SHAPE_LINE + ";border-radius:" + rad;
  }
  const shapeText = () => "color:" + SHAPE_TEXT + ";text-align:center";

  function lineSvg(kind, w, h, color, px) {
    const ns = "http://www.w3.org/2000/svg";
    const head = kind === "arrow" ? '<polygon fill="' + color + '" points="0,0 0,0 0,0"/>' : "";
    return '<svg xmlns="' + ns + '" data-name="' + LINE_NAME[kind] + '" viewBox="0 0 ' + w + " " + h + '"><line x1="0" y1="0" x2="0" y2="0" stroke="' +
      color + '" stroke-width="' + px + '" stroke-linecap="round"/>' + head + "</svg>";
  }

  // 크기를 안 주면 — px 로 적힌 크기, 아니면 지금 viewBox(지난번에 그린 크기). 상자를 채우는 SVG(width:100% — 편집기 C 의
  // 붙인 상자)의 '100' 은 크기가 아니다
  function drawnSize(svg, k, dflt) {
    const v = svg.style[k] || "";
    if (/^\s*\d*\.?\d+px\s*$/.test(v)) return parseFloat(v);
    const vb = svg.viewBox && svg.viewBox.baseVal, n = vb ? (k === "width" ? vb.width : vb.height) : 0;
    return n > 0 ? n : dflt;
  }

  // 선·화살표를 지금 크기로 다시 그린다(가운데 가로선, 끝에 화살촉) — 크기를 바꿀 때마다
  function fitLine(svg, w, h) {
    if (!isLine(svg)) return;
    const W = r2(w || drawnSize(svg, "width", 200)), H = r2(h || drawnSize(svg, "height", 24));
    const ln = svg.querySelector("line"), hd = svg.querySelector("polygon");
    if (!ln) return;
    const sw = parseFloat(ln.getAttribute("stroke-width")) || 2, pad = r2(sw / 2 + 1), y = r2(H / 2);
    const hl = hd ? r2(Math.min(W * 0.45, sw * 3 + 8)) : 0, hw = r2(Math.min(H / 2, sw * 1.6 + 4));
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    ln.setAttribute("x1", pad);
    ln.setAttribute("y1", y);
    ln.setAttribute("x2", r2(Math.max(pad, W - pad - hl * 0.7)));
    ln.setAttribute("y2", y);
    if (hd) hd.setAttribute("points", r2(W - pad) + "," + y + " " + r2(W - pad - hl) + "," + r2(y - hw) + " " + r2(W - pad - hl) + "," + r2(y + hw));
  }

  function lineParts(svg) { return { ln: svg.querySelector("line"), hd: svg.querySelector("polygon") }; }

  const DASH_SVG = { solid: null, dashed: "6 4", dotted: "1.5 3" };

  // 도형 서식 읽기 — {kind:"line"|"box", fill, alpha, line, lineW, dash}
  function boxFmt(el) {
    if (isLine(el)) {
      const { ln } = lineParts(el);
      const da = (ln && ln.getAttribute("stroke-dasharray")) || "";
      return { kind: "line", fill: null, alpha: 1, line: ln ? hex(ln.getAttribute("stroke")) : null,
        lineW: ln ? parseFloat(ln.getAttribute("stroke-width")) || 0 : 0, dash: !da ? "solid" : /^1(\.\d+)?\s/.test(da) ? "dotted" : "dashed" };
    }
    // 두께는 적힌 값을 먼저 — 계산값은 Chrome 이 장치 픽셀로 내린다(1.5px → 1px)
    const c = css(el), bg = rgba(c.backgroundColor), iw = parseFloat(el.style.borderTopWidth);
    const bw = isNaN(iw) ? parseFloat(c.borderTopWidth) : iw;
    const has = c.borderTopStyle !== "none" && bw > 0;
    return { kind: "box", fill: bg ? bg.hex : null, alpha: bg ? bg.a : 1, line: has ? hex(c.borderTopColor) : null,
      lineW: has ? r2(bw) : 0, dash: has ? c.borderTopStyle : "solid" };
  }

  function rgbaText(hx, a) {
    const v = rgba(hx);
    if (!v) return "transparent";
    return a >= 0.995 ? v.hex : "rgba(" + v.r + ", " + v.g + ", " + v.b + ", " + r2(a) + ")";
  }

  function setFill(el, color) {
    if (isLine(el)) return false;
    const a = (boxFmt(el).fill && boxFmt(el).alpha) || 1;
    el.style.setProperty("background-color", color ? rgbaText(color, a) : "transparent");
    return true;
  }

  function setAlpha(el, a) {
    const f = boxFmt(el);
    if (f.kind !== "box" || !f.fill) return false;
    el.style.setProperty("background-color", rgbaText(f.fill, Math.max(0, Math.min(1, a))));
    return true;
  }

  // 윤곽선 — o: {color(null=없음), w(px), dash(solid|dashed|dotted)} 중 바꿀 것만
  function setLine(el, o) {
    const f = boxFmt(el);
    const color = o.color === undefined ? f.line || SHAPE_LINE : o.color;
    const w = o.w == null ? f.lineW || 1.5 : o.w, dash = o.dash || f.dash || "solid";
    if (f.kind === "line") {
      if (o.color === null) return false;                   // 선에 '윤곽선 없음'은 하지 않는다(검게 칠하지도 않는다) — 지우려면 Delete
      const { ln, hd } = lineParts(el);
      if (!ln) return false;
      const c = color || SHAPE_LINE;
      ln.setAttribute("stroke", c);
      ln.setAttribute("stroke-width", r2(w));
      if (DASH_SVG[dash]) ln.setAttribute("stroke-dasharray", DASH_SVG[dash]); else ln.removeAttribute("stroke-dasharray");
      if (hd) hd.setAttribute("fill", c);
      fitLine(el);
      return true;
    }
    if (!color || !(w > 0)) el.style.setProperty("border", "0px none transparent");
    else el.style.setProperty("border", r2(w) + "px " + dash + " " + color);
    return true;
  }

  /* ── 서식 복사(상자 몫) ─────────────────────────────────────────────── */
  // 채운 상자는 채우기·윤곽선, 선·화살표는 선 서식. 모양(둥근 모서리·타원)은 서식이 아니다 — PowerPoint 도 안 옮긴다
  function pickBoxFmt(box) {
    const f = boxFmt(box);
    return {
      box: f.kind === "box" && (f.fill || f.line) ? f : null,
      line: f.kind === "line" ? f : null,
    };
  }

  // 같은 꼴(상자↔상자)은 채우기·윤곽선, 다른 꼴(상자↔선)이면 윤곽선만. noFill: 채우기를 받지 않는 대상(그림 등)
  function applyBoxFmt(box, fmt, noFill) {
    const src = fmt.box || fmt.line;
    if (!src) return false;
    if (isLine(box)) {
      if (!src.line) return false;                          // 윤곽선 없는 상자의 서식을 선에 — 선을 지우지 않는다
      return setLine(box, { color: src.line, w: src.lineW, dash: src.dash });
    }
    if (fmt.box && !noFill) box.style.setProperty("background-color", fmt.box.fill ? rgbaText(fmt.box.fill, fmt.box.alpha) : "transparent");
    return setLine(box, { color: src.line, w: src.lineW, dash: src.dash });
  }

  return Object.freeze({
    SHAPES, SHAPE_FILL, SHAPE_LINE, SHAPE_TEXT, rgba, hex,
    angle, setAngle, flipOf, flip, seen, alignBox, order, resizeTurned,
    isLine, shapeStyle, shapeText, lineSvg, fitLine, boxFmt, setFill, setAlpha, setLine, pickBoxFmt, applyBoxFmt,
  });
})();

export default DeckBox;
