"""갤러리 첫 화면 편집 — 브라우저(Playwright)로 눌러 보고, GitHub API 요청은 가로채 본문을 본다."""
import base64
import collections
import functools
import http.server
import json
import shutil
import threading
from pathlib import Path
from urllib.parse import quote

import pytest

import build_manifest as bm
import samples

pw = pytest.importorskip("playwright.sync_api")

REPO = Path(__file__).resolve().parents[1]
TOKEN = "github_pat_" + "T" * 82
NOREPLY = {"name": "tester", "email": "1234+tester@users.noreply.github.com"}
EMPTY = {"version": 1, "categories": [], "assign": {}, "order": []}
API_FILE = "https://api.github.com/repos/owner/slides/contents/decks/gallery.json"
EDIT_URL = "https://github.com/owner/slides/edit/main/decks/gallery.json"
DECKS = {"a.html": "가 덱", "b.html": "나 덱", "conf/c.html": "다 덱", "conf/d.html": "라 덱"}
FOLDERS = {"conf": {"label": "학회", "order": 1}}
SUR = chr(0xD83D)                   # 짝 없는 써로게이트(이모지의 앞 조각)
SMILE = chr(0x1F600)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def deck(title: str) -> str:
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title></head>'
            '<body><section class="slide">1</section></body></html>')


def make_site(tmp_path: Path, layout: dict | None, decks: dict | None = None,
              folders: dict | None = None) -> tuple[Path, dict]:
    """덱(기본은 맨 위 둘, conf 폴더 둘)과 배치 파일로 사이트를 만든다 — git 기록이 없어 덱 차례는 이름순.
    저장소 폴더는 tmp_path / "repo"."""
    root = tmp_path / "repo"
    root.mkdir(parents=True)
    shutil.copy(REPO / "index.html", root / "index.html")
    shutil.copytree(REPO / "assets", root / "assets")
    for rel, title in (decks or DECKS).items():
        write(root / "decks" / rel, deck(title))
    write(root / "decks/folders.json", json.dumps(FOLDERS if folders is None else folders, ensure_ascii=False))
    write(root / "site.json", json.dumps({"title": "시험 갤러리", "repo": "owner/slides", "branch": "main",
                                          "author": NOREPLY}, ensure_ascii=False))
    if layout is not None:
        write(root / "decks/gallery.json", json.dumps(layout, ensure_ascii=False))
    manifest = bm.build_manifest(root, thumbs=False, cache=None, use_git=False)
    out = tmp_path / "site"
    bm.build_site(root, out, manifest, None)
    return out, manifest


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


class FakeGitHub:
    """api.github.com 대신 답한다. remote 가 None 이면 배치 파일이 없는 저장소(404). 저장(PUT)이 되면 remote 가 바뀐다.
    get_status 로 읽기를 실패시키고, put_status·put_headers 로 PUT 의 답을 정하며, hold 가 참이면 PUT 을
    release() 때까지 붙잡는다."""
    HEADERS = {"access-control-allow-origin": "*", "access-control-expose-headers": "x-ratelimit-remaining"}

    def __init__(self, remote: dict | None = None, put_status: int = 200):
        self.remote = remote
        self.get_status = 200
        self.put_status = put_status
        self.put_headers: dict = {}
        self.hold = False
        self.held: list = []
        self.calls: list[dict] = []

    def __call__(self, route, request):
        self.calls.append({"method": request.method, "url": request.url,
                           "auth": request.headers.get("authorization"), "body": request.post_data})
        if request.method != "GET":
            if self.hold:
                self.held.append(route)
            else:
                self.answer(route)
        elif self.get_status != 200:
            route.fulfill(status=self.get_status, headers=self.HEADERS, json={"message": "Server Error"})
        elif self.remote is None:
            route.fulfill(status=404, headers=self.HEADERS, json={"message": "Not Found"})
        else:
            content = base64.b64encode(json.dumps(self.remote, ensure_ascii=False).encode("utf-8")).decode("ascii")
            route.fulfill(status=200, headers=self.HEADERS, json={"sha": "sha-1", "content": content, "encoding": "base64"})

    def answer(self, route):
        if self.put_status < 300:
            body = json.loads(route.request.post_data)
            self.remote = json.loads(base64.b64decode(body["content"]).decode("utf-8"))
            route.fulfill(status=self.put_status, headers=self.HEADERS, json={"commit": {"sha": "c-1"}})
        else:
            route.fulfill(status=self.put_status, headers={**self.HEADERS, **self.put_headers},
                          json={"message": "Bad credentials"})

    def release(self):
        self.hold = False
        while self.held:
            self.answer(self.held.pop(0))

    def gets(self) -> list[dict]:
        return [c for c in self.calls if c["method"] == "GET"]

    def puts(self) -> list[dict]:
        return [c for c in self.calls if c["method"] == "PUT"]

    def saved(self) -> dict:
        """마지막 PUT 이 보낸 배치 파일"""
        return json.loads(base64.b64decode(json.loads(self.puts()[-1]["body"])["content"]).decode("utf-8"))


