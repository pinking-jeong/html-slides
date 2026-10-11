"""덱 편집기(editor/) — 브라우저(Playwright)로 눌러 보고, GitHub contents API 는 가로채 저장된 HTML 을 본다.
덱은 실제 두 형식을 흉내 낸 작은 덱 둘(빌더: 절대 배치 + 노트 JSON + 차례, 흐름: data-notes)과 저장소의 실제 덱."""
import base64
import functools
import hashlib
import http.server
import json
import re
import shutil
import threading
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, unquote, urlsplit

import pytest

import build_manifest as bm
import samples
import slides

pw = pytest.importorskip("playwright.sync_api")

REPO = Path(__file__).resolve().parents[1]
TOKEN = "github_pat_" + "E" * 82
NOREPLY = {"name": "tester", "email": "1234+tester@users.noreply.github.com"}
PREFIX = "/repos/owner/slides/contents/"
# 덱 스크립트는 편집기에서 돌지 않는다(sandbox) — 그 차단 기록과 덱이 부르는 없는 그림은 오류로 치지 않는다
QUIET = ("Blocked script execution", "Failed to load resource")

BUILDER = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>빌더 시험 덱</title>
<style>
:root{--s:.5}
body{margin:0;background:#222;font-family:sans-serif}
.viewport{position:fixed;inset:0 0 48px 0;display:grid;place-items:center}
.stage-wrap{width:calc(1280px*var(--s));height:calc(720px*var(--s))}
.stage{position:relative;width:1280px;height:720px;transform:scale(var(--s));transform-origin:0 0;overflow:hidden}
.slide{position:absolute;inset:0;display:none}
.slide.on{display:block}
.el{position:absolute;display:flex;flex-direction:column;margin:0}
.pp{margin:0}
.controls{position:fixed;left:0;right:0;bottom:0;height:48px;background:#333;color:#fff}
.toc[hidden],.notes[hidden]{display:none}
</style></head>
<body><div id="deck"><div class="viewport"><div class="stage-wrap"><div class="stage" id="stage">
<section class="slide on" data-i="1" data-key="s01" data-title="표지" aria-label="1. 표지" style="background:#10213F">
<div class="el tx" data-name="title" style="left:64px;top:200px;width:1100px;height:80px"><div class="tin"><p class="pp" style="font-size:52px;color:#FFFFFF">시험 덱 표지</p></div></div>
</section>
<section class="slide" data-i="2" data-key="s02" data-title="둘째" aria-label="2. 둘째" style="background:#FFFFFF">
<div class="el tx" data-name="kicker" style="left:64px;top:40px;width:800px;height:24px"><div class="tin"><p class="pp" style="font-size:16px;color:#335">1. 서론</p></div></div>
<div class="el tx" data-name="title" style="left:64px;top:70px;width:1100px;height:60px"><div class="tin"><p class="pp" style="font-size:40px;color:#111">둘째 장 제목</p></div></div>
<div class="el tx" data-name="body" style="left:64px;top:160px;width:1100px;height:200px"><div class="tin"><p class="pp" style="font-size:24px;color:#222">첫 문단</p><p class="pp" style="font-size:24px;color:#222">둘째 문단</p></div></div>
<svg class="el" style="left:64px;top:400px;width:200px;height:20px" viewBox="0 0 200 20"><defs><marker id="m0a1b2c3d" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10z"></path></marker></defs><line x1="0" y1="10" x2="180" y2="10" stroke="#000" marker-end="url(#m0a1b2c3d)"></line></svg>
<div class="el tx" data-name="pageno" style="left:1150px;top:680px;width:80px;height:20px"><div class="tin"><p class="pp" style="font-size:12px">2 / 3</p></div></div>
</section>
<section class="slide" data-i="3" data-key="s03" data-title="셋째" aria-label="3. 셋째" style="background:#FFFFFF">
<div class="el tx" data-name="kicker" style="left:64px;top:40px;width:800px;height:24px"><div class="tin"><p class="pp" style="font-size:16px;color:#335">2. 본론</p></div></div>
<div class="el tx" data-name="title" style="left:64px;top:70px;width:1100px;height:60px"><div class="tin"><p class="pp" style="font-size:40px;color:#111">셋째 장 제목</p></div></div>
<table class="el" style="left:64px;top:160px;width:600px"><tbody><tr><td>칸 하나</td><td>칸 둘</td></tr></tbody></table>
<div class="el tx" data-name="pageno" style="left:1150px;top:680px;width:80px;height:20px"><div class="tin"><p class="pp" style="font-size:12px">3 / 3</p></div></div>
</section>
</div></div></div>
<nav class="controls"><button id="bPrev" type="button">이전</button><span class="count" id="cnt">1 / 3</span><button id="bNext" type="button">다음</button><span class="ttl" id="ttl">표지</span></nav>
<div class="notes" id="notes" hidden>첫 장 노트</div>
<div class="toc" id="toc" hidden role="dialog" aria-label="목차"><div class="sec">표지</div><a href="#1" data-go="0"><span class="n">1</span><span>표지</span></a><div class="sec">1. 서론</div><a href="#2" data-go="1"><span class="n">2</span><span>둘째</span></a><div class="sec">2. 본론</div><a href="#3" data-go="2"><span class="n">3</span><span>셋째</span></a></div>
</div>
<script type="application/json" id="notes-data">["첫 장 노트","둘째 장 노트 <b>","셋째 장 노트"]</script>
<script id="deck-js">
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')), N=slides.length, cur=0;
  var NOTES=JSON.parse(document.getElementById('notes-data').textContent); window.__deckNotes=NOTES;
  function show(i){ i=Math.max(0,Math.min(N-1,i)); slides[cur].classList.remove('on'); cur=i; slides[cur].classList.add('on');
    document.getElementById('cnt').textContent=(cur+1)+' / '+N; document.getElementById('notes').textContent=NOTES[cur]||''; }
  window.__deck={go:show, count:N, cur:function(){return cur;}, notes:function(){return document.getElementById('notes').textContent;}};
  show(0);
})();
</script></body></html>
"""

FLOW = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>흐름 시험 덱</title>
<style>
body{margin:0;background:#0b1220;font-family:sans-serif}
.stage{position:fixed;inset:0;display:grid;place-items:center}
.deck{position:relative;width:1280px;height:720px;background:#FFFFFF;transform-origin:center}
.slide{position:absolute;inset:0;padding:56px 72px 48px;display:none;overflow:hidden}
.slide.on{display:block}
.slide.dark{background:#0E1A2B;color:#FFFFFF}
.foot{position:absolute;left:72px;right:72px;bottom:20px;display:flex;justify-content:space-between;font-size:14px}
.hud{position:fixed;right:16px;bottom:16px}
.notes{position:fixed;left:0;right:0;bottom:0;background:#eee}
</style></head><body>
<div class="stage"><div class="deck">
<section class="slide dark" data-notes="첫 장 노트"><div class="eyebrow">머리말</div><h2>흐름 덱 표지</h2><p>부제 <b>굵게</b> 끝</p><div class="foot"><span>시험</span><span class="pageno">1 / 3</span></div></section>
<section class="slide" data-notes="둘째 노트"><div class="eyebrow">둘째 머리말</div><h2>둘째 장</h2><ul><li>하나</li><li>둘</li></ul><div id="chart-a" class="chart"></div><p><a href="https://example.com/">링크</a> 문단</p><div class="foot"><span>시험</span><span class="pageno">2 / 3</span></div></section>
<section class="slide" data-notes="셋째 노트"><h2>셋째 장</h2><table><thead><tr><th>머리</th></tr></thead><tbody><tr><td>칸</td></tr></tbody></table><div class="foot"><span>시험</span><span class="pageno">3 / 3</span></div></section>
<div class="progress"></div>
</div></div>
<div class="hud"><button id="b-prev" type="button">이전</button><button id="b-next" type="button">다음</button></div>
<div class="notes" hidden></div>
<script>
(function(){
  const slides=[...document.querySelectorAll('.slide')]; let i=0;
  function go(n){ i=Math.max(0,Math.min(slides.length-1,n)); slides.forEach((s,k)=>s.classList.toggle('on',k===i));
    document.querySelector('.notes').innerHTML='<b>'+(i+1)+'/'+slides.length+'</b> '+(slides[i].dataset.notes||''); }
  const c=document.getElementById('chart-a'); if(c) c.textContent='차트';
  window.__deck={go, count:slides.length, cur:()=>i, notes:()=>document.querySelector('.notes').textContent};
  go(0);
})();
</script>
</body></html>
"""

