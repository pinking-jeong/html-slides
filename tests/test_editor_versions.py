"""덱 편집기 — 판 기록: 이 브라우저의 임시 저장본, 저장소의 판(커밋), 이 PC 의 저장 전 판(slides edit).
브라우저(Playwright)로 눌러 본다. GitHub API 는 DeckHub 에 커밋 목록·옛 판 읽기를 더한 HistoryHub 가 흉내 낸다."""
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit

import pytest
from playwright.sync_api import expect

from test_editor import (  # noqa: F401 — browser·serve·local_edit 는 fixture
    BUILDER, PREFIX, QUIET, DeckHub, browser, frame, local_edit, make_site, open_editor, same_dom, save_with_token,
    select_text, serve, state, wait_file, wait_saved,
)

COMMITS = "/repos/owner/slides/commits"
OLD = BUILDER.replace("시험 덱 표지", "옛 표지")
C0 = "c" * 40                     # 덱이 아닌 옛 판(열지 못하는 판)
C1 = "a" * 40
C2 = "b" * 40
NOT_DECK = b"<!doctype html><html><body><p>deck not here</p></body></html>"
TITLE = "section.slide:nth-of-type(1) [data-name=title] .tin"

# 이 브라우저(출처)의 임시 저장본 줄(글 빼고)
ROWS = """() => new Promise((ok, no) => {
  const r = indexedDB.open('hs-editor', 1);
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const d = r.result;
    const q = d.transaction('drafts').objectStore('drafts').getAll();
    q.onsuccess = () => { d.close(); ok(q.result.map((x) => ({ id: x.id, deck: x.deck, time: x.time }))); };
    q.onerror = () => no(q.error);
  };
})"""
# 임시 저장본을 모두 지운다(다른 창이 정리한 것처럼)
CLEAR_DRAFTS = """() => new Promise((ok, no) => {
  const r = indexedDB.open('hs-editor', 1);
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const d = r.result;
    const t = d.transaction(['drafts', 'draftText'], 'readwrite');
    t.objectStore('drafts').clear();
    t.objectStore('draftText').clear();
    t.oncomplete = () => { d.close(); ok(true); };
    t.onerror = () => no(t.error);
  };
})"""
# 덱 화면 문서를 통째로 복제한 수(덱을 글로 만든 수) — Node.prototype.cloneNode 를 감싸 센다. 스크립트를 끈 덱 화면의 요소를
# 편집기에서 다루면 편집기 쪽 프로토타입을 거칠 수 있어 둘 다 감싼다.
COUNT_CLONES = """() => {
  window.__clones = 0;
  const w = document.getElementById('frame').contentWindow;
  for (const N of new Set([Node.prototype, w.Node.prototype])) {
    const orig = N.cloneNode;
    N.cloneNode = function (deep) {
      if (deep && this.nodeType === 1 && this.parentNode && this.parentNode.nodeType === 9) window.__clones += 1;
      return orig.call(this, deep);
    };
  }
}"""
# drafts.js 를 바로 불러 덱마다 남기는 수(5)·같은 줄 고쳐 쓰기·지워진 줄·30일 넘은 줄(다른 덱 것도)·정리하지 않고 남기기·
# 그대로일 때만 지우기를 본다(시험용 덱 이름)
PRUNE = """async () => {
  const m = await import('./js/drafts.js');
  const list = async (k) => (await m.listDrafts(k)).map((d) => d.slides);
  const plant = (deck, age, slides) => new Promise((ok, no) => {
    const r = indexedDB.open('hs-editor', 1);
    r.onerror = () => no(r.error);
    r.onsuccess = () => {
      const d = r.result;
      const t = d.transaction(['drafts', 'draftText'], 'readwrite');
      const q = t.objectStore('drafts').add({ deck, time: Date.now() - age, size: 3, slides });
      q.onsuccess = () => t.objectStore('draftText').put('old', q.result);
      t.oncomplete = () => { d.close(); ok(); };
      t.onerror = () => no(t.error);
    };
  });
  const ids = [];
  for (let i = 0; i < 6; i += 1) ids.push(await m.putDraft('test:prune', `t${i}`, { slides: i }));
  const after6 = await list('test:prune');
  const again = await m.putDraft('test:prune', 'x', { slides: 50 }, ids[5]);
  const over = await list('test:prune');
  await m.deleteDraft(ids[4]);
  const fresh = await m.putDraft('test:prune', 'y', { slides: 60 }, ids[4]);
  const later = await list('test:prune');
  await plant('test:age', 31 * 864e5, 99);
  await plant('test:other', 31 * 864e5, 98);
  await plant('test:keep', 864e5, 97);
  const before = await list('test:age');
  await m.putDraft('test:age', 'new', { slides: 1 });
  const aged = await list('test:age');
  const other = await list('test:other');
  const keep = await list('test:keep');
  for (let i = 0; i < 6; i += 1) await m.putDraft('test:hold', `h${i}`, { slides: i }, 0, false);
  const held = await list('test:hold');
  await m.putDraft('test:hold', 'h6', { slides: 6 });
  const trimmed = await list('test:hold');
  const top = (await m.listDrafts('test:hold'))[0];
  await m.deleteDraft(top.id, top.time - 1);
  const spared = !!(await m.getDraft(top.id));
  await m.deleteDraft(top.id, top.time);
  const removed = !(await m.getDraft(top.id));
  const text = (await m.getDraft(ids[5])).text;
  return { ids, after6, again, over, fresh, later, before, aged, other, keep, held, trimmed, spared, removed, text };
}"""
# IndexedDB 를 못 쓰는 브라우저(사생활 보호 창 등)
NO_IDB = "Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('no indexedDB'); } });"
# IndexedDB 가 열리지 않고 멈추는 브라우저(일부 브라우저의 결함) — 여는 요청이 끝내 아무 일도 일으키지 않는다
HANG_IDB = "indexedDB.open = () => ({});"
# 이 덱(시험 사이트의 builder)의 임시 저장본 이름 — source.js 의 draftKey
KEY = "gh:owner/slides:main:decks/builder.html"
# 다른 창들이 남긴 임시 저장본 n 개(옛것부터, 표지를 ‘창 k 의 표지’로) — 줄 번호들을 돌려준다
PLANT = """async ([key, n]) => {
  const m = await import('./js/drafts.js');
  const text = window.__hse.serialize();
  const ids = [];
  for (let k = 1; k <= n; k += 1) {
    ids.push(await m.putDraft(key, text.replace('시험 덱 표지', `창 ${k} 의 표지`), { slides: 3 }));
    await new Promise((r) => setTimeout(r, 5));
  }
  return ids;
}"""
# 다른 창이 그 줄을 고쳐 쓴 것처럼(정리하지 않고)
REWRITE = """async ([key, id]) => {
  const m = await import('./js/drafts.js');
  return m.putDraft(key, (await m.getDraft(id)).text, { slides: 3 }, id, false);
}"""
# 줄 하나의 글
TEXT_OF = "async (id) => (await (await import('./js/drafts.js')).getDraft(id)).text"