def open_gallery(browser, url: str, gh: FakeGitHub | None = None, clipboard: bool = False):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    if clipboard:
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=url.rstrip("/"))
    ctx.route("https://github.com/**", lambda route: route.fulfill(status=200, body="github"))
    # 저장 창은 열 때 저장소의 배치를 읽는다 — 시험에서는 진짜 GitHub 에 닿지 않게 늘 가로챈다
    ctx.route("https://api.github.com/**", gh if gh is not None else FakeGitHub(remote=None))
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector(".card")
    return ctx, page, errors


def titles(page) -> list[str]:
    return page.locator(".card .title").all_inner_texts()


def focused(page) -> str:
    """초점이 있는 요소의 aria-label(없으면 태그 이름)"""
    return page.evaluate("(() => { const a = document.activeElement;"
                         " return (a && (a.getAttribute('aria-label') || a.tagName)) || ''; })()")


def pump(page, until, tries: int = 50) -> None:
    """가로챈 요청이 처리기에 닿기를 기다린다(그동안 Playwright 가 이벤트를 돌린다)."""
    for _ in range(tries):
        if until():
            return
        page.wait_for_timeout(100)
    raise AssertionError("기다린 요청이 오지 않았습니다")


def save_with_token(page) -> None:
    page.click("#saveBtn")
    if page.locator("#token").is_visible():
        page.fill("#token", TOKEN)
    page.click("#saveGo")


# ---------- 빌드(apply_layout)와 브라우저(applyLayout)가 같은 배치를 만든다

PARITY_DECKS = {"a.html": "가 덱", "conf/c.html": "다 덱", "conf/d.html": "라 덱", "guide/e.html": "마 덱",
                "misc/f.html": "바 덱"}
PARITY_FOLDERS = {"conf": {"label": "학회", "order": 2}, "guide": {"label": "사용 &amp; 안내", "order": 1}}
PARITY_RAW = [
    {"version": 1, "rev": "r-1",
     "categories": [{"key": "c-x", "label": "새 분류"}, {"key": "conf", "label": "학회 발표"}],
     "assign": {"a": "c-x", "conf/c": ""}, "order": ["conf/d", "a"]},
    # 이름 — HTML 로 풀지 않고, 제어 문자·BOM 은 띄어쓰기로, 80글자(코드 포인트)에서 자르고, 짝 없는 써로게이트는 U+FFFD
    {"categories": [{"key": "c-1", "label": " Lab&notes \t x" + chr(0xFEFF) + chr(0x85) + "y "},
                    {"key": "c-2", "label": "가" * 79 + " " + "나" * 5},
                    {"key": "c-3", "label": "a" + SUR + "b"},
                    {"key": "c-4", "label": SMILE * 81},
                    {"key": "guide"}],
     "assign": {"a": "c-1", "conf/c": "c-2", "conf/d": "c-3", "misc/f": "c-4"}},
    # 키 — 틀린 키·겹친 키·짝 없는 써로게이트 키는 버린다. 없는 덱·분류를 가리키는 항목도 버린다
    {"categories": [{"key": " pad"}, {"key": "x" + chr(1)}, {"key": "k" * 201}, {"key": "s" + SUR}, {"key": ""},
                    {"key": 5}, ["conf"], {"key": "conf", "label": "첫째"}, {"key": "conf", "label": "둘째"},
                    {"key": "c-9", "label": "빈 분류"}],
     "assign": {"a": " pad", "conf/c": "c-9", "guide/e": "nope", "zzz": "conf", "misc/f": 3},
     "order": ["zzz", "misc/f", 7, "misc/f", "a"]},
    # 배치에 없는 폴더는 folders.json 의 order 차례(guide 1 → conf 2), 그다음 order 없는 폴더(misc)
    {"categories": [{"key": "misc", "label": "기타"}]},
    {},
]


