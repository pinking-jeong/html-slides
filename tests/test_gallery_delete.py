"""갤러리 카드 ⋯ → 삭제… — 브라우저(Playwright)로 눌러 보고, GitHub 의 Git 데이터 API 요청은 가로채 본문을 본다."""
import base64
import hashlib
import json
import re
import shutil
from pathlib import Path

import pytest

import build_manifest as bm
import samples
from test_gallery_edit import (NOREPLY, REPO, TOKEN, browser, deck, open_gallery,  # noqa: F401 — browser·serve 는 fixture
                               pump, serve, titles, write)

pw = pytest.importorskip("playwright.sync_api")

API = "https://api.github.com/repos/owner/slides/"
HEADERS = {"access-control-allow-origin": "*", "access-control-expose-headers": "x-ratelimit-remaining"}
PENDING = "hs:deleted:owner/slides"
LAYOUT = {"version": 1, "rev": "r-1", "categories": [{"key": "conf", "label": "학회"}],
          "assign": {"a": "conf", "b": "conf"}, "order": ["b", "a", "c"]}


def sha(path: str) -> str:
    return "blob-" + hashlib.sha1(path.encode("utf-8")).hexdigest()[:12]


def make_site(tmp_path: Path, files: dict, layout: dict | None = LAYOUT) -> tuple[Path, dict, dict]:
    """files(decks/ 아래 경로 → 글이나 바이트)로 사이트를 만든다 → (사이트 폴더, 목록, 저장소 파일 전체)."""
    root = tmp_path / "repo"
    root.mkdir(parents=True)
    shutil.copy(REPO / "index.html", root / "index.html")
    shutil.copytree(REPO / "assets", root / "assets")
    write(root / "site.json", json.dumps({"title": "시험 갤러리", "repo": "owner/slides", "branch": "main",
                                          "author": NOREPLY}, ensure_ascii=False))
    write(root / "decks/folders.json", "{}")
    if layout is not None:
        write(root / "decks/gallery.json", json.dumps(layout, ensure_ascii=False, indent=1) + "\n")
    for rel, body in files.items():
        p = root / "decks" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(body, bytes):
            p.write_bytes(body)
        else:
            p.write_text(body, encoding="utf-8")
    manifest = bm.build_manifest(root, thumbs=False, cache=None, use_git=False)
    out = tmp_path / "site"
    bm.build_site(root, out, manifest, None)
    repo = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    return out, manifest, repo


