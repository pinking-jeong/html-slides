#!/usr/bin/env python3
"""html-slides 로컬 도구 — 이 PC 에서 만든 발표자료(HTML·PDF·PPTX)를 공개 저장소에 올리고, 원본을 고치면 바로 반영한다.

저장소 폴더에서 실행한다(PowerShell 은 .\\slides, cmd 는 slides).

  slides add "원본.html" --name kns-2026 --folder conf --title "제목"   덱을 등록하고 올린다(.pdf·.pptx 도 됨)
  slides add "원본.pdf" --pptx "원본.pptx"                             PDF 로 재생하고 PPTX 는 받기로 붙인다
  slides sync                                                          바뀐 덱을 맞춰 올린다
  slides watch                                                         원본을 지켜보다 저장되면 자동으로 올린다
  slides list                                                          등록한 덱과 상태를 본다
  slides remove kns-2026                                               덱을 내린다(git 기록에는 남는다)
  slides forget kns-2026                                               등록만 지운다(올린 덱은 그대로)
  slides serve                                                         이 PC 에서 갤러리를 미리 본다
  slides edit "원본.html"                                              덱을 편집기로 열어 고치고 그 파일에 저장한다(등록한 이름도 됨)
  slides url                                                           갤러리 주소를 알려 준다

원칙
- 원본은 저장소 폴더 밖에 둔다. 저장소의 decks/ 는 slides 가 원본을 비춰 두는 거울이다.
- slides 가 마지막으로 쓴 판이 아닌 것(웹 업로드·되돌림·직접 수정)은 덮지 않고, 저장소에서 지워진 덱은 되살리지 않는다.
- 원격의 새 판을 먼저 받은 뒤 올린다. 부딪치면 원본이 있는 덱만 원격 쪽을 따르고 그 밖에는 멈춘다 — 어느 쪽도 말없이 잃지 않는다.
- 커밋은 등록한 덱 파일만 골라서 하고, slides 가 만든 커밋만 올린다. 지우기는 slides remove 로만 한다.
- 원격의 기록이 고쳐 쓰였으면(force-push) 멈춘다 — 옛 커밋을 다시 올려 지운 것을 되살리지 않는다.
  이 PC 에서 올린 커밋을 기록에서 뺐을 때도 그 커밋을 원격에서 다시 받아 오지 않고 멈춘다.
- 원본 경로 기록은 .git 안(slides-registry.json)에 둔다 — git 에 올라가지도, pull 로 덮이지도 않는다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import hashlib
import hmac
import html
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import webbrowser
import zipfile
import zlib
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DECKS_DIR = "decks"
META_SUFFIX = ".meta.json"
FOLDERS_FILE = "folders.json"
LAYOUT_FILE = "gallery.json"            # 갤러리 첫 화면에서 편집한 배치 — slides 는 읽기만 하고 쓰지 않는다
REGISTRY_NAME = "slides-registry.json"
LOCK_NAME = "slides.lock"
SOURCE_KINDS ={".html": ".html", ".htm": ".html", ".pdf": ".pdf", ".pptx": ".pptx"}   # 원본 확장자 → 저장소 확장자
DECK_SUFFIXES = (".html", ".htm", ".pdf", ".pptx")     # 이름이 같으면 갤러리가 한 덱으로 묶는 파일(앞의 것이 덱)
KIND_RANK = {".html": 0, ".htm": 0, ".pdf": 1, ".pptx": 2}
KIND_NAME = {".html": "HTML", ".pdf": "PDF", ".pptx": "PPTX"}
OFFICE_MAX = 10_000_000                 # Office 웹 뷰어가 여는 PPTX 크기 상한(갤러리와 같게)
SCAN_MAX = 64 * 1024 * 1024             # PDF·PPTX 에서 점검할 글의 최대 바이트(풀어 낸 것 포함)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
KEY_RE = re.compile(r"^decks/(?:[^/]+/)*[^/]+\.(?:html|pdf|pptx)$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
KNOWN_MAX = 20                          # 덱마다 기억하는 'slides 가 만든 판' 지문 수(덮어써도 되는 것은 마지막 하나)
SIZE_WARN = 50 * 1024 * 1024
SIZE_LIMIT = 95 * 1024 * 1024           # GitHub 은 100 MB 가 넘는 파일을 받지 않는다
NET_TIMEOUT = 1800                      # 마지막 안전판 — 멈춘 연결은 lowSpeedLimit 이 먼저 끊는다(큰 덱·느린 회선 고려)
LOCAL_TIMEOUT = 120
LAST_UP_REF = "refs/slides/last-upstream"   # slides 가 마지막으로 확인한 원격의 판 — 기록이 고쳐 쓰였는지 볼 기준
INCOMING_REF = "refs/slides/incoming"
SYNCED_REF = "refs/slides/synced"           # 마지막으로 원격과 맞춘 이 PC 의 판 — 이 PC 에서 뺀 커밋을 알아볼 기준
MADE_FILE = "slides-commits"                # .git 안 — slides 가 만든 커밋의 이름(이것만 올린다)
MADE_KEEP = 5000
REWRITE_MSG = ("원격 저장소의 기록이 고쳐 쓰였는데(force-push — 예: 올린 것을 기록에서 지움) 이 PC 의 저장소에는 옛 기록이 "
               "남아 있습니다. 이대로 합치면 지운 내용이 다시 올라가므로 멈췄습니다.\n"
               "이 PC 의 저장소를 원격에 맞추려면 저장소 폴더에서:\n"
               "  git fetch {remote}\n  git reset --hard {remote}/{branch}\n"
               "(이 PC 에서 올리지 못한 커밋과 저장소 안에서 고치던 파일은 사라집니다 — 원본 HTML 은 저장소 밖에 있어 그대로입니다.)")
GONE_MSG = ("원격({remote})에 {branch} 브랜치가 없어졌습니다(저장소를 지우고 다시 만들었거나 브랜치를 지운 경우). "
            "이 PC 에 남은 기록을 그대로 올리면 지운 내용이 되살아날 수 있어 멈췄습니다.\n"
            "이 PC 의 기록을 모두 올려도 되면 저장소 폴더에서 git push -u {remote} {branch} 로 직접 올리세요 — "
            "그다음부터 slides 가 다시 올립니다.")
LOCAL_REWRITE_MSG = ("이 PC 의 저장소에서 이미 올린 커밋 {n}개를 기록에서 뺐는데(reset·rebase·amend 등) 원격에는 아직 남아 "
                     "있습니다. 이대로 합치면 뺀 커밋이 다시 들어오므로 멈췄습니다.\n"
                     "원격의 기록도 고치려던 것이면 저장소 폴더에서 git push --force-with-lease {remote} {branch} 로 직접 "
                     "올리세요(그사이 원격에 새로 올라온 것이 있으면 함께 지워지니 git log {remote}/{branch} 로 먼저 살펴보세요).\n"
                     "실수였다면 git reset --hard {remote}/{branch} 로 이 PC 를 원격에 맞추세요(원본 HTML 은 저장소 밖에 있어 그대로입니다).")
OUTSIDE_WEB_MSG = ("원격의 새 판이 decks/ 밖의 파일을 바꿨습니다 — 갤러리·편집기·웹 올리기는 decks/ 만 고치므로, 직접 올린 것이 "
                   "아니면 토큰이 샜을 수 있습니다. 받으면 다음 slides 실행 때 그 코드가 이 PC 에서 돌기 때문에 저절로 받지 "
                   "않았습니다:\n  {files}\n"
                   "저장소 폴더에서 git log -p HEAD..{remote}/{branch} -- {paths} 로 살펴보고, 직접 올린 것이 맞으면 "
                   "slides sync --trust-remote 로 받으세요.")
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
PUBLIC_WARNING = ("공개 저장소입니다 — 올린 덱은 누구나 볼 수 있고(갤러리 목록과 저장소에 다 보임), "
                  "올릴 때마다 공개 기록으로 남아 지울 수 없다고 보아야 합니다.")

# 앞 글자가 base64·토큰 글자면 큰 그림 데이터 속에서 우연히 맞은 것으로 보고 건너뛴다.
_B = r"(?<![A-Za-z0-9+/_-])"
SECRET_PATTERNS = [
    ("개인 키", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("OpenRouter 키", re.compile(_B + r"sk-or-v1-[0-9a-f]{32,}")),
    ("Anthropic 키", re.compile(_B + r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("OpenAI 키", re.compile(_B + r"sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}")),
    ("GitHub 토큰", re.compile(_B + r"(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})")),
    ("AWS 키", re.compile(_B + r"AKIA[0-9A-Z]{16}(?![A-Za-z0-9])")),
    ("Google API 키", re.compile(_B + r"AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])")),
    ("Slack 토큰", re.compile(_B + r"xox[abprs]-[A-Za-z0-9-]{10,}")),
]


class SlidesError(Exception):
    """사용자에게 그대로 보여 줄 오류."""


class OfflineError(SlidesError):
    """원격에 닿지 못함 — 커밋은 해 두고 다음에 다시 올린다."""


class Busy(SlidesError):
    """다른 slides 작업이 저장소를 쓰는 중."""


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def stamp() -> str:
    return dt.datetime.now().strftime("%H:%M:%S")


def slugify(text: str) -> str:
    """파일·폴더 이름으로 쓸 수 있게 다듬는다. 한글은 남기고 로마자는 소문자로."""
    s = unicodedata.normalize("NFC", text).strip()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^\w.\-]", "", s)
    s = re.sub(r"-{2,}", "-", s)
    s = s.strip("-._")                  # _ 나 . 로 시작하면 갤러리가 건너뛴다
    s = "".join(ch.lower() if ch.isascii() else ch for ch in s)[:80].rstrip("-._")
    if not s:
        s = "deck"
    if s.split(".")[0].upper() in RESERVED:
        s += "-deck"
    return s


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def file_sig(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def inside(child: Path, parent: Path) -> bool:
    child, parent = child.resolve(), parent.resolve()
    return child == parent or parent in child.parents


def replace_retry(src: str | Path, dst: str | Path) -> None:
    """Windows 에서 백신 검사 등으로 잠깐 잠긴 파일도 몇 번 더 시도해 바꾼다."""
    for attempt in range(6):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.25)


def copy_atomic(src: Path, dst: Path) -> str:
    """원본을 임시 파일로 복사해 지문을 잰 뒤 한 번에 바꿔 넣는다. 실제로 쓴 바이트의 지문을 돌려준다."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".slides-", suffix=".tmp", dir=str(dst.parent))
    try:
        h = hashlib.sha256()
        with os.fdopen(fd, "wb") as out, open(src, "rb") as inp:
            for chunk in iter(lambda: inp.read(1 << 20), b""):
                h.update(chunk)
                out.write(chunk)
        replace_retry(tmp, dst)
        return h.hexdigest()
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def remember(known: list[str], digest: str) -> None:
    if digest in known:
        known.remove(digest)
    known.append(digest)
    del known[:-KNOWN_MAX]


def mask(text: str, keep: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= keep else text[:keep] + "…"


# ---------------------------------------------------------------- 올리기 전 점검

def leak_patterns() -> list[tuple[str, re.Pattern]]:
    pats = [
        ("이 PC 의 파일 경로", re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\"'<>]+", re.I)),
        ("file:// 주소", re.compile(r"file:///", re.I)),
        ("네트워크 공유 경로", re.compile(r"\\\\[A-Za-z0-9.-]+\\[A-Za-z0-9$.-]+")),
        ("이 PC 의 서버 주소", re.compile(r"\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b", re.I)),
    ]
    user = Path.home().name
    if len(user) >= 4:
        pats.append(("사용자 이름", re.compile(r"(?<![A-Za-z0-9])" + re.escape(user) + r"(?![A-Za-z0-9])", re.I)))
    return pats


def scan_text(text: str, patterns: list[tuple[str, re.Pattern]], keep: int) -> list[str]:
    found = []
    for label, rx in patterns:
        hits = [m.group(0) for m in rx.finditer(text)]
        if hits:
            found.append(f"{label} {len(hits)}곳 (예: {mask(hits[0], keep)})")
    return found


def read_deck_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8", errors="replace")


PPTX_TEXT_PARTS = (".xml", ".rels", ".svg", ".vml")     # PPTX 안에서 글로 읽어 점검하는 조각