def py_layout(root: Path, manifest: dict, raw: dict) -> dict:
    decks = [{"id": d["id"], "folder": d["home"]} for d in manifest["decks"]]
    lay = bm.apply_layout(raw, decks, bm.load_folders(root / "decks"))
    counts = collections.Counter(d["folder"] for d in decks if d["folder"])
    return {
        "categories": [{"key": c["key"], "label": c["label"]} for c in lay["categories"]],
        "decks": sorted(({"id": d["id"], "folder": d["folder"], "folderLabel": d["folderLabel"], "rank": d["rank"]}
                         for d in decks), key=lambda d: d["id"]),
        "folders": [{"key": c["key"], "label": c["label"], "count": counts[c["key"]]}
                    for c in lay["categories"] if counts[c["key"]]],
    }


def js_layout(page, raw: dict) -> dict:
    # json.dumps 는 짝 없는 써로게이트를 이스케이프로 적으므로 그대로 브라우저까지 간다
    got = page.evaluate("(t) => window.htmlSlidesGallery.layoutOf(JSON.parse(t))", json.dumps(raw))
    got["decks"] = sorted(got["decks"], key=lambda d: d["id"])
    return got


def test_gallery_applies_the_same_layout_as_the_build(tmp_path, browser, serve):
    site, m = make_site(tmp_path, PARITY_RAW[0], decks=PARITY_DECKS, folders=PARITY_FOLDERS)
    ctx, page, errors = open_gallery(browser, serve(site))
    root = tmp_path / "repo"
    for raw in [m["layout"], *PARITY_RAW]:
        assert js_layout(page, raw) == py_layout(root, m, raw), raw
    # 실제로 다듬은 결과도 본다
    cats = {c["key"]: c["label"] for c in py_layout(root, m, PARITY_RAW[1])["categories"]}
    assert cats["c-1"] == "Lab&notes x y" and cats["c-2"] == "가" * 79
    assert cats["c-3"] == "a" + chr(0xFFFD) + "b" and cats["c-4"] == SMILE * 80 and cats["guide"] == "사용 & 안내"
    assert [c["key"] for c in py_layout(root, m, PARITY_RAW[2])["categories"]] == ["conf", "c-9", "guide", "misc"]
    assert [c["key"] for c in py_layout(root, m, PARITY_RAW[4])["categories"]] == ["guide", "conf", "misc"]
    assert errors == []
    ctx.close()


def test_gallery_shows_the_layout_from_the_build(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, PARITY_RAW[0])
    ctx, page, errors = open_gallery(browser, serve(site))
    # 배치에 순서가 있으면 처음부터 ‘정한 순서’ — 순서에 없는 덱(b, conf/c)이 앞, 그다음 정한 차례
    assert page.locator("#sort").input_value() == "custom"
    assert titles(page) == ["나 덱", "다 덱", "라 덱", "가 덱"]
    assert page.locator("#folders .chip").all_inner_texts() == ["전체\n4", "새 분류\n1", "학회 발표\n1"]
    assert not page.locator("#editBtn").is_hidden()
    assert errors == []
    ctx.close()


# ---------- 저장

