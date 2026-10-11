import functools
import hashlib
import http.client
import http.server
import io
import json
import shutil
import stat
import subprocess
import sys
import threading
import time
import zlib
from pathlib import Path
from types import SimpleNamespace

import pytest

import samples
import slides

REPO = Path(__file__).resolve().parents[1]
BS = chr(92)                                                # 역슬래시(Windows 경로 흉내)


def git(cwd: Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(cwd), "-c", "core.quotepath=false", *args],
                       capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return r.stdout


@pytest.fixture
def env(tmp_path, monkeypatch):
    """원격(bare) 저장소 + 작업 저장소 + 저장소 밖 원본 폴더."""
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))     # 확인 질문에 답할 수 없는 환경
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    work = tmp_path / "work"
    git(tmp_path, "init", "-q", "-b", "main", str(work))
    git(work, "config", "user.name", "test")
    git(work, "config", "user.email", "test@example.com")
    git(work, "config", "core.autocrlf", "true")            # 가장 나쁜 설정에서도 덱 바이트가 그대로인지 본다
    shutil.copy(REPO / ".gitattributes", work / ".gitattributes")
    shutil.copy(REPO / ".gitignore", work / ".gitignore")
    (work / "decks").mkdir()
    (work / "README.md").write_text("x\n", encoding="utf-8")
    git(work, "add", "-A")
    git(work, "commit", "-q", "-m", "init")
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "-q", "-u", "origin", "main")
    src = tmp_path / "src"
    src.mkdir()
    return SimpleNamespace(tmp=tmp_path, remote=remote, work=work, src=src)


def run(env, *argv: str) -> int:
    return slides.main(["--root", str(env.work), *argv])


def repo(env) -> slides.Repo:
    return slides.Repo(env.work)


def remote_files(env) -> list[str]:
    return git(env.remote, "ls-tree", "-r", "--name-only", "main").splitlines()


def remote_show(env, path: str) -> str:
    return git(env.remote, "show", f"main:{path}")