class FakeRepo:
    """api.github.com 의 저장소 하나(owner/slides, main) — Git 데이터 API 와 배치 파일 contents API 만 답한다.
    files 는 저장소의 파일 전체(경로 → 바이트). fail 은 {(메서드, 주소 조각): (상태, 메시지)} 로 그 요청만 실패시킨다."""

    def __init__(self, files: dict):
        self.files = dict(files)
        self.head, self.root = "head-1", "tree-1"
        self.truncated = False
        self.fail: dict = {}
        self.calls: list[dict] = []
        self.trees: dict[str, dict] = {}         # POST git/trees 로 만든 트리 → 그 트리의 파일
        self.commits: dict[str, dict] = {}
        self.hold_tree = False                   # 참이면 트리 읽기를 release() 때까지 붙잡는다
        self.held: list = []

    def release(self):
        self.hold_tree = False
        while self.held:
            self(*self.held.pop(0))

    def gallery(self) -> dict:
        return json.loads(self.files["decks/gallery.json"])

    def writes(self) -> list[dict]:
        return [c for c in self.calls if c["method"] != "GET"]

    def body(self, method: str, part: str) -> dict:
        return json.loads(next(c["body"] for c in self.calls if c["method"] == method and part in c["url"]))

    def reply(self, route, status: int, obj: dict):
        route.fulfill(status=status, headers=HEADERS, json=obj)

    def __call__(self, route, request):
        method, url = request.method, request.url.split("?")[0]
        self.calls.append({"method": method, "url": url, "auth": request.headers.get("authorization"),
                           "body": request.post_data})
        rest = url[len(API):]
        for (m, part), (status, msg) in self.fail.items():
            if m == method and part in rest:
                return self.reply(route, status, {"message": msg})
        if method == "GET" and rest == "git/ref/heads/main":
            return self.reply(route, 200, {"object": {"sha": self.head}})
        if method == "GET" and rest == f"git/commits/{self.head}":
            return self.reply(route, 200, {"tree": {"sha": self.root}})
        if method == "GET" and rest == f"git/trees/{self.root}":
            if self.hold_tree:
                self.held.append((route, request))
                return None
            if "recursive=1" in request.url:         # 진짜 GitHub 는 recursive 가 없으면 맨 위 항목만 준다
                tree = [{"path": p, "type": "blob", "sha": sha(p)} for p in sorted(self.files)]
                tree.append({"path": "decks", "type": "tree", "sha": "tree-decks"})
            else:
                tree = [{"path": p, "type": "blob", "sha": sha(p)} for p in sorted(self.files) if "/" not in p]
                tree += [{"path": top, "type": "tree", "sha": f"tree-{top}"}
                         for top in sorted({p.split("/")[0] for p in self.files if "/" in p})]
            return self.reply(route, 200, {"tree": tree, "truncated": self.truncated})
        if method == "GET" and rest.startswith("git/blobs/"):
            path = next(p for p in self.files if sha(p) == rest.removeprefix("git/blobs/"))
            return self.reply(route, 200, {"content": base64.b64encode(self.files[path]).decode(), "encoding": "base64"})
        if method == "GET" and rest == "contents/decks/gallery.json":
            data = self.files["decks/gallery.json"]
            return self.reply(route, 200, {"sha": sha("decks/gallery.json"), "content": base64.b64encode(data).decode(),
                                           "encoding": "base64"})
        if method == "PUT" and rest == "contents/decks/gallery.json":
            self.files["decks/gallery.json"] = base64.b64decode(json.loads(request.post_data)["content"])
            return self.reply(route, 200, {"commit": {"sha": "c-put"}})
        if method == "POST" and rest == "git/trees":
            body = json.loads(request.post_data)
            assert body["base_tree"] == self.root
            files = dict(self.files)
            for e in body["tree"]:
                if e.get("sha") is None and "content" not in e:
                    files.pop(e["path"])
                else:
                    files[e["path"]] = e["content"].encode("utf-8")
            tid = f"tree-{len(self.trees) + 2}"
            self.trees[tid] = files
            return self.reply(route, 201, {"sha": tid})
        if method == "POST" and rest == "git/commits":
            body = json.loads(request.post_data)
            assert body["parents"] == [self.head]
            cid = f"commit-{len(self.commits) + 2}"
            self.commits[cid] = body
            return self.reply(route, 201, {"sha": cid})
        if method == "PATCH" and rest == "git/refs/heads/main":
            body = json.loads(request.post_data)
            assert body["sha"] in self.commits and body["force"] is False
            self.files = self.trees[self.commits[body["sha"]]["tree"]]
            self.head, self.root = body["sha"], self.commits[body["sha"]]["tree"]
            return self.reply(route, 200, {"object": {"sha": body["sha"]}})
        return self.reply(route, 404, {"message": f"Not Found: {method} {rest}"})


FILES = {
    "a.html": deck("가 덱"), "a.meta.json": json.dumps({"title": "가 덱"}), "a.pdf": samples.make_pdf(1),
    "A.PPTX": samples.make_pptx(1, title="가 덱"),             # 대소문자가 달라도 한 덱
    "ab.html": deck("나 덱"), "a-copy.html": deck("다 덱"),    # 이름이 비슷할 뿐인 다른 덱
    "conf/a.html": deck("라 덱"),                               # 다른 폴더의 같은 이름
}


def menu_delete(page, title: str) -> None:
    card = page.locator(".card", has=page.locator(".title", has_text=re.compile(f"^{re.escape(title)}$"))).first
    card.locator("details.more summary").click()
    card.locator("[data-act=delete-deck]").click()


def delete_with_token(page) -> None:
    if page.locator("#delToken").is_visible():
        page.fill("#delToken", TOKEN)
    page.click("#delGo")


def listed(page) -> list[str]:
    pw.expect(page.locator("#delFiles li").first).to_be_visible()
    return page.locator("#delFiles li").all_inner_texts()


