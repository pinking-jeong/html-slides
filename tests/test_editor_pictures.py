"""덱 편집기 — 그림 줄이기: 넣을 때 큰 그림은 장의 두 배(2560×1440) 안으로, ‘그림 줄이기’ 창은 장에 보이는 크기의 두 배로.
한 번 줄인 것이 되돌리기 한 칸이고, 그림은 덱 파일 안에 그대로 남는다. 브라우저(Playwright)로 눌러 본다."""
import base64
import os
import struct
import zlib

from playwright.sync_api import expect

from test_editor import (  # noqa: F401 — browser·serve 는 fixture
    BUILDER, GIF, DeckHub, browser, frame, make_site, open_editor, save_with_token, serve, state, wait_saved,
)

DRAW = """([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); const lg = g.createLinearGradient(0, 0, w, h);
  lg.addColorStop(0, '#0b3d91'); lg.addColorStop(1, '#f2a541'); g.fillStyle = lg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i += 1) { g.strokeStyle = `hsl(${(i * 37) % 360} 70% 50%)`; g.lineWidth = 1 + (i % 5);
    g.beginPath(); g.moveTo((i * 97) % w, (i * 53) % h); g.lineTo((i * 31) % w, (i * 71) % h); g.stroke(); }
  return c.toDataURL('image/png'); }"""
SIZES = "(ims) => Promise.all(ims.map((i) => i.decode().then(() => [i.naturalWidth, i.naturalHeight])))"
NATURAL = "(i) => i.decode().then(() => [i.naturalWidth, i.naturalHeight])"


# 잡음 WebP(품질 q) — 같은 품질 가까이로 다시 담아도 15% 넘게 작아지지 않는 그림(늘 같은 잡음이 나오게 씨앗을 둔다)
NOISE = """([w, h, q]) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); const d = g.createImageData(w, h);
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < d.data.length; i += 4) { const v = rnd() * 255; d.data[i] = v; d.data[i + 1] = (v * 7) % 255;
    d.data[i + 2] = 255 - v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); return c.toDataURL('image/webp', q); }"""


def drawn_png(browser, w: int, h: int) -> str:
    """무늬를 그린 PNG(data: 주소) — 시험용 그림을 Pillow 없이 브라우저 캔버스로 만든다."""
    page = browser.new_page()
    try:
        return page.evaluate(DRAW, [w, h])
    finally:
        page.close()


def noise_webp(browser, w: int, h: int, q: float) -> str:
    page = browser.new_page()
    try:
        return page.evaluate(NOISE, [w, h, q])
    finally:
        page.close()


def apng(w: int, h: int) -> bytes:
    """두 장면(빨강 → 파랑)이 번갈아 나오는 APNG."""
    def chunk(t: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)

    def frame_rows(rgb: bytes) -> bytes:
        return zlib.compress(b"".join(b"\x00" + rgb * w for _ in range(h)))

    fctl = lambda seq: struct.pack(">IIIIIHHBB", seq, w, h, 0, 0, 1, 10, 0, 0)  # noqa: E731
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"acTL", struct.pack(">II", 2, 0)) + chunk(b"fcTL", fctl(0))
            + chunk(b"IDAT", frame_rows(b"\xff\x00\x00")) + chunk(b"fcTL", fctl(1))
            + chunk(b"fdAT", struct.pack(">I", 2) + frame_rows(b"\x00\x00\xff")) + chunk(b"IEND", b""))


