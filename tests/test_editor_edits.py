"""덱 편집기 — 빌더 덱의 편집 기록(editor/js/edits.js). 저장할 때 본문 끝에 기록을, 자리가 어긋난 상자에 표식을 남기고,
tools/deckmerge.py 가 그것으로 새 빌드에 고친 곳을 다시 입힌다. 브라우저(Playwright)로 고쳐 저장한 판을 그대로 deckmerge 에
넣어 본다(시험 틀은 test_editor.py·test_editor_arrange.py 의 것)."""
import json
import re

import deckmerge as dm

from test_editor import (  # noqa: F401 — browser·serve·local_edit 는 fixture
    BUILDER, FLOW, PNG_2x1, QUIET, DeckHub, blob_sha, browser, frame, local_edit, make_site, open_editor, parse_saved,
    pw, save_with_token, serve, state, wait_file, wait_saved,
)
from test_editor_arrange import ARR, click_box, menu


def site_of(tmp_path, serve, decks: dict[str, str]):
    site, root = make_site(tmp_path, decks)
    hub = DeckHub({f"decks/{n}": (root / "decks" / n).read_bytes() for n in decks})
    return serve(site), hub


def doc_of(data) -> dm.Doc:
    text = data.decode("utf-8") if isinstance(data, bytes) else data
    ov, plain = dm.read_edits(text.removeprefix(dm.BOM))
    assert ov is not None
    return dm.Doc(plain)


def names(slide: dm.Node) -> list:
    return [n.get("data-name") or n.tag for _, n in dm.boxes(slide)]


def type_at_end(page, locator, text: str) -> None:
    locator.click()
    page.keyboard.press("End")
    page.keyboard.type(text)


def test_builder_deck_saves_an_edit_record_that_carries_edits_onto_a_rebuild(browser, tmp_path, serve):
    base, hub = site_of(tmp_path, serve, {"builder.html": BUILDER})
    first = hub.files["decks/builder.html"]
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    type_at_end(page, frame(page).locator("[data-name=body] .tin p").last, " — 고침")
    page.fill("#notes", "둘째 장 노트 — 고침")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/builder.html"]
    ov = dm.edits_of(saved)
    assert ov is not None and ov["build"] == blob_sha(first) and ov["complete"] is True and ov["why"] == []
    text = saved.decode("utf-8")
    assert "data-hs-ref" not in text                        # 자리가 그대로인 상자에는 표식이 없다
    s = parse_saved(page, text)
    assert s["scripts"] == ["notes-data", "deck-js", "deck-edits"] and s["hse"] is False
    assert text.endswith("</script></body></html>\r\n")     # 기록은 </body> 바로 앞(원래 모양 그대로)
    # 빌더가 셋째 장 제목을 바꿔 다시 빌드 — 편집기에서 고친 곳(둘째 장 본문·노트)만 새 빌드에 다시 입힌다
    rebuilt = first.replace("셋째 장 제목".encode(), "빌더가 바꾼 셋째 제목".encode())
    r = dm.reapply(first, saved, rebuilt)
    assert r.text and not r.refused and r.kept == [] and r.applied == ["고친 상자 1", "노트 1"]
    d = doc_of(r.text)
    assert "둘째 문단 — 고침" in dm.text_content(d.by_key["s02"])
    assert "빌더가 바꾼 셋째 제목" in dm.text_content(d.by_key["s03"])
    assert json.loads(dm.style_text(d.ids["notes-data"]))[1] == "둘째 장 노트 — 고침"
    ctx.close()
    # 다시 열어 손대지 않으면 기록까지 그대로, 더 고치면 기록의 build(처음 빌드)를 이어받는다
    ctx, page, errors2 = open_editor(browser, base, "builder", hub)
    assert page.evaluate("window.__hse.serialize()").encode("utf-8") == saved
    type_at_end(page, frame(page).locator("section.slide").nth(0).locator("[data-name=title] .tin p"), "!")
    save_with_token(page)
    wait_saved(page, hub, 2)
    again = hub.files["decks/builder.html"]
    ov2 = dm.edits_of(again)
    assert ov2["build"] == blob_sha(first) and ov2["saved"] != ov["saved"]
    d2 = doc_of(dm.reapply(first, again, rebuilt).text)
    assert "시험 덱 표지!" in dm.text_content(d2.by_key["s01"]) and "둘째 문단 — 고침" in dm.text_content(d2.by_key["s02"])
    ctx.close()
    assert errors == [] and errors2 == []