def test_delete_removes_the_whole_deck_in_one_commit(tmp_path, browser, serve):
    """덱 파일(HTML·PDF·PPTX)과 정보 파일은 함께, 이름이 비슷한 덱·다른 폴더의 같은 이름은 그대로, 배치 파일에서는 자리를 뺀다"""
    site, manifest, files = make_site(tmp_path, FILES)
    assert {d["id"] for d in manifest["decks"]} >= {"a", "ab", "a-copy", "conf/a"}
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    before = titles(page)
    menu_delete(page, "가 덱")
    assert page.locator("#del").is_visible()
    assert "가 덱" in page.inner_text("#delLead")
    assert listed(page) == ["decks/A.PPTX", "decks/a.html", "decks/a.meta.json", "decks/a.pdf"]
    pw.expect(page.locator("#delPlan")).to_contain_text("파일 4개")
    assert repo.writes() == []                                   # 목록만 읽었고 아무것도 쓰지 않았다
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    # 커밋 하나: 새 트리(base_tree 위에 지움 + 배치 파일) → 커밋(부모는 맨 끝 커밋) → 브랜치 이동(force 안 함)
    assert [c["method"] for c in repo.writes()] == ["POST", "POST", "PATCH"]
    assert all(c["auth"] == f"Bearer {TOKEN}" for c in repo.writes())
    tree = repo.body("POST", "git/trees")
    gone = sorted(e["path"] for e in tree["tree"] if e.get("sha") is None and "content" not in e)
    assert gone == ["decks/A.PPTX", "decks/a.html", "decks/a.meta.json", "decks/a.pdf"]
    assert all(e["mode"] == "100644" and e["type"] == "blob" for e in tree["tree"])
    commit = repo.commits["commit-2"]
    assert commit["parents"] == ["head-1"] and commit["tree"] == "tree-2"
    assert commit["author"] == NOREPLY and commit["committer"] == NOREPLY
    assert commit["message"] == "docs: 덱 삭제 — a(갤러리 메뉴)"
    # 저장소에 남은 것
    assert sorted(p for p in repo.files if p.startswith("decks/") and "gallery" not in p and "folders" not in p) \
        == ["decks/a-copy.html", "decks/ab.html", "decks/conf/a.html"]
    lay = repo.gallery()
    assert lay["assign"] == {"b": "conf"} and lay["order"] == ["b", "c"]       # 다른 덱의 자리는 그대로
    assert lay["rev"] != "r-1" and lay["categories"] == LAYOUT["categories"] and lay["version"] == 1
    assert repo.files["decks/gallery.json"].decode("utf-8").endswith("}\n")
    # 화면
    assert "가 덱" not in titles(page) and len(titles(page)) == len(before) - 1
    assert page.locator("#pending").is_visible()
    assert "삭제한 덱 1개" in page.inner_text("#pending") and "저장한 배치" not in page.inner_text("#pending")
    assert page.evaluate("Object.keys(sessionStorage).sort()") == sorted([PENDING, "hs:pending:owner/slides"])
    # 낡은 목록(decks.json)이 다시 보여 주지 않는다
    page.reload()
    page.wait_for_selector(".card")
    assert "가 덱" not in titles(page) and page.locator("#pending").is_visible()
    assert errors == []
    ctx.close()


def test_delete_folder_deck_removes_only_that_folder(tmp_path, browser, serve):
    files = {"talk/index.html": deck("폴더 덱"), "talk/js/app.js": "1", "talk/img/x.png": samples.jpeg(),
             "talk2/index.html": deck("옆 폴더 덱"), "talkfile.html": deck("파일 덱")}
    site, manifest, repo_files = make_site(tmp_path, files, layout=None)
    repo = FakeRepo(repo_files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "폴더 덱")
    assert listed(page) == ["decks/talk/img/x.png", "decks/talk/index.html", "decks/talk/js/app.js"]
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    tree = repo.body("POST", "git/trees")
    assert sorted(e["path"] for e in tree["tree"]) == ["decks/talk/img/x.png", "decks/talk/index.html", "decks/talk/js/app.js"]
    assert all(e["sha"] is None for e in tree["tree"])           # 배치 파일이 없으니 그것은 건드리지 않는다
    assert sorted(p for p in repo.files if p.startswith("decks/")) \
        == ["decks/folders.json", "decks/talk2/index.html", "decks/talkfile.html"]
    assert sorted(titles(page)) == sorted(["파일 덱", "옆 폴더 덱"])
    assert errors == []
    ctx.close()


