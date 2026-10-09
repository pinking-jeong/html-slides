"""시험용 PDF·PPTX 를 외부 프로그램 없이 만든다."""
from __future__ import annotations

import io
import zipfile


def _pdf_text(s: str) -> bytes:
    """PDF 글 — ASCII 는 (…) 로, 그 밖은 UTF-16BE(앞에 FEFF) 16진으로."""
    if all(32 <= ord(c) < 127 and c not in "()\\" for c in s):
        return b"(" + s.encode("ascii") + b")"
    return b"<FEFF" + s.encode("utf-16-be").hex().upper().encode("ascii") + b">"


def make_pdf(pages: int = 3, size: tuple[int, int] = (960, 540), info: dict[str, str] | None = None,
             extra: list[bytes] | None = None, body: str = "Slide") -> bytes:
    """장마다 큰 글자와 색 막대가 있는 PDF. info 는 /Title·/Author 같은 문서 정보, extra 는 덧붙일 객체 본문."""
    w, h = size
    objs: list[bytes] = [b"", b""]                        # 1: Catalog, 2: Pages — 아래에서 채운다
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")   # 3
    kids = []
    for i in range(pages):
        stream = (f"0 0.443 0.369 rg 0 0 {w} 24 re f\n"
                  f"BT /F1 64 Tf 72 {h - 160} Td ({body} {i + 1}) Tj ET\n"
                  f"BT /F1 24 Tf 72 {h - 220} Td (html-slides test page {i + 1} of {pages}) Tj ET\n").encode("ascii")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] "
                    f"/Resources << /Font << /F1 3 0 R >> >> /Contents {len(objs) + 2} 0 R >>".encode("ascii"))
        kids.append(len(objs))
        objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream")
    for body_obj in extra or []:
        objs.append(body_obj)
    info_ref = b""
    if info:
        objs.append(b"<< " + b" ".join(b"/" + k.encode("ascii") + b" " + _pdf_text(v) for k, v in info.items()) + b" >>")
        info_ref = f" /Info {len(objs)} 0 R".encode("ascii")
    objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[1] = (f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {pages} >>").encode("ascii")

    out = io.BytesIO()
    out.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body_obj in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n".encode("ascii") + body_obj + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode("ascii"))
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R".encode("ascii") + info_ref
              + f" >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    return out.getvalue()


NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def make_pptx(slides: int = 3, title: str = "", creator: str = "", notes: int = 0, text: str = "",
              thumbnail: bytes | None = None, comments: int = 0, external_links: int = 0,
              padding: int = 0, embeds: int = 0, svg: str = "") -> bytes:
    """slides 가 읽는 부분(장 목록·문서 정보·노트·썸네일·링크)만 갖춘 PPTX 꼴 zip.
    padding 바이트만큼 압축하지 않은 그림 자리(ppt/media/pad.bin)를 넣어 파일을 키운다.
    embeds 는 붙은 파일(ppt/embeddings/) 수, svg 는 ppt/media/image1.svg 의 내용."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/'
                   'package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
        ids = "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 2}"/>' for i in range(slides))
        z.writestr("ppt/presentation.xml",
                   f'<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="{NS_P}" xmlns:r="{NS_R}">'
                   f'<p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>')
        for i in range(slides):
            words = text or f"Slide {i + 1}"
            z.writestr(f"ppt/slides/slide{i + 1}.xml",
                       f'<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="{NS_P}" xmlns:a="{NS_A}">'
                       f'<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{words}</a:t></a:r></a:p>'
                       f'</p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
        rels = "".join(f'<Relationship Id="rIdX{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                       f'relationships/hyperlink" Target="https://example.com/{i}" TargetMode="External"/>'
                       for i in range(external_links))
        z.writestr("ppt/slides/_rels/slide1.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/'
                   f'package/2006/relationships">{rels}</Relationships>')
        z.writestr("docProps/core.xml",
                   '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats'
                   '.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   f'<dc:title>{title}</dc:title><dc:creator>{creator}</dc:creator></cp:coreProperties>')
        for i in range(notes):
            z.writestr(f"ppt/notesSlides/notesSlide{i + 1}.xml", f'<p:notes xmlns:p="{NS_P}"/>')
        for i in range(comments):
            z.writestr(f"ppt/comments/comment{i + 1}.xml", f'<p:cmLst xmlns:p="{NS_P}"/>')
        if thumbnail is not None:
            z.writestr("docProps/thumbnail.jpeg", thumbnail)
        if padding:
            z.writestr("ppt/media/pad.bin", b"\0" * padding, compress_type=zipfile.ZIP_STORED)
        for i in range(embeds):
            z.writestr(f"ppt/embeddings/Microsoft_Excel_Worksheet{i + 1}.xlsx", b"PK embedded workbook")
        if svg:
            z.writestr("ppt/media/image1.svg", svg)
    return buf.getvalue()


def break_member(data: bytes, name: str) -> bytes:
    """zip 안의 한 조각(압축된 것)의 첫 바이트를 '쓰지 않는 블록 형식'으로 바꿔, 읽으면 zlib.error 가 나게 한다."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        info = z.getinfo(name)
    assert info.compress_type == zipfile.ZIP_DEFLATED, name
    head = info.header_offset
    name_len = int.from_bytes(data[head + 26:head + 28], "little")
    extra_len = int.from_bytes(data[head + 28:head + 30], "little")
    start = head + 30 + name_len + extra_len                 # 로컬 헤더 뒤가 압축된 내용
    out = bytearray(data)
    out[start] = 0x07                                        # BFINAL=1, BTYPE=11(예약) → invalid block type
    return bytes(out)


def jpeg(size: tuple[int, int] = (256, 144), color: tuple[int, int, int] = (0, 113, 94)) -> bytes:
    """작은 JPEG(Pillow 가 있을 때)."""
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "JPEG", quality=85)
    return out.getvalue()