def test_box_marks_keep_identity_through_order_delete_duplicate_and_new_boxes(browser, tmp_path, serve):
    base, hub = site_of(tmp_path, serve, {"arr.html": ARR})
    first = hub.files["decks/arr.html"]
    ctx, page, errors = open_editor(browser, base, "arr", hub)
    page.keyboard.press("PageDown")
    click_box(page, "a")
    menu(page, "arr", "order:front")                       # a 를 맨 앞으로(장의 맨 뒤 차례)
    click_box(page, "b")
    page.keyboard.press("Delete")                          # b 지우기
    click_box(page, "c")
    page.keyboard.press("Control+d")                       # c 복제 — 사본은 새 상자
    page.keyboard.press("Escape")
    page.click("#txtBtn")                                  # 새 글상자
    page.keyboard.type("새 글상자")
    page.keyboard.press("Escape")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/arr.html"]
    d = doc_of(saved)
    ids = [i for i, _ in dm.boxes(d.by_key["s02"])]
    assert ids[:7] == ["n:kicker#1", "n:title#1", "n:body#1", "n:c#1", "u:svg#1", "n:pageno#1", "n:a#1"]
    assert sorted(ids[7:]) == ["+1", "+2"]                  # 사본과 새 글상자
    marked = [n.get(dm.REF_ATTR) for _, n in dm.boxes(d.by_key["s02"])]
    assert marked[:7] == [None] * 7 and sorted(marked[7:]) == ["+1", "+2"]   # 표식은 새 상자에만
    # 빌더가 둘째 장 제목과 c 의 색을 바꿔 다시 빌드 — 편집기의 차례·지우기·사본·새 상자는 그대로, 빌더의 고침도 들어간다
    rebuilt = (first.replace("둘째 장 제목".encode(), "빌더가 바꾼 둘째 제목".encode())
               .replace(b"background:#3333EE", b"background:#000000"))
    r = dm.reapply(first, saved, rebuilt)
    assert r.text and not r.refused and r.kept == []
    out = doc_of(r.text).by_key["s02"]
    got = names(out)
    assert got[:7] == ["kicker", "title", "body", "c", "svg", "pageno", "a"] and "b" not in got
    assert got[7] == "c" and got[8].startswith("text-")
    boxes = [n for _, n in dm.boxes(out)]
    assert "빌더가 바꾼 둘째 제목" in dm.text_content(boxes[1])
    assert "#000000" in boxes[3].get("style")                   # 손대지 않은 c 는 빌더를 따르고
    assert "rgb(51, 51, 238)" in boxes[7].get("style")          # 사본은 편집기에서 만든 그대로(#3333EE — 브라우저가 rgb 로 씀)
    assert dm.text_content(boxes[8]).strip() == "새 글상자"
    ctx.close()
    assert errors == []