# 편집 화면에서 돌면 안 되는 것들 — 스크립트·인라인 핸들러·링크 이동
EVIL = """<!doctype html><html><head><meta charset="utf-8"><title>위험 시험 덱</title>
<style>.slide{display:none;width:1280px;height:720px}.slide.on{display:block}</style></head><body>
<div class="deck"><section class="slide on"><h2>첫 장</h2><p><a id="go" href="https://example.com/away">밖으로</a></p>
<img src="no-such.png" onerror="window.parent.__pwned='img'" alt=""></section>
<section class="slide"><h2>둘째 장</h2></section></div>
<script>window.parent.__pwned='script';</script></body></html>
"""

# 눌러도 편집 화면이 넘어가면 안 되는 링크(SVG 의 a, 이미지 맵의 area)와 덱이 원래 편집 칸으로 둔 곳
GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs="
LINKS = f"""<!doctype html><html><head><meta charset="utf-8"><title>링크 시험 덱</title>
<style>.slide{{display:none;width:1280px;height:720px}}.slide.on{{display:block}}</style></head><body>
<div class="deck"><section class="slide on"><h2>첫 장</h2>
<svg width="300" height="100" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://example.com/svg" id="svglink"><rect width="300" height="100" fill="#0099FF"/></a></svg>
<p><img id="mapped" src="{GIF}" usemap="#m" width="200" height="100" alt=""></p>
<map name="m"><area shape="rect" coords="0,0,200,100" href="https://example.com/area" alt="영역"></map>
<div contenteditable="true" id="own"><p>덱이 둔 편집 칸</p></div></section>
<section class="slide"><h2>둘째 장</h2></section></div></body></html>
"""

# 저장하면 덱이 망가질 수 있어 편집기가 열지 않는 덱 — (덱, 알림에 든 말)
SLIDES2 = '<section class="slide"><h2>하나</h2>{}</section><section class="slide"><h2>둘</h2></section>'
REFUSE = {
    "noscript-in-head": ('<!doctype html><html><head><meta charset="utf-8"><title>t</title><noscript><img '
                         'src="https://example.com/pixel.gif" alt=""></noscript><style>.x{}</style></head><body>'
                         + SLIDES2.format("") + "</body></html>", "noscript"),
    "clobbered-document": ('<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>'
                           + SLIDES2.format('<img name="documentElement" alt="">') + "</body></html>", "documentElement"),
    "clobbered-form": ('<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>'
                       + SLIDES2.format('<form name="f"><input name="children"></form>') + "</body></html>", "children"),
    "head-in-comment": ('<!-- <head> 앞에 든 글 -->\n<!doctype html><html><head><meta charset="utf-8"><title>t</title>'
                        "</head><body>" + SLIDES2.format("") + "</body></html>", "<head> 앞부분"),
    "gt-in-head-attr": ('<!doctype html><html><head data-x="a>b"><meta charset="utf-8"><title>t</title></head><body>'
                        + SLIDES2.format("") + "</body></html>", "<head> 앞부분"),
}


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_site(tmp_path: Path, decks: dict[str, str]) -> tuple[Path, Path]:
    """덱과 편집기를 담은 저장소 → 사이트. (사이트 폴더, 저장소 폴더)"""
    root = tmp_path / "repo"
    root.mkdir(parents=True)
    shutil.copy(REPO / "index.html", root / "index.html")
    for d in ("assets", "editor"):
        shutil.copytree(REPO / d, root / d)
    for rel, text in decks.items():
        write(root / "decks" / rel, text)
    write(root / "site.json", json.dumps({"title": "시험 갤러리", "repo": "owner/slides", "branch": "main",
                                          "author": NOREPLY}, ensure_ascii=False))
    manifest = bm.build_manifest(root, thumbs=False, cache=None, use_git=False)
    out = tmp_path / "site"
    bm.build_site(root, out, manifest, None)
    return out, root


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # noqa: BLE001 — 브라우저가 없는 환경
            pytest.skip(f"Chromium 을 띄우지 못함: {e}")
        yield b
        b.close()


@pytest.fixture
def serve():
    servers = []

    def start(site: Path) -> str:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(site)))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        servers.append(srv)
        return f"http://127.0.0.1:{srv.server_address[1]}/"
    yield start
    for srv in servers:
        srv.shutdown()
        srv.server_close()


