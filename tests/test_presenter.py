"""발표자 보기(editor/presenter.html) — 지금 장·다음 장·노트·시간을 보이고, 청중 화면 창을 함께 넘기고 따라간다.
브라우저(Playwright)로 눌러 본다. 사이트 틀은 test_editor.py 의 make_site·serve."""
from urllib.parse import quote

import pytest
from playwright.sync_api import expect

from test_editor import (  # noqa: F401 — browser·serve 는 fixture
    BUILDER, FLOW, QUIET, DeckHub, browser, make_site, open_editor, serve,
)

# 덱 스크립트가 __deck 없이 주소의 #번호(hashchange)로만 넘기는 덱
HASHED = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>번호 덱</title>
<style>.slide{display:none;width:1280px;height:720px}.slide.on{display:block}</style></head><body>
<div class="deck"><section class="slide on" data-notes="하나 노트"><h2>하나</h2></section>
<section class="slide" data-notes="둘 &lt;b&gt;노트&lt;/b&gt;
  &lt;ul&gt;
    &lt;li&gt;가는
      글&lt;/li&gt;
    &lt;li&gt;나&lt;/li&gt;
  &lt;/ul&gt;"><h2>둘</h2></section>
<section class="slide" data-notes="셋 R&amp;amp;D 노트"><h2>셋</h2></section></div>
<script>(function(){ var s=[].slice.call(document.querySelectorAll('.slide')), i=0;
function go(n){ i=Math.max(0,Math.min(s.length-1,n)); s.forEach(function(e,k){ e.classList.toggle('on',k===i); });
  history.replaceState(null,'','#'+(i+1)); }
addEventListener('hashchange', function(){ var n=parseInt(location.hash.slice(1),10)-1; if(n===n && n!==i) go(n); });
addEventListener('keydown', function(e){ if(e.key==='ArrowRight') go(i+1); if(e.key==='ArrowLeft') go(i-1); });
var h=parseInt(location.hash.slice(1),10); go(h===h ? h-1 : 0); })();</script></body></html>"""

# 바깥에서 넘길 길이 없는 덱 — 제 창의 방향키로만 넘긴다
STUCK = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>고집 덱</title>
<style>.slide{display:none;width:1280px;height:720px}.slide.on{display:block}</style></head><body>
<div class="deck"><section class="slide on"><h2>가</h2></section><section class="slide"><h2>나</h2></section>
<section class="slide"><h2>다</h2></section></div>
<script>(function(){ var s=[].slice.call(document.querySelectorAll('.slide')), i=0;
function go(n){ i=Math.max(0,Math.min(s.length-1,n)); s.forEach(function(e,k){ e.classList.toggle('on',k===i); }); }
addEventListener('keydown', function(e){ if(e.key==='ArrowRight') go(i+1); if(e.key==='ArrowLeft') go(i-1); });
})();</script></body></html>"""