def test_edit_and_save_with_token(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, EMPTY)
    gh = FakeGitHub(remote=EMPTY)
    ctx, page, errors = open_gallery(browser, serve(site), gh)
    assert titles(page) == ["가 덱", "나 덱", "다 덱", "라 덱"]
    page.click("#editBtn")
    assert page.locator("#editbar").is_visible() and page.locator("#saveBtn").is_disabled()
    assert page.locator(".card").first.locator("[data-act=prev]").is_disabled()
    assert page.locator(".card").last.locator("[data-act=next]").is_disabled()
    page.locator(".card").first.locator("[data-act=next]").click()
    assert titles(page) == ["나 덱", "가 덱", "다 덱", "라 덱"]
    # 카드의 ‘＋ 새 분류’ — 만든 분류가 그 덱에 붙고, 꺾쇠가 든 이름도 글자로만 보인다
    page.locator(".card").first.locator("select").select_option(label="＋ 새 분류…")
    page.wait_for_selector("#cats[open]")
    page.fill("#catNew", "<b>핵전략</b>")
    page.click("#catAdd [type=submit]")
    page.wait_for_selector("#cats", state="hidden")
    assert page.locator(".card").first.locator(".folder").inner_text() == "<b>핵전략</b>"
    assert page.locator(".card b").count() == 0
    assert focused(page) == "분류 — 나 덱"                         # 창을 닫으면 그 카드의 분류 칸으로
    assert page.locator("#saveBtn").is_enabled()

    page.click("#saveBtn")
    assert "분류를 바꾼 덱 1개" in page.locator("#saveSummary").inner_text()
    page.fill("#token", TOKEN)
    page.click("#saveGo")
    page.wait_for_selector("#pending:not([hidden])")
    # 창을 열 때 토큰 없이 한 번 읽고, 저장할 때 토큰으로 다시 읽은 뒤 쓴다
    assert [c["method"] for c in gh.calls] == ["GET", "GET", "PUT"]
    pre, get, put = gh.calls
    assert pre["url"] == get["url"] == f"{API_FILE}?ref=main" and put["url"] == API_FILE
    assert pre["auth"] is None and get["auth"] == put["auth"] == f"Bearer {TOKEN}"
    body = json.loads(put["body"])
    assert (body["message"], body["branch"], body["sha"]) == ("chore: 갤러리 배치 바꿈(첫 화면 편집)", "main", "sha-1")
    assert body["author"] == body["committer"] == NOREPLY          # 개인 메일이 아니라 noreply 로 남긴다
    saved = gh.saved()
    new_key = saved["categories"][-1]["key"]
    assert saved["version"] == 1 and isinstance(saved["rev"], str)
    assert saved["categories"] == [{"key": "conf"}, {"key": new_key, "label": "<b>핵전략</b>"}]
    assert saved["assign"] == {"b": new_key}
    assert saved["order"] == ["b", "a", "conf/c", "conf/d"]
    # 편집을 끝내고 저장한 배치를 정한 순서로 보여 준다. 토큰은 브라우저 저장소에 남지 않는다
    assert page.locator("#editbar").is_hidden() and page.locator("#editBtn").is_visible()
    assert page.locator("#sort").input_value() == "custom"
    stored = page.evaluate("JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage))")
    assert TOKEN not in stored
    assert page.evaluate("Object.keys(sessionStorage)") == ["hs:pending:owner/slides"]   # 갤러리(저장소)마다 따로
    # 새로 고쳐도 배포가 끝나기 전까지는 방금 저장한 배치를 보여 준다
    page.reload()
    page.wait_for_selector(".card")
    assert page.locator("#pending").is_visible()
    assert titles(page) == ["나 덱", "가 덱", "다 덱", "라 덱"]
    assert "<b>핵전략</b>" in page.locator("#folders").inner_text()
    assert errors == []
    ctx.close()

    # 배포된 빌드도 같은 배치를 만든다(저장한 파일 그대로 다시 빌드)
    site2, m2 = make_site(tmp_path / "again", saved)
    by = {d["id"]: d for d in m2["decks"]}
    assert (by["b"]["folder"], by["b"]["folderLabel"]) == (new_key, "<b>핵전략</b>")
    assert [d for d in m2["layout"]["order"]] == ["b", "a", "conf/c", "conf/d"]
    ctx2, page2, errors2 = open_gallery(browser, serve(site2))
    assert titles(page2) == ["나 덱", "가 덱", "다 덱", "라 덱"] and errors2 == []
    ctx2.close()