class DeckHub:
    """api.github.com 의 contents API 흉내. files: 저장소 경로 → 바이트.
    GET 은 바이트를 raw 로 주고, PUT 은 보낸 sha 가 지금 파일의 blob SHA 와 같을 때만 바꾼다(아니면 409).
    put_status 를 정하면 PUT 을 그 상태로 거절한다."""
    HEADERS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*",
               "access-control-allow-methods": "GET, PUT", "access-control-expose-headers": "x-ratelimit-remaining"}

    def __init__(self, files: dict[str, bytes]):
        self.files = dict(files)
        self.calls: list[dict] = []
        self.put_status: int | None = None
        self.put_headers: dict = {}

    def __call__(self, route, request):
        rel = unquote(urlsplit(request.url).path)[len(PREFIX):]
        self.calls.append({"method": request.method, "path": rel, "auth": request.headers.get("authorization"),
                           "accept": request.headers.get("accept"), "body": request.post_data})
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=self.HEADERS)
        elif request.method == "GET":
            if rel in self.files:
                route.fulfill(status=200, headers={**self.HEADERS, "content-type": "application/vnd.github.raw+json"},
                              body=self.files[rel])
            else:
                route.fulfill(status=404, headers=self.HEADERS, json={"message": "Not Found"})
        elif self.put_status:
            route.fulfill(status=self.put_status, headers={**self.HEADERS, **self.put_headers}, json={"message": "no"})
        else:
            body = json.loads(request.post_data)
            cur = self.files.get(rel)
            if cur is not None and body.get("sha") != blob_sha(cur):
                route.fulfill(status=409, headers=self.HEADERS, json={"message": f"{rel} does not match {body.get('sha')}"})
                return
            new = base64.b64decode(body["content"])
            self.files[rel] = new
            route.fulfill(status=200, headers=self.HEADERS, json={
                "content": {"sha": blob_sha(new)},
                "commit": {"sha": "c-1", "html_url": "https://github.com/owner/slides/commit/c-1"}})

    def puts(self) -> list[dict]:
        return [c for c in self.calls if c["method"] == "PUT"]

    def put_body(self, k: int = -1) -> dict:
        return json.loads(self.puts()[k]["body"])

    def saved(self, rel: str) -> str:
        return self.files[rel].decode("utf-8")


def open_editor(browser, base: str, deck_id: str, hub: DeckHub, width: int = 1440):
    ctx = browser.new_context(viewport={"width": width, "height": 900}, accept_downloads=True)
    ctx.route("https://api.github.com/**", hub)
    ctx.route("https://github.com/**", lambda route: route.fulfill(status=200, body="github"))
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(f"{base}editor/?deck={quote(deck_id)}")
    page.wait_for_selector("#app.ready, #fail:not([hidden])", timeout=60000)
    return ctx, page, errors


def state(page) -> dict:
    return page.evaluate("window.__hse.state()")


def frame(page):
    return page.frame_locator("#frame")


def parse_saved(page, text: str) -> dict:
    """저장된 HTML 을 브라우저 DOMParser 로 읽어 볼 것만 꺼낸다."""
    return page.evaluate("""(t) => {
        const d = new DOMParser().parseFromString(t, 'text/html');
        const slides = [...d.querySelectorAll('section.slide')];
        const pick = (s, sel) => { const e = s.querySelector(sel); return e ? e.textContent.trim() : null; };
        return {
            n: slides.length,
            on: slides.map((s) => s.classList.contains('on')),
            titles: slides.map((s) => s.getAttribute('data-title')),
            labels: slides.map((s) => s.getAttribute('aria-label')),
            keys: slides.map((s) => s.getAttribute('data-key')),
            idx: slides.map((s) => s.getAttribute('data-i')),
            notesAttr: slides.map((s) => s.getAttribute('data-notes')),
            pageno: slides.map((s) => pick(s, '[data-name=pageno], .pageno')),
            heads: slides.map((s) => pick(s, 'h2, [data-name=title]')),
            notesJson: d.getElementById('notes-data') ? d.getElementById('notes-data').textContent : null,
            toc: d.getElementById('toc') ? [...d.getElementById('toc').children].map((e) =>
                e.matches('a') ? ['a', e.getAttribute('href'), e.getAttribute('data-go'), e.textContent] : ['sec', e.textContent]) : null,
            cnt: d.getElementById('cnt') ? d.getElementById('cnt').textContent : null,
            hse: [...d.querySelectorAll('*')].some((e) => [...e.attributes].some((a) => a.name.startsWith('data-hse-'))),
            editable: d.querySelectorAll('[contenteditable], [spellcheck]').length,
            base: d.querySelectorAll('base').length,
            scripts: [...d.querySelectorAll('script')].map((s) => s.id || s.type || 'js'),
        };
    }""", text)


def run_saved(browser, tmp_path: Path, serve, text: str, steps: str) -> object:
    """저장된 덱을 스크립트가 도는 보통 브라우저 창으로 열어 steps(함수 본문)를 돌린 값을 돌려준다."""
    site = tmp_path / "run"
    site.mkdir(exist_ok=True)
    (site / "deck.html").write_text(text, encoding="utf-8")
    base = serve(site)
    page = browser.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "deck.html")
    value = page.evaluate(f"() => {{ {steps} }}")
    page.close()
    assert errors == []
    return value


@pytest.fixture
def decks(tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER, "flow.html": FLOW, "evil.html": EVIL})
    hub = DeckHub({f"decks/{n}": (root / "decks" / n).read_bytes() for n in ("builder.html", "flow.html", "evil.html")})
    return serve(site), hub


def save_with_token(page) -> None:
    page.click("#save")
    if page.locator("#tokenDlg").is_visible():
        page.fill("#token", TOKEN)
        page.click("#tokenGo")


def wait_saved(page, hub: DeckHub, n: int = 1) -> None:
    for _ in range(100):
        if len(hub.puts()) >= n and not state(page)["saving"]:
            return
        page.wait_for_timeout(100)
    raise AssertionError("저장 요청이 끝나지 않았습니다")


# ---------- 불러오기

def test_opens_both_formats_and_reads_raw(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    st = state(page)
    assert (st["family"], st["notesMode"], st["n"], st["size"]) == ("builder", "json", 3, {"w": 1280, "h": 720})
    assert st["titles"] == ["표지", "둘째", "셋째"]
    assert page.locator("#toc li").all_inner_texts() == ["1\n표지", "2\n둘째", "3\n셋째"]
    assert page.input_value("#notes") == "첫 장 노트"
    get = [c for c in hub.calls if c["method"] == "GET"][0]
    assert get["path"] == "decks/builder.html" and "raw" in get["accept"] and get["auth"] is None
    assert page.locator("#back").is_visible() and "decks/builder.html" in page.inner_text("#where")
    # 덱의 판(#stage)이 편집 화면의 왼쪽 위에 확대 없이 놓이고 덱의 단추는 숨는다
    box = frame(page).locator("#stage").bounding_box()
    sheet = page.locator("#sheet").bounding_box()
    assert abs(box["x"] - sheet["x"]) < 1.5 and abs(box["width"] - sheet["width"]) < 1.5
    assert not frame(page).locator("nav.controls").is_visible()
    ctx.close()

    ctx, page, errors2 = open_editor(browser, base, "flow", hub)
    st = state(page)
    assert (st["family"], st["notesMode"], st["n"]) == ("flow", "attr", 3)
    assert st["titles"] == ["흐름 덱 표지", "둘째 장", "셋째 장"]
    assert page.input_value("#notes") == "첫 장 노트"
    page.keyboard.press("PageDown")
    assert state(page)["cur"] == 1 and page.input_value("#notes") == "둘째 노트"
    assert frame(page).locator("section.slide").nth(1).is_visible()
    assert not frame(page).locator("section.slide").nth(0).is_visible()
    ctx.close()
    assert errors == [] and errors2 == []


def test_not_a_deck_and_bad_ids_fail_clearly(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"page.html": "<!doctype html><title>t</title><p>슬라이드 없음</p>"})
    hub = DeckHub({"decks/page.html": (root / "decks/page.html").read_bytes()})
    base = serve(site)
    for deck_id, words in (("page", "슬라이드"), ("nope", "목록에 없는")):
        ctx, page, _ = open_editor(browser, base, deck_id, hub)
        assert words in page.inner_text("#failMsg") and not page.locator("#app").is_visible()
        ctx.close()
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(base + "editor/")
    page.wait_for_selector("#fail:not([hidden])")
    assert "덱을 고르지" in page.inner_text("#failMsg")
    ctx.close()