def test_flow_decks_and_untouched_builder_decks_get_no_record(browser, tmp_path, serve):
    base, hub = site_of(tmp_path, serve, {"builder.html": BUILDER, "flow.html": FLOW})
    first = hub.files["decks/builder.html"].decode("utf-8")
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.keyboard.press("PageDown")
    type_at_end(page, frame(page).locator("[data-name=body] .tin p").last, "X")
    page.wait_for_timeout(900)
    page.keyboard.press("Control+z")                       # 고쳤다가 되돌리면 손대지 않은 것과 같다 — 기록을 붙이지 않는다
    again = page.evaluate("window.__hse.serialize()")
    assert "deck-edits" not in again and "data-hs-ref" not in again
    assert again.replace(' hidden=""', " hidden") == first   # 다시 쓰며 생기는 차이(빈 hidden)뿐
    ctx.close()
    ctx, page, errors2 = open_editor(browser, base, "flow", hub)
    type_at_end(page, frame(page).locator("h2").first, " 고침")
    save_with_token(page)
    wait_saved(page, hub)
    text = hub.saved("decks/flow.html")
    assert "deck-edits" not in text and "data-hs-ref" not in text
    ctx.close()
    assert errors == [] and errors2 == []


def test_a_record_that_no_longer_fits_its_file_is_kept_incomplete(browser, tmp_path, serve):
    """기록을 남긴 뒤 편집기 밖에서 고친 파일을 열어 고치면 — 기록의 build 는 이어받되 complete=false 와 그 까닭."""
    stamped = dm.stamp(BUILDER, "b" * 40).replace("셋째 장 제목", "밖에서 고친 제목")
    base, hub = site_of(tmp_path, serve, {"builder.html": stamped})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    type_at_end(page, frame(page).locator("[data-name=title] .tin p").first, "!")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/builder.html"]
    ov = dm.edits_of(saved)
    assert ov is not None and ov["build"] == "b" * 40 and ov["complete"] is False
    assert any("편집기 밖에서" in w for w in ov["why"])
    assert saved.decode("utf-8").count('id="deck-edits"') == 1        # 옛 기록은 떼고 새로 하나
    ctx.close()
    assert errors == []


def test_local_edit_records_the_build_of_the_file_it_opened(browser, local_edit):
    e = local_edit
    first = e.deck.read_bytes()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda x: errors.append(str(x)))
    page.on("console", lambda m: errors.append(m.text)
            if m.type == "error" and not any(q in m.text for q in QUIET) else None)
    page.goto(e.url)
    page.wait_for_selector("#app.ready", timeout=60000)
    type_at_end(page, frame(page).locator("[data-name=title] .tin p").first, "!")
    page.keyboard.press("Control+s")
    saved = wait_file(page, e.deck, first)
    ov = dm.edits_of(saved)
    assert ov is not None and ov["build"] == blob_sha(first) and ov["complete"] is True
    assert saved.count(b"\r\n") == saved.count(b"\n")       # 파일의 CRLF 그대로(기록은 그 글로 잰다)
    d = doc_of(dm.reapply(first, saved, first.replace("셋째 장 제목".encode(), "새 셋째".encode())).text)
    assert "시험 덱 표지!" in dm.text_content(d.by_key["s01"]) and "새 셋째" in dm.text_content(d.by_key["s03"])
    ctx.close()
    assert errors == []


def test_record_goes_inside_the_body_when_a_comment_follows_it(browser, tmp_path, serve):
    """</body> 뒤에 주석이 있는 덱 — 브라우저는 그 주석을 <html> 의 끝에 두어 저장 글이 '</body></html>' 로 끝나지 않는다.
    그래도 기록은 본문 끝(</body> 바로 앞)에 들고, 다시 열어 고쳐도 하나뿐이다."""
    deck = BUILDER.replace("</body></html>", "</body>\n<!-- 빌더가 남긴 주석 -->\n</html>", 1)
    assert deck != BUILDER
    base, hub = site_of(tmp_path, serve, {"builder.html": deck})
    first = hub.files["decks/builder.html"]
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    type_at_end(page, frame(page).locator("[data-name=title] .tin p").first, "!")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/builder.html"]
    ov = dm.edits_of(saved)
    assert ov is not None and ov["build"] == blob_sha(first) and ov["complete"] is True
    text = saved.decode("utf-8")
    assert text.index('id="deck-edits"') < text.rindex("</body>") < text.index("빌더가 남긴 주석")
    d = doc_of(dm.reapply(first, saved, first.replace("셋째 장 제목".encode(), "새 셋째".encode())).text)
    assert "시험 덱 표지!" in dm.text_content(d.by_key["s01"]) and "새 셋째" in dm.text_content(d.by_key["s03"])
    ctx.close()
    ctx, page, errors2 = open_editor(browser, base, "builder", hub)
    type_at_end(page, frame(page).locator("[data-name=title] .tin p").first, "?")
    save_with_token(page)
    wait_saved(page, hub, 2)
    again = hub.files["decks/builder.html"]
    assert again.decode("utf-8").count('id="deck-edits"') == 1 and dm.edits_of(again)["build"] == blob_sha(first)
    ctx.close()
    assert errors == [] and errors2 == []