def test_delete_leaves_layout_alone_when_the_deck_has_no_place_in_it(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, {"x.html": deck("엑스"), "y.html": deck("와이")},
                               layout={"version": 1, "rev": "r-9", "categories": [], "assign": {}, "order": ["y"]})
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "엑스")
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    tree = repo.body("POST", "git/trees")
    assert [e["path"] for e in tree["tree"]] == ["decks/x.html"]
    assert repo.gallery()["rev"] == "r-9"
    ctx.close()


@pytest.mark.parametrize("fail,message,keeps_token", [
    ({("POST", "git/trees"): (401, "Bad credentials")}, "토큰이 맞지 않거나", False),
    ({("POST", "git/trees"): (403, "Resource not accessible by personal access token")}, "쓸 수 없습니다", False),
    ({("PATCH", "git/refs"): (422, "Update is not a fast forward")}, "그 사이 저장소가 바뀌었습니다", True),
    ({("POST", "git/commits"): (500, "Server Error")}, "HTTP 500", True),
])
def test_delete_failures_are_explained_and_change_nothing(tmp_path, browser, serve, fail, message, keeps_token):
    site, _, files = make_site(tmp_path, FILES)
    repo = FakeRepo(files)
    repo.fail = fail
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    before = titles(page)
    menu_delete(page, "가 덱")
    listed(page)
    delete_with_token(page)
    pw.expect(page.locator("#delStatus")).to_contain_text(message)
    assert page.locator("#del").is_visible() and titles(page) == before        # 창도 카드도 그대로
    assert page.locator("#delGo").is_enabled() and page.locator("#delClose").is_enabled()
    assert page.locator("#delKept").is_visible() == keeps_token                   # 거절된 토큰은 잊는다
    assert repo.head == "head-1" and "decks/a.html" in repo.files
    assert page.evaluate(f"sessionStorage.getItem('{PENDING}')") is None
    assert errors == []
    ctx.close()


def test_delete_stops_when_the_file_list_is_cut_off_or_the_deck_is_not_there(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, FILES)
    repo = FakeRepo(files)
    repo.truncated = True
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "가 덱")
    pw.expect(page.locator("#delPlan")).to_contain_text("너무 길어")      # 목록을 못 읽으면 지우는 파일도 알 수 없다
    delete_with_token(page)
    pw.expect(page.locator("#delStatus")).to_contain_text("slides remove")
    assert repo.writes() == []
    page.click("#delClose")
    repo.truncated = False
    repo.files = {p: b for p, b in repo.files.items() if not p.startswith("decks/a.") and p != "decks/A.PPTX"}
    menu_delete(page, "가 덱")
    pw.expect(page.locator("#delPlan")).to_contain_text("찾지 못했습니다")
    assert page.locator("#delGo").is_disabled()                                  # 지울 것이 없으면 누를 수 없다
    assert repo.writes() == [] and errors == []
    ctx.close()


def test_delete_without_token_offers_github_pages_and_the_command(tmp_path, browser, serve):
    files = {**FILES, "talk/index.html": deck("폴더 덱")}
    site, _, repo_files = make_site(tmp_path, files)
    repo = FakeRepo(repo_files)
    ctx, page, errors = open_gallery(browser, serve(site), repo, clipboard=True)
    menu_delete(page, "가 덱")
    listed(page)
    hrefs = page.locator("#delLinks a").evaluate_all("els => els.map(a => a.href)")
    assert hrefs == [f"https://github.com/owner/slides/delete/main/decks/{n}"
                     for n in ("A.PPTX", "a.html", "a.meta.json", "a.pdf")]
    assert page.inner_text("#delCmd") == 'slides remove "a"'
    page.click("#delCopy")
    pw.expect(page.locator("#delStatus")).to_contain_text("복사했습니다")
    assert page.evaluate("navigator.clipboard.readText()") == 'slides remove "a"'
    assert all(c["auth"] is None for c in repo.calls) and repo.writes() == []   # 토큰 없이 읽기만
    page.click("#delClose")
    menu_delete(page, "폴더 덱")                                                  # 폴더 덱은 폴더 화면으로 안내
    listed(page)
    folder = page.locator("#delLinks a").evaluate_all("els => els.map(a => a.href)")
    assert folder == ["https://github.com/owner/slides/tree/main/decks/talk"]
    assert page.inner_text("#delCmd") == 'slides remove "talk"'
    assert errors == []
    ctx.close()