def test_save_errors_are_explained_and_overwrites_asked(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, EMPTY)
    gh = FakeGitHub(remote=None)
    ctx, page, errors = open_gallery(browser, serve(site), gh)
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    page.click("#saveBtn")
    status = page.locator("#saveStatus")
    # (HTTP 상태, 덧붙는 머리글, 알림, 토큰을 잊는가) — 토큰 탓인 것만 잊고 다시 묻는다
    cases = [(401, {}, "토큰이 맞지 않거나", True),
             (403, {}, "이 저장소에 쓸 수 없습니다", True),
             (403, {"x-ratelimit-remaining": "0"}, "요청 한도", False),
             (404, {}, "보이지 않습니다", True),
             (409, {}, "그 사이 저장소가 바뀌었습니다", False),
             (500, {}, "HTTP 500", False)]
    for code, headers, text, forgets in cases:
        gh.put_status, gh.put_headers = code, headers
        if page.locator("#token").is_visible():
            page.fill("#token", TOKEN)
        page.click("#saveGo")
        # 이 페이지의 CSP 는 eval 을 막으므로 문자열 식을 쓰는 wait_for_function 대신 expect 로 기다린다
        pw.expect(status).to_contain_text(text)
        assert "bad" in (status.get_attribute("class") or "")
        assert page.locator("#token").is_visible() is forgets, code
        assert page.locator("#editbar").is_visible()              # 편집한 것은 그대로

    # 이 화면을 연 뒤 다른 곳에서 저장했으면 묻는다 — 아니라고 하면 덮어쓰지 않는다
    gh.remote = {**EMPTY, "rev": "someone-else"}
    gh.put_status, gh.put_headers = 200, {}
    asked: list[str] = []
    page.once("dialog", lambda d: (asked.append(d.message), d.dismiss()))
    page.click("#saveGo")
    pw.expect(status).to_contain_text("저장하지 않았습니다")
    assert asked and "덮어쓸까요" in asked[0]
    assert len(gh.puts()) == len(cases)
    # 덮어쓰겠다고 하면 저장한다(토큰은 기억해 두었으므로 다시 넣지 않는다)
    assert page.locator("#tokenKept").is_visible()
    page.once("dialog", lambda d: d.accept())
    page.click("#saveGo")
    page.wait_for_selector("#pending:not([hidden])")
    assert len(gh.puts()) == len(cases) + 1 and json.loads(gh.puts()[-1]["body"])["sha"] == "sha-1"
    assert errors == []
    ctx.close()


def test_save_without_token_copies_and_opens_github(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, EMPTY)
    gh = FakeGitHub(remote=EMPTY)
    ctx, page, errors = open_gallery(browser, serve(site), gh, clipboard=True)
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    page.click("#saveBtn")
    with ctx.expect_page() as popup:
        page.click("#ghSave")
    assert popup.value.url == EDIT_URL
    page.bring_to_front()
    assert "복사했습니다" in page.locator("#saveStatus").inner_text()
    assert page.locator("#ghLink").get_attribute("href") == EDIT_URL     # 새 탭이 막혔을 때 누를 링크
    copied = json.loads(page.evaluate("navigator.clipboard.readText()"))
    assert {k: v for k, v in copied.items() if k != "rev"} == {
        "version": 1, "categories": [{"key": "conf"}], "assign": {}, "order": ["b", "a", "conf/c", "conf/d"]}
    assert gh.puts() == [] and [c["auth"] for c in gh.gets()] == [None]   # 토큰 없이 읽기만 했다
    assert errors == []
    ctx.close()


def test_saving_keeps_layout_of_decks_this_page_does_not_know(tmp_path, browser, serve):
    # 숨긴 덱(x)과 아직 배포되지 않은 덱(y)은 decks.json 에 없어 이 화면이 모른다 — 저장해도 그 배치는 지킨다
    remote = {"version": 1, "rev": "r-1", "categories": [{"key": "conf"}],
              "assign": {"x": "conf", "y": ""}, "order": ["b", "x", "a", "y"]}
    site, _ = make_site(tmp_path, remote)
    gh = FakeGitHub(remote=remote)
    ctx, page, errors = open_gallery(browser, serve(site), gh, clipboard=True)
    assert titles(page) == ["다 덱", "라 덱", "나 덱", "가 덱"]         # 순서에 없는 conf 둘이 앞
    page.click("#editBtn")
    page.locator(".card").last.locator("[data-act=prev]").click()     # 가 덱을 나 덱 앞으로
    assert titles(page) == ["다 덱", "라 덱", "가 덱", "나 덱"]
    want_order = ["conf/c", "conf/d", "a", "y", "b", "x"]               # 모르는 덱은 저장소에서 바로 앞이던 덱 뒤로
    # 토큰 없이 — 창을 열 때 읽어 둔 저장소의 배치로
    page.click("#saveBtn")
    with ctx.expect_page():
        page.click("#ghSave")
    page.bring_to_front()
    copied = json.loads(page.evaluate("navigator.clipboard.readText()"))
    assert copied["assign"] == {"x": "conf", "y": ""} and copied["order"] == want_order
    # 토큰으로
    page.fill("#token", TOKEN)
    page.click("#saveGo")
    page.wait_for_selector("#pending:not([hidden])")
    saved = gh.saved()
    assert saved["assign"] == {"x": "conf", "y": ""} and saved["order"] == want_order
    assert errors == []
    ctx.close()


