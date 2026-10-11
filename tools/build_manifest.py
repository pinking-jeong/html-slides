#!/usr/bin/env python3
"""html-slides 사이트 빌더.

decks/ 아래의 발표자료(HTML·PDF·PPTX)를 찾아 목록(decks.json)과 첫 장 미리보기 그림을 만들고,
갤러리·뷰어와 덱을 한 사이트 폴더로 꾸린다. GitHub Actions 가 push 마다 돌리고,
로컬에서는 `slides serve` 가 부른다.

    python tools/build_manifest.py --out _site [--thumbs] [--cache .thumbcache] [--no-git]

덱을 찾는 규칙
- decks/<폴더…>/<이름>.html            → 파일 하나로 된 덱
- decks/<폴더…>/<이름>/index.html      → 여러 파일로 된 덱(그 폴더 안은 에셋으로 본다)
- decks/<폴더…>/<이름>.pdf             → PDF 덱(갤러리 안의 PDF.js 뷰어로 재생)
- decks/<폴더…>/<이름>.pptx            → PPTX 덱(Office 웹 뷰어로 재생, 10 MB 이하)
- 이름이 같은 파일은 한 덱이다: HTML > PDF > PPTX 차례로 앞의 것이 덱이 되고,
  뒤의 PDF·PPTX 는 그 덱에 붙는다(받기·다른 뷰어로 보기)
- <이름>.meta.json(폴더 덱은 meta.json) → 제목·설명·발표일·학회·숨김 등을 덮어쓴다
- decks/folders.json                    → 폴더 키의 표시 이름과 순서
- decks/gallery.json                    → 갤러리 첫 화면에서 편집한 배치(분류 목록·이름·순서, 덱별 분류, 덱 순서).
  웹 편집기가 저장하고 slides 는 쓰지 않는다. 파일은 옮기지 않으므로 분류를 바꿔도 덱 주소는 그대로다
- _ 나 . 로 시작하는 파일·폴더와 바로가기(symlink)는 덱으로 보지 않고 사이트에도 싣지 않는다
- hidden: true 인 덱은 목록에서 빼고 사이트에도 싣지 않는다(공개 저장소에는 그대로 있다)
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import hashlib
import html
import http.server
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import zipfile
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DECKS_DIR = "decks"
SITE_FILES = ("index.html",)
SITE_DIRS = ("assets", "viewer", "vendor", "editor")
HTML_SUFFIXES = (".html", ".htm")
PRIMARY_ORDER = (".html", ".htm", ".pdf", ".pptx")   # 이름이 같은 파일 가운데 덱이 되는 차례
DECK_SUFFIXES = PRIMARY_ORDER
META_SUFFIX = ".meta.json"
PDF_VIEWER = "viewer/pdf.html"
REV_LEN = 12                           # 뷰어 주소에 붙이는 판 표시(내용 지문 앞부분) — 바뀐 판을 새로 받게
ZIP_PART_MAX = 20 * 1024 * 1024        # PPTX 안에서 읽을 XML·그림 한 조각의 최대 크기(압축 폭탄 막기)
PREVIEW_PREFIXES = (f"/{DECKS_DIR}/", "/viewer/", "/vendor/")
FOLDERS_FILE = "folders.json"
LAYOUT_FILE = "gallery.json"
LAYOUT_MAX_BYTES = 1_000_000           # 배치 파일 크기 상한 — 손으로 고친 파일이 커도 빌드가 멈추지 않게
LAYOUT_MAX_ITEMS = 5000                # 분류·덱 목록에서 읽는 항목 수 상한
KEY_MAX = 200                          # 분류 키 길이(디렉터리 폴더 키는 decks/ 아래 경로라 길 수 있다)
LABEL_MAX = 80
SITE_MARKER = ".html-slides-site"
HEAD_BYTES = 262144                    # <title>·<meta> 는 문서 앞부분에서만 찾는다
THUMB_BOX = (960, 540)                 # 미리보기 그림 최대 크기(16:9)
THUMB_SELECTORS = (                    # 첫 장만 잘라 찍을 요소(앞에서부터 시도)
    ".stage .slide.on", ".stage", ".reveal .slides",
    ".slide.on", ".slide.active", ".slide.current",
)
ROBOTS_META = '<meta name="robots" content="noindex, nofollow">'
BOM = chr(0xFEFF)

# 덱은 믿을 수 없는 입력이라 태그 하나를 찾는 정규식은 길이를 묶는다(짝 없는 태그가 많아도 빌드가 멈추지 않게).
TITLE_OPEN_RE = re.compile(r"<title\b[^<>]{0,1024}>", re.I)
TITLE_CLOSE_RE = re.compile(r"</title", re.I)
META_TAG_RE = re.compile(r"<meta\b[^>]{0,4096}>", re.I)
ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
BLOCK_TAG_RE = re.compile(r"<(?:div|section)\b([^<>]{0,4096})>", re.I)
CLASS_RE = re.compile(r"""\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
HEAD_OPEN_RE = re.compile(r"<head\b[^>]{0,4096}>", re.I)
HTML_OPEN_RE = re.compile(r"<html\b[^>]{0,4096}>", re.I)
DOCTYPE_RE = re.compile(r"<!doctype[^>]{0,4096}>", re.I)
SLD_LIST_RE = re.compile(r"<(?:\w{1,32}:)?sldIdLst\b[^<>]{0,1024}>")
SLD_LIST_END_RE = re.compile(r"</(?:\w{1,32}:)?sldIdLst\s*>")
SLD_ID_RE = re.compile(r"<(?:\w{1,32}:)?sldId\b")
CORE_TITLE_RE = re.compile(r"<(?:\w{1,32}:)?title\b[^<>]{0,1024}>([^<]{0,4000})<")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CACHE_NAME_RE = re.compile(r"^[0-9a-f]{16}\.(?:json|webp)$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
LAYOUT_REV_RE = re.compile(r"^[0-9A-Za-z:._+-]{1,64}$")
# 웹 편집기가 만드는 커밋의 작성자 — 개인 메일이 공개 기록에 남지 않게 GitHub noreply 주소만 받는다
NOREPLY_RE = re.compile(r"^[0-9]{1,12}\+[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})@users\.noreply\.github\.com$")
# 분류 이름에서 띄어쓰기로 바꾸는 글자 — 제어 문자(C0·DEL·C1)와 BOM
LABEL_SPACE_RE = re.compile(r"[\x00-\x1f\x7f-\x9f\N{ZERO WIDTH NO-BREAK SPACE}]")

PROBE_JS = """() => {
  const q = s => document.querySelectorAll(s).length;
  let n = 0, how = '';
  if (q('.stage .slide')) { n = q('.stage .slide'); how = 'stage'; }
  else if (q('.reveal .slides > section')) { n = q('.reveal .slides > section'); how = 'reveal'; }
  else if (q('section.slide, div.slide')) { n = q('section.slide, div.slide'); how = 'slide'; }
  else if (q('body > section') > 1) { n = q('body > section'); how = 'section'; }
  return { slides: n || null, how: how, title: document.title || '' };
}"""
FONTS_JS = """() => Promise.race([
  document.fonts ? document.fonts.ready.then(() => true) : true,
  new Promise(r => setTimeout(() => r(false), 5000)),
])"""
PDF_DONE_JS = "() => ['ready', 'error'].includes(document.documentElement.dataset.state)"
PDF_TITLE_JUNK = re.compile(r"^(?:Microsoft (?:PowerPoint|Word) - )|\.(?:pptx?|docx?|pdf|key)$", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


def well_formed(s: str) -> str:
    """짝 없는 써로게이트(JSON 의 짝 없는 써로게이트 이스케이프 등)를 U+FFFD 로 — 그대로 두면 decks.json 을
    UTF-8 로 쓰지 못해 빌드가 멈춘다. 브라우저의 String.prototype.toWellFormed 와 같다."""
    return s.encode("utf-16", "surrogatepass").decode("utf-16", "replace")


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", well_formed(html.unescape(s or ""))).strip()


def clean_label(s: str) -> str:
    """분류 이름 — HTML 로 풀지 않는다(웹 편집기에 친 ‘Lab&notes’ 가 ‘Lab¬es’ 가 되지 않게). 짝 없는 써로게이트는
    U+FFFD, 제어 문자·BOM 은 띄어쓰기로, 띄어쓰기는 한 칸으로, 80글자(코드 포인트)까지.
    assets/gallery.js 의 cleanLabel 과 같은 규칙이라 편집기에서 본 이름이 배포 뒤에도 그대로다."""
    s = " ".join(LABEL_SPACE_RE.sub(" ", well_formed(s)).split())
    return s[:LABEL_MAX].rstrip()


def is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def text_field(meta: dict, key: str) -> str:
    v = meta.get(key)
    return clean_text(str(v)) if isinstance(v, (str, int, float)) and not isinstance(v, bool) else ""


def tags_field(meta: dict) -> list[str]:
    v = meta.get("tags")
    if isinstance(v, str):
        items = v.split(",")
    elif isinstance(v, list):
        items = [x for x in v if isinstance(x, (str, int, float)) and not isinstance(x, bool)]
    else:
        return []
    return [t for t in (clean_text(str(x)) for x in items) if t][:20]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_files(path: Path):
    """바로가기(symlink)를 따라가지 않고 파일을 훑는다."""
    for cur, dirs, files in os.walk(path):
        dirs.sort()
        for name in sorted(files):
            p = Path(cur) / name
            if not p.is_symlink():
                yield p


def sha256_tree(path: Path) -> str:
    """폴더 덱의 내용 지문 — 상대 경로와 파일 내용을 함께 섞는다."""
    h = hashlib.sha256()
    for p in walk_files(path):
        h.update(p.relative_to(path).as_posix().encode("utf-8"))
        h.update(sha256_file(p).encode("ascii"))
    return h.hexdigest()


def tree_size(path: Path) -> int:
    return sum(p.stat().st_size for p in walk_files(path))


def read_text(path: Path, limit: int | None = None) -> str:
    with open(path, "rb") as f:
        data = f.read(limit) if limit else f.read()
    return data.decode("utf-8", errors="replace")


def extract_title(text: str) -> str:
    m = TITLE_OPEN_RE.search(text)
    end = TITLE_CLOSE_RE.search(text, m.end()) if m else None
    return clean_text(text[m.end():end.start()]) if end else ""


def extract_description(text: str) -> str:
    for tag in META_TAG_RE.findall(text):
        attrs = {}
        for key, v1, v2, v3 in ATTR_RE.findall(tag):
            attrs[key.lower()] = v1 or v2 or v3 or ""
        name = attrs.get("name", "").lower()
        prop = attrs.get("property", "").lower()
        if name == "description" or prop == "og:description":
            return clean_text(attrs.get("content", ""))
    return ""


def count_slides_heuristic(text: str) -> int | None:
    """class 에 slide 가 든 div·section 의 수(브라우저로 세지 못할 때 쓰는 어림값)."""
    n = 0
    for attrs in BLOCK_TAG_RE.findall(text):
        m = CLASS_RE.search(attrs)
        if m and "slide" in (m.group(1) or m.group(2) or "").split():
            n += 1
    return n or None


def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError) as e:   # 아주 깊게 겹친 JSON 은 ValueError 가 아니라 RecursionError
        log(f"  [경고] {path.name} 을 읽지 못해 무시합니다: {e}")
        return {}
    return data if isinstance(data, dict) else {}


def read_meta(path: Path, quiet: bool = False) -> dict | None:
    """덱의 정보 파일 → dict(없으면 {}). 있는데 JSON 객체로 읽히지 않으면 None — 숨기려던 덱이 새지 않게
    숨긴 것으로 다룬다(고치면 다시 실린다)."""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        why = "JSON 객체가 아님"
    except (OSError, ValueError, RecursionError) as e:
        data, why = None, str(e)
    if isinstance(data, dict):
        return data
    if not quiet:
        log(f"  [경고] {path.name} 이 JSON 으로 읽히지 않아 이 덱을 사이트에서 뺍니다(고치면 다시 실립니다): {why}")
    return None


def is_hidden(meta: dict | None) -> bool:
    return meta is None or meta.get("hidden") is True


def load_folders(base: Path) -> dict[str, dict]:
    """folders.json — {"conf": "학회 발표"} 또는 {"conf": {"label": "학회 발표", "order": 1}}."""
    out: dict[str, dict] = {}
    for key, val in load_json(base / FOLDERS_FILE).items():
        if isinstance(val, str) and val.strip():
            out[key] = {"label": clean_text(val)}
        elif isinstance(val, dict):
            item = {}
            if isinstance(val.get("label"), str) and val["label"].strip():
                item["label"] = clean_text(val["label"])
            if is_number(val.get("order")):
                item["order"] = val["order"]
            out[key] = item
    return out


def load_layout(base: Path) -> tuple[dict, bool]:
    """gallery.json → (내용, 파일이 있는가). 바로가기이거나 너무 크거나 JSON 객체가 아니면 알리고 빈 배치로 본다."""
    path = base / LAYOUT_FILE
    if path.is_symlink():
        log(f"  [경고] {DECKS_DIR}/{LAYOUT_FILE} 가 바로가기(symlink)라 무시합니다")
        return {}, False
    if not path.is_file():
        return {}, False
    if path.stat().st_size > LAYOUT_MAX_BYTES:
        log(f"  [경고] {DECKS_DIR}/{LAYOUT_FILE} 가 너무 커서({path.stat().st_size} 바이트) 무시합니다")
        return {}, True
    return load_json(path), True


def valid_key(key) -> bool:
    """분류 키 — 빈 값(분류 없음)이 아니고 앞뒤 공백·제어 문자·BOM·짝 없는 써로게이트가 없는 문자열.
    덱이 든 폴더(home)는 이 규칙과 상관없이 늘 키가 된다. assets/gallery.js 의 validKey 와 같다."""
    return (isinstance(key, str) and 0 < len(key) <= KEY_MAX and key == key.strip()
            and not LABEL_SPACE_RE.search(key) and well_formed(key) == key)


def apply_layout(raw: dict, decks: list[dict], folders: dict[str, dict]) -> dict:
    """웹 편집으로 정한 배치를 덱에 입힌다 — 덱마다 home(디렉터리 폴더)·folder(실제 분류)·folderLabel·rank.
    돌려주는 값은 decks.json 의 layout 으로, 편집기가 처음 상태로 쓴다(assets/gallery.js 의 applyLayout 과 같은 규칙).
    없는 덱·분류를 가리키는 항목은 조용히 뺀다(덱을 내린 뒤에도 배치 파일은 남으므로)."""
    homes = {d["folder"] for d in decks if d["folder"]}
    ids = {d["id"] for d in decks}

    listed: list[str] = []
    seen: set[str] = set()
    overrides: dict[str, str] = {}
    raw_cats = raw.get("categories")
    for c in (raw_cats if isinstance(raw_cats, list) else [])[:LAYOUT_MAX_ITEMS]:
        key = c.get("key") if isinstance(c, dict) else None
        if not isinstance(key, str) or not (key in homes or valid_key(key)) or key in seen:
            continue
        seen.add(key)
        listed.append(key)
        label = clean_label(c["label"]) if isinstance(c.get("label"), str) else ""
        if label:
            overrides[key] = label
    known = seen | homes

    assign: dict[str, str] = {}
    raw_assign = raw.get("assign")
    for deck_id, key in (list(raw_assign.items()) if isinstance(raw_assign, dict) else [])[:LAYOUT_MAX_ITEMS]:
        if deck_id in ids and isinstance(key, str) and (key == "" or key in known):
            assign[deck_id] = key

    order: list[str] = []
    placed: set[str] = set()
    raw_order = raw.get("order")
    for deck_id in (raw_order if isinstance(raw_order, list) else [])[:LAYOUT_MAX_ITEMS]:
        if isinstance(deck_id, str) and deck_id in ids and deck_id not in placed:
            placed.add(deck_id)
            order.append(deck_id)

    def base_label(key: str) -> str:              # folders.json 의 이름(분류 이름 규칙으로 다듬은 것), 없으면 키
        return clean_label(folders.get(key, {}).get("label", "")) or key

    def rest_key(key: str) -> tuple:              # 배치에 없는 폴더 — folders.json 의 order, 그다음 이름
        o = folders.get(key, {}).get("order")
        return (o is None, o or 0, base_label(key))

    rest = sorted(homes, key=rest_key)
    categories = [{"key": k, "label": overrides.get(k) or base_label(k), "base": base_label(k)}
                  for k in listed + [k for k in rest if k not in seen]]
    labels = {c["key"]: c["label"] for c in categories}
    rank = {deck_id: i for i, deck_id in enumerate(order)}
    for d in decks:
        d["home"] = d["folder"]
        d["folder"] = assign.get(d["id"], d["home"])
        d["folderLabel"] = labels.get(d["folder"], d["folder"]) if d["folder"] else ""
        d["rank"] = rank.get(d["id"])
    rev = raw.get("rev")
    # homes — 덱이 든 폴더 전부를 위 차례로. 편집기가 다른 배치(저장 직후 아직 배포되지 않은 것)를 입힐 때
    # 거기에 없는 폴더를 이 차례·이름으로 뒤에 붙인다.
    return {"rev": rev if isinstance(rev, str) and LAYOUT_REV_RE.match(rev) else None,
            "categories": categories, "assign": assign, "order": order,
            "homes": [{"key": k, "base": base_label(k)} for k in rest]}


def site_author(site: dict) -> dict | None:
    """site.json 의 author — 웹 편집기가 커밋 작성자로 쓴다. noreply 주소가 아니면 쓰지 않는다."""
    a = site.get("author")
    if not isinstance(a, dict):
        return None
    name = text_field(a, "name")[:100]
    email = a.get("email") if isinstance(a.get("email"), str) else ""
    if name and NOREPLY_RE.match(email):
        return {"name": name, "email": email}
    log("  [경고] site.json 의 author 는 이름과 GitHub noreply 메일(숫자+아이디@users.noreply.github.com)이어야 해서 "
        "쓰지 않습니다 — 웹 편집 커밋에 개인 메일이 남지 않게")
    return None


def discover(root: Path) -> list[dict]:
    """decks/ 를 훑어 덱 후보를 찾는다(경로·종류만, 내용은 아직 읽지 않음)."""
    base = root / DECKS_DIR
    found: list[dict] = []
    if not base.is_dir():
        return found
    if base.is_symlink():                      # os.walk 는 맨 위 폴더의 바로가기는 따라간다
        log(f"  [경고] {DECKS_DIR}/ 가 바로가기(symlink)라 덱을 찾지 않습니다")
        return found
    for cur, dirs, files in os.walk(base):
        cur_p = Path(cur)
        dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")) and not (cur_p / d).is_symlink())
        if cur_p != base and "index.html" in files and not (cur_p / "index.html").is_symlink():
            sidecars = [f for f in files if f.endswith(META_SUFFIX)]
            if sidecars or any((cur_p / d / "index.html").is_file() for d in dirs):
                log(f"  [경고] {cur_p.relative_to(root).as_posix()} 에 index.html 이 있어 폴더째 한 덱으로 봅니다 "
                    "— 그 안의 다른 덱은 목록에 나오지 않습니다")
            found.append({"kind": "dir", "abs": cur_p, "entry": cur_p / "index.html"})
            dirs[:] = []                       # 폴더 덱 안은 에셋 — 더 내려가지 않는다
            continue
        groups: dict[str, list[Path]] = {}     # 이름(확장자·대소문자 뺀) → 그 이름의 덱 파일들
        for name in sorted(files):
            p = cur_p / name
            if p.suffix.lower() in DECK_SUFFIXES and not name.startswith((".", "_")) and not p.is_symlink():
                groups.setdefault(p.stem.lower(), []).append(p)
        for key in sorted(groups):
            found.append(group_item(groups[key], root))
    return found


def group_item(paths: list[Path], root: Path) -> dict:
    """이름이 같은 덱 파일 묶음 → 덱 하나. HTML > PDF > PPTX 차례로 앞의 것이 덱, 뒤의 PDF·PPTX 는 붙는 파일."""
    by_suffix: dict[str, Path] = {}
    for p in paths:
        by_suffix.setdefault(p.suffix.lower(), p)
    primary_suffix = next(s for s in PRIMARY_ORDER if s in by_suffix)
    primary = by_suffix[primary_suffix]
    kind = "file" if primary_suffix in HTML_SUFFIXES else primary_suffix[1:]
    item = {"kind": kind, "abs": primary, "entry": primary, "pdf": None, "pptx": None}
    if kind == "file":
        item["pdf"] = by_suffix.get(".pdf")
    if kind in ("file", "pdf"):
        item["pptx"] = by_suffix.get(".pptx")
    used = {primary, item["pdf"], item["pptx"]}
    extra = [p.relative_to(root).as_posix() for p in paths if p not in used]
    if extra:
        log(f"  [경고] 이름이 같은 덱 파일이 여럿이라 {primary.relative_to(root).as_posix()} 만 덱으로 봅니다 "
            f"(나머지는 사이트에 파일로만 실림): {', '.join(extra)}")
    return item


def git_dates(root: Path, *rels: str) -> tuple[str | None, str | None]:
    """(처음 들어온 시각, 마지막으로 바뀐 시각) — 덱과 그 덱에 붙은 파일 가운데. git 기록이 없으면 (None, None)."""
    env = {**os.environ, "GIT_LITERAL_PATHSPECS": "1"}     # 파일 이름의 ':' 따위를 pathspec 기호로 읽지 않게

    def run(*args: str) -> str:
        r = subprocess.run(["git", "-c", "core.quotepath=false", "-C", str(root), *args],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        return r.stdout.strip() if r.returncode == 0 else ""
    updated = run("log", "-1", "--format=%cI", "--", *rels) or None
    added = run("log", "--diff-filter=A", "--format=%cI", "--", *rels).splitlines()
    created = added[-1] if added else updated
    return created, updated


def read_zip_part(z: zipfile.ZipFile, name: str) -> bytes | None:
    """PPTX(zip) 안의 한 조각 — 없거나 너무 크거나 압축이 깨졌으면(zlib.error·EOFError 등) None."""
    try:
        info = z.getinfo(name)
    except KeyError:
        return None
    if info.file_size > ZIP_PART_MAX:
        return None
    try:
        return z.read(info)
    except Exception:  # noqa: BLE001 — 깨진 조각 하나 때문에 나머지를 못 읽지 않게
        return None


def pptx_info(path: Path) -> dict:
    """PPTX 의 장 수(presentation.xml 의 sldIdLst)와 제목(core.xml 의 dc:title). 읽지 못하면 빈 값."""
    out: dict = {"slides": None, "title": ""}
    try:
        with zipfile.ZipFile(path) as z:
            pres = read_zip_part(z, "ppt/presentation.xml")
            if pres:
                xml = pres.decode("utf-8", "replace")
                m = SLD_LIST_RE.search(xml)
                if m:
                    end = SLD_LIST_END_RE.search(xml, m.end())
                    out["slides"] = len(SLD_ID_RE.findall(xml, m.end(), end.start() if end else len(xml))) or None
            core = read_zip_part(z, "docProps/core.xml")
            if core:
                m = CORE_TITLE_RE.search(core.decode("utf-8", "replace"))
                out["title"] = clean_text(m.group(1)) if m else ""
    except Exception as e:  # noqa: BLE001 — 깨진 PPTX(압축이 깨진 조각 등)도 덱으로는 싣는다(받기만)
        log(f"  [경고] {path.name} 을 PPTX 로 읽지 못했습니다: {e}")
    return out


def attachment(root: Path, p: Path | None) -> tuple[str | None, int | None, str | None]:
    """덱에 붙은 PDF·PPTX → (경로, 크기, 판 표시)."""
    if not p or not p.is_file():
        return None, None, None
    return p.relative_to(root).as_posix(), p.stat().st_size, sha256_file(p)[:REV_LEN]


def describe(root: Path, item: dict, folders: dict[str, dict], use_git: bool) -> dict:
    """덱 하나의 목록 항목을 만든다. hidden 이면 _hidden 표시만 붙인다."""
    base = root / DECKS_DIR
    abs_p: Path = item["abs"]
    entry: Path = item["entry"]
    kind = item["kind"]
    pdf = item.get("pdf")
    if kind == "dir":
        name = abs_p.name
        meta_p = abs_p / "meta.json"
        pptxs = sorted(p for p in abs_p.glob("*.pptx") if not p.is_symlink())
        pptx = pptxs[0] if pptxs else None
        digest = sha256_tree(abs_p)
        size = tree_size(abs_p)
    else:
        name = abs_p.stem
        meta_p = abs_p.with_name(abs_p.stem + META_SUFFIX)
        pptx = item.get("pptx")
        digest = sha256_file(abs_p)
        size = abs_p.stat().st_size
    meta = read_meta(meta_p)
    folder = "/".join(abs_p.parent.relative_to(base).parts)
    rel_entry = entry.relative_to(root).as_posix()
    rel_item = abs_p.relative_to(root).as_posix()
    if is_hidden(meta):
        files = [rel_item] + [p.relative_to(root).as_posix() for p in (meta_p, pptx, pdf) if p and p.is_file()]
        return {"_hidden": True, "kind": kind, "files": files, "dir": rel_item}
    if kind in ("file", "dir"):
        head = read_text(entry, HEAD_BYTES)
        found_title, found_desc = extract_title(head), extract_description(head)
        slides = count_slides_heuristic(read_text(entry))
    elif kind == "pptx":
        info = pptx_info(abs_p)
        found_title, found_desc, slides = info["title"], "", info["slides"]
    else:                                  # PDF — 장 수·제목은 뷰어로 열어 본 뒤에 채운다(render_previews)
        found_title, found_desc, slides = "", "", None
    attached = [p.relative_to(root).as_posix() for p in (pptx, pdf) if p and kind != "dir"]
    created, updated = git_dates(root, rel_item, *attached) if use_git else (None, None)
    date = meta.get("date")
    if date is not None and not (isinstance(date, str) and DATE_RE.match(date)):
        log(f"  [경고] {rel_item}: date 는 YYYY-MM-DD 꼴이어야 해서 무시합니다 ({date!r})")
        date = None
    pptx_rel, pptx_size, pptx_rev = attachment(root, pptx)
    pdf_rel, pdf_size, pdf_rev = attachment(root, pdf)
    return {
        "id": (Path(folder) / name).as_posix() if folder else name,
        "name": name,
        "kind": kind,
        "path": rel_entry,
        "dir": Path(rel_entry).parent.as_posix(),
        "folder": folder,
        "folderLabel": folders.get(folder, {}).get("label", folder),
        "title": text_field(meta, "title") or found_title or name,
        "description": text_field(meta, "description") or found_desc,
        "date": date,
        "venue": text_field(meta, "venue") or None,
        "authors": text_field(meta, "authors") or None,
        "tags": tags_field(meta),
        "order": meta["order"] if is_number(meta.get("order")) else None,
        "slides": slides,
        "size": size,
        "rev": digest[:REV_LEN],
        "pptx": pptx_rel,
        "pptxSize": pptx_size,
        "pptxRev": pptx_rev,
        "pdf": pdf_rel,
        "pdfSize": pdf_size,
        "pdfRev": pdf_rev,
        "hash": digest,
        "thumb": None,
        "created": created,
        "updated": updated,
    }


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    """미리보기를 찍는 동안만 띄우는 서버. 저장소 뿌리에서 decks/·viewer/·vendor/ 만 내준다 —
    덱의 스크립트가 tools/·.git/ 같은 다른 파일을 읽어 그림에 찍지 못하게. 숨긴 이름·바로가기(symlink)도 내주지 않는다."""
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".wasm": "application/wasm", ".pdf": "application/pdf", ".svg": "image/svg+xml",
    }

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        parts = path.split("/")[1:]
        asked = os.path.normcase(os.path.normpath(self.translate_path(self.path)))
        real = os.path.normcase(os.path.realpath(asked))
        root = os.path.normcase(os.path.realpath(self.directory))
        if (not path.startswith(PREVIEW_PREFIXES) or any(p.startswith((".", "_")) for p in parts if p)
                or not real.startswith(root + os.sep) or real != asked):     # 마지막: 바로가기를 거친 경로
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)                   # 폴더 목록은 내주지 않는다
        return None

    def log_message(self, *args) -> None:
        pass