def test_delete_dialog_when_the_file_list_cannot_be_read_still_works(tmp_path, browser, serve):
    """목록을 못 읽어도(요청 한도 등) 이 화면이 아는 파일을 보여 주고, 지우는 순간 다시 읽어 지운다"""
    site, _, files = make_site(tmp_path, FILES)
    repo = FakeRepo(files)
    repo.fail = {("GET", "git/ref"): (403, "rate limit")}
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "가 덱")
    pw.expect(page.locator("#delPlan")).to_contain_text("지우는 순간 다시 읽어")
    assert listed(page) == ["decks/a.html", "decks/a.pdf", "decks/A.PPTX"]     # 화면이 아는 덱 파일
    repo.fail = {}
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    assert "decks/a.meta.json" not in repo.files and "decks/A.PPTX" not in repo.files   # 정확한 목록으로 지웠다
    ctx.close()


def test_delete_keeps_the_token_in_memory_only_and_reuses_it(tmp_path, browser, serve):
    files = {"x.html": deck("엑스"), "y.html": deck("와이"), "z.html": deck("지")}
    site, _, repo_files = make_site(tmp_path, files, layout=None)
    repo = FakeRepo(repo_files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "엑스")
    listed(page)
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    assert page.input_value("#delToken") == ""
    assert TOKEN not in json.dumps(page.evaluate("[localStorage, sessionStorage].map(s => ({...s}))"))
    # 두 번째는 토큰을 다시 묻지 않고, 엔터 한 번에 지워지지 않게 초점은 닫기에 있다
    menu_delete(page, "와이")
    listed(page)
    assert page.locator("#delKept").is_visible() and page.locator("#delTokenField").is_hidden()
    assert page.evaluate("document.activeElement.id") == "delClose"
    page.click("#delGo")
    page.wait_for_selector("#del", state="hidden")
    assert titles(page) == ["지"]
    assert "삭제한 덱 2개" in page.inner_text("#pending")
    assert errors == []
    ctx.close()


def test_delete_dialog_cannot_be_closed_while_deleting(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, {"x.html": deck("엑스")}, layout=None)
    repo = FakeRepo(files)
    held = []
    plain = repo.__call__

    def hold(route, request):
        if request.method == "PATCH":
            held.append((route, request))              # 브랜치 이동을 붙잡아 두고 창을 닫아 본다
        else:
            plain(route, request)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    ctx.unroute("https://api.github.com/**")
    ctx.route("https://api.github.com/**", hold)
    menu_delete(page, "엑스")
    listed(page)
    delete_with_token(page)
    pump(page, lambda: held)
    assert page.locator("#delClose").is_disabled() and page.locator("#delGo").is_disabled()
    page.keyboard.press("Escape")
    page.mouse.click(2, 2)                              # 바깥을 눌러도
    assert page.locator("#del").is_visible()
    route, request = held.pop()
    plain(route, request)
    page.wait_for_selector("#del", state="hidden")
    assert errors == []
    ctx.close()


def test_a_deleted_deck_stays_hidden_until_the_list_drops_it(tmp_path, browser, serve):
    """목록에 같은 덱(경로·판)이 아직 있는 동안은 숨기고, 목록에서 사라졌거나 판이 달라졌거나 15분이 지나면 기록을 버린다"""
    site, manifest, files = make_site(tmp_path, {"x.html": deck("엑스"), "y.html": deck("와이")}, layout=None)
    listing = json.loads((site / "decks.json").read_text(encoding="utf-8"))
    ctx, page, errors = open_gallery(browser, serve(site), FakeRepo(files))
    deck_x = next(d for d in manifest["decks"] if d["id"] == "x")
    stamp = page.evaluate("Date.now()")

    def seen(record: dict) -> list[str]:
        page.evaluate("([k, v]) => sessionStorage.setItem(k, v)", [PENDING, json.dumps([record])])
        page.reload()
        page.wait_for_selector(".card")
        return sorted(titles(page))

    same = {"path": deck_x["path"], "sig": deck_x["rev"], "at": stamp}
    assert seen(same) == ["와이"]                                                         # 같은 판 → 숨김
    assert page.locator("#pending").is_visible()
    # 먼저 시작한 배포가 옛 커밋으로 끝나 나중에 올라온 목록 — 만든 때가 지운 때보다 늦어도 덱이 아직 있으면 숨긴다
    assert listing["generated"] < "2999"
    listing["generated"] = "2999-01-01T00:00:00Z"
    (site / "decks.json").write_text(json.dumps(listing, ensure_ascii=False), encoding="utf-8")
    assert seen(same) == ["와이"]
    assert page.evaluate("k => sessionStorage.getItem(k)", PENDING) is not None            # 기록을 지우지 않는다
    assert seen({**same, "sig": "other"}) == ["엑스", "와이"]                               # 다른 판(다시 올림) → 보임
    assert page.locator("#pending").is_hidden()
    assert page.evaluate("k => sessionStorage.getItem(k)", PENDING) is None                # 그 기록은 버린다
    assert seen({**same, "path": "decks/gone.html"}) == ["엑스", "와이"]                    # 목록에서 사라진 덱의 기록도
    assert page.evaluate("k => sessionStorage.getItem(k)", PENDING) is None
    assert seen({**same, "at": stamp - 16 * 60 * 1000}) == ["엑스", "와이"]                 # 15분이 지남
    assert page.locator("#pending").is_hidden()
    assert errors == []
    ctx.close()