def test_deck_scripts_handlers_and_links_stay_inert(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "evil", hub)
    assert state(page)["n"] == 2
    frame(page).locator("#go").click()
    page.wait_for_timeout(300)
    assert page.evaluate("window.__pwned === undefined")
    assert frame(page).locator("#go").count() == 1          # 링크를 눌러도 덱 문서가 그대로다
    assert page.locator("#app").is_visible()
    ctx.close()


def test_svg_links_image_maps_and_deck_editables(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"links.html": LINKS})
    hub = DeckHub({"decks/links.html": (root / "decks/links.html").read_bytes()})
    ctx, page, errors = open_editor(browser, serve(site), "links", hub)
    assert state(page)["n"] == 2
    frame(page).locator("#svglink rect").click()            # SVG 의 링크
    frame(page).locator("#mapped").click()                  # 이미지 맵의 영역
    page.wait_for_timeout(300)
    assert page.locator("#app").is_visible() and page.locator("#fail").is_hidden()
    assert frame(page).locator("#mapped").count() == 1      # 편집 화면이 다른 문서로 넘어가지 않았다
    # 덱이 원래 편집 칸으로 둔 곳 — 고치면 되돌리기·저장 표시에 잡히고, 그 안의 End 는 장을 넘기지 않는다
    frame(page).locator("#own p").click()
    page.keyboard.press("End")
    page.keyboard.type("Z")
    assert state(page)["cur"] == 0 and state(page)["dirty"] is True
    page.wait_for_timeout(900)
    assert state(page)["undo"] == 1
    page.keyboard.press("Control+z")
    assert frame(page).locator("#own p").inner_text() == "덱이 둔 편집 칸"
    saved = page.evaluate("window.__hse.serialize()")
    assert '<div contenteditable="true" id="own">' in saved      # 덱의 편집 칸 표시는 그대로 남는다
    assert errors == []
    ctx.close()


def test_rescue_download_when_the_frame_navigates_away(browser, decks):
    """덱 문서가 스스로 다른 주소로 넘어가 편집이 멈춰도, 저장하지 않은 고침은 HTML 파일로 받아 둘 수 있다"""
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    frame(page).locator("h2").first.click()
    page.keyboard.press("End")
    page.keyboard.type("가")
    page.evaluate("document.getElementById('frame').contentWindow.location.replace('about:blank')")
    page.wait_for_selector("#fail:not([hidden])")
    assert page.inner_text("#failTitle") == "편집을 멈췄습니다"
    assert page.locator("#failRescue").is_visible() and "받아 두세요" in page.inner_text("#failMsg")
    with page.expect_download() as dl:
        page.click("#failDownload")
    assert dl.value.suggested_filename == "flow_편집본.html"
    text = Path(dl.value.path()).read_text(encoding="utf-8")
    assert "흐름 덱 표지가" in text and text.count('<section class="slide') == 3
    ctx.close()


def test_save_refuses_a_document_that_lost_slides(browser, decks):
    """저장할 문서에서 장이 빠졌으면(편집기 밖에서 문서가 바뀜) 잘린 덱을 쓰지 않고 멈춘다"""
    base, hub = decks
    ctx, page, _ = open_editor(browser, base, "flow", hub)
    page.evaluate("document.getElementById('frame').contentDocument.querySelector('section.slide').remove()")
    with pytest.raises(pw.Error, match="장을 찾지 못했습니다"):
        page.evaluate("window.__hse.serialize()")
    ctx.close()


def test_undoing_text_keeps_a_later_note(browser, decks):
    """흐름 덱의 노트는 장의 data-notes 에 든다 — 노트를 고친 뒤 글을 고쳐 되돌려도 노트는 그대로다"""
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.fill("#notes", "새 노트")
    frame(page).locator("h2").first.click()                 # 노트 칸을 떠나면 노트 고침이 한 칸으로 들어간다
    page.keyboard.press("End")
    page.keyboard.type("X")
    page.wait_for_timeout(900)
    assert state(page)["undo"] == 2
    page.keyboard.press("Control+z")
    assert frame(page).locator("h2").first.inner_text() == "흐름 덱 표지"
    assert page.evaluate("window.__hse.notes()")[0] == "새 노트" and page.input_value("#notes") == "새 노트"
    page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.notes()")[0] == "첫 장 노트"
    assert errors == []
    ctx.close()


@pytest.mark.parametrize("name", list(REFUSE))
def test_decks_that_would_break_on_save_are_refused(browser, tmp_path, serve, name):
    text, words = REFUSE[name]
    site, _ = make_site(tmp_path, {"bad.html": "<!doctype html><title>t</title>"})
    hub = DeckHub({"decks/bad.html": text.encode("utf-8")})
    ctx, page, _ = open_editor(browser, serve(site), "bad", hub)
    assert page.locator("#fail").is_visible() and words in page.inner_text("#failMsg")
    assert not page.locator("#app").is_visible()
    ctx.close()


def test_head_noscript_with_styles_only_opens(browser, tmp_path, serve):
    text = FLOW.replace("</style></head>", "</style><noscript><style>.hud{display:none}</style></noscript></head>")
    site, _ = make_site(tmp_path, {"ns.html": "<!doctype html><title>t</title>"})
    hub = DeckHub({"decks/ns.html": text.encode("utf-8")})
    ctx, page, errors = open_editor(browser, serve(site), "ns", hub)
    assert state(page)["n"] == 3
    assert same_dom(page, text, page.evaluate("window.__hse.serialize()"))
    ctx.close()


