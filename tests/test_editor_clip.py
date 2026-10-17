"""덱 편집기 — 시스템 클립보드로 복사·붙여 넣기(덱 공통 꼴, editor/js/deckclip.js).
상자를 복사하면 다른 페이지(다른 덱·다른 편집기)와 다른 프로그램이 받는 셋(글·서식 있는 글·덱 페이로드)이 클립보드에 들고,
다른 꼴 덱(빌더 ↔ 흐름)에 붙이면 그 덱의 상자로 바뀌며, 바깥에서 꾸민 페이로드는 걸러진다.
창 없는 브라우저는 OS 클립보드 대신 브라우저 안의 클립보드를 쓴다(같은 브라우저 문맥의 페이지끼리 공유) — PowerPoint·Word·한글에
붙이기는 공통 모듈 쪽 시험(창 있는 브라우저 + 실제 Windows 클립보드)이 본다."""
import json
from urllib.parse import quote

from test_editor import (  # noqa: F401 — browser·serve·decks 는 fixture
    QUIET, browser, decks, frame, open_editor, pw, serve, state,
)

MIME = "application/x-deckclip+json"
# 붙여 넣기를 받아 적기만 하는 페이지(다른 덱·다른 프로그램 자리)
RECORDER = """<!doctype html><meta charset="utf-8"><div id="r" contenteditable="true" style="width:300px;height:80px">받는 곳</div>
<script>window.PT = null; addEventListener('paste', (e) => { const d = e.clipboardData; window.PT = {types: [...d.types],
  html: d.getData('text/html'), plain: d.getData('text/plain'), mime: d.getData('application/x-deckclip+json')};
  e.preventDefault(); }, true);</script>"""


def received(ctx) -> dict:
    rec = ctx.new_page()
    rec.set_content(RECORDER)
    rec.click("#r")
    rec.keyboard.press("Control+v")
    rec.wait_for_function("window.PT !== null")
    pt = rec.evaluate("window.PT")
    rec.close()
    return pt


def open_also(ctx, base: str, deck_id: str):
    """같은 브라우저 문맥(같은 클립보드)에 편집기를 하나 더 — open_editor 의 경로 가로채기를 그대로 쓴다."""
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(f"{base}editor/?deck={quote(deck_id)}")
    page.wait_for_selector("#app.ready", timeout=60000)
    return page, errors


def paste_crafted(page, payload: dict) -> None:
    """바깥(다른 사이트의 페이지 등)이 꾸며 클립보드에 둔 페이로드를 붙여 넣는 것과 같은 붙여 넣기 이벤트를 덱 문서에 낸다."""
    page.frame_locator("#frame").locator("body").evaluate("""(b, p) => {
        const dt = new DataTransfer();
        dt.setData('application/x-deckclip+json', JSON.stringify(p));
        dt.setData('text/plain', 'x');
        b.ownerDocument.body.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    }""", payload)


def item(**kw) -> dict:
    return {"x": 100, "y": 120, "w": 400, "h": 90, "text": "", "name": "x", **kw}