class HistoryHub(DeckHub):
    """DeckHub 에 커밋 목록(GET …/commits?path=&sha=)과 옛 판 읽기(contents?ref=<커밋>)를 더한다.
    history: 저장소 경로 → [(커밋, 시각 ISO, 메시지, 바이트)] — 새것부터. hold 이면 저장(PUT)을 release() 때까지 붙잡는다."""

    def __init__(self, files: dict[str, bytes], history: dict[str, list]):
        super().__init__(files)
        self.history = {k: list(v) for k, v in history.items()}
        self.hold = False
        self.held: list = []

    def __call__(self, route, request):
        u = urlsplit(request.url)
        q = parse_qs(u.query)
        if request.method == "PUT" and self.hold:
            self.held.append((route, request))
            return
        if request.method == "GET" and u.path == COMMITS:
            self.calls.append({"method": "GET", "path": "commits", "query": q, "auth": request.headers.get("authorization")})
            rows = self.history.get(q.get("path", [""])[0], [])
            route.fulfill(status=200, headers={**self.HEADERS, "content-type": "application/json"}, json=[
                {"sha": sha, "html_url": f"https://github.com/owner/slides/commit/{sha}",
                 "commit": {"message": msg, "author": {"name": "작성자", "date": when},
                            "committer": {"name": "GitHub", "date": when}}}
                for sha, when, msg, _ in rows])
            return
        if request.method == "GET" and unquote(u.path).startswith(PREFIX) and "ref" in q:
            rel = unquote(u.path)[len(PREFIX):]
            for sha, _, _, data in self.history.get(rel, []):
                if sha == q["ref"][0]:
                    self.calls.append({"method": "GET", "path": rel, "ref": sha})
                    route.fulfill(status=200, headers={**self.HEADERS, "content-type": "application/vnd.github.raw+json"},
                                  body=data)
                    return
        super().__call__(route, request)

    def release(self) -> None:
        self.hold = False
        held, self.held = self.held, []
        for route, request in held:
            super().__call__(route, request)