def remote_bytes(env, path: str) -> bytes:
    """원격에 실제로 들어간 바이트(줄바꿈 변환 없이)."""
    r = subprocess.run(["git", "-C", str(env.remote), "cat-file", "blob", f"main:{path}"], capture_output=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def subjects(env, n: int = 5) -> list[str]:
    return git(env.remote, "log", f"-{n}", "--format=%s", "main").splitlines()


def web_upload(env, files: dict[str, str | None], message: str = "web upload") -> None:
    """GitHub 웹 화면에서 올린 것처럼, 다른 곳에서 원격에 바로 커밋한다(None 은 지우기)."""
    web = env.tmp / "web"
    if web.exists():
        git(web, "pull", "-q", "--rebase")
    else:
        git(env.tmp, "clone", "-q", str(env.remote), str(web))
        git(web, "config", "user.name", "web")
        git(web, "config", "user.email", "web@example.com")
    for rel, text in files.items():
        p = web / rel
        if text is None:
            p.unlink()
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
    git(web, "add", "-A")
    git(web, "commit", "-q", "-m", message)
    git(web, "push", "-q")


def fake_clock(monkeypatch, on_tick, max_ticks: int) -> None:
    """watch 의 시계와 잠자기를 가짜로 — 잠잘 때마다 시계를 그만큼 돌리고, max_ticks 번째에 Ctrl+C."""
    clock = [1000.0]
    ticks = [0]

    def sleep(sec):
        clock[0] += sec
        ticks[0] += 1
        on_tick(ticks[0])
        if ticks[0] >= max_ticks:
            raise KeyboardInterrupt

    monkeypatch.setattr(slides.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(slides.time, "sleep", sleep)


# ---------------------------------------------------------------- 작은 부품

@pytest.mark.parametrize("raw, want", [
    ("My Talk 2026", "my-talk-2026"),
    ("핵 비확산 발표", "핵-비확산-발표"),
    ("../../etc/passwd", "etcpasswd"),
    ("  ", "deck"),
    ("a--b  c", "a-b-c"),
    ("_draft", "draft"),                                    # _ 나 . 로 시작하면 갤러리가 건너뛴다
    (".hidden.", "hidden"),
    ("CON", "con-deck"),                                    # Windows 예약 이름
    ("x" * 100, "x" * 80),
])
def test_slugify(raw, want):
    assert slides.slugify(raw) == want


def test_find_entry():
    reg = {"decks": {"decks/conf/a.html": {}, "decks/b.html": {}, "decks/x/a.html": {}}}
    assert slides.find_entry(reg, "b") == "decks/b.html"
    assert slides.find_entry(reg, "conf/a") == "decks/conf/a.html"
    assert slides.find_entry(reg, BS.join(["decks", "conf", "a.html"])) == "decks/conf/a.html"
    assert slides.find_entry(reg, "./decks/CONF/A") == "decks/conf/a.html"
    assert slides.find_entry(reg, "zzz") is None
    with pytest.raises(slides.SlidesError):
        slides.find_entry(reg, "a")                         # 둘이 맞는다 — 폴더까지 적어야 한다


def test_readd_hint_keeps_folder_and_pptx():
    hint = slides.readd_hint("decks/conf/a.html", {"source": "C:/s/a.html", "pptx_source": "C:/s/a.pptx"})
    assert hint == 'slides add "C:/s/a.html" --name a --folder conf --pptx "C:/s/a.pptx" --force'
    assert slides.readd_hint("decks/b.html", {"source": "C:/s/b.html"}) == 'slides add "C:/s/b.html" --name b --force'


def test_remember_keeps_recent_unique():
    known: list[str] = []
    for i in range(25):
        slides.remember(known, f"{i:064x}")
    slides.remember(known, f"{10:064x}")
    assert len(known) == slides.KNOWN_MAX
    assert known[-1] == f"{10:064x}" and known.count(f"{10:064x}") == 1


def test_copy_atomic_leaves_no_temp_file(tmp_path):
    dst = tmp_path / "out" / "d.html"
    with pytest.raises(OSError):
        slides.copy_atomic(tmp_path / "missing.html", dst)
    assert list((tmp_path / "out").iterdir()) == []
    src = tmp_path / "s.html"
    src.write_bytes(b"abc")
    assert slides.copy_atomic(src, dst) == hashlib.sha256(b"abc").hexdigest()
    assert dst.read_bytes() == b"abc"


# ---------------------------------------------------------------- add

def test_add_commits_only_deck_files(env):
    deck = env.src / "My Talk.html"
    # 줄바꿈을 섞어 둔다 — 덱이 text 로 다뤄지면 커밋할 때 CRLF 가 LF 로 바뀌어 원격의 바이트가 달라진다
    deck.write_bytes(b"<html><head><title>T</title></head>\n<body>\r\n<p>mixed</p>\n</body></html>\r\n")
    (env.work / "README.md").write_text("changed\n", encoding="utf-8")   # 다른 파일의 고침은 건드리지 않는다
    (env.work / "notes.txt").write_text("untracked\n", encoding="utf-8")
    (env.work / "staged.txt").write_text("staged\n", encoding="utf-8")
    git(env.work, "add", "staged.txt")                      # 미리 담아 둔 것도 덱 커밋에 끼지 않는다
    assert run(env, "add", str(deck), "--folder", "conf", "--folder-label", "학회 발표",
               "--title", "제목", "--date", "2026-10-29", "--yes") == 0

    files = remote_files(env)
    for want in ("decks/conf/my-talk.html", "decks/conf/my-talk.meta.json", "decks/folders.json"):
        assert want in files
    assert "staged.txt" not in files and "notes.txt" not in files
    assert subjects(env)[0] == "docs: 덱 추가 — my-talk"
    assert json.loads(remote_show(env, "decks/conf/my-talk.meta.json")) == {"title": "제목", "date": "2026-10-29"}
    status = git(env.work, "status", "--porcelain")
    assert " M README.md" in status and "?? notes.txt" in status and "A  staged.txt" in status
    # 원본 경로를 적은 등록부는 .git 안에만 있다(공개 저장소에 올라가지 않는다)
    assert (env.work / ".git" / slides.REGISTRY_NAME).is_file()
    assert not any("registry" in f or f.startswith(".sync") for f in files)
    # 원격에도, autocrlf=true 로 다시 받은 사본에도 줄바꿈까지 바이트가 같다
    assert remote_bytes(env, "decks/conf/my-talk.html") == deck.read_bytes()
    clone = env.tmp / "clone"
    git(env.tmp, "clone", "-q", "-c", "core.autocrlf=true", str(env.remote), str(clone))
    assert (clone / "decks/conf/my-talk.html").read_bytes() == deck.read_bytes()


def test_add_of_same_content_does_not_claim_an_upload(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    assert "에 올렸습니다" in capsys.readouterr().out
    assert run(env, "add", str(deck), "--yes") == 0         # 같은 내용을 다시 등록
    out = capsys.readouterr().out
    assert "커밋할 것이 없습니다" in out and "올릴 것이 없습니다" in out and "에 올렸습니다" not in out


def test_add_refuses_sources_inside_repo(env):
    for p in (env.work / "decks" / "inplace.html", env.work / "draft.html"):
        p.write_text("x", encoding="utf-8")
        assert run(env, "add", str(p), "--yes") == 2
    assert not any(f.startswith("decks/") for f in remote_files(env))
    assert not (env.work / ".git" / slides.REGISTRY_NAME).exists()


def test_add_guards(env):
    deck = env.src / "x.html"
    deck.write_text("x", encoding="utf-8")
    assert run(env, "add", str(deck)) == 2                  # --yes 없이는(답할 수 없는 환경) 올리지 않는다
    assert not (env.work / "decks/x.html").exists()
    (env.work / "decks/x.html").write_text("web", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 2         # 등록하지 않은 같은 이름은 --force 없이는 덮지 않는다
    assert (env.work / "decks/x.html").read_text(encoding="utf-8") == "web"
    assert run(env, "add", str(env.src / "missing.html"), "--yes") == 2
    (env.src / "n.txt").write_text("x", encoding="utf-8")
    assert run(env, "add", str(env.src / "n.txt"), "--yes") == 2
    assert run(env, "add", str(deck), "--name", "y", "--pptx", str(env.src / "n.txt"), "--yes") == 2
    assert run(env, "add", str(deck), "--name", "y", "--date", "2026/10/29", "--yes") == 2
    assert not any(f.startswith("decks/") for f in remote_files(env))


def test_add_folder_cannot_escape_decks(env):
    deck = env.src / "e.html"
    deck.write_text("e", encoding="utf-8")
    assert run(env, "add", str(deck), "--folder", "../../evil", "--yes") == 0
    assert "decks/evil/e.html" in remote_files(env)
    assert not (env.tmp / "evil").exists()


def test_add_index_html_takes_folder_name(env, capsys):
    folder = env.src / "KNS 2026"
    folder.mkdir()
    deck = folder / "index.html"
    deck.write_text("<title>i</title>", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    assert "decks/kns-2026.html" in remote_files(env)       # index 로 두면 폴더째 한 덱으로 보이므로
    assert "kns-2026" in capsys.readouterr().out


def test_add_refuses_folder_deck_and_case_clash(env):
    web_upload(env, {"decks/conf/fd/index.html": "fd", "decks/Talks/a.html": "a"})
    deck = env.src / "b.html"
    deck.write_text("b", encoding="utf-8")
    assert run(env, "add", str(deck), "--folder", "conf/fd", "--yes") == 2   # 폴더 덱 안에는 두지 않는다
    assert run(env, "add", str(deck), "--folder", "talks", "--yes") == 2     # Talks 와 대소문자만 다르다
    assert run(env, "add", str(deck), "--folder", "conf", "--yes") == 0
    assert "decks/conf/b.html" in remote_files(env)


def test_scan_blocks_secrets_and_warns_leaks(env, capsys):
    token = "gh" + "p_" + "A1b2" * 9                       # 토큰처럼 보이는 가짜(파일에 그 꼴로 두지 않는다)
    deck = env.src / "s.html"
    deck.write_text(f"<title>s</title><script>const k = '{token}';</script>", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 2
    assert "GitHub 토큰" in capsys.readouterr().out
    assert not (env.work / "decks/s.html").exists()
    assert run(env, "add", str(deck), "--yes", "--ignore-scan") == 0

    other = env.src / "c.html"
    other.write_text("<title>c</title><img src='C:/Users/someone/pic.png'>", encoding="utf-8")
    capsys.readouterr()
    assert run(env, "add", str(other), "--yes") == 0         # 경로 같은 것은 알리기만 한다
    assert "이 PC 의 파일 경로" in capsys.readouterr().out
    other.write_text(f"<title>c</title>{token}", encoding="utf-8")   # 고친 원본에 토큰이 생기면 sync 도 멈춘다
    assert slides.sync(repo(env)) == []
    assert "열쇠·토큰처럼" in capsys.readouterr().out
    assert "someone" in remote_show(env, "decks/c.html")


def test_size_guard(env, monkeypatch, capsys):
    deck = env.src / "big.html"
    deck.write_text("x" * 64, encoding="utf-8")
    monkeypatch.setattr(slides, "SIZE_WARN", 16)
    monkeypatch.setattr(slides, "SIZE_LIMIT", 32)
    assert run(env, "add", str(deck), "--yes") == 2
    monkeypatch.setattr(slides, "SIZE_LIMIT", 1024)
    capsys.readouterr()
    assert run(env, "add", str(deck), "--yes") == 0
    assert "큽니다" in capsys.readouterr().out
    monkeypatch.setattr(slides, "SIZE_LIMIT", 32)
    deck.write_text("y" * 64, encoding="utf-8")
    assert slides.sync(repo(env)) == []                     # 고친 원본이 너무 크면 올리지 않는다
    assert remote_show(env, "decks/big.html") == "x" * 64


# ---------------------------------------------------------------- PDF·PPTX

def fake_token() -> str:
    return "gh" + "p_" + "A1b2" * 9                        # 토큰처럼 보이는 가짜(파일에 그 꼴로 두지 않는다)


def test_deck_paths_by_kind():
    assert slides.deck_paths("decks/a/t.pdf") == {"main": "decks/a/t.pdf", "meta": "decks/a/t.meta.json",
                                                  "pptx": "decks/a/t.pptx"}
    assert slides.deck_paths("decks/t.pptx") == {"main": "decks/t.pptx", "meta": "decks/t.meta.json"}
    assert slides.kinds("decks/t.pptx") == [("main", "source")]
    assert slides.kinds("decks/t.html") == [("main", "source"), ("pptx", "pptx_source")]
    assert slides.group_paths("decks/c/t.PDF") == ["decks/c/t.html", "decks/c/t.htm", "decks/c/t.pdf",
                                                   "decks/c/t.pptx", "decks/c/t.meta.json"]


def test_pdf_strings_and_info():
    text = r"(a\(b\)c\\d\101\
e)"
    assert slides.pdf_string_at(text, 0) == "a(b)c" + BS + "dAe"
    assert slides.pdf_string_at("(a" + BS + "\r\nb)", 0) == "ab"        # CR LF 줄 끝도 이어 쓰기
    assert slides.pdf_string_at("<FEFF D55C AE00>", 0) == "한글"
    assert slides.pdf_string_at("<< /x 1 >>", 0) is None
    # 목차(Outline) 항목도 /Title 을 쓴다 — 문서 정보(Producer·CreationDate 가 함께 있는 사전)의 것만 읽는다
    raw = ("1 0 obj << /Title (Outline item) /Parent 3 0 R >> endobj "
           "9 0 obj << /Title <FEFFC81C BAA9> /Author (Hong) /Producer (x) >> endobj")
    assert slides.pdf_meta(raw) == {"Title": "제목", "Author": "Hong"}
    # 붙여 쓴 '<16진>>>' 와 괄호가 든 글도 사전 끝을 맞게 찾는다
    assert slides.pdf_meta("7 0 obj <</Producer(x)/Title<FEFFC81CBAA9>>> endobj") == {"Title": "제목"}
    assert slides.pdf_meta("<< /Title (a (b) c) /Producer (p) /Author <FEFF0041> >>") == {"Title": "a (b) c",
                                                                                     "Author": "A"}
    # XMP: 빈 제목이 다음 항목(만든 이)을 끌어오지 않는다
    xmp = ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description>'
           '<dc:title><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></dc:title>'
           '<dc:creator><rdf:Seq><rdf:li>Kim &amp; Lee</rdf:li></rdf:Seq></dc:creator>'
           '</rdf:Description></rdf:RDF></x:xmpmeta>')
    assert slides.pdf_meta(xmp) == {"Author": "Kim & Lee"}
    # 조작한 입력에도 금방 끝난다(예전 정규식은 길이의 제곱으로 느려졌다)
    started = time.perf_counter()
    for crafted in ("<< /Producer" * 100000, ("<< /Producer (" + "a" * 16000 + ") >>") * 200,
                    "<x:xmpmeta>" + "<dc:title>" * 50000, "<x:xmpmeta><dc:title>" + "<rdf:li " * 50000):
        assert slides.pdf_meta(crafted) == {}
    assert time.perf_counter() - started < 5


def test_add_pdf_deck_with_pptx(env, capsys):
    pdf = env.src / "Talk.pdf"
    pdf.write_bytes(samples.make_pdf(3, info={"Title": "PDF 제목", "Author": "홍길동", "Producer": "test"}))
    pptx = env.src / "Talk.pptx"
    pptx.write_bytes(samples.make_pptx(3, creator="홍길동", notes=2))
    assert run(env, "add", str(pdf), "--pptx", str(pptx), "--folder", "conf", "--yes") == 0
    out = capsys.readouterr().out
    assert "decks/conf/talk.pdf" in out and "제목: PDF 제목" in out
    assert "만든 이: 홍길동" in out and "PPTX 만든 이: 홍길동" in out and "PPTX 발표자 노트 2장" in out
    assert "PDF 본문 글자는 다 훑지 못합니다" in out
    files = remote_files(env)
    assert "decks/conf/talk.pdf" in files and "decks/conf/talk.pptx" in files
    assert remote_bytes(env, "decks/conf/talk.pdf") == pdf.read_bytes()        # 바이너리도 바이트 그대로
    entry = slides.load_registry(repo(env))["decks"]["decks/conf/talk.pdf"]
    assert sorted(entry["known"]) == ["main", "pptx"] and entry["pptx_source"] == str(pptx.resolve())

    pdf.write_bytes(samples.make_pdf(4))                    # 원본을 고치면 sync 가 따라간다
    assert slides.sync(repo(env)) == ["talk"]
    assert remote_bytes(env, "decks/conf/talk.pdf") == pdf.read_bytes()
    pptx.write_bytes(samples.make_pptx(4))
    assert slides.sync(repo(env)) == ["talk"]
    assert remote_bytes(env, "decks/conf/talk.pptx") == pptx.read_bytes()
    run(env, "list")
    assert "상태: 같음" in capsys.readouterr().out


def test_add_pptx_deck(env, capsys, monkeypatch):
    deck = env.src / "slides.pptx"
    deck.write_bytes(samples.make_pptx(5, title="PPTX 제목"))
    other = env.src / "other.pptx"
    other.write_bytes(samples.make_pptx(1))
    assert run(env, "add", str(deck), "--pptx", str(other), "--yes") == 2   # PPTX 덱에는 붙일 PPTX 가 없다
    monkeypatch.setattr(slides, "OFFICE_MAX", 100)
    capsys.readouterr()
    assert run(env, "add", str(deck), "--yes") == 0
    out = capsys.readouterr().out
    assert "제목: PPTX 제목" in out and "Microsoft Office 웹 뷰어" in out and "10 MB 가 넘어" in out
    assert "decks/slides.pptx" in remote_files(env)
    entry = slides.load_registry(repo(env))["decks"]["decks/slides.pptx"]
    assert entry["pptx_source"] is None and list(entry["known"]) == ["main"]
    deck.write_bytes(samples.make_pptx(6))
    assert slides.sync(repo(env)) == ["slides"]
    assert remote_bytes(env, "decks/slides.pptx") == deck.read_bytes()


def test_pdf_and_pptx_are_scanned(env, capsys):
    token = fake_token()
    flate = zlib.compress(f"BT ({token}) Tj ET".encode("ascii"))
    hidden = b"<< /Length " + str(len(flate)).encode() + b" /Filter /FlateDecode >>\nstream\n" + flate + b"\nendstream"
    pdf = env.src / "s.pdf"
    pdf.write_bytes(samples.make_pdf(2, extra=[hidden]))    # 압축한 흐름 안의 토큰도 찾는다
    assert run(env, "add", str(pdf), "--yes") == 2
    assert "GitHub 토큰" in capsys.readouterr().out
    assert not (env.work / "decks/s.pdf").exists()

    plain = env.src / "p.pdf"
    plain.write_bytes(samples.make_pdf(2, info={"Title": "C:/Users/someone/deck.pptx", "Producer": "x"}))
    capsys.readouterr()
    assert run(env, "add", str(plain), "--yes") == 0        # 경로는 알리기만 한다
    assert "이 PC 의 파일 경로" in capsys.readouterr().out
    plain.write_bytes(samples.make_pdf(2, info={"Keywords": token, "Producer": "x"}))
    assert slides.sync(repo(env)) == []                     # 고친 PDF 에 토큰이 생기면 올리지 않는다
    assert "열쇠·토큰처럼" in capsys.readouterr().out

    pptx = env.src / "t.pptx"
    pptx.write_bytes(samples.make_pptx(2, text=token))
    assert run(env, "add", str(pptx), "--yes") == 2
    html = env.src / "h.html"
    html.write_text("<title>h</title>", encoding="utf-8")
    assert run(env, "add", str(html), "--pptx", str(pptx), "--yes") == 2     # 함께 올리는 PPTX 도 본다
    assert "PPTX GitHub 토큰" in capsys.readouterr().out
    assert run(env, "add", str(html), "--pptx", str(pptx), "--yes", "--ignore-scan") == 0


def test_pptx_hidden_parts_and_damage_are_reported(env, capsys):
    deck = env.src / "e.pptx"
    deck.write_bytes(samples.make_pptx(3, embeds=2, svg="<svg><text>C:/Users/someone/pic.png</text></svg>"))
    assert run(env, "add", str(deck), "--yes") == 0
    out = capsys.readouterr().out
    assert "PPTX 안에 붙은 파일 2개" in out and "이 PC 의 파일 경로" in out     # SVG 안의 글도 훑는다
    # 압축이 깨진 조각이 있어도 멈추지 않고(예전에는 zlib.error 로 죽었다), 점검하지 못한 것을 알린다
    deck.write_bytes(samples.break_member(samples.make_pptx(3), "ppt/slides/slide2.xml"))
    assert run(env, "add", str(deck), "--yes") == 0
    assert "글 조각 1개는 너무 크거나 깨져 점검하지 못했습니다" in capsys.readouterr().out
    deck.write_bytes(samples.break_member(samples.make_pptx(4), "ppt/slides/slide3.xml"))
    assert slides.sync(repo(env)) == ["e"]                  # sync·watch 도 멈추지 않는다
    token = env.src / "t.pptx"
    token.write_bytes(samples.make_pptx(2, svg="<svg><text>" + fake_token() + "</text></svg>"))
    assert run(env, "add", str(token), "--yes") == 2
    assert "GitHub 토큰" in capsys.readouterr().out


def test_same_name_decks_do_not_collide(env, capsys):
    """갤러리는 이름이 같은 파일을 한 덱으로 묶는다(HTML > PDF > PPTX) — 다른 덱 밑에 숨지 않게 막는다."""
    html = env.src / "talk.html"
    html.write_text("<title>t</title>", encoding="utf-8")
    assert run(env, "add", str(html), "--yes") == 0
    pdf = env.src / "talk.pdf"
    pdf.write_bytes(samples.make_pdf(2))
    assert run(env, "add", str(pdf), "--yes") == 2          # 등록한 talk.html 과 이름이 같다
    web_upload(env, {"decks/w.pdf": "pdf"})
    pptx = env.src / "w.pptx"
    pptx.write_bytes(samples.make_pptx(2))
    assert run(env, "add", str(pptx), "--yes") == 2         # w.pdf 밑에 붙어 보이지 않게 된다
    # 뒤 차례의 파일은 이 덱에 붙는다 — 웹에서 올린 v.pptx 옆에 v.pdf 를 올리면 PDF 덱에 PPTX 가 붙는다
    web_upload(env, {"decks/v.pptx": "pptx"})
    v = env.src / "v.pdf"
    v.write_bytes(samples.make_pdf(2))
    capsys.readouterr()
    assert run(env, "add", str(v), "--yes") == 0
    assert "이름이 같은 decks/v.pptx 는 이 덱에 붙습니다" in capsys.readouterr().out
    # 그 PPTX 를 이 PC 의 다른 PPTX 로 덮으려면 --force
    assert run(env, "add", str(v), "--pptx", str(pptx), "--yes") == 2
    assert remote_show(env, "decks/v.pptx") == "pptx"
    assert run(env, "add", str(v), "--pptx", str(pptx), "--yes", "--force") == 0
    assert remote_bytes(env, "decks/v.pptx") == pptx.read_bytes()


def test_remove_takes_the_whole_name_group(env):
    pdf = env.src / "g.pdf"
    pdf.write_bytes(samples.make_pdf(2))
    pptx = env.src / "g.pptx"
    pptx.write_bytes(samples.make_pptx(2))
    assert run(env, "add", str(pdf), "--pptx", str(pptx), "--title", "G", "--yes") == 0
    web_upload(env, {"decks/g.html": "html 판"})           # 웹에서 같은 이름의 HTML 판을 더 올렸다
    assert run(env, "remove", "decks/g.pptx", "--yes") == 0    # 확장자를 적어도 덱 하나(묶음)째 내린다
    assert not any(f.startswith("decks/g.") for f in remote_files(env))
    assert slides.load_registry(repo(env))["decks"] == {}
    pdf.write_bytes(samples.make_pdf(3))
    assert slides.sync(repo(env)) == []                     # 되살아나지 않는다
    web_upload(env, {"decks/web/only.pptx": "p", "decks/web/only.meta.json": "{}"})
    assert run(env, "remove", "web/only", "--yes") == 0     # 웹에서만 올린 PPTX 덱도 이름으로
    assert not any(f.startswith("decks/web/") for f in remote_files(env))


# ---------------------------------------------------------------- sync

def test_sync_and_retry_after_failed_push(env):
    deck = env.src / "d.html"
    deck.write_text("<title>v1</title>", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("<title>v2</title>", encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]
    assert subjects(env)[0] == "docs: 덱 갱신 — d"
    assert remote_show(env, "decks/d.html") == "<title>v2</title>"

    away = env.remote.with_name("away.git")                 # 원격이 잠시 안 되는 경우
    env.remote.rename(away)
    deck.write_text("<title>v3</title>", encoding="utf-8")
    with pytest.raises(slides.OfflineError):
        slides.sync(repo(env))
    away.rename(env.remote)
    r = repo(env)
    assert r.unpushed()
    assert slides.sync(r) == []                             # 바뀐 원본은 없어도
    assert remote_show(env, "decks/d.html") == "<title>v3</title>"   # 못 올린 커밋을 마저 올린다
    assert not r.unpushed()


def test_web_upload_is_held_not_overwritten(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    web_upload(env, {"decks/d.html": "web"})                # 웹에서 새 판을 올렸다(이 PC 는 아직 모름)
    deck.write_text("v2", encoding="utf-8")
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    out = capsys.readouterr().out
    assert (env.work / "decks/d.html").read_text(encoding="utf-8") == "web"   # 받아 왔고, 덮지 않았다
    assert remote_show(env, "decks/d.html") == "web"
    assert "덮지 않았습니다" in out and "--force" in out
    run(env, "list")
    assert "저장소 쪽이 바뀜" in capsys.readouterr().out
    assert run(env, "add", str(deck), "--yes") == 2         # add 도 --force 없이는 덮지 않는다
    assert run(env, "add", str(deck), "--yes", "--force") == 0
    assert remote_show(env, "decks/d.html") == "v2"
    deck.write_text("v3", encoding="utf-8")                 # 덮은 뒤로는 다시 원본을 따른다
    assert slides.sync(repo(env)) == ["d"]
    assert remote_show(env, "decks/d.html") == "v3"


def test_offline_commit_meets_web_upload(env, capsys, monkeypatch):
    """이 PC 에만 커밋한 판과 웹에서 올린 판이 같은 덱에서 부딪치면 원격 쪽을 따르고 알린다."""
    monkeypatch.setenv("GIT_EDITOR", "false")               # 사용자의 편집기 설정이 rebase 를 막거나 커밋을 버리지 않는다
    a, b = env.src / "a.html", env.src / "b.html"
    a.write_text("a1", encoding="utf-8")
    b.write_text("b1", encoding="utf-8")
    assert run(env, "add", str(a), "--yes") == 0
    assert run(env, "add", str(b), "--yes") == 0
    a.write_text("a2", encoding="utf-8")
    b.write_text("b2", encoding="utf-8")
    assert slides.sync(repo(env), push=False) == ["a", "b"]     # 오프라인이라 커밋만 했다
    web_upload(env, {"decks/a.html": "web-a", "decks/w.html": "w"})
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    out = capsys.readouterr().out
    assert "decks/a.html: 원격의 판" in out and "덮지 않았습니다" in out
    assert remote_show(env, "decks/a.html") == "web-a"      # 부딪친 덱은 원격 쪽
    assert remote_show(env, "decks/b.html") == "b2"         # 부딪치지 않은 덱은 올라갔다
    assert remote_show(env, "decks/w.html") == "w"
    assert a.read_text(encoding="utf-8") == "a2"            # 이 PC 의 원본은 그대로
    assert not repo(env).rebase_in_progress()


def test_two_sided_deck_edits_are_not_mixed(env, capsys):
    """두 곳에서 한 덱의 다른 곳을 고쳐도 git 이 섞은 판(아무도 쓰지 않은 판)을 올리지 않는다."""
    lines = [f"<p>{i}</p>" for i in range(20)]
    deck = env.src / "d.html"
    deck.write_bytes("\n".join(lines).encode("utf-8"))
    assert run(env, "add", str(deck), "--yes") == 0
    local, web = list(lines), list(lines)
    local[18], web[1] = "<p>이 PC</p>", "<p>웹</p>"
    deck.write_bytes("\n".join(local).encode("utf-8"))
    assert slides.sync(repo(env), push=False) == ["d"]
    web_upload(env, {"decks/d.html": "\n".join(web)})
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    assert remote_show(env, "decks/d.html") == "\n".join(web)
    assert "덮지 않았습니다" in capsys.readouterr().out


def test_local_commits_not_made_by_slides_block_merging(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    (env.work / "README.md").write_text("local\n", encoding="utf-8")
    git(env.work, "commit", "-q", "-am", "local readme")
    web_upload(env, {"README.md": "web\n"})
    head = git(env.work, "rev-parse", "HEAD")
    with pytest.raises(slides.SlidesError, match="local readme"):
        slides.sync(repo(env))
    assert git(env.work, "rev-parse", "HEAD") == head       # 손대지 않았다
    assert not repo(env).rebase_in_progress()


def test_conflicting_info_file_stops_without_losing_either_side(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--title", "처음", "--yes") == 0
    meta = env.work / "decks/d.meta.json"
    meta.write_text('{"title": "이 PC 에서 고침"}\n', encoding="utf-8")
    assert slides.sync(repo(env), push=False) == ["d"]
    web_upload(env, {"decks/d.meta.json": '{"title": "웹에서 고침"}\n'})
    head = git(env.work, "rev-parse", "HEAD")
    with pytest.raises(slides.SlidesError, match="d.meta.json"):
        slides.sync(repo(env))                              # 원본이 따로 없는 파일은 원격 쪽을 따르지 않는다
    assert git(env.work, "rev-parse", "HEAD") == head
    assert "이 PC 에서 고침" in meta.read_text(encoding="utf-8")
    assert json.loads(remote_show(env, "decks/d.meta.json")) == {"title": "웹에서 고침"}
    assert not repo(env).rebase_in_progress()


def test_other_changes_in_the_repo_are_left_alone(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    (env.work / "README.md").write_text("staged\n", encoding="utf-8")
    git(env.work, "add", "README.md")
    web_upload(env, {"decks/w.html": "w"})
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]                  # 앞으로 감기만 할 때는 다른 고침을 그대로 둔다
    assert "M  README.md" in git(env.work, "status", "--porcelain")
    assert remote_show(env, "README.md") == "x\n"
    deck.write_text("v3", encoding="utf-8")                 # 올리지 못한 커밋을 다시 얹어야 할 때는
    assert slides.sync(repo(env), push=False) == ["d"]
    web_upload(env, {"decks/w2.html": "w2"})
    with pytest.raises(slides.SlidesError, match="README.md"):
        slides.sync(repo(env))                              # 고치던 파일이 있으면 손대지 않고 멈춘다
    assert "M  README.md" in git(env.work, "status", "--porcelain")
    assert git(env.work, "stash", "list") == ""


def purge_remote(env) -> None:
    """다른 곳에서 덱을 기록째 지우고 force-push 한다(첫 커밋만 남기고 다시 씀)."""
    purge = env.tmp / "purge"
    git(env.tmp, "clone", "-q", str(env.remote), str(purge))
    git(purge, "config", "user.name", "web")
    git(purge, "config", "user.email", "web@example.com")
    git(purge, "reset", "-q", "--hard", git(purge, "rev-list", "--max-parents=0", "HEAD").split()[0])
    (purge / "NOTE.md").write_text("purged\n", encoding="utf-8")
    git(purge, "add", "-A")
    git(purge, "commit", "-q", "-m", "rewritten")
    git(purge, "push", "-q", "--force")


def test_history_rewrite_is_not_undone(env):
    """원격의 기록을 고쳐 쓴(force-push) 뒤 이 PC 의 옛 커밋을 다시 얹어 올리지 않는다 — 지운 내용이 되살아나지 않게."""
    deck = env.src / "a.html"
    deck.write_text("secret v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    purge_remote(env)
    deck.write_text("secret v2", encoding="utf-8")
    with pytest.raises(slides.SlidesError, match="고쳐 쓰였"):
        slides.sync(repo(env))
    assert "decks/a.html" not in remote_files(env)
    # 안내를 반만 따라도(받아 오기만 하고 reset 은 빠뜨림, slides 의 기준 ref 까지 지움 — IDE 가 먼저 받아 온 것과 같다)
    # 이 PC 에 옛 기록이 남아 있는 한 계속 멈춘다
    git(env.work, "fetch", "-q", "origin")
    git(env.work, "update-ref", "-d", slides.LAST_UP_REF)
    with pytest.raises(slides.SlidesError, match="고쳐 쓰였"):
        slides.sync(repo(env))
    assert "decks/a.html" not in remote_files(env)
    assert subjects(env, 1) == ["rewritten"]
    # 안내대로 원격에 맞추면(reset) 다시 지켜보고, 지워진 덱은 되살리지 않는다
    git(env.work, "reset", "-q", "--hard", "origin/main")
    assert slides.sync(repo(env)) == []
    assert "decks/a.html" not in remote_files(env)
    deck2 = env.src / "b.html"                              # 새 덱은 평소처럼 올라간다
    deck2.write_text("b", encoding="utf-8")
    assert run(env, "add", str(deck2), "--yes") == 0
    assert "decks/b.html" in remote_files(env)


def test_purged_commits_replayed_by_rebase_are_refused(env):
    """원격에서 기록째 지운 커밋을 reset 대신 rebase 로 다시 얹어도(SHA 가 바뀌어도) 올리지 않는다."""
    deck = env.src / "a.html"
    deck.write_text("secret v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    purge_remote(env)
    git(env.work, "fetch", "-q", "origin")
    git(env.work, "rebase", "-q", "origin/main")             # '내 커밋은 살리자' 며 원격 위로 다시 얹었다
    with pytest.raises(slides.SlidesError, match="고쳐 쓰였"):
        slides.sync(repo(env))
    assert "decks/a.html" not in remote_files(env)


def test_local_purge_is_not_undone(env):
    """이 PC 에서 이미 올린 커밋을 기록에서 빼고 force-push 하기 전에 원본을 고쳐도, 뺀 커밋을 다시 받아 합치지 않는다."""
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("leaked", encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]                   # 실수로 올렸다
    leak = git(env.work, "rev-parse", "HEAD").strip()
    git(env.work, "reset", "-q", "--hard", "HEAD~1")          # 기록에서 뺐다(아직 force-push 전)
    deck.write_text("v2", encoding="utf-8")                   # 원본을 고치자 watch 가 돈다
    with pytest.raises(slides.SlidesError, match="뺐는데"):
        slides.sync(repo(env))
    assert git(env.work, "rev-parse", "HEAD").strip() != leak
    git(env.work, "push", "-q", "--force-with-lease", "origin", "main")   # 안내대로 원격도 고친다
    assert slides.sync(repo(env)) == []                       # 이제 멈추지 않는다(되돌린 사본은 덮지 않고 알림)
    assert run(env, "add", str(deck), "--force", "--yes") == 0
    assert remote_show(env, "decks/d.html") == "v2"
    r = subprocess.run(["git", "-C", str(env.remote), "merge-base", "--is-ancestor", leak, "main"])
    assert r.returncode == 1                                  # 새어 나간 판은 원격 기록에 없다


def test_local_purge_of_hand_pushed_commit_is_not_undone(env):
    """손으로 push 한 커밋을 기록에서 빼면 — 그사이 slides 가 한 번도 돌지 않았어도 — 다시 받아 합치지 않는다."""
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    base = git(env.work, "rev-parse", "HEAD").strip()
    (env.work / "NOTES.md").write_text("secret\n", encoding="utf-8")
    git(env.work, "add", "NOTES.md")
    git(env.work, "commit", "-q", "-m", "notes")
    git(env.work, "push", "-q", "origin", "main")            # 손으로 올렸다가
    git(env.work, "reset", "-q", "--hard", base)              # 곧 기록에서 뺐다(force-push 전)
    deck.write_text("v2", encoding="utf-8")
    with pytest.raises(slides.SlidesError, match="뺐는데"):
        slides.sync(repo(env))
    assert not (env.work / "NOTES.md").exists()


def test_undoing_a_merge_pull_is_not_taken_for_a_purge(env):
    """손으로 merge pull 했다가 되돌려도, 그 merge 로 들어왔던 남의 커밋을 '이 PC 에서 뺀 커밋'으로 보지 않는다."""
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env), push=False) == ["d"]       # 오프라인에서 고친 판
    web_upload(env, {"decks/other.html": "<title>o</title>"})   # 그사이 웹에서 올렸다
    git(env.work, "pull", "-q", "--no-rebase", "--no-edit", "origin", "main")
    with pytest.raises(slides.SlidesError, match="만들지 않은"):   # merge 커밋은 slides 가 올리지 않는다
        slides.sync(repo(env))
    git(env.work, "reset", "-q", "--hard", "HEAD~1")          # merge 를 되돌렸다
    slides.sync(repo(env))                                    # 이제 평소처럼 원격 위로 얹어 올린다
    assert remote_show(env, "decks/d.html") == "v2"
    assert "decks/other.html" in remote_files(env)


def test_same_second_commits_are_not_taken_for_replays(env, monkeypatch):
    """작성 시각이 같아도(같은 초·고정된 GIT_AUTHOR_DATE) 내용이 다른 새 커밋은 지운 커밋을 다시 얹은 것으로 보지 않는다."""
    monkeypatch.setenv("GIT_AUTHOR_DATE", "2026-01-01T00:00:00+09:00")
    deck = env.src / "a.html"
    deck.write_text("secret v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    purge_remote(env)
    git(env.work, "fetch", "-q", "origin")
    git(env.work, "reset", "-q", "--hard", "origin/main")    # 안내대로 원격에 맞췄다
    deck2 = env.src / "b.html"
    deck2.write_text("b", encoding="utf-8")
    assert run(env, "add", str(deck2), "--yes") == 0
    assert "decks/b.html" in remote_files(env)
    assert "decks/a.html" not in remote_files(env)


def test_deletions_elsewhere_are_not_undone(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    web_upload(env, {"decks/d.html": None})                 # 웹에서 지웠다(다른 PC 에서 내린 것도 같다)
    deck.write_text("v2", encoding="utf-8")
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    assert "decks/d.html" not in remote_files(env)
    assert "되살리지 않았습니다" in capsys.readouterr().out
    run(env, "list")
    assert "저장소에서 지워짐" in capsys.readouterr().out
    assert run(env, "add", str(deck), "--yes") == 0         # 다시 올리는 것은 add 로 분명히
    assert remote_show(env, "decks/d.html") == "v2"


def test_offline_edit_meets_web_delete(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env), push=False) == ["d"]      # 오프라인에서 고친 판
    web_upload(env, {"decks/d.html": None})                 # 그사이 웹에서 지웠다
    assert slides.sync(repo(env)) == []
    assert "decks/d.html" not in remote_files(env)          # 지운 쪽을 따르고 같은 차례에 되살리지 않는다
    assert not repo(env).rebase_in_progress()
    assert deck.read_text(encoding="utf-8") == "v2"


def test_revert_elsewhere_is_not_undone(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]
    web_upload(env, {"decks/d.html": "v1"})                 # 웹에서 예전 판으로 되돌렸다
    deck.write_text("v3", encoding="utf-8")
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    assert remote_show(env, "decks/d.html") == "v1"
    assert "예전에 올린 판으로 되돌려져" in capsys.readouterr().out


def test_commits_not_made_by_slides_are_not_pushed(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    (env.work / "README.md").write_text("work in progress\n", encoding="utf-8")
    git(env.work, "commit", "-q", "-am", "wip readme")
    deck.write_text("v2", encoding="utf-8")
    with pytest.raises(slides.SlidesError, match="wip readme"):
        slides.sync(repo(env))
    assert remote_show(env, "README.md") == "x\n" and remote_show(env, "decks/d.html") == "v1"
    git(env.work, "push", "-q", "origin", "main")           # 사용자가 살펴보고 직접 올리면
    deck.write_text("v3", encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]                  # 그다음부터는 다시 slides 가 올린다
    assert remote_show(env, "decks/d.html") == "v3"


def test_vanished_remote_branch_is_not_refilled(env):
    """원격 브랜치가 없어지면(저장소를 지우고 다시 만듦 등) 이 PC 의 옛 기록을 알아서 다시 채우지 않는다."""
    deck = env.src / "a.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    git(env.remote, "update-ref", "-d", "refs/heads/main")      # 다른 곳에서 브랜치(저장소)를 지웠다
    deck.write_text("v2", encoding="utf-8")
    with pytest.raises(slides.SlidesError, match="없어졌"):
        slides.sync(repo(env))
    assert git(env.remote, "for-each-ref", "refs/heads").strip() == ""
    # 살펴본 뒤 직접 올리면 그다음부터 slides 가 다시 올린다
    git(env.work, "push", "-q", "-u", "origin", "main")
    assert slides.sync(repo(env)) == ["a"]
    assert remote_show(env, "decks/a.html") == "v2"


@pytest.mark.parametrize("how", ["file", "message"])
def test_amended_slides_commit_is_not_trusted(env, how):
    """slides 의 커밋을 손으로 고쳐 쓰면(decks/ 아래에 파일을 끼워 넣거나 메시지를 고침) 그 커밋은 올리지 않는다."""
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env), push=False) == ["d"]
    if how == "file":
        (env.work / "decks" / "private-notes.md").write_text("private\n", encoding="utf-8")
        git(env.work, "add", "decks/private-notes.md")
        git(env.work, "commit", "-q", "--amend", "--no-edit")
    else:
        subject = git(env.work, "log", "-1", "--format=%s").strip()
        git(env.work, "commit", "-q", "--amend", "-m", subject, "-m", "private note")
    with pytest.raises(slides.SlidesError, match="만들지 않은"):
        slides.sync(repo(env))
    assert "decks/private-notes.md" not in remote_files(env)
    assert "private note" not in git(env.remote, "log", "--format=%B", "main")
    assert remote_show(env, "decks/d.html") == "v1"


def test_push_refused_by_remote_is_not_treated_as_offline(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    hook = env.remote / "hooks" / "pre-receive"             # GitHub 의 비밀 정보 차단처럼 받지 않는다
    hook.write_text("#!/bin/sh\necho 'GH013: Repository rule violations found' >&2\nexit 1\n",
                    encoding="utf-8", newline="\n")
    hook.chmod(hook.stat().st_mode | stat.S_IEXEC)
    deck.write_text("v2", encoding="utf-8")
    with pytest.raises(slides.SlidesError, match="받지 않았습니다") as caught:
        slides.sync(repo(env))
    assert not isinstance(caught.value, slides.OfflineError)


def test_broken_info_file_is_not_uploaded(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--title", "처음", "--yes") == 0
    (env.work / "decks/d.meta.json").write_text('{"title": "깨진', encoding="utf-8")
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    assert "JSON 으로 읽히지 않아" in capsys.readouterr().out
    assert json.loads(remote_show(env, "decks/d.meta.json")) == {"title": "처음"}


def test_force_on_html_keeps_pptx_history(env):
    deck, pptx = env.src / "p.html", env.src / "p.pptx"
    deck.write_text("v1", encoding="utf-8")
    pptx.write_bytes(b"PK1")
    assert run(env, "add", str(deck), "--pptx", str(pptx), "--yes") == 0
    web_upload(env, {"decks/p.html": "web"})
    deck.write_text("v2", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes", "--force") == 0     # HTML 만 덮었다
    pptx.write_bytes(b"PK2")
    assert slides.sync(repo(env)) == ["p"]                  # PPTX 의 새 판도 계속 올라간다
    assert remote_bytes(env, "decks/p.pptx") == b"PK2"


def test_sync_restores_deleted_copy_and_skips_missing_source(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    (env.work / "decks/d.html").unlink()                    # 저장소 쪽 사본을 지워도 지우기는 커밋되지 않는다
    assert slides.sync(repo(env)) == []
    assert (env.work / "decks/d.html").read_text(encoding="utf-8") == "v1"
    deck.unlink()                                           # 원본이 없어져도 저장소의 덱은 그대로
    capsys.readouterr()
    assert slides.sync(repo(env)) == []
    assert "원본이 없어" in capsys.readouterr().out
    assert remote_show(env, "decks/d.html") == "v1"


def test_sync_commits_only_registered_decks(env):
    web_upload(env, {"decks/web/w.html": "w"})
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0         # 웹에서 올린 덱도 함께 받아 온다
    (env.work / "decks/web/w.html").unlink()                # 이 PC 에서 지운 웹 덱 — 올리지 않는다
    (env.work / "decks/stray.html").write_text("s", encoding="utf-8")   # 등록하지 않은 새 파일 — 올리지 않는다
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]
    files = remote_files(env)
    assert "decks/web/w.html" in files and "decks/stray.html" not in files
    assert remote_show(env, "decks/d.html") == "v2"


def test_meta_edit_is_committed_by_sync(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--title", "처음", "--yes") == 0
    (env.work / "decks/d.meta.json").write_text('{"title": "고친 제목", "order": 1}\n', encoding="utf-8")
    assert slides.sync(repo(env)) == ["d"]
    assert json.loads(remote_show(env, "decks/d.meta.json")) == {"title": "고친 제목", "order": 1}
    assert subjects(env)[0] == "docs: 덱 갱신 — d"


def test_leftover_copy_is_committed(env):
    """복사한 뒤 커밋 전에 멈췄다면 다음 sync 가 마저 담는다."""
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    deck.write_text("v2", encoding="utf-8")
    r = repo(env)
    reg = slides.load_registry(r)
    assert slides.copy_changed(r, reg, quiet=True) == ["decks/d.html"]
    slides.save_registry(r, reg)                            # 여기서 멈췄다고 친다
    assert slides.sync(r) == ["d"]
    assert remote_show(env, "decks/d.html") == "v2"
    assert git(env.work, "status", "--porcelain", "--", "decks") == ""


def test_registry_is_validated(env, capsys):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    r = repo(env)
    path = slides.registry_path(r)
    assert path.parent == r.gitdir
    data = json.loads(path.read_text(encoding="utf-8"))
    good = data["decks"]["decks/d.html"]
    digest = good["known"]["main"][0]
    data["decks"].update({
        "decks/../../evil.html": dict(good),
        "decks/_x.html": dict(good),
        "decks/in.html": {**good, "source": str(env.work / "README.html")},
        "decks/rel.html": {**good, "source": "relative.html"},
        "decks/bad.html": "not a dict",
        "outside/x.html": dict(good),
        "decks/k.pdf": dict(good),                                  # 원본(HTML)과 저장소 쪽(PDF)의 종류가 다르다
        "decks/p.pptx": {**good, "source": str(env.src / "p.pptx"), "pptx_source": str(env.src / "q.pptx")},
    })
    # 예전 등록부는 덱 파일의 지문 기록을 'html' 로 적었다 — 'main' 으로 옮겨 읽는다
    data["decks"]["decks/d.html"] = {**good, "known": {"html": ["zz", 3, digest], "evil": ["x"]}}
    path.write_text(json.dumps(data), encoding="utf-8")
    capsys.readouterr()
    reg = slides.load_registry(r)
    assert list(reg["decks"]) == ["decks/d.html"]
    assert reg["decks"]["decks/d.html"]["known"] == {"main": [digest]}
    assert capsys.readouterr().out.count("[경고] 등록부 항목을 무시합니다") == 8


def test_preflight_refuses_unsafe_states(env):
    deck = env.src / "p.html"
    deck.write_text("v1", encoding="utf-8")
    r = repo(env)
    git(env.work, "switch", "-q", "-c", "other")
    assert run(env, "add", str(deck), "--yes") == 2         # site.json 의 브랜치(main)가 아니다
    git(env.work, "switch", "-q", "--detach", "main")
    with pytest.raises(slides.SlidesError, match="detached"):
        slides.sync(r)
    git(env.work, "switch", "-q", "main")
    for name in ("rebase-merge", "MERGE_HEAD", "index.lock"):
        p = r.gitdir / name
        if name == "rebase-merge":
            p.mkdir()
        else:
            p.write_text("", encoding="utf-8")
        with pytest.raises(slides.SlidesError):
            slides.sync(r)
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
    assert slides.sync(r) == []
    assert not any(f.startswith("decks/") for f in remote_files(env))


def test_lock_keeps_a_second_writer_out(env):
    r = repo(env)
    held = slides.Lock(r.gitdir / slides.LOCK_NAME)
    assert held.acquire(0)
    try:
        with pytest.raises(slides.Busy):
            slides.sync(r, wait=0)
    finally:
        held.release()
    assert slides.sync(r, wait=0) == []


# ---------------------------------------------------------------- remove · forget · list

def test_remove_by_path_forms_and_no_resurrection(env):
    deck = env.src / "gone.html"
    deck.write_text("x", encoding="utf-8")
    pptx = env.src / "gone.pptx"
    pptx.write_bytes(b"PK")
    assert run(env, "add", str(deck), "--pptx", str(pptx), "--folder", "conf", "--yes") == 0
    assert "decks/conf/gone.pptx" in remote_files(env)
    assert run(env, "remove", "conf/gone") == 2             # --yes 없이는(답할 수 없는 환경) 지우지 않는다
    assert run(env, "remove", BS.join(["decks", "conf", "gone.html"]), "--yes") == 0
    assert not any(f.startswith("decks/conf/gone") for f in remote_files(env))
    assert subjects(env)[0] == "docs: 덱 삭제 — gone"
    assert deck.exists() and pptx.exists()                  # 저장소 밖의 원본은 그대로
    assert slides.load_registry(repo(env))["decks"] == {}
    deck.write_text("edited", encoding="utf-8")             # 원본을 고쳐도 되살아나지 않는다
    assert slides.sync(repo(env)) == []
    assert not any(f.startswith("decks/conf/gone") for f in remote_files(env))


def test_remove_after_local_delete(env):
    deck = env.src / "d.html"
    deck.write_text("x", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    (env.work / "decks/d.html").unlink()                    # 이 PC 에서 먼저 지웠어도
    assert run(env, "remove", "d", "--yes") == 0            # 원격에서 함께 내린다
    assert "decks/d.html" not in remote_files(env)


def test_remove_web_uploaded_decks(env):
    web_upload(env, {"decks/web/w.html": "w", "decks/web/fd/index.html": "fd", "decks/web/fd/img/a.svg": "<svg/>"})
    assert run(env, "remove", "web/w", "--yes") == 0        # 이 PC 에 아직 없던 덱도 먼저 받아서 내린다
    assert run(env, "remove", "web/fd", "--yes") == 0       # 폴더 덱은 폴더째
    assert not any(f.startswith("decks/web/") for f in remote_files(env))
    assert subjects(env, 2) == ["docs: 덱 삭제 — fd", "docs: 덱 삭제 — w"]


def test_remove_by_path_takes_exactly_that_deck(env):
    deck = env.src / "a.html"
    deck.write_text("conf a", encoding="utf-8")
    assert run(env, "add", str(deck), "--folder", "conf", "--yes") == 0
    web_upload(env, {"decks/a.html": "web a"})
    assert run(env, "remove", "a", "--yes") == 2            # 이름만으로는 둘 가운데 어느 것인지 모른다
    assert run(env, "remove", "decks/a.html", "--yes") == 0
    files = remote_files(env)
    assert "decks/a.html" not in files and "decks/conf/a.html" in files
    assert slides.find_entry(slides.load_registry(repo(env)), "a") == "decks/conf/a.html"


def test_remove_folder_deck_leaves_uncommitted_files(env):
    web_upload(env, {"decks/fd/index.html": "fd", "decks/fd/img/a.svg": "<svg/>"})
    git(env.work, "pull", "-q", "--ff-only")
    (env.work / "decks/fd/notes.txt").write_text("mine", encoding="utf-8")   # 커밋한 적 없는 파일
    assert run(env, "remove", "fd", "--yes") == 0
    assert not any(f.startswith("decks/fd/") for f in remote_files(env))
    assert (env.work / "decks/fd/notes.txt").read_text(encoding="utf-8") == "mine"


def test_remove_folder_deck_forgets_decks_inside(env):
    deck = env.src / "inner.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--folder", "conf", "--yes") == 0
    web_upload(env, {"decks/conf/index.html": "folder deck"})   # conf 폴더가 통째로 한 덱이 되었다
    assert run(env, "remove", "conf", "--yes") == 0
    assert slides.load_registry(repo(env))["decks"] == {}
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env)) == []                     # 안에 있던 덱이 되살아나지 않는다
    assert not any(f.startswith("decks/conf/") for f in remote_files(env))


def test_remove_stays_inside_decks(env):
    for bad in ("../README", "decks/../README.md", "..", "decks", ""):
        assert run(env, "remove", bad, "--yes") == 2, bad
    assert (env.work / "README.md").is_file()
    assert "README.md" in remote_files(env)


def test_offline_removal_is_pushed_later(env):
    deck = env.src / "d.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    assert run(env, "remove", "d", "--yes", "--no-push") == 0   # 등록한 덱이 하나도 남지 않았다
    assert "decks/d.html" in remote_files(env)
    assert slides.sync(repo(env)) == []                     # 그래도 못 올린 커밋은 마저 올린다
    assert "decks/d.html" not in remote_files(env)


def test_forget_keeps_uploaded_deck(env):
    deck = env.src / "f.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    assert run(env, "forget", "f") == 0
    assert run(env, "forget", "f") == 2                     # 이미 등록에서 뺐다
    assert slides.load_registry(repo(env))["decks"] == {}
    deck.write_text("v2", encoding="utf-8")
    assert slides.sync(repo(env)) == []
    assert remote_show(env, "decks/f.html") == "v1"


def test_list_status(env, capsys):
    deck = env.src / "s.html"
    deck.write_text("a", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    capsys.readouterr()
    run(env, "list")
    assert "상태: 같음" in capsys.readouterr().out
    deck.write_text("bb", encoding="utf-8")
    run(env, "list")
    assert "상태: 바뀜(올릴 것)" in capsys.readouterr().out
    deck.unlink()
    run(env, "list")
    assert "상태: 원본 없음" in capsys.readouterr().out


# ---------------------------------------------------------------- watch

def watch_args() -> SimpleNamespace:
    return SimpleNamespace(interval=2.0, settle=8.0, min_gap=30.0, no_push=False)


def count_syncs(monkeypatch, fail_first: int = 0) -> list[int]:
    """slides.sync 를 부른 횟수를 센다(앞의 몇 번은 일부러 실패시킬 수 있다)."""
    real = slides.sync
    calls: list[int] = []

    def counted(*a, **k):
        calls.append(1)
        if len(calls) <= fail_first:
            raise RuntimeError("잠깐 끊김")                   # SlidesError 가 아닌 오류에도 멈추지 않는다
        return real(*a, **k)

    monkeypatch.setattr(slides, "sync", counted)
    return calls


def test_watch_rests_when_nothing_changes(env, monkeypatch):
    deck = env.src / "w.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    calls = count_syncs(monkeypatch)
    fake_clock(monkeypatch, lambda n: None, 60)             # 2분 동안 아무것도 고치지 않는다
    assert slides.cmd_watch(repo(env), watch_args()) == 0
    assert len(calls) == 1                                  # 켤 때 한 번만 맞춘다(스스로 다시 돌지 않는다)


def test_watch_pushes_after_settle(env, monkeypatch):
    deck = env.src / "w.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    calls = count_syncs(monkeypatch)

    def on_tick(n):
        if n == 1:
            deck.write_text("v2 — 저장", encoding="utf-8")

    fake_clock(monkeypatch, on_tick, 30)
    assert slides.cmd_watch(repo(env), watch_args()) == 0
    assert remote_show(env, "decks/w.html") == "v2 — 저장"
    assert len(calls) == 2                                  # 켤 때 한 번 + 저장이 멎은 뒤 한 번


def test_watch_keeps_going_after_errors(env, monkeypatch, capsys):
    deck = env.src / "w.html"
    deck.write_text("v1", encoding="utf-8")
    assert run(env, "add", str(deck), "--yes") == 0
    calls = count_syncs(monkeypatch, fail_first=2)

    def on_tick(n):
        if n == 1:
            deck.write_text("v2", encoding="utf-8")

    fake_clock(monkeypatch, on_tick, 40)
    capsys.readouterr()
    assert slides.cmd_watch(repo(env), watch_args()) == 0
    out = capsys.readouterr().out
    assert "올리지 못했습니다(1번째)" in out and "올리지 못했습니다(2번째)" in out
    assert remote_show(env, "decks/w.html") == "v2"
    assert len(calls) == 3                                  # 물러섰다가(15초·30초) 세 번째에 올렸다


# ---------------------------------------------------------------- 그 밖

def test_serve_rejects_other_host_names(tmp_path):
    (tmp_path / "index.html").write_text("ok", encoding="utf-8")
    handler = type("H", (slides.LocalHandler,), {})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(handler, directory=str(tmp_path)))
    port = server.server_address[1]
    handler.allowed_hosts = {f"127.0.0.1:{port}"}
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def get(host: str) -> int:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            c.request("GET", "/index.html", headers={"Host": host})
            return c.getresponse().status
        finally:
            c.close()

    try:
        assert get(f"127.0.0.1:{port}") == 200
        assert get("rebind.example:80") == 421              # 다른 이름으로 들어온 요청(DNS rebinding)은 받지 않는다
    finally:
        server.shutdown()
        server.server_close()


def test_pages_url(env):
    (env.work / "site.json").write_text('{"repo": "Pinking-Jeong/html-slides"}', encoding="utf-8")
    assert slides.pages_url(repo(env)) == "https://pinking-jeong.github.io/html-slides/"


def test_without_remote_commits_only(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    work = tmp_path / "solo"
    git(tmp_path, "init", "-q", "-b", "main", str(work))
    git(work, "config", "user.name", "test")
    git(work, "config", "user.email", "test@example.com")
    git(work, "commit", "-q", "--allow-empty", "-m", "init")
    deck = tmp_path / "solo.html"
    deck.write_text("s", encoding="utf-8")
    assert slides.main(["--root", str(work), "add", str(deck), "--yes"]) == 0
    assert git(work, "log", "-1", "--format=%s").strip() == "docs: 덱 추가 — solo"
    assert "원격 저장소(origin)가 없어" in capsys.readouterr().out
    assert not slides.Repo(work).unpushed()


def test_web_layout_edits_merge_and_shadow_cli_labels(env, capsys):
    # 첫 화면 편집이 원격에 올린 배치 파일 위에 slides 가 자기 커밋을 얹되, 배치 파일은 고치지 않는다
    other = env.tmp / "web"
    git(env.tmp, "clone", "-q", str(env.remote), str(other))
    git(other, "config", "user.name", "web")
    git(other, "config", "user.email", "web@example.com")
    layout = {"version": 1, "categories": [{"key": "conf", "label": "웹에서 정한 이름"}], "assign": {}, "order": []}
    (other / "decks").mkdir(exist_ok=True)
    (other / "decks" / "gallery.json").write_text(json.dumps(layout, ensure_ascii=False), encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-q", "-m", "chore: 갤러리 배치 바꿈(첫 화면 편집)")
    git(other, "push", "-q")
    deck = env.src / "talk.html"
    deck.write_text("<html><head><title>T</title></head><body></body></html>", encoding="utf-8")
    capsys.readouterr()
    assert run(env, "add", str(deck), "--folder", "conf", "--folder-label", "학회 발표", "--yes") == 0
    out = capsys.readouterr().out
    assert "웹에서 정한 이름" in out and "분류 관리" in out     # 웹에서 정한 이름이 앞선다고 알린다
    files = remote_files(env)
    assert "decks/conf/talk.html" in files and "decks/folders.json" in files
    assert json.loads(remote_show(env, "decks/gallery.json")) == layout
    assert subjects(env, 2) == ["docs: 덱 추가 — talk", "chore: 갤러리 배치 바꿈(첫 화면 편집)"]
    # 같은 이름이면 알리지 않는다
    capsys.readouterr()
    assert run(env, "add", str(deck), "--name", "talk2", "--folder", "conf", "--folder-label", "웹에서 정한 이름",
               "--yes") == 0
    assert "분류 관리" not in capsys.readouterr().out


def test_web_label_ignores_unreadable_layout(tmp_path):
    path = tmp_path / "decks" / "gallery.json"
    path.parent.mkdir()
    path.write_text("[" * 100_000 + "]" * 100_000, encoding="utf-8")   # 아주 깊게 겹친 JSON 도 멈추지 않는다
    assert slides.web_label(tmp_path, "conf") == ""
    path.write_text(json.dumps({"categories": [{"key": "conf", "label": " 학회 "}]}), encoding="utf-8")
    assert slides.web_label(tmp_path, "conf") == "학회"
