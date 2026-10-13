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
.el{position:absolute;display:flex;flex-direction:column;margin:0;user-select:none;cursor:move}
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
<div class="el tx" data-name="body" style="left:64px;top:160px;width:1100px;height:200px"><div class="tin"><p class="pp" style="font-size:24px;line-height:31.2px;color:#222">첫 문단</p><p class="pp" style="font-size:24px;line-height:31.2px;color:#222">둘째 문단</p></div></div>
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
    for d in ("assets", "editor", "vendor/pptxgenjs"):
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


# ---------- 서식 막대

def bar(page) -> dict:
    return page.evaluate("""() => {
        const v = (id) => document.getElementById(id);
        const on = (id) => v(id).getAttribute('aria-pressed') === 'true';
        return { size: v('fSize').value, font: v('fFont').value, bold: on('fBold'), italic: on('fItalic'),
                 under: on('fUnder'), center: on('fCenter'), off: v('fBold').disabled, box: !v('fBox').classList.contains('off') };
    }""")


def look(loc, text: str) -> dict | None:
    """글 text 를 가진 글 마디의 보이는 모양(밑줄·형광은 조상까지 본다)."""
    return loc.evaluate("""(e, text) => {
        const w = e.ownerDocument.createTreeWalker(e, 4);
        for (let t = w.nextNode(); t; t = w.nextNode()) {
            if (!t.data.includes(text)) continue;
            const el = t.parentElement, cs = getComputedStyle(el);
            let deco = '', bg = '';
            for (let n = el; n && n !== e.parentElement; n = n.parentElement) {
                const c = getComputedStyle(n);
                deco += ' ' + c.textDecorationLine;
                if (!bg && c.backgroundColor !== 'rgba(0, 0, 0, 0)') bg = c.backgroundColor;
            }
            return { weight: cs.fontWeight, style: cs.fontStyle, deco, color: cs.color, family: cs.fontFamily,
                     size: cs.fontSize, bg };
        }
        return null; }""", text)