@pytest.fixture
def hist_site(tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    cur = (root / "decks" / "builder.html").read_bytes()
    hub = HistoryHub({"decks/builder.html": cur}, {"decks/builder.html": [
        (C2, "2026-10-12T10:00:00Z", "docs: 덱 고침 — builder.html(웹 편집기)\n\n본문", cur),
        (C1, "2026-10-11T09:00:00Z", "feat: 첫 판", OLD.encode("utf-8")),
    ]})
    return serve(site), hub


def rows(page, which: str) -> list:
    return page.locator(f"#{which} li").evaluate_all("(ls) => ls.map((l) => l.innerText.replace(/\\s+/g, ' ').trim())")


def title_text(page) -> str:
    return frame(page).locator("section.slide").nth(0).locator("[data-name=title]").inner_text()


def open_page(ctx, url: str):
    page = ctx.new_page()
    page.goto(url)
    page.wait_for_selector("#app.ready, #fail:not([hidden])", timeout=60000)
    return page


def wait_rows(page, ok, timeout: float = 15.0) -> list:
    """임시 저장본 줄이 ok(줄들) 를 만족할 때까지(편집기가 몇 초 뒤 저절로 남기는 것을 기다린다)."""
    end = time.monotonic() + timeout
    while True:
        got = page.evaluate(ROWS)
        if ok(got) or time.monotonic() > end:
            return got
        page.wait_for_timeout(250)


def test_repo_versions_reopen_an_old_commit_and_save_it_as_new(browser, hist_site):
    base, hub = hist_site
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.click("#versions")
    expect(page.locator("#verRepo li").first).to_contain_text("2026-10-12")
    repo = rows(page, "verRepo")
    assert len(repo) == 2 and "지금 판" in repo[0] and "docs: 덱 고침 — builder.html(웹 편집기)" in repo[0] and "본문" not in repo[0]
    assert "feat: 첫 판" in repo[1] and "aaaaaaa" in repo[1] and "불러오기" in repo[1]
    assert rows(page, "verDrafts") == ["임시 저장본이 없습니다."]
    expect(page.locator("#verLive")).to_have_text("판 기록을 불러왔습니다 — 임시 저장본 0개, 저장소의 판 2개.")
    assert page.locator("#verRepo button[data-kind='ref']").get_attribute("aria-label").endswith(") 불러오기")
    q = next(c for c in hub.calls if c["path"] == "commits")["query"]
    assert q["path"] == ["decks/builder.html"] and q["sha"] == ["main"]
    page.locator("#verRepo button[data-kind='ref']").click()   # 고친 것이 없으면 묻지 않고 그 판으로 다시 연다
    page.wait_for_url(f"**ref={C1}**")
    page.wait_for_selector("#app.ready")
    assert title_text(page) == "옛 표지" and state(page)["dirty"] is True
    assert "저장해야 이 판이 새 판이 됩니다" in page.inner_text("#status")
    save_with_token(page)
    wait_saved(page, hub)
    assert same_dom(page, hub.saved("decks/builder.html"), OLD)          # 지금 판 위에 옛 판을 새 커밋으로
    assert hub.put_body()["sha"] != "" and "ref=" not in page.url and state(page)["dirty"] is False
    ctx.close()
    assert errors == []


def test_drafts_keep_unsaved_edits_and_bring_them_back(browser, hist_site):
    base, hub = hist_site
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("고친 표지")
    page.keyboard.press("Escape")
    assert page.evaluate("window.__hse.draft()") is True         # 몇 초마다 남기는 것을 바로
    r1 = page.evaluate(ROWS)[0]["id"]
    # 같은 브라우저의 새 탭 — 임시 저장본이 있다고 알린다(덱은 저장소의 지금 판으로 열린다)
    two = open_page(ctx, page.url)
    assert title_text(two) == "시험 덱 표지" and "임시 저장본이 있습니다" in two.inner_text("#status")
    two.click("#versions")
    expect(two.locator("#verDrafts li button")).to_have_count(1)
    assert "3장" in rows(two, "verDrafts")[0]
    two.locator("#verDrafts button[data-kind='draft']").click()
    two.wait_for_url("**draft=**")
    two.wait_for_selector("#app.ready")
    assert title_text(two) == "고친 표지" and state(two)["dirty"] is True
    # 고친 것이 있을 때 다른 판을 고르면 먼저 묻고, 지금 고침을 임시 저장본으로 남긴 뒤 연다
    select_text(two, TITLE, "고친 표지")
    two.keyboard.type("또 고친 표지")
    two.wait_for_timeout(100)
    two.click("#versions")
    two.locator("#verRepo button[data-kind='ref']").click()
    expect(two.locator("#verAsk")).to_be_visible()
    assert "임시 저장본으로 남깁니다" in two.inner_text("#verAskText")
    two.click("#verStay")                                        # 그대로 두면 초점은 고른 단추로 돌아간다
    expect(two.locator("#verRepo button[data-kind='ref']")).to_be_focused()
    two.locator("#verRepo button[data-kind='ref']").click()
    two.click("#verGo")
    two.wait_for_url(f"**ref={C1}**")
    two.wait_for_selector("#app.ready")
    two.click("#versions")
    expect(two.locator("#verDrafts li button")).to_have_count(2)
    two.click("#verClose")
    save_with_token(two)                     # 저장하면 이 창의 것만 지운다 — 다른 창·다른 때의 임시 저장본은 그대로
    wait_saved(two, hub)
    two.click("#versions")
    expect(two.locator("#verDrafts li button")).to_have_count(2)
    assert all("지금 판보다 옛 판에서 고친 것" in r for r in rows(two, "verDrafts"))   # 저장해서 판이 바뀌었다
    # 그 사이 판이 바뀐 임시 저장본을 다시 열어 저장하면, 바뀐 판을 덮어쓸지 먼저 묻는다(충돌)
    two.locator(f"#verDrafts button[data-kind='draft']:not([data-id='{r1}'])").click()   # 떠나기 전에 남긴 '또 고친 표지'
    two.wait_for_url("**draft=**")
    two.wait_for_selector("#app.ready")
    assert title_text(two) == "또 고친 표지" and "저장된 덱이 바뀌었습니다" in two.inner_text("#status")
    two.click("#versions")                   # 옛 판은 이 창이 아는 지금 판과 견준다(다시 연 저장본의 바탕 판이 아니라)
    expect(two.locator("#verDrafts li button")).to_have_count(2)
    assert all("지금 판보다 옛 판에서 고친 것" in r for r in rows(two, "verDrafts"))
    two.click("#verClose")
    save_with_token(two)
    expect(two.locator("#cfDlg")).to_be_visible()
    assert "이 임시 저장본을 고친 뒤에 저장된 덱이 바뀌었습니다" in two.inner_text("#cfText")
    assert hub.put_body()["sha"] == hub.put_body(0)["sha"]        # 임시 저장본의 바탕 판 위에 저장하려 했다
    two.click("#cfOverwrite")
    wait_saved(two, hub, 3)
    assert "또 고친 표지" in hub.saved("decks/builder.html") and "draft=" not in two.url
    two.click("#versions")
    expect(two.locator("#verDrafts li button")).to_have_count(1)   # 다시 열어 저장한 임시 저장본만 지웠다
    ctx.close()
    assert errors == []


def test_each_window_keeps_one_draft_and_paging_does_not_rewrite_it(browser, hist_site):
    base, hub = hist_site
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    # 멈춘 창(page)이 남긴 임시 저장본 — 다른 창에서 오래 고쳐도 지워지지 않는다
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("멈춘 창의 표지")
    assert page.evaluate("window.__hse.draft()") is True
    first = page.evaluate(ROWS)
    assert len(first) == 1
    two = open_page(ctx, page.url)
    for i in range(6):                                           # 고칠 때마다 남겨도 이 창의 줄 하나만 고쳐 쓴다
        select_text(two, TITLE, "시험 덱 표지" if i == 0 else f"표지 {i - 1}")
        two.keyboard.type(f"표지 {i}")
        assert two.evaluate("window.__hse.draft()") is True
    now = two.evaluate(ROWS)
    assert len(now) == 2 and first[0]["id"] in [r["id"] for r in now]
    # 장만 넘길 때는 덱을 다시 글로 만들지 않는다
    two.keyboard.press("Escape")
    assert two.evaluate("window.__hse.draft()") is True
    mine = [r for r in two.evaluate(ROWS) if r["id"] != first[0]["id"]][0]
    two.evaluate(COUNT_CLONES)
    two.evaluate("document.activeElement && document.activeElement.blur()")
    for k in ["PageDown", "PageDown", "PageUp", "PageDown", "PageUp", "PageUp", "PageDown", "PageUp"]:
        two.keyboard.press(k)
        two.wait_for_timeout(800)
    assert two.evaluate("window.__clones") == 0 and state(two)["cur"] == 0
    # 고치면 손을 멈추고 몇 초 뒤 저절로 남긴다(같은 줄)
    select_text(two, TITLE, "표지 5")
    two.keyboard.type("다시 고친 표지")
    later = wait_rows(two, lambda rs: any(r["id"] == mine["id"] and r["time"] > mine["time"] for r in rs))
    assert any(r["id"] == mine["id"] and r["time"] > mine["time"] for r in later) and len(later) == 2
    assert two.evaluate("window.__clones") >= 1
    # 이 창에서 저장하면 이 창의 줄만 지운다
    save_with_token(two)
    wait_saved(two, hub)
    assert [r["id"] for r in wait_rows(two, lambda rs: len(rs) == 1)] == [first[0]["id"]]
    # 덱마다 최근 5개 창, 같은 줄은 고쳐 쓰고, 지워진 줄 대신 새 줄, 30일 넘은 줄은 지운다
    got = two.evaluate(PRUNE)
    assert got["after6"] == [5, 4, 3, 2, 1] and got["again"] == got["ids"][5] and got["over"] == [50, 4, 3, 2, 1]
    assert got["fresh"] not in (0, got["ids"][4]) and got["later"] == [60, 50, 3, 2, 1] and got["text"] == "x"
    assert got["before"] == [99] and got["aged"] == [1] and got["other"] == [] and got["keep"] == [97]
    assert got["held"] == [5, 4, 3, 2, 1, 0] and got["trimmed"] == [6, 5, 4, 3, 2]
    assert got["spared"] is True and got["removed"] is True
    ctx.close()
    assert errors == []


def test_picking_the_oldest_draft_while_editing_keeps_it(browser, hist_site):
    base, hub = hist_site
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    ids = page.evaluate(PLANT, [KEY, 5])                         # 다른 창들이 남긴 5개 — 덱마다 두는 수만큼
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("이 창의 표지")
    page.click("#versions")
    expect(page.locator("#verDrafts li button")).to_have_count(5)
    page.locator(f"#verDrafts button[data-id='{ids[0]}']").click()   # 가장 옛것
    page.click("#verGo")                 # 떠나기 전에 이 창의 고침을 새 줄로 남겨도, 고른 옛 줄은 정리하지 않는다
    page.wait_for_url(f"**draft={ids[0]}**")
    page.wait_for_selector("#app.ready")
    assert title_text(page) == "창 1 의 표지" and len(page.evaluate(ROWS)) == 6
    expect(page.locator("#status")).to_contain_text("이보다 나중에 남긴 임시 저장본도 있습니다")
    # 다시 연 줄을 그 뒤 다른 창이 고쳐 썼으면, 이 창에서 저장해도 그 줄은 지우지 않는다(그 창의 고침)
    page.evaluate(REWRITE, [KEY, ids[0]])
    save_with_token(page)
    wait_saved(page, hub)
    assert page.evaluate("window.__hse.draft()") is False         # 저장 뒤 지우기가 끝날 때까지
    assert ids[0] in [r["id"] for r in page.evaluate(ROWS)]
    ctx.close()
    assert errors == []


def test_edits_made_while_saving_keep_their_draft(browser, hist_site):
    base, hub = hist_site
    hub.hold = True
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("저장할 표지")
    page.keyboard.press("Escape")
    assert page.evaluate("window.__hse.draft()") is True
    mine = page.evaluate(ROWS)[0]["id"]
    save_with_token(page)
    page.wait_for_function("window.__hse.state().saving")
    select_text(page, TITLE, "저장할 표지")
    page.keyboard.type("저장하는 사이 고친 표지")
    page.keyboard.press("Escape")
    assert page.evaluate("window.__hse.draft()") is True          # 저장하는 사이에도 이 창의 줄에 남긴다
    hub.release()
    wait_saved(page, hub)
    assert "저장할 표지" in hub.saved("decks/builder.html") and state(page)["dirty"] is True
    # 저장이 끝나도 그 사이 고친 것은 이 창의 줄에 그대로 남는다(지웠다가 몇 초 동안 비지 않게) — 바탕 판은 방금 저장한 판
    assert page.evaluate("window.__hse.draft()") is True and [r["id"] for r in page.evaluate(ROWS)] == [mine]
    assert "저장하는 사이 고친 표지" in page.evaluate(TEXT_OF, mine)
    page.click("#versions")
    expect(page.locator("#verDrafts li button")).to_have_count(1)
    assert "옛 판에서 고친 것" not in rows(page, "verDrafts")[0]
    page.click("#verClose")
    # 더 고친 것 없이 다시 저장하면 그 줄을 지운다
    save_with_token(page)
    wait_saved(page, hub, 2)
    assert wait_rows(page, lambda rs: rs == []) == []
    ctx.close()
    assert errors == []


def test_a_stuck_browser_store_does_not_stop_the_editor(browser, hist_site):
    base, hub = hist_site
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(HANG_IDB)
    ctx.route("https://api.github.com/**", hub)
    errors: list[str] = []
    page = ctx.new_page()
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    began = time.monotonic()
    page.goto(f"{base}editor/?deck={quote('builder')}")
    page.wait_for_selector("#app.ready", timeout=60000)          # 임시 저장본 목록을 기다리다 멈추지 않는다
    assert time.monotonic() - began < 5.0                         # 알림만 건너뛰고(BOOT_WAIT) 열기 한도(6초)까지 기다리지 않는다
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("멈춘 저장소의 표지")
    page.click("#versions")
    expect(page.locator("#verDrafts li")).to_have_text(["임시 저장본이 없습니다."], timeout=30000)
    page.locator("#verRepo button[data-kind='ref']").click()
    page.click("#verGo")
    expect(page.locator("#verGo")).to_be_disabled()
    page.keyboard.press("Escape")                                # 남기는 동안에는 Esc 로 창이 닫히지 않는다
    assert page.evaluate("document.getElementById('verDlg').open") is True
    expect(page.locator("#verAskText")).to_contain_text("이 브라우저에 남기지 못했습니다", timeout=40000)
    expect(page.locator("#verGo")).to_have_text("고침을 버리고 불러오기")
    page.click("#verGo")                                         # 버리기로 하면 남기기를 기다리지 않고 떠난다
    page.wait_for_url(f"**ref={C1}**", timeout=10000)
    page.wait_for_selector("#app.ready", timeout=60000)
    assert title_text(page) == "옛 표지"
    ctx.close()
    assert errors == []


def test_leaving_writes_the_draft_again_even_if_it_was_removed(browser, hist_site):
    base, hub = hist_site
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("지워질 표지")
    page.keyboard.press("Escape")
    assert page.evaluate("window.__hse.draft()") is True
    page.evaluate(CLEAR_DRAFTS)                     # 이 창이 남긴 줄이 그 사이 사라졌다(다른 창이 정리하는 등)
    page.click("#versions")
    expect(page.locator("#verDrafts li")).to_have_text(["임시 저장본이 없습니다."])
    page.locator("#verRepo button[data-kind='ref']").click()
    page.click("#verGo")                            # 떠나기 전에는 마지막으로 남긴 것과 같아도 다시 쓴다
    page.wait_for_url(f"**ref={C1}**")
    page.wait_for_selector("#app.ready")
    page.click("#versions")
    expect(page.locator("#verDrafts li button")).to_have_count(1)
    page.locator("#verDrafts button[data-kind='draft']").click()
    page.wait_for_url("**draft=**")
    page.wait_for_selector("#app.ready")
    assert title_text(page) == "지워질 표지"
    ctx.close()
    assert errors == []


def test_leaving_asks_again_when_the_draft_cannot_be_kept(browser, hist_site):
    base, hub = hist_site
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(NO_IDB)
    ctx.route("https://api.github.com/**", hub)
    errors: list[str] = []
    page = ctx.new_page()
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(f"{base}editor/?deck={quote('builder')}")
    page.wait_for_selector("#app.ready", timeout=60000)
    select_text(page, TITLE, "시험 덱 표지")
    page.keyboard.type("남기지 못할 표지")
    page.click("#versions")
    page.locator("#verRepo button[data-kind='ref']").click()
    page.click("#verGo")
    expect(page.locator("#verAskText")).to_contain_text("이 브라우저에 남기지 못했습니다")
    expect(page.locator("#verGo")).to_have_text("고침을 버리고 불러오기")
    expect(page.locator("#verGo")).to_be_enabled()
    assert "ref=" not in page.url and title_text(page) == "남기지 못할 표지"    # 아직 떠나지 않았다
    page.click("#verGo")                                         # 버리기로 하면 묻지 않고 떠난다
    page.wait_for_url(f"**ref={C1}**")
    page.wait_for_selector("#app.ready")
    assert title_text(page) == "옛 표지"
    ctx.close()
    assert errors == []


def test_versions_wait_while_saving(browser, hist_site):
    base, hub = hist_site
    hub.hold = True
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.click("#add")
    save_with_token(page)
    page.wait_for_function("window.__hse.state().saving")
    expect(page.locator("#versions")).to_be_disabled()           # 저장하는 사이 다른 판으로 떠나 저장이 끊기지 않게
    hub.release()
    wait_saved(page, hub)
    expect(page.locator("#versions")).to_be_enabled()
    ctx.close()
    assert errors == []


def test_a_version_that_cannot_open_is_dropped_from_the_address(browser, hist_site):
    base, hub = hist_site
    hub.history["decks/builder.html"].append((C0, "2026-10-01T09:00:00Z", "chore: 덱이 아닌 판", NOT_DECK))
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.goto(f"{page.url}&ref={C0}")
    page.wait_for_selector("#fail:not([hidden])")
    assert "새로 고치면 지금 판을 엽니다" in page.inner_text("#failMsg") and "ref=" not in page.url
    page.reload()
    page.wait_for_selector("#app.ready")
    assert title_text(page) == "시험 덱 표지"
    ctx.close()
    assert errors == []


def test_local_backups_reopen_the_file_before_editing(browser, local_edit):
    e = local_edit
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(e.url)
    page.wait_for_selector("#app.ready", timeout=60000)
    first = e.deck.read_bytes()
    page.click("#versions")
    expect(page.locator("#verRepoH")).to_have_text("이 PC 의 저장 전 판")
    expect(page.locator("#verRepo li")).to_have_text(["저장 전 판이 아직 없습니다 — 처음 저장할 때 생깁니다."])
    page.keyboard.press("Escape")
    page.click("#add")
    page.keyboard.press("Control+s")
    wait_file(page, e.deck, first)
    page.click("#versions")
    expect(page.locator("#verRepo li button")).to_have_count(1)
    assert "고치기 시작하기 전의 판" in rows(page, "verRepo")[0]
    page.locator("#verRepo button[data-kind='backup']").click()
    page.wait_for_url("**backup=**")
    page.wait_for_selector("#app.ready")
    assert state(page)["n"] == 3 and state(page)["dirty"] is True        # 장을 더하기 전의 판
    saved = e.deck.read_bytes()
    page.keyboard.press("Control+s")
    back = wait_file(page, e.deck, saved)
    assert back.decode("utf-8").count('<section class="slide') == 3 and "backup=" not in page.url
    ctx.close()
    assert errors == []