def test_save_dialog_waits_while_saving(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, EMPTY)
    gh = FakeGitHub(remote=EMPTY)
    gh.hold = True
    ctx, page, errors = open_gallery(browser, serve(site), gh)
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()     # 가 덱을 뒤로 → 나 가 다 라
    save_with_token(page)
    pump(page, gh.puts)
    # 저장하는 동안은 Esc·닫기로 창을 닫지 않고, 편집도 끝내지 않는다
    page.keyboard.press("Escape")
    assert page.locator("#save[open]").count() == 1
    assert page.locator("#saveClose").is_disabled() and page.locator("#doneBtn").is_disabled()
    gh.release()
    page.wait_for_selector("#pending:not([hidden])")
    assert page.locator("#save[open]").count() == 0 and page.locator("#editbar").is_hidden()
    assert gh.saved()["order"] == ["b", "a", "conf/c", "conf/d"]

    # 그래도 창이 닫혀(브라우저는 Esc 를 거듭 받으면 닫기도 한다) 저장하는 사이 더 고쳤으면,
    # 저장이 끝나도 편집은 이어지고 그 편집은 남는다 — 방금 저장한 배치가 새 기준
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()     # 나 덱을 뒤로 → 가 나 다 라
    gh.hold = True
    save_with_token(page)
    pump(page, lambda: len(gh.puts()) == 2)
    page.evaluate("document.getElementById('save').close()")
    page.locator(".card").first.locator("[data-act=next]").click()     # 저장하는 사이 가 덱을 뒤로 → 나 가 다 라
    gh.release()
    page.wait_for_selector("#editbar:not([hidden]) #saveBtn:not([disabled])")
    assert gh.saved()["order"] == ["a", "b", "conf/c", "conf/d"]     # 보낸 것은 저장을 누를 때의 배치
    assert titles(page) == ["나 덱", "가 덱", "다 덱", "라 덱"]          # 그 뒤에 고친 것은 그대로
    assert page.locator("#pending").is_visible()
    assert errors == []
    ctx.close()


def test_after_reload_saving_without_token_edits_the_file_just_made(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, None)                               # 아직 배치 파일이 없는 저장소
    gh = FakeGitHub(remote=None)
    ctx, page, errors = open_gallery(browser, serve(site), gh, clipboard=True)
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    save_with_token(page)
    page.wait_for_selector("#pending:not([hidden])")
    assert "sha" not in json.loads(gh.puts()[-1]["body"])            # 새 파일을 만들었다
    # 배포 전에 새로 고친 탭 — 저장소를 읽지 못해도 파일이 있다는 것은 알아 GitHub 의 ‘새 파일’이 아닌 ‘고치기’를 연다
    page.reload()
    page.wait_for_selector(".card")
    gh.get_status = 500
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    page.click("#saveBtn")
    with ctx.expect_page() as popup:
        page.click("#ghSave")
    assert popup.value.url == EDIT_URL
    assert errors == []
    ctx.close()