def serve_preview(root: Path):
    """저장소를 127.0.0.1 에 잠깐 띄운다 — file:// 로 열면 덱의 스크립트가 이 PC·러너의 다른 파일을 읽어
    그림에 찍을 수 있고, 덱이 같은 폴더의 자료를 fetch 하는 것도 실제 사이트와 같게 동작한다."""
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
                                            functools.partial(PreviewHandler, directory=str(root)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def clean_pdf_title(title) -> str:
    return clean_text(PDF_TITLE_JUNK.sub("", title)) if isinstance(title, str) else ""


def shoot_html(page, base_url: str, d: dict) -> tuple[dict, bytes]:
    page.goto(base_url + quote(d["path"], safe="/"), wait_until="load", timeout=60000)
    page.wait_for_timeout(1500)
    page.evaluate(FONTS_JS)
    info = page.evaluate(PROBE_JS)
    for sel in THUMB_SELECTORS:
        handle = page.query_selector(sel)
        box = handle.bounding_box() if handle else None
        if box and box["width"] >= 200 and box["height"] >= 100:
            return info, handle.screenshot()
    return info, page.screenshot()


def shoot_pdf(page, base_url: str, d: dict) -> tuple[dict, bytes]:
    """사이트의 PDF 뷰어로 첫 장을 그려 찍는다 — 갤러리에서 보는 것과 같은 그림."""
    page.goto(f"{base_url}{PDF_VIEWER}#file={quote(d['path'], safe='')}&probe=1", wait_until="load", timeout=60000)
    page.wait_for_function(PDF_DONE_JS, timeout=90000)
    if page.evaluate("() => document.documentElement.dataset.state") != "ready":
        raise RuntimeError(page.evaluate("() => document.getElementById('msg').innerText") or "PDF 를 열지 못함")
    probe = page.evaluate("() => window.__probe || {}")
    canvas = page.query_selector("#sheet canvas")
    if canvas is None:
        raise RuntimeError("첫 장을 그리지 못함")
    return {"slides": probe.get("slides"), "title": clean_pdf_title(probe.get("title"))}, canvas.screenshot()


def pptx_thumbnail(path: Path) -> bytes | None:
    """PowerPoint 가 저장할 때 넣어 두는 첫 장 그림(docProps/thumbnail.*). 없으면 None."""
    try:
        with zipfile.ZipFile(path) as z:
            names = {n.lower(): n for n in z.namelist()}
            for cand in ("docprops/thumbnail.jpeg", "docprops/thumbnail.jpg", "docprops/thumbnail.png"):
                if cand in names:
                    return read_zip_part(z, names[cand])
    except Exception:  # noqa: BLE001 — 압축이 깨진 조각(zlib.error·EOFError 등)이면 그림 없이
        return None
    return None


def blank_image(data: bytes) -> bool:
    """한 가지 색뿐인 그림인가 — python-pptx 로 만든 PPTX 는 기본 틀의 빈 미리 보기(흰 256×192)를 그대로 담는다."""
    from PIL import Image
    with Image.open(io.BytesIO(data)) as img:
        lo, hi = img.convert("L").getextrema()
    return hi - lo < 8


def save_thumb(data: bytes, img_p: Path) -> None:
    from PIL import Image
    with Image.open(io.BytesIO(data)) as img:
        img = img.convert("RGB")
        img.thumbnail(THUMB_BOX)
        img.save(img_p, "WEBP", quality=80, method=6)


def render_previews(root: Path, decks: list[dict], cache: Path, want_thumbs: bool) -> None:
    """장 수를 다시 세고 첫 장 그림을 만든다(HTML·PDF 는 Playwright, PPTX 는 파일 안의 그림).
    결과는 내용 지문으로 캐시한다."""
    cache.mkdir(parents=True, exist_ok=True)
    todo, todo_pptx = [], []
    for d in decks:
        key = d["hash"][:16]
        info_p, img_p = cache / f"{key}.json", cache / f"{key}.webp"
        info = load_json(info_p) if info_p.is_file() else None
        if info is not None and (img_p.is_file() or not want_thumbs or info.get("noimage") is True):
            apply_probe(d, info, img_p)
        elif d["kind"] == "pptx":
            todo_pptx.append(d)
        else:
            todo.append(d)
    if not want_thumbs:                 # 그림을 찍지 않으면 브라우저도 띄우지 않는다(장 수는 HTML 에서 센 값)
        return
    try:
        from PIL import Image  # noqa: F401 — 있는지만 본다
    except ImportError:
        log("  [안내] pillow 가 없어 미리보기 그림을 건너뜁니다(pip install playwright pillow)")
        return
    for d in todo_pptx:
        key = d["hash"][:16]
        info_p, img_p = cache / f"{key}.json", cache / f"{key}.webp"
        info = {"slides": d["slides"], "title": "", "noimage": True}
        try:
            data = pptx_thumbnail(root / d["path"])
            if data and blank_image(data):
                data = None                     # 빈 그림보다 '그림 없음' 표시가 낫다
            info["noimage"] = data is None
            if data:
                save_thumb(data, img_p)
        except Exception as e:  # noqa: BLE001 — 그림이 깨져도 덱은 싣는다
            log(f"  [경고] {d['id']} 의 PPTX 첫 장 그림을 읽지 못했습니다: {e}")
            info["noimage"] = True
        info_p.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
        apply_probe(d, info, img_p)
        log(f"  그림 {d['id']}: {d['slides'] or '?'}장" + (" (PPTX 에 첫 장 그림 없음)" if info["noimage"] else ""))
    if not todo:
        return
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("  [안내] playwright 가 없어 HTML·PDF 미리보기 그림을 건너뜁니다(pip install playwright pillow)")
        return
    httpd, base_url = serve_preview(root)
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            if browser is None:
                return
            for d in todo:
                key = d["hash"][:16]
                info_p, img_p = cache / f"{key}.json", cache / f"{key}.webp"
                # 덱마다 새 문맥 — 한 덱이 남긴 저장소·서비스 워커가 다음 덱의 그림·제목을 바꾸지 못하게
                ctx = browser.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=1,
                                          service_workers="block")
                try:
                    info, shot = (shoot_pdf if d["kind"] == "pdf" else shoot_html)(ctx.new_page(), base_url, d)
                    save_thumb(shot, img_p)
                    info_p.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
                    apply_probe(d, info, img_p)
                    log(f"  그림 {d['id']}: {info.get('slides') or '?'}장")
                except Exception as e:  # noqa: BLE001 — 한 덱이 깨져도 나머지는 계속
                    log(f"  [경고] {d['id']} 미리보기 실패: {e}")
                finally:
                    ctx.close()
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()