def test_shrink_pictures_to_twice_the_shown_size(browser, tmp_path, serve):
    uri = drawn_png(browser, 1600, 900)
    img = f'<img class="el" src="{uri}" alt="" style="left:900px;top:400px;width:320px;height:180px">'
    deck = (BUILDER.replace("2 / 3</p></div></div>\n</section>", f"2 / 3</p></div></div>\n{img}\n</section>", 1)
            .replace("3 / 3</p></div></div>\n</section>", f"3 / 3</p></div></div>\n{img}\n</section>", 1))
    site, root = make_site(tmp_path, {"pics.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/pics.html": (root / "decks" / "pics.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "pics", hub)
    page.click("#picShrinkBtn")
    expect(page.locator("#picList li button")).to_have_count(1)    # 같은 그림을 두 장에 썼으면 한 줄
    row = page.locator("#picList li").first.inner_text()
    assert "1600×900" in row and "보이는 크기 320×180" in row and "2·3장" in row and "줄이면 640×360" in row
    page.click("#picAll")
    expect(page.locator("#picStatus")).to_contain_text("그림 1개를 줄였습니다")
    assert frame(page).locator("img.el").evaluate_all(SIZES) == [[640, 360], [640, 360]]   # 두 곳 함께
    assert state(page)["undo"] == 1 and state(page)["dirty"] is True
    expect(page.locator("#picList li button")).to_have_count(0)    # 이제 알맞은 크기
    page.click("#picClose")
    page.keyboard.press("Control+z")                               # 되돌리기 한 번에 두 곳 모두
    assert frame(page).locator("img.el").evaluate_all(SIZES) == [[1600, 900], [1600, 900]]
    page.keyboard.press("Control+y")
    save_with_token(page)
    wait_saved(page, hub)
    saved = hub.saved("decks/pics.html")
    assert uri not in saved and saved.count('src="data:image/') == 2   # 그림은 덱 파일 안에 그대로(작아진 것으로)
    assert len(saved) < len(deck) - len(uri)
    ctx.close()
    assert errors == []


def insert_drawn(page, browser, name: str, w: int, h: int) -> None:
    data = base64.b64decode(drawn_png(browser, w, h).split(",", 1)[1])
    page.set_input_files("#picFile", files=[{"name": name, "mimeType": "image/png", "buffer": data}])


def test_big_picture_is_shrunk_when_inserted(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    base = serve(site)
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    status = page.locator("#status")
    insert_drawn(page, browser, "큰 그림.png", 3200, 1600)          # 2560×1440 을 넘으면 그 안으로 줄인다
    expect(status).to_contain_text("그림이 커서 2560×1280 크기로 줄여 넣었습니다")
    assert frame(page).locator("img").last.evaluate(NATURAL) == [2560, 1280]
    insert_drawn(page, browser, "무거운 그림.png", 2400, 1200)       # 크기는 맞아도 1.5 MB 를 넘으면 같은 크기로 다시 담는다
    expect(status).to_contain_text("그림 파일이 커서 더 작게 다시 담아 넣었습니다")
    assert "크기로 줄여" not in status.inner_text()
    assert frame(page).locator("img").last.evaluate(NATURAL) == [2400, 1200]
    insert_drawn(page, browser, "작은 그림.png", 400, 200)           # 작고 가벼운 그림은 그대로
    expect(status).to_have_text("그림을 넣었습니다 — 테두리를 끌어 옮기고 손잡이로 크기를 바꿉니다.")
    last = frame(page).locator("img").last
    assert last.evaluate(NATURAL) == [400, 200] and last.get_attribute("src").startswith("data:image/png")
    ctx.close()
    assert errors == []


def picture_deck(boxes: str) -> str:
    return BUILDER.replace("2 / 3</p></div></div>\n</section>", f"2 / 3</p></div></div>\n{boxes}\n</section>", 1)


def picture_row(page, text: str):
    return page.locator("#picList li").filter(has_text=text)


def test_shrink_follows_the_fit_and_says_why_it_kept_one(browser, tmp_path, serve):
    cover = drawn_png(browser, 2400, 1200)          # 600×600 을 채워 자른다 — 긴 쪽 기준으로는 본래 크기가 다 필요
    fixed = drawn_png(browser, 1600, 800)           # 배경 크기 auto — 제 크기로 보이니 줄이면 보이는 크기가 바뀐다
    noisy = noise_webp(browser, 1800, 1100, 0.8)    # 상자의 딱 두 배이고 1 MB 를 넘지만 다시 담아도 작아지지 않는다
    deck = picture_deck(
        f'<img class="el" data-name="cover" src="{cover}" alt="" '
        'style="left:40px;top:60px;width:600px;height:600px;object-fit:cover">\n'
        f'<div class="el" data-name="fixed" style="left:700px;top:60px;width:400px;height:200px;'
        f'background-image:url({fixed})"></div>\n'
        f'<img class="el" data-name="noisy" src="{noisy}" alt="" style="left:300px;top:100px;width:900px;height:550px">')
    site, root = make_site(tmp_path, {"fit.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/fit.html": (root / "decks" / "fit.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "fit", hub)
    page.click("#picShrinkBtn")
    expect(page.locator("#picList li")).to_have_count(3)
    expect(picture_row(page, "2400×1200")).to_contain_text("줄이면 2400×1200")
    expect(picture_row(page, "1600×800")).to_contain_text("제 크기로 보이는 곳이 있어")
    expect(picture_row(page, "1800×1100")).to_contain_text("줄이면 1800×1100")
    picture_row(page, "1800×1100").locator("button").click()
    status = page.locator("#picStatus")
    expect(status).to_have_text("줄이지 않았습니다 — 줄여도 15% 넘게 작아지지 않습니다.")
    expect(status).to_be_focused()
    assert state(page)["undo"] == 0 and state(page)["dirty"] is False
    page.click("#picAll")
    expect(status).to_contain_text("그림 1개를 줄였습니다", timeout=30000)       # 큰 PNG 를 두 꼴로 담아 보느라 몇 초 걸린다
    expect(status).to_contain_text("줄이지 않은 것: 줄여도 15% 넘게 작아지지 않습니다 1개")
    shown = frame(page).locator('img[data-name="cover"]')
    assert shown.evaluate(NATURAL) == [2400, 1200] and shown.get_attribute("src").startswith("data:image/webp")
    assert frame(page).locator('img[data-name="noisy"]').get_attribute("src") == noisy
    assert fixed in frame(page).locator('div[data-name="fixed"]').get_attribute("style")
    assert state(page)["undo"] == 1
    ctx.close()
    assert errors == []


def test_animated_pictures_are_left_alone(browser, tmp_path, serve):
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    base = serve(site)
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    page.set_input_files("#picFile", files=[{"name": "움직이는 그림.png", "mimeType": "image/png", "buffer": apng(3000, 100)}])
    status = page.locator("#status")
    expect(status).to_contain_text("그림을 넣었습니다")
    assert "줄여" not in status.inner_text() and "다시 담아" not in status.inner_text()   # 넓어도(3000) 그대로 — 장면을 지킨다
    pic = frame(page).locator("img").last
    assert pic.evaluate(NATURAL) == [3000, 100] and pic.get_attribute("src").startswith("data:image/png")
    page.click("#picShrinkBtn")
    expect(picture_row(page, "3000×100")).to_contain_text("움직이는 그림이라 그대로 둡니다")
    ctx.close()
    assert errors == []


# 캔버스가 그림을 담는 데 1.5초 걸리게 — 줄이는 동안의 창을 눌러 볼 틈
SLOW_BLOB = """() => { const orig = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
    return orig.call(this, (b) => setTimeout(() => cb(b), 1500), ...rest); }; }"""


def test_picture_dialog_stays_open_while_shrinking(browser, tmp_path, serve):
    uri = drawn_png(browser, 1600, 900)
    deck = picture_deck(f'<img class="el" src="{uri}" alt="" style="left:900px;top:400px;width:320px;height:180px">')
    site, root = make_site(tmp_path, {"slow.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/slow.html": (root / "decks" / "slow.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "slow", hub)
    page.evaluate(SLOW_BLOB)
    page.click("#picShrinkBtn")
    expect(page.locator("#picList li button")).to_have_count(1)
    page.click("#picAll")
    expect(page.locator("#picClose")).to_be_disabled()
    expect(page.locator("#picDlg")).to_have_attribute("aria-busy", "true")
    page.keyboard.press("Escape")                                  # 줄이는 동안에는 닫히지 않는다
    assert page.locator("#picDlg").evaluate("(d) => d.open") is True
    page.locator("#picDlg").evaluate("(d) => d.close()")           # 그래도 닫히면(잇따른 Esc 등) 다시 연다 —
    expect(page.locator("#picDlg")).to_have_js_property("open", True)   # close 이벤트(다음 차례)에서 열므로 기다린다
    expect(page.locator("#picStatus")).to_contain_text("그림 1개를 줄였습니다", timeout=30000)
    assert page.locator("#picDlg").evaluate("(d) => d.open") is True
    expect(page.locator("#picClose")).to_be_enabled()
    expect(page.locator("#picDlg")).not_to_have_attribute("aria-busy", "true")
    page.keyboard.press("Escape")                                  # 끝난 뒤에는 Esc 로 닫힌다
    expect(page.locator("#picDlg")).to_be_hidden()
    assert state(page)["undo"] == 1
    ctx.close()
    assert errors == []


def wrap76(uri: str) -> str:
    """base64 를 76자마다 줄바꿈한 data: 주소(메일·옛 도구가 쓰던 꼴) — 브라우저는 공백을 빼고 읽는다."""
    head, b64 = uri.split(",", 1)
    return head + "," + "\n".join(b64[i:i + 76] for i in range(0, len(b64), 76))


def test_contain_keeps_the_shorter_side_and_odd_uses_are_left_alone(browser, tmp_path, serve):
    """상자 안에 맞춘 그림은 짧은 쪽이 두 배가 되게. 제 픽셀 크기로 그려지는 쓰임(크기 없는 SVG <image>·srcset)·장 밖에도
    쓴 그림·주소가 줄바꿈으로 나뉜 그림·이름만 PNG 인 GIF 는 줄이지 않고 까닭을 보인다."""
    wide = drawn_png(browser, 3000, 1000)           # 900×550 에 맞춤 — 짧은 쪽(세로 600)이 두 배 → 1800×600(cover 면 그대로)
    svg_pic = drawn_png(browser, 1600, 800)
    set_pic = drawn_png(browser, 1400, 700)
    out_pic = drawn_png(browser, 1200, 600)
    wrapped = drawn_png(browser, 1000, 500)
    fake_gif = GIF.replace("data:image/gif", "data:image/png")
    deck = picture_deck(
        f'<img class="el" data-name="wide" src="{wide}" alt="" '
        'style="left:40px;top:60px;width:900px;height:550px;object-fit:contain">\n'
        '<svg class="el" data-name="svgpic" viewBox="0 0 1600 800" style="left:960px;top:60px;width:300px;height:150px">'
        f'<image href="{svg_pic}"/></svg>\n'
        f'<img class="el" data-name="setpic" srcset="{set_pic} 1400w" sizes="200px" alt="" style="left:960px;top:240px">\n'
        f'<img class="el" data-name="outpic" src="{out_pic}" alt="" style="left:960px;top:400px;width:300px;height:150px">\n'
        f'<img class="el" data-name="wrapped" src="{wrap76(wrapped)}" alt="" '
        'style="left:40px;top:620px;width:200px;height:100px">\n'
        f'<img class="el" data-name="fakegif" src="{fake_gif}" alt="" style="left:300px;top:620px;width:80px;height:80px">')
    deck = deck.replace("</head>", f"<style>.logo{{background-image:url({out_pic})}}</style>\n</head>", 1)
    site, root = make_site(tmp_path, {"odd.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/odd.html": (root / "decks" / "odd.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "odd", hub)
    page.click("#picShrinkBtn")
    expect(page.locator("#picList li")).to_have_count(6)
    expect(picture_row(page, "3000×1000")).to_contain_text("줄이면 1800×600")
    expect(picture_row(page, "1600×800")).to_contain_text("제 크기로 보이는 곳이 있어")
    expect(picture_row(page, "1400×700")).to_contain_text("제 크기로 보이는 곳이 있어")
    expect(picture_row(page, "1200×600")).to_contain_text("장 밖(스타일 글·쪽 레이아웃 등)에도 쓴 그림이라 그대로 둡니다")
    expect(picture_row(page, "줄바꿈으로")).to_have_count(1)
    expect(picture_row(page, "GIF ·")).to_contain_text("GIF·SVG·AVIF 는 그대로 둡니다")
    expect(page.locator("#picList li button")).to_have_count(1)
    page.click("#picAll")
    status = page.locator("#picStatus")
    expect(status).to_contain_text("그림 1개를 줄였습니다", timeout=30000)
    assert frame(page).locator('img[data-name="wide"]').evaluate(NATURAL) == [1800, 600]
    assert frame(page).locator('img[data-name="outpic"]').get_attribute("src") == out_pic
    assert frame(page).locator('img[data-name="fakegif"]').get_attribute("src") == fake_gif
    ctx.close()
    assert errors == []


# 이 브라우저가 그림을 어느 꼴로도 담지 못하는 경우(toBlob 이 null)
NO_BLOB = "() => { HTMLCanvasElement.prototype.toBlob = function (cb) { setTimeout(() => cb(null), 0); }; }"


def test_a_browser_that_cannot_recode_is_reported(browser, tmp_path, serve):
    uri = drawn_png(browser, 1600, 900)
    deck = picture_deck(f'<img class="el" src="{uri}" alt="" style="left:900px;top:400px;width:320px;height:180px">')
    site, root = make_site(tmp_path, {"noblob.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/noblob.html": (root / "decks" / "noblob.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "noblob", hub)
    page.evaluate(NO_BLOB)
    page.click("#picShrinkBtn")
    expect(page.locator("#picList li button")).to_have_count(1)
    page.click("#picAll")
    expect(page.locator("#picStatus")).to_have_text("줄이지 않았습니다 — 이 브라우저가 그림을 다시 담지 못했습니다.")
    assert frame(page).locator("img.el").last.get_attribute("src") == uri
    assert state(page)["undo"] == 0
    ctx.close()
    assert errors == []


def webp(*chunks: tuple[bytes, bytes]) -> bytes:
    body = b"WEBP" + b"".join(t + struct.pack("<I", len(d)) + d + (b"\0" if len(d) % 2 else b"") for t, d in chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


# pictures.js 를 편집기 창에서 불러 바이트만으로 판정해 본다
KINDS = """async (cases) => {
  const m = await import('./js/pictures.js');
  const bytes = (hex) => Uint8Array.from(hex.match(/../g) || [], (x) => parseInt(x, 16));
  const out = {};
  for (const [name, hex, type] of cases) {
    const b = bytes(hex);
    out[name] = { sniff: m.sniff(b), animated: m.animated(b, m.sniff(b) || type) };
  }
  const gif = bytes(cases.find((c) => c[0] === 'gif')[1]);
  const file = new File([gif], 'big.png', { type: 'image/png' });
  out.bigGif = { big: m.bigPicture(file, { w: 4000, h: 100 }), shrunk: await m.shrinkFile(file, { w: 4000, h: 100 }) };
  out.kind = m.kindOf('data:image/png;base64,' + btoa(String.fromCharCode(...gif)));
  return out;
}"""


def test_picture_kinds_come_from_the_bytes(browser, tmp_path, serve):
    gif = base64.b64decode(GIF.split(",", 1)[1])
    vp8x_anim = webp((b"VP8X", bytes([0x02, 0, 0, 0]) + b"\0" * 6), (b"VP8 ", b"\0" * 10))
    anim_chunk = webp((b"VP8X", b"\0" * 10), (b"ANIM", b"\0" * 6), (b"ANMF", b"\0" * 16))
    still = webp((b"VP8 ", b"\0" * 10))
    cases = [["gif", gif.hex(), "image/png"], ["apng", apng(4, 2).hex(), "image/png"],
             ["vp8x", vp8x_anim.hex(), "image/webp"], ["anim", anim_chunk.hex(), "image/webp"],
             ["still", still.hex(), "image/webp"], ["jpeg", "ffd8ffe000104a464946", "image/png"],
             ["bmp", "424d" + "00" * 12, "image/png"], ["junk", os.urandom(16).hex(), "image/png"]]
    site, root = make_site(tmp_path, {"builder.html": BUILDER})
    base = serve(site)
    hub = DeckHub({"decks/builder.html": (root / "decks" / "builder.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "builder", hub)
    got = page.evaluate(KINDS, cases)
    assert got["gif"] == {"sniff": "image/gif", "animated": False}
    assert got["apng"] == {"sniff": "image/png", "animated": True}
    assert got["vp8x"] == {"sniff": "image/webp", "animated": True}         # VP8X 의 애니메이션 표
    assert got["anim"] == {"sniff": "image/webp", "animated": True}         # 표 없이 ANIM·ANMF 덩이만
    assert got["still"] == {"sniff": "image/webp", "animated": False}
    assert got["jpeg"]["sniff"] == "image/jpeg" and got["bmp"]["sniff"] == "image/bmp"
    assert got["junk"]["animated"] is False
    # 이름만 PNG 인 GIF — 크게 넣어도 다시 담지 않는다(움직이는 GIF 가 한 장면이 되지 않게)
    assert got["bigGif"] == {"big": True, "shrunk": None}
    assert got["kind"] == {"type": "image/gif", "animated": False}
    ctx.close()
    assert errors == []


def test_undo_keeps_working_with_a_very_big_picture(browser, tmp_path, serve):
    """8 MB 가 넘는 그림(data: 주소)이 든 덱 — 되돌리기 칸을 만들다 정규식이 스택을 넘치지 않는다(RangeError)."""
    big = "data:image/png;base64," + base64.b64encode(os.urandom(8 * 1024 * 1024 + 123)).decode()
    deck = picture_deck(f'<img class="el" data-name="huge" src="{big}" alt="" '
                        'style="left:900px;top:400px;width:320px;height:180px">')
    site, root = make_site(tmp_path, {"huge.html": deck})
    base = serve(site)
    hub = DeckHub({"decks/huge.html": (root / "decks" / "huge.html").read_bytes()})
    ctx, page, errors = open_editor(browser, base, "huge", hub)
    page.keyboard.press("PageDown")                                 # 그림이 든 2장 — 되돌리기 칸이 그 장을 담는다
    body = frame(page).locator("[data-name=body] .tin p").last
    body.click()
    page.keyboard.press("End")
    page.keyboard.type("가")
    expect(page.locator("#undo")).to_be_enabled(timeout=30000)
    page.keyboard.press("Control+z")
    expect(page.locator("#redo")).to_be_enabled(timeout=30000)
    assert body.inner_text() == "둘째 문단"
    assert frame(page).locator('img[data-name="huge"]').get_attribute("src") == big
    ctx.close()
    assert errors == []