def test_long_emoji_label_is_cut_between_characters(tmp_path, browser, serve):
    # folders.json 의 긴 이름(이모지)을 고쳐도 반쪽 글자가 저장되지 않는다 — 저장한 파일로 빌드가 된다
    folders = {"conf": {"label": "a" + SMILE * 45}}
    site, _ = make_site(tmp_path, EMPTY, folders=folders)
    gh = FakeGitHub(remote=EMPTY)
    ctx, page, errors = open_gallery(browser, serve(site), gh)
    page.click("#editBtn")
    page.click("#catsBtn")
    name = page.locator("#catList input").first
    name.press("End")
    name.press("Backspace")
    name.press("Tab")
    page.click("#catsClose")
    save_with_token(page)
    page.wait_for_selector("#pending:not([hidden])")
    saved = gh.saved()
    assert saved["categories"] == [{"key": "conf", "label": "a" + SMILE * 44}]
    _, m = make_site(tmp_path / "again", saved, folders=folders)
    assert m["layout"]["categories"][0]["label"] == "a" + SMILE * 44
    assert errors == []
    ctx.close()


# ---------- 편집 화면

def test_drag_undo_and_leaving_edit(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, EMPTY)
    ctx, page, errors = open_gallery(browser, serve(site))
    page.select_option("#sort", "title")                              # 고른 정렬은 편집을 끝내면 돌아온다
    page.click("#editBtn")
    assert page.locator("#sort").input_value() == "custom" and page.locator("#sort").is_disabled()
    cards = page.locator(".card")
    cards.nth(3).drag_to(cards.nth(0), target_position={"x": 12, "y": 60})    # 첫 카드의 왼쪽 → 그 앞
    assert titles(page) == ["라 덱", "가 덱", "나 덱", "다 덱"]
    assert page.locator("#saveBtn").is_enabled()
    asked: list[str] = []
    page.once("dialog", lambda d: (asked.append(d.message), d.accept()))
    page.click("#undoBtn")                                            # 모두 되돌릴지 묻는다
    assert asked and "모두 되돌릴까요" in asked[0]
    assert titles(page) == ["가 덱", "나 덱", "다 덱", "라 덱"] and page.locator("#saveBtn").is_disabled()
    # 분류 관리 — 이름을 바꾸면 칩·카드가 따라 바뀌고, 덱이 있는 분류는 지울 수 없다
    page.click("#catsBtn")
    name = page.locator("#catList input").first
    name.fill("학회 발표")
    name.press("Tab")
    assert page.locator("#catList [data-role=drop]").first.is_disabled()
    page.click("#catsClose")
    assert "학회 발표" in page.locator("#folders").inner_text()
    # 저장하지 않고 끝내려 하면 묻고, 그러겠다고 하면 원래 배치·정렬로 돌아간다
    page.once("dialog", lambda d: d.accept())
    page.click("#doneBtn")
    assert page.locator("#editbar").is_hidden()
    assert "학회 발표" not in page.locator("#folders").inner_text()
    assert page.locator("#sort").input_value() == "title"
    assert page.evaluate("localStorage.getItem('hs:sort')") == "title"
    assert errors == []
    ctx.close()


def test_keyboard_focus_stays_in_place(tmp_path, browser, serve):
    site, _ = make_site(tmp_path, EMPTY)
    ctx, page, errors = open_gallery(browser, serve(site))
    page.click("#editBtn")
    # 카드의 분류를 바꿔 카드를 다시 그려도 초점은 그 카드의 분류 칸에
    sel = page.locator(".card").first.locator("select")
    sel.focus()
    sel.select_option("conf")
    assert focused(page) == "분류 — 가 덱"
    assert page.locator(".card").first.locator(".folder").inner_text() == "학회"
    # 분류 관리 — 이름을 고친 뒤 처음 누른 단추도 듣고(목록을 다시 그리지 않는다), 맨 아래로 간 줄은 ↑ 에 초점
    page.click("#catsBtn")
    page.fill("#catNew", "새 분류")
    page.press("#catNew", "Enter")
    rows = page.locator("#catList li")
    assert rows.count() == 2
    rows.nth(0).locator("input").fill("학회 발표")
    rows.nth(0).locator("[data-role=down]").click()
    assert [rows.nth(i).locator("input").input_value() for i in range(2)] == ["새 분류", "학회 발표"]
    assert focused(page) == "위로 — 학회 발표"
    # 이름을 고치고 Tab — 초점은 그 줄에 남는다(맨 위 줄이라 ↑ 는 꺼져 있어 ↓ 로)
    rows.nth(0).locator("input").fill("새 분류 둘")
    rows.nth(0).locator("input").press("Tab")
    assert focused(page) == "아래로 — 새 분류 둘"
    # 같은 이름으로 더 만들면 창 안에 알린다(알림이 창 뒤에 가리지 않게)
    page.fill("#catNew", "새 분류 둘")
    page.press("#catNew", "Enter")
    assert rows.count() == 2 and "이미 있습니다" in page.locator("#catStatus").inner_text()
    # 덱이 없는 분류를 지우면 초점은 다음 줄로
    rows.nth(0).locator("[data-role=drop]").click()
    assert rows.count() == 1 and focused(page) == "분류 이름 — 학회 발표"
    page.click("#catsClose")
    # 덱 파일이 든 폴더는 덱을 모두 다른 분류로 옮겨도 지울 수 없다(지워도 빌드가 다시 붙이므로)
    for i in range(page.locator(".card").count()):
        page.locator(".card").nth(i).locator("select").select_option(label="분류 없음")
    page.click("#catsBtn")
    drop = page.locator("#catList [data-role=drop]").first
    assert page.locator("#catList .n").first.inner_text() == "0개"
    assert drop.is_disabled() and drop.get_attribute("title") == "덱 파일이 이 폴더에 있어 지울 수 없습니다"
    assert errors == []
    ctx.close()