def test_hidden_count_only_counts_decks_still_in_the_list(tmp_path, browser, serve):
    site, manifest, files = make_site(tmp_path, {"x.html": deck("엑스"), "y.html": deck("와이"), "z.html": deck("지")},
                                      layout=None)
    ctx, page, errors = open_gallery(browser, serve(site), FakeRepo(files))
    stamp = page.evaluate("Date.now()")
    rev = {d["id"]: d["rev"] for d in manifest["decks"]}
    old = [{"path": "decks/x.html", "sig": rev["x"], "at": stamp}, {"path": "decks/gone.html", "sig": "s", "at": stamp}]
    page.evaluate("([k, v]) => sessionStorage.setItem(k, v)", [PENDING, json.dumps(old)])
    page.reload()
    page.wait_for_selector(".card")
    assert "덱 1개" in page.inner_text("#pending")                          # 배포가 끝난 gone 은 세지 않는다
    assert json.loads(page.evaluate("k => sessionStorage.getItem(k)", PENDING)) == [old[0]]
    menu_delete(page, "와이")
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    assert "덱 2개" in page.inner_text("#pending")
    assert errors == []
    ctx.close()


def test_saving_the_layout_after_a_delete_does_not_ask_about_other_edits(tmp_path, browser, serve):
    """삭제가 배치 파일의 rev 를 바꾸므로, 이 화면의 기준도 새 rev 로 옮겨 두어야 이어지는 저장이 '그 사이 저장됨'을 묻지 않는다"""
    site, _, files = make_site(tmp_path, {"a.html": deck("가"), "b.html": deck("나"), "c.html": deck("다")},
                               layout={"version": 1, "rev": "r-1", "categories": [], "assign": {}, "order": ["a", "b", "c"]})
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    menu_delete(page, "가")
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    page.click("#saveBtn")
    page.click("#saveGo")
    page.wait_for_selector("#editbar", state="hidden")
    assert dialogs == []
    assert repo.gallery()["order"] == ["c", "b"] and errors == []
    ctx.close()


def test_delete_is_refused_for_a_gallery_opened_by_another_window(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, {"x.html": deck("엑스")}, layout=None)
    repo = FakeRepo(files)
    ctx, opener, errors = open_gallery(browser, serve(site), repo)
    with ctx.expect_page() as pi:
        opener.evaluate("window.open(location.href)")
    page = pi.value
    page.wait_for_selector(".card")
    menu_delete(page, "엑스")
    listed(page)
    page.fill("#delToken", TOKEN)
    page.click("#delGo")
    pw.expect(page.locator("#delStatus")).to_contain_text("다른 창")
    assert page.input_value("#delToken") == ""
    assert repo.writes() == [] and all(c["auth"] is None for c in repo.calls)
    ctx.close()


def test_deleting_the_last_deck_of_a_category_resets_the_filter(tmp_path, browser, serve):
    files = {"conf/c.html": deck("씨"), "d.html": deck("디")}
    site, _, repo_files = make_site(tmp_path, files, layout=None)
    ctx, page, errors = open_gallery(browser, serve(site), FakeRepo(repo_files))
    page.click(".chip:has-text('conf')")
    assert titles(page) == ["씨"]
    menu_delete(page, "씨")
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    assert titles(page) == ["디"] and page.locator(".chip").count() == 0
    assert page.evaluate("localStorage.getItem('hs:folder')") in (None, "")
    assert errors == []
    ctx.close()