def test_renumbering_keeps_zero_padding_and_new_slides_get_own_ids(browser, tmp_path, serve):
    text = (FLOW.replace("1 / 3", "01 / 03").replace("2 / 3", "02 / 03").replace("3 / 3", "03 / 03")
            .replace('<section class="slide dark"', '<section class="slide dark" id="intro"'))
    site, _ = make_site(tmp_path, {"pad.html": "<!doctype html><title>t</title>"})
    hub = DeckHub({"decks/pad.html": text.encode("utf-8")})
    ctx, page, errors = open_editor(browser, serve(site), "pad", hub)
    page.click("#down")                                      # 첫 장을 둘째로
    got = parse_saved(page, page.evaluate("window.__hse.serialize()"))
    assert got["heads"][:2] == ["둘째 장", "흐름 덱 표지"]
    assert got["pageno"] == ["01 / 03", "02 / 03", "03 / 03"]   # 0 을 채운 자릿수를 지킨다
    page.click("#add")                                       # 그 장(id="intro")을 바탕으로 새 장
    saved = page.evaluate("window.__hse.serialize()")
    assert saved.count('id="intro"') == 1 and 'id="intro-c1"' in saved
    assert parse_saved(page, saved)["pageno"] == ["01 / 04", "02 / 04", "03 / 04", "04 / 04"]
    assert errors == []
    ctx.close()


def test_history_overflow_and_download_type(browser, decks):
    base, hub = decks
    ctx, page, _ = open_editor(browser, base, "flow", hub)
    got = page.evaluate("""async () => {
        const { History } = await import('./js/history.js');
        const h = new History(() => {}, 3);
        for (let i = 0; i < 5; i++) h.push([{ t: 'x' }]);
        while (h.canUndo) h.undo();
        const evicted = h.dirty;                // 넘쳐서 버린 칸의 고침은 덱에 남아 있다 — 저장 안 함
        const s = new History(() => {}, 3);
        s.push([{ t: 'x' }]); s.push([{ t: 'x' }]); s.markSaved();
        for (let i = 0; i < 3; i++) s.push([{ t: 'x' }]);
        while (s.canUndo) s.undo();
        const back = s.dirty;                   // 저장한 때까지 되돌리면 저장한 그대로
        const { download } = await import('./js/util.js');
        const orig = URL.createObjectURL;
        let type = '';
        URL.createObjectURL = (b) => { type = b.type; return orig.call(URL, b); };
        try { download('x', 'a.html'); } finally { URL.createObjectURL = orig; }
        return { evicted, back, type };
    }""")
    assert got == {"evicted": True, "back": False, "type": "application/octet-stream"}
    ctx.close()


def test_editor_refuses_windows_opened_or_framed_by_other_pages(browser, decks):
    """같은 출처의 다른 창(덱 스크립트 등)이 연 편집기나 다른 페이지 안의 편집기는 열지 않는다 — 토큰을 받기 전에 멈춘다"""
    base, hub = decks
    ctx = browser.new_context()
    ctx.route("https://api.github.com/**", hub)
    page = ctx.new_page()
    page.goto(base)
    with ctx.expect_page() as pi:
        page.evaluate("window.open('editor/?deck=flow')")
    pop = pi.value
    pop.wait_for_selector("#fail:not([hidden])", timeout=60000)
    assert "다른 창" in pop.inner_text("#failMsg")
    page.evaluate("""() => { const f = document.createElement('iframe'); f.id = 'probe';
        f.src = 'editor/?deck=flow'; document.body.append(f); }""")
    pw.expect(page.frame_locator("#probe").locator("#failMsg")).to_contain_text("다른 창", timeout=60000)
    assert not any(c["path"] == "decks/flow.html" for c in hub.calls)   # 덱도 읽지 않았다
    ctx.close()


# ---------- 왕복: 손대지 않고 저장하면 DOM 이 같고, 다시 열어 저장해도 글자 하나 다르지 않다

def same_dom(page, a: str, b: str) -> bool:
    return page.evaluate("""([a, b]) => {
        const P = new DOMParser();
        const norm = (t) => { const d = P.parseFromString(t, 'text/html');
            while (d.body.lastChild && d.body.lastChild.nodeType === 3 && !d.body.lastChild.data.trim()) d.body.lastChild.remove();
            return d.documentElement.outerHTML; };
        return norm(a) === norm(b);
    }""", [a, b])


@pytest.mark.parametrize("name", ["builder.html", "flow.html"])
def test_untouched_round_trip(browser, decks, name):
    base, hub = decks
    ctx, page, _ = open_editor(browser, base, name[:-5], hub)
    text = page.evaluate("window.__hse.serialize()")
    src = hub.saved(f"decks/{name}")
    assert same_dom(page, src, text)
    eol = "\r\n" if "\r\n" in src else "\n"                 # 시험 덱은 write_text 로 써서 Windows 에서는 CRLF
    assert text.startswith(f"<!doctype html>{eol}<html") and text.endswith(f"</body></html>{eol}")
    assert text.count("\r\n") == (text.count("\n") if eol == "\r\n" else 0)
    hub.files[f"decks/{name}"] = text.encode("utf-8")
    ctx.close()
    ctx, page, _ = open_editor(browser, base, name[:-5], hub)
    assert page.evaluate("window.__hse.serialize()") == text
    ctx.close()


BOM = bytes.fromhex("efbbbf")
XHTML_HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" '
              '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n')
SHAPES = {
    # 이름: (원본 바이트, 저장본의 처음, 저장본의 끝)
    "lf": (FLOW.encode(), "<!doctype html>\n<html", "</script>\n</body></html>\n"),
    "crlf-glued-no-final-newline": (FLOW.replace("<!doctype html>\n", "<!doctype html>").rstrip("\n")
                                    .replace("\n", "\r\n").encode(),
                                    "<!doctype html><html", "</script>\r\n</body></html>"),
    "spaced-end-tags": (FLOW.replace("</body></html>\n", "</body>\n\n</html>\n\n").encode(),
                        "<!doctype html>\n<html", "</script>\n</body>\n\n</html>\n\n"),
    "omitted-end-tags": (FLOW.replace("\n</body></html>\n", "\n").encode(), "<!doctype html>\n<html", "</script>\n"),
    "bom": (BOM + FLOW.encode(), "<!doctype html>\n<html", "</script>\n</body></html>\n"),
    # doctype 앞의 주석·<?xml?> — 저장하면 쿼크 모드가 되거나(<!doctype> 를 잃음) <?xml?> 이 주석으로 바뀌면 안 된다
    "comment-before-doctype": (("<!-- 만든 도구: deck builder -->\n" + FLOW).encode(),
                               "<!-- 만든 도구: deck builder -->\n<!doctype html>\n<html", "</script>\n</body></html>\n"),
    "xml-prolog": (FLOW.replace("<!doctype html>\n", XHTML_HEAD).encode(), XHTML_HEAD + "<html",
                   "</script>\n</body></html>\n"),
}


