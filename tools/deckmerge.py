"""빌더 덱 다시 입히기 — 편집기에서 고친 덱(ours)을 그 덱을 만든 옛 빌드(base)·새 빌드(theirs)와 견주어, 고친 곳만 새 빌드에
옮긴다. 원본이 다시 빌드된 덱에 slides sync 가 쓴다.

편집기는 빌더 덱을 저장할 때 본문 끝에 편집 기록을 남긴다(editor/js/edits.js):
  <script type="application/json" id="deck-edits">{"v":1,"build":…,"saved":…,"complete":…,"why":[…]}</script>
  - build: 편집을 시작한 빌드 파일의 git blob sha — 옛 빌드를 git 에서 찾는 열쇠
  - saved: 이 기록을 뺀 파일 글(BOM 없이)의 sha256 — 저장 뒤 편집기 밖에서 바뀌지 않았나
  - complete·why: 편집기만 아는 사정(밖에서 바뀐 파일을 열었다 등)으로 다시 입히면 안 될 때 false 와 그 까닭
그리고 자리만으로는 정체가 어긋나는 상자에 data-hs-ref(정체)를 남긴다. 고친 곳은 적지 않는다 — 세 판을 읽어 단위마다
정규형(태그·속성·디코드한 글)을 견주면, 편집기의 다시 쓰기(따옴표·엔티티·<tbody>)와 상관없이 고친 곳만 드러난다.

단위(빌더도 같은 곳을 바꿨으면 빌더 것을 따르고 알린다)
- 장(data-key): 더하기·지우기·차례, 장 속성(data-i·aria-label·지금 장 표시는 결과 차례로 다시 매김). 편집기에서 고친 장을
  빌더가 없앴거나 열쇠를 바꿨으면 알린다.
- 상자(장의 바로 아래 요소. 정체 'n:이름#k'·'u:태그#k'·'+k'): 고침·지우기·더하기·앞뒤 차례. 옛 빌드와 새 빌드의 상자는 무리
  (이름·태그)마다 글로 짝지어(difflib) 빌더가 상자를 더하거나 빼도 어느 상자인지 놓치지 않는다.
- 노트(#notes-data, 장 열쇠마다), 블록(#deck-layout·#deck-layout-css·#deck-index 통째),
  :root 변수(덱 <style> 마다 이름·몇 번째마다 — 편집기 마스터의 ‘덱 색·글꼴’).
- 쪽 레이아웃 자리 상자는 결과의 설정(#deck-layout)으로 다시 그리고, 'k / N' 쪽 번호·#cnt·차례(#toc)는 결과 차례로 다시
  매긴다(차례는 편집기 rebuildToc 와 같게).
편집기(브라우저)와 이 도구(html.parser)가 장을 다르게 읽으면(닫는 태그가 빠진 HTML 등) 다시 입히지 않고, 고친 곳을 하나도
짚지 못했는데 편집기 판이 옛 빌드와 다르면 그대로 덮지 않는다. 나무는 재귀 없이 걷는다(깊게 겹친 덱도).
"""
from __future__ import annotations

import difflib
import hashlib
import html
import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

BOM = chr(0xFEFF)
LT_ESC = chr(92) + "u003c"                 # JSON 을 <script> 에 넣을 때의 '<'
EDITS_ID = "deck-edits"
EDITS_OPEN = '<script type="application/json" id="deck-edits">'
EDITS_RE = re.compile(re.escape(EDITS_OPEN) + r"([^<]*)</script>")
SHA1_RE = re.compile(r"[0-9a-f]{40}")
SHA256_RE = re.compile(r"[0-9a-f]{64}")
REF_ATTR = "data-hs-ref"
REF_RE = re.compile(r"(?:n:.+|u:[a-z][a-z0-9-]*)#[1-9][0-9]{0,5}|\+[1-9][0-9]{0,5}", re.S)
ZONE_ATTR = "data-deck-layout"
ZONE_POS = ("tl", "tc", "tr", "bl", "bc", "br")
BLOCKS = ("deck-layout-css", "deck-layout", "deck-index")
BLOCK_NAMES = {"deck-layout-css": "쪽 레이아웃 모양", "deck-layout": "쪽 레이아웃 설정", "deck-index": "색인에 더한 말"}
TOC_ID = "toc"                             # 차례 — 장 차례·제목에서 나오는 것이라 견주지 않고 결과로 다시 짓는다
DERIVED = frozenset({"data-i", "aria-label"})
ON_CLASSES = ("on", "active", "current", "present")
PAGE_RE = re.compile(r"\s*([0-9]{1,4})\s*/\s*([0-9]{1,4})\s*")       # JS \d 처럼 0-9 만
WS_RUN_RE = re.compile(r"\s+")
LABEL_NUM_RE = re.compile(r"([0-9]{1,4})\.\s+")
DIGITS_RE = re.compile(r"&#?[0-9A-Za-z]+;|[0-9]{1,4}")
VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
ROOT_RE = re.compile(r":root((?:[:\[][^{};]*)?)\s*\{([^{}]*)\}")
DECL_RE = re.compile(r"(--[A-Za-z0-9_-]+)\s*:\s*([^;}]*)")
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
WS = " \t\n\r\f"
# 쪽 레이아웃 설정(editor/js/pagelayout.js 의 normalize·zonesFor 와 같게)
PAGE_FORMATS = ("{n}", "{n} / {N}", "{n}/{N}", "- {n} -", "p. {n}", "{n}쪽")
LOGO_ID_RE = re.compile(r"[a-z0-9]{1,12}")
LOGO_RE = re.compile(r'\.hsl-logo-([a-z0-9]{1,12})\{[^{}]*?background-image:url\("([^"]+)"\)')
DATA_URL_RE = re.compile(r"data:image/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/]+=*")
MAX_LOGOS = 6
# 빌더 상자 이름 → 알림에 쓸 이름(editor/js/master.js 의 ROLE_NAMES)
ROLE_NAMES = {"title": "제목", "kicker": "소제목", "subtitle": "부제", "lede": "리드", "body": "본문", "source": "출처",
              "pageno": "쪽 번호", "footer": "꼬리말", "caveat": "단서", "note": "메모", "caption": "그림 설명", "label": "이름표"}
TAG_NAMES = {"img": "그림", "svg": "도표", "table": "표", "video": "동영상", "picture": "그림", "figure": "그림"}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def blob_sha(data: bytes) -> str:
    """git 이 이 바이트를 blob 으로 담을 때의 이름(sha1)."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def read_edits(text: str) -> tuple[dict | None, str]:
    """덱 글(BOM 없이)의 편집 기록과, 기록 요소를 뺀 글. 기록이 없거나 둘 이상이거나 꼴이 틀리면 (None, 글 그대로)."""
    found = list(EDITS_RE.finditer(text))
    if len(found) != 1:
        return None, text
    m = found[0]
    try:
        ov = json.loads(m.group(1))
    except (ValueError, RecursionError):        # 깊게 겹친 JSON 은 RecursionError
        return None, text
    if not (isinstance(ov, dict) and ov.get("v") == 1 and isinstance(ov.get("build"), str)
            and SHA1_RE.fullmatch(ov["build"]) and isinstance(ov.get("saved"), str) and SHA256_RE.fullmatch(ov["saved"])
            and isinstance(ov.get("complete"), bool) and isinstance(ov.get("why", []), list)):
        return None, text
    return ov, text[:m.start()] + text[m.end():]


def saved_ok(plain: str, saved: str) -> bool:
    """기록의 saved 가 이 글(기록을 뺀 것)과 맞는가 — 줄바꿈만 바뀐 것(slides edit 이 파일의 줄바꿈에 맞춰 쓴 것)도
    맞는 것으로 본다(편집기의 글은 줄바꿈이 모두 LF 이거나 모두 CRLF)."""
    if sha256_text(plain) == saved:
        return True
    lf = plain.replace("\r\n", "\n")
    return sha256_text(lf) == saved or sha256_text(lf.replace("\n", "\r\n")) == saved


def record_of(data: bytes) -> dict | None:
    """파일 바이트에 든 편집 기록(꼴만 본다 — 글과 맞는지는 edits_of). 없거나 읽을 수 없으면 None."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return read_edits(text.removeprefix(BOM))[0]