# 넘길 때 주소를 제 꼴(#/번호)로 적는 덱 — 발표자 창이 그 주소를 #번호로 덮지 않아야 한다
OWNHASH = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>제 주소 덱</title>
<style>.slide{display:none;width:1280px;height:720px}.slide.on{display:block}</style></head><body>
<div class="deck"><section class="slide on"><h2>가</h2></section><section class="slide"><h2>나</h2></section>
<section class="slide"><h2>다</h2></section></div>
<script>(function(){ var s=[].slice.call(document.querySelectorAll('.slide')), i=0;
function go(n){ i=Math.max(0,Math.min(s.length-1,n)); s.forEach(function(e,k){ e.classList.toggle('on',k===i); });
  history.replaceState(null,'','#/'+(i+1)); }
window.__deck={go:go, count:s.length, cur:function(){ return i; }};
})();</script></body></html>"""

# <base> 가 다른 폴더를 가리키는 덱 — 청중 화면 주소의 #번호를 고칠 때 경로가 그 폴더로 바뀌면 발표자 창이 덱을 놓친다
BASED = BUILDER.replace('<meta charset="utf-8">', '<meta charset="utf-8"><base href="sub/">', 1)

# 장이 1600×900 인 덱 — 미리보기는 덱의 장 크기로 그려야 한다
WIDE = HASHED.replace("width:1280px;height:720px", "width:1600px;height:900px")

# 장이 서른인 덱 — 좁은 화면에서 아래 장 줄이 가로로 넘친다
MANY = ('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>긴 덱</title>'
        '<style>.slide{display:none;width:1280px;height:720px}.slide.on{display:block}</style></head><body><div class="deck">'
        + "".join(f'<section class="slide{" on" if k == 0 else ""}"><h2>{k + 1}번째 장 제목</h2></section>' for k in range(30))
        + "</div></body></html>")


@pytest.fixture
def site(tmp_path, serve):
    out, root = make_site(tmp_path, {"builder.html": BUILDER, "flow.html": FLOW, "hashed.html": HASHED, "stuck.html": STUCK,
                                     "wide.html": WIDE, "many.html": MANY,
                                     "ownhash.html": OWNHASH, "based.html": BASED})
    return serve(out), root


def open_presenter(browser, base: str, deck: str | None, viewport: dict | None = None):
    ctx = browser.new_context(viewport=viewport or {"width": 1400, "height": 900})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(f"{base}editor/presenter.html" + (f"?deck={quote(deck)}" if deck is not None else ""))
    page.wait_for_selector("#app.ready, #fail:not([hidden])", timeout=60000)
    return ctx, page, errors


def pstate(page) -> dict:
    return page.evaluate("window.__hsp.state()")


def on_index(win) -> int:
    """청중 화면 덱의 지금 장(0부터)."""
    return win.evaluate("[...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('on'))")


def preview(page, which: str) -> int:
    """미리보기 iframe 에 보이는 장(0부터) — 편집기처럼 장마다 숨김 표시를 단다."""
    return page.frame_locator(f"#{which}Frame").locator("body").evaluate(
        "(b) => [...b.ownerDocument.querySelectorAll('section.slide')].findIndex((s) => getComputedStyle(s).display !== 'none')")


def open_audience(page):
    with page.expect_popup() as info:
        page.click("#audBtn")
    pop = info.value
    pop.wait_for_load_state()
    expect(page.locator("#audState")).to_have_text("청중 화면 연결됨", timeout=10000)
    return pop


def test_presenter_shows_now_next_notes_and_moves(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "builder")
    assert page.inner_text("#pos") == "1 / 3" and page.inner_text("#nowTitle") == "표지"
    assert page.inner_text("#nextTitle") == "둘째" and page.inner_text("#notes") == "첫 장 노트"
    assert (preview(page, "now"), preview(page, "next")) == (0, 1)
    assert pstate(page)["running"] is False and page.is_disabled("#prev")
    page.keyboard.press("ArrowRight")                      # 처음 넘기면 시간 재기가 저절로 시작된다
    assert page.inner_text("#pos") == "2 / 3" and page.inner_text("#notes") == "둘째 장 노트 <b>"   # 빌더 노트는 글 그대로
    assert (preview(page, "now"), preview(page, "next")) == (1, 2) and pstate(page)["running"] is True
    page.keyboard.press("End")
    assert page.inner_text("#pos") == "3 / 3" and page.locator("#endNote").is_visible() and page.is_disabled("#next")
    page.keyboard.press("1")                               # 숫자를 치고 Enter — 그 장으로
    page.keyboard.press("Enter")
    assert page.inner_text("#pos") == "1 / 3"
    page.locator("#strip button[data-i='2']").click()      # 아래 줄의 장 이름을 누르면 그 장
    assert page.inner_text("#pos") == "3 / 3" and page.locator("#strip button.cur").get_attribute("data-i") == "2"
    page.keyboard.press("t")                               # T 멈춤 → 시간이 서 있다
    assert pstate(page)["running"] is False
    stopped = pstate(page)["elapsed"]
    page.wait_for_timeout(300)
    assert pstate(page)["elapsed"] == stopped
    size = page.evaluate("parseFloat(document.getElementById('notes').style.fontSize)")
    page.keyboard.press("+")
    assert page.evaluate("parseFloat(document.getElementById('notes').style.fontSize)") == size + 2
    page.fill("#goal", "20")
    page.dispatch_event("#goal", "change")
    page.reload()                                         # 목표 시간·노트 글자 크기는 이 브라우저에 남는다
    page.wait_for_selector("#app.ready")
    assert page.input_value("#goal") == "20" and page.inner_text("#remain").startswith("20:00")
    assert page.evaluate("parseFloat(document.getElementById('notes').style.fontSize)") == size + 2
    ctx.close()
    assert errors == []


def test_presenter_drives_the_audience_window_and_follows_it(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "builder")
    page.keyboard.press("ArrowRight")                      # 열기 전에 넘긴 장으로 청중 화면이 맞춰진다
    pop = open_audience(page)
    assert pop.evaluate("window.opener") is None          # 덱 스크립트가 발표자 창을 건드리지 못한다
    page.wait_for_timeout(400)
    assert on_index(pop) == 1
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(100)
    assert on_index(pop) == 2 and pop.evaluate("location.hash") == "#3"   # 주소의 #번호도 — 청중 화면을 새로 고쳐도 그 장
    pop.evaluate("__deck.go(0)")                           # 청중 화면에서 넘기면 발표자 창이 따라간다
    expect(page.locator("#pos")).to_have_text("1 / 3")
    page.keyboard.press("b")                               # 검은 화면 — 넘기면 걷힌다
    assert pop.locator("#hs-presenter-black").count() == 1 and page.get_attribute("#black", "aria-pressed") == "true"
    page.keyboard.press("ArrowRight")
    assert pop.locator("#hs-presenter-black").count() == 0 and page.get_attribute("#black", "aria-pressed") == "false"
    pop.close()
    expect(page.locator("#audState")).to_have_text("청중 화면 닫힘")
    assert pstate(page)["aud"] is False
    ctx.close()
    assert errors == []


def test_presenter_uses_the_address_number_when_the_deck_has_no_api(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "hashed")
    assert page.inner_text("#notes") == "하나 노트"
    pop = open_audience(page)
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    assert on_index(pop) == 2 and page.inner_text("#pos") == "3 / 3"
    assert page.inner_text("#notes") == "셋 R&D 노트"      # 태그 없는 흐름 덱 노트도 HTML — &amp; 는 글자로
    page.keyboard.press("ArrowLeft")
    assert page.inner_text("#notes") == "둘 노트\n가는 글\n나"   # 태그를 쓰는 흐름 덱 노트는 글만 — 소스의 줄바꿈은 빈칸, 항목은 줄마다
    page.wait_for_timeout(400)
    assert on_index(pop) == 1 and pstate(page)["manual"] is False
    ctx.close()
    assert errors == []


def test_presenter_follows_a_deck_it_cannot_drive(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "stuck")
    pop = open_audience(page)
    page.keyboard.press("ArrowRight")                      # 청중 화면이 따라오지 않으면 알리고 따라가기만 한다
    expect(page.locator("#audState")).to_have_text("청중 화면은 직접 넘김", timeout=5000)
    assert "직접 넘기세요" in page.inner_text("#status") and pstate(page)["manual"] is True
    expect(page.locator("#pos")).to_have_text("1 / 3")
    pop.bring_to_front()
    pop.keyboard.press("ArrowRight")
    pop.keyboard.press("ArrowRight")
    expect(page.locator("#pos")).to_have_text("3 / 3")
    ctx.close()
    assert errors == []


def test_presenter_previews_use_the_deck_slide_size(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "wide")
    sizes = page.evaluate("['nowFrame', 'nextFrame'].map((id) => { const f = document.getElementById(id); return [f.style.width, f.style.height]; })")
    assert sizes == [["1600px", "900px"], ["1600px", "900px"]]   # 숨긴 틀에서 재면 1280×720 으로 떨어져 오른쪽이 잘린다
    ctx.close()
    assert errors == []


def test_presenter_keys_survive_clicked_buttons_and_fields(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "builder")
    page.keyboard.press("End")
    page.click("#prev")                                    # 마우스로 누른 단추는 초점을 놓는다 — 다음 Space 가 그 단추를 다시 누르지 않게
    assert page.inner_text("#pos") == "2 / 3" and page.evaluate("document.activeElement === document.body")
    page.keyboard.press("Space")
    assert page.inner_text("#pos") == "3 / 3"
    page.keyboard.press("Shift+Space")                     # Shift+Space 는 앞 장
    assert page.inner_text("#pos") == "2 / 3"
    page.focus("#prev")                                    # 키보드로 고른 단추: 숫자+Enter 는 그 장으로, Space 는 그 단추
    page.keyboard.press("3")
    page.keyboard.press("Enter")
    assert page.inner_text("#pos") == "3 / 3"
    page.keyboard.press("Space")
    assert page.inner_text("#pos") == "2 / 3"
    page.click("#goal")                                    # 목표 시간 칸은 Enter 로 마치면 칸을 놓는다 — 그 뒤 ← 가 다시 넘긴다
    page.keyboard.type("15")
    page.keyboard.press("Enter")
    assert page.evaluate("document.activeElement !== document.getElementById('goal')")
    assert page.evaluate("localStorage.getItem('hs:presenter:goal:builder')") == "15"
    page.keyboard.press("ArrowLeft")
    assert page.inner_text("#pos") == "1 / 3"
    page.click("#jump")                                    # 장 번호 칸에 쓰는 중에도 PageDown(발표 리모컨)은 넘긴다
    page.keyboard.type("3")
    page.keyboard.press("PageDown")
    assert page.inner_text("#pos") == "2 / 3"
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ㅜ', code: 'KeyN', bubbles: true}))")
    assert page.inner_text("#pos") == "3 / 3"              # 한글 자판의 N 자리 — 글자 키는 자판 자리로 본다
    assert errors == []
    page.focus("a.back")                                   # 키보드로 고른 링크의 Enter 는 링크의 것(갤러리로)
    with page.expect_navigation():
        page.keyboard.press("Enter")
    assert page.url == base
    ctx.close()


def test_presenter_previews_run_no_deck_script(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "flow")
    page.keyboard.press("ArrowRight")                      # 둘째 장에는 덱 스크립트가 글을 채우는 칸(#chart-a)이 있다
    got = page.frame_locator("#nowFrame").locator("body").evaluate(
        "(b) => [b.ownerDocument.getElementById('chart-a').textContent, typeof b.ownerDocument.defaultView.__deck]")
    assert got == ["", "undefined"] and page.get_attribute("#nowFrame", "sandbox") == "allow-same-origin"
    # 미리보기 안으로는 Tab 도 들어가지 않는다(들어가면 키가 그 문서로 가 넘기기가 멈춘다)
    assert page.evaluate("['nowFrame', 'nextFrame'].every((id) => document.getElementById(id).inert)")
    ctx.close()
    assert errors == []


def test_presenter_reload_reuses_the_audience_window_and_lifts_black(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "builder")
    pop = open_audience(page)
    page.keyboard.press("b")
    assert pop.locator("#hs-presenter-black").count() == 1
    pop.evaluate("window.__same = 1")
    page.reload()                                          # 발표자 창을 새로 고쳐도 청중 화면 창은 남는다(검은 판도)
    page.wait_for_selector("#app.ready")
    page.click("#audBtn")                                  # 같은 이름의 창을 다시 쓴다 — 남은 검은 판을 걷고 다시 맞춘다
    expect(page.locator("#audState")).to_have_text("청중 화면 연결됨", timeout=10000)
    assert len(ctx.pages) == 2 and pop.evaluate("window.__same") == 1   # 새 창이 아니고, 덱을 다시 불러오지도 않았다
    assert pop.locator("#hs-presenter-black").count() == 0
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(100)
    assert on_index(pop) == 1
    ctx.close()
    assert errors == []


def test_presenter_reload_keeps_the_slide_and_time_and_follows_the_audience(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "builder")
    pop = open_audience(page)
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(500)
    assert on_index(pop) == 2 and pstate(page)["running"] is True
    page.reload()                                          # 발표 중 새로 고침(리모컨의 F5 등) — 지금 장·시간은 이 탭에서 이어진다
    page.wait_for_selector("#app.ready")
    st = pstate(page)
    assert page.inner_text("#pos") == "3 / 3" and st["running"] is True and st["elapsed"] >= 500
    pop.evaluate("__deck.go(1)")                           # 그 사이 청중 화면을 직접 넘겼다
    page.click("#audBtn")                                  # 다시 쓰는 청중 화면 창은 그 창의 장을 따른다(첫 장으로 뛰지 않는다)
    expect(page.locator("#audState")).to_have_text("청중 화면 연결됨", timeout=10000)
    expect(page.locator("#pos")).to_have_text("2 / 3")
    page.wait_for_timeout(400)
    assert on_index(pop) == 1 and len(ctx.pages) == 2
    ctx.close()
    assert errors == []


def test_presenter_leaves_a_deck_own_address_alone(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "ownhash")
    pop = open_audience(page)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(300)
    assert on_index(pop) == 1 and pop.evaluate("location.hash") == "#/2"   # 덱이 제 꼴로 적은 주소는 #번호로 덮지 않는다
    ctx.close()
    assert errors == []


def test_presenter_keeps_the_audience_path_with_a_base_tag(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "based")
    pop = open_audience(page)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(300)
    where = pop.evaluate("[location.pathname, location.hash]")
    assert on_index(pop) == 1 and where[0].endswith("/decks/based.html") and where[1] == "#2"
    page.keyboard.press("ArrowRight")                      # 경로가 그대로라 계속 넘기고 읽는다
    page.wait_for_timeout(400)
    assert on_index(pop) == 2 and page.inner_text("#audState") == "청중 화면 연결됨"
    ctx.close()
    assert errors == []


def test_presenter_narrow_screen_keeps_the_page_still(browser, site):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, "many", {"width": 800, "height": 700})
    page.keyboard.press("End")                             # 좁은 화면 — 넘겨도 페이지는 그대로(지금 장이 화면 밖으로 밀리지 않게)
    assert page.inner_text("#pos") == "30 / 30" and page.evaluate("scrollY") == 0
    seen = page.evaluate("""() => { const s = document.getElementById('strip'), b = s.querySelector('button.cur');
      const a = b.getBoundingClientRect(), r = s.getBoundingClientRect();
      return [s.scrollLeft > 0, a.left >= r.left - 1 && a.right <= r.right + 1]; }""")
    assert seen == [True, True]                            # 아래 장 줄은 제 안에서 가로로 움직여 지금 장을 보인다
    page.locator("#strip button[data-i='3']").click()
    assert page.inner_text("#pos") == "4 / 30"
    ctx.close()
    assert errors == []


@pytest.mark.parametrize("deck,text", [(None, "고르지 않았습니다"), ("nope", "목록에 없는 덱")])
def test_presenter_refuses_missing_decks(browser, site, deck, text):
    base, root = site
    ctx, page, errors = open_presenter(browser, base, deck)
    assert page.locator("#fail").is_visible() and text in page.inner_text("#failMsg")
    ctx.close()


def test_editor_and_gallery_link_to_the_presenter(browser, site):
    base, root = site
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    assert page.get_attribute("#presenter", "href").endswith("presenter.html?deck=builder")
    ctx.close()
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(base)
    page.wait_for_selector(".card")
    link = page.locator("a[data-act='presenter']").first
    assert link.count() == 1 and "editor/presenter.html?deck=" in link.get_attribute("href")
    ctx.close()