@pytest.mark.parametrize("shape", list(SHAPES))
def test_saved_text_keeps_the_source_shape(browser, decks, shape):
    """원본의 줄바꿈(CRLF)·doctype 뒤·끝 태그 둘레·파일 끝·BOM 을 그대로 — 손대지 않은 줄이 바뀐 것으로 보이지 않게"""
    base, hub = decks
    raw, head, tail = SHAPES[shape]
    hub.files["decks/flow.html"] = raw
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    text = page.evaluate("window.__hse.serialize()")
    assert text.startswith(head) and text.endswith(tail), (text[:40], text[-60:])
    crlf = shape.startswith("crlf")
    assert text.count("\r\n") == (text.count("\n") if crlf else 0)
    # 원본과 다른 줄은 직렬화가 늘 바꾸는 것(빈 불리언 속성 hidden → hidden="")뿐이고 줄 수도 같다
    old_lines = raw.decode("utf-8-sig").splitlines()
    mid_lines = text.splitlines()
    assert len(old_lines) == len(mid_lines)
    assert [a for a, b in zip(old_lines, mid_lines) if a != b] == ['<div class="notes" hidden></div>']
    # 고쳐서 저장하면 고친 줄만 다르다 — BOM 도 되붙는다
    frame(page).locator("h2").first.click()
    page.keyboard.press("End")
    page.keyboard.type("가")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/flow.html"]
    assert saved.startswith(BOM) == (shape == "bom")
    new_lines = saved.decode("utf-8-sig").splitlines()
    changed = [i for i, (a, b) in enumerate(zip(mid_lines, new_lines)) if a != b]
    assert len(new_lines) == len(mid_lines) and len(changed) == 1 and "흐름 덱 표지가" in new_lines[changed[0]]
    ctx.close()
    # 다시 열어 손대지 않고 저장해도 그대로
    ctx, page, _ = open_editor(browser, base, "flow", hub)
    assert page.evaluate("window.__hse.serialize()").encode() == saved.removeprefix(BOM)
    ctx.close()
    assert errors == []


REAL = sorted(p.relative_to(REPO / "decks").as_posix() for p in (REPO / "decks").rglob("*.html")
              if "section class=\"slide" in p.read_text(encoding="utf-8", errors="replace"))


@pytest.mark.parametrize("rel", REAL)
def test_real_decks_round_trip(browser, tmp_path, serve, rel):
    """저장소의 실제 덱 — 열어서 손대지 않고 저장하면 같은 문서"""
    text0 = (REPO / "decks" / rel).read_text(encoding="utf-8")
    site, _ = make_site(tmp_path, {rel: text0})
    hub = DeckHub({f"decks/{rel}": text0.encode("utf-8")})
    ctx, page, errors = open_editor(browser, serve(site), rel[:-5], hub)
    assert not page.locator("#fail").is_visible()
    page.keyboard.press("PageDown")
    assert same_dom(page, text0, page.evaluate("window.__hse.serialize()"))
    assert errors == []
    ctx.close()


# ---------- 장 더하기·복제·지우기·옮기기와 되돌리기