def test_delete_menu_item_is_in_every_card_and_not_while_editing(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, FILES)
    ctx, page, errors = open_gallery(browser, serve(site), FakeRepo(files))
    assert page.locator("[data-act=delete-deck]").count() == page.locator(".card").count()
    page.click("#editBtn")
    assert page.locator("[data-act=delete-deck]").count() == 0           # 편집 중에는 카드 메뉴 자체가 없다
    assert errors == []
    ctx.close()


def test_delete_button_waits_for_the_file_list_and_rechecks_it(tmp_path, browser, serve):
    """목록을 보기 전에는 삭제를 누를 수 없고, 보여 준 뒤 덱에 파일이 더해졌으면 지우지 않고 새 목록을 보여 준다"""
    site, _, files = make_site(tmp_path, {"a.html": deck("가"), "b.html": deck("나")}, layout=None)
    repo = FakeRepo(files)
    repo.hold_tree = True
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "가")
    pump(page, lambda: repo.held)
    assert page.locator("#delGo").is_disabled()                                  # 읽는 중
    page.fill("#delToken", TOKEN)
    page.press("#delToken", "Enter")                                             # 엔터로도 보낼 수 없다
    assert repo.writes() == []
    repo.release()
    assert listed(page) == ["decks/a.html"]
    assert page.locator("#delGo").is_enabled()
    repo.files["decks/a.htm"] = deck("끼어든 파일").encode("utf-8")               # 목록을 본 뒤 같은 덱에 파일이 더해졌다
    page.click("#delGo")
    pw.expect(page.locator("#delStatus")).to_contain_text("바뀌었습니다")
    assert listed(page) == ["decks/a.htm", "decks/a.html"] and repo.writes() == []   # 새 목록을 보여 주고 아무것도 지우지 않았다
    assert page.locator("#del").is_visible() and page.locator("#delGo").is_enabled()
    page.click("#delGo")                                                         # 새 목록을 보고 다시 누르면 지운다
    page.wait_for_selector("#del", state="hidden")
    assert not any(p.startswith("decks/a.") for p in repo.files) and "decks/b.html" in repo.files
    assert errors == []
    ctx.close()


def test_command_and_commit_message_are_safe_for_odd_deck_names(tmp_path, browser, serve):
    """굽은 따옴표 같은 글자가 든 이름은 셸 명령으로 보여 주지 않고, 대괄호는 커밋 메시지에서 바꿔 배포가 건너뛰어지지 않게 한다"""
    quote = "q" + chr(0x201D) + "; calc; " + chr(0x201D)
    site, _, files = make_site(tmp_path, {f"{quote}.html": deck("따옴표"), "talk [skip ci].html": deck("대괄호")}, layout=None)
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "따옴표")
    listed(page)
    assert page.inner_text("#delCmd") == "slides list" and page.locator("#delCopy").is_hidden()
    page.click("#delClose")
    menu_delete(page, "대괄호")
    listed(page)
    assert page.inner_text("#delCmd") == 'slides remove "talk [skip ci]"'            # 대괄호는 셸에서 따옴표 안이면 무해
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    message = repo.commits["commit-2"]["message"]
    assert message == "docs: 덱 삭제 — talk (skip ci)(갤러리 메뉴)" and "[" not in message
    assert errors == []
    ctx.close()


def test_a_deck_record_that_points_outside_a_deck_folder_deletes_nothing(tmp_path, browser, serve):
    """decks.json 이 폴더 덱의 dir 을 'decks' 나 '..' 로 적어도 지울 파일이 없다 — 삭제 단추는 잠긴 채"""
    site, _, files = make_site(tmp_path, {"x.html": deck("엑스"), "y.html": deck("와이")}, layout=None)
    listing = json.loads((site / "decks.json").read_text(encoding="utf-8"))
    for d, where in zip(listing["decks"], ("decks", "decks/../")):
        d.update(kind="dir", dir=where, path=f"{where.rstrip('/')}/index.html")
    (site / "decks.json").write_text(json.dumps(listing, ensure_ascii=False), encoding="utf-8")
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    for title in titles(page):
        menu_delete(page, title)
        pw.expect(page.locator("#delPlan")).to_contain_text("찾지 못했습니다")
        assert page.locator("#delGo").is_disabled() and page.locator("#delFiles li").count() == 0
        page.click("#delClose")
    assert repo.writes() == [] and "decks/x.html" in repo.files and "decks/y.html" in repo.files
    ctx.close()


