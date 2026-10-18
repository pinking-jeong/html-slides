/* 생성물 — 고치지 마세요. 덱 공통 편집 명령(deckops.js)의 ES 모듈 사본입니다. 빌더 덱 안의 편집기·편집 모드와 같은
   원본(_deck_edit/deckops/)을 쓰므로, 고칠 것은 원본에서 고치고 sync_deckops.py 로 다시 만듭니다. */
import DeckBox from "./deckbox.js";
/* deckops — 덱 편집기 공통 편집 명령. PowerPoint '홈' 탭의 글꼴·단락·그리기·배치·편집 명령을 세 편집기가 같은 뜻·같은
   단축키로 쓰게 한다. 원본은 이 폴더(_deck_edit/deckops/)다 — deckbox.js(상자·도형·색)를 먼저 싣고 이 파일(글자·단락·
   서식 복사·찾기·단축키 표)을 싣는다. DeckOps 가 DeckBox 의 이름도 함께 내보내므로 편집기는 DeckOps 하나만 부른다.
   편집기 B(빌더 덱에 든 편집기, _deck_edit/editor/ — bundle.py 가 싣는다)·C(편집 모드 edit_module.html — inject_edit.py 가
   @@deckops@@ 자리에 넣는다)·A(html-slides editor/js/ — sync_deckops.py 가 만든 ES 모듈 사본). 화면(리본·찾기 창)은
   deckribbon.js 가 따로 맡는다.

   DOM 만 바꾼다. 무엇을 골랐는지·되돌리기·저장은 편집기 몫이다(편집기가 명령 앞뒤로 자기 되돌리기를 찍는다).
   · 글자 — 고른 글(없거나 캐럿뿐이면 글 칸 전체)에 굵게·기울임·밑줄·취소선·위/아래 첨자·글꼴·크기·색·형광펜·서식 지우기·
     대소문자. 고른 범위 경계에서 텍스트와 감싼 요소를 쪼개 문단(블록) 바로 아래 자식으로 만든 뒤 span 의 인라인 서식을 입힌다
     (편집기마다 다른 허용 목록을 모두 지나는 꼴 — span+style, sup/sub). 끝나면 같은 꼴의 이웃 span 을 합치고, 고른 범위를
     글자 수로 되살린다(쪼개고 합치면 텍스트 노드가 바뀌므로).
     밑줄·취소선은 상속이 아니라 '전파'라 자식이 끌 수 없다 — 범위 안의 선을 모두 걷고 글마다 원하는 선을 다시 긋는다.
   · 단락 — 맞춤(왼·가운데·오른·양쪽), 줄 간격(PowerPoint 배수 — 1.0 = 글자 크기의 1.2배, 단위 없는 line-height 로).
   · 서식 복사(pickFmt/applyFmt — 상자 몫은 DeckBox), 찾기·바꾸기(find/replaceChars), PowerPoint 단축키 표(keyCmd — e.code 로
     읽어 한글 자판에서도). 배치·도형은 deckbox.js. */