# 빌더가 만든 그림(이름 있는 상자) — 둘째 장의 도형 자리에
CHART = ('<img class="el" data-name="chart" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 '
         'width=%27200%27 height=%27100%27%3E%3C/svg%3E" alt="도표" style="left:64px;top:400px;width:200px;height:100px">')
PIC = re.sub(r'<svg class="el".*?</svg>', lambda m: CHART, BUILDER, count=1, flags=re.S)


def test_picture_put_in_place_of_a_builder_picture_keeps_its_identity(browser, tmp_path, serve):
    """빌더가 만든 그림을 골라 새 그림으로 바꿔 넣으면 새 그림이 그 상자를 이어받는다 — 새 상자로 치면, 빌더도 그 그림을
    바꿨을 때 다시 빌드한 판에 빌더의 새 그림과 넣은 그림이 함께 남는다."""
    assert PIC != BUILDER and PIC.count("width:200px;height:100px") == 1
    base, hub = site_of(tmp_path, serve, {"pic.html": PIC})
    first = hub.files["decks/pic.html"]
    ctx, page, errors = open_editor(browser, base, "pic", hub)
    page.keyboard.press("PageDown")
    sec = frame(page).locator("section.slide").nth(1)
    sec.locator(":scope > img[data-name=chart]").click()
    png = tmp_path / "새 그림.png"
    png.write_bytes(PNG_2x1)
    page.set_input_files("#picFile", str(png))
    pw.expect(sec.locator(":scope > img[data-name=chart]")).to_have_count(0)
    pw.expect(sec.locator(":scope > img")).to_have_count(1)
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.files["decks/pic.html"]
    imgs = [n for n in doc_of(saved).by_key["s02"].elements() if n.tag == "img"]
    assert len(imgs) == 1 and imgs[0].get("data-hs-ref") == "n:chart#1" and imgs[0].get("data-name") is None
    mine = imgs[0].get("src") or ""
    assert mine.startswith("data:image/png;base64,") and 'data-hs-ref="+' not in saved.decode("utf-8")
    # 빌더가 다른 장만 바꿈 — 넣은 그림 하나만(빌더의 옛 그림이 돌아오지 않는다)
    r = dm.reapply(first, saved, first.replace("셋째 장 제목".encode(), "빌더가 바꾼 셋째 제목".encode()))
    assert r.text and not r.refused and r.kept == []
    assert [n.get("src") for n in doc_of(r.text).by_key["s02"].elements() if n.tag == "img"] == [mine]
    # 빌더도 그 그림을 바꿈 — 빌더 것 하나만 남기고 알린다(둘이 함께 남지 않는다)
    r2 = dm.reapply(first, saved, first.replace(b"width:200px;height:100px", b"width:240px;height:120px"))
    assert r2.text and not r2.refused and len(r2.kept) == 1 and "빌더도 바꿔" in r2.kept[0]
    got = [n for n in doc_of(r2.text).by_key["s02"].elements() if n.tag == "img"]
    assert len(got) == 1 and got[0].get("data-name") == "chart" and "240px" in (got[0].get("style") or "")
    ctx.close()
    assert errors == []
