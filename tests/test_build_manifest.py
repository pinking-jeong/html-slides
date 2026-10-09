import http.client
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import build_manifest as bm
import samples

REPO = Path(__file__).resolve().parents[1]


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def deck(title: str = "제목", desc: str | None = None, slides: int = 3) -> str:
    meta = f'<meta name="description" content="{desc}">' if desc else ""
    body = "".join(f'<section class="slide">{i}</section>' for i in range(slides))
    return f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>{meta}</head><body>{body}</body></html>'


def git(cwd: Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_discover_file_and_folder_decks(tmp_path):
    write(tmp_path / "decks/a.html", deck())
    write(tmp_path / "decks/conf/b.html", deck())
    write(tmp_path / "decks/conf/folder-deck/index.html", deck())
    write(tmp_path / "decks/conf/folder-deck/inner.html", deck())   # 폴더 덱 안은 에셋 — 따로 세지 않는다
    write(tmp_path / "decks/_drafts/c.html", deck())                # _ 로 시작하는 폴더는 건너뛴다
    write(tmp_path / "decks/.hidden.html", deck())
    found = sorted((f["kind"], f["entry"].relative_to(tmp_path).as_posix()) for f in bm.discover(tmp_path))
    assert found == [
        ("dir", "decks/conf/folder-deck/index.html"),
        ("file", "decks/a.html"),
        ("file", "decks/conf/b.html"),
    ]


def test_manifest_reads_html_and_meta(tmp_path):
    write(tmp_path / "decks/conf/talk.html", deck(title="원래 제목 &amp; 부제", desc="설명 문장", slides=4))
    write(tmp_path / "decks/conf/talk.meta.json",
          json.dumps({"date": "2026-10-29", "venue": "KNS", "tags": "a, b", "order": 2}))
    (tmp_path / "decks/conf/talk.pptx").write_bytes(b"PK")
    write(tmp_path / "decks/folders.json", json.dumps({"conf": {"label": "학회 발표", "order": 1}}))
    write(tmp_path / "decks/hidden.html", deck())
    write(tmp_path / "decks/hidden.meta.json", json.dumps({"hidden": True}))
    write(tmp_path / "decks/bad-date.html", deck(title="날짜 틀림"))
    write(tmp_path / "decks/bad-date.meta.json", json.dumps({"date": "2026/10/29"}))

    m = bm.build_manifest(tmp_path, thumbs=False, cache=None, use_git=False)
    assert sorted(d["id"] for d in m["decks"]) == ["bad-date", "conf/talk"]
    talk = next(d for d in m["decks"] if d["id"] == "conf/talk")
    assert talk["title"] == "원래 제목 & 부제"
    assert talk["description"] == "설명 문장"
    assert (talk["date"], talk["venue"], talk["tags"], talk["order"]) == ("2026-10-29", "KNS", ["a", "b"], 2)
    assert talk["slides"] == 4
    assert talk["pptx"] == "decks/conf/talk.pptx"
    assert talk["folderLabel"] == "학회 발표"
    assert (talk["path"], talk["dir"], talk["kind"]) == ("decks/conf/talk.html", "decks/conf", "file")
    assert next(d for d in m["decks"] if d["id"] == "bad-date")["date"] is None
    assert m["folders"] == [{"key": "conf", "label": "학회 발표", "order": 1, "count": 1}]
    assert m["count"] == 2


def test_title_sources(tmp_path, capsys):
    write(tmp_path / "decks/x.html", deck(title="HTML 제목"))
    write(tmp_path / "decks/x.meta.json", json.dumps({"title": "갤러리 제목"}))
    write(tmp_path / "decks/no-title.html", "<html><body>x</body></html>")
    write(tmp_path / "decks/broken.meta.json", "{ 깨진 json")
    write(tmp_path / "decks/broken.html", deck(title="정보 파일이 깨진 덱"))
    by_id = {d["id"]: d for d in bm.build_manifest(tmp_path, False, None, False)["decks"]}
    assert by_id["x"]["title"] == "갤러리 제목"
    assert by_id["no-title"]["title"] == "no-title" and by_id["no-title"]["slides"] is None
    assert "broken" not in by_id                            # 정보 파일이 깨지면 숨긴 것으로 다룬다(숨김이 새지 않게)
    assert "broken.meta.json" in capsys.readouterr().out


def test_hidden_markers_hold_inside_folder_decks(tmp_path):
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    write(root / "decks/conf/index.html", deck())           # conf 폴더째 한 덱
    write(root / "decks/conf/talk.html", deck())            # 그 안에 묻힌 덱 — 숨김
    write(root / "decks/conf/talk.meta.json", json.dumps({"hidden": True}))
    (root / "decks/conf/talk.pptx").write_bytes(b"PK")
    write(root / "decks/conf/other.html", deck())           # 정보 파일이 깨진 덱 — 숨김으로 다룸
    write(root / "decks/conf/other.meta.json", "{ 깨짐")
    write(root / "decks/conf/img.svg", "<svg/>")
    m = bm.build_manifest(root, False, None, False)
    out = tmp_path / "site"
    bm.build_site(root, out, m, None)
    built = sorted(p.relative_to(out).as_posix() for p in (out / "decks").rglob("*") if p.is_file())
    assert built == ["decks/conf/img.svg", "decks/conf/index.html"]


def test_git_dates(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.name", "test")
    git(tmp_path, "config", "user.email", "test@example.com")
    write(tmp_path / "decks/a.html", deck())
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "add")
    d = bm.build_manifest(tmp_path, False, None, True)["decks"][0]
    assert d["created"] and d["updated"] and d["created"] <= d["updated"]


def test_add_noindex():
    robots = b'<meta name="robots"'
    assert b"<head>" + robots in bm.add_noindex(b"<html><head><title>t</title></head></html>")
    assert bm.add_noindex(b"<title>t</title><p>x</p>").startswith(robots)
    # <!doctype> 앞에 넣으면 문서가 쿼크 모드로 바뀌므로 그 뒤에 넣는다
    assert bm.add_noindex(b"<!DOCTYPE html><p>x</p>").startswith(b"<!DOCTYPE html>" + robots)
    assert bm.add_noindex(b'<!doctype html><html lang="ko"><body>').startswith(
        b'<!doctype html><html lang="ko">' + robots)
    has = b'<html><head><meta name="robots" content="all"></head></html>'
    out = bm.add_noindex(has)                               # 덱에 있어도 넣는다 — 더 엄한 쪽이 이긴다
    assert out.count(b'name="robots"') == 2 and b"noindex" in out
    bom = chr(0xFEFF).encode("utf-8")
    assert bm.add_noindex(bom + b"<title>t</title>").startswith(bom + robots)
    broken = bytes([0xFF, 0xFE])
    assert bm.add_noindex(b"<head>" + broken + b"</head>").endswith(broken + b"</head>")  # 깨진 UTF-8 도 그대로


def test_build_site(tmp_path):
    root = tmp_path / "repo"
    write(root / "index.html", "<html><head></head><body>gallery</body></html>")
    write(root / "assets/gallery.css", "body{}")
    original = deck(title="원본")
    write(root / "decks/conf/talk.html", original)
    write(root / "decks/conf/talk.meta.json", "{}")
    write(root / "decks/folders.json", "{}")
    write(root / "decks/dirdeck/index.html", deck())
    write(root / "decks/dirdeck/meta.json", "{}")
    write(root / "decks/dirdeck/img/a.svg", "<svg/>")
    m = bm.build_manifest(root, False, None, False)
    out = tmp_path / "site"
    bm.build_site(root, out, m, None)

    assert (out / "index.html").is_file() and (out / "assets/gallery.css").is_file()
    assert 'name="robots"' in (out / "decks/conf/talk.html").read_text(encoding="utf-8")
    assert (root / "decks/conf/talk.html").read_text(encoding="utf-8") == original   # 저장소의 원본은 그대로
    for gone in ("decks/conf/talk.meta.json", "decks/folders.json", "decks/dirdeck/meta.json"):
        assert not (out / gone).exists(), gone
    assert (out / "decks/dirdeck/img/a.svg").is_file()
    data = json.loads((out / "decks.json").read_text(encoding="utf-8"))
    assert data["count"] == 2 and all("hash" not in d for d in data["decks"])
    assert (out / ".nojekyll").exists()
    bm.build_site(root, out, m, None)                       # 이전 빌드 표시가 있으니 다시 만들어도 된다


def test_meta_types_are_checked(tmp_path):
    write(tmp_path / "decks/t.html", deck(title="HTML 제목"))
    write(tmp_path / "decks/t.meta.json", json.dumps({
        "title": ["목록"], "description": 42, "venue": True, "authors": None,
        "tags": {"a": 1}, "order": "1", "date": 20261029, "hidden": "yes"}))
    write(tmp_path / "decks/n.html", deck(title="NaN"))
    write(tmp_path / "decks/n.meta.json", '{"order": NaN, "tags": ["a", 1, true, null, ""]}')
    m = bm.build_manifest(tmp_path, False, None, False)
    by_id = {d["id"]: d for d in m["decks"]}
    t = by_id["t"]                                          # hidden 은 true 일 때만 숨긴다
    assert (t["title"], t["description"]) == ("HTML 제목", "42")
    assert (t["venue"], t["authors"], t["tags"], t["order"], t["date"]) == (None, None, [], None, None)
    assert by_id["n"]["order"] is None and by_id["n"]["tags"] == ["a", "1"]
    out = tmp_path / "site"
    bm.build_site(tmp_path, out, m, None)                   # NaN 이 목록에 새지 않는다(allow_nan=False 로도 만든다)
    assert json.loads((out / "decks.json").read_text(encoding="utf-8"))["count"] == 2


def test_hidden_decks_stay_out_of_site(tmp_path):
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    write(root / "decks/open.html", deck())
    write(root / "decks/secret.html", deck())
    write(root / "decks/secret.meta.json", json.dumps({"hidden": True}))
    (root / "decks/secret.pptx").write_bytes(b"PK")
    write(root / "decks/hiddendir/index.html", deck())
    write(root / "decks/hiddendir/meta.json", json.dumps({"hidden": True}))
    write(root / "decks/hiddendir/img/a.svg", "<svg/>")
    write(root / "decks/_draft/x.html", deck())
    write(root / "decks/.notes.html", deck())
    m = bm.build_manifest(root, False, None, False)
    assert [d["id"] for d in m["decks"]] == ["open"]
    out = tmp_path / "site"
    bm.build_site(root, out, m, None)
    built = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    assert [p for p in built if p.startswith("decks/")] == ["decks/open.html"]
    data = json.loads((out / "decks.json").read_text(encoding="utf-8"))
    assert data["count"] == 1 and not any(k.startswith("_") for k in data)


def test_folder_deck_swallowing_is_reported(tmp_path, capsys):
    write(tmp_path / "decks/conf/index.html", deck())
    write(tmp_path / "decks/conf/talk.html", deck())
    write(tmp_path / "decks/conf/talk.meta.json", "{}")
    assert [f["kind"] for f in bm.discover(tmp_path)] == ["dir"]
    assert "폴더째 한 덱으로" in capsys.readouterr().out


def test_symlinks_are_skipped(tmp_path):
    outside = write(tmp_path / "secret.txt", "secret")
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    write(root / "decks/a.html", deck())
    try:
        (root / "decks/link.html").symlink_to(outside)
        (root / "decks/linkdir").symlink_to(tmp_path, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("이 환경에서는 바로가기(symlink)를 만들 수 없습니다")
    m = bm.build_manifest(root, False, None, False)
    assert [d["id"] for d in m["decks"]] == ["a"]
    out = tmp_path / "site"
    bm.build_site(root, out, m, None)
    assert not (out / "decks/link.html").exists() and not (out / "decks/linkdir").exists()


def test_previews_skip_when_browser_missing(tmp_path, monkeypatch, capsys):
    pw = pytest.importorskip("playwright.sync_api")
    pytest.importorskip("PIL")

    class NoBrowser:
        def __enter__(self):
            def launch(*a, **k):
                raise RuntimeError("Executable doesn't exist")
            return SimpleNamespace(chromium=SimpleNamespace(launch=launch))

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(pw, "sync_playwright", lambda: NoBrowser())
    write(tmp_path / "decks/a.html", deck(slides=2))
    m = bm.build_manifest(tmp_path, thumbs=True, cache=tmp_path / "cache", use_git=False)
    assert m["count"] == 1 and m["decks"][0]["thumb"] is None and m["decks"][0]["slides"] == 2
    assert "브라우저를 띄우지 못해" in capsys.readouterr().out


def test_safe_out_dir_refuses_dangerous_places(tmp_path):
    root = tmp_path / "repo"
    (root / "decks").mkdir(parents=True)
    for bad in (root, root / "decks", root / "decks" / "x", root / "tools", tmp_path):
        with pytest.raises(SystemExit):
            bm.safe_out_dir(root, bad)
    other = write(tmp_path / "other" / "keep.txt", "x").parent
    with pytest.raises(SystemExit):
        bm.safe_out_dir(root, other)                        # 비어 있지 않고 빌드 표시도 없다
    assert (other / "keep.txt").exists()


def test_prune_cache(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    keep, old = "a" * 16, "b" * 16
    for k in (keep, old):
        (cache / f"{k}.json").write_text("{}")
        (cache / f"{k}.webp").write_bytes(b"x")
    (cache / "notes.txt").write_text("x")
    bm.prune_cache(cache, [{"hash": keep + "0" * 48}])
    assert sorted(p.name for p in cache.iterdir()) == sorted([f"{keep}.json", f"{keep}.webp", "notes.txt"])


def test_guide_deck_preview(tmp_path):
    """견본 덱으로 실제 첫 장 그림과 장 수를 확인한다(Playwright 가 있을 때만)."""
    pytest.importorskip("playwright.sync_api")
    pytest.importorskip("PIL")
    root = tmp_path / "repo"
    src = REPO / "decks/guide/html-slides-guide.html"
    (root / "decks/guide").mkdir(parents=True)
    (root / "decks/guide/html-slides-guide.html").write_bytes(src.read_bytes())
    cache = tmp_path / "cache"
    m = bm.build_manifest(root, thumbs=True, cache=cache, use_git=False)
    d = m["decks"][0]
    assert d["slides"] == 5
    assert d["thumb"] and (cache / Path(d["thumb"]).name).is_file()
    from PIL import Image
    with Image.open(cache / Path(d["thumb"]).name) as img:
        assert img.size == (960, 540)                       # 무대(16:9)만 잘라 찍었다


# ---------------------------------------------------------------- PDF·PPTX

def test_same_name_files_make_one_deck(tmp_path, capsys):
    write(tmp_path / "decks/talk.html", deck(title="HTML 판"))
    (tmp_path / "decks/talk.pdf").write_bytes(samples.make_pdf(2))
    (tmp_path / "decks/talk.pptx").write_bytes(samples.make_pptx(2))
    (tmp_path / "decks/doc.pdf").write_bytes(samples.make_pdf(3))
    (tmp_path / "decks/Doc.pptx").write_bytes(samples.make_pptx(3))      # 이름의 대소문자는 가리지 않는다
    (tmp_path / "decks/only.pptx").write_bytes(samples.make_pptx(4, title="PPTX 제목"))
    write(tmp_path / "decks/two.html", deck(title="둘"))
    write(tmp_path / "decks/two.htm", deck(title="둘 htm"))
    by_id = {d["id"]: d for d in bm.build_manifest(tmp_path, thumbs=False, cache=None, use_git=False)["decks"]}
    assert sorted(by_id) == ["doc", "only", "talk", "two"]
    talk = by_id["talk"]                                    # HTML > PDF > PPTX — 뒤의 것은 붙는 파일
    assert (talk["kind"], talk["path"], talk["pdf"], talk["pptx"]) == (
        "file", "decks/talk.html", "decks/talk.pdf", "decks/talk.pptx")
    assert talk["pdfSize"] == (tmp_path / "decks/talk.pdf").stat().st_size
    assert talk["pdfRev"] == bm.sha256_file(tmp_path / "decks/talk.pdf")[:12]
    assert talk["pptxRev"] == bm.sha256_file(tmp_path / "decks/talk.pptx")[:12]
    assert talk["rev"] == talk["hash"][:12]
    doc = by_id["doc"]
    assert (doc["kind"], doc["path"], doc["pdf"], doc["pptx"]) == ("pdf", "decks/doc.pdf", None, "decks/Doc.pptx")
    assert doc["slides"] is None and doc["title"] == "doc"     # PDF 의 장 수·제목은 뷰어로 열어 본 뒤에 채운다
    only = by_id["only"]
    assert (only["kind"], only["slides"], only["title"], only["pptx"], only["pdf"]) == ("pptx", 4, "PPTX 제목", None, None)
    assert only["size"] == (tmp_path / "decks/only.pptx").stat().st_size
    assert by_id["two"]["path"] == "decks/two.html"
    assert "파일로만 실림): decks/two.htm" in capsys.readouterr().out   # 덱이 되지 못한 파일은 알린다


def test_site_carries_viewer_and_pdf_pptx_decks(tmp_path):
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    write(root / "viewer/pdf.html", "<html>viewer</html>")
    write(root / "vendor/pdfjs/pdf.min.mjs", "export {}")
    pdf = samples.make_pdf(2)
    (root / "decks").mkdir(parents=True)
    (root / "decks/open.pdf").write_bytes(pdf)
    (root / "decks/open.pptx").write_bytes(samples.make_pptx(2))
    (root / "decks/secret.pdf").write_bytes(pdf)
    (root / "decks/secret.pptx").write_bytes(samples.make_pptx(2))
    write(root / "decks/secret.meta.json", json.dumps({"hidden": True}))
    m = bm.build_manifest(root, False, None, False)
    assert [d["id"] for d in m["decks"]] == ["open"]
    out = tmp_path / "site"
    bm.build_site(root, out, m, None)
    built = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    assert [p for p in built if p.startswith("decks/")] == ["decks/open.pdf", "decks/open.pptx"]   # 숨긴 덱은 묶음째 빠진다
    assert "viewer/pdf.html" in built and "vendor/pdfjs/pdf.min.mjs" in built
    assert (out / "decks/open.pdf").read_bytes() == pdf    # PDF 는 바이트 그대로(noindex 는 HTML 에만)


def test_pptx_previews_come_from_the_file(tmp_path, monkeypatch):
    pytest.importorskip("PIL")
    from PIL import Image

    def no_browser(*a, **k):
        raise AssertionError("PPTX 만 있으면 브라우저를 띄우지 않는다")
    monkeypatch.setattr(bm, "serve_preview", no_browser)
    (tmp_path / "decks").mkdir()
    (tmp_path / "decks/a.pptx").write_bytes(samples.make_pptx(3, thumbnail=samples.jpeg((320, 180))))
    (tmp_path / "decks/b.pptx").write_bytes(samples.make_pptx(2))
    (tmp_path / "decks/c.pptx").write_bytes(b"PK not a zip")
    cache = tmp_path / "cache"
    by_id = {d["id"]: d for d in bm.build_manifest(tmp_path, thumbs=True, cache=cache, use_git=False)["decks"]}
    a, b, c = by_id["a"], by_id["b"], by_id["c"]
    assert a["slides"] == 3 and a["thumb"]
    with Image.open(cache / Path(a["thumb"]).name) as img:
        assert img.size == (320, 180)
    assert (b["thumb"], b["slides"]) == (None, 2)
    assert (c["thumb"], c["slides"]) == (None, None)        # 깨진 PPTX 도 덱으로 싣는다(받기만)
    assert json.loads((cache / f"{b['hash'][:16]}.json").read_text(encoding="utf-8"))["noimage"] is True
    monkeypatch.setattr(bm, "pptx_thumbnail", lambda p: pytest.fail("그림이 없던 PPTX 도 캐시를 써야 한다"))
    again = {d["id"]: d for d in bm.build_manifest(tmp_path, thumbs=True, cache=cache, use_git=False)["decks"]}
    assert (again["a"]["thumb"], again["b"]["thumb"], again["a"]["slides"]) == (a["thumb"], None, 3)


def test_pdf_preview_uses_the_site_viewer(tmp_path):
    """사이트의 PDF 뷰어(PDF.js)로 첫 장을 그려 찍고 장 수·제목을 읽는다(Playwright 가 있을 때만)."""
    pytest.importorskip("playwright.sync_api")
    pytest.importorskip("PIL")
    from PIL import Image
    root = tmp_path / "repo"
    for name in ("viewer", "vendor"):
        shutil.copytree(REPO / name, root / name)
    (root / "decks").mkdir()
    (root / "decks/p.pdf").write_bytes(samples.make_pdf(5, info={"Title": "Microsoft PowerPoint - 시험 발표.pptx",
                                                                 "Producer": "test"}))
    (root / "decks/q.pdf").write_bytes(b"%PDF-1.7\nbroken\n")
    cache = tmp_path / "cache"
    by_id = {d["id"]: d for d in bm.build_manifest(root, thumbs=True, cache=cache, use_git=False)["decks"]}
    p = by_id["p"]
    assert (p["slides"], p["title"]) == (5, "시험 발표")     # 내보내기 프로그램이 붙인 앞뒤 군더더기는 뗀다
    with Image.open(cache / Path(p["thumb"]).name) as img:
        w, h = img.size
        rgb = img.convert("RGB")

        def teal(box) -> int:                               # 견본 PDF 의 초록(0,113,94) 화소 수
            part = rgb.crop(box)
            return sum(n for n, (r, g, b) in part.getcolors(part.width * part.height)
                       if r < 60 and 80 < g < 150 and 60 < b < 130)
        text, bar = teal((0, 0, w, int(h * 0.7))), teal((0, int(h * 0.9), w, h))
    assert w <= 960 and h <= 540 and abs(w / h - 16 / 9) < 0.02
    assert bar > w * 5 and text > 300                       # 빈 그림이 아니다 — 아래 막대와 위의 글자가 찍혔다
    assert (by_id["q"]["thumb"], by_id["q"]["slides"]) == (None, None)   # 깨진 PDF 도 싣는다


def test_preview_server_serves_only_site_parts(tmp_path):
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    write(root / "decks/a.html", deck())
    write(root / "decks/_draft/b.html", deck())
    write(root / "decks/.c.html", deck())
    write(root / "viewer/pdf.js", "export {}")
    write(root / "vendor/pdfjs/pdf.min.mjs", "export {}")
    write(root / "tools/secret.py", "SECRET")
    write(root / ".git/config", "[core]")
    try:
        (root / "decks/link.py").symlink_to(root / "tools/secret.py")
        link = True
    except (OSError, NotImplementedError):
        link = False
    httpd, _ = bm.serve_preview(root)
    conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=10)

    def get(path: str) -> tuple[int, str | None]:
        conn.request("GET", path)
        r = conn.getresponse()
        r.read()
        return r.status, r.getheader("Content-Type")
    try:
        assert get("/decks/a.html")[0] == 200
        assert get("/viewer/pdf.js") == (200, "text/javascript")
        assert get("/vendor/pdfjs/pdf.min.mjs") == (200, "text/javascript")   # Windows 레지스트리와 무관하게
        for bad in ("/", "/index.html", "/tools/secret.py", "/.git/config", "/decks/", "/decks/_draft/b.html",
                    "/decks/.c.html", "/decks/../tools/secret.py", "/decks/%2e%2e/tools/secret.py",
                    "/viewer/..%2f.git/config"):
            assert get(bad)[0] == 404, bad
        if link:
            assert get("/decks/link.py")[0] == 404          # 바로가기를 거쳐 밖의 파일을 내주지 않는다
    finally:
        conn.close()
        httpd.shutdown()
        httpd.server_close()


def test_damaged_pptx_parts_do_not_stop_the_build(tmp_path, monkeypatch):
    pytest.importorskip("PIL")
    monkeypatch.setattr(bm, "serve_preview", lambda root: pytest.fail("PPTX 만 있으면 브라우저를 띄우지 않는다"))
    (tmp_path / "decks").mkdir()
    thumb = samples.make_pptx(3, thumbnail=samples.jpeg((320, 180)))
    (tmp_path / "decks/a.pptx").write_bytes(samples.break_member(thumb, "docProps/thumbnail.jpeg"))
    pres = samples.make_pptx(4, title="B 제목")
    (tmp_path / "decks/b.pptx").write_bytes(samples.break_member(pres, "ppt/presentation.xml"))
    cache = tmp_path / "cache"
    by_id = {d["id"]: d for d in bm.build_manifest(tmp_path, thumbs=True, cache=cache, use_git=False)["decks"]}
    assert (by_id["a"]["thumb"], by_id["a"]["slides"]) == (None, 3)        # 깨진 그림 — 그림 없이 싣는다
    assert (by_id["b"]["slides"], by_id["b"]["title"]) == (None, "B 제목")  # 깨진 장 목록 — 제목은 읽는다


def test_pathological_markup_does_not_stall_the_build(tmp_path):
    """짝 없는 태그를 잔뜩 넣은 덱도 금방 끝난다(예전 정규식은 길이의 제곱으로 느려져 빌드가 멈췄다)."""
    import time
    import zipfile
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    write(root / "decks/t.html", "<head " * 10000 + "<title>" * 30000 + "<meta name=description " * 10000
          + "<div class=x " * 30000)
    pptx = root / "decks/p.pptx"
    with zipfile.ZipFile(pptx, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("ppt/presentation.xml", "<p:sldIdLst>" * 50000)
        z.writestr("docProps/core.xml", "<dc:title a" * 50000)
    started = time.perf_counter()
    m = bm.build_manifest(root, False, None, False)
    bm.build_site(root, tmp_path / "site", m, None)
    assert time.perf_counter() - started < 10
    assert sorted(d["id"] for d in m["decks"]) == ["p", "t"]


def test_symlinked_top_folders_are_not_followed(tmp_path):
    outside = tmp_path / "outside"
    write(outside / "secret.txt", "runner secret")
    write(outside / "x.html", deck())
    root = tmp_path / "repo"
    write(root / "index.html", "<html></html>")
    try:
        (root / "vendor").symlink_to(outside, target_is_directory=True)
        (root / "decks").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("이 환경에서는 바로가기(symlink)를 만들 수 없습니다")
    m = bm.build_manifest(root, False, None, False)
    assert m["count"] == 0
    out = tmp_path / "site"
    bm.build_site(root, out, m, None)
    assert not (out / "vendor").exists() and not (out / "decks").exists()


def test_browser_sandbox_falls_back_with_notice(capsys):
    calls = []

    def launch(**kw):
        calls.append(kw)
        if kw.get("chromium_sandbox"):
            raise RuntimeError("No usable sandbox!\n자세한 설명")
        return "browser"
    assert bm.launch_browser(SimpleNamespace(chromium=SimpleNamespace(launch=launch))) == "browser"
    assert calls == [{"chromium_sandbox": True}, {}]                  # 샌드박스를 먼저 시도한다
    out = capsys.readouterr().out
    assert "샌드박스 없이" in out and "No usable sandbox!" in out


def test_vendored_pdfjs_matches_its_sums():
    base = REPO / "vendor/pdfjs"
    listed = dict(reversed(line.split("  ", 1))
                  for line in (base / "SHA256SUMS").read_text(encoding="ascii").splitlines())
    files = {p.relative_to(base).as_posix() for p in base.rglob("*") if p.is_file()} - {"README.md", "SHA256SUMS"}
    assert set(listed) == files                             # 목록에 없는 파일이 끼어들지 않았다
    assert [rel for rel, digest in listed.items() if bm.sha256_file(base / rel) != digest] == []