def test_box_copy_writes_deck_payload_and_office_html(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    f = frame(page)
    f.locator("section.slide").nth(1).locator("[data-name=body] p").first.click()
    page.keyboard.press("Escape")                          # 글 고치기를 마치면 Ctrl+C 는 상자를 복사한다
    page.keyboard.press("Control+c")
    assert state(page)["clip"] and not page.is_disabled("#boxPaste")
    pt = received(ctx)
    assert MIME in pt["types"] and "text/html" in pt["types"] and "text/plain" in pt["types"]
    p = json.loads(pt["mime"])
    assert p["app"] == "deckclip" and p["src"]["editor"] == "html-slides" and p["stage"] == {"w": 1280, "h": 720}
    it = p["items"][0]
    assert it["type"] == "text" and it["native"]["fmt"] == "deck-el/1" and 'class="el tx"' in it["native"]["html"]
    assert (it["x"], it["y"], it["w"], it["h"]) == (64, 160, 1100, 200)
    assert "contenteditable" not in it["native"]["html"] and "contenteditable" not in it["html"]   # 편집 표시는 뗀다
    assert pt["plain"] == "첫 문단\n둘째 문단"
    # 다른 프로그램이 받는 HTML — 문서 꼴(PowerPoint 가 글자 크기를 그대로 받는다) + 맨 앞 주석에 페이로드.
    # 글 항목은 PowerPoint 만 읽는 VML 글상자([if ppt])로도 싣는다 — 960pt 슬라이드 비율의 자리·너비, 줄 바꿈, 위 정렬
    h = pt["html"]
    assert h.startswith('<html xmlns:v="urn:schemas-microsoft-com:vml"')
    assert '><head><meta charset="utf-8"></head><body><!--deckclip:v2:' in h
    assert ('<!--[if ppt]><v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;left:48pt;top:120pt;'
            'width:825pt;height:150pt;v-text-anchor:top;mso-wrap-style:square"') in h
    assert "<![if !ppt]>" in h and "font-size:24px" in h and "첫 문단" in h
    ctx.close()
    assert errors == []


def test_copy_button_uses_the_system_clipboard(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    frame(page).locator("section.slide").nth(1).locator("svg.el").click()
    page.click("#boxCopy")
    pt = received(ctx)
    p = json.loads(pt["mime"])
    it = p["items"][0]
    assert it["type"] == "graphic" and it["native"]["fmt"] == "deck-el/1"
    assert "<svg" in it["html"] and "marker" in it["html"]
    ctx.close()
    assert errors == []


def test_text_being_edited_copies_as_text(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    f = frame(page)
    f.locator("section.slide").nth(1).locator("[data-name=body] p").first.click()
    page.keyboard.press("Home")
    page.keyboard.press("Shift+End")                       # 글을 고르는 중 — 상자가 아니라 고른 글을 복사한다
    page.keyboard.press("Control+c")
    pt = received(ctx)
    assert MIME not in pt["types"] and pt["plain"] == "첫 문단"
    ctx.close()
    assert errors == []


def test_builder_text_box_into_flow_deck_and_back(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    flow, errors2 = open_also(ctx, base, "flow")
    page.bring_to_front()
    page.keyboard.press("PageDown")
    frame(page).locator("section.slide").nth(1).locator("[data-name=body] p").first.click()
    page.keyboard.press("Escape")
    page.keyboard.press("Control+c")
    # 흐름 덱 — 장 위에 절대 배치한 글상자(div[data-hs-box] > p)로, 같은 자리·같은 글자 모양
    flow.bring_to_front()
    flow.keyboard.press("PageDown")
    flow.keyboard.press("Escape")
    undo = state(flow)["undo"]
    flow.keyboard.press("Control+v")
    fb = flow.frame_locator("#frame").locator("section.slide").nth(1).locator(":scope > [data-hs-box]")
    assert fb.count() == 1 and state(flow)["undo"] == undo + 1 and state(flow)["sel"] == 1
    assert fb.locator(":scope > p").all_inner_texts() == ["첫 문단", "둘째 문단"]
    assert fb.evaluate("(e) => [e.style.position, e.style.left, e.style.top, e.style.width]") == ["absolute", "64px", "160px", "1100px"]
    assert fb.locator(":scope > p").first.evaluate("(e) => e.style.fontSize") == "24px"
    # 흐름 덱의 글상자를 빌더 덱에 — 빌더 상자 꼴(.el.tx > .tin > p.pp)로
    fb.locator(":scope > p").first.click()
    flow.keyboard.press("Escape")
    flow.keyboard.press("Control+c")
    page.bring_to_front()
    page.keyboard.press("PageDown")                        # 셋째 장
    page.keyboard.press("Escape")
    page.keyboard.press("Control+v")
    nb = frame(page).locator("section.slide").nth(2).locator(":scope > .el.tx").last
    assert nb.locator(".tin > p.pp").all_inner_texts() == ["첫 문단", "둘째 문단"]
    assert nb.locator(".tin > p.pp").first.evaluate("(e) => e.style.fontSize") == "24px"
    assert state(page)["box"] == {"x": 80, "y": 176, "w": 1100, "h": 200}  # 셋째 장의 표가 그 자리(64, 160)에 있어 비켜서
    ctx.close()
    assert errors == [] and errors2 == []


def test_crafted_payload_is_filtered(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    page.keyboard.press("Escape")
    evil_native = ('<div class="el tx" data-name="evil" data-mw="widget" onclick="window.parent.__pwned=1" '
                   'style="left:1px;top:1px;width:10px;height:10px"><div class="tin"><p class="pp">고유 꼴<img src="x" '
                   'onerror="window.parent.__pwned=2"></p></div><script>window.parent.__pwned=3</script></div>')
    # 고유 꼴로 그대로 들어가되 바깥 그림을 부르는 서식(image-set)·덱 짜임 클래스(slide·on)는 빠져야 한다
    struct_native = ('<div class="el tx" data-name="n2" style="left:1px;top:1px;width:10px;height:10px;'
                     "background-image:image-set('https://example.com/y.png' 1x)\"><div class=\"tin\"><p class=\"pp\">구조"
                     '<span class="slide on">유령</span></p></div></div>')
    evil_html = ('<div style="color:red;background:url(https://example.com/x.png);'
                 "cursor:image-set('https://example.com/z.png' 1x), auto\" "
                 'onmouseover="window.parent.__pwned=4">'
                 '<p>바깥 글<a href="javascript:window.parent.__pwned=5">링크</a></p><iframe src="https://example.com/"></iframe></div>')
    payload = {"app": "deckclip", "v": 2, "id": "evil1", "src": {"editor": "x", "title": "x", "session": "zz"},
               "stage": {"w": 1280, "h": 720}, "blobs": {}, "text": "x", "t": 0,
               "items": [item(type="text", html=evil_html, native={"fmt": "deck-el/1", "html": evil_native}),
                         item(type="text", y=300, html=evil_html),
                         item(type="text", y=500, html=evil_html, native={"fmt": "deck-el/1", "html": struct_native})]}
    undo = state(page)["undo"]
    paste_crafted(page, payload)
    s2 = frame(page).locator("section.slide").nth(1)
    added = s2.locator(":scope > .el.tx").evaluate_all("(es) => es.slice(-3).map((e) => e.outerHTML)")
    assert state(page)["undo"] == undo + 1 and len(added) == 3
    joined = " ".join(added).lower()
    for bad in ("onclick", "onerror", "onmouseover", "<script", "javascript:", "data-mw", "<iframe", "url(", "<img", "image-set",
                "example.com", 'class="slide', " on\""):
        assert bad not in joined, (bad, joined)
    # 고유 꼴은 그림이 빠져(주소가 바깥) 혼자 서는 꼴로 — 글은 남는다
    assert "바깥 글" in added[0] and "링크" in added[0] and 'class="el tx"' in added[0]
    assert 'data-name="n2"' in added[2] and "유령" in added[2]                # 셋째는 고유 꼴 그대로(서식·클래스만 걸러)
    assert page.evaluate("window.__pwned || 0") == 0
    ctx.close()
    assert errors == []


def test_flow_box_pastes_as_is_into_flow_and_pictures_become_boxes(browser, decks):
    base, hub = decks
    ctx, page, errors = open_editor(browser, base, "flow", hub)
    page.keyboard.press("PageDown")
    page.click("#txtBtn")                                  # 흐름 덱의 글상자 — 같은 꼴(hs-box/1)로 그대로 붙는다
    page.keyboard.type("흐름 상자")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+c")
    pt = received(ctx)
    it = json.loads(pt["mime"])["items"][0]
    assert it["native"]["fmt"] == "hs-box/1" and "data-hs-box" in it["native"]["html"]
    page.bring_to_front()
    page.keyboard.press("PageDown")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+v")
    s3 = frame(page).locator("section.slide").nth(2)
    assert s3.locator(":scope > [data-hs-box]").all_inner_texts() == ["흐름 상자"]
    # 그림 항목은 옮길 수 있는 그림(img[data-hs-box])으로
    png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC"
    payload = {"app": "deckclip", "v": 2, "id": "pic1", "src": {"editor": "x", "title": "x", "session": "zz"},
               "stage": {"w": 1280, "h": 720}, "blobs": {}, "text": "", "t": 0,
               "items": [item(type="image", html=f'<img src="{png}" width="400" height="90">', src=png, alt="그림")]}
    paste_crafted(page, payload)
    im = s3.locator(":scope > img[data-hs-box]")
    assert im.count() == 1 and im.evaluate("(e) => [e.style.left, e.style.top, e.style.width, e.alt]") == ["100px", "120px", "400px", "그림"]
    ctx.close()
    assert errors == []