def test_delete_menu_is_not_offered_for_a_branch_name_with_dots(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, {"x.html": deck("엑스")}, layout=None)
    listing = json.loads((site / "decks.json").read_text(encoding="utf-8"))
    listing["site"]["branch"] = "../x"
    (site / "decks.json").write_text(json.dumps(listing, ensure_ascii=False), encoding="utf-8")
    ctx, page, errors = open_gallery(browser, serve(site), FakeRepo(files))
    assert page.locator("[data-act=delete-deck]").count() == 0
    assert page.locator("[data-act=edit-deck]").count() == 1                      # 다른 메뉴는 그대로
    ctx.close()


def test_a_failure_after_the_dialog_was_closed_is_shown_as_a_toast(tmp_path, browser, serve):
    """지우는 동안 창이 닫혀도(Esc 를 거듭 누르면 브라우저가 닫는다) 실패는 알림으로 보인다"""
    site, _, files = make_site(tmp_path, {"x.html": deck("엑스")}, layout=None)
    repo = FakeRepo(files)
    held = []
    plain = repo.__call__

    def hold(route, request):
        if request.method == "PATCH":
            held.append((route, request))
        else:
            plain(route, request)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    ctx.unroute("https://api.github.com/**")
    ctx.route("https://api.github.com/**", hold)
    menu_delete(page, "엑스")
    listed(page)
    delete_with_token(page)
    pump(page, lambda: held)
    page.evaluate("document.getElementById('del').close()")                      # 브라우저가 닫은 것을 흉내 낸다
    page.wait_for_selector("#del", state="hidden")
    repo.fail = {("PATCH", "git/refs"): (422, "Update is not a fast forward")}
    route, request = held.pop()
    plain(route, request)
    pw.expect(page.locator("#toast")).to_contain_text("그 사이 저장소가 바뀌었습니다")
    assert titles(page) == ["엑스"] and errors == []
    ctx.close()


def test_two_decks_with_the_same_id_do_not_take_each_other_down(tmp_path, browser, serve):
    """x.html 과 x/index.html 은 id 가 같다(빌드의 알려진 한계) — 하나를 지워도 다른 덱의 카드·배치 자리·파일은 남는다"""
    layout = {"version": 1, "rev": "r-1", "categories": [], "assign": {}, "order": ["x", "y"]}
    site, manifest, files = make_site(tmp_path, {"x.html": deck("파일 엑스"), "x/index.html": deck("폴더 엑스"),
                                                 "y.html": deck("와이")}, layout=layout)
    assert sorted(d["id"] for d in manifest["decks"]) == ["x", "x", "y"]
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    menu_delete(page, "파일 엑스")
    assert listed(page) == ["decks/x.html"]
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    assert sorted(titles(page)) == sorted(["폴더 엑스", "와이"])
    assert "decks/x/index.html" in repo.files and "decks/x.html" not in repo.files
    assert repo.gallery() == layout                                               # 남은 덱의 자리이기도 하니 배치는 그대로
    assert errors == []
    ctx.close()


def test_a_layout_save_still_deploying_keeps_its_notice_after_a_delete(tmp_path, browser, serve):
    site, _, files = make_site(tmp_path, {"a.html": deck("가"), "b.html": deck("나"), "c.html": deck("다")},
                               layout={"version": 1, "rev": "r-1", "categories": [], "assign": {}, "order": ["a", "b", "c"]})
    repo = FakeRepo(files)
    ctx, page, errors = open_gallery(browser, serve(site), repo)
    page.click("#editBtn")
    page.locator(".card").first.locator("[data-act=next]").click()
    page.click("#saveBtn")
    page.fill("#token", TOKEN)
    page.click("#saveGo")
    page.wait_for_selector("#editbar", state="hidden")
    menu_delete(page, "다")
    delete_with_token(page)
    page.wait_for_selector("#del", state="hidden")
    page.reload()                                                                  # 낡은 목록: 배치도 덱도 배포 전
    page.wait_for_selector(".card")
    text = page.inner_text("#pending")
    assert "저장한 배치" in text and "삭제한 덱 1개" in text
    assert "다" not in titles(page)
    assert errors == []
    ctx.close()