def zip_text(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> str | None:
    """zip 안의 글 조각 하나. 너무 크거나 압축이 깨져(zlib.error·EOFError 등) 읽지 못하면 None."""
    if info.file_size > SCAN_MAX:
        return None
    try:
        return z.read(info).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None


def pptx_notes(path: Path) -> list[str]:
    """PPTX 에 함께 실려 나가는 것: 만든 이·발표자 노트·메모·붙은 파일·바깥 링크."""
    out = []
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            names = [i.filename for i in infos]
            core = next((i for i in infos if i.filename == "docProps/core.xml"), None)
            text = (zip_text(z, core) or "") if core else ""
            for tag, label in (("dc:creator", "만든 이"), ("cp:lastModifiedBy", "마지막으로 고친 이")):
                m = re.search(rf"<{tag}>([^<]*)</{tag}>", text)
                if m and m.group(1).strip():
                    out.append(f"{label}: {mask(m.group(1), 60)}")
            notes = sum(1 for n in names if n.startswith("ppt/notesSlides/") and n.endswith(".xml"))
            if notes:
                out.append(f"발표자 노트 {notes}장")
            comments = sum(1 for n in names if n.startswith("ppt/comments") and n.endswith(".xml"))
            if comments:
                out.append(f"메모 {comments}묶음")
            embedded = sum(1 for n in names if n.startswith("ppt/embeddings/") and not n.endswith("/"))
            if embedded:
                out.append(f"PPTX 안에 붙은 파일 {embedded}개(차트·표의 원본 엑셀 등 — 함께 공개됨)")
            external, total = 0, 0
            for i in infos:
                if i.filename.endswith(".rels") and total + i.file_size <= SCAN_MAX:
                    total += i.file_size
                    external += (zip_text(z, i) or "").count('TargetMode="External"')
            if external:
                out.append(f"바깥 링크 {external}개")
    except Exception as e:  # noqa: BLE001 — 깨진 파일도 알리기만 한다
        out.append(f"PPTX 를 열어 보지 못했습니다: {e}")
    return out


def kind_of(path: Path | str) -> str:
    """덱 파일이 저장소에서 갖는 확장자(.html·.pdf·.pptx) — 덱 파일이 아니면 ''."""
    return SOURCE_KINDS.get(Path(path).suffix.lower(), "")


def pptx_text(path: Path) -> tuple[str, int]:
    """PPTX 안의 글 조각 모두(장·발표자 노트·메모·문서 정보·링크·SVG) — 열쇠·토큰·경로 점검용.
    (글, 읽지 못하거나 상한을 넘어 점검하지 못한 조각 수)."""
    parts, total, skipped = [], 0, 0
    try:
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                if not info.filename.lower().endswith(PPTX_TEXT_PARTS):
                    continue
                text = zip_text(z, info) if total + info.file_size <= SCAN_MAX else None
                if text is None:
                    skipped += 1
                    continue
                parts.append(text)
                total += info.file_size
    except Exception:  # noqa: BLE001 — 열지 못한 것은 pptx_notes 가 알린다
        pass
    return "\n".join(parts), skipped


STREAM_RE = re.compile(rb"stream\r?\n")
PDF_INFO_KEY_RE = re.compile(r"/(?:Producer|CreationDate|ModDate)\b")   # 문서 정보(Info) 사전에 거의 늘 있는 키
PDF_INFO_TRIES = 256                    # 문서 정보 사전을 찾아볼 키의 수(실제 PDF 는 고친 판마다 하나씩 — 몇 개뿐)
PDF_DICT_SPAN = 16384                   # 문서 정보 사전 하나의 최대 길이
PDF_ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f"}


def pdf_text(path: Path) -> str:
    """PDF 의 날 바이트와 풀어 낸 Flate 흐름(latin-1 로 읽음). 문서 정보·XMP·단순한 글자는 여기서 보이지만,
    글꼴에 따라 본문 글자는 코드로 들어 있어 다 훑지는 못한다."""
    data = path.read_bytes()
    out, total, pos = [data.decode("latin-1")], 0, 0
    while total < SCAN_MAX:
        m = STREAM_RE.search(data, pos)
        if not m:
            break
        end = data.find(b"endstream", m.end())
        if end < 0:
            break
        pos = end + 9
        try:
            chunk = zlib.decompressobj().decompress(data[m.end():end], SCAN_MAX - total)
        except zlib.error:
            continue                            # Flate 가 아닌 흐름(JPEG 그림 등)
        total += len(chunk)
        out.append(chunk.decode("latin-1"))
    return "\n".join(out)


def pdf_string_at(text: str, i: int) -> str | None:
    """text[i] 에서 시작하는 PDF 문자열 (…) 또는 <16진> 을 풀어 돌려준다."""
    if text.startswith("(", i):
        depth, j, buf = 1, i + 1, []
        while j < len(text) and len(buf) < 4000:
            c = text[j]
            if c == "\\" and j + 1 < len(text):
                n = text[j + 1]
                if n in PDF_ESCAPES:
                    buf.append(PDF_ESCAPES[n])
                    j += 2
                elif n in "01234567":
                    k = j + 1
                    while k < len(text) and k < j + 4 and text[k] in "01234567":
                        k += 1
                    buf.append(chr(int(text[j + 1:k], 8) & 0xFF))
                    j = k
                else:
                    if n not in "\r\n":         # 줄 끝의 \ 는 이어 쓰기(CR LF 도 한 줄 끝)
                        buf.append(n)
                    j += 3 if text.startswith("\r\n", j + 1) else 2
                continue
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    break
            buf.append(c)
            j += 1
        raw = "".join(buf).encode("latin-1", "replace")
    elif text.startswith("<", i) and not text.startswith("<<", i):
        end = text.find(">", i)
        hexs = re.sub(r"\s", "", text[i + 1:end]) if end > 0 else ""
        try:
            raw = bytes.fromhex(hexs + "0" * (len(hexs) % 2))
        except ValueError:
            return None
    else:
        return None
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", "replace")
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", "replace")
    return raw.decode("latin-1")


PDF_DICT_TOKEN_RE = re.compile(r"[()<>\\]")


def pdf_dict_end(text: str, start: int) -> int:
    """text[start] 의 '<<' 와 짝이 되는 '>>' 의 자리. 글 (…)·<16진> 속의 괄호·꺾쇠는 건너뛰므로
    '/Title<FEFF…>>>' 처럼 붙여 쓴 것도 맞게 끊는다. PDF_DICT_SPAN 안에서 못 찾거나 너무 깊으면 -1."""
    depth, nest, i, end = 0, 0, start, min(len(text), start + PDF_DICT_SPAN)
    while True:
        m = PDF_DICT_TOKEN_RE.search(text, i, end)
        if not m:
            return -1
        i, c = m.start(), m.group()
        if nest:                                # 글 (…) 안 — 괄호 짝과 \ 이스케이프만 본다
            if c == "\\":
                i += 2
            else:
                nest += (c == "(") - (c == ")")
                i += 1
        elif c == "(":
            nest, i = 1, i + 1
        elif text.startswith("<<", i):
            depth += 1
            if depth > 8:                       # 문서 정보는 거의 겹치지 않는다(조작한 입력에서 멈추지 않게)
                return -1
            i += 2
        elif text.startswith(">>", i):
            depth -= 1
            if depth <= 0:
                return i
            i += 2
        elif c == "<":                          # <16진>
            j = text.find(">", i + 1, end)
            if j < 0:
                return -1
            i = j + 1
        else:
            i += 1


def xmp_packet(text: str) -> str:
    """PDF 안의 첫 XMP 묶음(최대 256 KB) — 없으면 ''."""
    starts = [i for i in (text.find("<x:xmpmeta"), text.find("<x:xapmeta"), text.find("<rdf:RDF")) if i >= 0]
    return text[min(starts):min(starts) + 262144] if starts else ""


def xmp_value(pkt: str, tag: str) -> str | None:
    """XMP 의 <dc:title><rdf:Alt><rdf:li>…</rdf:li> 같은 값(그 태그 안에서만 찾는다)."""
    m = re.search(rf"<{tag}\b[^<>]{{0,1024}}>", pkt)
    close = pkt.find(f"</{tag}>", m.end()) if m and not m.group(0).endswith("/>") else -1
    li = re.search(r"<rdf:li\b[^<>]{0,1024}>([^<]{1,4000})</rdf:li>", pkt[m.end():close]) if close >= 0 else None
    if not li:
        return None
    val = li.group(1).encode("latin-1", "replace").decode("utf-8", "replace")     # XMP 는 UTF-8
    return " ".join(html.unescape(val).split()) or None


def pdf_meta(text: str) -> dict[str, str]:
    """PDF 문서 정보(Info 사전 — Producer·CreationDate·ModDate 가 든 것)와 XMP 의 제목·만든 이·주제·키워드.
    믿을 수 없는 입력이라 정규식 대신 짧은 범위만 훑는다(조작한 PDF 로 멈추지 않게)."""
    out: dict[str, str] = {}
    seen: set[int] = set()
    for n, m in enumerate(PDF_INFO_KEY_RE.finditer(text)):
        if n >= PDF_INFO_TRIES:
            break
        start = text.rfind("<<", max(0, m.start() - PDF_DICT_SPAN), m.start())
        if start < 0 or start in seen:
            continue
        seen.add(start)
        end = pdf_dict_end(text, start)
        if end < 0:
            continue
        body = text[start + 2:end]
        for key in ("Title", "Author", "Subject", "Keywords"):
            k = re.search(r"/" + key + r"\s*(?=[(<])", body)
            if key not in out and k:
                s = pdf_string_at(body, k.end())
                if s and s.strip():
                    out[key] = " ".join(s.split())
    pkt = xmp_packet(text)
    for key, tag in (("Title", "dc:title"), ("Author", "dc:creator"), ("Subject", "dc:description")):
        if key not in out:
            val = xmp_value(pkt, tag)
            if val:
                out[key] = val
    return out


def pdf_notes(text: str, meta: dict[str, str]) -> list[str]:
    """PDF 와 함께 공개되는 것: 문서 정보·붙은 파일·스크립트·바깥 링크·암호."""
    out = []
    for key, label in (("Author", "만든 이"), ("Subject", "주제"), ("Keywords", "키워드")):
        if meta.get(key):
            out.append(f"{label}: {mask(meta[key], 60)}")
    embedded = len(re.findall(r"/Type\s*/EmbeddedFile\b", text))
    if embedded or "/EmbeddedFiles" in text:
        out.append(f"PDF 안에 붙은 파일 {embedded or '?'}개(함께 공개됨)")
    if re.search(r"/JavaScript\b|/JS\s*[(<\d]", text):
        out.append("PDF 안의 스크립트(갤러리는 실행하지 않지만 받은 사람의 PDF 프로그램은 실행할 수 있음)")
    links = len(re.findall(r"/URI\s*[(<]", text))
    if links:
        out.append(f"바깥 링크 {links}개")
    if re.search(r"/Encrypt\s+\d+\s+\d+\s+R|/Encrypt\s*<<", text):
        out.append("암호가 걸린 PDF — 여는 암호가 있으면 갤러리에서 재생되지 않습니다")
    out.append("PDF 본문 글자는 다 훑지 못합니다(글꼴에 따라 글자가 코드로 들어 있음) — 공개해도 되는지 직접 확인하세요")
    return out


def inspect_deck(path: Path) -> tuple[str, str, list[str]]:
    """올리기 전 점검 — (열쇠·경로를 찾아볼 글, 파일에서 찾은 제목, 알려 줄 것)."""
    kind = kind_of(path)
    if kind == ".pdf":
        text = pdf_text(path)
        meta = pdf_meta(text)
        return text, meta.get("Title", ""), pdf_notes(text, meta)
    if kind == ".pptx":
        text, skipped = pptx_text(path)
        m = re.search(r"<dc:title>([^<]*)</dc:title>", text)
        notes = pptx_notes(path)
        if skipped:
            notes.append(f"PPTX 안의 글 조각 {skipped}개는 너무 크거나 깨져 점검하지 못했습니다 — 공개해도 되는지 직접 확인하세요")
        return text, html.unescape(m.group(1)) if m else "", notes
    text = read_deck_text(path)
    head = text[:262144]
    m = re.search(r"<title\b[^<>]{0,1024}>", head, re.I)
    end = re.compile(r"</title", re.I).search(head, m.end()) if m else None
    return text, head[m.end():end.start()] if end else "", []


def check_size(path: Path, what: str) -> list[str]:
    size = path.stat().st_size
    if size > SIZE_LIMIT:
        raise SlidesError(f"{what} 가 너무 큽니다({size / 1048576:.0f} MB) — GitHub 은 100 MB 가 넘는 파일을 받지 않습니다")
    if size > SIZE_WARN:
        return [f"{what} 가 큽니다({size / 1048576:.0f} MB) — 저장할 때마다 이만큼씩 기록이 쌓입니다"]
    return []


# ---------------------------------------------------------------- git

class Lock:
    """한 번에 한 slides 작업만 저장소를 쓰게 한다. 프로세스가 죽으면 OS 가 자물쇠를 푼다."""

    def __init__(self, path: Path):
        self.path = path
        self.fh = None

    def acquire(self, wait: float) -> bool:
        self.fh = open(self.path, "a+b")
        deadline = time.monotonic() + wait
        while True:
            try:
                if os.name == "nt":
                    import msvcrt
                    self.fh.seek(0)
                    msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError:
                if time.monotonic() >= deadline:
                    self.fh.close()
                    self.fh = None
                    return False
                time.sleep(0.5)

    def release(self) -> None:
        if self.fh is None:
            return
        try:
            if os.name == "nt":
                import msvcrt
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        self.fh.close()
        self.fh = None


class Repo:
    def __init__(self, root: Path, remote: str = "origin", interactive: bool = True):
        self.root = root.resolve()
        self.remote = remote
        self.interactive = interactive          # False 면 로그인 창을 띄우지 않는다(watch)
        self.trust_remote = False               # True 면 원격의 새 판이 decks/ 밖을 바꿨어도 받는다(sync --trust-remote)
        if not (self.root / ".git").exists():
            raise SlidesError(f"git 저장소가 아닙니다: {self.root}")
        self._gitdir: Path | None = None

    # ---- 기본
    def run(self, *args: str, stdin: str | None = None, net: bool = False,
            check: bool = True, timeout: float | None = None) -> subprocess.CompletedProcess:
        # 편집기는 띄우지 않는다(환경 변수의 GIT_EDITOR 가 -c core.editor 보다 앞서므로 환경으로 막는다).
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_LITERAL_PATHSPECS": "1",
               "GIT_EDITOR": "true", "GIT_MERGE_AUTOEDIT": "no"}
        if not self.interactive:
            env["GCM_INTERACTIVE"] = "never"
        cmd = ["git", "-c", "core.quotepath=false"]
        if net:                                   # 1 KB/s 아래로 60초 넘게 멈추면 끊는다
            cmd += ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60"]
        cmd += ["-C", str(self.root), *args]
        timeout = timeout or (NET_TIMEOUT if net else LOCAL_TIMEOUT)
        try:
            r = subprocess.run(cmd, input=stdin, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", env=env, timeout=timeout)
        except subprocess.TimeoutExpired:
            err = OfflineError if net else SlidesError
            raise err(f"git {args[0]} 가 {timeout}초 안에 끝나지 않았습니다 — 네트워크나 로그인 창을 확인해 주세요")
        if check and r.returncode != 0:
            msg = (r.stderr or r.stdout).strip()
            raise (OfflineError if net else SlidesError)(f"git {' '.join(args[:2])} 실패: {msg}")
        return r

    def git(self, *args: str, **kw) -> str:
        return self.run(*args, **kw).stdout

    @property
    def gitdir(self) -> Path:
        if self._gitdir is None:
            self._gitdir = Path(self.git("rev-parse", "--absolute-git-dir").strip())
        return self._gitdir

    def site(self) -> dict:
        p = self.root / "site.json"
        try:
            data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        except (OSError, ValueError):
            data = {}
        return data if isinstance(data, dict) else {}

    @property
    def target_branch(self) -> str:
        b = self.site().get("branch")
        return b if isinstance(b, str) and re.fullmatch(r"[A-Za-z0-9._/-]+", b) else "main"

    def current_branch(self) -> str | None:
        return self.run("symbolic-ref", "-q", "--short", "HEAD", check=False).stdout.strip() or None

    def has_remote(self) -> bool:
        return self.remote in self.git("remote").split()

    def tracked(self, *paths: str) -> list[str]:
        """git 이 알고 있는(마지막 커밋·색인에 있는) 경로. 폴더를 주면 그 아래 파일들."""
        out = self.git("ls-files", "-z", "--", *paths) if paths else ""
        return [p for p in out.split("\0") if p]

    def rev(self, ref: str) -> str | None:
        return self.run("rev-parse", "--verify", "-q", ref + "^{commit}", check=False).stdout.strip() or None

    def in_head(self) -> set[str]:
        """마지막 커밋(HEAD)의 decks/ 아래 경로(normcase) — 지운 것이 커밋까지 되었는지 볼 때 쓴다."""
        if not self.rev("HEAD"):
            return set()
        out = self.git("ls-tree", "-r", "-z", "--name-only", "HEAD", "--", DECKS_DIR)
        return {os.path.normcase(p) for p in out.split("\0") if p}

    def unmerged(self) -> dict[str, set[str]]:
        """충돌이 풀리지 않은 파일 → 남아 있는 단계('1' 공통 조상, '2' 바탕 쪽, '3' 얹는 쪽)."""
        out: dict[str, set[str]] = {}
        for seg in self.git("ls-files", "-u", "-z").split("\0"):
            if "\t" in seg:
                info, path = seg.split("\t", 1)
                out.setdefault(path, set()).add(info.split()[-1])
        return out

    def made(self) -> list[str]:
        """slides 가 만든 커밋의 이름(.git/slides-commits, 오래된 것부터)."""
        try:
            return (self.gitdir / MADE_FILE).read_text(encoding="ascii").split()
        except (OSError, ValueError):
            return []

    def remember_made(self, shas: list[str]) -> None:
        if not shas:
            return
        path = self.gitdir / MADE_FILE
        keep = list(dict.fromkeys([*self.made(), *shas]))[-MADE_KEEP:]
        tmp = path.with_name(path.name + ".tmp")
        try:
            tmp.write_text("\n".join(keep) + "\n", encoding="ascii")
            replace_retry(tmp, path)
        except OSError as e:        # 적지 못한 커밋은 '만들지 않은 커밋'으로 보여 올리지 않는다(안전한 쪽)
            raise SlidesError(f"slides 가 만든 커밋의 기록({path.name})을 쓰지 못했습니다: {e}") from e

    def foreign_commits(self) -> list[str]:
        """원격에 아직 없는 커밋 가운데 slides 가 만들지 않은 것 — '짧은 이름 제목' 목록.
        slides 는 자기가 만든 커밋의 이름을 .git/slides-commits 에 적어 두고 그것만 올린다. 손으로 한 커밋은 물론,
        slides 의 커밋을 amend·rebase 로 고쳐 쓴 것(파일을 끼워 넣거나 메시지를 고친 것 포함)도 이름이 바뀌어 걸린다."""
        up = self.upstream()
        made = set(self.made())
        out = self.git("log", "--format=%H%x00%h%x00%s", f"{up}..HEAD" if self.rev(up) else "HEAD", "--")
        bad = []
        for line in out.splitlines():
            full, short, subject = (line.split("\0", 2) + ["", ""])[:3]
            if full and full not in made:
                bad.append(f"{short} {subject}")
        return bad

    def outside_web(self, up: str) -> list[str]:
        """원격의 새 커밋이 decks/ 밖에서 바꾼 파일 — 웹(갤러리 배치·편집기 저장·웹 올리기)은 decks/ 만 고친다.
        이름을 바꾼 것은 옛 이름·새 이름을 둘 다 본다(밖의 파일을 decks/ 로 옮겨 숨기지 못하게)."""
        out = self.git("diff", "--name-only", "--no-renames", "-z", f"HEAD...{up}", "--")
        return [p for p in out.split("\0") if p and not p.startswith(f"{DECKS_DIR}/")]

    def refuse_outside_web(self, up: str) -> None:
        """원격의 새 판이 decks/ 밖을 바꿨으면 받지 않고 멈춘다 — 샌 토큰으로 tools/ 를 고쳐 이 PC 에서 돌리지 못하게."""
        if self.trust_remote:
            return
        outside = self.outside_web(up)
        if outside:
            more = f"\n  … 외 {len(outside) - 10}개" if len(outside) > 10 else ""
            raise SlidesError(OUTSIDE_WEB_MSG.format(
                files="\n  ".join(outside[:10]) + more, remote=self.remote, branch=self.target_branch,
                paths=" ".join(f'"{p}"' for p in outside[:10])))

    def carries_purged(self, new: str) -> bool:
        """원격에 한때 있다가 지금(new)은 없는 커밋 — 기록을 고쳐 쓴 흔적 — 을 이 PC 의 HEAD 가 아직 품고 있는가.
        그런 커밋을 다시 얹어 올리면 지운 내용이 되살아난다. 한때의 원격 판은 slides 가 기억한 LAST_UP_REF·추적 ref 와
        그 둘의 reflog(IDE 등 다른 프로그램이 받아 온 것까지 남는다)에서 찾는다. rebase·cherry-pick 으로 다시 얹어
        이름(SHA)이 바뀐 것은 작성자·작성 시각과 바꾼 파일·내용이 같은 것으로 알아본다(다시 얹어도 이것들은 그대로다)."""
        local = self.run("rev-list", "HEAD", f"^{new}", "--", check=False).stdout.split()
        if not local:
            return False
        refs = (LAST_UP_REF, self.upstream())
        tips = self.run("for-each-ref", "--format=%(objectname)", *refs, check=False).stdout.split()
        for ref in refs:
            tips += self.run("reflog", "show", "--format=%H", ref, check=False).stdout.split()
        tips = [t for t in dict.fromkeys(tips) if t != new]
        if not tips:
            return False
        gone = self.git("rev-list", "--ignore-missing", "--stdin", stdin="\n".join([*tips, f"^{new}"]) + "\n").split()
        if not gone:
            return False
        if not set(gone).isdisjoint(local):
            return True
        g, l = self.by_ident(gone), self.by_ident(local)
        same = g.keys() & l.keys()
        if not same:
            return False
        # 작성자·작성 시각이 같은 것끼리, 바꾼 파일과 그 내용까지 같은지 본다(같은 초에 만든 새 커밋은 거른다).
        changes = self.changes([c for k in same for c in (*g[k], *l[k])])
        return any(changes.get(a) and changes.get(a) == changes.get(b) for k in same for a in g[k] for b in l[k])

    def by_ident(self, commits: list[str]) -> dict[str, list[str]]:
        """'작성자 메일 작성 시각' → 커밋 — rebase·cherry-pick·amend 는 이 둘을 그대로 둔다."""
        out = self.git("log", "--no-walk=unsorted", "--stdin", "--format=%H %ae %at", stdin="\n".join(commits) + "\n")
        res: dict[str, list[str]] = {}
        for line in out.splitlines():
            sha, _, ident = line.partition(" ")
            if ident:
                res.setdefault(ident, []).append(sha)
        return res

    def changes(self, commits: list[str]) -> dict[str, frozenset[tuple[str, str]]]:
        """커밋 → 바꾼 파일과 바꾼 뒤의 내용(blob) 묶음. 다른 바탕 위로 다시 얹어도 그대로라 같은 커밋을 알아보는 데 쓴다
        (merge·빈 커밋은 빈 묶음 — 비교하지 않는다). 커밋이 많을 수 있어 명령 줄 대신 stdin 으로 넘긴다."""
        out = self.git("log", "--no-walk=unsorted", "--stdin", "--raw", "--no-renames", "--no-abbrev", "--format=%x01%H",
                       stdin="\n".join(dict.fromkeys(commits)) + "\n")
        res: dict[str, frozenset[tuple[str, str]]] = {}
        for block in out.split("\x01")[1:]:
            sha, _, rest = block.partition("\n")
            items = set()
            for line in rest.splitlines():
                if line.startswith(":"):
                    meta, _, path = line.partition("\t")
                    fields = meta.split()
                    items.add((path, fields[-2] if len(fields) >= 2 else meta))
            res[sha.strip()] = frozenset(items)
        return res

    def dropped_here(self, new: str) -> list[str]:
        """이 PC 에서 기록을 고쳐 쓰며(reset·rebase·amend 등) 뺐는데 원격(new)에는 아직 남아 있어, 합치면 다시 들어올 커밋.
        이 PC 의 브랜치가 한때 품었던 판은 slides 가 마지막으로 원격과 맞춘 판(SYNCED_REF)과 브랜치의 reflog 에서 찾는다
        (손으로 push·pull 한 것까지). 첫 부모만 따라가므로, merge 로 들어왔다가 merge 를 되돌려 빠진 남의 커밋은 셈하지 않는다."""
        seen = self.run("reflog", "show", "--format=%H", f"refs/heads/{self.target_branch}", "--",
                        check=False).stdout.split()
        dropped = set(self.run("rev-list", "--first-parent", "--ignore-missing", "--stdin",
                               stdin="\n".join([SYNCED_REF, *dict.fromkeys(seen), "^HEAD"]) + "\n",
                               check=False).stdout.split())
        if not dropped:
            return []
        return [c for c in self.git("rev-list", new, "^HEAD", "--").split() if c in dropped]

    def mark_synced(self) -> None:
        self.git("update-ref", SYNCED_REF, "HEAD")

    def lock(self, wait: float) -> "LockCtx":
        return LockCtx(self, wait)

    # ---- 점검
    def rebase_in_progress(self) -> bool:
        return (self.gitdir / "rebase-merge").exists() or (self.gitdir / "rebase-apply").exists()

    def preflight(self) -> None:
        branch = self.current_branch()
        if branch is None:
            raise SlidesError("저장소가 브랜치 밖(detached HEAD)에 있습니다 — 저장소 폴더에서 "
                              f"git switch {self.target_branch} 뒤 다시 하세요")
        if branch != self.target_branch:
            raise SlidesError(f"{self.target_branch} 브랜치에서만 올립니다(지금: {branch}) — "
                              f"git switch {self.target_branch}")
        if self.rebase_in_progress():
            raise SlidesError("끝나지 않은 git rebase 가 있습니다 — 저장소 폴더에서 git rebase --abort "
                              "(또는 마무리) 뒤 다시 하세요")
        for name, what in (("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick")):
            if (self.gitdir / name).exists():
                raise SlidesError(f"끝나지 않은 git {what} 가 있습니다 — git {what} --abort(또는 마무리) 뒤 다시 하세요")
        if (self.gitdir / "index.lock").exists():
            raise SlidesError("다른 git 작업이 진행 중이거나 지난번 작업이 멈춘 흔적(.git/index.lock)이 있습니다")
        if self.git("ls-files", "-u").strip():
            raise SlidesError("충돌이 풀리지 않은 파일이 있습니다 — 저장소 폴더에서 git status 로 확인해 주세요")

    def dirty(self) -> dict[str, str]:
        """decks/ 아래에서 마지막 커밋과 다른 파일 → 상태 두 글자(git status 와 같음)."""
        out = self.git("status", "--porcelain", "-z", "--untracked-files=all", "--", DECKS_DIR)
        res: dict[str, str] = {}
        items = out.split("\0")
        i = 0
        while i < len(items):
            item = items[i]
            if len(item) > 3:
                res[item[3:]] = item[:2]
                if item[0] in "RC":             # 이름 바꿈은 다음 칸에 옛 이름이 온다
                    i += 1
            i += 1
        return res

    def commit_paths(self, paths: list[str], message: str, removed: bool = False) -> bool:
        """주어진 경로만 커밋한다(다른 파일은 그대로). 바뀐 것이 없으면 False."""
        if not paths:
            return False
        spec = "".join(p + "\0" for p in paths)        # 덱이 많아도 명령 줄 길이에 걸리지 않게
        if removed:
            self.git("rm", "-q", "-r", "--cached", "--ignore-unmatch",
                     "--pathspec-from-file=-", "--pathspec-file-nul", stdin=spec)
        else:
            self.git("add", "--pathspec-from-file=-", "--pathspec-file-nul", stdin=spec)
        staged = {os.path.normcase(p) for p in self.git("diff", "--cached", "--name-only", "-z").split("\0") if p}
        # Windows 는 대소문자를 가리지 않으므로 비교도 normcase 로 한다(폴더째 지운 경우는 그 아래 경로로).
        todo = [p for p in paths if os.path.normcase(p) in staged or
                (removed and any(s.startswith(os.path.normcase(p.rstrip("/") + "/")) for s in staged))]
        if not todo:
            return False
        self.git("commit", "-q", "-m", message, "--pathspec-from-file=-", "--pathspec-file-nul",
                 stdin="".join(p + "\0" for p in todo))
        full, _, subject = self.git("log", "-1", "--format=%H%x00%s", "HEAD", "--").strip().partition("\0")
        if subject == message.strip():      # 그사이 다른 커밋이 끼어들었으면 적지 않는다(그러면 올리지 않고 알린다)
            self.remember_made([full])
        return True

    # ---- 원격
    def upstream(self) -> str:
        return f"refs/remotes/{self.remote}/{self.target_branch}"

    def fetch(self) -> bool:
        """원격의 새 판을 받아 온다. 원격에 아직 브랜치가 없으면 False(처음 한 번은 사용자가 직접 올린다).
        원격의 기록이 고쳐 쓰였는데 이 PC 에 옛 기록이 남아 있으면 멈춘다(carries_purged) — 사용자가 git fetch 를
        따로 했거나 기준 ref 를 지웠어도 알아채고, 안내대로 reset 해서 옛 기록이 없어지면 그때부터 다시 맞춘다.
        한때 있던 원격 브랜치가 없어졌을 때도(저장소를 지우고 다시 만듦) 옛 기록을 알아서 다시 채우지 않고 멈춘다."""
        branch = self.target_branch
        if not self.git("ls-remote", "--heads", self.remote, f"refs/heads/{branch}", net=True, timeout=120).strip():
            if self.rev(self.upstream()) or self.rev(LAST_UP_REF):
                raise SlidesError(GONE_MSG.format(remote=self.remote, branch=branch))
            return False
        self.git("fetch", "-q", "--no-tags", self.remote, f"+refs/heads/{branch}:{INCOMING_REF}", net=True)
        new = self.rev(INCOMING_REF)
        if new is None or self.carries_purged(new):
            raise SlidesError(REWRITE_MSG.format(remote=self.remote, branch=branch))
        self.set_refs(new, self.upstream(), LAST_UP_REF)
        return True

    def set_refs(self, sha: str, *refs: str) -> None:
        """refs 를 sha 로 맞춘다. 지나온 원격 판을 carries_purged 가 볼 수 있게 reflog 를 남긴다
        (값이 그대로면 git 은 reflog 에 아무것도 더하지 않는다). update-ref --stdin 은 쓰지 않는다 —
        Windows 의 텍스트 파이프가 줄 끝을 CRLF 로 바꾸는데 update-ref 는 그 CR 을 받아들이지 않는다."""
        for ref in refs:
            self.git("update-ref", "--create-reflog", ref, sha)

    def count(self, spec: str) -> int:
        out = self.run("rev-list", "--count", spec, check=False).stdout.strip()
        return int(out) if out.isdigit() else 0

    def integrate(self, regen: frozenset[str] | set[str] = frozenset()) -> list[str]:
        """원격의 새 판을 이 저장소에 합친다. 원격 쪽을 따른 덱 파일 경로를 돌려준다.
        - 이 PC 에 올리지 못한 커밋이 없으면 앞으로 감기만 한다(겹치지 않는 고침은 그대로 둔다 — autostash 를 쓰지 않는다).
        - 있으면 그 커밋을 원격의 판 위에 다시 얹는다. 부딪친 파일 가운데 원격 쪽을 따라도 되는 것은 regen
          (원본이 있어 언제든 다시 만들 수 있는 등록한 덱의 사본)뿐이고, 나머지가 부딪치면 되돌리고 멈춘다."""
        if not self.has_remote() or not self.fetch():
            return []
        up = self.upstream()
        back = self.dropped_here(up)
        if back:
            raise SlidesError(LOCAL_REWRITE_MSG.format(n=len(back), remote=self.remote, branch=self.target_branch))
        if not self.count(f"HEAD..{up}"):
            self.mark_synced()
            return []
        if not self.count(f"{up}..HEAD"):
            self.refuse_outside_web(up)
            r = self.run("merge", "--ff-only", "-q", up, check=False)
            if r.returncode != 0:
                raise SlidesError("원격의 새 판이 이 PC 에서 고치던 파일과 겹쳐 받지 못했습니다(고침은 그대로 둠) — "
                                  "그 파일을 커밋하거나 되돌린 뒤 다시 하세요:\n" + (r.stderr or r.stdout).strip())
            self.mark_synced()
            return []
        foreign = self.foreign_commits()
        if foreign:
            raise SlidesError("원격에 새 판이 있는데, 이 PC 에 slides 가 만들지 않은 올리지 못한 커밋이 있어 합치지 "
                              "않았습니다:\n  " + "\n  ".join(foreign[:10]) +
                              "\n저장소 폴더에서 git pull --rebase 로 합친 뒤 git push 해 주세요.")
        self.refuse_outside_web(up)
        busy = self.git("status", "--porcelain", "--untracked-files=no").strip()
        if busy:
            raise SlidesError("원격의 새 판과 이 PC 의 올리지 못한 커밋을 합치려면, 저장소 안에서 고치던 파일을 먼저 "
                              "커밋하거나 되돌려 주세요(고침은 그대로 둠):\n" + busy)
        taken = self._rebase(up, regen)
        self.mark_synced()
        return taken

    def _rebase(self, up: str, regen: frozenset[str] | set[str]) -> list[str]:
        taken: list[str] = []
        first = self.run("rebase", "-q", up, check=False)
        for _ in range(200):
            if not self.rebase_in_progress():
                if self.count(f"HEAD..{up}"):       # rebase 가 시작도 못 한 경우
                    raise SlidesError("원격의 새 판과 합치지 못했습니다: "
                                      f"{(first.stderr or first.stdout).strip()}")
                # 다시 얹은 커밋도 slides 의 것으로 적어 둔다(얹기 전에 모두 slides 가 만든 것임을 확인했다).
                self.remember_made(self.git("rev-list", f"{up}..HEAD", "--").split())
                return sorted(set(taken))
            unmerged = self.unmerged()
            if not unmerged:
                # 부딪친 곳 없이 멈춤 — 원격 쪽을 따르고 나니 빈 커밋이 된 경우만 건너뛴다(그 밖에는 손대지 않는다).
                if self.run("diff", "--cached", "--quiet", check=False).returncode == 0:
                    self.run("rebase", "--skip", check=False)
                    continue
                self.run("rebase", "--abort", check=False)
                raise SlidesError("원격의 새 판과 합치다 멈췄습니다(되돌려 둠) — 저장소 폴더에서 git status 로 확인해 주세요")
            other = sorted(p for p in unmerged if os.path.normcase(p) not in regen)
            if other:
                self.run("rebase", "--abort", check=False)
                raise SlidesError("이 PC 와 원격에서 함께 바뀐 파일이 있어 멈췄습니다(어느 쪽도 버리지 않고 되돌려 둠): "
                                  + ", ".join(other) + "\n저장소 폴더에서 git pull --rebase 로 합친 뒤(부딪친 곳은 직접 고침) "
                                  "git push 해 주세요.")
            for p, stages in sorted(unmerged.items()):   # 원격 쪽(--ours = 위에 얹는 바탕)을 따른다
                if "2" in stages:
                    self.git("checkout", "--ours", "--", p)
                    self.git("add", "--", p)
                else:                                    # 원격에서 지운 파일
                    self.git("rm", "-q", "--", p)
                taken.append(p)
            self.run("rebase", "--continue", check=False)
        self.run("rebase", "--abort", check=False)
        raise SlidesError("원격의 새 판과 합치지 못했습니다(되돌려 둠) — 저장소 폴더에서 git status 로 확인해 주세요")

    def unpushed(self) -> bool:
        """아직 원격에 올리지 못한 커밋이 있는가."""
        if not self.has_remote():
            return False
        if not self.run("rev-parse", "--verify", "-q", self.upstream(), check=False).stdout.strip():
            return bool(self.run("rev-parse", "--verify", "-q", "HEAD", check=False).stdout.strip())
        return self.count(f"{self.upstream()}..HEAD") > 0

    def publish(self, regen: frozenset[str] | set[str] = frozenset()) -> list[str]:
        """원격과 맞춘 뒤 올린다. slides 가 만든 커밋만 올린다(살펴보지 않은 다른 커밋이 공개되지 않게).
        원격 쪽을 따른 덱 파일 경로를 돌려준다."""
        if not self.has_remote():
            return []
        taken: list[str] = []
        branch = self.target_branch
        for attempt in range(3):
            taken += self.integrate(regen)
            if not self.unpushed():
                return taken
            if not self.rev(self.upstream()):
                raise SlidesError(f"원격({self.remote})에 아직 {branch} 브랜치가 없습니다 — 처음 한 번은 저장소 폴더에서 "
                                  f"git push -u {self.remote} {branch} 로 올려 주세요")
            foreign = self.foreign_commits()
            if foreign:
                raise SlidesError("slides 가 만들지 않은 커밋이 있어 올리지 않았습니다(살펴보지 않은 내용이 공개되지 않게 — "
                                  "slides 의 커밋을 amend·rebase 로 고쳐 쓴 것도 여기에 듭니다):\n  "
                                  + "\n  ".join(foreign[:10]) +
                                  "\n그 커밋도 올려도 되면 저장소 폴더에서 git push 로 직접 올리세요. 그다음부터는 slides 가 다시 올립니다.")
            r = self.run("push", "-q", self.remote, f"HEAD:refs/heads/{branch}", net=True, check=False)
            if r.returncode == 0:
                self.set_refs(self.rev("HEAD"), self.upstream(), LAST_UP_REF, SYNCED_REF)
                return taken
            msg = (r.stderr or r.stdout).strip()
            if "[remote rejected]" in msg:           # 비밀 정보 차단·저장소 규칙 등 — 다시 해도 같다
                raise SlidesError(f"원격이 받지 않았습니다(GitHub 의 비밀 정보 차단·저장소 규칙 등): {msg}")
            if not re.search(r"\[rejected\].*\((?:fetch first|non-fast-forward)\)", msg) or attempt == 2:
                raise OfflineError(f"올리지 못했습니다: {msg}")
        return taken

    def gc_auto(self) -> None:
        """저장할 때마다 쌓이는 판을 가끔 압축한다(느슨한 객체가 많을 때만). 올린 뒤에 부르고, 실패해도 넘어간다."""
        try:
            self.run("-c", "gc.auto=256", "-c", "gc.autoDetach=false", "gc", "--auto", "--quiet",
                     check=False, timeout=900)
        except SlidesError:
            pass


class LockCtx:
    def __init__(self, repo: Repo, wait: float):
        self.lock = Lock(repo.gitdir / LOCK_NAME)
        self.wait = wait

    def __enter__(self):
        if not self.lock.acquire(self.wait):
            raise Busy("다른 slides 작업(watch 등)이 저장소를 쓰는 중입니다 — 잠시 뒤 다시 해 주세요")
        return self

    def __exit__(self, *exc):
        self.lock.release()
        return False


# ---------------------------------------------------------------- 등록부

def registry_path(repo: Repo) -> Path:
    return repo.gitdir / REGISTRY_NAME


def deck_paths(rel: str) -> dict[str, str]:
    """등록한 덱이 저장소에 쓰는 파일: 덱 파일(main)·함께 올린 PPTX(pptx)·정보 파일(meta).
    PPTX 덱에는 따로 붙는 PPTX 가 없다."""
    stem, ext = rel.rsplit(".", 1)
    out = {"main": rel, "meta": stem + META_SUFFIX}
    if ext.lower() != "pptx":
        out["pptx"] = stem + ".pptx"
    return out


def kinds(rel: str) -> list[tuple[str, str]]:
    """(지문 기록의 이름, 등록부의 원본 키) — 덱 파일과, 붙을 수 있으면 PPTX."""
    return [("main", "source")] + ([("pptx", "pptx_source")] if "pptx" in deck_paths(rel) else [])


def group_paths(rel: str) -> list[str]:
    """이름(확장자 뺀)이 같은 덱 파일과 정보 파일 — 갤러리에서는 덱 하나라 내릴 때 함께 내린다."""
    stem = rel[: -len(Path(rel).suffix)] if rel.lower().endswith(DECK_SUFFIXES) else rel
    return [stem + s for s in DECK_SUFFIXES] + [stem + META_SUFFIX]


def entry_problem(repo: Repo, key, entry) -> str | None:
    """등록부 항목이 믿을 만한지 본다. 문제가 있으면 그 까닭."""
    if not isinstance(key, str) or not KEY_RE.match(key):
        return "decks/…/이름.html(.pdf·.pptx) 꼴이 아님"
    parts = key.split("/")
    if any(p in (".", "..") or p.startswith((".", "_")) for p in parts[1:]):
        return "decks/ 밖이나 숨긴 경로"
    if not inside(repo.root / key, repo.root / DECKS_DIR):
        return "decks/ 밖"
    if not isinstance(entry, dict):
        return "항목 형식이 아님"
    src = entry.get("source")
    if not isinstance(src, str) or not os.path.isabs(src) or kind_of(src) != kind_of(key):
        return "원본이 절대 경로의 덱 파일이 아니거나 저장소 쪽과 종류가 다름"
    if inside(Path(src), repo.root):
        return "원본이 저장소 안에 있음"
    pptx = entry.get("pptx_source")
    if pptx is not None and (kind_of(key) == ".pptx" or not isinstance(pptx, str) or not os.path.isabs(pptx)
                             or not pptx.lower().endswith(".pptx") or inside(Path(pptx), repo.root)):
        return "PPTX 원본이 맞지 않음"
    return None


def load_registry(repo: Repo, quiet: bool = False) -> dict:
    path = registry_path(repo)
    if not path.is_file():
        return {"version": 2, "decks": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SlidesError(f"등록부를 읽지 못했습니다({path}): {e}")
    raw = data.get("decks") if isinstance(data, dict) else None
    decks = {}
    for key, entry in (raw.items() if isinstance(raw, dict) else []):
        why = entry_problem(repo, key, entry)
        if why:
            if not quiet:
                print(f"[경고] 등록부 항목을 무시합니다({why}): {key}")
            continue
        known = dict(entry.get("known")) if isinstance(entry.get("known"), dict) else {}
        if "html" in known and "main" not in known:     # 예전 등록부는 덱 파일의 기록을 'html' 로 적었다
            known["main"] = known.pop("html")
        entry["known"] = {k: [h for h in v if isinstance(h, str) and HEX64_RE.match(h)][-KNOWN_MAX:]
                          for k, v in known.items() if k in ("main", "pptx") and isinstance(v, list)}
        decks[key] = entry
    return {"version": 2, "decks": decks}


def save_registry(repo: Repo, data: dict) -> None:
    """바뀐 것이 있을 때만 쓴다(쓸데없이 고친 시각이 바뀌지 않게)."""
    path = registry_path(repo)
    text = json.dumps(data, ensure_ascii=False, indent=1)
    try:
        if path.read_text(encoding="utf-8") == text:
            return
    except OSError:
        pass
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    replace_retry(tmp, path)


def regen_paths(reg: dict) -> set[str]:
    """원본이 있어 언제든 다시 만들 수 있는 저장소 사본(등록한 덱의 덱 파일·PPTX, normcase).
    원격과 부딪쳤을 때 원격 쪽을 따라도 잃는 것이 없는 파일은 이것뿐이다."""
    out = set()
    for rel, entry in reg["decks"].items():
        paths = deck_paths(rel)
        for kind, key in kinds(rel):
            if entry.get(key) and Path(entry[key]).is_file():
                out.add(os.path.normcase(paths[kind]))
    return out


def ours(entry: dict, kind: str) -> str | None:
    """slides 가 마지막으로 저장소에 쓴 판의 지문 — 이것과 같은 사본만 slides 의 것으로 보고 덮어쓴다
    (예전 판으로 되돌린 것은 누군가 일부러 한 일로 본다)."""
    known = entry["known"].get(kind) or []
    return known[-1] if known else None


def split_arg(arg: str) -> tuple[str, bool]:
    """사용자가 적은 덱 이름·경로 → (decks/ 아래 경로, 경로로 적었는가). '\\'·'./'·'decks/' 를 받아 준다."""
    s = arg.strip().replace("\\", "/")
    while s.startswith("./"):
        s = s[2:]
    s = s.strip("/")
    explicit = "/" in s or s.lower().endswith(DECK_SUFFIXES)
    if s.lower().startswith(DECKS_DIR + "/"):
        s, explicit = s[len(DECKS_DIR) + 1:], True
    return s, explicit


def find_entry(reg: dict, key: str) -> str | None:
    """등록부의 키를 찾는다. 경로로 적었으면(폴더/이름, decks/…, …html) 그 경로와 꼭 같은 것만,
    이름만 적었으면 어느 폴더에 있든 그 이름인 것을 찾는다. 없으면 None."""
    s, explicit = split_arg(key)
    k = s.lower()
    for suf in DECK_SUFFIXES:
        if k.endswith(suf):
            k = k[: -len(suf)]
            break
    short = {rel: rel[len(DECKS_DIR) + 1:].rsplit(".", 1)[0].lower() for rel in reg["decks"]}
    hits = [rel for rel, v in short.items() if v == k]
    if not hits and not explicit:
        hits = [rel for rel, v in short.items() if v.endswith("/" + k)]
    if len(hits) > 1:
        raise SlidesError(f"'{key}' 에 맞는 덱이 여럿입니다: {', '.join(sorted(hits))} — 폴더까지 적어 주세요")
    return hits[0] if hits else None


def readd_hint(rel: str, entry: dict) -> str:
    folder = Path(rel).parent.relative_to(DECKS_DIR).as_posix()
    opt = f" --folder {folder}" if folder != "." else ""
    pptx = f' --pptx "{entry["pptx_source"]}"' if entry.get("pptx_source") else ""
    return f'slides add "{entry["source"]}" --name {Path(rel).stem}{opt}{pptx} --force'


# ---------------------------------------------------------------- 명령

def confirm(question: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        raise SlidesError(f"{question} — 확인을 받을 수 없는 환경입니다. 괜찮으면 --yes 를 붙여 다시 실행하세요")
    return input(f"{question} [y/N] ").strip().lower() in ("y", "yes", "예", "네", "ㅇ")


def write_meta(path: Path, updates: dict) -> bool:
    data = {}
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            data = {}
        data = data if isinstance(data, dict) else {}
    merged = {**data, **{k: v for k, v in updates.items() if v not in (None, "", [])}}
    if merged == data:
        return False
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    return True


def set_folder_label(root: Path, folder: str, label: str) -> bool:
    path = root / DECKS_DIR / FOLDERS_FILE
    data = {}
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            data = {}
        data = data if isinstance(data, dict) else {}
    cur = data.get(folder)
    if (cur.get("label") if isinstance(cur, dict) else cur) == label:
        return False
    data[folder] = {**cur, "label": label} if isinstance(cur, dict) else label
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    return True


def web_label(root: Path, folder: str) -> str:
    """갤러리 첫 화면 편집(decks/gallery.json)에서 이 폴더에 붙인 분류 이름 — 없으면 ''. 이 이름이 folders.json 보다 앞선다."""
    path = root / DECKS_DIR / LAYOUT_FILE
    try:
        if path.stat().st_size > 1_000_000:
            return ""
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError):   # 아주 깊게 겹친 JSON 도 읽지 못한 것으로 본다
        return ""
    cats = data.get("categories") if isinstance(data, dict) else None
    for c in cats if isinstance(cats, list) else []:
        if isinstance(c, dict) and c.get("key") == folder and isinstance(c.get("label"), str):
            # 짝 없는 써로게이트는 U+FFFD 로(그대로 찍으면 콘솔 출력이 멈춘다), 띄어쓰기는 한 칸으로
            label = c["label"].encode("utf-16", "surrogatepass").decode("utf-16", "replace")
            return " ".join(label.split())
    return ""


def case_conflict(root: Path, rel: str) -> str | None:
    """decks/ 아래 경로 가운데 대소문자만 다른 이름이 이미 있으면 그 경로(Windows 에서는 같은 파일이 된다)."""
    cur = root
    for part in rel.split("/"):
        if not cur.is_dir():
            return None
        names = os.listdir(cur)
        if part not in names:
            other = next((n for n in names if n.lower() == part.lower()), None)
            if other:
                return (cur / other).relative_to(root).as_posix()
        cur = cur / part
    return None


def inside_folder_deck(root: Path, rel: str) -> str | None:
    """덱을 둘 자리가 폴더 덱(index.html 이 있는 폴더) 안이면 그 폴더."""
    cur = root / DECKS_DIR
    for part in rel.split("/")[1:-1]:
        cur = cur / part
        if (cur / "index.html").is_file():
            return cur.relative_to(root).as_posix()
    return None


def same_name_files(repo: Repo, rel: str) -> list[str]:
    """rel 과 이름(확장자 뺀)이 같은, 같은 폴더의 다른 덱 파일(디스크에 있는 이름 그대로)."""
    folder = (repo.root / rel).parent
    stem, name = Path(rel).stem.lower(), Path(rel).name.lower()
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return []
    return [(Path(rel).parent / n).as_posix() for n in names
            if Path(n).stem.lower() == stem and Path(n).suffix.lower() in KIND_RANK and n.lower() != name]


def stem_conflict(repo: Repo, reg: dict, rel: str) -> str | None:
    """이름이 같은 다른 덱. 갤러리는 이름이 같은 파일을 한 덱으로 묶고 HTML > PDF > PPTX 차례로 앞의 것을
    덱으로 보이므로, 새 덱이 다른 덱에 붙어 보이지 않게 되거나 두 등록이 한 덱을 나눠 갖지 않게 막는다.
    뒤 차례의 파일(HTML 덱 옆의 PDF·PPTX, PDF 덱 옆의 PPTX)은 이 덱에 붙는 것이라 괜찮다."""
    stem = rel.rsplit(".", 1)[0].lower()
    for key in reg["decks"]:
        if key.lower() != rel.lower() and key.rsplit(".", 1)[0].lower() == stem:
            return key
    rank = KIND_RANK[Path(rel).suffix.lower()]
    return next((p for p in same_name_files(repo, rel) if KIND_RANK[Path(p).suffix.lower()] <= rank), None)


def check_target(repo: Repo, reg: dict, rel: str, src: Path, pptx_src: Path | None, force: bool) -> None:
    """add 할 자리가 안전한지 본다(덮으면 안 되는 것이 있으면 멈춘다)."""
    holder = inside_folder_deck(repo.root, rel)
    if holder:
        raise SlidesError(f"{holder} 는 폴더 덱이라 그 안에 다른 덱을 둘 수 없습니다 — --folder 를 바꿔 주세요")
    clash = case_conflict(repo.root, rel)
    if clash:
        raise SlidesError(f"대소문자만 다른 {clash} 가 이미 있습니다 — --name·--folder 를 바꾸거나 그쪽을 먼저 내려 주세요")
    other = stem_conflict(repo, reg, rel)
    if other:
        raise SlidesError(f"이름이 같은 덱 {other} 가 있습니다(갤러리는 이름이 같은 파일을 한 덱으로 묶습니다) — "
                          "--name 을 바꾸거나 그 덱을 먼저 내려 주세요. PDF 덱에 PPTX 를 붙이려면 "
                          'slides add "발표.pdf" --pptx "발표.pptx"')
    if force:
        return
    entry = reg["decks"].get(rel)
    pairs = [("main", src, repo.root / rel)]
    if pptx_src:
        pairs.append(("pptx", pptx_src, repo.root / deck_paths(rel)["pptx"]))
    for kind, s, d in pairs:
        if not d.exists():
            continue
        shown = deck_paths(rel)[kind]
        if entry is None:
            raise SlidesError(f"{shown} 가 이미 있습니다(웹에서 올린 덱일 수 있음). 이 원본으로 덮으려면 --force")
        if kind == "main" and os.path.normcase(entry["source"]) != os.path.normcase(str(src)):
            raise SlidesError(f"{rel} 는 다른 원본({entry['source']})에 묶여 있습니다. 이 원본으로 바꾸려면 --force")
        cur = sha256_file(d) if d.is_file() else None
        if cur != ours(entry, kind) and cur != sha256_file(s):
            if ours(entry, kind) is None:       # slides 가 쓴 적 없는 파일(덱에 붙은 웹 업로드 PPTX 등)
                raise SlidesError(f"{shown} 가 이미 있습니다(웹에서 올린 파일일 수 있음). 이 원본으로 덮으려면 --force")
            raise SlidesError(f"{shown} 가 저장소 쪽에서 바뀌었습니다(웹 업로드·되돌림·직접 수정). "
                              "이 원본으로 덮으려면 --force")


def report_taken(taken: list[str]) -> None:
    for p in taken:
        print(f"[{stamp()}] {p}: 원격의 판(웹 업로드 등)이 있어 그쪽을 따랐습니다 — 이 PC 의 원본은 그대로입니다. "
              "slides list 로 확인하세요")


def add_notes(repo: Repo, rel: str, src: Path, pptx_src: Path | None) -> list[str]:
    """add 할 때 함께 알려 줄 것: PPTX 재생 방식·10 MB 상한, 이 덱에 붙게 될 같은 이름의 파일."""
    out = []
    if kind_of(src) == ".pptx":
        out.append("PPTX 는 Microsoft Office 웹 뷰어로 재생됩니다 — 파일 주소가 Microsoft 로 전달됩니다")
        size = src.stat().st_size
        if size > OFFICE_MAX:
            out.append(f"10 MB 가 넘어({size / 1e6:.1f} MB) 갤러리에서는 재생되지 않고 받기만 됩니다 — PowerPoint 에서 "
                       f'PDF 로 내보내 slides add "{src.with_suffix(".pdf").name}" --pptx "{src.name}" 로 올리면 '
                       "PDF 로 재생됩니다")
    if pptx_src and pptx_src.stat().st_size > OFFICE_MAX:
        out.append("PPTX 가 10 MB 가 넘어 ‘PowerPoint 로 보기’ 없이 받기로만 붙습니다")
    mine = {deck_paths(rel).get("pptx", "").lower()} if pptx_src else set()
    for p in same_name_files(repo, rel):
        if p.lower() not in mine:
            out.append(f"이름이 같은 {p} 는 이 덱에 붙습니다(갤러리의 ⋯ 메뉴에서 보기·받기)")
    return out


def cmd_add(repo: Repo, args) -> int:
    src = Path(args.source).expanduser().resolve()
    ext = kind_of(src)
    if not src.is_file() or not ext:
        raise SlidesError(f"HTML·PDF·PPTX 파일이 아닙니다: {src}")
    if inside(src, repo.root):
        raise SlidesError("원본은 저장소 폴더 밖에 두어 주세요(저장소의 decks/ 는 slides 가 관리합니다) — "
                          "파일을 다른 폴더로 옮긴 뒤 그 경로로 add 하세요")
    pptx_src = Path(args.pptx).expanduser().resolve() if args.pptx else None
    if pptx_src and ext == ".pptx":
        raise SlidesError("PPTX 를 덱으로 올릴 때는 --pptx 를 붙이지 않습니다")
    if pptx_src and (not pptx_src.is_file() or pptx_src.suffix.lower() != ".pptx"):
        raise SlidesError(f"PPTX 파일이 아닙니다: {pptx_src}")
    if pptx_src and inside(pptx_src, repo.root):
        raise SlidesError("PPTX 원본도 저장소 폴더 밖에 두어 주세요")
    if args.date and not DATE_RE.match(args.date):
        raise SlidesError("--date 는 2026-10-29 꼴로 적어 주세요")
    name = slugify(args.name or src.stem)
    if name == "index" and ext == ".html":  # 내보내기 도구들이 흔히 index.html 로 만든다
        name = slugify(src.parent.name) if src.parent.name else "deck"
        print(f"이름이 index 이면 폴더 전체가 한 덱으로 보여 '{name}' 으로 바꿉니다(--name 으로 정할 수 있음).")
    folder_parts = [slugify(p) for p in re.split(r"[\\/]+", args.folder or "") if p.strip(" ._")]
    rel = "/".join([DECKS_DIR, *folder_parts, name + ext])
    push = not args.no_push

    notes = check_size(src, KIND_NAME[ext])
    if pptx_src:
        notes += check_size(pptx_src, "PPTX")
    text, found_title, more = inspect_deck(src)
    secrets = scan_text(text, SECRET_PATTERNS, keep=10)
    notes += scan_text(text, leak_patterns(), keep=48) + more
    if pptx_src:
        ptext, _, pmore = inspect_deck(pptx_src)
        secrets += [f"PPTX {s}" for s in scan_text(ptext, SECRET_PATTERNS, keep=10)]
        notes += [f"PPTX {n}" for n in scan_text(ptext, leak_patterns(), keep=48) + pmore]
    title = args.title or found_title

    reg = load_registry(repo)
    check_target(repo, reg, rel, src, pptx_src, args.force)
    notes += add_notes(repo, rel, src, pptx_src)
    print(PUBLIC_WARNING)
    print(f"  원본: {src}\n  저장소: {rel}\n  제목: {mask(title or name, 80)}")
    if secrets:
        print("  열쇠·토큰처럼 보이는 글: " + "; ".join(secrets))
        if not args.ignore_scan:
            raise SlidesError("열쇠·토큰처럼 보이는 글이 있어 올리지 않았습니다 — 원본에서 지우거나, "
                              "잘못 찾은 것이면 --ignore-scan 을 붙이세요")
    if notes:
        print("  확인할 것:\n" + "\n".join(f"   - {n}" for n in notes))
    if not confirm("이 덱을 공개 저장소에 올릴까요?", args.yes):
        print("올리지 않았습니다.")
        return 1

    with repo.lock(wait=60):
        repo.preflight()
        taken = []
        if push:
            try:                                # 웹에서 올린 판을 먼저 받아 아래 점검이 보게 한다
                taken = repo.integrate(regen_paths(load_registry(repo, quiet=True)))
            except OfflineError as e:
                print(f"[안내] 원격에 닿지 못해 이 PC 에만 커밋합니다: {e}")
                push = False
        reg = load_registry(repo)
        check_target(repo, reg, rel, src, pptx_src, args.force)
        late = [n for n in add_notes(repo, rel, src, pptx_src) if n not in notes]
        if late:                                # 방금 원격에서 받은 같은 이름의 파일(웹 업로드 등)
            print("  확인할 것(원격에서 받은 것):\n" + "\n".join(f"   - {n}" for n in late))
        old = reg["decks"].get(rel)
        # 지문 기록은 이어 간다(덮어쓸지는 마지막 판으로만 정한다) — --force 로 덱 파일만 덮어도 PPTX 기록을 잃지 않게.
        known = {k: list(v) for k, v in (old or {}).get("known", {}).items()}
        paths = deck_paths(rel)
        remember(known.setdefault("main", []), copy_atomic(src, repo.root / rel))
        changed = [rel]
        pptx_from = str(pptx_src) if pptx_src else (old or {}).get("pptx_source")
        if pptx_src:
            remember(known.setdefault("pptx", []), copy_atomic(pptx_src, repo.root / paths["pptx"]))
            changed.append(paths["pptx"])
        tags = [t.strip() for t in (args.tags or "").split(",") if t.strip()]
        meta = {"title": args.title, "description": args.desc, "date": args.date,
                "venue": args.venue, "authors": args.authors, "tags": tags}
        if write_meta(repo.root / paths["meta"], meta):
            changed.append(paths["meta"])
        if args.folder_label and folder_parts:
            folder_key = "/".join(folder_parts)
            if set_folder_label(repo.root, folder_key, args.folder_label):
                changed.append(f"{DECKS_DIR}/{FOLDERS_FILE}")
            shown = web_label(repo.root, folder_key)
            if shown and shown != args.folder_label:
                print(f"  [안내] 갤러리 첫 화면에서 이 분류의 이름을 '{mask(shown, 40)}'(으)로 정해 두어 그 이름이 보입니다 "
                      "— 바꾸려면 첫 화면의 편집 → 분류 관리에서 고치세요.")
        reg["decks"][rel] = {
            "source": str(src),
            "pptx_source": pptx_from,
            "added": (old or {}).get("added") or now_iso(),
            "known": known,
            "scan_ignored": bool(args.ignore_scan or (old or {}).get("scan_ignored")),
        }
        save_registry(repo, reg)
        verb = "추가" if old is None else "갱신"
        committed = repo.commit_paths(changed, f"docs: 덱 {verb} — {name}")
        print(f"커밋: 덱 {verb} — {name}" if committed else "저장소와 내용이 같아 커밋할 것이 없습니다.")
        if push and repo.has_remote():
            pending = committed or repo.unpushed()
            taken += repo.publish(regen_paths(reg))
            report_taken(taken)
            print(f"{repo.remote}/{repo.target_branch} 에 올렸습니다" if pending
                  else f"{repo.remote}/{repo.target_branch} 와 같아 올릴 것이 없습니다")
            print_urls(repo, rel)
        elif push:
            print(f"원격 저장소({repo.remote})가 없어 이 PC 에만 커밋했습니다.")
    if committed:                               # 잠금을 푼 뒤에 정리한다
        repo.gc_auto()
    return 0


def json_ok(path: Path, quiet: bool) -> bool:
    """손으로 고친 정보 파일이 JSON 객체로 읽히는가(지운 것은 지운 대로 커밋한다)."""
    if not path.exists():
        return True
    try:
        ok = isinstance(json.loads(path.read_text(encoding="utf-8")), dict)
    except (OSError, ValueError):
        ok = False
    if not ok and not quiet:
        print(f"[{stamp()}] {path.name}: JSON 으로 읽히지 않아 올리지 않았습니다 — 고쳐 저장하면 다음에 올립니다")
    return ok


def tool_owned_dirty(repo: Repo, reg: dict, dirty: dict[str, str], quiet: bool = True) -> list[str]:
    """커밋 전인 채로 남은 slides 의 사본(지난번에 멈춘 경우)과, 등록한 덱의 정보 파일 고침."""
    nd = {os.path.normcase(p): p for p in dirty}
    out = []
    for rel, entry in reg["decks"].items():
        paths = deck_paths(rel)
        for kind, _ in kinds(rel):
            p = nd.get(os.path.normcase(paths[kind]))
            f = repo.root / paths[kind]
            if p and f.is_file() and sha256_file(f) == ours(entry, kind):
                out.append(p)
        p = nd.get(os.path.normcase(paths["meta"]))
        if p and json_ok(repo.root / p, quiet):
            out.append(p)
    p = nd.get(os.path.normcase(f"{DECKS_DIR}/{FOLDERS_FILE}"))
    if p and reg["decks"] and json_ok(repo.root / p, quiet):
        out.append(p)
    return sorted(set(out))


def copy_changed(repo: Repo, reg: dict, quiet: bool) -> list[str]:
    """원본이 바뀐 덱을 저장소 사본에 옮긴다. slides 가 마지막으로 쓴 판이 아닌 사본(웹 업로드·되돌림·직접 수정)은
    덮지 않고, 저장소에서 지워진 덱(웹에서 지움·다른 PC 에서 내림)은 되살리지 않는다."""
    copied: list[str] = []
    head = repo.in_head()

    def say(msg: str) -> None:
        if not quiet:
            print(f"[{stamp()}] {msg}")

    for rel, entry in sorted(reg["decks"].items()):
        paths = deck_paths(rel)
        for kind, key in kinds(rel):
            if not entry.get(key):
                continue
            src, dst = Path(entry[key]), repo.root / paths[kind]
            known = entry["known"].setdefault(kind, [])
            last = ours(entry, kind)
            try:
                if not src.is_file():
                    say(f"원본이 없어 건너뜁니다(저장소의 덱은 그대로): {src}")
                    continue
                s = sha256_file(src)
                d = sha256_file(dst) if dst.is_file() else None
                if s == d:
                    if d != last:                 # 원본과 저장소가 같아졌다 — 이제 이 판이 slides 의 것
                        remember(known, d)
                        save_registry(repo, reg)
                    continue
                if d is None and last and os.path.normcase(paths[kind]) not in head:
                    say(f"{paths[kind]}: 저장소에서 지워졌습니다(웹에서 지웠거나 다른 PC 에서 내림) — 되살리지 않았습니다.\n"
                        f"  다시 올리려면: {readd_hint(rel, entry)}\n  그만 지켜보려면: slides forget {Path(rel).stem}")
                    continue
                if d is not None and d != last:
                    why = ("예전에 올린 판으로 되돌려져 있어(웹에서 되돌림 등)" if d in known
                           else "slides 가 올린 판이 아니라(웹 업로드·직접 수정)")
                    say(f"{paths[kind]}: 저장소 쪽 판이 {why} 덮지 않았습니다.\n"
                        f"  이 PC 의 원본으로 덮으려면: {readd_hint(rel, entry)}")
                    continue
                if src.stat().st_size > SIZE_LIMIT:
                    say(f"{src.name}: 100 MB 에 가까워 올리지 않았습니다")
                    continue
                if not entry.get("scan_ignored"):
                    secrets = scan_text(inspect_deck(src)[0], SECRET_PATTERNS, keep=10)
                    if secrets:
                        say(f"{src.name}: 열쇠·토큰처럼 보이는 글이 있어 올리지 않았습니다 — " + "; ".join(secrets))
                        continue
                remember(known, copy_atomic(src, dst))
                save_registry(repo, reg)          # 사본을 쓴 즉시 남긴다(멈춰도 다음에 slides 의 판으로 알아보게)
                copied.append(paths[kind])
            except OSError as e:                  # 잠긴 파일·오프라인 클라우드 파일 등 — 이번에는 건너뛴다
                say(f"{src.name}: 읽거나 쓰지 못해 이번에는 건너뜁니다 ({e})")
    return copied


def sync(repo: Repo, push: bool = True, quiet: bool = False, wait: float = 60) -> list[str]:
    """등록한 덱을 원본에 맞춰 커밋하고 올린다. 이번에 커밋한 덱 이름을 돌려준다."""
    with repo.lock(wait=wait):
        repo.preflight()
        reg = load_registry(repo, quiet=quiet)
        owner = {os.path.normcase(p): rel for rel in reg["decks"] for p in deck_paths(rel).values()}

        def names_of(paths: list[str]) -> list[str]:
            return sorted({Path(owner[os.path.normcase(p)]).stem for p in paths if os.path.normcase(p) in owner})

        def label_of(paths: list[str]) -> str:
            names = names_of(paths)
            return ", ".join(names[:5]) + (f" 외 {len(names) - 5}개" if len(names) > 5 else "") or "정보"

        # 손으로 고친 정보 파일과, 지난번에 커밋 전에 멈춘 사본부터 담는다(원격의 새 판을 받기 전에 작업 폴더를 깨끗이).
        leftover = tool_owned_dirty(repo, reg, repo.dirty(), quiet=quiet)
        early = bool(leftover) and repo.commit_paths(leftover, f"docs: 덱 갱신 — {label_of(leftover)}")
        if early:
            print(f"[{stamp()}] 커밋: 덱 갱신 — {label_of(leftover)}")
        offline = None
        taken: list[str] = []
        if push and repo.has_remote():
            try:
                taken = repo.integrate(regen_paths(reg))
            except OfflineError as e:
                offline = e
        copied = copy_changed(repo, reg, quiet)
        save_registry(repo, reg)
        changed = sorted(set(copied) | set(tool_owned_dirty(repo, reg, repo.dirty())))
        names = names_of(changed)
        label = label_of(changed)
        committed = repo.commit_paths(changed, f"docs: 덱 갱신 — {label}") if changed else False
        if committed:
            print(f"[{stamp()}] 커밋: 덱 갱신 — {label}")
        # 등록한 덱이 없어도 못 올린 커밋(오프라인에서 내린 덱 등)은 마저 올린다.
        if push and repo.has_remote() and (committed or early or repo.unpushed()):
            if offline:
                raise OfflineError(f"원격에 닿지 못해 커밋만 했습니다 — 다음에 다시 올립니다 ({offline})")
            taken += repo.publish(regen_paths(reg))
            print(f"[{stamp()}] {repo.remote}/{repo.target_branch} 에 올렸습니다")
        report_taken(taken)
        done = sorted(set((names if committed else []) + (names_of(leftover) if early else [])))
        tidy = bool(committed or early)
    if tidy:                                    # 잠금을 푼 뒤에 — 오래 걸려도 다른 slides 작업을 막지 않게
        repo.gc_auto()
    return done


def cmd_sync(repo: Repo, args) -> int:
    repo.trust_remote = args.trust_remote
    if not sync(repo, push=not args.no_push):
        print("바뀐 덱이 없습니다.")
    return 0


def watch_signature(repo: Repo) -> tuple:
    """등록한 덱 목록, 원본(HTML·PPTX)과 손으로 고칠 수 있는 정보 파일의 (수정 시각, 크기).
    저장소 쪽 사본과 등록부는 넣지 않는다 — sync 가 스스로 바꾸는 것이라, 넣으면 쉬지 않고 다시 돈다."""
    reg = load_registry(repo, quiet=True)
    sig = []
    for rel, entry in sorted(reg["decks"].items()):
        files = [entry.get("source"), entry.get("pptx_source"), str(repo.root / deck_paths(rel)["meta"])]
        sig.append((rel, tuple(file_sig(Path(f)) if f else None for f in files)))
    sig.append(("folders", file_sig(repo.root / DECKS_DIR / FOLDERS_FILE)))
    return tuple(sig)


def cmd_watch(repo: Repo, args) -> int:
    repo.interactive = False                    # 지켜보는 동안에는 로그인 창을 띄우지 않는다
    print(f"[{stamp()}] 지켜보는 중 — 원본을 저장하고 {args.settle:g}초 동안 더 바뀌지 않으면 올립니다. 멈추려면 Ctrl+C")
    print(PUBLIC_WARNING)
    last = None
    pending_since = time.monotonic() - args.settle      # 켤 때 한 번 맞춘다(꺼져 있는 동안 바뀐 것)
    fails = 0
    next_try = 0.0
    try:
        while True:
            try:
                sig = watch_signature(repo)
            except Exception as e:  # noqa: BLE001 — 등록부를 잠깐 못 읽어도 지켜보기는 계속한다
                sig = ("error", str(e))
            if last is not None and sig != last:
                pending_since = time.monotonic()       # 저장이 이어지는 동안은 기다린다
            last = sig
            now = time.monotonic()
            if pending_since is not None and now - pending_since >= args.settle and now >= next_try:
                try:
                    names = sync(repo, push=not args.no_push, quiet=fails > 0, wait=0)
                    if names:
                        print(f"[{stamp()}] 반영: {', '.join(names)} — 갤러리는 1~2분 뒤 바뀝니다")
                        next_try = now + args.min_gap
                    pending_since = None
                    fails = 0
                except Busy:
                    pass                                # 다른 slides 작업 중 — 다음 차례에 다시
                except Exception as e:  # noqa: BLE001 — 어떤 오류에도 멈추지 않고 물러섰다가 다시 한다
                    fails += 1
                    wait = min(300, 15 * 2 ** (fails - 1))
                    next_try = now + wait
                    print(f"[{stamp()}] 올리지 못했습니다({fails}번째) — {wait}초 뒤 다시 합니다\n  {e}")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print(f"\n[{stamp()}] 멈췄습니다.")
    return 0


def deck_status(repo: Repo, rel: str, entry: dict, head: set[str]) -> str:
    src, dst = Path(entry["source"]), repo.root / rel
    if not src.is_file():
        return "원본 없음"
    last = ours(entry, "main")
    if not dst.is_file():
        if last and os.path.normcase(rel) not in head:
            return "저장소에서 지워짐(되살리지 않음 — 다시 올리려면 add --force)"
        return "저장소에 없음(올릴 것)"
    s, d = sha256_file(src), sha256_file(dst)
    if s == d:
        return "같음"
    if d != last:
        return "저장소 쪽이 바뀜(웹 업로드·되돌림 등 — 덮지 않음)"
    return "바뀜(올릴 것)"


def cmd_list(repo: Repo, args) -> int:
    reg = load_registry(repo)
    if not reg["decks"]:
        print("등록한 덱이 없습니다 — slides add \"원본.html\" 로 등록하세요.")
        return 0
    dirty = {os.path.normcase(p) for p in repo.dirty()}
    head = repo.in_head()
    for rel, entry in sorted(reg["decks"].items()):
        status = deck_status(repo, rel, entry, head)
        if any(os.path.normcase(p) in dirty for p in deck_paths(rel).values()):
            status += " · 커밋 전"
        print(f"{rel}\n  상태: {status}\n  원본: {entry['source']}")
    if repo.unpushed():
        print("올리지 못한 커밋이 있습니다 — slides sync 로 다시 올립니다.")
    return 0


def canonical_case(root: Path, rel: str) -> str:
    """디스크에 있는 실제 대소문자 이름으로 바꾼다(git 경로와 맞추려고)."""
    cur, out = root, []
    for part in rel.split("/"):
        names = os.listdir(cur) if cur.is_dir() else []
        real = part if part in names else next((n for n in names if n.lower() == part.lower()), part)
        out.append(real)
        cur = cur / real
    return "/".join(out)


def group_files(repo: Repo, reg: dict, rel: str) -> list[str]:
    """rel 과 이름이 같은 덱 파일 가운데 디스크·git·등록부 어디엔가 있는 것(덱이 되는 차례로)."""
    cands = group_paths(rel)[:-1]               # 정보 파일은 빼고 덱 파일만
    tracked = {os.path.normcase(p): p for p in repo.tracked(*cands)}
    out: dict[str, str] = {}
    for c in cands:
        if (repo.root / c).is_file():
            p = canonical_case(repo.root, c)
        else:
            p = tracked.get(os.path.normcase(c)) or next((k for k in reg["decks"] if k.lower() == c.lower()), None)
        if p:
            out.setdefault(p.lower(), p)
    return sorted(out.values(), key=lambda p: DECK_SUFFIXES.index(Path(p).suffix.lower()))


def resolve_target(repo: Repo, reg: dict, arg: str) -> tuple[str, str, str | None]:
    """내릴 덱을 찾는다 → (경로, 'file'|'dir', 등록부 키 또는 None). decks/ 밖은 받지 않는다.
    파일 덱은 이름이 같은 덱 파일 묶음(HTML·PDF·PPTX)이 갤러리의 덱 하나라, 확장자를 적었든 아니든 그 묶음을 찾는다.
    적은 경로와 꼭 맞는 것을 먼저 보고, 이름만 적었으면 어느 폴더에 있든 그 이름인 등록 덱도 본다 — 여럿이면 묻는다."""
    s, explicit = split_arg(arg)
    if not s or any(p in ("", ".", "..") for p in s.split("/")):
        raise SlidesError("decks/ 아래의 덱만 내릴 수 있습니다")
    base = repo.root / DECKS_DIR
    rel = f"{DECKS_DIR}/{s}"
    found: dict[tuple[str, str], tuple[str, str, str | None]] = {}
    is_index = rel.lower().endswith("/index.html")
    folder = repo.root / (rel[: -len("/index.html")] if is_index else rel)
    if folder.is_dir() and (folder / "index.html").is_file() and inside(folder, base) \
            and folder.resolve() != base.resolve():
        c = canonical_case(repo.root, folder.relative_to(repo.root).as_posix())
        found[("dir", c.lower())] = (c, "dir", None)

    def add_group(path: str) -> None:
        files = group_files(repo, reg, path)
        if files and inside(repo.root / files[0], base):
            stem = files[0].rsplit(".", 1)[0].lower()
            key = next((k for k in reg["decks"] if k.rsplit(".", 1)[0].lower() == stem), None)
            found.setdefault(("file", stem), (files[0], "file", key))

    if not is_index:
        add_group(rel)
    if not explicit:
        hit = find_entry(reg, arg)
        if hit:
            add_group(hit)
    if len(found) > 1:
        raise SlidesError(f"'{arg}' 에 맞는 덱이 여럿입니다: {', '.join(sorted(v[0] for v in found.values()))} "
                          "— decks/ 아래 경로로 적어 주세요")
    if not found:
        raise SlidesError(f"'{arg}' 에 맞는 덱을 찾지 못했습니다 — slides list 로 이름을 보거나, "
                          "웹에서 올린 덱이면 decks/ 아래 경로로 적어 주세요")
    return next(iter(found.values()))


def cmd_remove(repo: Repo, args) -> int:
    push = not args.no_push
    with repo.lock(wait=60):
        repo.preflight()
        if push:
            try:                                # 웹에서 올린 덱도 찾을 수 있게 먼저 받는다
                report_taken(repo.integrate(regen_paths(load_registry(repo, quiet=True))))
            except OfflineError as e:
                print(f"[안내] 원격에 닿지 못해 이 PC 에서만 내립니다: {e}")
                push = False
        reg = load_registry(repo)
        rel, kind, key = resolve_target(repo, reg, args.name)
        if kind == "dir":
            targets = [rel]
            shown = f"{rel}/ (폴더째)"
        else:                                   # 이름이 같은 덱 파일·정보 파일 모두. 이 PC 에서 먼저 지운 것도 git 에 있으면 함께
            cand = group_paths(rel)
            known = {os.path.normcase(p): p for p in repo.tracked(*cand)}
            targets = [canonical_case(repo.root, p) if (repo.root / p).exists() else known[os.path.normcase(p)]
                       for p in cand if (repo.root / p).exists() or os.path.normcase(p) in known]
            shown = ", ".join(targets)
        print(f"내릴 것: {shown}")
        print("갤러리에서는 사라지지만 git 기록(이전 판)에는 남습니다.")
        if not confirm("내릴까요?", args.yes):
            print("내리지 않았습니다.")
            return 1
        try:
            if repo.tracked(*targets):          # git 이 아는 파일만 지운다 — 폴더 덱 안의 커밋 전 파일은 남는다
                repo.git("rm", "-r", "-q", "-f", "--ignore-unmatch", "--", *targets)
            if kind == "file":
                for p in targets:               # 커밋한 적 없는 이 덱의 파일(정보 파일 등)
                    if (repo.root / p).is_file():
                        (repo.root / p).unlink()
        except OSError as e:
            raise SlidesError(f"다 지우지 못했습니다(다른 프로그램이 파일을 열고 있을 수 있음) — 닫고 다시 해 주세요: {e}")
        # 이름이 같은 등록 덱, 폴더째 내리면 그 안에 등록한 덱도 등록에서 뺀다(되살아나지 않게).
        gone = (key or rel).lower()
        stem = gone.rsplit(".", 1)[0]
        for k in [k for k in reg["decks"]
                  if (kind == "file" and k.lower().rsplit(".", 1)[0] == stem)
                  or (kind == "dir" and k.lower().startswith(gone + "/"))]:
            reg["decks"].pop(k)
        save_registry(repo, reg)
        name = Path(rel).stem if kind == "file" else Path(rel).name
        if repo.commit_paths(targets, f"docs: 덱 삭제 — {name}", removed=True):
            print(f"커밋: 덱 삭제 — {name}")
        if push and repo.has_remote():
            report_taken(repo.publish(regen_paths(reg)))
            print(f"{repo.remote}/{repo.target_branch} 에 올렸습니다")
        elif push:
            print(f"원격 저장소({repo.remote})가 없어 이 PC 에서만 내렸습니다.")
    return 0


def cmd_forget(repo: Repo, args) -> int:
    with repo.lock(wait=60):
        reg = load_registry(repo)
        key = find_entry(reg, args.name)
        if not key:
            raise SlidesError(f"등록된 덱에서 '{args.name}' 를 찾지 못했습니다 — slides list 로 이름을 확인해 주세요")
        reg["decks"].pop(key)
        save_registry(repo, reg)
    print(f"등록만 지웠습니다: {key} — 올린 덱은 그대로입니다(내리려면 slides remove).")
    return 0


def pages_url(repo: Repo) -> str | None:
    full = repo.site().get("repo")
    if not isinstance(full, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", full):
        url = repo.git("remote", "get-url", repo.remote, check=False).strip()
        m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", url)
        full = m.group(1) if m else None
    if not full:
        return None
    owner, name = full.split("/", 1)
    return f"https://{owner.lower()}.github.io/{name}/"


def print_urls(repo: Repo, rel: str | None = None) -> None:
    base = pages_url(repo)
    if not base:
        return
    print(f"갤러리: {base}  (Actions 가 1~2분 뒤 반영)")
    if rel:
        kind = kind_of(rel)
        if kind in (".pdf", ".pptx"):            # PDF·PPTX 는 갤러리의 뷰어로 연다
            print(f"이 덱: {base}viewer/{kind[1:]}.html#file={quote(rel, safe='')}")
        else:
            print(f"이 덱: {base}{quote(rel)}")


def cmd_url(repo: Repo, args) -> int:
    print(pages_url(repo) or "원격 저장소 주소를 찾지 못했습니다.")
    return 0


class LocalHandler(http.server.SimpleHTTPRequestHandler):
    """이 PC 에서만 쓰는 미리보기 서버 — 다른 이름(Host)으로 들어온 요청은 받지 않는다(DNS rebinding 막기)."""
    allowed_hosts: set = set()
    # Windows 는 확장자의 형식을 레지스트리에서 읽어 .mjs 를 엉뚱하게 줄 수 있다 — PDF 뷰어의 모듈이 안 돌지 않게 정해 둔다.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".wasm": "application/wasm", ".pdf": "application/pdf", ".svg": "image/svg+xml",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }

    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        if (self.headers.get("Host") or "").lower() not in self.allowed_hosts:
            self.send_error(421, "Misdirected Request")
            return False
        return True

    def log_message(self, *args) -> None:
        pass


def cmd_serve(repo: Repo, args) -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_manifest as bm  # noqa: E402 — 같은 폴더의 빌더
    out = repo.root / ".site"
    cache = repo.root / ".thumbcache"
    manifest = bm.build_manifest(repo.root, thumbs=not args.no_thumbs, cache=cache, use_git=True)
    bm.build_site(repo.root, out, manifest, cache)
    handler = type("Handler", (LocalHandler,), {})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port),
                                             functools.partial(handler, directory=str(out)))
    port = server.server_address[1]
    handler.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    url = f"http://127.0.0.1:{port}/"
    print(f"덱 {manifest['count']}개 — {url} 에서 미리 봅니다. 멈추려면 Ctrl+C")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n멈췄습니다.")
    finally:
        server.server_close()
    return 0


# ---------------------------------------------------------------- 이 PC 의 덱 고치기(slides edit)

EDIT_MAX = 256 * 1024 * 1024            # 편집기가 읽고 쓰는 덱의 최대 크기
BACKUP_KEEP = 30                        # 덱마다 남기는 '저장 전 판' 수
BACKUP_RE = re.compile(r"^\d{8}-\d{6}-\d{6}-[0-9a-f]{8}\.html?$")     # 이름 순서 = 남긴 순서
EDITOR_DIR = ROOT / "editor"
# 편집 화면(스크립트가 돌지 않음)이 부르는 덱 폴더의 파일 — 웹에서 쓰는 형식만. 발표 화면은 그 가운데 SHOW_TYPES 만.
EDIT_TYPES = {
    ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".mjs": "text/javascript", ".json": "application/json", ".map": "application/json", ".txt": "text/plain",
    ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".xml": "application/xml", ".vtt": "text/vtt",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg", ".ogg": "audio/ogg",
    ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
    ".flac": "audio/flac", ".pdf": "application/pdf", ".wasm": "application/wasm",
}
EDITOR_TYPES = (".html", ".css", ".js", ".svg")     # 편집기 자신의 파일
# 발표 화면(덱 스크립트가 도는 쪽)이 내주는 것 — 고치는 덱 자신과 화면을 그리는 자료(스타일·스크립트·그림·글꼴·소리·영상)만.
# 덱 스크립트(덱이 불러 쓰는 남의 라이브러리 포함)가 이름을 맞혀 같은 폴더의 문서·자료(.json·.txt·.pdf·다른 HTML 등)를
# 읽어 가지 못하게 한다.
SHOW_TYPES = {".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp",
              ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".m4v", ".webm", ".ogv", ".ogg", ".opus", ".mp3", ".wav",
              ".m4a", ".aac", ".flac", ".vtt"}
# 개인 파일이 모이는 폴더 — 여기 둔 덱에는 발표 화면을 열지 않는다(덱 스크립트가 사진 이름 등을 맞혀 읽지 못하게)
PERSONAL_DIRS = {"desktop", "documents", "downloads", "pictures", "videos", "music",
                 "바탕 화면", "문서", "다운로드", "사진", "동영상", "음악"}


def backup_home() -> Path:
    """저장 전 판을 남기는 곳 — Windows 는 %LOCALAPPDATA% 아래 html-slides/backups."""
    base = os.environ.get("LOCALAPPDATA")
    return (Path(base) if base else Path.home() / ".local" / "share") / "html-slides" / "backups"


def personal_folder(folder: Path) -> bool:
    """드라이브 맨 위, 홈과 그 위, 홈(또는 OneDrive) 바로 아래의 바탕 화면·문서·다운로드·사진 등인가."""
    try:
        f = folder.resolve()
        home = Path.home().resolve()
    except (OSError, RuntimeError):
        return True
    if f.parent == f or inside(home, f):
        return True
    name = f.name.lower()
    if f.parent == home and (name in PERSONAL_DIRS or name.startswith("onedrive")):
        return True
    return f.parent.parent == home and f.parent.name.lower().startswith("onedrive") and name in PERSONAL_DIRS


def write_atomic(dst: Path, data: bytes) -> None:
    """임시 파일에 다 쓴 뒤 한 번에 바꿔 넣는다 — 쓰다 멈춰도 반쯤 쓴 덱이 남지 않는다."""
    fd, tmp = tempfile.mkstemp(prefix=".slides-", suffix=".tmp", dir=str(dst.parent))
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        if os.name != "nt" and dst.exists():
            shutil.copymode(dst, tmp)           # mkstemp 는 나만 읽는 권한(0600)으로 만든다
        replace_retry(tmp, dst)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def like_original(text: str, cur: bytes | None) -> bytes:
    """편집기가 보낸 글(줄바꿈은 늘 LF)을 지금 파일의 줄바꿈(CRLF)·BOM 에 맞춘 바이트로 — 손대지 않은 줄까지 바뀐 것으로 보이지 않게."""
    out = text.replace("\r\n", "\n")
    if cur:
        crlf = cur.count(b"\r\n")
        if crlf and crlf == cur.count(b"\n"):
            out = out.replace("\n", "\r\n")
    data = out.encode("utf-8")
    if cur and cur.startswith(b"\xef\xbb\xbf") and not data.startswith(b"\xef\xbb\xbf"):
        data = b"\xef\xbb\xbf" + data
    return data


def safe_child(base: Path, rel: str) -> Path | None:
    """주소에서 온 /-경로 rel 이 가리키는 base 안의 파일. 밖으로 나가거나, 숨긴 이름(. 으로 시작)이거나,
    드라이브·스트림(:)·역슬래시가 섞였으면 None."""
    parts = rel.split("/")
    if not rel or any(p in ("", ".", "..") or p.startswith(".") or ":" in p or "\\" in p for p in parts):
        return None
    try:
        root = base.resolve()
        file = root.joinpath(*parts).resolve()
        if not inside(file, root) or any(p.startswith(".") for p in file.relative_to(root).parts):
            return None             # 짧은 이름(8.3)·링크로 숨긴 이름이나 밖을 가리킨 것
        return file if file.is_file() else None
    except (OSError, ValueError):
        return None


class EditConflict(Exception):
    """편집기를 연 뒤에 파일이 다른 곳에서 바뀌었다. now: 지금 파일의 지문(없으면 '')."""

    def __init__(self, now: str):
        super().__init__(now)
        self.now = now


class EditSession:
    """slides edit 한 번 — 고칠 파일 하나와 열쇠 둘.
    key: 편집기·저장 API·편집 화면이 부르는 덱 폴더(주소의 # 뒤로만 건넨다).
    show_key: 발표 화면 — 덱 스크립트가 보는 주소에는 이 열쇠만 들어간다."""

    def __init__(self, path: Path, backups: Path):
        self.path = path
        self.folder = path.parent
        self.key = token_urlsafe(32)
        self.show_key = token_urlsafe(32)
        tag = hashlib.sha256(os.path.normcase(str(path)).encode("utf-8")).hexdigest()[:10]
        self.backups = backups / f"{path.stem[:40]}-{tag}"
        self.first: Path | None = None          # 이번 실행에서 처음 남긴 판 — 고치기 시작하기 전의 파일
        self.lock = threading.Lock()
        self.present_url = ""

    def read(self) -> bytes | None:
        try:
            return self.path.read_bytes()
        except FileNotFoundError:
            return None

    def keep(self, data: bytes) -> Path:
        """저장 전 판을 남기고, 오래된 것은 최근 BACKUP_KEEP 개만 남긴다. 이번 실행에서 처음 남긴 판(고치기 시작하기 전의
        파일)은 수와 상관없이 둔다. 이름의 시각은 늘 앞 판보다 뒤로 매긴다 — 시계가 거칠거나(옛 Windows 의 Python 은 약
        16ms) 뒤로 가도 이름 순서가 남긴 순서와 같아야 오래된 것부터 지운다."""
        self.backups.mkdir(parents=True, exist_ok=True)
        when = dt.datetime.now()
        names = sorted(p.name for p in self.backups.iterdir() if BACKUP_RE.match(p.name))
        if names:
            try:
                when = max(when, dt.datetime.strptime(names[-1][:22], "%Y%m%d-%H%M%S-%f") + dt.timedelta(microseconds=1))
            except ValueError:
                pass
        dst = self.backups / f"{when:%Y%m%d-%H%M%S-%f}-{hashlib.sha256(data).hexdigest()[:8]}{self.path.suffix.lower()}"
        write_atomic(dst, data)
        if self.first is None:
            self.first = dst
        for old in sorted(p for p in self.backups.iterdir() if BACKUP_RE.match(p.name))[:-BACKUP_KEEP]:
            if old == self.first:
                continue
            try:
                old.unlink()
            except OSError:
                pass
        return dst

    def history(self) -> list[dict]:
        """남긴 저장 전 판 — 새것부터. time: 남긴 때(밀리초 — 이름의 시각), first: 이번 실행에서 고치기 시작하기 전의 판."""
        try:
            files = sorted((p for p in self.backups.iterdir() if BACKUP_RE.fullmatch(p.name)), reverse=True)
        except OSError:
            return []
        out = []
        for p in files:
            try:
                when = dt.datetime.strptime(p.name[:22], "%Y%m%d-%H%M%S-%f")
                size = p.stat().st_size
            except (ValueError, OSError):
                continue
            out.append({"id": p.name, "time": int(when.timestamp() * 1000), "size": size, "first": p == self.first})
        return out

    def backup(self, name: str) -> bytes | None:
        """저장 전 판 하나의 바이트 — 판 이름 꼴이 아니거나(경로가 섞인 이름 등) 없으면 None."""
        if not BACKUP_RE.fullmatch(name):
            return None
        try:
            return (self.backups / name).read_bytes()
        except OSError:
            return None

    def save(self, text: str, want: str, force: bool) -> tuple[str, Path | None]:
        """편집기를 연 판(want: 지문)이 지금 파일과 같을 때만 쓴다. force 면 그대로 덮되 지금 판은 남긴다.
        (새 지문, 남긴 판 — 바뀐 것이 없으면 None)"""
        with self.lock:
            cur = self.read()
            now = hashlib.sha256(cur).hexdigest() if cur is not None else ""
            if not force and (cur is None or want != now):
                raise EditConflict(now)
            data = like_original(text, cur)
            if data == cur:
                return now, None
            kept = self.keep(cur) if cur is not None else None
            write_atomic(self.path, data)
            return hashlib.sha256(data).hexdigest(), kept


class EditServer(http.server.ThreadingHTTPServer):
    """Windows 의 SO_REUSEADDR 은 남이 쓰는 포트에도 붙으므로 끄고, 남이 이 포트를 가로채지 못하게 독점으로 연다."""
    allow_reuse_address = os.name != "nt"
    missed_port = 0          # 덱마다 쓰는 포트(stable_port)를 못 써 빈 포트로 열었으면 그 포트

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class EditHandler(http.server.BaseHTTPRequestHandler):
    """slides edit 의 서버. 편집기(edit)와 발표 화면(show)은 포트를 나눠 출처가 다르다.
    - 둘 다 이 PC 의 이름(127.0.0.1·localhost)과 제 포트로 온 요청만 받는다(DNS rebinding 막기).
    - edit: 편집기 파일, 덱 읽기·저장 API(열쇠 머리글 + 같은 출처에서 온 요청만), 편집 화면이 부르는 덱 폴더의 그림·글꼴.
      덱 폴더의 파일은 문서로 열려도 스크립트가 돌지 않게 CSP sandbox 를 붙인다.
    - show: 덱 폴더만 — 덱 스크립트가 도는 곳이라 저장 API 와 출처·열쇠를 나눈다."""
    server_version = "slides-edit"
    sys_version = ""
    session: EditSession
    role = "edit"
    allowed_hosts: set = set()
    origins: set = set()

    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        if (self.headers.get("Host") or "").lower() not in self.allowed_hosts:
            self.send_error(421, "Misdirected Request")
            return False
        return True

    def log_message(self, *args) -> None:
        pass

    # ---- 응답
    def _send(self, status: int, ctype: str, body: bytes, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, **obj) -> None:
        self._send(status, "application/json; charset=utf-8", json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _missing(self) -> None:
        self._send(404, "text/plain; charset=utf-8", "없는 주소입니다.".encode("utf-8"))

    def _route(self) -> str | None:
        path = unquote(urlsplit(self.path).path)
        return None if "\x00" in path else path

    # ---- GET
    def do_GET(self) -> None:
        path = self._route()
        if path is None:
            return self._missing()
        if self.role == "show":
            return self._deck_file(path, self.session.show_key)
        if path == "/api/deck":
            return self._get_deck()
        if path == "/api/history":
            return self._get_history()
        if path.startswith("/api/history/"):
            return self._get_backup(path[len("/api/history/"):])
        if path.startswith("/deck-files/"):
            return self._deck_file(path, self.session.key)
        if path.startswith("/editor/"):
            return self._static(EDITOR_DIR, path[len("/editor/"):] or "index.html")
        if path == "/assets/favicon.svg":
            return self._static(ROOT / "assets", "favicon.svg")
        self._missing()

    def _static(self, base: Path, rel: str) -> None:
        file = safe_child(base, rel)
        if file is None or file.suffix.lower() not in EDITOR_TYPES:
            return self._missing()
        try:
            body = file.read_bytes()
        except OSError:
            return self._missing()
        ctype = EDIT_TYPES[file.suffix.lower()]
        self._send(200, ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""), body)

    def _deck_file(self, path: str, key: str) -> None:
        parts = path.split("/", 3)                      # ['', 'deck-files', 열쇠, 덱 폴더 안의 경로]
        if (len(parts) < 4 or parts[1] != "deck-files"
                or not hmac.compare_digest(parts[2].encode("utf-8"), key.encode("ascii"))):
            return self._missing()
        file = safe_child(self.session.folder, parts[3])
        ctype = EDIT_TYPES.get(file.suffix.lower()) if file else None
        if ctype and self.role == "show" and file != self.session.path and file.suffix.lower() not in SHOW_TYPES:
            ctype = None                                # 발표 화면에는 덱 자신과 화면 자료만
        if not ctype:
            return self._missing()
        try:
            body = file.read_bytes()
        except OSError:
            return self._missing()
        if file == self.session.path:
            ctype += "; charset=utf-8"                  # 고치는 덱은 UTF-8 이다(열 때 확인)
        # 편집 쪽 출처에서는 문서로 열려도 스크립트가 돌지 않게(그림·글꼴처럼 불러 쓰는 것에는 상관없음)
        self._send(200, ctype, body, {"Content-Security-Policy": "sandbox"} if self.role == "edit" else None)

    # ---- 덱 읽기·저장 API
    def _api_ok(self, put: bool) -> bool:
        """열쇠 머리글이 맞고 편집기(같은 출처)에서 온 요청인가. 아니면 403 을 보내고 False."""
        given = (self.headers.get("X-HSE-Key") or "").encode("latin-1", "replace")
        origin = self.headers.get("Origin")
        if not hmac.compare_digest(given, self.session.key.encode("ascii")):
            why = "열쇠가 맞지 않습니다 — slides edit 이 알려 준 주소로 다시 여세요"
        elif ((put or origin is not None) and origin not in self.origins) or \
                self.headers.get("Sec-Fetch-Site") not in (None, "same-origin"):
            why = "편집기가 아닌 곳에서 온 요청은 받지 않습니다"
        else:
            return True
        self.close_connection = True
        self._json(403, error=why)
        return False

    def _get_deck(self) -> None:
        if not self._api_ok(put=False):
            return
        s = self.session
        data = s.read()
        if data is None:
            return self._json(404, error=f"파일이 없어졌습니다 — {s.path}")
        if len(data) > EDIT_MAX:
            return self._json(413, error=f"덱이 너무 큽니다 — 편집기는 {EDIT_MAX >> 20} MB 까지 엽니다")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return self._json(415, error="UTF-8 로 저장된 HTML 이 아닙니다 — UTF-8 로 다시 저장한 뒤 여세요")
        self._send(200, "application/octet-stream", data, {
            "X-HSE-Hash": hashlib.sha256(data).hexdigest(),
            "X-HSE-Name": quote(s.path.name, safe=""),
            "X-HSE-Path": quote(str(s.path), safe=""),
            "X-HSE-Present": s.present_url,
        })

    # 판 기록 — 저장 전 판의 목록과 내용(편집기의 ‘판 기록’이 부른다. 덱 읽기와 같은 열쇠·출처 확인)
    def _get_history(self) -> None:
        if not self._api_ok(put=False):
            return
        self._json(200, items=self.session.history())

    def _get_backup(self, name: str) -> None:
        if not self._api_ok(put=False):
            return
        data = self.session.backup(name)
        if data is None:
            return self._json(404, error="그 판을 찾지 못했습니다 — 오래되어 지웠을 수 있습니다")
        if len(data) > EDIT_MAX:
            return self._json(413, error=f"판이 너무 큽니다 — 편집기는 {EDIT_MAX >> 20} MB 까지 엽니다")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return self._json(415, error="UTF-8 로 저장된 HTML 이 아닙니다")
        self._send(200, "application/octet-stream", data, {"X-HSE-Hash": hashlib.sha256(data).hexdigest()})

    def do_PUT(self) -> None:
        if self.role != "edit" or self._route() != "/api/deck":
            self.close_connection = True
            return self._missing()
        if not self._api_ok(put=True):
            return
        size = self.headers.get("Content-Length") or ""
        if not re.fullmatch(r"[0-9]{1,12}", size):
            self.close_connection = True
            return self._json(411, error="보낸 내용의 크기(Content-Length)가 없습니다")
        n = int(size)
        if n > EDIT_MAX:
            self.close_connection = True
            return self._json(413, error=f"덱이 너무 큽니다({n >> 20} MB) — {EDIT_MAX >> 20} MB 까지 저장합니다")
        body = self.rfile.read(n)
        if len(body) != n:
            return self._json(400, error="보낸 내용이 중간에 끊겼습니다")
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            return self._json(400, error="UTF-8 글이 아닙니다")
        if not text.strip():
            return self._json(400, error="빈 내용은 저장하지 않습니다")
        want = (self.headers.get("If-Match") or "").strip().strip('"')
        try:
            digest, kept = self.session.save(text, want, self.headers.get("X-HSE-Force") == "1")
        except EditConflict as e:
            return self._json(409, error="편집기를 연 뒤에 파일이 다른 곳에서 바뀌었습니다", hash=e.now)
        except OSError as e:
            return self._json(500, error="파일에 쓰지 못했습니다 — 읽기 전용이거나 다른 프로그램이 쓰는 중일 수 "
                                         f"있습니다({e.strerror or e.__class__.__name__})")
        print(f"[{stamp()}] 저장했습니다 — {self.session.path.name}" + (f"  (저장 전 판: {kept})" if kept else ""),
              flush=True)
        self._json(200, hash=digest, backup=str(kept) if kept else "")


def edit_target(repo: Repo, arg: str) -> Path:
    """slides edit 이 고칠 파일 — 파일 경로, 아니면 slides add 로 등록한 덱 이름(그 원본)."""
    p = Path(arg).expanduser()
    if not p.exists():
        reg = load_registry(repo, quiet=True)
        key = find_entry(reg, arg)
        if not key:
            raise SlidesError(f"'{arg}' 라는 파일도, 그 이름으로 등록한 덱도 없습니다 — 파일 경로나 slides list 의 이름을 적어 주세요")
        p = Path(reg["decks"][key]["source"])
        if not p.exists():
            raise SlidesError(f"등록한 원본이 없습니다: {p}")
    p = p.resolve()
    if not p.is_file():
        raise SlidesError(f"파일이 아닙니다: {p}")
    if p.suffix.lower() not in (".html", ".htm"):
        raise SlidesError("HTML 덱만 고칠 수 있습니다 — PDF·PPTX 는 원래 프로그램에서 고친 뒤 slides sync 로 올리세요")
    if inside(p, repo.root):
        rel = p.relative_to(repo.root).as_posix()
        entry = load_registry(repo, quiet=True)["decks"].get(rel)
        hint = (f'원본을 고치세요: slides edit "{entry["source"]}"' if entry
                else "저장소의 덱은 갤러리에서 덱 카드의 ⋯ → ‘편집기에서 열기’로 고칩니다")
        raise SlidesError(f"저장소 안의 파일({rel})은 여기서 고치지 않습니다 — decks/ 는 원본을 비춰 두는 거울입니다. {hint}")
    size = p.stat().st_size
    if size > EDIT_MAX:
        raise SlidesError(f"덱이 너무 큽니다({size >> 20} MB) — 편집기는 {EDIT_MAX >> 20} MB 까지 엽니다")
    try:
        p.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        raise SlidesError("UTF-8 로 저장된 HTML 만 고칠 수 있습니다 — 다른 편집기에서 UTF-8 로 다시 저장한 뒤 여세요") from None
    return p


STABLE_PORT_BASE, STABLE_PORT_SPAN = 41000, 8000


def stable_port(path: Path) -> int:
    """덱 파일마다 늘 같은 편집기 포트(41000~48999). 편집기의 임시 저장본(브라우저 IndexedDB)은 주소(127.0.0.1:포트)마다
    따로라, 실행마다 포트가 같아야 지난 실행에서 저장하지 않고 닫은 고침을 다음 실행의 ‘판 기록’에서 다시 찾는다."""
    key = os.path.normcase(str(path.resolve())).encode("utf-8")
    return STABLE_PORT_BASE + int.from_bytes(hashlib.sha256(key).digest()[:4], "big") % STABLE_PORT_SPAN


def edit_servers(session: EditSession, port: int = 0) -> tuple[EditServer, EditServer | None, str]:
    """편집기 서버와 발표 화면 서버를 연다(아직 돌리지는 않는다). 덱이 개인 파일이 모이는 폴더에 있으면 발표 화면
    서버는 열지 않는다(None). 편집기는 port 를 주지 않으면 덱마다 같은 포트(stable_port)를 먼저 쓰고, 그 포트를 못 쓰면
    (다른 프로그램이나 같은 덱의 다른 실행이 쓰는 중 등) 빈 포트로 연다. (편집기 서버, 발표 화면 서버, 편집기 주소)"""
    made: list[EditServer] = []
    roles = [("edit", port)] + ([] if personal_folder(session.folder) else [("show", 0)])
    for role, want in roles:
        handler = type(f"Edit{role.title()}Handler", (EditHandler,), {"session": session, "role": role})
        tries = [stable_port(session.path), 0] if role == "edit" and not want else [want]
        for i, w in enumerate(tries):
            try:
                srv = EditServer(("127.0.0.1", w), handler)
                break
            except OSError as e:
                if i + 1 < len(tries):
                    continue
                for s in made:
                    s.server_close()
                raise SlidesError(f"127.0.0.1:{w} 에 서버를 열지 못했습니다 — {e.strerror or e}"
                                  + (" (다른 --port 로 해 보세요)" if w else ""))
        srv.missed_port = tries[0] if w != tries[0] else 0
        p = srv.server_address[1]
        handler.allowed_hosts = {f"127.0.0.1:{p}", f"localhost:{p}"}
        handler.origins = {f"http://{h}" for h in handler.allowed_hosts}
        made.append(srv)
    edit, show = made[0], (made[1] if len(made) > 1 else None)
    if show:
        session.present_url = (f"http://127.0.0.1:{show.server_address[1]}/deck-files/{session.show_key}/"
                               f"{quote(session.path.name)}")
    return edit, show, f"http://127.0.0.1:{edit.server_address[1]}/editor/?local=1#key={session.key}"


def run_edit(edit: EditServer, show: EditServer | None) -> None:
    if show:
        threading.Thread(target=show.serve_forever, daemon=True).start()
    try:
        edit.serve_forever()
    except KeyboardInterrupt:
        print("\n멈췄습니다 — 열려 있는 편집기에서는 더 저장되지 않습니다(고친 것이 남았으면 편집기의 ‘내려받기’로 받으세요).")
    finally:
        if show:
            show.shutdown()
            show.server_close()
        edit.server_close()


def cmd_edit(repo: Repo, args) -> int:
    path = edit_target(repo, args.file)
    session = EditSession(path, Path(args.backup_dir) if args.backup_dir else backup_home())
    edit, show, url = edit_servers(session, args.port)
    print(f"고칠 덱: {path}")
    print(f"편집기: {url}")
    if edit.missed_port:
        print(f"  이 덱이 늘 쓰는 포트 {edit.missed_port} 를 다른 실행이나 프로그램이 쓰는 중이라 빈 포트로 열었습니다 — 이번에는 "
              "‘판 기록’에 지난 실행의 임시 저장본이 보이지 않습니다(지워지지는 않습니다). 그 포트를 쓰는 것을 닫고 다시 실행하면 "
              "보입니다.")
    print(f"  저장하면 이 파일에 바로 씁니다. 저장 전 판은 {session.backups} 에 남깁니다"
          f"(최근 {BACKUP_KEEP}개와, 이번에 고치기 시작하기 전의 판).")
    if show is None:
        print("  덱이 개인 파일이 모이는 폴더(바탕 화면·문서·다운로드 등)에 있어 ‘발표로 보기’는 켜지 않습니다 — "
              "발표는 파일을 바로 여세요(덱을 따로 만든 폴더에 두면 켜집니다).")
    print("  주소의 key 는 이번 실행에만 쓰는 열쇠입니다. 다 고쳤으면 이 창에서 Ctrl+C 로 멈추세요.", flush=True)
    if not args.no_open:
        webbrowser.open(url)
    run_edit(edit, show)
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="slides", description="html-slides 로컬 도구")
    ap.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="덱을 등록하고 올린다(HTML·PDF·PPTX)")
    a.add_argument("source", help="원본 HTML·PDF·PPTX 파일(저장소 폴더 밖)")
    a.add_argument("--name", help="저장소에서 쓸 이름(주소에 들어감, 기본: 원본 파일 이름)")
    a.add_argument("--folder", help="폴더(예: conf, seminar/2026)")
    a.add_argument("--folder-label", help="폴더의 표시 이름(예: 학회 발표)")
    a.add_argument("--title", help="갤러리에 보일 제목(기본: HTML 의 <title>, PDF·PPTX 의 문서 제목)")
    a.add_argument("--desc", help="한두 줄 설명")
    a.add_argument("--date", help="발표일 YYYY-MM-DD")
    a.add_argument("--venue", help="발표 자리(학회·세미나 이름)")
    a.add_argument("--authors", help="발표자")
    a.add_argument("--tags", help="쉼표로 나눈 꼬리표")
    a.add_argument("--pptx", help="HTML·PDF 덱에 함께 올릴 PPTX(받기·보기로 붙음, 만든 이·발표자 노트도 함께 공개됨)")
    a.add_argument("--force", action="store_true", help="저장소에 있는 판을 이 원본으로 덮는다")
    a.add_argument("--ignore-scan", action="store_true", help="열쇠·토큰 점검에 걸려도 올린다(잘못 찾은 경우)")
    a.add_argument("--yes", action="store_true", help="공개 저장소 확인을 건너뛴다")
    a.add_argument("--no-push", action="store_true", help="커밋만 하고 올리지 않는다")
    a.set_defaults(func=cmd_add)

    s = sub.add_parser("sync", help="바뀐 덱을 맞춰 올린다")
    s.add_argument("--no-push", action="store_true")
    s.add_argument("--trust-remote", action="store_true",
                   help="원격의 새 판이 decks/ 밖(도구·사이트 코드)을 바꿨어도 받는다 — 직접 올린 것인지 살펴본 뒤에만")
    s.set_defaults(func=cmd_sync)

    w = sub.add_parser("watch", help="원본을 지켜보다 저장되면 자동으로 올린다")
    w.add_argument("--interval", type=float, default=2.0, help="살피는 간격(초)")
    w.add_argument("--settle", type=float, default=8.0, help="마지막 저장 뒤 기다릴 시간(초)")
    w.add_argument("--min-gap", type=float, default=30.0, help="올린 뒤 다음 올리기까지 최소 간격(초)")
    w.add_argument("--no-push", action="store_true")
    w.set_defaults(func=cmd_watch)

    sub.add_parser("list", help="등록한 덱과 상태").set_defaults(func=cmd_list)

    r = sub.add_parser("remove", help="덱을 내린다")
    r.add_argument("name", help="덱 이름 또는 decks/ 아래 경로")
    r.add_argument("--yes", action="store_true")
    r.add_argument("--no-push", action="store_true")
    r.set_defaults(func=cmd_remove)

    f = sub.add_parser("forget", help="등록만 지운다(올린 덱은 그대로)")
    f.add_argument("name", help="덱 이름")
    f.set_defaults(func=cmd_forget)

    v = sub.add_parser("serve", help="이 PC 에서 갤러리를 미리 본다")
    v.add_argument("--port", type=int, default=8765)
    v.add_argument("--no-thumbs", action="store_true", help="미리보기 그림을 찍지 않는다")
    v.add_argument("--no-open", action="store_true", help="브라우저를 열지 않는다")
    v.set_defaults(func=cmd_serve)

    e = sub.add_parser("edit", help="덱을 편집기로 열어 고치고 그 파일에 저장한다")
    e.add_argument("file", help="고칠 HTML 덱(파일 경로, 또는 slides add 로 등록한 덱 이름 — 그 원본을 연다)")
    e.add_argument("--port", type=int, default=0, help="편집기 포트(기본: 덱마다 같은 포트, 쓰는 중이면 빈 포트)")
    e.add_argument("--no-open", action="store_true", help="브라우저를 열지 않는다")
    e.add_argument("--backup-dir", help=argparse.SUPPRESS)
    e.set_defaults(func=cmd_edit)

    sub.add_parser("url", help="갤러리 주소").set_defaults(func=cmd_url)
    return ap


def main(argv: list[str] | None = None) -> int:
    # Windows 가 현재 폴더의 python·git 을 먼저 집어 쓰지 않게 한다(심어 둔 실행 파일 막기).
    os.environ["NoDefaultCurrentDirectoryInExePath"] = "1"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    try:
        repo = Repo(args.root)
        return args.func(repo, args)
    except OfflineError as e:
        print(f"오류: {e}\n  이 PC 의 커밋은 그대로이니, 연결되면 slides sync 로 마저 올리세요.", file=sys.stderr)
        return 2
    except SlidesError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