var DeckOps = (function (Box) {
  "use strict";

  const { hex } = Box;

  const PX_PT = 0.75;                 // 덱 1280px = PowerPoint 960pt (deckclip 과 같은 비율)
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];   // PowerPoint 글꼴 크기 목록(pt)
  const PT_MIN = 1;
  const PT_MAX = 400;
  const SPACING = [1, 1.15, 1.5, 2, 2.5, 3];
  const LINE_K = 1.2;                 // 줄 간격 1.0 = 글자 크기의 약 1.2배(PowerPoint '한 줄')
  const SEP = String.fromCharCode(1); // 찾기 — 문단 사이(입력에 나올 수 없는 글자)
  const BLOCKS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote", "figcaption",
    "dd", "dt", "pre", "section", "article", "ul", "ol", "table", "tr", "tbody", "thead"]);
  const STRIP_TAGS = { "font-weight": ["b", "strong"], "font-style": ["i", "em"], "font-family": ["font"],
    "font-size": ["font", "small", "big"], color: ["font"], "background-color": ["mark"] };
  const LINE_TAGS = ["u", "s", "strike", "del", "ins"];
  const CLEAR_TAGS = ["span", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "sup", "sub", "font", "mark", "small", "big"];
  const INHERITED = new Set(["font-weight", "font-style", "font-family", "font-size", "color"]);

  /* 명령 표 — [이름, 단축키, 무리]. 무리: text(글자) · para(단락) · box(상자) · edit(편집). 화면·도움말이 이 표를 쓴다. */
  const CMD = {
    font: ["글꼴", "", "text"], size: ["글자 크기", "", "text"],
    grow: ["글자 크게", "Ctrl+Shift+>", "text"], shrink: ["글자 작게", "Ctrl+Shift+<", "text"],
    grow1: ["글자 1pt 크게", "Ctrl+]", "text"], shrink1: ["글자 1pt 작게", "Ctrl+[", "text"],
    bold: ["굵게", "Ctrl+B", "text"], italic: ["기울임꼴", "Ctrl+I", "text"], underline: ["밑줄", "Ctrl+U", "text"],
    strike: ["취소선", "", "text"], sup: ["위 첨자", "Ctrl+Shift++", "text"], sub: ["아래 첨자", "Ctrl+=", "text"],
    case: ["대/소문자 바꾸기", "Shift+F3", "text"], color: ["글자색", "", "text"], highlight: ["형광펜", "", "text"],
    clear: ["서식 지우기", "Ctrl+Space", "text"],
    alignLeft: ["왼쪽 맞춤", "Ctrl+L", "para"], alignCenter: ["가운데 맞춤", "Ctrl+E", "para"],
    alignRight: ["오른쪽 맞춤", "Ctrl+R", "para"], alignJustify: ["양쪽 맞춤", "Ctrl+J", "para"], spacing: ["줄 간격", "", "para"],
    shape: ["도형 넣기", "", "edit"], fill: ["도형 채우기", "", "box"], line: ["도형 윤곽선", "", "box"], alpha: ["채우기 투명도", "", "box"],
    front: ["맨 앞으로 가져오기", "", "box"], forward: ["앞으로 가져오기", "Ctrl+Shift+]", "box"],
    backward: ["뒤로 보내기", "Ctrl+Shift+[", "box"], back: ["맨 뒤로 보내기", "", "box"],
    alignSlide: ["장에 맞추기", "", "box"], rotR90: ["오른쪽으로 90° 회전", "", "box"], rotL90: ["왼쪽으로 90° 회전", "", "box"],
    rotR15: ["오른쪽으로 15° 회전", "Alt+→", "box"], rotL15: ["왼쪽으로 15° 회전", "Alt+←", "box"], rot0: ["회전 없애기", "", "box"],
    flipH: ["좌우 대칭", "", "box"], flipV: ["상하 대칭", "", "box"], dup: ["복제", "Ctrl+D", "box"],
    fmtCopy: ["서식 복사", "Ctrl+Shift+C", "edit"], fmtPaste: ["서식 붙여넣기", "Ctrl+Shift+V", "edit"],
    find: ["찾기", "Ctrl+F", "edit"], replace: ["바꾸기", "Ctrl+H", "edit"],
  };
  const PARA = { alignLeft: "left", alignCenter: "center", alignRight: "right", alignJustify: "justify" };

  const FONTS = [
    ["맑은 고딕", "\"Malgun Gothic\", \"맑은 고딕\", sans-serif"], ["Noto Sans KR", "\"Noto Sans KR\", sans-serif"],
    ["나눔고딕", "NanumGothic, \"나눔고딕\", sans-serif"], ["바탕", "Batang, \"바탕\", serif"], ["굴림", "Gulim, \"굴림\", sans-serif"],
    ["돋움", "Dotum, \"돋움\", sans-serif"], ["Arial", "Arial, sans-serif"], ["Calibri", "Calibri, sans-serif"],
    ["Georgia", "Georgia, serif"], ["Times New Roman", "\"Times New Roman\", serif"], ["Consolas", "Consolas, monospace"],
  ];
  const COLORS = ["#000000", "#404040", "#7F7F7F", "#BFBFBF", "#FFFFFF", "#12202A", "#C00000", "#FF0000", "#FFC000", "#FFFF00",
    "#92D050", "#00B050", "#008A73", "#00B0F0", "#0070C0", "#4472C4", "#002060", "#7030A0", "#ED7D31", "#A5A5A5"];
  const HIGHLIGHTS = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FFC000", "#FCE4D6", "#E2EFDA", "#DDEBF7"];

  /* ── 바탕 ───────────────────────────────────────────────────────── */
  const win = (n) => ((n && n.ownerDocument) || document).defaultView || window;
  const css = (el) => win(el).getComputedStyle(el);
  const r2 = (v) => Math.round(v * 100) / 100;
  const isEl = (n) => !!n && n.nodeType === 1;
  const fixed = (n) => isEl(n) && n.getAttribute("contenteditable") === "false";

  // 덱이 걸어 둔 칸 — 서식 태그·span 가운데 id 나 data-* 를 단 것(편집기 C 덱의 살아 있는 값 span[data-v]·span#axesExpl 등).
  // 덱 스크립트가 그 걸이로 찾아 값을 채우므로 서식 지우기는 벗기지 않고(clearOne), 일부만 골라도 쪼개지 않는다(wholeMarked·cut*)
  const hasHook = (el) => el.hasAttribute("id") || Array.from(el.attributes).some((at) => at.name.startsWith("data-"));
  const marked = (el) => isEl(el) && CLEAR_TAGS.indexOf(el.localName) >= 0 && !fixed(el) && hasHook(el);

  // 글이 아닌 곳 — 글머리표(.bu)처럼 고칠 수 없는 칸, SVG·스크립트 안
  function locked(n, root) {
    for (let p = n.parentNode; p && p !== root; p = p.parentNode) {
      if (!isEl(p)) continue;
      if (fixed(p)) return true;
      const t = p.localName;
      if (t === "svg" || t === "script" || t === "style" || t === "template") return true;
    }
    return false;
  }

  // 문단 사이의 들여쓰기 공백(블록 자식과 나란한 공백뿐인 글) — 글로 세지 않는다(서식 span 으로 감싸지 않게)
  function blockGap(t) {
    if (/\S/.test(t.data)) return false;
    for (const c of t.parentNode.childNodes) if (isEl(c) && isBlock(c)) return true;
    return false;
  }

  function texts(root) {
    const out = [];
    const tw = root.ownerDocument.createTreeWalker(root, 4);
    while (tw.nextNode()) {
      const t = tw.currentNode;
      if (!locked(t, root) && !blockGap(t)) out.push(t);
    }
    return out;
  }

  function total(root) { return texts(root).reduce((n, t) => n + t.length, 0); }

  function isBlock(el) {
    if (BLOCKS.has(el.localName)) return true;
    const d = css(el).display;
    return !(d === "inline" || d === "contents" || d === "none" || d.indexOf("inline") === 0 || d.indexOf("ruby") === 0);
  }

  function blockOf(n, root) {
    for (let p = n.parentNode; p && p !== root; p = p.parentNode) if (isEl(p) && isBlock(p)) return p;
    return root;
  }


  /* ── 글자 위치(글자 수) — 쪼개고 합쳐도 변하지 않는 좌표 ─────────────────── */
  function charIndex(root, node, off) {
    const probe = root.ownerDocument.createRange();
    try { probe.setStart(node, off); } catch (e) { return 0; }
    probe.collapse(true);
    let n = 0;
    for (const t of texts(root)) {
      if (t === node) return n + Math.min(off, t.length);
      if (probe.comparePoint(t, t.length) <= 0) n += t.length;
      else return n;
    }
    return n;
  }

  function rangeIn(root) {
    const s = win(root).getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    return root.contains(r.startContainer) && root.contains(r.endContainer) ? r : null;
  }

  function rangeChars(root, range) {
    const a = charIndex(root, range.startContainer, range.startOffset), b = charIndex(root, range.endContainer, range.endOffset);
    return a <= b ? [a, b] : [b, a];
  }

  // after: 경계에서 다음 텍스트의 앞을(시작점), 아니면 앞 텍스트의 끝을(끝점)
  function pointAt(root, idx, after) {
    let n = 0;
    const ts = texts(root);
    for (const t of ts) {
      const L = t.length;
      if (idx < n + L || (idx === n + L && !after && L)) return { node: t, off: idx - n };
      n += L;
    }
    const last = ts[ts.length - 1];
    return last ? { node: last, off: last.length } : { node: root, off: root.childNodes.length };
  }

  // [a, b) 의 범위 — 고르기는 바꾸지 않는다(찾은 곳 강조처럼 포커스를 옮기지 않을 때)
  function rangeOf(root, a, b) {
    const s = pointAt(root, a, true), e = b > a ? pointAt(root, b, false) : s;
    const r = root.ownerDocument.createRange();
    r.setStart(s.node, s.off);
    r.setEnd(e.node, e.off);
    return r;
  }

  function selectChars(root, a, b) {
    const r = rangeOf(root, a, b);
    const sel = win(root).getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(r); }
    return r;
  }

  /* ── 고른 글을 문단 바로 아래 자식으로 떼어 내기 ───────────────────────────── */
  function splitAt(root, idx) {
    let n = 0;
    for (const t of texts(root)) {
      const L = t.length;
      if (idx > n && idx < n + L) { t.splitText(idx - n); return; }
      n += L;
      if (n >= idx) return;
    }
  }

  function pick(root, a, b) {
    splitAt(root, b);
    splitAt(root, a);
    const out = [];
    let n = 0;
    for (const t of texts(root)) {
      const L = t.length;
      if (L && n >= a && n + L <= b) out.push(t);
      n += L;
    }
    return out;
  }

  function top(n, block) { while (n.parentNode && n.parentNode !== block) n = n.parentNode; return n; }

  // n 앞에서 감싼 요소를 둘로 — n 이 든 갈래가 block 아래 새 자식에서 시작하게. 덱이 걸어 둔 칸(marked)은 쪼개지 않고 통째로
  // 올라간다(범위는 wholeMarked 가 칸 전체로 넓혔으니 남는 것은 <br>·잠근 칸처럼 글자로 세지 않는 것뿐). 복제본에는 id 를 두지
  // 않는다(같은 id 가 둘이 되지 않게)
  function cutBefore(n, block) {
    let cur = n;
    while (cur.parentNode && cur.parentNode !== block) {
      const p = cur.parentNode;
      if (cur.previousSibling && !marked(p)) {
        const q = p.cloneNode(false);
        q.removeAttribute("id");
        for (let x = cur; x;) { const nx = x.nextSibling; q.appendChild(x); x = nx; }
        p.parentNode.insertBefore(q, p.nextSibling);
        cur = q;
      } else cur = p;
    }
  }

  function cutAfter(n, block) {
    let cur = n;
    while (cur.parentNode && cur.parentNode !== block) {
      const p = cur.parentNode;
      if (cur.nextSibling && !marked(p)) {
        const q = p.cloneNode(false);
        q.removeAttribute("id");
        while (cur.nextSibling) q.appendChild(cur.nextSibling);
        p.parentNode.insertBefore(q, p.nextSibling);
      }
      cur = p;
    }
  }

  function between(g) {
    const s = top(g.texts[0], g.block), e = top(g.texts[g.texts.length - 1], g.block), out = [];
    for (let x = s; x; x = x.nextSibling) {
      if (!fixed(x) && x.nodeType !== 8) out.push(x);
      if (x === e) break;
    }
    return out;
  }

  function groups(root, a, b) {
    const gs = [];
    for (const t of pick(root, a, b)) {
      const blk = blockOf(t, root);
      let g = gs[gs.length - 1];
      if (!g || g.block !== blk) gs.push((g = { block: blk, texts: [] }));
      g.texts.push(t);
    }
    for (const g of gs) {
      cutAfter(g.texts[g.texts.length - 1], g.block);
      cutBefore(g.texts[0], g.block);
      g.nodes = between(g);
    }
    return gs;
  }

  // [a, b) 의 끝이 덱이 걸어 둔 칸 안에 떨어지면 칸 전체로 넓힌다 — 쪼개면 같은 칸이 둘이 되어, 덱이 다시 열 때 두 칸 모두에
  // 값을 채운다(숫자가 두 번). 칸 가장자리에 닿기만 한 끝(그 안의 글자를 고르지 않음)은 그대로. 편집기도 부른다(C 의 크게·작게)
  function wholeMarked(root, a, b) {
    if (a >= b) return [a, b];
    const s = pointAt(root, a, true).node, e = pointAt(root, b, false).node;
    if (s === root || e === root) return [a, b];
    for (let p = s.parentNode; p && p !== root; p = p.parentNode) {
      if (!marked(p)) continue;
      const x = charIndex(root, p, 0);
      if (x < a && a < charIndex(root, p, p.childNodes.length)) a = x;
    }
    for (let p = e.parentNode; p && p !== root; p = p.parentNode) {
      if (!marked(p)) continue;
      const y = charIndex(root, p, p.childNodes.length);
      if (charIndex(root, p, 0) < b && b < y) b = y;
    }
    return [a, b];
  }

  /* ── 요소 다루기 ─────────────────────────────────────────────────── */
  function unwrap(el) {
    const p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  }

  // 서식 태그(b·u·sup…)를 벗긴다 — 다른 속성(style 등)이 있으면 span 으로 바꿔 그 서식은 남긴다
  function demote(el) {
    if (!el.parentNode || fixed(el)) return;
    if (!el.attributes.length) { unwrap(el); return; }
    const s = el.ownerDocument.createElement("span");
    for (const at of Array.from(el.attributes)) s.setAttribute(at.name, at.value);
    while (el.firstChild) s.appendChild(el.firstChild);
    el.parentNode.replaceChild(s, el);
  }

  function demoteIn(x, tags, self) {
    if (!isEl(x) || !tags || !tags.length) return;
    for (const el of Array.from(x.querySelectorAll(tags.join(",")))) demote(el);
    if (self && tags.indexOf(x.localName) >= 0) demote(x);
  }

  function wrap(x) {
    if (isEl(x) && x.localName === "span") return x;
    const s = x.ownerDocument.createElement("span");
    x.parentNode.insertBefore(s, x);
    s.appendChild(x);
    return s;
  }

  // 글 하나만 감싼 span — 이미 그런 span 이면 그것을(문단 자체는 아니게)
  function textSpan(t, block) {
    const p = t.parentNode;
    if (p !== block && isEl(p) && p.localName === "span" && p.childNodes.length === 1 && !fixed(p)) return p;
    const s = t.ownerDocument.createElement("span");
    p.insertBefore(s, t);
    s.appendChild(t);
    return s;
  }

  /* ── 글자 서식 ─────────────────────────────────────────────────── */
  function setProp(gs, prop, value) {
    for (const g of gs) {
      for (let k = 0; k < g.nodes.length; k++) {
        const x = g.nodes[k];
        if (!x.parentNode || (x.nodeType === 3 && !x.length)) continue;
        const s = wrap(x);
        g.nodes[k] = s;                         // 같은 묶음의 다음 속성도 이 span 에 — 겹 span 이 쌓이지 않게(서식 복사)
        for (const d of Array.from(s.querySelectorAll("[style]"))) d.style.removeProperty(prop);
        demoteIn(s, STRIP_TAGS[prop], false);
        if (value == null || value === "") s.style.removeProperty(prop);
        else s.style.setProperty(prop, value);
      }
    }
  }

  const weightOf = (t) => parseInt(css(t.parentNode).fontWeight, 10) || 400;
  const italicOf = (t) => /italic|oblique/.test(css(t.parentNode).fontStyle);

  function linesOf(t, root) {
    const s = new Set();
    for (let p = t.parentNode; isEl(p); p = p.parentNode) {
      const v = css(p).textDecorationLine || "";
      if (v.indexOf("underline") >= 0) s.add("underline");
      if (v.indexOf("line-through") >= 0) s.add("line-through");
      if (p === root) break;
    }
    return s;
  }

  function inTag(t, name, root) {
    for (let p = t.parentNode; p && p !== root; p = p.parentNode) if (isEl(p) && p.localName === name) return true;
    return false;
  }

  // 범위 안의 선을 모두 걷고 글마다 want(t) 의 선을 긋는다 — 문단·글 칸에서 오는 선은 그대로 둔다
  function setLines(root, gs, want) {
    for (const g of gs) {
      const sets = g.texts.map(want);
      for (const x of g.nodes) {
        if (!isEl(x) || !x.parentNode) continue;
        for (const el of [x, ...x.querySelectorAll("[style]")]) {
          if (!el.style) continue;
          el.style.removeProperty("text-decoration-line");
          if (/underline|line-through/.test(el.style.getPropertyValue("text-decoration"))) el.style.removeProperty("text-decoration");
        }
        demoteIn(x, LINE_TAGS, true);
      }
      g.texts.forEach((t, k) => {
        const base = linesOf(t, root);
        const need = Array.from(sets[k]).filter((l) => !base.has(l));
        if (need.length) textSpan(t, g.block).style.setProperty("text-decoration-line", need.join(" "));
      });
    }
  }

  function toggleLine(root, gs, line) {
    const all = gs.every((g) => g.texts.every((t) => linesOf(t, root).has(line)));
    setLines(root, gs, (t) => { const s = linesOf(t, root); if (all) s.delete(line); else s.add(line); return s; });
    return !all;
  }

  function toggleScript(root, gs, tag) {
    const other = tag === "sup" ? "sub" : "sup";
    const all = gs.every((g) => g.texts.every((t) => inTag(t, tag, root)));
    for (const g of gs) {
      for (const x of g.nodes) demoteIn(x, [tag, other], true);
      if (all) continue;
      const nodes = between(g);
      const el = root.ownerDocument.createElement(tag);
      nodes[0].parentNode.insertBefore(el, nodes[0]);
      for (const n of nodes) el.appendChild(n);
    }
    return !all;
  }

  // 서식 지우기 — 서식 태그·span 을 벗긴다. 덱이 걸어 둔 칸(id·data-* — 편집기 C 덱의 살아 있는 값 span[data-v] 등)은 글에
  // 딸린 뜻이라 벗기지 않고 서식만 걷는다(style 을 지우고, b·sup 같은 서식 태그면 span 으로)
  function clearOne(el) {
    if (fixed(el) || !el.parentNode) return;
    if (!hasHook(el)) { unwrap(el); return; }
    el.removeAttribute("style");
    if (el.localName !== "span") demote(el);
  }

  function clearAll(gs) {
    for (const g of gs) {
      for (const x of g.nodes) {
        if (!isEl(x) || !x.parentNode) continue;
        for (const el of Array.from(x.querySelectorAll(CLEAR_TAGS.join(",")))) clearOne(el);
        if (CLEAR_TAGS.indexOf(x.localName) >= 0) clearOne(x);
      }
    }
  }

  // Shift+F3 — 소문자 → 단어 첫 글자만 대문자 → 대문자 → 소문자 … (한글은 그대로)
  function changeCase(gs) {
    const ts = [].concat(...gs.map((g) => g.texts));
    const s = ts.map((t) => t.data).join(""), up = s.toUpperCase(), lo = s.toLowerCase();
    const mode = s === up && s !== lo ? "lower" : s === lo && s !== up ? "title" : "upper";
    let prev = false;
    for (const t of ts) {
      if (mode === "upper") t.data = t.data.toUpperCase();
      else if (mode === "lower") t.data = t.data.toLowerCase();
      else {
        let o = "";
        for (const ch of t.data) {
          const w = /[\p{L}\p{N}]/u.test(ch);
          o += w && !prev ? ch.toUpperCase() : ch.toLowerCase();
          prev = w;
        }
        t.data = o;
      }
    }
    return mode;
  }

  // PowerPoint 크기 목록에서 다음·앞 크기(pt) — 목록 밖이면 10pt 단위
  function nextPt(pt, dir) {
    if (dir > 0) {
      for (const s of SIZES) if (s > pt + 0.01) return s;
      return Math.min(PT_MAX, Math.floor(pt / 10) * 10 + 10);
    }
    for (let k = SIZES.length - 1; k >= 0; k--) if (SIZES[k] < pt - 0.01) return SIZES[k];
    return Math.max(PT_MIN, pt - 1);
  }

  const ptOf = (t) => parseFloat(css(t.parentNode).fontSize) * PX_PT;
  const pxOfPt = (pt) => r2(Math.min(PT_MAX, Math.max(PT_MIN, pt)) / PX_PT) + "px";

  // 글마다 지금 크기에서 한 칸 — 범위 안의 크기를 걷고 글마다 다시 입힌다(겹친 span 이 쌓이지 않게)
  function stepSize(gs, dir, one) {
    for (const g of gs) {
      const want = g.texts.map((t) => { const pt = ptOf(t); return one ? pt + dir : nextPt(pt, dir); });
      for (const x of g.nodes) {
        if (!isEl(x) || !x.parentNode) continue;
        for (const el of [x, ...x.querySelectorAll("[style]")]) if (el.style) el.style.removeProperty("font-size");
        demoteIn(x, STRIP_TAGS["font-size"], true);
      }
      g.texts.forEach((t, k) => { textSpan(t, g.block).style.setProperty("font-size", pxOfPt(want[k])); });
    }
  }

  /* ── 정리: 물려받는 값과 같은 선언 지우기, 빈 span 벗기기, 같은 꼴 이웃 합치기 ─────── */
  function sameAttrs(a, b) {
    if (a.attributes.length !== b.attributes.length) return false;
    for (const at of Array.from(a.attributes)) if (b.getAttribute(at.name) !== at.value) return false;
    return true;
  }

  function merge(node) {
    let x = node.firstChild;
    while (x) {
      const nx = x.nextSibling;
      if (isEl(x)) merge(x);
      if (nx && isEl(x) && isEl(nx) && x.localName === nx.localName && /^(span|sup|sub)$/.test(x.localName) &&
          !fixed(x) && sameAttrs(x, nx)) {
        while (nx.firstChild) x.appendChild(nx.firstChild);
        nx.remove();
        continue;
      }
      x = nx;
    }
  }

  // 문단 줄 높이가 px 로 고정된 덱 — 크기를 바꾼 글 span 에 문단과 같은 비율의 단위 없는 줄 높이를 달아, 큰 글이 든 줄만
  // 넓어지게 한다(그대로 두면 큰 글이 윗줄을 덮는다. PowerPoint 의 줄 간격도 줄에서 가장 큰 글 기준). 크기를 걷은 span 의 것은 걷는다.
  function fitLines(block) {
    const cb = css(block), fs = parseFloat(cb.fontSize);
    const ratio = /px$/.test(cb.lineHeight) && fs > 0 ? String(r2(parseFloat(cb.lineHeight) / fs)) : "";
    for (const s of Array.from(block.querySelectorAll("span[style]"))) {
      if (fixed(s)) continue;
      if (s.style.fontSize) { if (ratio) s.style.setProperty("line-height", ratio); }
      else if (/^[\d.]+$/.test(s.style.lineHeight)) s.style.removeProperty("line-height");
    }
  }

  function tidy(block, props) {
    for (const s of Array.from(block.querySelectorAll("span[style]"))) {
      for (const prop of props || []) {
        if (!INHERITED.has(prop) || !s.style.getPropertyValue(prop)) continue;
        if (css(s).getPropertyValue(prop) === css(s.parentNode).getPropertyValue(prop)) s.style.removeProperty(prop);
      }
    }
    if (block !== block.ownerDocument.body) fitLines(block);
    for (const s of Array.from(block.querySelectorAll("span, sup, sub"))) {
      if (fixed(s) || !s.parentNode) continue;
      if (s.hasAttribute("style") && !s.getAttribute("style").trim()) s.removeAttribute("style");
      if (s.localName === "span" && !s.attributes.length) unwrap(s);
      else if (!s.textContent && !s.querySelector("br, img")) s.remove();
    }
    merge(block);
    block.normalize();
  }

  /* ── 단락 ─────────────────────────────────────────────────────── */
  function blocksIn(root, range) {
    const ts = texts(root);
    if (!ts.length) return [root];
    if (!range) {
      const out = [];
      for (const t of ts) { const b = blockOf(t, root); if (out.indexOf(b) < 0) out.push(b); }
      return out;
    }
    if (range.collapsed) {
      const c = range.startContainer;
      const n = c.nodeType === 3 ? c : c.childNodes[range.startOffset] || c;
      if (n === root) return [blockOf(ts[0], root)];
      return [isEl(n) && n !== root && isBlock(n) ? n : blockOf(n.nodeType === 3 ? n : n.firstChild || n, root)];
    }
    const [a, b] = rangeChars(root, range), out = [];
    let n = 0;
    for (const t of ts) {
      const s = n, e = n + t.length;
      n = e;
      if (e > a && s < b) { const bl = blockOf(t, root); if (out.indexOf(bl) < 0) out.push(bl); }
    }
    return out.length ? out : [blockOf(ts[0], root)];
  }

  function alignOf(v) {
    if (v === "center" || v === "-webkit-center") return "center";
    if (v === "right" || v === "end" || v === "-webkit-right") return "right";
    if (v === "justify") return "justify";
    return "left";
  }

  function spacingOf(c) {
    const fs = parseFloat(c.fontSize) || 16;
    const lh = c.lineHeight === "normal" ? fs * LINE_K : parseFloat(c.lineHeight) || fs * LINE_K;
    const m = lh / fs / LINE_K;
    for (const s of SPACING) if (Math.abs(s - m) < 0.06) return s;
    return r2(m);
  }

  // 글 칸 전체(상자를 골랐을 때)의 물려받는 서식은 문단에 바로 — 글마다 span 을 만들지 않는다. 안쪽의 같은 서식은 걷고,
  // 문단 바탕(클래스)과 같아지면 인라인 선언도 뺀다
  const WHOLE = { bold: "font-weight", italic: "font-style", color: "color", font: "font-family" };
  function wholeCmd(root, cmd, arg) {
    const prop = WHOLE[cmd], ts = texts(root).filter((t) => t.length);
    let value = arg || null, on;
    if (cmd === "bold") { on = !ts.every((t) => weightOf(t) >= 600); value = on ? "700" : "400"; }
    if (cmd === "italic") { on = !ts.every(italicOf); value = on ? "italic" : "normal"; }
    for (const bl of blocksIn(root, null)) {
      for (const el of Array.from(bl.querySelectorAll("[style]"))) if (!fixed(el)) el.style.removeProperty(prop);
      demoteIn(bl, STRIP_TAGS[prop], false);
      bl.style.removeProperty(prop);
      if (value != null) {
        const base = css(bl).getPropertyValue(prop);
        bl.style.setProperty(prop, value);
        if (css(bl).getPropertyValue(prop) === base) bl.style.removeProperty(prop);
      }
      if (bl.hasAttribute("style") && !bl.getAttribute("style").trim()) bl.removeAttribute("style");
      tidy(bl, []);
    }
    return { ok: true, on, msg: CMD[cmd][0] + (on === false ? " 끔" : "") + " — 글 칸 전체" };
  }

  /* ── 글자·단락 명령 하나 ────────────────────────────────────────── */
  // root: 글 칸(편집 가능한 요소) · range: 고른 글(접혔거나 null 이면 글 칸 전체 — 단락 명령은 캐럿의 문단)
  // 돌려줌: { ok, msg?, on? } — 고른 범위·캐럿은 글자 수로 되살린다
  function textCmd(root, range, cmd, arg) {
    const whole = !range || range.collapsed;
    const caret = range && range.collapsed ? charIndex(root, range.startContainer, range.startOffset) : -1;
    if (PARA[cmd] || cmd === "spacing") {
      const bs = blocksIn(root, range);
      for (const bl of bs) {
        if (cmd === "spacing") bl.style.setProperty("line-height", String(r2(LINE_K * (+arg || 1))));
        else bl.style.setProperty("text-align", PARA[cmd]);
      }
      return { ok: true, msg: CMD[cmd][0] + (cmd === "spacing" ? " " + arg : "") + " — 문단 " + bs.length + "개" };
    }
    if (whole && cmd === "size") {
      const r = sizeAll(root, +arg);
      if (caret >= 0) selectChars(root, caret, caret);
      return r;
    }
    const [a, b] = whole ? [0, total(root)] : wholeMarked(root, ...rangeChars(root, range));
    if (a === b) return { ok: false, msg: "글이 없습니다." };
    if (whole && WHOLE[cmd]) {
      const r = wholeCmd(root, cmd, arg);
      if (caret >= 0) selectChars(root, caret, caret);
      return r;
    }
    const gs = groups(root, a, b);
    if (!gs.length) return { ok: false, msg: "고칠 수 있는 글이 없습니다." };
    let res = { ok: true }, props = [], len = b - a;
    if (cmd === "bold") { const on = !gs.every((g) => g.texts.every((t) => weightOf(t) >= 600)); setProp(gs, "font-weight", on ? "700" : "400"); props = ["font-weight"]; res.on = on; }
    else if (cmd === "italic") { const on = !gs.every((g) => g.texts.every(italicOf)); setProp(gs, "font-style", on ? "italic" : "normal"); props = ["font-style"]; res.on = on; }
    else if (cmd === "underline") res.on = toggleLine(root, gs, "underline");
    else if (cmd === "strike") res.on = toggleLine(root, gs, "line-through");
    else if (cmd === "sup" || cmd === "sub") res.on = toggleScript(root, gs, cmd);
    else if (cmd === "clear") clearAll(gs);
    else if (cmd === "case") { res.mode = changeCase(gs); len = gs.reduce((n, g) => n + g.texts.reduce((m, t) => m + t.length, 0), 0); }
    else if (cmd === "color") { setProp(gs, "color", arg || null); props = ["color"]; }
    else if (cmd === "highlight") setProp(gs, "background-color", arg || null);
    else if (cmd === "font") { setProp(gs, "font-family", arg || null); props = ["font-family"]; }
    else if (cmd === "size") { setProp(gs, "font-size", pxOfPt(+arg)); props = ["font-size"]; }
    else if (cmd === "grow" || cmd === "shrink") stepSize(gs, cmd === "grow" ? 1 : -1, false);
    else if (cmd === "grow1" || cmd === "shrink1") stepSize(gs, cmd === "grow1" ? 1 : -1, true);
    else return { ok: false, msg: "모르는 명령: " + cmd };
    for (const g of gs) if (g.block.isConnected) tidy(g.block, props);
    if (!whole) selectChars(root, a, a + len);
    else if (caret >= 0) selectChars(root, caret, caret);
    res.msg = CMD[cmd][0] + (res.on === false ? " 끔" : res.mode ? " (" + { upper: "대문자", lower: "소문자", title: "단어 첫 글자 대문자" }[res.mode] + ")" : "") +
      (whole ? " — 글 칸 전체" : "");
    return res;
  }

  // 지금 서식(리본의 눌림·값 표시용) — DOM 을 바꾸지 않는다
  function textState(root, range) {
    const ts = texts(root).filter((t) => t.length);
    if (!ts.length) return null;
    let sel = ts;
    if (range && !range.collapsed) {
      const [a, b] = rangeChars(root, range);
      let n = 0;
      sel = [];
      for (const t of ts) { const s = n, e = n + t.length; n = e; if (e > a && s < b) sel.push(t); }
    } else if (range && range.startContainer.nodeType === 3 && ts.indexOf(range.startContainer) >= 0) sel = [range.startContainer];
    if (!sel.length) sel = ts;
    const solid = sel.filter((t) => t.data.trim());
    if (solid.length) sel = solid;
    const t0 = sel[0], c0 = css(t0.parentNode), bl = blockOf(t0, root), cb = css(bl);
    let mark = null;
    for (let p = t0.parentNode; p && p !== bl && p !== root; p = p.parentNode) { const v = hex(css(p).backgroundColor); if (v) { mark = v; break; } }
    return {
      bold: sel.every((t) => weightOf(t) >= 600), italic: sel.every(italicOf),
      underline: sel.every((t) => linesOf(t, root).has("underline")), strike: sel.every((t) => linesOf(t, root).has("line-through")),
      sup: sel.every((t) => inTag(t, "sup", root)), sub: sel.every((t) => inTag(t, "sub", root)),
      font: c0.fontFamily, pt: r2(parseFloat(c0.fontSize) * PX_PT), color: hex(c0.color), highlight: mark,
      align: alignOf(cb.textAlign), spacing: spacingOf(cb),
    };
  }

  // 글 칸 전체의 크기를 한 값으로(상자를 골랐을 때 크기 칸) — 문단 크기를 바꾸고 안쪽 크기는 걷는다. px 줄 간격은 같은 비로
  function sizeAll(root, pt) {
    const px = parseFloat(pxOfPt(pt));
    for (const bl of blocksIn(root, null)) {
      const fs = parseFloat(css(bl).fontSize) || px, k = px / fs;
      const lh = bl.style.lineHeight;
      if (/^[\d.]+px$/.test(lh)) bl.style.lineHeight = r2(parseFloat(lh) * k) + "px";
      bl.style.fontSize = px + "px";
      for (const el of Array.from(bl.querySelectorAll("[style]"))) if (!fixed(el)) el.style.removeProperty("font-size");
      demoteIn(bl, STRIP_TAGS["font-size"], false);
      tidy(bl, []);
    }
    return { ok: true, msg: "글자 크기 " + r2(pt) + "pt — 글 칸 전체" };
  }

  /* ── 서식 복사 ─────────────────────────────────────────────────── */
  function pickFmt(root, range, box) {
    const st = root ? textState(root, range) : null;
    const bf = box ? Box.pickBoxFmt(box) : { box: null, line: null };
    return {
      text: st && { font: st.font, pt: st.pt, bold: st.bold, italic: st.italic, underline: st.underline, strike: st.strike,
        color: st.color, highlight: st.highlight },
      box: bf.box,
      line: bf.line,
    };
  }

  function applyFmt(fmt, root, range, box) {
    let n = 0;
    const T = fmt && fmt.text;
    if (T && root && total(root)) {
      const whole = !range || range.collapsed;
      const [a, b] = whole ? [0, total(root)] : wholeMarked(root, ...rangeChars(root, range));
      const gs = groups(root, a, b);
      setProp(gs, "font-family", T.font);
      setProp(gs, "font-size", pxOfPt(T.pt));
      setProp(gs, "font-weight", T.bold ? "700" : "400");
      setProp(gs, "font-style", T.italic ? "italic" : "normal");
      setProp(gs, "color", T.color);
      setProp(gs, "background-color", T.highlight);
      const want = new Set([T.underline ? "underline" : "", T.strike ? "line-through" : ""].filter(Boolean));
      setLines(root, gs, () => new Set(want));
      for (const g of gs) if (g.block.isConnected) tidy(g.block, ["font-family", "font-size", "font-weight", "font-style", "color"]);
      if (!whole) selectChars(root, a, b);
      n++;
    }
    if (box && fmt && Box.applyBoxFmt(box, fmt)) n++;
    return n > 0;
  }

  /* ── 찾기·바꾸기 ─────────────────────────────────────────────────── */
  // 글 칸의 글을 한 문자열로(문단 사이에 SEP) — pos[문자열 자리] = 글자 위치(SEP 는 -1)
  function flat(root) {
    let s = "", prev = null, n = 0;
    const pos = [];
    for (const t of texts(root)) {
      const bl = blockOf(t, root);
      if (prev && bl !== prev) { s += SEP; pos.push(-1); }
      prev = bl;
      for (let k = 0; k < t.length; k++) pos.push(n + k);
      s += t.data;
      n += t.length;
    }
    return { s, pos };
  }

  // 캐럿 자리(글자 위치 idx)의 낱말 [a, b) — 오른쪽 글자, 없으면 왼쪽 글자가 든 낱말. 낱말이 아니면 null
  // (서식 복사를 글 위에서 누를 때 PowerPoint 처럼 그 낱말에 입힌다)
  function wordAt(root, idx) {
    const { s, pos } = flat(root);
    const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("ko", { granularity: "word" }) : null;
    const word = /[\p{L}\p{N}_]/u;
    for (const i of [pos.indexOf(idx), pos.indexOf(idx - 1)]) {
      if (i < 0) continue;
      if (seg) {
        for (const g of seg.segment(s)) {
          if (i < g.index || i >= g.index + g.segment.length) continue;
          if (g.isWordLike) return [pos[g.index], pos[g.index + g.segment.length - 1] + 1];
          break;
        }
        continue;
      }
      if (!word.test(s[i])) continue;
      let a = i, b = i + 1;
      while (a > 0 && word.test(s[a - 1])) a--;
      while (b < s.length && word.test(s[b])) b++;
      return [pos[a], pos[b - 1] + 1];
    }
    return null;
  }

  // root 안에서 q 를 찾는다(문단을 넘는 일치는 없다) — [{root, a, b}] (글자 수)
  function find(root, q, matchCase) {
    if (!q) return [];
    const { s, pos } = flat(root);
    let hay = s, needle = q;
    if (!matchCase) {
      const lo = s.toLowerCase();
      if (lo.length === s.length) { hay = lo; needle = q.toLowerCase(); }
    }
    const out = [];
    for (let from = 0; ;) {
      const i = hay.indexOf(needle, from);
      if (i < 0 || !needle.length) break;
      out.push({ root, a: pos[i], b: pos[i + needle.length - 1] + 1 });
      from = i + needle.length;
    }
    return out;
  }

  // [a, b) 를 text 로 — 첫 글의 서식을 이어받는다
  function replaceChars(root, a, b, text) {
    const ts = pick(root, a, b);
    if (!ts.length) return false;
    const bl = blockOf(ts[0], root);
    ts[0].data = text;
    for (let k = 1; k < ts.length; k++) ts[k].remove();
    tidy(bl, []);
    return true;
  }

  function replaceAll(root, q, text, matchCase) {
    const ms = find(root, q, matchCase);
    for (let k = ms.length - 1; k >= 0; k--) replaceChars(root, ms[k].a, ms[k].b, text);
    return ms.length;
  }

  /* ── 단축키 — PowerPoint(Windows)와 같게. 한글 자판에서도 되게 e.code 로 ─────────────────
     Microsoft 도움말 'Use keyboard shortcuts to create PowerPoint presentations'(Windows 표, 2026-10-18 확인) 기준:
     Ctrl+Shift+] · [ 는 한 칸 앞으로 · 뒤로(맨 앞·맨 뒤는 Windows 단축키가 없어 리본으로). Ctrl+] · [(1pt 크게·작게)는 그 표에
     없는 Word 의 키를 덧붙인 것이다. */
  function keyCmd(e) {
    const ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey, c = e.code || "";
    if (!ctrl && !alt && sh && c === "F3") return "case";
    if (alt && !ctrl && !sh && (c === "ArrowLeft" || c === "ArrowRight")) return c === "ArrowRight" ? "rotR15" : "rotL15";
    if (!ctrl || alt) return null;
    if (!sh) {
      return { KeyB: "bold", KeyI: "italic", KeyU: "underline", KeyL: "alignLeft", KeyE: "alignCenter", KeyR: "alignRight",
        KeyJ: "alignJustify", KeyD: "dup", KeyF: "find", KeyH: "replace", Equal: "sub", BracketRight: "grow1",
        BracketLeft: "shrink1", Space: "clear" }[c] || null;
    }
    return { Equal: "sup", NumpadAdd: "sup", Period: "grow", Comma: "shrink", BracketRight: "forward", BracketLeft: "backward",
      KeyC: "fmtCopy", KeyV: "fmtPaste" }[c] || null;
  }

  // Mac 의 Option+←/→ 는 글에서 낱말 단위 이동 — 글을 쓰는 중이면 편집기가 이 키를 브라우저에 맡긴다. 다른 곳의 Alt+← 는
  // 브라우저 '뒤로'라, 글을 쓰는 중에는 돌리지도 않고 막기만 한다(편집 중인 덱을 떠나지 않게)
  const MAC = typeof navigator !== "undefined" &&
    /Mac|iP(hone|ad|od)/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");

  const groupOf = (cmd) => (CMD[cmd] ? CMD[cmd][2] : "");
  const label = (cmd) => (CMD[cmd] ? CMD[cmd][0] + (CMD[cmd][1] ? " (" + CMD[cmd][1] + ")" : "") : cmd);

  // DeckBox 의 이름(배치·도형·색)도 함께 내보낸다 — 편집기는 DeckOps 하나만 부른다
  return Object.freeze(Object.assign({}, Box, {
    PX_PT, SIZES, SPACING, LINE_K, CMD, FONTS, COLORS, HIGHLIGHTS, MAC,
    keyCmd, groupOf, label,
    rangeIn, charIndex, rangeOf, selectChars, wholeMarked, wordAt, textCmd, textState, sizeAll, nextPt, blocksIn,
    pickFmt, applyFmt, find, replaceChars, replaceAll,
  }));
})(DeckBox);

export default DeckOps;