def edits_of(data: bytes) -> dict | None:
    """파일 바이트의 편집 기록 — 저장 뒤 편집기 밖에서 바뀌지 않은(saved 가 맞는) 것만. 아니면 None."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    text = text.removeprefix(BOM)
    ov, plain = read_edits(text)
    if ov is None or not saved_ok(plain, ov["saved"]):
        return None
    return ov


def edits_json(build: str, saved: str, complete: bool = True, why: list[str] | None = None) -> str:
    body = json.dumps({"v": 1, "build": build, "saved": saved, "complete": complete, "why": why or []},
                      ensure_ascii=False, separators=(",", ":"))
    return f"{EDITS_OPEN}{body.replace('<', LT_ESC)}</script>"


END_BODY_RE = re.compile(r"[ \t\n\r\f]*</body\s*>", re.I)


def stamp(text: str, build: str, complete: bool = True, why: list[str] | None = None) -> str:
    """덱 글(BOM·기록 없이)에 편집 기록을 넣은 글 — 편집기처럼 </body> 앞 공백보다 앞에(없으면 끝에)."""
    ends = list(END_BODY_RE.finditer(text))
    at = ends[-1].start() if ends else len(text.rstrip(WS))
    return text[:at] + edits_json(build, sha256_text(text), complete, why) + text[at:]


# ---------------------------------------------------------------- 읽기(자리 붙은 나무)

class Node:
    __slots__ = ("tag", "attrs", "start", "inner", "close", "end", "kids", "parent", "raw", "foreign")

    def __init__(self, tag: str, attrs: list[tuple[str, str]], start: int, inner: int, parent: "Node | None",
                 raw: str = "", foreign: bool = False):
        self.tag = tag
        self.attrs = attrs
        self.start = start          # '<' 자리
        self.inner = inner          # 여는 태그 바로 뒤
        self.close = inner          # 닫는 태그 '</' 자리(없으면 끝)
        self.end = inner            # 닫는 태그 바로 뒤
        self.kids: list = []
        self.parent = parent
        self.raw = raw              # 여는 태그 글 그대로
        self.foreign = foreign      # svg·math 안

    def get(self, name: str, default: str | None = None) -> str | None:
        for k, v in self.attrs:
            if k == name:
                return v
        return default

    def elements(self) -> list["Node"]:
        return [k for k in self.kids if isinstance(k, Node)]

    def classes(self) -> list[str]:
        return (self.get("class") or "").split()

    def walk(self):
        """아래 요소들을 문서 차례로 — 재귀 없이(닫는 태그 없이 겹친 목록·표처럼 깊은 덱도)."""
        stack = [iter(self.kids)]
        while stack:
            k = next(stack[-1], None)
            if k is None:
                stack.pop()
            elif isinstance(k, Node):
                yield k
                stack.append(iter(k.kids))


class Text:
    __slots__ = ("data", "start", "end")

    def __init__(self, data: str, start: int):
        self.data = data
        self.start = start
        self.end = start


class Comment:
    __slots__ = ("data", "start", "end")

    def __init__(self, data: str, start: int, end: int):
        self.data = data
        self.start = start
        self.end = end


class _Parser(HTMLParser):
    def __init__(self, text: str):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0]
        self.lines.extend(m.end() for m in re.finditer("\n", text))
        self.root = Node("#document", [], 0, 0, None)
        self.stack = [self.root]
        self.ids: dict[str, Node] = {}
        self.pending: Text | None = None

    def _pos(self) -> int:
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def _mark(self, at: int) -> None:
        if self.pending is not None:
            self.pending.end = at
            self.pending = None

    def _open(self, tag: str, attrs, closed: bool) -> None:
        at = self._pos()
        self._mark(at)
        raw = self.get_starttag_text() or ""
        seen: set[str] = set()
        clean: list[tuple[str, str]] = []
        for k, v in attrs:
            if k in seen:                      # 같은 이름이 둘이면 브라우저처럼 앞의 것만
                continue
            seen.add(k)
            clean.append((k, "" if v is None else v))
        parent = self.stack[-1]
        node = Node(tag, clean, at, at + len(raw), parent, raw, parent.foreign or tag in ("svg", "math"))
        parent.kids.append(node)
        i = node.get("id")
        if i and i not in self.ids:
            self.ids[i] = node
        if closed or tag in VOID:
            node.close = node.end = node.inner
        else:
            self.stack.append(node)

    def handle_starttag(self, tag, attrs):
        self._open(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        # <x/> 는 svg·math 안에서만 닫힌다 — HTML 의 <div/> 는 브라우저처럼 열린 채로
        self._open(tag, attrs, self.stack[-1].foreign or tag in ("svg", "math"))

    def handle_endtag(self, tag):
        at = self._pos()
        self._mark(at)
        gt = self.text.find(">", at)
        end = len(self.text) if gt < 0 else gt + 1
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                for n in self.stack[i + 1:]:       # 사이에 열린 채 남은 것은 여기서 닫힌 것으로
                    n.close = n.end = at
                node = self.stack[i]
                node.close, node.end = at, end
                del self.stack[i:]
                return

    def handle_data(self, data):
        kids = self.stack[-1].kids
        if self.pending is not None and kids and kids[-1] is self.pending:
            self.pending.data += data              # '<' 하나 같은 조각으로 나뉘어 온 글
            return
        at = self._pos()
        self._mark(at)
        t = Text(data, at)
        kids.append(t)
        self.pending = t

    def handle_comment(self, data):
        at = self._pos()
        self._mark(at)
        e = self.text.find("-->", at + 4)
        self.stack[-1].kids.append(Comment(data, at, len(self.text) if e < 0 else e + 3))

    def handle_decl(self, decl):
        self._mark(self._pos())

    def handle_pi(self, data):
        self._mark(self._pos())

    def unknown_decl(self, data):
        self._mark(self._pos())


class Doc:
    """읽은 덱 — 글, 나무, id 표, 빌더 덱이면 장들(#stage > section.slide)과 그 열쇠."""

    def __init__(self, text: str):
        p = _Parser(text)
        p.feed(text)
        p.close()
        p._mark(len(text))
        for n in p.stack[1:]:
            n.close = n.end = len(text)
        self.text = text
        self.root = p.root
        self.ids = p.ids
        top = next((n for n in self.root.elements() if n.tag == "html"), None)
        scope = top or self.root
        self.head = next((n for n in scope.elements() if n.tag == "head"), None)
        self.body = next((n for n in scope.elements() if n.tag == "body"), None)
        stage = self.ids.get("stage")
        ok = stage is not None and "stage" in stage.classes() and "notes-data" in self.ids
        self.stage = stage if ok else None
        self.slides = ([n for n in stage.elements() if n.tag == "section" and "slide" in n.classes()]
                       if self.stage is not None else [])
        self.keys = [_norm(s.get("data-key") or "") for s in self.slides]
        self.by_key = dict(zip(self.keys, self.slides))

    def span(self, n) -> str:
        return self.text[n.start:n.end]

    def inside_stage(self, n: Node) -> bool:
        p = n.parent
        while p is not None:
            if p is self.stage:
                return True
            p = p.parent
        return False


def _norm(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def clean_text(s: str | None) -> str:
    """편집기 clean() 과 같게 — 이어진 공백은 하나로, 앞뒤 공백은 뗀다."""
    return re.sub(r"\s+", " ", s or "").strip()


JS_NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def _js_int(v: str | None) -> int | None:
    """JS Number(v) 가 정수이면 그 값(차례의 data-go) — 빈 글은 0, 0x·0o·0b 도 읽는다."""
    s = (v or "").strip()
    if not s:
        return 0
    m = re.fullmatch(r"0([xXoObB])([0-9A-Fa-f]+)", s)
    if m:
        try:
            return int(m.group(2), {"x": 16, "o": 8, "b": 2}[m.group(1).lower()])
        except ValueError:
            return None
    if not JS_NUM_RE.fullmatch(s):
        return None
    n = float(s)
    return int(n) if n.is_integer() else None


def canon(node: Node, skip: frozenset[str] = frozenset()) -> tuple:
    """견줄 꼴 — 태그·속성(이름은 소문자, 값은 디코드)·글(디코드, 줄바꿈은 \\n)·주석. 브라우저가 끼우는 <tbody>(속성
    없는 것)는 풀고, <pre> 첫 줄바꿈은 뺀다(브라우저가 읽을 때 버림). skip 은 견주지 않을 속성. 문서 차례의 납작한 토큰
    열로 낸다 — 여는 표시 ("<", 태그, 속성)·글 ("#t", 글)·주석 ("#c", 글)·닫는 표시 (">",). 겹친 튜플은 깊으면 견줄 때 재귀
    한도에 걸리고 해시하다 파이썬이 죽는다(닫는 태그 없는 <li> 수천 개). 재귀 없이 — 요소마다 [요소, (아이들 차례, 그
    부모)…, 아이들이 시작하는 자리] 를 쌓는다(푼 <tbody> 의 아이들은 표의 것으로 잇는다)."""
    out: list[tuple] = [("<", node.tag, tuple((a, _norm(v)) for a, v in node.attrs if a not in skip))]
    stack: list[list] = [[node, [(iter(node.kids), node)], len(out)]]
    while stack:
        n, its, first = stack[-1]
        k = next(its[-1][0], None)
        if k is None:
            if len(its) > 1:
                its.pop()
                continue
            stack.pop()
            if n.tag in ("pre", "textarea", "listing") and len(out) > first and out[first][0] == "#t" \
                    and out[first][1].startswith("\n"):
                rest = out[first][1][1:]
                if rest:
                    out[first] = ("#t", rest)
                else:
                    del out[first]
            out.append((">",))
            continue
        parent = its[-1][1]
        if isinstance(k, Text):
            data = _norm(k.data)
            if parent.foreign and parent.tag in ("style", "script"):
                data = html.unescape(data)        # svg 안의 style·script 글은 브라우저가 엔티티를 푼다
            if len(out) > first and out[-1][0] == "#t":     # 같은 요소 안에서 이어진 글(아이 요소 뒤면 '>' 가 끝)
                out[-1] = ("#t", out[-1][1] + data)
            else:
                out.append(("#t", data))
        elif isinstance(k, Comment):
            out.append(("#c", _norm(k.data)))
        elif k.tag == "tbody" and not k.attrs and parent.tag == "table" and not parent.foreign:
            its.append((iter(k.kids), k))
        else:
            out.append(("<", k.tag, tuple((a, _norm(v)) for a, v in k.attrs if a not in skip)))
            stack.append([k, [(iter(k.kids), k)], len(out)])
    return tuple(out)


BOX_SKIP = frozenset({REF_ATTR})


def canon_box(n: Node) -> tuple:
    return canon(n, BOX_SKIP)


def is_zone(n: Node) -> bool:
    return n.tag == "div" and "hsl" in n.classes() and n.get(ZONE_ATTR) in ZONE_POS


def group_of(n: Node) -> str:
    name = n.get("data-name")
    return f"n:{_norm(name)}" if name is not None else f"u:{n.tag}"


def slide_attrs_of(n: Node) -> dict[str, str]:
    """견줄 장 속성 — 결과 차례로 다시 매기는 것(data-i·aria-label)과 지금 장 표시(class 의 on 등)는 빼고. 속성 차례는
    보지 않는다(편집기에서 뺐다 다시 단 속성은 끝으로 간다). class 는 classList 처럼 겹친 이름을 하나로."""
    out = {}
    for k, v in n.attrs:
        if k in DERIVED:
            continue
        if k == "class":
            v = " ".join(dict.fromkeys(c for c in v.split() if c not in ON_CLASSES))
        out[k] = _norm(v)
    return out


def boxes(slide: Node) -> list[tuple[str, Node]]:
    """장의 상자들과 그 정체 — 표식(data-hs-ref)이 있으면 그것, 없으면 표식 없는 상자끼리 DOM 차례로 센 자리.
    쪽 레이아웃 자리 상자는 뺀다. 같은 정체가 또 나오면(손으로 고친 파일) 뒤의 것은 '~k' 를 붙여 새 상자로 다룬다."""
    counts: dict[str, int] = {}
    seen: set[str] = set()
    out: list[tuple[str, Node]] = []
    for n in slide.elements():
        if is_zone(n):
            continue
        ref = n.get(REF_ATTR)
        if ref is not None and REF_RE.fullmatch(ref):
            ident = ref
        else:
            g = group_of(n)
            counts[g] = counts.get(g, 0) + 1
            ident = f"{g}#{counts[g]}"
        if ident in seen:
            k = 1
            while f"{ident}~{k}" in seen:
                k += 1
            ident = f"{ident}~{k}"
        seen.add(ident)
        out.append((ident, n))
    return out


def texts_in(n: Node):
    """요소 안의 글 조각들 — 문서 차례로, 재귀 없이."""
    stack = [iter(n.kids)]
    while stack:
        k = next(stack[-1], None)
        if k is None:
            stack.pop()
        elif isinstance(k, Text):
            yield k
        elif isinstance(k, Node):
            stack.append(iter(k.kids))


def text_content(n: Node) -> str:
    return "".join(t.data for t in texts_in(n))


def style_text(n: Node) -> str:
    return "".join(k.data for k in n.kids if isinstance(k, Text))


# ---------------------------------------------------------------- :root 변수(editor/js/master.js 와 같게)

def mask_comments(text: str) -> str:
    return COMMENT_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def vars_of(text: str) -> dict[tuple[str, int], str]:
    """<style> 글의 :root 변수 — (이름, 그 <style> 안에서 같은 이름의 몇 번째) → 값(앞뒤 공백 뺌)."""
    masked = mask_comments(text)
    seen: dict[str, int] = {}
    out: dict[tuple[str, int], str] = {}
    for block in ROOT_RE.finditer(masked):
        for d in DECL_RE.finditer(block.group(2)):
            name = d.group(1)
            seen[name] = seen.get(name, 0) + 1
            out[(name, seen[name])] = d.group(2).strip()
    return out


def with_var(text: str, name: str, dup: int, value: str) -> str:
    masked = mask_comments(text)
    n = 0
    for block in ROOT_RE.finditer(masked):
        body = block.start() + block.group(0).index("{") + 1
        for d in DECL_RE.finditer(block.group(2)):
            if d.group(1) != name:
                continue
            n += 1
            if n != dup:
                continue
            start = body + d.start(2)
            end = start + len(d.group(2))
            tail = re.search(r"\s*\Z", d.group(2)).group(0)
            return f"{text[:start]}{value}{tail}{text[end:]}"
    return text


def mask_vars(text: str) -> str:
    """:root 변수 값을 지운 글 — 변수 밖의 CSS 가 바뀌었나 견줄 때."""
    masked = mask_comments(text)
    out, last = [], 0
    for block in ROOT_RE.finditer(masked):
        body = block.start() + block.group(0).index("{") + 1
        for d in DECL_RE.finditer(block.group(2)):
            s = body + d.start(2)
            out.append(masked[last:s])
            last = s + len(d.group(2))
    out.append(masked[last:])
    return _norm("".join(out))


def deck_styles(doc: Doc) -> list[Node]:
    """덱의 <style> 가운데 장 안에 들지 않고 쪽 레이아웃 모양(#deck-layout-css)이 아닌 것 — 편집기 마스터가 고치는 차례."""
    return [n for n in doc.root.walk()
            if n.tag == "style" and not n.foreign and n.get("id") != "deck-layout-css" and not doc.inside_stage(n)]


# ---------------------------------------------------------------- 쪽 레이아웃 자리 상자(editor/js/pagelayout.js 와 같게)

def _plain(v, limit: int) -> str:
    if not isinstance(v, str):
        return ""
    s = re.sub(r"\s+", " ", v).strip()
    keep = [c for c in s if ord(c) >= 32 and ord(c) != 127 and not 0x80 <= ord(c) < 0xA0]
    return "".join(keep[:limit]).strip()


def _num(v, lo: float, hi: float, dflt: float) -> float:
    if isinstance(v, bool):
        return dflt
    if isinstance(v, (int, float)):
        n = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            n = float(v)
        except ValueError:
            return dflt
    else:
        return dflt
    if n != n or n in (float("inf"), float("-inf")):
        return dflt
    return min(hi, max(lo, n))


def _js_round(x: float) -> int:
    return int(x // 1 + (1 if x % 1 >= 0.5 else 0))


def layout_settings(doc_text: str, json_node: Node | None, css_node: Node | None) -> dict | None | bool:
    """쪽 레이아웃 설정 — 없으면 None, 읽을 수 없으면 False(자리 상자를 건드리지 않는다), 읽으면 자리 상자에 쓸 값."""
    if json_node is None:
        return None
    if json_node.tag != "script" or (json_node.get("type") or "").strip().lower() != "application/json":
        return False
    if css_node is not None and css_node.tag != "style":
        return False
    try:
        raw = json.loads(style_text(json_node))
    except (ValueError, RecursionError):
        return False
    if not isinstance(raw, dict) or raw.get("v") != 1:
        return False

    def obj(v):
        return v if isinstance(v, dict) else {}

    def boolean(v, d):
        return v if isinstance(v, bool) else d

    def pos(v, d):
        return v if v in ZONE_POS else d

    p, f = obj(raw.get("page")), obj(raw.get("foot"))
    images = {m.group(1) for m in LOGO_RE.finditer(style_text(css_node) if css_node is not None else "")
              if DATA_URL_RE.fullmatch(m.group(2))}
    logos, seen = [], set()
    for l0 in raw.get("logos") if isinstance(raw.get("logos"), list) else []:
        lg = obj(l0)
        i = lg.get("id")
        if not isinstance(i, str) or not LOGO_ID_RE.fullmatch(i) or i in seen:
            continue
        seen.add(i)
        logos.append({"id": i, "alt": _plain(lg.get("alt"), 100), "pos": pos(lg.get("pos"), "tr"),
                      "cover": boolean(lg.get("cover"), True)})
        if len(logos) >= MAX_LOGOS:
            break
    return {
        "page": {"on": boolean(p.get("on"), False), "fmt": p.get("fmt") if p.get("fmt") in PAGE_FORMATS else "{n} / {N}",
                 "pos": pos(p.get("pos"), "br"), "cover": boolean(p.get("cover"), False),
                 "start": _js_round(_num(p.get("start"), 0, 999, 1))},
        "foot": {"on": boolean(f.get("on"), False), "text": _plain(f.get("text"), 200), "pos": pos(f.get("pos"), "bl"),
                 "cover": boolean(f.get("cover"), False)},
        "logos": [lg for lg in logos if lg["id"] in images],
    }


def _esc_text(s: str) -> str:
    return s.replace("&", "&amp;").replace(chr(0xA0), "&nbsp;").replace("<", "&lt;").replace(">", "&gt;")


def _esc_attr(s: str) -> str:
    return s.replace("&", "&amp;").replace(chr(0xA0), "&nbsp;").replace('"', "&quot;")


def page_text(page: dict, i: int, n: int) -> str:
    return page["fmt"].replace("{n}", str(i + page["start"]), 1).replace("{N}", str(n + page["start"] - 1), 1)


def zones_html(s: dict, i: int, n: int) -> str:
    """i 번째 장(n 장 가운데)의 자리 상자들 — 편집기 zonesFor 가 그리는 것과 같은 글."""
    cover = i == 0
    items: dict[str, list[str]] = {}
    for lg in s["logos"]:
        if cover and not lg["cover"]:
            continue
        aria = f' role="img" aria-label="{_esc_attr(lg["alt"])}"' if lg["alt"] else ' aria-hidden="true"'
        items.setdefault(lg["pos"], []).append(f'<span class="hsl-logo hsl-logo-{lg["id"]}"{aria}></span>')
    foot = s["foot"]
    if foot["on"] and foot["text"] and (not cover or foot["cover"]):
        items.setdefault(foot["pos"], []).append(f'<span class="hsl-foot">{_esc_text(foot["text"])}</span>')
    page = s["page"]
    if page["on"] and (not cover or page["cover"]):
        items.setdefault(page["pos"], []).append(f'<span class="hsl-page">{_esc_text(page_text(page, i, n))}</span>')
    return "".join(f'<div class="hsl hsl-{k}" {ZONE_ATTR}="{k}">{"".join(items[k])}</div>' for k in ZONE_POS if k in items)


# ---------------------------------------------------------------- 쪽 번호('k / N')

def _pad_like(orig: str, v: int) -> str:
    return str(v).rjust(len(orig), "0") if len(orig) > 1 and orig[0] == "0" else str(v)


def _short_texts(nodes: list[Node], most: int = 9) -> dict[int, str | None]:
    """nodes(한 요소와 그 아래 요소들, 문서 차례)의 요소마다 글 — 공백 덩어리는 한 칸으로 줄이고, 공백 아닌 글자가 most 보다
    많으면 None. 'k / N' 은 공백 아닌 글자가 많아야 9자(숫자 넷·'/'·숫자 넷)라 판정은 같다. 아래에서 위로 한 번만 훑어(자식의
    짧은 글을 이어 붙임) 깊게 겹친 상자에서도 요소마다 글 전체를 다시 모으지 않는다. 열쇠는 id(요소)."""
    out: dict[int, str | None] = {}
    for e in reversed(nodes):                   # 문서 차례를 거꾸로 — 자식이 부모보다 먼저 온다
        parts = []
        for k in e.kids:
            if isinstance(k, Text):
                parts.append(k.data)
            elif isinstance(k, Node):
                parts.append(out[id(k)])
        if None in parts:
            out[id(e)] = None
            continue
        s = WS_RUN_RE.sub(" ", "".join(parts))
        out[id(e)] = s if len(s) - s.count(" ") <= most else None
    return out


def _page_targets(node: Node, frm: tuple[int, int]) -> list[Node]:
    """node 안(자신 포함)에서 글 전체가 정확히 frm('k / N')인 가장 작은 요소들 — 편집기 pageEls 와 같게. 아래에 다른
    후보가 든 후보는 뺀다(문서 차례를 거꾸로 훑으며 후보의 부모에 표시해 올린다 — 후보끼리 견주지 않게)."""
    nodes = [node, *node.walk()]
    texts = _short_texts(nodes)

    def hit(e: Node) -> bool:
        text = texts[id(e)]
        m = PAGE_RE.fullmatch(text) if text is not None and len(e.elements()) <= 4 else None
        return bool(m) and (int(m.group(1)), int(m.group(2))) == frm

    cands = {id(e) for e in nodes if hit(e)}
    above: set[int] = set()                     # 아래 어딘가에 후보가 든 요소
    for e in reversed(nodes):
        if e.parent is not None and (id(e) in cands or id(e) in above):
            above.add(id(e.parent))
    return [e for e in nodes if id(e) in cands and id(e) not in above]


def renumbered(doc: Doc, node: Node, frm: tuple[int, int], to: tuple[int, int]) -> str:
    """상자 글 — 그 안의 쪽 번호 'k / N'(frm)을 to 로 다시 매긴 것. 엔티티 안의 숫자는 건드리지 않는다."""
    text = doc.span(node)
    if frm == to:
        return text
    reps: list[tuple[int, int, str]] = []
    for e in _page_targets(node, frm):
        idx = 0
        for t in texts_in(e):
            raw = doc.text[t.start:t.end]
            out, last = [], 0
            for m in DIGITS_RE.finditer(raw):
                if m.group(0).startswith("&"):
                    continue
                idx += 1
                if idx > 2:
                    continue
                out.append(raw[last:m.start()])
                out.append(_pad_like(m.group(0), to[0] if idx == 1 else to[1]))
                last = m.end()
            if out:
                out.append(raw[last:])
                reps.append((t.start - node.start, t.end - node.start, "".join(out)))
    for s, e, new in sorted(reps, reverse=True):
        text = text[:s] + new + text[e:]
    return text


# ---------------------------------------------------------------- 다시 입히기

@dataclass
class Result:
    text: str | None = None          # 다시 입힌 덱(BOM·기록 포함) — None 이면 쓰지 않는다
    edits: bool = False              # 편집기에서 고친 곳이 있었는가(없으면 새 빌드를 그대로 올리면 된다)
    applied: list[str] = field(default_factory=list)   # 다시 입힌 것(사람이 읽을 요약)
    kept: list[str] = field(default_factory=list)      # 빌더도 바꿔 빌더 것을 따른 곳
    refused: str = ""                # 다시 입히지 않은 까닭(이때 text 는 None)


def _decode(data: bytes) -> tuple[str, bool]:
    text = data.decode("utf-8")
    return text.removeprefix(BOM), text.startswith(BOM)


def reapply(base: bytes, ours: bytes, theirs: bytes) -> Result:
    """옛 빌드·편집기에서 고친 판·새 빌드 → 새 빌드에 고친 것을 다시 입힌 판."""
    try:
        tb, _ = _decode(base)
        to, _ = _decode(ours)
        tt, bom = _decode(theirs)
    except UnicodeDecodeError:
        return Result(refused="UTF-8 로 읽히지 않는 판이 있어 다시 입히지 않았습니다")
    ov, to_plain = read_edits(to)
    if ov is None or not saved_ok(to_plain, ov["saved"]):
        return Result(refused="저장소 판의 편집 기록이 없거나 맞지 않습니다(편집기 밖에서 바뀜)")
    if read_edits(tt)[0] is not None:
        return Result(refused="새 판에도 편집 기록이 있어(원본을 편집기로 고침) 빌드가 아닙니다")
    try:
        docs = []
        for text, what in ((tb, "옛 빌드"), (to_plain, "저장소 판"), (tt, "새 빌드")):
            d = Doc(text)
            if d.stage is None or not d.slides:
                return Result(refused=f"{what}가 빌더 덱 꼴(#stage 안의 section.slide·#notes-data)이 아닙니다")
            if any(not k for k in d.keys) or len(set(d.keys)) != len(d.keys):
                return Result(refused=f"{what}의 장 열쇠(data-key)가 비었거나 겹칩니다")
            docs.append(d)
        return _Merge(*docs, theirs_bytes=theirs, bom=bom).run()
    except RecursionError:                      # 걷기는 재귀가 없지만 — 혹시 남은 깊은 곳(정규식·JSON 등)에서
        return Result(edits=True, refused="덱이 너무 깊게 겹쳐 있어 다시 입히지 않았습니다")


class _Merge:
    def __init__(self, B: Doc, O: Doc, T: Doc, theirs_bytes: bytes, bom: bool):
        self.B, self.O, self.T = B, O, T
        self.theirs_bytes = theirs_bytes
        self.bom = bom
        self.reps: list[tuple[int, int, int, str]] = []     # (시작, 끝, 같은 자리의 차례, 새 글) — T 글의 자리
        self.counts: dict[str, int] = {}
        self.kept: list[str] = []
        self.edits = False
        self.memo: dict[tuple[int, int], tuple] = {}
        self.notes_memo: dict[int, dict[str, str] | None] = {}
        self.titles: dict[str, str] = {}                    # 장 열쇠 → 결과의 data-title(차례를 다시 지을 때)

    # ---- 알림
    def count(self, what: str, n: int = 1) -> None:
        self.counts[what] = self.counts.get(what, 0) + n
        self.edits = True

    def keep(self, msg: str) -> None:
        self.kept.append(msg)
        self.edits = True

    def slide_name(self, key: str) -> str:
        for d in (self.T, self.O, self.B):
            if key in d.by_key:
                title = re.sub(r"\s+", " ", d.by_key[key].get("data-title") or "").strip()
                if len(title) > 24:
                    title = title[:23] + "…"
                return f"{d.keys.index(key) + 1}장" + (f" 「{title}」" if title else "")
        return key

    @staticmethod
    def box_name(ident: str) -> str:
        if ident.startswith("+"):
            return "새 상자"
        m = re.fullmatch(r"(n|u):(.*)#(\d+)(?:~\d+)?", ident, re.S)
        if not m:
            return ident
        kind, name, k = m.groups()
        label = (ROLE_NAMES.get(name, name) if kind == "n" else TAG_NAMES.get(name, f"<{name}>"))
        return f"{label} 상자" + (f" {k}" if k != "1" else "")

    # ---- 견주기(쪽 번호 차이는 빼고)
    def canon_at(self, d: Doc, node: Node, key: str) -> tuple:
        """상자 정규형 — 그 장의 쪽 번호('k / N')를 옛 빌드의 차례로 맞춰서. 장을 더하거나 지워 바뀐 번호는 고친 것이 아니다."""
        memo = self.memo.get((id(d), id(node)))
        if memo is not None:
            return memo
        frm, to = self.pos_in(d, key), self.pos_in(self.B, key)
        got = canon_box(node)
        if frm != to and to != (0, 0):
            text = renumbered(d, node, frm, to)
            if text != d.span(node):
                el = next(iter(Doc(text).root.elements()), None)
                if el is not None:
                    got = canon_box(el)
        self.memo[(id(d), id(node))] = got
        return got

    def slide_same(self, d: Doc, key: str, ref: Doc | None = None) -> bool:
        """d 의 이 장이 ref(기본은 옛 빌드)의 이 장과 같은가 — 장 속성(차례에서 매기는 것 빼고)·상자들(쪽 번호는 옛 빌드의
        차례로 맞춰)·노트(옛 빌드·둘 다 읽힐 때)."""
        ref = ref or self.B
        b, x = ref.by_key[key], d.by_key[key]
        if slide_attrs_of(b) != slide_attrs_of(x):
            return False
        bb, xb = boxes(b), boxes(x)
        if [i for i, _ in bb] != [i for i, _ in xb]:
            return False
        if not all(self.canon_at(ref, nb, key) == self.canon_at(d, nx, key) for (_, nb), (_, nx) in zip(bb, xb)):
            return False
        n0, nb, nx = self.notes(self.B), self.notes(ref), self.notes(d)
        return n0 is None or nb is None or nx is None or nb.get(key) == nx.get(key)

    def notes(self, d: Doc) -> dict[str, str] | None:
        if id(d) not in self.notes_memo:
            self.notes_memo[id(d)] = self.notes_of(d)
        return self.notes_memo[id(d)]

    def same_slide(self, key: str) -> bool:
        """빌더가 이 장을 그대로 두었나(노트까지)."""
        return self.slide_same(self.T, key)

    def align(self, key: str) -> tuple[dict[str, str], set[str]]:
        """옛 빌드의 상자 → 새 빌드의 같은 상자(정체 → 정체)와, 짝 없는 새 상자가 남은 무리. 무리(이름·태그)마다 글이 같은
        것끼리 짝짓고(difflib), 그 사이에서 수가 같은 바뀐 구간은 자리대로(빌더가 그 자리에서 고친 것으로) 짝짓고, 차례만 바뀐
        같은 상자도 짝짓는다. 짝이 없는 옛 상자는 빌더가 없앴거나, 그 무리에 짝 없는 새 상자가 남았으면 바꿨을 수도 있다."""
        groups: dict[str, tuple[list, list]] = {}
        for i, n in boxes(self.B.by_key[key]):
            groups.setdefault(group_of(n), ([], []))[0].append((i, n))
        for i, n in boxes(self.T.by_key[key]):
            groups.setdefault(group_of(n), ([], []))[1].append((i, n))
        pair: dict[str, str] = {}
        loose: set[str] = set()
        for g, (bs, ts) in groups.items():
            cb = [canon_box(n) for _, n in bs]
            ct = [self.canon_at(self.T, n, key) for _, n in ts]
            left_b: list[int] = []
            left_t: list[int] = []
            for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, cb, ct, autojunk=False).get_opcodes():
                if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
                    for a, b in zip(range(i1, i2), range(j1, j2)):
                        pair[bs[a][0]] = ts[b][0]
                else:
                    left_b.extend(range(i1, i2))
                    left_t.extend(range(j1, j2))
            for a in list(left_b):                          # 차례만 바뀐 같은 상자 — 같은 글이 저마다 하나뿐일 때
                hits = [b for b in left_t if ct[b] == cb[a]]
                if len(hits) == 1 and sum(cb[x] == cb[a] for x in left_b) == 1:
                    pair[bs[a][0]] = ts[hits[0]][0]
                    left_b.remove(a)
                    left_t.remove(hits[0])
            if left_t:
                loose.add(g)
        return pair, loose

    # ---- 장 차례
    def slide_sequence(self) -> list[str]:
        Kb, Ko, Kt = self.B.keys, self.O.keys, self.T.keys
        sb, so = set(Kb), set(Ko)
        seq = list(Kt)
        for k in Kb:                                         # 편집기에서 고친 장을 빌더가 없앴거나 열쇠를 바꿈
            if k in so and k not in seq and not self.slide_same(self.O, k):
                self.keep(f"{self.slide_name(k)} — 편집기에서 고쳤지만 빌더가 그 장을 없앴거나 장 열쇠(data-key)를 바꿔 "
                          "고친 것을 다시 입히지 못했습니다")
        for k in Kb:                                         # 편집기에서 지운 장
            if k in so or k not in seq:
                continue
            if self.same_slide(k):
                seq.remove(k)
                self.count("지운 장")
            else:
                self.keep(f"{self.slide_name(k)} — 편집기에서 지웠지만 빌더가 그 장을 고쳐 남겼습니다")
        common = [k for k in seq if k in sb and k in so]     # 편집기에서 바꾼 장 차례
        cs = set(common)
        ob, oo, ot = [k for k in Kb if k in cs], [k for k in Ko if k in cs], [k for k in Kt if k in cs]
        if oo != ob:
            if ot == ob:
                slots = [i for i, k in enumerate(seq) if k in cs]
                for i, k in zip(slots, oo):
                    seq[i] = k
                self.count("장 차례")
            else:
                self.keep("장 차례 — 빌더도 장 차례를 바꿔 빌더 것을 따랐습니다")
        for i, k in enumerate(Ko):                           # 편집기에서 더한 장
            if k in sb:
                continue
            if k in seq:
                self.keep(f"{self.slide_name(k)} — 편집기에서 더한 장과 같은 열쇠의 장을 빌더도 더해 빌더 것을 따랐습니다")
                continue
            at = 0
            for prev in reversed(Ko[:i]):
                if prev in seq:
                    at = seq.index(prev) + 1
                    break
            seq.insert(at, k)
            self.count("더한 장")
        return seq

    # ---- 노트
    @staticmethod
    def notes_of(d: Doc) -> dict[str, str] | None:
        n = d.ids.get("notes-data")
        try:
            arr = json.loads(style_text(n)) if n is not None else None
        except (ValueError, RecursionError):
            return None
        if not isinstance(arr, list) or len(arr) != len(d.keys):
            return None
        return {k: (v if isinstance(v, str) else "") for k, v in zip(d.keys, arr)}

    def merge_notes(self, seq: list[str]) -> None:
        nb, no, nt = self.notes_of(self.B), self.notes_of(self.O), self.notes_of(self.T)
        node = self.T.ids.get("notes-data")
        if nt is None or node is None:
            if no != nb or (no is None and style_text(self.O.ids["notes-data"]) != style_text(self.B.ids["notes-data"])):
                self.keep("노트 — 새 빌드의 노트를 읽지 못해 다시 입히지 않았습니다")
            return
        if nb is None or no is None:
            if style_text(self.O.ids["notes-data"]) != style_text(self.B.ids["notes-data"]):
                self.keep("노트 — 옛 판의 노트를 읽지 못해 다시 입히지 않았습니다")
            nb = no = None
        out = []
        for k in seq:
            if nb is not None and k in nb and k in no and k in nt:
                if no[k] != nb[k]:
                    if nt[k] == nb[k]:
                        out.append(no[k])
                        self.count("노트")
                        continue
                    self.keep(f"{self.slide_name(k)}의 노트 — 빌더도 바꿔 빌더 것을 따랐습니다")
                out.append(nt[k])
            elif k in nt:
                out.append(nt[k])
            else:
                out.append(no[k] if no is not None and k in no else "")
        if out != [nt[k] for k in self.T.keys]:
            body = json.dumps(out, ensure_ascii=False, separators=(",", ":")).replace("<", LT_ESC)
            self.reps.append((node.inner, node.close, 0, body))

    # ---- 블록(통째)
    def merge_blocks(self) -> dict[str, str | None]:
        """블록 id → 결과의 그 블록 글(None 이면 없음). 쪽 레이아웃 설정 읽기에 쓴다."""
        out: dict[str, str | None] = {}
        head_at = self.T.head.close if self.T.head is not None else None
        for order, bid in enumerate(BLOCKS):
            nb, no, nt = self.B.ids.get(bid), self.O.ids.get(bid), self.T.ids.get(bid)
            cb, co, ct = (canon(n) if n is not None else None for n in (nb, no, nt))
            out[bid] = self.T.span(nt) if nt is not None else None
            if co == cb:
                continue
            if ct != cb:
                self.keep(f"{BLOCK_NAMES[bid]} — 빌더도 바꿔 빌더 것을 따랐습니다")
                continue
            if no is None:
                if nt is not None:
                    self.reps.append((nt.start, nt.end, 0, ""))
                out[bid] = None
            elif nt is not None:
                self.reps.append((nt.start, nt.end, 0, self.O.span(no)))
                out[bid] = self.O.span(no)
            else:
                in_head = no.parent is not None and no.parent.tag == "head"
                at = head_at if in_head else self.body_end()
                if at is None:
                    self.keep(f"{BLOCK_NAMES[bid]} — 새 빌드에 넣을 자리(<head>)가 없어 다시 입히지 않았습니다")
                    continue
                self.reps.append((at, at, 10 + order, self.O.span(no)))
                out[bid] = self.O.span(no)
            self.count(BLOCK_NAMES[bid])
        return out

    def body_end(self) -> int:
        """본문 끝(</body> 앞 공백보다 앞) — 편집 기록·본문 블록을 넣는 자리."""
        T = self.T
        if T.body is not None and T.body.close > T.body.inner:
            k = T.body.close
            while k > T.body.inner and T.text[k - 1] in WS:
                k -= 1
            return k
        top = next((n for n in T.root.elements() if n.tag == "html"), None)
        if top is not None:
            k = top.close
            while k > top.inner and T.text[k - 1] in WS:
                k -= 1
            return k
        k = len(T.text)
        while k > 0 and T.text[k - 1] in WS:
            k -= 1
        return k

    # ---- :root 변수
    def merge_vars(self) -> None:
        sb, so, st = deck_styles(self.B), deck_styles(self.O), deck_styles(self.T)
        texts = [[style_text(n) for n in s] for s in (sb, so, st)]
        if not (len(sb) == len(so) == len(st)):
            if [mask_vars(t) for t in texts[1]] != [mask_vars(t) for t in texts[0]] or \
                    [vars_of(t) for t in texts[1]] != [vars_of(t) for t in texts[0]]:
                self.keep("덱 색·글꼴(스타일) — 빌더가 <style> 을 더하거나 빼서 다시 입히지 않았습니다")
            return
        for i, node in enumerate(st):
            b, o, t = texts[0][i], texts[1][i], texts[2][i]
            if mask_vars(o) != mask_vars(b):
                self.keep("덱 <style> 의 변수 밖 고침 — 다시 입히지 못했습니다(새 빌드를 따름)")
            vb, vo, vt = vars_of(b), vars_of(o), vars_of(t)
            new = t
            for key, val in vo.items():
                if vb.get(key) == val:
                    continue
                if key in vt and vt[key] == vb.get(key):
                    new = with_var(new, key[0], key[1], val)
                    self.count("덱 색·글꼴")
                else:
                    self.keep(f"덱 색·글꼴 {key[0]} — 빌더도 바꿔 빌더 것을 따랐습니다")
            if new != t:
                self.reps.append((node.inner, node.close, 0, new))

    # ---- 장 밖의 다른 고침
    def skeleton(self, d: Doc) -> tuple:
        """장 밖의 꼴 — 장들(#stage 는 속성만)·블록·차례·노트·쪽 수·편집 기록은 빼고, :root 변수 값은 지우고, 빈 글은 빼고.
        canon 처럼 납작한 토큰 열로, 재귀 없이."""
        skip = set(BLOCKS) | {TOC_ID, EDITS_ID, "notes-data", "cnt"}
        styles = {id(n) for n in deck_styles(d)}
        out: list[tuple] = []
        stack = [iter(d.root.kids)]
        while stack:
            k = next(stack[-1], None)
            if k is None:
                stack.pop()
                out.append((">",))
            elif isinstance(k, Node):
                if k is d.stage:
                    out.append(("#stage", tuple(k.attrs)))
                elif k.get("id") in skip:
                    continue
                elif id(k) in styles:
                    out.append(("#style", tuple(k.attrs), mask_vars(style_text(k))))
                else:
                    out.append(("<", k.tag, tuple((a, _norm(v)) for a, v in k.attrs)))
                    stack.append(iter(k.kids))
            elif isinstance(k, Text):
                data = _norm(k.data)
                if data.strip(WS):
                    out.append(("#t", data))
            elif isinstance(k, Comment):
                out.append(("#c", _norm(k.data)))
        return tuple(out)

    # ---- 장 하나
    def slide_text(self, key: str, at: int, total: int, settings) -> str:
        B, O, T = self.B, self.O, self.T
        if key in T.by_key:
            src, node = T, T.by_key[key]
            merge = key in B.by_key and key in O.by_key
        else:
            src, node = O, O.by_key[key]
            merge = False
        frm = (src.keys.index(key) + 1, len(src.keys))
        to = (at + 1, total)
        # 상자 — 새 빌드의 상자는 옛 빌드의 어느 상자인지 짝지어(align) 옛 빌드의 정체로 부르고(짝 없는 것은 't:' 를 붙여),
        # 결과의 표식은 새 빌드의 정체로 센다(다음에 다시 입힐 때는 이 새 빌드가 옛 빌드다)
        own_t = boxes(node)
        loose: set[str] = set()
        if merge:
            pair, loose = self.align(key)
            back = {t: b for b, t in pair.items()}
            own = [(back.get(ti, f"t:{ti}"), n) for ti, n in own_t]
        else:
            own = own_t
        tid = {mi: ti for (mi, _), (ti, _) in zip(own, own_t)}
        entries: dict[str, tuple[Doc, Node]] = {i: (src, n) for i, n in own}
        order = [i for i, _ in own]
        changed = False
        if merge:
            bb, ob = boxes(B.by_key[key]), boxes(O.by_key[key])
            bmap, omap, tmap = dict(bb), dict(ob), dict(own)
            for i, n in bb:
                where = f"{self.slide_name(key)}의 {self.box_name(i)}"
                if i in omap:
                    if self.canon_at(O, omap[i], key) == canon_box(n):
                        continue
                    if i in tmap and self.canon_at(T, tmap[i], key) == canon_box(n):
                        entries[i] = (O, omap[i])
                        changed = True
                        self.count("고친 상자")
                    elif i in tmap:
                        self.keep(f"{where} — 빌더도 바꿔 빌더 것을 따랐습니다")
                    elif group_of(n) in loose:
                        self.keep(f"{where} — 빌더가 같은 무리의 상자를 바꾸거나 없애 어느 상자인지 알 수 없어 고친 것을 "
                                  "다시 입히지 못했습니다")
                    else:
                        self.keep(f"{where} — 빌더가 그 상자를 없애 고친 것을 버렸습니다")
                elif i in tmap:
                    if self.canon_at(T, tmap[i], key) == canon_box(n):
                        del entries[i]
                        order.remove(i)
                        changed = True
                        self.count("지운 상자")
                    else:
                        self.keep(f"{where} — 편집기에서 지웠지만 빌더가 고쳐 남겼습니다")
                elif group_of(n) in loose:
                    self.keep(f"{where} — 편집기에서 지웠지만 빌더도 같은 무리의 상자를 바꿔 어느 상자인지 알 수 없어 지우지 "
                              "않았습니다")
            added = [i for i, _ in ob if i not in bmap]
            common = [i for i, _ in bb if i in omap and i in entries]
            cs = set(common)
            oo = [i for i, _ in ob if i in cs]
            ot = [i for i in order if i in cs]
            if oo != common and ot == common:               # 편집기에서 바꾼 앞뒤 차례(빌더는 그대로)
                skel = [i for i, _ in ob if i in cs or i in added]
                for j, i in enumerate(order):
                    if i in skel:
                        continue
                    pos = 0
                    for prev in reversed(order[:j]):
                        if prev in skel:
                            pos = skel.index(prev) + 1
                            break
                    skel.insert(pos, i)
                order = skel
                changed = True
                self.count("상자 앞뒤 차례")
            else:
                if oo != common:
                    self.keep(f"{self.slide_name(key)}의 상자 앞뒤 차례 — 빌더도 바꿔 빌더 것을 따랐습니다")
                olist = [i for i, _ in ob]
                for j, i in enumerate(olist):
                    if i not in added:
                        continue
                    pos = 0
                    for prev in reversed(olist[:j]):
                        if prev in order:
                            pos = order.index(prev) + 1
                            break
                    order.insert(pos, i)
            for i in added:
                entries[i] = (O, omap[i])
                changed = True
                self.count("더한 상자")
        # 장 속성
        attrs = self.slide_attrs(key, node, src, merge)
        self.titles[key] = dict(attrs).get("data-title") or ""
        if attrs != node.attrs:
            changed = True
        attrs = self.derived(attrs, at, frm, to)
        moved = frm != to
        zones_now = [n for n in node.elements() if is_zone(n)]
        want_zones = settings is not False
        if not changed and not moved and attrs == node.attrs and (not want_zones or (not zones_now and not settings)):
            return src.span(node)
        # 다시 짠다 — 상자마다 앞 공백은 원래 판의 것, 쪽 번호는 새 차례로, 표식은 결과 차례에 맞게(새 빌드 정체로)
        olead: dict[str, str] = {}
        prev = node.inner
        for i, n in own:
            olead[i] = src.text[prev:n.start]
            prev = n.end
        sep = "\n"
        if len(own) > 1 and not olead[own[1][0]].strip(WS):
            sep = olead[own[1][0]]
        pieces: list[str] = []
        marks = self.markers([(tid.get(i, i), entries[i][1]) for i in order])
        for i, mark in zip(order, marks):
            d, n = entries[i]
            lead = olead.get(i)
            if lead is None:
                ol = self.leads(d, n.parent).get(i) if d is not src else None
                lead = ol if ol is not None and not ol.strip(WS) else sep
            body = renumbered(d, n, self.pos_in(d, key), to)
            pieces.append(lead + self.with_marker(n, body, mark))
        last_end = max((n.end for _, n in own), default=node.inner)
        zone_at = min((z.start for z in zones_now), default=node.close)
        trailing = src.text[last_end:zone_at] if own else src.text[node.inner:zone_at]
        if want_zones:
            zones = zones_html(settings, at, total) if settings else ""
        else:
            zones = "".join(src.span(z) for z in zones_now)
        start = self.start_tag(node, attrs)
        return f"{start}{''.join(pieces)}{trailing}{zones}{src.text[node.close:node.end]}"

    def pos_in(self, d: Doc, key: str) -> tuple[int, int]:
        return (d.keys.index(key) + 1, len(d.keys)) if key in d.by_key else (0, 0)

    @staticmethod
    def leads(d: Doc, slide: Node) -> dict[str, str]:
        """상자 정체 → 그 앞의 글(앞 요소의 끝부터)."""
        out: dict[str, str] = {}
        prev = slide.inner
        for i, n in boxes(slide):
            out[i] = d.text[prev:n.start]
            prev = n.end
        return out

    def slide_attrs(self, key: str, node: Node, src: Doc, merge: bool) -> list[tuple[str, str]]:
        attrs = list(node.attrs)
        if not merge:
            return attrs
        ab = dict(self.B.by_key[key].attrs)
        ao = dict(self.O.by_key[key].attrs)
        at = dict(attrs)
        names = list(dict.fromkeys([*at, *ao, *ab]))
        for name in names:
            if name in DERIVED:
                continue
            vb, vo, vt = ab.get(name), ao.get(name), at.get(name)
            if name == "class":
                strip = lambda v: list(dict.fromkeys(c for c in (v or "").split() if c not in ON_CLASSES))  # noqa: E731
                vb, vo, vt = strip(vb), strip(vo), strip(vt)
                if vo == vb:
                    continue
                if vt != vb:
                    self.keep(f"{self.slide_name(key)}의 class — 빌더도 바꿔 빌더 것을 따랐습니다")
                    continue
                ons = [c for c in (at.get("class") or "").split() if c in ON_CLASSES]
                value = " ".join(vo + ons)
                attrs = self.set_attr(attrs, "class", value if value else None)
                self.count("장 속성")
                continue
            if vo == vb:
                continue
            if vt != vb:
                self.keep(f"{self.slide_name(key)}의 {name} — 빌더도 바꿔 빌더 것을 따랐습니다")
                continue
            attrs = self.set_attr(attrs, name, vo)
            self.count("장 속성")
        return attrs

    @staticmethod
    def set_attr(attrs: list[tuple[str, str]], name: str, value: str | None) -> list[tuple[str, str]]:
        out = [(k, v) for k, v in attrs if k != name] if value is None else \
            [(k, value if k == name else v) for k, v in attrs]
        if value is not None and all(k != name for k, _ in attrs):
            out.append((name, value))
        return out

    def derived(self, attrs: list[tuple[str, str]], at: int, frm: tuple[int, int], to: tuple[int, int]):
        """결과 차례로 다시 매기는 장 속성 — data-i, aria-label('k. 제목'·'k / N'), 지금 장 표시(첫 장만)."""
        d = dict(attrs)
        if "data-i" in d and d["data-i"] != str(at + 1):
            attrs = self.set_attr(attrs, "data-i", str(at + 1))
        label = d.get("aria-label")
        if label is not None:
            title = re.sub(r"\s+", " ", d.get("data-title") or "").strip()
            if LABEL_NUM_RE.match(label):
                new = f"{at + 1}. {title}"
                if new != label:
                    attrs = self.set_attr(attrs, "aria-label", new)
            else:
                m = PAGE_RE.fullmatch(label)
                if m and (int(m.group(1)), int(m.group(2))) == frm and frm != to:
                    attrs = self.set_attr(attrs, "aria-label",
                                          f"{_pad_like(m.group(1), to[0])} / {_pad_like(m.group(2), to[1])}")
        on = self.on_class
        if on:
            cls = (dict(attrs).get("class") or "").split()
            want = [c for c in cls if c != on] + ([on] if at == 0 else [])
            if want != cls:
                attrs = self.set_attr(attrs, "class", " ".join(want) if want else None)
        return attrs

    @staticmethod
    def start_tag(node: Node, attrs: list[tuple[str, str]]) -> str:
        if attrs == node.attrs:
            return node.raw
        body = "".join(f' {k}="{_esc_attr(v)}"' for k, v in attrs)
        return f"<{node.tag}{body}>"

    @staticmethod
    def markers(final: list[tuple[str, Node]]) -> list[str | None]:
        """결과 차례의 상자마다 남길 표식(새 빌드 기준 정체) — 표식 없는 상자끼리 센 자리가 정체와 같으면 None(편집기와 같은
        욕심쟁이 규칙). 편집기에서 더한 상자('+k')는 늘 표식을 단다."""
        counts: dict[str, int] = {}
        out: list[str | None] = []
        for ident, n in final:
            if ident.startswith("+") or "~" in ident:
                out.append(ident if ident.startswith("+") else None)
                continue
            g = group_of(n)
            here = f"{g}#{counts.get(g, 0) + 1}"
            if here == ident:
                counts[g] = counts.get(g, 0) + 1
                out.append(None)
            else:
                out.append(ident)
        return out

    @staticmethod
    def with_marker(node: Node, body: str, mark: str | None) -> str:
        if node.get(REF_ATTR) == mark or (mark is None and node.get(REF_ATTR) is None):
            return body
        attrs = [(k, v) for k, v in node.attrs if k != REF_ATTR] + ([(REF_ATTR, mark)] if mark else [])
        inner = "".join(f' {k}="{_esc_attr(v)}"' for k, v in attrs)
        closing = "/>" if node.raw.rstrip().endswith("/>") else ">"
        return f"<{node.tag}{inner}{closing}{body[len(node.raw):]}"

    # ---- 편집기와 다르게 읽은 장 · 짚지 못한 고침
    def unread_boxes(self) -> str:
        """편집기(브라우저)와 이 도구가 장을 다르게 읽은 곳 — 편집기 판에 옛 빌드에 없는 상자 정체(편집기에서 더한 '+k' 말고)가
        있으면 어느 상자를 고쳤는지 알 수 없다(닫는 태그가 빠진 목록·표, <p> 안에 둔 목록 등은 브라우저가 고쳐 읽는다).
        있으면 그 까닭, 없으면 ''."""
        for k in self.B.keys:
            if k not in self.O.by_key:
                continue
            known = {i for i, _ in boxes(self.B.by_key[k])}
            odd = [i for i, _ in boxes(self.O.by_key[k]) if i not in known and not i.startswith("+")]
            if odd:
                names = ", ".join(self.box_name(i) for i in odd[:3])
                return (f"{self.slide_name(k)} — 편집기(브라우저)와 이 도구가 상자를 다르게 읽어({names}) 어느 상자를 고쳤는지 "
                        "알 수 없습니다. 닫는 태그가 빠졌거나 <p> 안에 목록·표를 둔 HTML 이면 빌더에서 고쳐 주세요")
        return ""

    def untouched(self) -> list[str]:
        """빌더가 그대로 둔 장(옛 빌드와 새 빌드가 같은 장) 가운데 편집기 판에도 있는 것 — 결과에서 편집기 판 그대로여야 한다."""
        return [k for k in self.B.keys if k in self.O.by_key and k in self.T.by_key and self.same_slide(k)]

    def missed(self) -> str:
        """고친 곳을 하나도 짚지 못했을 때 — 빌더가 그대로 둔 장인데 편집기 판이 옛 빌드와 다르면 짚는 규칙이 놓친 것이다(새
        빌드로 덮으면 고친 것을 잃는다). 그 장 이름, 없으면 ''. 빌더도 바꾼 장은 보지 않는다(함께 지운 장·상자처럼 맞는 것도
        있다)."""
        for k in self.untouched():
            if not self.slide_same(self.O, k):
                return self.slide_name(k)
        return ""

    # ---- 차례(#toc) — 편집기 readToc·rebuildToc 와 같게
    @staticmethod
    def toc_sections(d: Doc) -> dict[int, str | None]:
        """차례의 장 번호(1부터) → 그 장이 든 절 이름(차례의 바로 아래 .sec 가운데 앞의 것)."""
        toc = d.ids.get(TOC_ID)
        out: dict[int, str | None] = {}
        sec = None
        for el in toc.elements() if toc is not None else []:
            if el.tag == "a" and el.get("data-go") is not None:
                go = _js_int(el.get("data-go"))
                if go is not None:
                    out[go + 1] = sec
            elif "sec" in el.classes():
                sec = clean_text(text_content(el))
        return out

    def toc_text(self, seq: list[str]) -> str | None:
        """결과 차례로 다시 쓴 차례(#toc)의 안쪽 글 — 장마다 [절, 제목(data-title)]. 절은 새 빌드의 차례에서 그 장이 든 절(새
        장은 앞 장의 절을 따른다). 바로 아래의 a[data-go]·.sec 를 걷고 첫 것을 본떠 끝에 다시 붙인다. 새 빌드의 차례와 같거나
        차례에 장 링크가 없으면 None."""
        T = self.T
        toc = T.ids.get(TOC_ID)
        proto = next((n for n in toc.walk() if n.tag == "a" and n.get("data-go") is not None), None) if toc else None
        if proto is None:
            return None
        sec_of = self.toc_sections(T)
        before = [(sec_of.get(i + 1), clean_text(T.by_key[k].get("data-title"))) for i, k in enumerate(T.keys)]
        after = [(sec_of.get(T.keys.index(k) + 1) if k in T.by_key else None, clean_text(self.titles.get(k))) for k in seq]
        if after == before:
            return None
        if T.inside_stage(toc):
            self.keep("차례 — 장 안에 있어 다시 짓지 않았습니다(새 빌드의 차례를 따름)")
            return None
        sec_proto = next((n for n in toc.walk() if "sec" in n.classes()), None)
        kept, last = [], toc.inner
        for n in toc.elements():
            if (n.tag == "a" and n.get("data-go") is not None) or "sec" in n.classes():
                kept.append(T.text[last:n.start])
                last = n.end
        kept.append(T.text[last:toc.close])
        out, prev = ["".join(kept)], None
        for i, (sec0, title) in enumerate(after):
            sec = sec0 if sec0 is not None else prev
            if sec is not None and sec != prev:
                if sec_proto is not None:
                    out.append(f"{sec_proto.raw}{_esc_text(sec)}</{sec_proto.tag}>")
                else:
                    out.append(f'<div class="sec">{_esc_text(sec)}</div>')
            prev = sec
            attrs = [(k, f"#{i + 1}" if k == "href" else str(i) if k == "data-go" else    # classList 처럼 겹친 것도 하나로
                      " ".join(dict.fromkeys(c for c in v.split() if c != "cur")) if k == "class" else v) for k, v in proto.attrs]
            if all(k != "href" for k, _ in attrs):
                attrs.append(("href", f"#{i + 1}"))
            body = "".join(f' {k}="{_esc_attr(v)}"' for k, v in attrs)
            out.append(f'<a{body}><span class="n">{i + 1}</span><span>{_esc_text(title)}</span></a>')
        return "".join(out)

    # ---- 전체
    def run(self) -> Result:
        B, O, T = self.B, self.O, self.T
        odd = self.unread_boxes()
        if odd:
            return Result(edits=True, refused=odd)
        first = (T.slides[0].get("class") or "").split()
        self.on_class = next((c for c in ON_CLASSES if c in first), "")
        seq = self.slide_sequence()
        self.merge_notes(seq)
        blocks = self.merge_blocks()
        self.merge_vars()
        if self.skeleton(O) != self.skeleton(B):
            self.keep("장 밖의 다른 고침 — 다시 입히지 못했습니다(새 빌드를 따름)")
        # 쪽 레이아웃 설정 — 결과에 들어갈 블록 글로 읽는다
        lay = None
        if blocks.get("deck-layout") is not None:
            jd = Doc(blocks["deck-layout"])
            cd = Doc(blocks["deck-layout-css"]) if blocks.get("deck-layout-css") is not None else None
            jn = next(iter(jd.root.elements()), None)
            cn = next(iter(cd.root.elements()), None) if cd is not None else None
            lay = layout_settings(blocks["deck-layout"], jn, cn)
        texts = [self.slide_text(k, i, len(seq), lay) for i, k in enumerate(seq)]
        # 장들 — 차례가 그대로면 장마다 제자리에, 바뀌었으면 장 사이 글(공백)을 지켜 다시 늘어놓는다
        if seq == T.keys:
            for s, t in zip(T.slides, texts):
                if t != T.span(s):
                    self.reps.append((s.start, s.end, 0, t))
        else:
            gaps = [T.text[a.end:b.start] for a, b in zip(T.slides, T.slides[1:])]
            if any(g.strip(WS) for g in gaps):
                return Result(edits=True, refused="새 빌드의 장 사이에 장이 아닌 것이 있어 장 차례를 다시 짜지 못했습니다")
            sep = gaps[0] if gaps else "\n"
            region = texts[0] + "".join(sep + t for t in texts[1:])
            self.reps.append((T.slides[0].start, T.slides[-1].end, 0, region))
        cnt = T.ids.get("cnt")
        if cnt is not None and PAGE_RE.fullmatch(text_content(cnt)) and len(cnt.elements()) == 0:
            new = f"1 / {len(seq)}"
            if text_content(cnt) != new and len(seq) != len(T.keys):
                self.reps.append((cnt.inner, cnt.close, 0, new))
        toc = self.toc_text(seq)
        if toc is not None:
            node = T.ids[TOC_ID]
            self.reps.append((node.inner, node.close, 0, toc))
        if not self.edits:
            miss = self.missed()
            if miss:
                return Result(edits=True, refused=f"{miss} — 편집기 판이 옛 빌드와 다른데 고친 곳을 짚지 못했습니다")
            return Result(edits=False)
        token = "\x00HS-EDITS\x00"
        if token in T.text:
            return Result(edits=True, refused="새 빌드에 쓸 수 없는 글자가 있습니다")
        at = self.body_end()
        self.reps.append((at, at, 99, token))
        try:
            out = _apply(T.text, self.reps)
        except ValueError as e:
            return Result(edits=True, refused=f"다시 입힐 자리가 겹쳐 쓰지 않았습니다({e})")
        plain = out.replace(token, "")
        final = out.replace(token, edits_json(blob_sha(self.theirs_bytes), sha256_text(plain)))
        problem = self.check(final, seq)
        if problem:
            return Result(edits=True, refused=f"다시 입힌 판을 검사하다 어긋난 곳이 있어 쓰지 않았습니다({problem})")
        return Result(text=(BOM if self.bom else "") + final, edits=True, applied=self.summary(), kept=self.kept)

    def summary(self) -> list[str]:
        order = ["고친 상자", "지운 상자", "더한 상자", "상자 앞뒤 차례", "장 속성", "지운 장", "더한 장", "장 차례", "노트",
                 "덱 색·글꼴", *BLOCK_NAMES.values()]
        return [f"{k} {self.counts[k]}" for k in order if k in self.counts]

    def check(self, final: str, seq: list[str]) -> str:
        """다시 입힌 판을 다시 읽어 장 열쇠·기록이 맞는지, 빌더가 그대로 둔 장이 편집기 판 그대로 나왔는지."""
        ov, plain = read_edits(final)
        if ov is None or sha256_text(plain) != ov["saved"]:
            return "편집 기록"
        d = Doc(plain)
        if d.keys != seq:
            return "장 차례"
        notes = self.notes_of(d)
        if notes is None and self.notes_of(self.T) is not None:
            return "노트"
        for k in self.untouched():
            if not self.slide_same(d, k, self.O):
                return f"{self.slide_name(k)} — 편집기 판과 다름"
        return ""


def _apply(text: str, reps: list[tuple[int, int, int, str]]) -> str:
    out, last = [], 0
    for start, end, _, new in sorted(reps, key=lambda r: (r[0], r[2], r[1])):
        if start < last:
            raise ValueError(f"{start} < {last}")
        out.append(text[last:start])
        out.append(new)
        last = end
    out.append(text[last:])
    return "".join(out)