def launch_browser(p):
    """덱의 스크립트·PDF 는 믿을 수 없는 입력이라 크로미엄 샌드박스를 켜고 띄운다. 켤 수 없는 곳(사용자 네임스페이스를
    막아 둔 리눅스 러너 등)에서만 샌드박스 없이 띄우고 알린다. 브라우저가 없으면 None."""
    try:
        return p.chromium.launch(chromium_sandbox=True)
    except Exception as first:  # noqa: BLE001
        try:
            browser = p.chromium.launch()
        except Exception as e:  # noqa: BLE001 — 브라우저가 없어도 사이트는 만든다
            log(f"  [안내] 브라우저를 띄우지 못해 미리보기 그림을 건너뜁니다: {e}")
            return None
        log("  [안내] 크로미엄 샌드박스를 켜지 못해 샌드박스 없이 미리보기를 찍습니다: "
            + (str(first).strip().splitlines() or ["?"])[0][:200])
        return browser


def prune_cache(cache: Path, decks: list[dict]) -> None:
    """지금 덱에 쓰이지 않는 옛 판의 미리보기 캐시를 지운다(고칠 때마다 쌓이지 않게)."""
    if not cache.is_dir():
        return
    keep = {d["hash"][:16] for d in decks}
    for p in cache.iterdir():
        if CACHE_NAME_RE.match(p.name) and p.name[:16] not in keep:
            p.unlink(missing_ok=True)