def test_format_size_in_points_whole_box_and_one_undo_step(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    assert bar(page)["off"] is True                        # 글을 고르기 전에는 막대가 꺼져 있다
    page.keyboard.press("PageDown")
    body = frame(page).locator("[data-name=body] .tin")
    ps = body.locator("p")
    ps.first.click()
    assert bar(page)["off"] is False and bar(page)["size"] == "18"    # 24px = 18pt
    # 글을 고르지 않고 크기를 넣으면 그 글 칸 전체에 — 문단을 통째로 덮은 서식은 문단으로 올라간다
    page.fill("#fSize", "30")
    page.keyboard.press("Enter")
    styles = [ps.nth(i).get_attribute("style").replace(" ", "") for i in range(2)]
    assert all("font-size:40px" in s for s in styles), styles
    assert all("line-height:1.3;" in s for s in styles), styles    # px 줄 높이(31.2px)는 같은 모양의 비율로
    assert body.locator("span").count() == 0 and state(page)["undo"] == 1
    assert bar(page)["size"] == "30"
    # 서식을 넣었다고 글 칸 전체가 골라진 채 남지 않는다 — 다음 글자가 글을 덮어쓰지 않는다
    page.keyboard.type("X")
    assert ps.first.inner_text() == "첫 문단X" and ps.nth(1).inner_text() == "둘째 문단"
    # Ctrl+] / Ctrl+[ 는 크기 목록의 다음·앞 크기로
    page.keyboard.press("Control+BracketRight")
    assert "font-size:42.67px" in ps.first.get_attribute("style").replace(" ", "") and bar(page)["size"] == "32"
    page.keyboard.press("Control+BracketLeft")
    assert bar(page)["size"] == "28"
    text = page.evaluate("window.__hse.serialize()")
    assert "xxx-large" not in text and "data-hse" not in text and "contenteditable" not in text
    for _ in range(4):                                     # 크기(28·32), 글자 X, 처음 크기(30)
        page.keyboard.press("Control+z")
    styles = [ps.nth(i).get_attribute("style").replace(" ", "") for i in range(2)]
    assert all("font-size:24px" in s and "line-height:31.2px" in s for s in styles), styles
    assert same_dom(page, hub.saved("decks/builder.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


def test_format_selection_shortcuts_color_font_align_and_clear(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    p = frame(page).locator("[data-name=body] .tin p").first
    p.click()
    page.keyboard.press("End")
    page.keyboard.press("Shift+ArrowLeft")
    page.keyboard.press("Shift+ArrowLeft")                 # '문단' — .el 의 user-select:none 이어도 고를 수 있다
    assert frame(page).locator("body").evaluate("(b) => b.ownerDocument.getSelection().toString()") == "문단"
    page.keyboard.press("Control+b")
    page.keyboard.press("Control+i")
    page.keyboard.press("Control+u")
    got = look(p, "문단")
    assert got["weight"] == "700" and got["style"] == "italic" and "underline" in got["deco"]
    assert look(p, "첫")["weight"] == "400"                # 고른 글만
    assert bar(page)["bold"] and bar(page)["italic"] and bar(page)["under"]
    page.locator("#fColor").fill("#ff0000")                # 색 창을 닫을 때(change) 한 번
    assert look(p, "문단")["color"] == "rgb(255, 0, 0)" and look(p, "첫")["color"] == "rgb(34, 34, 34)"
    page.select_option("#fFont", label="Georgia")
    assert look(p, "문단")["family"].startswith("Georgia")
    page.locator("#fMark").fill("#ffff00")
    assert look(p, "문단")["bg"] == "rgb(255, 255, 0)"
    page.click("#fCenter")
    assert p.evaluate("(e) => e.style.textAlign") == "center" and bar(page)["center"]
    assert state(page)["undo"] == 7                        # 고른 것마다 되돌리기 한 칸
    page.click("#fClear")                                  # 글자 서식 지우기 — 문단의 모양(크기·색·맞춤)은 그대로
    got = look(p, "문단")
    assert got["weight"] == "400" and got["style"] == "normal" and "underline" not in got["deco"] and got["bg"] == ""
    assert got["size"] == "24px" and got["color"] == "rgb(34, 34, 34)" and got["family"] == look(p, "첫")["family"]
    assert p.evaluate("(e) => [e.style.textAlign, e.style.fontSize, e.innerHTML]") == ["center", "24px", "첫 문단"]
    for _ in range(8):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/builder.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


def test_clear_format_reverts_whole_box_formatting_but_keeps_the_paragraph(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    ps = frame(page).locator("[data-name=body] .tin p")
    ps.first.click()
    page.keyboard.press("Control+b")                       # 캐럿만 — 글 칸 전체가 굵게(문단으로 올라간다)
    page.click("#fCenter")
    assert [look(ps.nth(i), "문단")["weight"] for i in range(2)] == ["700", "700"]
    page.click("#fClear")                                  # 굵게는 걷히고 맞춤·문단 크기는 남는다
    got = [ps.nth(i).evaluate("(e) => [e.style.fontWeight, e.style.textAlign, e.style.fontSize, e.innerHTML]") for i in range(2)]
    assert got == [["", "center", "24px", "첫 문단"], ["", "center", "24px", "둘째 문단"]]
    assert frame(page).locator("[data-hse-st]").count() == 0
    for _ in range(3):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/builder.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


def test_paragraph_look_stays_on_the_paragraph(browser, decks):
    """브라우저 명령이 문단의 색·굵기를 걷어 글 쪽으로 밀어 넣지 않게 — 문단에 새로 친 글도 덱의 모양을 따른다."""
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    p = frame(page).locator("[data-name=body] .tin p").first
    p.click()
    page.keyboard.press("End")
    page.keyboard.press("Shift+ArrowLeft")
    page.locator("#fColor").fill("#ff0000")                # '단'만 빨강
    assert p.evaluate("(e) => [e.style.color, e.innerHTML]") == ["rgb(34, 34, 34)", '첫 문<span style="color: rgb(255, 0, 0);">단</span>']
    page.keyboard.press("Home")
    page.keyboard.type("새 ")                              # 문단 앞에 친 글은 문단의 색
    assert look(p, "새")["color"] == "rgb(34, 34, 34)"
    # 문단 style 로 굵은 제목의 일부만 굵게 끄기 — 문단은 굵은 채, 고른 글만 보통
    title = frame(page).locator("section.slide").nth(0).locator("[data-name=title] .tin p")
    page.keyboard.press("Escape")                          # 글 칸에서 나와야 PageUp 이 장을 넘긴다
    page.keyboard.press("PageUp")
    title.evaluate("(e) => { e.style.fontWeight = '700'; }")
    title.click()
    page.keyboard.press("End")
    page.keyboard.press("Shift+ArrowLeft")
    page.keyboard.press("Shift+ArrowLeft")
    page.keyboard.press("Control+b")
    assert title.evaluate("(e) => e.style.fontWeight") == "700"
    assert look(title, "표지")["weight"] == "400" and look(title, "시험")["weight"] == "700"
    ctx.close()
    assert errors == []


def test_notes_keep_their_own_shortcuts(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.click("#notes")
    page.keyboard.press("Control+a")
    page.keyboard.press("Control+b")                       # 노트 칸은 글만 받는다 — 덱에 서식이 들어가지 않는다
    assert state(page)["undo"] == 0 and "font-weight" not in page.evaluate("window.__hse.serialize()")
    ctx.close()
    assert errors == []


# ---------- 상자 옮기기·크기 바꾸기

def drag(page, handle: str, dx: float, dy: float, shift: bool = False, at: float = 0.5) -> None:
    b = page.locator(handle).bounding_box()
    x, y = b["x"] + b["width"] * at, b["y"] + b["height"] / 2
    page.mouse.move(x, y)
    if shift:
        page.keyboard.down("Shift")
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=6)
    page.mouse.up()
    if shift:
        page.keyboard.up("Shift")


def test_builder_boxes_move_resize_nudge_delete_and_fields(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    f = frame(page)
    f.locator("section.slide").nth(1).locator("[data-name=title] .tin p").click()   # 글상자를 누르면 그 상자를 고른다
    assert page.locator(".pick").is_visible() and bar(page)["box"]
    assert state(page)["box"] == {"x": 64, "y": 70, "w": 1100, "h": 60}
    s = state(page)["scale"]
    drag(page, ".pick-h.se", -100 * s, 40 * s)             # 오른쪽 아래 손잡이 — 글상자는 비율을 지키지 않는다
    assert state(page)["box"] == {"x": 64, "y": 70, "w": 1000, "h": 100}
    drag(page, ".pick-edge.top", 30 * s, 20 * s, at=0.25)  # 테두리를 끌어 옮기기(가운데는 손잡이)
    assert state(page)["box"] == {"x": 94, "y": 90, "w": 1000, "h": 100}
    drag(page, ".pick-h.nw", 10 * s, 10 * s)               # 왼쪽 위 손잡이 — 오른쪽 아래 모서리는 제자리
    assert state(page)["box"] == {"x": 104, "y": 100, "w": 990, "h": 90}
    assert state(page)["undo"] == 3
    page.fill("#bW", "500")
    page.keyboard.press("Enter")
    assert state(page)["box"]["w"] == 500 and state(page)["undo"] == 4
    # 글이 없는 상자(그림·도형)는 눌러 고른 뒤 방향키로 옮긴다 — 잇달아 누른 것이 되돌리기 한 칸
    f.locator("svg.el").click()
    assert state(page)["box"] == {"x": 64, "y": 400, "w": 200, "h": 20}
    for key in ("ArrowRight", "ArrowRight", "ArrowRight", "Shift+ArrowDown"):
        page.keyboard.press(key)
    assert state(page)["box"] == {"x": 67, "y": 410, "w": 200, "h": 20}
    page.wait_for_timeout(900)
    assert state(page)["undo"] == 5 and state(page)["cur"] == 1    # 장은 넘어가지 않았다
    page.keyboard.press("Delete")
    assert f.locator("section.slide").nth(1).locator("svg.el").count() == 0 and state(page)["box"] is None
    page.keyboard.press("Control+z")
    assert f.locator("section.slide").nth(1).locator("svg.el").count() == 1
    page.keyboard.press("Escape")
    page.keyboard.press("ArrowRight")                      # 고른 상자가 없으면 방향키는 다시 장을 넘긴다
    assert state(page)["cur"] == 2
    for _ in range(5):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/builder.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


PICS = f"""<!doctype html><html><head><meta charset="utf-8"><title>그림 시험 덱</title>
<style>.slide{{display:none;width:1280px;height:720px}}.slide.on{{display:block}}img{{max-width:100%}}</style></head><body>
<div class="deck"><section class="slide on"><h2>그림 장</h2><figure><img id="pic" src="{GIF}" width="200" height="100" alt=""></figure></section>
<section class="slide"><h2>둘째 장</h2></section></div></body></html>
"""


def test_flow_pictures_resize_keeping_their_shape(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"pics.html": PICS})
    hub = DeckHub({"decks/pics.html": (root / "decks" / "pics.html").read_bytes()})
    ctx, page, errors = open_editor(browser, serve(site), "pics", hub)
    img = frame(page).locator("#pic")
    img.click()
    assert state(page)["box"]["w"] == 200 and state(page)["box"]["h"] == 100
    assert page.locator(".pick.fixed").count() == 1 and not page.locator("#bX").is_visible()   # 자리는 흐름이 정한다
    s = state(page)["scale"]
    drag(page, ".pick-h.se", 100 * s, 10 * s)              # 모서리 — 그림은 보이던 비율(2:1)을 지킨다
    assert img.evaluate("(e) => [e.style.width, e.style.height, e.style.maxWidth]") == ["300px", "150px", "none"]
    drag(page, ".pick-h.se", 50 * s, 30 * s, shift=True)   # Shift — 비율을 풀고
    assert img.evaluate("(e) => [e.style.width, e.style.height]") == ["350px", "180px"]
    page.fill("#bW", "100")                                # 가로만 넣어도 세로가 비율대로
    page.keyboard.press("Enter")
    assert img.evaluate("(e) => [e.style.width, e.style.height]") == ["100px", "51px"]
    for _ in range(3):
        page.keyboard.press("Control+z")
    assert img.evaluate("(e) => e.getAttribute('style')") is None
    ctx.close()
    assert errors == []


SELECT_JS = """([css, a, b, k]) => {
    const d = document.getElementById('frame').contentDocument;
    const root = d.querySelector(css);
    const w = d.createTreeWalker(root, 4);
    const texts = [];
    for (let t = w.nextNode(); t; t = w.nextNode()) texts.push(t);
    const s = texts.find((t) => t.data.includes(a));
    const so = s.data.indexOf(a);
    const r = d.createRange();
    if (b === null) {
        r.setStart(s, so + k);
        r.collapse(true);
    } else {
        const e = texts.slice(texts.indexOf(s)).find((t) => t.data.indexOf(b, t === s ? so : 0) >= 0);
        r.setStart(s, so);
        r.setEnd(e, e.data.indexOf(b, e === s ? so : 0) + b.length);
    }
    (root.closest('[data-hse-ce]') || root).focus();
    const sel = d.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return sel.toString();
}"""


def select_text(page, css: str, a: str, b: str = "") -> str:
    """덱 화면에서 css 안의 글 a 부터 b(없으면 a)의 끝까지 고른다."""
    got = page.evaluate(SELECT_JS, [css, a, b or a, 0])
    page.wait_for_timeout(60)                              # selectionchange 가 막대에 닿도록
    return got


def caret(page, css: str, a: str, k: int = 0) -> None:
    """덱 화면에서 css 안의 글 a 의 k 번째 글자 앞에 캐럿만 둔다."""
    page.evaluate(SELECT_JS, [css, a, None, k])
    page.wait_for_timeout(60)


FMT = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>서식 시험 덱</title>
<style>
body{margin:0;font-family:sans-serif}
.deck{position:relative;width:1280px;height:720px;background:#FFFFFF}
.slide{position:absolute;inset:0;padding:40px 72px;display:none}
.slide.on{display:block}
h2 span{color:#2563EB}
.sw{display:inline-block;width:12px;height:12px;background:#f00;margin-right:6px}
a{color:#0a58ca}
p,li{font-size:20px}
</style></head><body>
<div class="deck">
<section class="slide on"><h2 id="h">TITLE <span>ACCENT</span> END</h2>
<p id="p1">aa <b>BOLD</b> zz</p>
<p id="p2"><a href="https://example.com/">LINKONLY</a></p>
<p id="p3">x <a href="https://example.com/">LINK</a> y</p>
<ul id="u1"><li>one first</li><li><span class="sw"></span>sales</li><li><span style="font-size:0.8em">small item</span></li></ul>
</section>
<section class="slide"><h2>둘째 장</h2><p>문단</p></section>
</div></body></html>
"""


def test_format_touches_only_the_chosen_text_and_keeps_deck_markup(browser, tmp_path, serve):
    """서식은 고른 글에만 — 덱 CSS 가 꾸미는 span·빈 범례 칸·em 크기 span 은 그대로, 크기 표시(xxx-large)는 남지 않는다."""
    site, root = make_site(tmp_path, {"fmt.html": FMT})
    hub = DeckHub({"decks/fmt.html": (root / "decks" / "fmt.html").read_bytes()})
    ctx, page, errors = open_editor(browser, serve(site), "fmt", hub)
    f = frame(page)
    # 제목의 한 낱말만 굵게 끄기 — 브라우저가 만든 span 에 덱의 h2 span { color } 가 걸려도 글자색은 그대로
    select_text(page, "#h", "TITLE")
    page.click("#fBold")
    h = f.locator("#h")
    assert look(h, "TITLE")["weight"] == "400" and look(h, "TITLE")["color"] == "rgb(0, 0, 0)"
    assert look(h, "ACCENT")["color"] == "rgb(37, 99, 235)" and look(h, "END")["weight"] == "700"
    # 링크만 든 문단(캐럿 — 칸 전체)과 꼭 맞게 고른 <b> 에 30pt — 크기 표시가 a·b 에 남지 않는다
    caret(page, "#p2", "LINKONLY", 3)
    page.fill("#fSize", "30")
    page.keyboard.press("Enter")
    select_text(page, "#p1", "BOLD")
    page.fill("#fSize", "30")
    page.keyboard.press("Enter")
    assert look(f.locator("#p2"), "LINKONLY")["size"] == "40px" and look(f.locator("#p1"), "BOLD")["size"] == "40px"
    assert look(f.locator("#p1"), "aa")["size"] == "20px"
    assert "xxx-large" not in page.evaluate("window.__hse.serialize()")
    # 목록 한 항목의 낱말만 굵게 — 다른 항목의 빈 범례 칸·em 크기 span 은 그대로
    select_text(page, "#u1", "one")
    page.click("#fBold")
    u = f.locator("#u1")
    assert u.locator("span.sw").count() == 1
    assert u.locator("li").nth(2).evaluate("(e) => [e.getAttribute('style'), e.innerHTML]") == [
        None, '<span style="font-size:0.8em">small item</span>']
    # 링크에 입힌 색도 서식 지우기로 걷힌다
    select_text(page, "#p3", "LINK")
    page.locator("#fColor").fill("#ff0000")
    assert look(f.locator("#p3"), "LINK")["color"] == "rgb(255, 0, 0)"
    page.click("#fClear")
    assert look(f.locator("#p3"), "LINK")["color"] == "rgb(10, 88, 202)"
    assert f.locator("#p3 a").evaluate("(e) => e.getAttribute('style')") is None
    # 형광 칸은 고른 글의 형광 — 앞 글에 고른 노랑을 다음 글에 또 골라도 바뀐 값이라 입혀진다
    select_text(page, "#p1", "aa")
    page.locator("#fMark").fill("#ffff00")
    select_text(page, "#p1", "zz")
    assert page.input_value("#fMark") == "#ffffff"
    select_text(page, "#p1", "aa")
    assert page.input_value("#fMark") == "#ffff00"
    text = page.evaluate("window.__hse.serialize()")
    assert "xxx-large" not in text and "data-hse" not in text and 'style=""' not in text
    n = state(page)["undo"]
    assert n == 7
    page.keyboard.press("Escape")
    for _ in range(n):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/fmt.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


BUILDER_NL = BUILDER.replace('첫 문단</p><p class="pp"', '첫 문단</p>\n<p class="pp"')


def test_format_aligns_keeps_the_caret_and_clears_part_of_a_formatted_box(browser, tmp_path, serve):
    assert BUILDER_NL != BUILDER
    site, root = make_site(tmp_path, {"builder.html": BUILDER_NL})
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, serve(site), "builder", hub)
    page.keyboard.press("PageDown")
    body = "[data-name=body] .tin"
    ps = frame(page).locator(f"{body} p")
    # 세 번 눌러 고른 문단(범위 끝이 다음 문단 처음에 닿는다)의 맞춤은 그 문단에만
    ps.first.click(click_count=3)
    page.click("#fCenter")
    assert [ps.nth(i).evaluate("(e) => e.style.textAlign") for i in range(2)] == ["center", ""]
    # 둘째 문단 처음의 캐럿 — 칸 전체를 굵게 한 뒤에도 그 자리(문단 사이의 줄바꿈 글이 아니라)
    caret(page, body, "둘째")
    page.keyboard.press("Control+b")
    assert bar(page)["bold"] and bar(page)["size"] == "18"
    page.keyboard.type("Z")
    assert ps.nth(1).inner_text() == "Z둘째 문단" and ps.count() == 2
    # 칸 전체를 굵게 한 뒤 한 낱말만 서식 지우기 — 그 낱말만 보통, 나머지는 굵은 채
    select_text(page, body, "문단")
    page.click("#fClear")
    assert look(ps.first, "문단")["weight"] == "400" and look(ps.first, "첫")["weight"] == "700"
    assert look(ps.nth(1), "둘째")["weight"] == "700"
    # 글을 다 지운 칸 — 크기는 문단에 적혀 다음에 친 글이 따른다
    title = frame(page).locator("section.slide").nth(1).locator("[data-name=title] .tin")
    title.locator("p").click()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.fill("#fSize", "36")
    page.keyboard.press("Enter")
    page.keyboard.type("Q")
    assert look(title, "Q")["size"] == "48px" and title.locator("p").count() == 1
    # 덱 화면의 빈 곳을 누르면 옛 선택을 버린다 — 보이지 않는 글에 서식이 들어가지 않게
    select_text(page, body, "첫")
    sheet = page.locator("#sheet").bounding_box()
    page.mouse.click(sheet["x"] + sheet["width"] * 0.8, sheet["y"] + sheet["height"] * 0.9)
    page.wait_for_timeout(60)
    assert bar(page)["off"]
    ctx.close()
    assert errors == []


def test_box_drag_ignores_keys_and_fields_apply_to_their_own_box(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    f = frame(page)
    s2 = f.locator("section.slide").nth(1)
    sheet = page.locator("#sheet").bounding_box()
    svg = s2.locator("svg.el")
    svg.click()
    assert page.locator("#sheet").bounding_box() == sheet   # 상자를 골라도 서식 막대의 줄 수·덱 화면의 배율은 그대로
    # 끄는 동안의 키는 쓰지 않는다 — 장을 넘기거나 되돌리지 않고, 놓으면 끈 것이 한 칸
    b = svg.bounding_box()
    x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 40, y, steps=4)
    for key in ("ArrowRight", "PageDown", "Control+z"):
        page.keyboard.press(key)
    assert state(page)["cur"] == 1 and state(page)["undo"] == 0
    page.mouse.move(x + 80, y, steps=4)
    page.mouse.up()
    assert state(page)["undo"] == 1 and state(page)["box"]["x"] > 64 and state(page)["box"]["y"] == 400
    # Esc 는 끌기를 거둔다 — 상자는 제자리에 고른 채로, 되돌리기 칸은 그대로
    s2.locator("[data-name=title] .tin p").click()
    page.keyboard.press("Escape")
    e = page.locator(".pick-edge.top").bounding_box()
    ex, ey = e["x"] + e["width"] * 0.25, e["y"] + e["height"] / 2
    page.mouse.move(ex, ey)
    page.mouse.down()
    page.mouse.move(ex + 30, ey + 20, steps=4)
    assert state(page)["box"]["x"] != 64
    page.keyboard.press("Escape")
    page.mouse.up()
    assert state(page)["box"] == {"x": 64, "y": 70, "w": 1100, "h": 60} and state(page)["undo"] == 1
    # 칸에 치고 Enter 없이 다른 상자를 누르면 그 값은 누른 상자가 아니라 치던 상자에
    page.fill("#bW", "500")
    svg.click()
    assert s2.locator("[data-name=title]").evaluate("(e) => e.style.width") == "500px"
    assert svg.evaluate("(e) => e.style.width") == "200px" and page.input_value("#bW") == "200"
    page.fill("#bW", "5")                                  # 받지 않는 값은 칸에도 실제 값으로 되돌린다
    page.keyboard.press("Enter")
    assert page.input_value("#bW") == "200" and svg.evaluate("(e) => e.style.width") == "200px"
    page.fill("#bW", "300")
    page.keyboard.press("Enter")
    page.keyboard.press("Control+z")                       # 칸에서 되돌리면 고르기가 풀리고 칸에서도 나온다
    assert state(page)["box"] is None
    page.keyboard.press("PageDown")
    assert state(page)["cur"] == 2
    # 높이를 적지 않은 상자(표)는 옮겨도 높이가 굳지 않는다
    table = f.locator("section.slide").nth(2).locator("table.el")
    f.locator("section.slide").nth(2).locator("td").first.click()
    page.keyboard.press("Escape")
    page.keyboard.press("ArrowRight")
    assert table.evaluate("(e) => [e.style.left, e.style.height]") == ["65px", ""]
    assert page.locator(".pick-h.se").evaluate("(e) => getComputedStyle(e).touchAction") == "none"
    page.wait_for_timeout(900)
    n = state(page)["undo"]
    for _ in range(n):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/builder.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []


FORM = f"""<!doctype html><html><head><meta charset="utf-8"><title>입력 칸 시험 덱</title>
<style>.slide{{display:none;width:1280px;height:720px}}.slide.on{{display:block}}</style></head><body>
<div class="deck"><section class="slide on"><h2>입력 장</h2><p><img id="pic" src="{GIF}" width="200" height="100" alt=""></p>
<label>값 <input id="val" value="12345"></label></section><section class="slide"><h2>둘째 장</h2></section></div></body></html>
"""


def test_deck_inputs_take_their_own_keys(browser, tmp_path, serve):
    """덱에 원래 있던 입력 칸에서 친 키는 그 칸의 것 — 고른 그림을 지우거나 장을 넘기지 않는다."""
    site, root = make_site(tmp_path, {"form.html": FORM})
    hub = DeckHub({"decks/form.html": (root / "decks" / "form.html").read_bytes()})
    ctx, page, errors = open_editor(browser, serve(site), "form", hub)
    f = frame(page)
    f.locator("#pic").click()
    assert state(page)["box"] is not None
    page.keyboard.press("Tab")
    assert f.locator("body").evaluate("(b) => b.ownerDocument.activeElement.id") == "val"
    for key in ("End", "Backspace", "ArrowLeft", "Control+b"):
        page.keyboard.press(key)
    assert f.locator("#val").input_value() == "1234" and f.locator("#pic").count() == 1
    assert state(page)["cur"] == 0 and state(page)["undo"] == 0 and state(page)["box"] is not None
    ctx.close()
    assert errors == []


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


# ---------- 새 장 레이아웃

def choose_layout(page, key: str) -> None:
    page.click("#addMenu")
    page.click(f"#layMenu [data-layout={key}]")


def kids(page, i: int, sel: str) -> list:
    """i 번째 장의 자식 가운데 이름(data-name·class·태그)이 sel 에 맞는 것의 [이름, 글]."""
    return frame(page).locator("section.slide").nth(i).evaluate(
        "(s, sel) => [...s.children].map((c) => [c.getAttribute('data-name') || c.getAttribute('class') || c.localName, c])"
        ".filter(([k]) => new RegExp(sel).test(k)).map(([k, c]) => [k, (c.innerText ?? c.textContent).trim()])", sel)


BUILDER_LAYOUTS = {
    "title": [["kicker", "소제목"], ["title", "제목을 입력하세요"], ["pageno", "2 / 3"]],
    "body": [["kicker", "소제목"], ["title", "제목을 입력하세요"], ["body", "내용을 입력하세요\n\n내용을 입력하세요"],
             ["pageno", "2 / 3"]],
    "two": [["kicker", "소제목"], ["title", "제목을 입력하세요"], ["body", "내용을 입력하세요\n\n내용을 입력하세요"],
            ["body", "내용을 입력하세요\n\n내용을 입력하세요"], ["pageno", "2 / 3"]],
    "picture": [["kicker", "소제목"], ["title", "제목을 입력하세요"], ["body", "내용을 입력하세요\n\n내용을 입력하세요"],
                ["picture", "그림 자리 — 고른 뒤 ‘그림 넣기’"], ["pageno", "2 / 3"]],
    "section": [["title", "제목을 입력하세요"], ["kicker", "소제목"], ["pageno", "2 / 3"]],
    "blank": [["pageno", "2 / 3"]],
    "like": [["kicker", "소제목"], ["title", "제목을 입력하세요"], ["body", "내용을 입력하세요"], ["pageno", "2 / 3"]],
}


def test_builder_layouts_follow_the_deck_boxes(browser, decks, tmp_path, serve):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")                        # 둘째 장(소제목·제목·본문·쪽 번호가 있는 장)에서
    for key, want in BUILDER_LAYOUTS.items():
        page.click("#toc li >> nth=1")
        choose_layout(page, key)
        assert state(page)["cur"] == 2 and state(page)["titles"][2] == "새 장", key
        got = kids(page, 2, "kicker|title|body|picture|pageno")
        assert got == want, (key, got)
        if key in ("body", "two"):                         # 본뜬 상자는 덱의 글자 모양을 그대로 따른다
            p = frame(page).locator("section.slide").nth(2).locator("[data-name=body] .tin p").first
            assert "font-size:24px" in p.get_attribute("style").replace(" ", "")
        if key == "section":                               # 구역 머리는 표지의 바탕
            bg = frame(page).locator("section.slide").nth(2).evaluate("(s) => s.style.backgroundColor")
            assert bg == "rgb(16, 33, 63)"
    assert state(page)["n"] == 3 + len(BUILDER_LAYOUTS)
    text = page.evaluate("window.__hse.serialize()")
    s = parse_saved(page, text)
    n = s["n"]
    assert s["pageno"][0] is None and s["pageno"][1:] == [f"{i} / {n}" for i in range(2, n + 1)]
    assert s["hse"] is False and len(set(s["keys"])) == n
    for _ in range(len(BUILDER_LAYOUTS)):
        page.keyboard.press("Control+z")
    assert same_dom(page, hub.saved("decks/builder.html"), page.evaluate("window.__hse.serialize()"))
    ctx.close()
    assert errors == []
    got = run_saved(browser, tmp_path, serve, text, "__deck.go(9); return [__deck.count, document.getElementById('cnt').textContent];")
    assert got == [n, f"10 / {n}"]


FLOW_LAYOUTS = {
    "title": ["eyebrow", "h2", "foot"],
    "body": ["eyebrow", "h2", "p", "ul", "foot"],
    "two": ["eyebrow", "h2", "div", "foot"],
    "picture": ["eyebrow", "h2", "div", "foot"],
    "section": ["div", "foot"],
    "blank": ["foot"],
    "like": ["eyebrow", "h2", "ul", "chart", "p", "foot"],
}


def test_flow_layouts_follow_the_current_slide(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    for key, want in FLOW_LAYOUTS.items():
        page.click("#toc li >> nth=1")
        choose_layout(page, key)
        sec = frame(page).locator("section.slide").nth(2)
        got = sec.evaluate("(s) => [...s.children].map((c) => c.classList[0] || c.localName)")
        assert got == want, (key, got)
        assert sec.get_attribute("data-notes") == "" and page.input_value("#notes") == ""
        if key == "like":                                  # 글만 안내 글로 — 목록은 항목 하나, 꼬리말은 그대로
            texts = sec.evaluate("(s) => [...s.querySelectorAll('.eyebrow, h2, li, p')].map((e) => e.textContent.trim())")
            assert texts == ["소제목", "제목을 입력하세요", "내용을 입력하세요", "내용을 입력하세요"], texts
            assert sec.locator(".foot span").all_text_contents() == ["시험", "2 / 3"]
    assert frame(page).locator("[data-name=picture]").count() == 1
    s = parse_saved(page, page.evaluate("window.__hse.serialize()"))
    assert s["pageno"] == [f"{i} / {s['n']}" for i in range(1, s["n"] + 1)]
    ctx.close()
    assert errors == []


def test_layout_menu_keyboard_and_placeholders(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.click("#addMenu")
    assert page.locator("#layMenu").is_visible() and page.locator("#addMenu").get_attribute("aria-expanded") == "true"
    page.keyboard.press("Escape")
    assert not page.locator("#layMenu").is_visible() and state(page)["cur"] == 0
    page.click("#addMenu")
    page.mouse.click(5, 5)                                 # 바깥을 누르면 닫힌다
    assert not page.locator("#layMenu").is_visible()
    page.click("#addMenu")
    focused = "document.activeElement.dataset.layout || document.activeElement.id"
    page.keyboard.press("ArrowDown")                       # 메뉴의 화살표는 위아래도 한 칸씩
    assert page.evaluate(focused) == "body"
    page.keyboard.press("ArrowUp")
    assert page.evaluate(focused) == "title"
    page.keyboard.press("ArrowRight")                      # 둘째 칸(제목과 본문)
    page.keyboard.press("Enter")
    assert state(page)["n"] == 4 and not page.locator("#layMenu").is_visible()
    assert page.evaluate(focused) == "addMenu"             # 고르면 ▾ 로 돌아온다(숨은 메뉴에 초점이 남지 않게)
    body = frame(page).locator("section.slide").nth(1).locator("[data-name=body] .tin p").first
    body.click()                                           # 안내 글은 누르면 통째로 골라진다
    page.keyboard.type("첫 줄")
    assert body.inner_text() == "첫 줄"
    title = frame(page).locator("section.slide").nth(1).locator("[data-name=title] .tin p")
    title.click()
    page.keyboard.type("새 제목")
    assert title.inner_text() == "새 제목"
    title.click()                                          # 고친 글은 다시 눌러도 골라지지 않는다
    page.keyboard.press("End")
    page.keyboard.type("!")
    assert title.inner_text() == "새 제목!"
    page.click("#addMenu")
    page.keyboard.press("Control+z")                       # 메뉴가 열린 채여도 Ctrl+Z·Y 는 편집기의 것
    assert title.inner_text() != "새 제목!"
    page.keyboard.press("Control+y")
    assert title.inner_text() == "새 제목!"
    ctx.close()
    assert errors == []


# ---------- 그림 넣기

PNG_2x1 = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGBgAKdIF+0lbKJQAAAAASUVORK5CYII=")


def test_picture_fills_the_placeholder_keeping_its_shape(browser, decks, tmp_path):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    choose_layout(page, "picture")
    sec = frame(page).locator("section.slide").nth(2)
    ph = sec.locator("[data-name=picture]")
    box = ph.evaluate("(e) => [parseFloat(e.style.left), parseFloat(e.style.top), parseFloat(e.style.width), parseFloat(e.style.height)]")
    ph.click()                                             # 그림 자리를 고른 뒤 넣으면 그 자리에
    png = tmp_path / "보고서_그림-1.png"
    png.write_bytes(PNG_2x1)
    page.set_input_files("#picFile", str(png))
    img = sec.locator("img")
    img.wait_for()
    assert sec.locator("div[data-name=picture]").count() == 0
    got = img.evaluate("(e) => [e.getAttribute('src').slice(0, 22), e.alt, e.style.objectFit, parseFloat(e.style.left),"
                       " parseFloat(e.style.top), parseFloat(e.style.width), parseFloat(e.style.height)]")
    assert got[:3] == ["data:image/png;base64,", "보고서 그림 1", "contain"]
    x, y, w, h = got[3:]
    assert abs(w / h - 2) < 0.02 and w <= box[2] + 1 and h <= box[3] + 1         # 자리 안에 비율대로
    assert abs((x + w / 2) - (box[0] + box[2] / 2)) <= 1 and abs((y + h / 2) - (box[1] + box[3] / 2)) <= 1
    assert state(page)["box"] is not None                  # 넣은 그림이 골라져 바로 크기를 바꿀 수 있다
    page.keyboard.press("Control+z")
    assert sec.locator("div[data-name=picture]").count() == 1 and sec.locator("img").count() == 0
    # 고른 것 없이 넣으면 장 가운데에
    page.click("#toc li >> nth=0")
    page.set_input_files("#picFile", str(png))
    first = frame(page).locator("section.slide").nth(0).locator("img")
    first.wait_for()
    assert first.evaluate("(e) => Math.round(parseFloat(e.style.left) + parseFloat(e.style.width) / 2)") == 640
    bad = tmp_path / "글.txt"
    bad.write_text("x", encoding="utf-8")
    page.set_input_files("#picFile", str(bad))
    assert "그림 파일" in page.inner_text("#status")
    broken = tmp_path / "깨진.png"                         # 이름만 .png 인 망가진 파일
    broken.write_bytes(b"not a picture")
    page.set_input_files("#picFile", str(broken))
    pw.expect(page.locator("#status")).to_contain_text("그림을 읽지 못했습니다")
    assert frame(page).locator("section.slide").nth(0).locator("img").count() == 1
    ctx.close()
    assert errors == []


# ---------- 모든 장에 한꺼번에(마스터)

MASTER = BUILDER.replace(":root{--s:.5}", ':root{--s:.5;--ink:#111111;--f-ko:"Noto Sans KR",sans-serif}')


def test_master_applies_to_every_slide_in_one_undo_step(browser, tmp_path, serve):
    assert MASTER != BUILDER
    site, root = make_site(tmp_path, {"m.html": MASTER})
    hub = DeckHub({"decks/m.html": (root / "decks" / "m.html").read_bytes()})
    ctx, page, errors = open_editor(browser, serve(site), "m", hub)
    original = page.evaluate("window.__hse.serialize()")
    page.click("#masterBtn")
    dlg = page.locator("#masterDlg")
    assert dlg.is_visible()
    assert dlg.locator(".m-var code").all_inner_texts() == ["--ink", "--f-ko"]
    # 1) 덱 색 변수
    dlg.locator(".m-var input[type=color]").fill("#ff0000")
    assert "--ink:#FF0000" in page.evaluate("window.__hse.serialize()").replace(" ", "")
    assert state(page)["undo"] == 1
    # 2) 역할(제목) 글자 크기 — 세 장 모두
    page.select_option("#mRole", label="제목(title) · 3곳")
    page.fill("#mSize", "30")
    page.click("#mRoleApply")
    sizes = frame(page).locator("[data-name=title] .tin p").evaluate_all("(ps) => ps.map((p) => p.style.fontSize)")
    assert sizes == ["40px", "40px", "40px"] and state(page)["undo"] == 2
    # 3) 배경 — 표지 빼고
    page.fill("#mBg", "#eeeeee")
    page.click("#mBgApply")
    bgs = frame(page).locator("section.slide").evaluate_all("(ss) => ss.map((s) => s.style.backgroundColor)")
    assert bgs == ["rgb(16, 33, 63)", "rgb(238, 238, 238)", "rgb(238, 238, 238)"]
    page.keyboard.press("Escape")
    pw.expect(dlg).to_be_hidden()                          # 창이 닫히는 처리는 키 다음 차례에 끝난다
    # 4) 공통 상자 — 둘째 장의 화살표를 모든 장에, 그리고 모두 지우기(두 번 눌러야)
    page.keyboard.press("PageDown")
    frame(page).locator("section.slide").nth(1).locator("svg.el").click()
    page.click("#masterBtn")
    page.click("#mCopy")
    assert frame(page).locator("svg.el").count() == 3
    page.click("#mRemove")
    assert frame(page).locator("svg.el").count() == 3 and "한 번 더" in page.inner_text("#mRemove")
    page.click("#mRemove")
    assert frame(page).locator("svg.el").count() == 0
    page.keyboard.press("Escape")
    pw.expect(dlg).to_be_hidden()
    assert state(page)["undo"] == 5
    for _ in range(5):
        page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    ctx.close()
    assert errors == []


# ---------- 3단계 검토에서 나온 경우들

COVER_TITLE = ('<div class="el tx" data-name="title" style="left:64px;top:200px;width:1100px;height:80px"><div class="tin">'
               '<p class="pp" style="font-size:52px;color:#FFFFFF">시험 덱 표지</p></div></div>')
BODY2 = ('<div class="el tx" data-name="body" style="left:64px;top:160px;width:1100px;height:200px"><div class="tin">'
         '<p class="pp" style="font-size:24px;line-height:31.2px;color:#222">첫 문단</p>'
         '<p class="pp" style="font-size:24px;line-height:31.2px;color:#222">둘째 문단</p></div></div>')
PAGENO = ('<div class="el tx" data-name="pageno" style="left:1150px;top:680px;width:80px;height:20px"><div class="tin">'
          '<p class="pp" style="font-size:12px">{k} / 3</p></div></div>')
TABLE3 = '<table class="el" style="left:64px;top:160px;width:600px">'


def text_box(name: str, x: int, y: int, w: int, h: int, fs: int, text: str, color: str = "") -> str:
    c = f";color:{color}" if color else ""
    return (f'<div class="el tx" data-name="{name}" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"><div class="tin">'
            f'<p class="pp" style="font-size:{fs}px{c}">{text}</p></div></div>')


def deck_site(tmp_path, serve, name: str, text: str):
    site, root = make_site(tmp_path, {f"{name}.html": text})
    return serve(site), DeckHub({f"decks/{name}.html": (root / "decks" / f"{name}.html").read_bytes()})


def test_master_copies_page_numbers_with_their_own_number(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    frame(page).locator("section.slide").nth(1).locator("[data-name=pageno] .tin p").click()
    page.click("#masterBtn")
    page.click("#mCopy")                                   # 쪽 번호가 없는 표지에만 — 표지의 번호로
    assert "1개 장에 넣었습니다" in page.inner_text("#mStatus")
    page.keyboard.press("Escape")
    pw.expect(page.locator("#masterDlg")).to_be_hidden()
    s = parse_saved(page, page.evaluate("window.__hse.serialize()"))
    assert s["pageno"] == ["1 / 3", "2 / 3", "3 / 3"] and s["hse"] is False and s["editable"] == 0
    page.click("#add")                                     # 장을 더하면 넣은 쪽 번호도 새 수로 다시 매긴다
    s = parse_saved(page, page.evaluate("window.__hse.serialize()"))
    assert s["pageno"] == [f"{i} / 4" for i in range(1, 5)]
    ctx.close()
    assert errors == []


NOTES_DECK = (BUILDER
              .replace(COVER_TITLE, COVER_TITLE + text_box("note", 64, 600, 300, 30, 14, "표지 메모"))
              .replace(PAGENO.format(k=2), text_box("note", 64, 600, 300, 30, 14, "둘째 메모 1")
                       + text_box("note", 700, 640, 300, 30, 18, "둘째 메모 2") + PAGENO.format(k=2))
              .replace(PAGENO.format(k=3), text_box("note", 64, 600, 300, 30, 14, "셋째 메모 1")
                       + text_box("note", 300, 500, 300, 30, 14, "셋째 메모 2") + PAGENO.format(k=3)))


def test_master_match_pairs_boxes_in_order_and_skips_uneven_slides(browser, tmp_path, serve):
    assert NOTES_DECK.count('data-name="note"') == 5
    base, hub = deck_site(tmp_path, serve, "n", NOTES_DECK)
    ctx, page, errors = open_editor(browser, base, "n", hub)
    f = frame(page)

    def notes(i):
        return f.locator("section.slide").nth(i).locator("[data-name=note]").evaluate_all(
            "(bs) => bs.map((b) => [b.style.left, b.style.top, b.querySelector('p').style.fontSize, b.textContent])")

    page.keyboard.press("PageDown")
    f.locator("section.slide").nth(1).locator("[data-name=note] p").nth(1).click()   # 둘째 장의 둘째 메모
    page.click("#masterBtn")
    page.click("#mMatch")
    status = page.inner_text("#mStatus")
    assert "1개 장에서 맞췄습니다" in status and "1개 장은 건너뛰었습니다" in status, status
    assert notes(2) == [["64px", "600px", "14px", "셋째 메모 1"], ["700px", "640px", "18px", "셋째 메모 2"]]
    assert notes(0) == [["64px", "600px", "14px", "표지 메모"]]       # 메모 수가 달라 어느 것과 맞출지 모른다
    assert state(page)["undo"] == 1
    page.keyboard.press("Escape")
    pw.expect(page.locator("#masterDlg")).to_be_hidden()
    page.click("#toc li >> nth=0")
    f.locator("section.slide").nth(0).locator("[data-name=note] p").click()
    page.click("#masterBtn")
    assert page.locator("#mMatch").is_enabled()           # 맞출 상대가 없어도 눌러서 까닭을 본다
    page.click("#mMatch")
    status = page.inner_text("#mStatus")
    assert "맞출 장이 없습니다" in status and "2개 장은 건너뛰었습니다" in status, status
    assert state(page)["undo"] == 1
    ctx.close()
    assert errors == []


CHART = ('<svg class="el" data-x="chart" style="left:700px;top:400px;width:200px;height:100px" viewBox="0 0 200 100">'
         '<style>.bar{fill:#c00}</style><rect class="bar" x="0" y="0" width="100" height="50"></rect></svg>')
STYLED = (BUILDER.replace(PAGENO.format(k=2), CHART + PAGENO.format(k=2))
          .replace('<script type="application/json" id="notes-data">',
                   '<style id="theme">:root{--ink:#111111}</style>\n<script type="application/json" id="notes-data">'))


def test_master_undo_is_exact_when_copied_boxes_carry_their_own_style(browser, tmp_path, serve):
    assert STYLED.count(".bar{fill:#c00}") == 1 and 'id="theme"' in STYLED
    base, hub = deck_site(tmp_path, serve, "st", STYLED)
    ctx, page, errors = open_editor(browser, base, "st", hub)
    original = page.evaluate("window.__hse.serialize()")
    page.keyboard.press("PageDown")
    frame(page).locator("svg[data-x=chart]").click()
    page.click("#masterBtn")
    dlg = page.locator("#masterDlg")
    assert dlg.locator(".m-var code").all_inner_texts() == ["--ink"]    # 장 안 그림의 <style> 은 덱 색이 아니다
    page.click("#mCopy")                                   # 장 안 <style> 이 둘 늘어도
    assert frame(page).locator("svg[data-x=chart]").count() == 3
    dlg.locator(".m-var input[type=color]").fill("#ff0000")  # 덱 색을 바꾼 기록은 같은 <style> 을 가리킨다
    after = page.evaluate("window.__hse.serialize()")
    assert "--ink:#FF0000" in after.replace(" ", "") and after.count(".bar{fill:#c00}") == 3
    for _ in range(2):
        page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    for _ in range(2):
        page.keyboard.press("Control+y")
    assert page.evaluate("window.__hse.serialize()") == after
    ctx.close()
    assert errors == []


def test_dialog_keeps_deck_keys_away_but_undo_still_works(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    f = frame(page)
    f.locator("svg.el").click()
    page.click("#masterBtn")
    page.click("#mCopy")
    assert f.locator("svg.el").count() == 3
    page.evaluate("document.activeElement.blur()")         # 초점이 창 밖(body)으로 빠져도
    page.keyboard.press("Delete")                          # 창 뒤의 고른 상자를 지우지 않고
    page.keyboard.press("PageDown")                        # 장도 넘기지 않는다
    assert f.locator("svg.el").count() == 3 and state(page)["cur"] == 1
    page.keyboard.press("Control+z")                       # 되돌리기는 편집기의 것
    assert f.locator("svg.el").count() == 1 and page.locator("#masterDlg").is_visible()
    page.keyboard.press("Escape")
    pw.expect(page.locator("#masterDlg")).to_be_hidden()
    ctx.close()
    assert errors == []


def test_master_background_skips_slides_with_their_own_ground(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    original = page.evaluate("window.__hse.serialize()")

    def grounds():
        return frame(page).locator("section.slide").evaluate_all("(ss) => ss.map((s) => s.style.backgroundColor)")

    page.click("#masterBtn")
    page.uncheck("#mBgSkip")
    page.fill("#mBg", "#eeeeee")
    page.click("#mBgApply")                                # 어두운 표지는 글자색이 그 바탕에 맞춰져 있어 건너뛴다
    assert grounds() == ["", "rgb(238, 238, 238)", "rgb(238, 238, 238)"]
    assert "1개 장(어두운 장 등" in page.inner_text("#mStatus") and state(page)["undo"] == 1
    page.check("#mBgAll")
    page.click("#mBgApply")                                # 고르면 그 장까지
    assert grounds() == ["rgb(238, 238, 238)"] * 3 and state(page)["undo"] == 2
    page.keyboard.press("Escape")
    pw.expect(page.locator("#masterDlg")).to_be_hidden()
    for _ in range(2):
        page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    ctx.close()
    assert errors == []


COVER_NAMED = BUILDER.replace(COVER_TITLE, text_box("cover-mark", 900, 40, 300, 140, 120, "K", "#33476B")
                              + COVER_TITLE.replace('data-name="title"', 'data-name="cover-title"')
                              + text_box("cover-sub", 64, 300, 900, 40, 22, "부제", "#C8D3E6"))


def test_section_layout_takes_the_named_cover_boxes(browser, tmp_path, serve):
    assert 'data-name="cover-title"' in COVER_NAMED
    base, hub = deck_site(tmp_path, serve, "c", COVER_NAMED)
    ctx, page, errors = open_editor(browser, base, "c", hub)
    page.keyboard.press("PageDown")
    choose_layout(page, "section")                         # 표지의 가장 큰 글(K)이 아니라 이름 붙은 제목·부제를 본뜬다
    sec = frame(page).locator("section.slide").nth(2)
    got = sec.evaluate("""(s) => [...s.querySelectorAll(':scope > .el.tx')].map((b) => {
        const p = b.querySelector('.tin p');
        return [b.getAttribute('data-name'), p.textContent, p.style.fontSize, p.style.color]; })""")
    assert got == [["title", "제목을 입력하세요", "52px", "rgb(255, 255, 255)"],
                   ["kicker", "소제목", "22px", "rgb(200, 211, 230)"],
                   ["pageno", "2 / 3", "12px", ""]], got
    assert sec.evaluate("(s) => s.style.backgroundColor") == "rgb(16, 33, 63)"
    ctx.close()
    assert errors == []


BODY_ELSEWHERE = (BUILDER
                  .replace(COVER_TITLE, COVER_TITLE + text_box("lede", 64, 320, 1150, 300, 36, "표지 리드", "#DDE6F5"))
                  .replace(BODY2, "")
                  .replace(TABLE3, BODY2.replace("top:160px", "top:420px") + TABLE3))


def test_body_layout_does_not_copy_the_cover_text(browser, tmp_path, serve):
    assert BODY_ELSEWHERE.count('data-name="body"') == 1 and 'data-name="lede"' in BODY_ELSEWHERE
    base, hub = deck_site(tmp_path, serve, "b", BODY_ELSEWHERE)
    ctx, page, errors = open_editor(browser, base, "b", hub)
    choose_layout(page, "body")                            # 표지에서 넣어도 본문은 본문 장(셋째 장)의 상자를 본뜬다
    sec = frame(page).locator("section.slide").nth(1)
    p = sec.locator("[data-name=body] .tin p").first
    assert p.inner_text() == "내용을 입력하세요"
    assert p.evaluate("(e) => [e.style.fontSize, e.style.color]") == ["24px", "rgb(34, 34, 34)"]
    assert sec.locator("[data-name=title] .tin p").evaluate("(e) => e.style.fontSize") == "40px"
    assert sec.locator("[data-name=lede]").count() == 0
    ctx.close()
    assert errors == []


def test_flow_picture_fits_inside_the_placeholder(browser, decks, tmp_path):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    choose_layout(page, "picture")
    sec = frame(page).locator("section.slide").nth(2)
    ph = sec.locator("[data-name=picture]")
    pw_w, pw_h = ph.evaluate("(e) => [e.offsetWidth, e.offsetHeight]")
    ph.click()
    png = tmp_path / "가로.png"
    png.write_bytes(PNG_2x1)
    page.set_input_files("#picFile", str(png))
    img = sec.locator("figure img")
    img.wait_for()
    assert sec.locator("[data-name=picture]").count() == 0
    w, h = img.evaluate("(e) => [parseFloat(e.style.width), parseFloat(e.style.height)]")
    assert abs(w / h - 2) < 0.02 and w <= pw_w + 1 and h <= pw_h + 1 and abs(w - pw_w) <= 1, (w, h, pw_w, pw_h)
    shown = img.evaluate("(e) => [e.offsetWidth, e.offsetHeight]")
    assert abs(shown[0] - w) <= 1 and abs(shown[1] - h) <= 1       # 칸을 넘지 않아 적힌 크기대로 보인다
    page.keyboard.press("Control+z")
    assert sec.locator("[data-name=picture]").count() == 1 and sec.locator("img").count() == 0
    ctx.close()
    assert errors == []


# ---------- 왼쪽 칸: 색인 · 찾기·바꾸기

def side_tab(page, key: str) -> None:
    page.click({"toc": "#tabToc", "idx": "#tabIdx", "find": "#tabFind"}[key])


def index_rows(page) -> list:
    """색인 칸의 [머리, [말, [장 번호…]]…] — 머리(h3)마다 묶는다."""
    return page.locator("#idx").evaluate("""(box) => {
        const out = [];
        for (const el of box.children) {
            if (el.matches('h3')) out.push([el.textContent, []]);
            else if (el.matches('ul') && out.length) {
                for (const li of el.children) out[out.length - 1][1].push([
                    li.querySelector('.ix-t').firstChild.textContent,
                    [...li.querySelectorAll('.ix-go')].map((b) => b.textContent)]);
            }
        }
        return out;
    }""")


def hits_on(page, name: str = "hse-hit") -> int:
    return frame(page).locator("body").evaluate(
        "(b, n) => { const h = b.ownerDocument.defaultView.CSS.highlights.get(n); return h ? h.size : 0; }", name)


def test_index_lists_sections_and_terms_and_keeps_added_terms_in_the_deck(browser, decks, tmp_path, serve):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    original = page.evaluate("window.__hse.serialize()")
    side_tab(page, "idx")
    assert page.locator("#panIdx").is_visible() and not page.locator("#toc").is_visible()
    assert index_rows(page) == [["절", [["표지", ["1"]], ["1. 서론", ["2"]], ["2. 본론", ["3"]]]]]
    # 사람이 더한 말 — 나오는 장을 달고, 덱 안 JSON 에 남는다(하나에 되돌리기 한 칸)
    page.fill("#idxTerm", "문단")
    page.press("#idxTerm", "Enter")
    page.fill("#idxTerm", "없는 말")
    page.press("#idxTerm", "Enter")
    rows = dict(index_rows(page))
    assert rows["ㅁ"] == [["문단", ["2"]]] and rows["ㅇ"] == [["없는 말", []]]
    assert "덱에 없음" in page.inner_text("#idx")
    saved = page.evaluate("window.__hse.serialize()")
    assert '<script type="application/json" id="deck-index">{"terms":["문단","없는 말"]}</script>' in saved
    assert state(page)["undo"] == 2
    # 장 번호를 누르면 그 장으로 가서 그 말을 형광으로
    page.locator("#idx li[data-term='문단'] .ix-go").click()
    assert state(page)["cur"] == 1 and hits_on(page) == 2
    page.locator("#idx li[data-term='없는 말'] .ix-del").click()
    assert "없는 말" not in page.inner_text("#idx") and state(page)["undo"] == 3
    for _ in range(3):
        page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    side_tab(page, "toc")
    assert page.locator("#toc").is_visible() and hits_on(page) == 0
    ctx.close()
    assert errors == []
    # 저장한 덱을 보통 창으로 열어도 색인 JSON 은 보이지 않고 덱은 그대로 돈다
    got = run_saved(browser, tmp_path, serve, saved, "return [__deck.count, document.body.innerText.includes('없는 말')];")
    assert got == [3, False]


def test_index_of_a_flow_deck_uses_kickers_and_emphasis(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    side_tab(page, "idx")
    rows = dict(index_rows(page))
    assert rows["절"] == [["머리말", ["1"]], ["둘째 머리말", ["2", "3"]]]
    assert rows["ㄱ"] == [["굵게", ["1"]]]                  # 문단 안에서 따로 굵게 한 말
    page.fill("#idxFilter", "굵")
    assert dict(index_rows(page)) == {"ㄱ": [["굵게", ["1"]]]}
    ctx.close()
    assert errors == []


def test_find_steps_through_slides_and_replaces_in_one_undo_step(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    original = page.evaluate("window.__hse.serialize()")
    page.keyboard.press("Control+f")
    assert page.locator("#panFind").is_visible()
    assert page.evaluate("document.activeElement.id") == "findQ"
    page.keyboard.type("장")
    assert page.inner_text("#findPos") == "1 / 2" and page.locator("#hits li").count() == 2
    page.keyboard.press("Enter")                           # 다음 → 셋째 장으로
    assert page.inner_text("#findPos") == "2 / 2" and state(page)["cur"] == 2
    assert hits_on(page) == 1 and hits_on(page, "hse-cur") == 1
    page.keyboard.press("Shift+Enter")                     # 앞 → 둘째 장
    assert page.inner_text("#findPos") == "1 / 2" and state(page)["cur"] == 1
    # 바꾸기 — 지금 것 하나
    page.fill("#findTo", "슬라이드")
    page.click("#findOne")
    texts = frame(page).locator("section.slide h2").all_inner_texts()
    assert texts == ["흐름 덱 표지", "둘째 슬라이드", "셋째 장"] and state(page)["undo"] == 1
    # 모두 바꾸기 — 덱 전체, 되돌리기 한 칸
    page.fill("#findQ", "째")
    page.fill("#findTo", "번")
    page.click("#findEvery")
    assert "3곳을 바꿨습니다(2개 장" in page.inner_text("#status")
    texts = frame(page).locator("section.slide h2").all_inner_texts()
    assert texts == ["흐름 덱 표지", "둘번 슬라이드", "셋번 장"] and state(page)["undo"] == 2
    assert page.inner_text("#findPos") == "없음"
    page.click("#tabToc")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original
    ctx.close()
    assert errors == []


def test_find_takes_the_selected_words_and_keeps_formatting(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    select_text(page, "section.slide p", "굵게")
    page.keyboard.press("Control+f")
    assert page.input_value("#findQ") == "굵게" and page.inner_text("#findPos") == "1 / 1"
    page.keyboard.press("Control+h")
    assert page.evaluate("document.activeElement.id") == "findTo"
    page.keyboard.type("진하게")
    page.keyboard.press("Enter")
    p = frame(page).locator("section.slide").nth(0).locator("p")
    assert p.inner_html() == "부제 <b>진하게</b> 끝"           # 바꾼 글은 그 자리의 서식(굵게)을 따른다
    ctx.close()
    assert errors == []


def test_replace_does_not_loop_on_text_that_contains_the_query(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("Control+h")
    page.fill("#findQ", "장")
    page.fill("#findTo", "장면")
    h2s = frame(page).locator("section.slide h2")
    page.click("#findOne")                                 # 다른 장의 것은 먼저 그 장으로 가서 보인다
    assert state(page)["cur"] == 1 and h2s.all_inner_texts()[1] == "둘째 장"
    page.click("#findOne")                                 # ‘장’ → ‘장면’, 다음은 바꾼 글 뒤(셋째 장)로
    assert h2s.all_inner_texts()[1:] == ["둘째 장면", "셋째 장"] and state(page)["cur"] == 2
    page.click("#findOne")
    assert h2s.all_inner_texts() == ["흐름 덱 표지", "둘째 장면", "셋째 장면"]
    assert state(page)["undo"] == 2
    ctx.close()
    assert errors == []


def test_keys_in_the_side_panels_stay_there(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    frame(page).locator("svg.el").click()                  # 상자를 고른 채
    side_tab(page, "idx")
    page.locator("#idx .ix-go").first.focus()
    page.keyboard.press("Delete")                          # 색인 단추에서 누른 Delete 는 상자를 지우지 않는다
    page.keyboard.press("ArrowRight")
    assert frame(page).locator("svg.el").count() == 1 and state(page)["box"]["x"] == 64
    page.locator("#tabIdx").focus()
    page.keyboard.press("ArrowRight")                      # 탭 줄의 ←→ 는 옆 탭으로
    assert page.locator("#panFind").is_visible() and page.evaluate("document.activeElement.id") == "tabFind"
    ctx.close()
    assert errors == []


FLOW_CLASSY = (FLOW.replace(".foot{", ".txt{font-size:28px;line-height:40px;color:#334455}\n.foot{")
               .replace("<p>부제", '<p class="txt">부제')
               .replace("<ul>", '<ul class="txt">')
               .replace("<p><a href", '<p class="txt"><a href'))


def test_flow_layouts_take_the_deck_body_text_look(browser, tmp_path, serve):
    assert FLOW_CLASSY.count('class="txt"') == 3
    base, hub = deck_site(tmp_path, serve, "fc", FLOW_CLASSY)
    ctx, page, errors = open_editor(browser, base, "fc", hub)
    page.keyboard.press("PageDown")
    choose_layout(page, "body")                            # 맨 <p>·<ul> 도 덱 본문 글(클래스로만 건 28px)의 모양으로
    sec = frame(page).locator("section.slide").nth(2)
    looks = sec.evaluate("""(s) => [...s.querySelectorAll(':scope > p, :scope > ul')].map((e) => {
        const cs = getComputedStyle(e); return [e.localName, cs.fontSize, cs.lineHeight, cs.color]; })""")
    assert looks == [["p", "28px", "40px", "rgb(51, 68, 85)"], ["ul", "28px", "40px", "rgb(51, 68, 85)"]], looks
    ctx.close()
    assert errors == []


FIND_DECK = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>찾기 시험 덱</title>
<style>.slide{display:none;width:1280px;height:720px}.slide.on{display:block}</style></head><body>
<div class="deck">
<section class="slide on"><h2>첫 장</h2><p>2025<br>2026 계획</p><p>AI 와 MAIN 의 차이</p></section>
<section class="slide"><h2>둘째 장</h2><p>AI 는 둘째 장에도</p></section>
</div>
<div id="deck-index">덱이 쓰는 칸</div>
</body></html>
"""


def test_find_stops_at_line_breaks_and_keeps_keys_in_the_panel(browser, tmp_path, serve):
    base, hub = deck_site(tmp_path, serve, "fd", FIND_DECK)
    ctx, page, errors = open_editor(browser, base, "fd", hub)
    select_text(page, "section.slide p", "2025")           # 덱에서 고른 글로 찾는다
    page.keyboard.press("Control+f")
    assert page.input_value("#findQ") == "2025"
    page.fill("#findQ", "52")                              # 줄바꿈(<br>)을 넘어 찾지 않는다
    assert page.inner_text("#findPos") == "없음"
    page.fill("#findQ", "AI")
    assert page.inner_text("#findPos") == "1 / 3"          # 찾기는 글자 그대로(MAIN 속 AI 도)
    page.keyboard.press("Control+h")                       # 찾기 칸에서 누른 Ctrl+H 는 덱의 옛 고름(2025)으로 덮어쓰지 않는다
    assert page.input_value("#findQ") == "AI" and page.evaluate("document.activeElement.id") == "findTo"
    page.locator("#findQ").dispatch_event("keydown", {"key": "Enter", "isComposing": True})   # 한글 조합을 끝내는 Enter
    assert page.inner_text("#findPos") == "1 / 3"
    page.fill("#findQ", "계획")
    page.fill("#findTo", "목표")
    page.click("#findOne")                                 # 하나뿐인 것을 바꾸면 단추가 꺼진다 — 초점은 찾기 칸으로
    assert page.inner_text("#findPos") == "없음" and page.evaluate("document.activeElement.id") == "findQ"
    assert frame(page).locator("section.slide p").first.inner_text() == "2025\n2026 목표"
    page.keyboard.press("Control+s")                       # 찾기 칸에서도 Ctrl+S 는 편집기 저장(토큰 창)
    pw.expect(page.locator("#tokenDlg")).to_be_visible()
    page.click("#tokenCancel")
    ctx.close()
    assert errors == []


def test_index_counts_whole_words_and_leaves_a_deck_element_with_the_index_id(browser, tmp_path, serve):
    base, hub = deck_site(tmp_path, serve, "fd", FIND_DECK)
    ctx, page, errors = open_editor(browser, base, "fd", hub)
    original = page.evaluate("window.__hse.serialize()")
    side_tab(page, "idx")
    assert dict(index_rows(page)) == {"A": [["AI", ["1", "2"]]], "M": [["MAIN", ["1"]]]}
    page.locator("#idx li[data-term='AI'] .ix-go").first.click()
    assert hits_on(page) == 1                              # 'MAIN' 속 AI 는 칠하지 않는다
    page.fill("#idxTerm", "새 말")
    page.press("#idxTerm", "Enter")                        # 덱이 그 id 를 이미 쓰면 덱에 적지 않는다
    assert "다른 요소" in page.inner_text("#status") and state(page)["undo"] == 0
    assert page.evaluate("window.__hse.serialize()") == original
    ctx.close()
    assert errors == []


TERMS_DECK = FIND_DECK.replace('<div id="deck-index">덱이 쓰는 칸</div>',
                               '<script type="application/json" id="deck-index">{ "terms": [ "IAEA" ] }</script>')


def test_added_terms_are_tidied_escaped_and_undo_restores_the_exact_index_text(browser, tmp_path, serve):
    assert TERMS_DECK != FIND_DECK
    base, hub = deck_site(tmp_path, serve, "td", TERMS_DECK)
    ctx, page, errors = open_editor(browser, base, "td", hub)
    original = page.evaluate("window.__hse.serialize()")
    side_tab(page, "idx")
    page.fill("#idxTerm", "(주)")
    page.press("#idxTerm", "Enter")
    assert '{"terms":["IAEA","주"]}' in page.evaluate("window.__hse.serialize()")
    page.fill("#idxTerm", "주")
    page.press("#idxTerm", "Enter")                        # 다듬으면 같은 말 — 되돌리기 칸이 늘지 않는다
    assert state(page)["undo"] == 1
    page.fill("#idxTerm", "</script>x")
    page.press("#idxTerm", "Enter")                        # '<' 는 JSON 안에서 이스케이프 — 덱의 <script> 가 닫히지 않는다
    saved = page.evaluate("window.__hse.serialize()")
    assert '"' + chr(92) + 'u003c/script>x"' in saved and state(page)["undo"] == 2
    page.locator("#tabIdx").focus()                        # 글 칸 밖에서 Ctrl+Z 는 덱의 되돌리기
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    assert page.evaluate("window.__hse.serialize()") == original   # 덱에 있던 JSON 글 그대로
    ctx.close()
    assert errors == []
    got = run_saved(browser, tmp_path, serve, saved, "return document.querySelectorAll('section.slide').length;")
    assert got == 2