# ---------- 덱 카드의 ⋯ 메뉴 → 덱 편집기

def test_card_menu_opens_only_html_decks_in_the_editor(tmp_path, browser, serve):
    root = tmp_path / "repo"
    root.mkdir()
    shutil.copy(REPO / "index.html", root / "index.html")
    for d in ("assets", "editor"):
        shutil.copytree(REPO / d, root / d)
    write(root / "decks/a.html", deck("가 덱"))
    write(root / "decks/talk/index.html", deck("폴더 덱"))
    (root / "decks/p.pdf").write_bytes(samples.make_pdf(1))
    write(root / "site.json", json.dumps({"title": "시험 갤러리", "repo": "owner/slides", "branch": "main",
                                          "author": NOREPLY}, ensure_ascii=False))
    manifest = bm.build_manifest(root, thumbs=False, cache=None, use_git=False)
    out = tmp_path / "site"
    bm.build_site(root, out, manifest, None)
    assert (out / "editor/index.html").is_file() and (out / "editor/js/app.js").is_file()   # 사이트에 편집기가 실린다
    url = serve(out)
    ctx, page, errors = open_gallery(browser, url)
    links = {}
    for card in page.locator(".card").all():
        more = card.locator("details.more")
        more.locator("summary").click()
        item = more.locator("[data-act=edit-deck]")
        links[card.locator(".title").inner_text()] = (item.get_attribute("href"), item.get_attribute("target")) \
            if item.count() else None
        more.locator("summary").click()
    ids = {d["title"]: d["id"] for d in manifest["decks"]}
    pdf = next(d["title"] for d in manifest["decks"] if d["kind"] == "pdf")
    assert links == {"가 덱": (f"editor/?deck={quote(ids['가 덱'], safe='')}", "_blank"),
                     "폴더 덱": (f"editor/?deck={quote(ids['폴더 덱'], safe='')}", "_blank"),
                     pdf: None}                                  # PDF·PPTX 는 원래 프로그램에서 고친다
    assert page.request.get(url + links["가 덱"][0]).status == 200
    assert errors == []
    ctx.close()


def test_gallery_opened_by_another_window_does_not_take_a_token(tmp_path, browser, serve):
    """같은 출처의 다른 창(발표 중인 덱의 스크립트 등)이 연 갤러리에서는 토큰으로 저장하지 않는다 — 그 창이 가로챌 수 있다"""
    site, _ = make_site(tmp_path, EMPTY)
    gh = FakeGitHub(remote=EMPTY)
    ctx, opener, errors = open_gallery(browser, serve(site), gh)
    with ctx.expect_page() as pi:
        opener.evaluate("window.open(location.href)")
    page = pi.value
    page.wait_for_selector(".card")
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    page.click("#saveBtn")
    page.fill("#token", TOKEN)
    page.click("#saveGo")
    pw.expect(page.locator("#saveStatus")).to_contain_text("다른 창")
    assert gh.puts() == [] and all(c["auth"] is None for c in gh.calls)
    assert page.input_value("#token") == ""                 # 넣은 토큰은 지운다
    ctx.close()