def apply_probe(d: dict, info: dict, img_p: Path) -> None:
    if isinstance(info.get("slides"), int) and not isinstance(info.get("slides"), bool) and info["slides"] > 0:
        d["slides"] = info["slides"]
    if d["title"] == d["name"] and isinstance(info.get("title"), str) and info["title"].strip():
        d["title"] = clean_text(info["title"])
    if img_p.is_file():
        d["thumb"] = f"thumbs/{img_p.name}"


def repo_info(root: Path, site: dict) -> tuple[str | None, str]:
    repo = site.get("repo") if isinstance(site.get("repo"), str) else None
    repo = repo or os.environ.get("GITHUB_REPOSITORY")
    branch = site.get("branch") if isinstance(site.get("branch"), str) else None
    branch = branch or os.environ.get("GITHUB_REF_NAME") or "main"
    if not repo:
        r = subprocess.run(["git", "-C", str(root), "remote", "get-url", "origin"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", r.stdout.strip())
        repo = m.group(1) if m else None
    return (repo if repo and REPO_RE.match(repo) else None), branch


def build_manifest(root: Path, thumbs: bool, cache: Path | None, use_git: bool) -> dict:
    base = root / DECKS_DIR
    folders = load_folders(base)
    decks, hidden_files, hidden_dirs = [], [], []
    for it in discover(root):
        try:
            d = describe(root, it, folders, use_git)
        except Exception as e:  # noqa: BLE001 — 한 덱이 깨져도 나머지로 사이트를 만든다
            log(f"  [경고] {it['abs'].relative_to(root).as_posix()} 를 읽지 못해 건너뜁니다: {e}")
            continue
        if d.get("_hidden"):
            if d["kind"] == "dir":
                hidden_dirs.append(d["dir"])
            else:
                hidden_files.extend(d["files"])
            continue
        decks.append(d)
    if cache is not None:
        render_previews(root, decks, cache, thumbs)
        prune_cache(cache, decks)
    decks.sort(key=lambda d: (d["updated"] or "", d["title"]), reverse=True)
    raw_layout, has_layout = load_layout(base)
    layout = apply_layout(raw_layout, decks, folders)
    layout["exists"] = has_layout
    site = load_json(root / "site.json")
    repo, branch = repo_info(root, site)
    counts: dict[str, int] = {}
    for d in decks:
        if d["folder"]:
            counts[d["folder"]] = counts.get(d["folder"], 0) + 1
    # 칩(분류) 차례는 배치의 분류 목록을 따른다 — 덱이 없는 분류는 칩으로 내지 않는다.
    folder_list = [{"key": c["key"], "label": c["label"], "order": folders.get(c["key"], {}).get("order"),
                    "count": counts[c["key"]]} for c in layout["categories"] if counts.get(c["key"])]
    return {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "site": {"title": text_field(site, "title") or "HTML 발표자료",
                 "subtitle": text_field(site, "subtitle"),
                 "repo": repo, "branch": branch, "author": site_author(site)},
        "folders": folder_list,
        "layout": layout,
        "count": len(decks),
        "decks": decks,
        "_hidden_files": hidden_files,
        "_hidden_dirs": hidden_dirs,
    }


def add_noindex(data: bytes) -> bytes:
    """사이트에 실을 덱 사본에만 검색 제외 표시를 넣는다(저장소의 원본은 그대로).
    덱에 이미 robots 표시가 있어도 넣는다 — 검색 엔진은 여럿 가운데 가장 엄한 것을 따른다.
    <head> 가 없으면 <html> 뒤, 그것도 없으면 <!doctype> 뒤에 넣어 문서 모드가 바뀌지 않게 한다."""
    text = data.decode("utf-8", errors="surrogateescape")
    head = text[:HEAD_BYTES]
    pos = 1 if text.startswith(BOM) else 0
    for rx in (HEAD_OPEN_RE, HTML_OPEN_RE, DOCTYPE_RE):
        m = rx.search(head)
        if m:
            pos = m.end()
            break
    text = text[:pos] + ROBOTS_META + text[pos:]
    return text.encode("utf-8", errors="surrogateescape")


def safe_out_dir(root: Path, out: Path) -> Path:
    out = out.resolve()
    root = root.resolve()
    if out == root or root in out.parents and out.parts[len(root.parts)] in (DECKS_DIR, "tools", "assets", ".git"):
        raise SystemExit(f"출력 폴더로 쓸 수 없는 곳입니다: {out}")
    if out in root.parents:
        raise SystemExit(f"저장소의 상위 폴더는 출력 폴더로 쓸 수 없습니다: {out}")
    if out.exists() and any(out.iterdir()) and not (out / SITE_MARKER).exists():
        raise SystemExit(f"비어 있지 않은 폴더라 덮어쓰지 않습니다(이전 빌드 표시 없음): {out}")
    return out


def build_site(root: Path, out: Path, manifest: dict, cache: Path | None) -> None:
    out = safe_out_dir(root, out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / SITE_MARKER).write_text("html-slides build output\n", encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    for name in SITE_FILES:
        if (root / name).is_file() and not (root / name).is_symlink():
            shutil.copy2(root / name, out / name)
    for name in SITE_DIRS:
        if (root / name).is_symlink():         # 맨 위 폴더가 바로가기면 그 너머(러너의 다른 파일 등)를 싣지 않는다
            log(f"  [경고] {name}/ 가 바로가기(symlink)라 사이트에 싣지 않습니다")
        elif (root / name).is_dir():
            for src in walk_files(root / name):
                dst = out / src.relative_to(root)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
    hidden_files = set(manifest.get("_hidden_files", []))
    hidden_dirs = tuple(d + "/" for d in manifest.get("_hidden_dirs", []))
    base = root / DECKS_DIR
    for cur, dirs, files in ([] if base.is_symlink() else os.walk(base)):
        cur_p = Path(cur)
        dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")) and not (cur_p / d).is_symlink())
        for name in sorted(files):
            src = cur_p / name
            rel = src.relative_to(root).as_posix()
            if (name.startswith((".", "_")) or src.is_symlink() or name.endswith(META_SUFFIX)
                    or rel in (f"{DECKS_DIR}/{FOLDERS_FILE}", f"{DECKS_DIR}/{LAYOUT_FILE}")
                    or rel in hidden_files or rel.startswith(hidden_dirs)
                    or (name == "meta.json" and (cur_p / "index.html").is_file())):
                continue
            if name.lower().endswith(DECK_SUFFIXES):
                # 폴더 덱 안에 묻혀 목록에는 없는 덱도 제 정보 파일의 숨김(또는 깨진 정보 파일)을 지킨다
                side = cur_p / (Path(name).stem + META_SUFFIX)
                if side.is_file() and is_hidden(read_meta(side, quiet=True)):
                    continue
            dst = out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.suffix.lower() in HTML_SUFFIXES:
                dst.write_bytes(add_noindex(src.read_bytes()))
            else:
                shutil.copy2(src, dst)
    if cache is not None:
        thumbs = out / "thumbs"
        thumbs.mkdir(exist_ok=True)
        for d in manifest["decks"]:
            if d.get("thumb"):
                shutil.copy2(cache / Path(d["thumb"]).name, thumbs / Path(d["thumb"]).name)
    public = {k: v for k, v in manifest.items() if not k.startswith("_")}
    public["decks"] = [{k: v for k, v in d.items() if k != "hash"} for d in manifest["decks"]]
    (out / "decks.json").write_text(json.dumps(public, ensure_ascii=False, indent=1, allow_nan=False),
                                    encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    os.environ["NoDefaultCurrentDirectoryInExePath"] = "1"    # Windows: 현재 폴더의 git 을 먼저 쓰지 않게
    ap = argparse.ArgumentParser(description="html-slides 사이트 빌더")
    ap.add_argument("--root", type=Path, default=ROOT, help="저장소 폴더(기본: 이 스크립트의 상위)")
    ap.add_argument("--out", type=Path, help="사이트를 꾸릴 폴더(없으면 목록만 출력)")
    ap.add_argument("--thumbs", action="store_true", help="Playwright 로 첫 장 그림을 찍는다")
    ap.add_argument("--cache", type=Path, help="미리보기 캐시 폴더(장 수·그림)")
    ap.add_argument("--no-git", action="store_true", help="git 기록에서 날짜를 읽지 않는다")
    args = ap.parse_args(argv)
    root = args.root.resolve()
    cache = args.cache.resolve() if args.cache else (root / ".thumbcache" if args.thumbs else None)
    manifest = build_manifest(root, args.thumbs, cache, not args.no_git)
    log(f"덱 {manifest['count']}개 · 폴더 {len(manifest['folders'])}개")
    if args.out:
        build_site(root, args.out, manifest, cache)
        log(f"사이트: {args.out.resolve()}")
    else:
        print(json.dumps({k: v for k, v in manifest.items() if not k.startswith("_")},
                         ensure_ascii=False, indent=1, allow_nan=False))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