def test_slide_operations_and_undo(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    original = page.evaluate("window.__hse.serialize()")
    page.click("#toc li >> nth=1")
    assert state(page)["cur"] == 1
    page.click("#add")                                     # 둘째 뒤에 제목만 있는 새 장
    st = state(page)
    assert st["n"] == 4 and st["cur"] == 2 and st["titles"][2] == "새 장"
    assert frame(page).locator("section.slide").nth(2).locator("[data-name=title]").inner_text() == "제목을 입력하세요"
    assert frame(page).locator("section.slide").nth(2).locator("[data-name=kicker]").inner_text() == "소제목"
    assert page.input_value("#notes") == ""
    page.click("#toc li >> nth=1")
    page.click("#dup")                                     # 둘째 복제 → 셋째 자리
    st = state(page)
    assert st["n"] == 5 and st["cur"] == 2 and st["titles"][2] == "둘째"
    assert page.input_value("#notes") == "둘째 장 노트 <b>"
    marker = frame(page).locator("section.slide").nth(2).locator("marker")
    assert marker.get_attribute("id") == "m0a1b2c3d-c1"     # 복제본 안의 id 와 그 참조를 함께 바꾼다
    assert frame(page).locator("section.slide").nth(2).locator("line").get_attribute("marker-end") == "url(#m0a1b2c3d-c1)"
    page.click("#toc li >> nth=0")
    page.click("#del")
    assert state(page)["n"] == 4 and state(page)["titles"][0] == "둘째"
    page.click("#down")                                    # 둘째를 뒤로
    assert state(page)["titles"][:2] == ["둘째", "둘째"] and state(page)["cur"] == 1
    page.locator("#toc li").nth(1).focus()
    page.keyboard.press("Alt+ArrowDown")
    assert state(page)["titles"] == ["둘째", "새 장", "둘째", "셋째"] and state(page)["cur"] == 2
    assert state(page)["dirty"] is True
    for _ in range(5):
        page.click("#undo")
    assert state(page)["titles"] == ["표지", "둘째", "셋째"]
    assert page.evaluate("window.__hse.serialize()") == original
    assert page.locator("#undo").is_disabled() and not page.locator("#redo").is_disabled()
    for _ in range(5):
        page.keyboard.press("Control+y")
    assert state(page)["titles"] == ["둘째", "새 장", "둘째", "셋째"]
    page.keyboard.press("Control+z")
    assert state(page)["titles"] == ["둘째", "둘째", "새 장", "셋째"]
    ctx.close()
    assert errors == []


def test_last_slide_cannot_be_deleted_and_drag_reorders(browser, decks):
    base, hub = decks
    ctx, page, _ = open_editor(browser, base, "flow", hub)
    page.locator("#toc li").nth(0).drag_to(page.locator("#toc li").nth(2), target_position={"x": 20, "y": 30})
    assert state(page)["titles"] == ["둘째 장", "셋째 장", "흐름 덱 표지"]
    page.locator("#toc li").nth(0).focus()
    page.keyboard.press("Delete")
    page.keyboard.press("Delete")
    assert state(page)["n"] == 1 and page.locator("#del").is_disabled()
    page.locator("#toc li").nth(0).focus()
    page.keyboard.press("Delete")
    assert state(page)["n"] == 1
    assert "마지막 한 장" in page.inner_text("#status")
    ctx.close()


# ---------- 글 고치기

def test_text_editing_enter_paste_and_undo(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    f = frame(page)
    f.locator("h2").first.click()
    page.keyboard.press("End")
    page.keyboard.type(" 고침")
    page.keyboard.press("Enter")                            # 문단을 나눌 수 없는 칸 — 줄바꿈으로
    page.keyboard.type("둘째 줄")
    h2 = f.locator("h2").first
    assert h2.evaluate("(e) => e.innerHTML") == "흐름 덱 표지 고침<br>둘째 줄"
    assert state(page)["titles"][0] == "흐름 덱 표지 고침 둘째 줄"
    # 서식 붙은 글을 붙여 넣어도 글만 들어간다
    f.locator("p").first.click()
    page.keyboard.press("End")
    f.locator("p").first.evaluate("""(e) => { const dt = new DataTransfer();
        dt.setData('text/html', '<b style="color:red">빨강</b>'); dt.setData('text/plain', '빨강');
        e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""")
    assert f.locator("p").first.evaluate("(e) => e.innerHTML") == "부제 <b>굵게</b> 끝빨강"
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    assert page.locator("#toc li").nth(0).inner_text().endswith("흐름 덱 표지 고침 둘째 줄")
    # 목록은 Enter 로 새 항목
    page.keyboard.press("PageDown")
    f.locator("li").last.click()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("셋")
    assert f.locator("section.slide").nth(1).locator("li").all_inner_texts() == ["하나", "둘", "셋"]
    page.keyboard.press("Control+z")
    assert f.locator("section.slide").nth(1).locator("li").all_inner_texts() == ["하나", "둘"]
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    assert state(page)["titles"][0] == "흐름 덱 표지"
    text = page.evaluate("window.__hse.serialize()")
    assert same_dom(page, hub.saved("decks/flow.html"), text)
    ctx.close()
    assert errors == []


def test_builder_text_box_keeps_paragraph_style(browser, decks):
    base, hub = decks
    ctx, page, _ = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    body = frame(page).locator("[data-name=body] .tin")
    body.locator("p").last.click()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("셋째 문단")
    ps = body.locator("p")
    assert ps.count() == 3
    assert ps.nth(2).get_attribute("class") == "pp" and "font-size:24px" in ps.nth(2).get_attribute("style").replace(" ", "")
    ctx.close()


# ---------- 저장

def test_builder_save_renumbers_everything(browser, decks, tmp_path, serve):
    base, hub = decks
    first = hub.files["decks/builder.html"]                # 저장소에 있던 바이트(이 바이트의 blob SHA 로 저장해야 한다)
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.click("#toc li >> nth=1")
    page.click("#add")                                     # 1 표지 · 2 둘째 · 3 새 장 · 4 셋째
    page.fill("#notes", "새 장 노트 </script>")
    page.click("#toc li >> nth=0")
    page.click("#down")                                    # 1 둘째 · 2 표지 · 3 새 장 · 4 셋째
    page.locator("#toc li").nth(2).dblclick()
    page.locator("#toc li input").fill("방법")
    page.keyboard.press("Enter")
    save_with_token(page)
    wait_saved(page, hub)
    body = hub.put_body()
    assert body["sha"] == blob_sha(first) and body["branch"] == "main"
    assert body["author"] == NOREPLY and body["committer"] == NOREPLY
    assert body["message"] == "docs: 덱 고침 — builder.html(웹 편집기)"
    assert hub.puts()[-1]["auth"] == f"Bearer {TOKEN}"
    text = hub.saved("decks/builder.html")
    s = parse_saved(page, text)
    assert s["n"] == 4 and s["titles"] == ["둘째", "표지", "방법", "셋째"]
    assert s["on"] == [True, False, False, False]
    assert s["idx"] == ["1", "2", "3", "4"]
    assert s["labels"] == ["1. 둘째", "2. 표지", "3. 방법", "4. 셋째"]
    assert s["pageno"] == ["1 / 4", None, "3 / 4", "4 / 4"]
    assert s["keys"][:2] == ["s02", "s01"] and s["keys"][2].startswith("new_") and s["keys"][3] == "s03"
    assert json.loads(s["notesJson"]) == ["둘째 장 노트 <b>", "첫 장 노트", "새 장 노트 </script>", "셋째 장 노트"]
    assert "</script>" not in s["notesJson"]
    assert s["toc"] == [["sec", "1. 서론"], ["a", "#1", "0", "1둘째"], ["sec", "표지"], ["a", "#2", "1", "2표지"],
                        ["sec", "1. 서론"], ["a", "#3", "2", "3방법"], ["sec", "2. 본론"], ["a", "#4", "3", "4셋째"]]
    assert s["cnt"] == "1 / 4" and s["hse"] is False and s["editable"] == 0 and s["base"] == 0
    assert s["scripts"] == ["notes-data", "deck-js"]
    assert state(page)["dirty"] is False and "저장했습니다" in page.inner_text("#status")
    ctx.close()
    assert errors == []
    # 저장된 덱이 보통 브라우저에서 제대로 돈다 — 장 수·노트가 새 순서를 따른다
    got = run_saved(browser, tmp_path, serve, text,
                    "__deck.go(2); return [__deck.count, __deck.notes(), document.getElementById('cnt').textContent];")
    assert got == [4, "새 장 노트 </script>", "3 / 4"]


def test_flow_save_notes_escape_and_pages(browser, decks, tmp_path, serve):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    page.fill("#notes", "a < b & c")
    page.click("#toc li >> nth=0")
    page.click("#del")
    page.click("#dup")                                     # 1 둘째 장 · 2 둘째 장(복제) · 3 셋째 장
    assert "비어 보일 수" in page.inner_text("#status")    # 덱 스크립트가 id 로 그리는 칸이 있는 장
    save_with_token(page)
    wait_saved(page, hub)
    text = hub.saved("decks/flow.html")
    s = parse_saved(page, text)
    assert s["n"] == 3 and s["heads"] == ["둘째 장", "둘째 장", "셋째 장"]
    assert s["notesAttr"] == ["a &lt; b &amp; c", "a &lt; b &amp; c", "셋째 노트"]
    assert s["pageno"] == ["1 / 3", "2 / 3", "3 / 3"]
    assert s["on"] == [False, False, False] and s["hse"] is False
    ctx.close()
    assert errors == []
    got = run_saved(browser, tmp_path, serve, text, "__deck.go(1); return [__deck.count, __deck.notes()];")
    assert got == [3, "2/3 a < b & c"]


def test_token_dialog_errors_and_conflict(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    frame(page).locator("h2").first.click()
    page.keyboard.press("End")
    page.keyboard.type("가")
    # 토큰 없이 저장 → 토큰 창, 취소하면 아무것도 보내지 않는다
    page.click("#save")
    assert page.locator("#tokenDlg").is_visible()
    page.click("#tokenCancel")
    assert hub.puts() == [] and state(page)["dirty"] is True
    # 401 → 토큰을 잊고 다시 묻는다(오류 글과 함께)
    hub.put_status = 401
    save_with_token(page)
    for _ in range(50):
        if page.locator("#tokenErr").is_visible():
            break
        page.wait_for_timeout(100)
    assert "토큰이 맞지 않거나" in page.inner_text("#tokenErr")
    hub.put_status = None
    page.fill("#token", TOKEN)
    page.click("#tokenGo")
    wait_saved(page, hub, 2)
    assert state(page)["dirty"] is False
    # 다른 곳에서 저장소의 덱이 바뀌면 → 충돌 창 → 덮어쓰기는 지금 저장소 판의 sha 로 보낸다
    frame(page).locator("h2").first.click()
    page.keyboard.press("End")
    page.keyboard.type("나")
    hub.files["decks/flow.html"] = b"<!doctype html><title>other</title>"
    page.click("#save")
    pw.expect(page.locator("#cfDlg")).to_be_visible()
    assert "바뀌었습니다" in page.inner_text("#cfText")
    with page.expect_download() as dl:
        page.click("#cfDownload")
    assert dl.value.suggested_filename == "flow_편집본.html"
    page.click("#cfOverwrite")
    for _ in range(50):
        if hub.files["decks/flow.html"] != b"<!doctype html><title>other</title>":
            break
        page.wait_for_timeout(100)
    assert hub.put_body()["sha"] == blob_sha(b"<!doctype html><title>other</title>")
    assert "흐름 덱 표지가나" in hub.saved("decks/flow.html")
    ctx.close()
    assert errors == []


def test_unsaved_changes_guard(browser, decks):
    base, hub = decks
    ctx, page, _ = open_editor(browser, base, "flow", hub)
    page.click("#add")
    seen = []
    page.on("dialog", lambda d: (seen.append(d.type), d.dismiss()))
    page.close(run_before_unload=True)
    page.wait_for_timeout(300)
    assert seen == ["beforeunload"]
    ctx.close()


# ---------- 이 PC(slides edit)

@pytest.fixture
def local_edit(tmp_path):
    """slides edit 처럼 두 서버(편집기·발표 화면)를 띄운다. 덱은 CRLF 로 저장한 빌더 덱이고, 덱 폴더의 그림을 부른다."""
    folder = tmp_path / "talk"
    folder.mkdir()
    deck = folder / "시험 덱.html"
    anchor = '<div class="el tx" data-name="title" style="left:64px;top:200px'
    text = BUILDER.replace(anchor, '<img class="el" id="pic" src="pic.jpg" alt="" '
                                   'style="left:0;top:0;width:64px;height:36px">' + anchor, 1)
    assert 'id="pic"' in text
    deck.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
    (folder / "pic.jpg").write_bytes(samples.jpeg())
    session = slides.EditSession(deck.resolve(), tmp_path / "backups")
    edit, show, url = slides.edit_servers(session)
    for srv in (edit, show):
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield SimpleNamespace(deck=deck, session=session, url=url, edit=edit.server_address[1], show=show.server_address[1])
    for srv in (edit, show):
        srv.shutdown()
        srv.server_close()


def wait_file(page, path: Path, old: bytes) -> bytes:
    """파일이 old 와 달라지고 편집기의 저장이 끝나기를 기다려 새 바이트를 돌려준다."""
    for _ in range(100):
        cur = path.read_bytes()
        if cur != old and not state(page)["saving"]:
            return cur
        page.wait_for_timeout(100)
    raise AssertionError("파일에 저장되지 않았습니다")


def test_local_edit_saves_to_the_file_and_presents_apart(browser, local_edit):
    e = local_edit
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    # 열쇠 없이, 틀린 열쇠로 열면 까닭을 알리고(돌아갈 갤러리는 없다) 아무것도 읽지 않는다
    for suffix, want in (("", "열쇠가 주소에 없습니다"), ("#key=" + "x" * 43, "요청을 거절했습니다")):
        bare = ctx.new_page()
        bare.goto(f"http://127.0.0.1:{e.edit}/editor/?local=1{suffix}")
        bare.wait_for_selector("#fail:not([hidden])", timeout=60000)
        assert want in bare.inner_text("#failMsg") and bare.locator("#failBack").is_hidden()
        bare.close()

    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(e.url)
    page.wait_for_selector("#app.ready", timeout=60000)
    assert "key=" not in page.url                                   # 열쇠는 주소 창에서 곧바로 지운다
    assert page.inner_text("#where") == f"이 PC · {e.deck.resolve()}"
    assert page.locator("#back").is_hidden()
    present = page.get_attribute("#present", "href")
    assert present == f"http://127.0.0.1:{e.show}/deck-files/{e.session.show_key}/{quote('시험 덱.html')}"
    for _ in range(50):                                             # 편집 화면의 덱은 덱 폴더의 그림을 부른다
        if frame(page).locator("#pic").evaluate("(i) => i.complete && i.naturalWidth > 0"):
            break
        page.wait_for_timeout(100)
    else:
        raise AssertionError("덱 폴더의 그림을 불러오지 못했습니다")

    before = e.deck.read_bytes()
    page.click("#add")
    page.keyboard.press("Control+s")
    saved = wait_file(page, e.deck, before)
    assert saved.count(b"\r\n") == saved.count(b"\n") > 0           # 원래 파일의 CRLF 를 지킨다
    assert saved.decode("utf-8").count('<section class="slide') == 4
    assert state(page)["dirty"] is False and "저장했습니다" in page.inner_text("#status")
    kept = list(e.session.backups.iterdir())
    assert len(kept) == 1 and kept[0].read_bytes() == before         # 저장 전 판

    page.reload()                                                     # 주소에 열쇠가 없어도 이 탭에서는 다시 열린다
    page.wait_for_selector("#app.ready", timeout=60000)
    assert state(page)["n"] == 4

    # 발표 화면: 저장한 판이 덱 스크립트와 함께 돈다 — 그 화면(다른 출처)에서는 열쇠가 있어도 저장 API 에 닿지 못한다
    show = ctx.new_page()
    show.goto(present)
    assert show.evaluate("window.__deck.count") == 4
    blocked = show.evaluate("""async ([url, key]) => {
        try { await fetch(url, {method: 'PUT', headers: {'X-HSE-Key': key}, body: 'x'}); return 'reached'; }
        catch (err) { return 'blocked'; } }""", [f"http://127.0.0.1:{e.edit}/api/deck", e.session.key])
    assert blocked == "blocked" and e.deck.read_bytes() == saved
    show.close()

    # 다른 프로그램이 파일을 고친 뒤 저장하면 부딪침을 알리고, 덮어쓰기를 고르면 그 판을 남기고 덮는다
    other = b"<!doctype html><html><body>elsewhere</body></html>"
    e.deck.write_bytes(other)
    page.click("#add")
    page.click("#save")
    pw.expect(page.locator("#cfDlg")).to_be_visible()
    assert "다른 곳에서 바뀌었습니다" in page.inner_text("#cfText")
    page.click("#cfOverwrite")
    final = wait_file(page, e.deck, other)
    assert final.decode("utf-8").count('<section class="slide') == 5
    assert any(p.read_bytes() == other for p in e.session.backups.iterdir())
    ctx.close()
    assert errors == []
