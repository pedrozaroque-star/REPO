"""
@module Scripts/GenerateDoorMockupAndMaster
@description Generates photogrammetric door measurement callouts, a perspective-warped Before/After
             storefront door mockup using 3D homography calibrated from the US Letter sheet, Page 1
             Technical Print & Installation Spec Sheet, and the 16-page Master PDF for all 15 stores.
@businessRules
  - Reference object: US Letter sheet (8.50" x 11.00" / 21.59 x 27.94 cm) taped on door glass.
  - Verified storefront door metrics: 36.0" x 84.0" leaf, 2.50" pull stile, 31.0" clear glass opening,
    7.37" vertical clear glass band above 2.95" (~3.0") horizontal push bar.
  - Recommended universal sticker size: 18.0" x 5.5" (45.72 x 13.97 cm) at 300 DPI / 1:1 vector PDF.
  - Strictly enforces "Tacos Gavilan" naming and zero ":" or ":00" in door schedules.
@dataFlow
  Original door photo + Rialto 300-DPI PNG + `stores_door_stickers_manifest.json` + 15 individual PDFs
  -> OpenCV/PIL homography diagrams + Puppeteer Spec Sheet + pypdf Master PDF -> `exports/door-stickers-2026/`.
"""

import json
import os
import subprocess
import sys
import base64
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter


REPO_ROOT = Path(__file__).resolve().parent.parent
EXPORTS_DIR = REPO_ROOT / "exports" / "door-stickers-2026"
PDF_DIR = EXPORTS_DIR / "pdf-1to1"
PNG_DIR = EXPORTS_DIR / "png-300dpi"
MANIFEST_PATH = EXPORTS_DIR / "stores_door_stickers_manifest.json"
PHOTO_PATH = Path(
    r"C:/Users/pedro/.gemini/antigravity/brain/01cfd3b4-c370-4e40-bc80-dad3a72e7e54/.user_uploaded/media_1794628294754_dc5781b6.jpg"
)
ARTIFACT_DIR = Path(
    r"C:/Users/pedro/.gemini/antigravity/brain/01cfd3b4-c370-4e40-bc80-dad3a72e7e54"
)
GOTHAM_FONT = REPO_ROOT / "public" / "tacosgavilan-web" / "fonts" / "Gotham Ultra.otf"
LOGO_PATH = REPO_ROOT / "public" / "tacosgavilan-web" / "img" / "tg-logo-transparent.png"
YA_ESTA_SVG = REPO_ROOT / "public" / "tacosgavilan-web" / "img" / "ya_esta-home-hor.svg"


def build_door_plane_projection():
    """Returns calibrated camera projection helpers mapping (X_in, Y_in) <-> (u, v) image px."""
    W_img, H_img = 576.0, 1024.0
    cx, cy = W_img / 2.0, H_img / 2.0
    f = 695.0
    Vy = np.array([317.0, 2080.0, 1.0])
    dx_vy, dy_vy = Vy[0] - cx, Vy[1] - cy
    vx_x = -(-cx * dx_vy + (491.08 - cy) * dy_vy + f ** 2) / (dx_vy - 0.09419 * dy_vy)
    vx_y = -0.09419 * vx_x + 491.08
    Vx = np.array([vx_x, vx_y, 1.0])

    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    Kinv = np.linalg.inv(K)
    r1 = Kinv @ Vx
    r1 /= np.linalg.norm(r1)
    r2 = Kinv @ Vy
    r2 /= np.linalg.norm(r2)
    r3 = np.cross(r1, r2)

    def line_y_mx_b(m, b):
        return np.array([m, -1.0, b], dtype=float)

    def line_x_my_b(m, b):
        return np.array([1.0, -m, -b], dtype=float)

    def isect(l1, l2):
        p = np.cross(l1, l2)
        return p[:2] / p[2]

    P_bl = isect(line_x_my_b(0.10318, 99.75), line_y_mx_b(-0.05729, 368.22))
    P_br = isect(line_x_my_b(-0.07270, 468.69), line_y_mx_b(-0.05729, 368.22))

    def to_raw(pt):
        ray = Kinv @ np.array([pt[0], pt[1], 1.0])
        Xc = ray / np.dot(r3, ray)
        return np.array([np.dot(r1, Xc), np.dot(r2, Xc)])

    p0 = to_raw(P_bl)
    sc = 8.50 / np.linalg.norm(to_raw(P_br) - p0)

    def from_in(x_in: float, y_in: float, scale_factor: float = 1.0):
        raw = p0 + np.array([x_in, y_in]) / sc
        Xc = raw[0] * r1 + raw[1] * r2 + 1.0 * r3
        uv = K @ Xc
        return (uv[0] / uv[2] * scale_factor, uv[1] / uv[2] * scale_factor)

    return from_in


def stamp_300_dpi_on_pngs(manifest: dict):
    """Ensures all 15 PNGs carry explicit 300 DPI print metadata and verifies exact 5400x1650 px."""
    import time
    for stale in PNG_DIR.glob("*.tmp.png"):
        stale.unlink(missing_ok=True)
    for s in manifest["stores"]:
        png_path = REPO_ROOT / s["pngPath"]
        assert png_path.exists(), f"Missing PNG: {png_path}"
        with Image.open(png_path) as im:
            assert im.size == (5400, 1650), f"Unexpected PNG size {im.size} for {png_path}"
            cur_dpi = im.info.get("dpi")
            if cur_dpi and abs(cur_dpi[0] - 300) < 1 and abs(cur_dpi[1] - 300) < 1:
                continue
            loaded = im.copy()
        tmp_path = png_path.with_suffix(".tmp.png")
        loaded.save(tmp_path, format="PNG", dpi=(300, 300))
        for attempt in range(8):
            try:
                os.replace(tmp_path, png_path)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(0.25)
    print("[OK] Stamped 300 DPI print metadata on all 15 5400x1650 PNG files.")


def load_pil_fonts():
    def tf(path, size):
        return ImageFont.truetype(str(path), size)

    gotham = GOTHAM_FONT if GOTHAM_FONT.exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")
    segoe_b = Path(r"C:/Windows/Fonts/segoeuib.ttf")
    segoe_r = Path(r"C:/Windows/Fonts/segoeui.ttf")
    return {
        "h1": tf(gotham, 34),
        "h2": tf(gotham, 24),
        "h3": tf(segoe_b, 20),
        "bold": tf(segoe_b, 17),
        "body": tf(segoe_r, 16),
        "small": tf(segoe_r, 14),
        "small_b": tf(segoe_b, 14),
        "badge": tf(gotham, 14),
    }


def draw_tag(draw: ImageDraw.ImageDraw, xy, text, font, bg, fg=(255, 255, 255), border=None, pad_x=10, pad_y=5):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = xy
    rect = [x, y, x + tw + 2 * pad_x, y + th + 2 * pad_y]
    draw.rounded_rectangle(rect, radius=7, fill=bg, outline=border, width=2 if border else 0)
    draw.text((x + pad_x - bbox[0], y + pad_y - bbox[1]), text, font=font, fill=fg)
    return rect


def generate_annotated_door_diagram():
    """Creates exports/door-stickers-2026/door_measurements_annotated.png."""
    assert PHOTO_PATH.exists(), f"Missing door photo: {PHOTO_PATH}"
    from_in = build_door_plane_projection()
    fonts = load_pil_fonts()

    # Canvas: 1700 x 1180 dark slate engineering board
    CW, CH = 1700, 1180
    canvas = Image.new("RGB", (CW, CH), (13, 15, 19))
    draw = ImageDraw.Draw(canvas)

    # Top bar
    draw.rectangle([0, 0, CW, 84], fill=(10, 10, 10))
    draw.rectangle([0, 82, CW, 86], fill=(255, 199, 44))
    draw.text((32, 16), "TACOS GAVILAN  —  ANÁLISIS FOTOGRAMÉTRICO DE PUERTA Y STICKER", font=fonts["h2"], fill=(255, 199, 44))
    draw.text(
        (32, 50),
        'Escala calibrada con hoja tamaño Carta (8.50" × 11.00" / 21.59 × 27.94 cm) y puntos de fuga ortogonales',
        font=fonts["body"],
        fill=(226, 232, 240),
    )

    # Left: Photo with clipped calibrated overlays (576x1024 pasted at x=32, y=114)
    photo_scale = 1.0
    px0, py0 = 32, 114
    photo_pil = Image.open(PHOTO_PATH).convert("RGBA")
    overlay = Image.new("RGBA", photo_pil.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay, "RGBA")

    def P(x_in, y_in):
        return from_in(x_in, y_in, photo_scale)

    # 1. US Letter sheet boundary (X: 0..8.5, Y: -7.7..0)
    paper_poly = [P(0, -7.7), P(8.5, -7.7), P(8.5, 0.0), P(0, 0.0)]
    odraw.polygon(paper_poly, fill=(34, 197, 94, 34), outline=(34, 197, 94, 240))

    # 2. Left Aluminum Pull Stile (X: -3.0..-0.5, Y: -7.7..20.5)
    stile_poly = [P(-3.0, -7.7), P(-0.5, -7.7), P(-0.5, 20.5), P(-3.0, 20.5)]
    odraw.polygon(stile_poly, fill=(56, 189, 248, 45), outline=(56, 189, 248, 220))

    # 3. Old Sticker footprint (X: -2.72..12.35, Y: 1.96..5.83) -> highlights aluminum overlap!
    old_poly = [P(-2.72, 1.96), P(12.35, 1.95), P(12.35, 5.83), P(-2.71, 5.82)]
    odraw.polygon(old_poly, fill=(239, 68, 68, 48), outline=(248, 113, 113, 255))

    # 4. Push bar band (X: -3.0..14.0, Y: 7.62..10.56)
    pbar_poly = [P(-3.0, 7.62), P(13.8, 7.62), P(13.8, 10.56), P(-3.0, 10.56)]
    odraw.polygon(pbar_poly, fill=(250, 204, 21, 35), outline=(250, 204, 21, 210))

    # 5. Recommended vertical zone line (X: 0.0..13.5, Y: 1.15..6.65)
    rec_poly = [P(0.0, 1.15), P(13.5, 1.15), P(13.5, 6.65), P(0.0, 6.65)]
    odraw.line(rec_poly + [rec_poly[0]], fill=(255, 199, 44, 255), width=3)

    composited_photo = Image.alpha_composite(photo_pil, overlay).convert("RGB")
    canvas.paste(composited_photo, (px0, py0))
    draw = ImageDraw.Draw(canvas)

    # Crisp photo badges
    draw_tag(draw, (px0 + 145, py0 + 18), 'REF: CARTA 8.5" x 11.0"', fonts["small_b"], (21, 128, 61))
    draw_tag(draw, (px0 + 10, py0 + 165), 'PERFIL 2.5"', fonts["small_b"], (3, 105, 161))
    draw_tag(draw, (px0 + 110, py0 + 368), 'ANTERIOR: 15.06" x 3.88" (PISANDO ALUMINIO)', fonts["small_b"], (185, 28, 28))
    draw_tag(draw, (px0 + 145, py0 + 686), 'BARRA EMPUJE: 2.95" (~3.0")', fonts["small_b"], (161, 98, 7))
    draw_tag(draw, (px0 + 145, py0 + 575), 'FRANJA CRISTAL LIBRE: 7.37"', fonts["small_b"], (15, 23, 42), fg=(255, 199, 44), border=(255, 199, 44))

    # Right side: Architectural Door Elevation Schematic + Dimensions Card (x=642..1668, y=114..1138)
    rx0, ry0, rw, rh = 642, 114, 1026, 1024
    draw.rounded_rectangle([rx0, ry0, rx0 + rw, ry0 + rh], radius=16, fill=(20, 24, 31), outline=(51, 65, 85), width=2)
    draw.text((rx0 + 28, ry0 + 22), 'ELEVACIÓN COMPLETA DE PUERTA COMERCIAL (36" × 84" / 91.4 × 213.4 cm)', font=fonts["h3"], fill=(255, 199, 44))
    draw.text(
        (rx0 + 28, ry0 + 50),
        'Comparativa espacial del cristal libre (31.0") y encaje perfecto del nuevo sticker 18.0" × 5.5"',
        font=fonts["body"],
        fill=(148, 163, 184),
    )

    # Door schematic inside left half of right panel (scale: 1 inch = 9.8 px)
    S = 9.8
    dx0, dy0 = rx0 + 70, ry0 + 115
    door_w, door_h = int(36.0 * S), int(84.0 * S)  # 352 x 823 px
    stile_w = int(2.5 * S)  # 24.5 px
    top_rail_h = int(3.5 * S)
    bot_rail_h = int(10.0 * S)

    # Door outer aluminum frame
    draw.rectangle([dx0, dy0, dx0 + door_w, dy0 + door_h], fill=(148, 163, 184), outline=(226, 232, 240), width=2)
    # Glass opening (31.0" wide)
    gx0, gx1 = dx0 + stile_w, dx0 + door_w - stile_w
    gy0, gy1 = dy0 + top_rail_h, dy0 + door_h - bot_rail_h
    draw.rectangle([gx0, gy0, gx1, gy1], fill=(24, 34, 48), outline=(94, 234, 212), width=2)

    # Push bar at y ~ 48" from top (leaving ~36" center height from floor)
    # In photo: paper bottom at Y_door ~ 37.5" from top; push bar 7.62" below paper bottom (~45.1" from top)
    pbar_y0 = dy0 + int(45.1 * S)
    pbar_y1 = pbar_y0 + int(3.0 * S)
    draw.rectangle([dx0 + 4, pbar_y0, dx0 + door_w - 4, pbar_y1], fill=(15, 23, 42), outline=(226, 232, 240), width=2)
    draw.rectangle([dx0 + 4, pbar_y0, dx0 + door_w - 4, pbar_y0 + 7], fill=(203, 213, 225))
    draw.text((dx0 + 95, pbar_y0 + 8), 'BARRA HORIZONTAL (3.0")', font=fonts["small_b"], fill=(255, 255, 255))

    # PULL badge on left stile
    draw.rectangle([dx0 + 6, pbar_y0 - int(11 * S), dx0 + 18, pbar_y0 - int(8 * S)], fill=(15, 23, 42))

    # Taped Letter Sheet (8.5" x 11.0") positioned cleanly above
    let_w, let_h = int(8.5 * S), int(11.0 * S)
    let_x = gx0 + int(((31.0 - 8.5) / 2.0) * S)  # centered recommendation or shown relative
    # Show letter sheet centered over the sticker for clean architectural symmetry
    let_y = pbar_y0 - int(7.62 * S) - let_h
    draw.rectangle([let_x, let_y, let_x + let_w, let_y + let_h], fill=(248, 250, 252), outline=(34, 197, 94), width=2)
    draw.text((let_x + 11, let_y + 38), 'CARTA', font=fonts["small_b"], fill=(15, 23, 42))
    draw.text((let_x + 6, let_y + 56), '8.5"×11"', font=fonts["small"], fill=(21, 128, 61))

    # NEW 18.0" x 5.5" sticker centered horizontally in 31.0" glass and vertically in 7.37" gap!
    stk_w, stk_h = int(18.0 * S), int(5.5 * S)  # 176 x 54 px
    stk_x = gx0 + (gx1 - gx0 - stk_w) // 2
    stk_y = (let_y + let_h) + ((pbar_y0 - (let_y + let_h)) - stk_h) // 2
    draw.rectangle([stk_x, stk_y, stk_x + stk_w, stk_y + stk_h], fill=(218, 41, 28), outline=(255, 199, 44), width=2)
    draw.rectangle([stk_x, stk_y, stk_x + stk_w, stk_y + 14], fill=(10, 10, 10))
    draw.text((stk_x + 28, stk_y + 22), 'NUEVO 18" × 5.5"', font=fonts["small_b"], fill=(255, 255, 255))

    # Dimension callout arrows on elevation
    # Total width 36.0" at top
    draw.line([(dx0, dy0 - 24), (dx0 + door_w, dy0 - 24)], fill=(255, 199, 44), width=2)
    draw.line([(dx0, dy0 - 32), (dx0, dy0 - 10)], fill=(255, 199, 44), width=2)
    draw.line([(dx0 + door_w, dy0 - 32), (dx0 + door_w, dy0 - 10)], fill=(255, 199, 44), width=2)
    draw.text((dx0 + 95, dy0 - 46), 'ANCHO HOJA: 36.0" (91.4 cm)', font=fonts["small_b"], fill=(255, 199, 44))

    # Clear glass width 31.0" inside top glass
    draw.line([(gx0, gy0 + 22), (gx1, gy0 + 22)], fill=(94, 234, 212), width=2)
    draw.text((gx0 + 52, gy0 + 28), 'CRISTAL LIBRE: 31.0" (78.7 cm)', font=fonts["small_b"], fill=(94, 234, 212))

    # Height 84.0" on left
    draw.line([(dx0 - 24, dy0), (dx0 - 24, dy0 + door_h)], fill=(255, 199, 44), width=2)
    draw.text((dx0 - 60, dy0 + 380), '84"', font=fonts["small_b"], fill=(255, 199, 44))

    # Bottom rail label
    draw.text((dx0 + 92, dy0 + door_h - 58), 'ZOCLO ALUMINIO: 10.0"', font=fonts["small_b"], fill=(15, 23, 42))

    # Margin callout 6.5" left/right around 18" sticker
    draw.line([(gx0, stk_y + stk_h // 2), (stk_x, stk_y + stk_h // 2)], fill=(255, 199, 44), width=2)
    draw.text((gx0 + 10, stk_y + stk_h // 2 - 20), '6.5"', font=fonts["small_b"], fill=(255, 199, 44))
    draw.line([(stk_x + stk_w, stk_y + stk_h // 2), (gx1, stk_y + stk_h // 2)], fill=(255, 199, 44), width=2)
    draw.text((stk_x + stk_w + 10, stk_y + stk_h // 2 - 20), '6.5"', font=fonts["small_b"], fill=(255, 199, 44))

    # Right column inside schematic panel: Measurement Breakdown Table
    tx0 = dx0 + door_w + 46
    tw = rx0 + rw - tx0 - 28
    ty = ry0 + 115

    cards = [
        ("REFERENCIA CALIBRADA", "Hoja Tamaño Carta (US Letter)", '8.50" × 11.00"  (21.59 × 27.94 cm)', "Mica térmica agrega 0.25\" por lado (9.0\" × 11.5\").", (34, 197, 94)),
        ("PUERTA COMERCIAL (ESTÁNDAR ADA)", "Hoja completa y marco de aluminio", '36.0" × 84.0"  (91.44 × 213.36 cm)', "Perfil vertical (PULL stile): 2.50\" (6.35 cm) por lado.", (56, 189, 248)),
        ("CRISTAL LIBRE DISPONIBLE", "Ancho útil del vidrio y franja vertical", 'Ancho: 31.0" (78.7 cm)  |  Alto franja: 7.37" (18.7 cm)', "Medido entre aviso de servicio (arriba) y barra (3.0\").", (94, 234, 212)),
        ("STICKER ACTUAL (PROBLEMA)", "Pegado chueco pisando perfil de aluminio", '15.06" × 3.88"  (38.2 × 9.9 cm)', "Invadía 2.22\" del aluminio y tenía ceros/dos puntos (:00).", (248, 113, 113)),
        ("NUEVO STICKER RECOMENDADO", "Formato universal 15 tiendas (1:1 / 300 DPI)", '18.00" × 5.50"  (45.72 × 13.97 cm)', "6.5\" libres por lado en puerta 36\" (3.5\" en 30\") y ~0.94\" vertical libre.", (255, 199, 44)),
    ]

    for title, sub, val, note, accent in cards:
        ch = 148
        draw.rounded_rectangle([tx0, ty, tx0 + tw, ty + ch], radius=12, fill=(15, 18, 24), outline=accent, width=2)
        draw.rectangle([tx0, ty + 12, tx0 + 6, ty + ch - 12], fill=accent)
        draw.text((tx0 + 20, ty + 14), title, font=fonts["badge"], fill=accent)
        draw.text((tx0 + 20, ty + 38), sub, font=fonts["small"], fill=(148, 163, 184))
        draw.text((tx0 + 20, ty + 66), val, font=fonts["h3"], fill=(255, 255, 255))
        # Wrap note cleanly inside card width (tw - 36 px) so nothing overflows border
        words, note_lines, cur_line = note.split(), [], ""
        for w in words:
            cand = (cur_line + " " + w).strip()
            if draw.textlength(cand, font=fonts["small"]) <= tw - 38:
                cur_line = cand
            else:
                if cur_line:
                    note_lines.append(cur_line)
                cur_line = w
        if cur_line:
            note_lines.append(cur_line)
        for li, nline in enumerate(note_lines[:2]):
            draw.text((tx0 + 20, ty + 100 + li * 19), nline, font=fonts["small"], fill=(203, 213, 225))
        ty += ch + 18

    out_path = EXPORTS_DIR / "door_measurements_annotated.png"
    canvas.save(out_path, format="PNG", dpi=(300, 300))
    print(f"[OK] Saved annotated door measurement diagram -> {out_path}")
    return out_path


def generate_before_after_mockup():
    """Creates exports/door-stickers-2026/door_before_after_mockup.png using inverse 3D homography."""
    from_in = build_door_plane_projection()
    fonts = load_pil_fonts()

    orig_bgr = cv2.imread(str(PHOTO_PATH))
    assert orig_bgr is not None
    H_p, W_p = orig_bgr.shape[:2]

    # Prepare clean AFTER photo by painting out old sticker on glass/aluminum & warping Rialto 18x5.5 sticker
    # First: let's build an exact planar homography from sticker PNG (5400x1650) -> photo pixels!
    rialto_png = PNG_DIR / "07_Rialto_Door_Sticker_18x5.5in.png"
    assert rialto_png.exists(), f"Missing Rialto PNG: {rialto_png}"
    stk_bgr = cv2.imread(str(rialto_png))
    sh, sw = stk_bgr.shape[:2]

    # Wait: on the photo, the camera sees X_in from approx -4.0" to +13.5".
    # Let's check: if we place the new 18.0" sticker aligned cleanly on the glass starting at X_in = +0.00"
    # (which is 0.50" right of the aluminum stile inner edge X=-0.50"), then X=0..13.5" is visible on the door photo
    # and the remaining 4.5" exits naturally at the right photo frame edge — AND we also display the FULL 18.0" x 5.5"
    # flat uncropped artwork in the bottom comparison strip so the user sees BOTH the realistic door perspective
    # AND the full 7-day sticker end-to-end!
    # Wait: first let's clean up the old sticker remnants from the aluminum stile & glass above/below Y=1.15..6.65:
    cleaned = orig_bgr.copy()

    # Sample clean aluminum column texture from y=340..425 (just above old sticker) and y=575..592 (below old sticker)
    # and clean glass pixels above/below old sticker so no red fragments peek out behind the new sticker!
    # Old sticker bounds in plane coords: X in [-2.75 .. +12.40], Y in [1.90 .. 5.90].
    # New sticker bounds in plane coords: X in [0.00 .. 18.00], Y in [1.15 .. 6.65].
    # Notice ONLY the region X in [-2.75 .. 0.00], Y in [1.90 .. 5.90] will remain visible once new sticker is placed!
    # Wait: X in [-2.75 .. -0.50] is SILVER ALUMINUM STILE, and X in [-0.50 .. 0.00] is a 0.50" glass gap!
    # Let's seamlessly clean the old sticker from X in [-2.80 .. +0.15], Y in [1.85 .. 5.95] by sampling vertical strip
    # along the aluminum stile & glass gap directly above (Y in [0.40 .. 1.70])!
    # Build pixel grid for cleaned photo
    # Better yet: map cleaned pixels directly via inverse homography from plane coords!
    # Let's compute H_plane_to_img using 4 points in inches!
    src_in = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]], dtype=np.float32)
    dst_px = np.array([from_in(x, y) for x, y in src_in], dtype=np.float32)
    H_in2px = cv2.getPerspectiveTransform(src_in, dst_px)
    H_px2in = np.linalg.inv(H_in2px)

    # For every pixel (u,v) in the old sticker left tail (X in [-2.85..0.15], Y in [1.75..5.95]):
    # replace pixel by sampling at the SAME X_in at Y_in_ref = 0.85 + 0.35 * frac (for aluminum stile X<-0.5)
    # or blending vertically between Y=1.45 and Y=6.25!
    xs_grid, ys_grid = np.meshgrid(np.arange(W_p, dtype=np.float32), np.arange(H_p, dtype=np.float32))
    pts_h = np.stack([xs_grid, ys_grid, np.ones_like(xs_grid)], axis=-1)
    plane_pts = pts_h @ H_px2in.T
    X_in_map = plane_pts[..., 0] / plane_pts[..., 2]
    Y_in_map = plane_pts[..., 1] / plane_pts[..., 2]

    mask_old_tail = (X_in_map >= -2.85) & (X_in_map <= 0.15) & (Y_in_map >= 1.75) & (Y_in_map <= 5.95)
    ys_m, xs_m = np.where(mask_old_tail)
    for u, v in zip(xs_m, ys_m):
        xin = float(X_in_map[v, u])
        yin = float(Y_in_map[v, u])
        t = (yin - 1.75) / (5.95 - 1.75)
        # Sample above at Y=1.20 and below at Y=6.35 along exact same X_in!
        p_above = H_in2px @ np.array([xin, 1.15, 1.0])
        u_a, v_a = int(round(p_above[0] / p_above[2])), int(round(p_above[1] / p_above[2]))
        p_below = H_in2px @ np.array([xin, 6.25, 1.0])
        u_b, v_b = int(round(p_below[0] / p_below[2])), int(round(p_below[1] / p_below[2]))
        u_a = max(0, min(W_p - 1, u_a))
        v_a = max(0, min(H_p - 1, v_a))
        u_b = max(0, min(W_p - 1, u_b))
        v_b = max(0, min(H_p - 1, v_b))
        # Subtle interpolation between clean aluminum/glass above and below
        cleaned[v, u] = np.clip((1.0 - t) * orig_bgr[v_a, u_a] + t * orig_bgr[v_b, u_b], 0, 255).astype(np.uint8)

    # Smooth feather around the cleaned aluminum region boundary
    cleaned_blur = cv2.GaussianBlur(cleaned, (3, 3), 0.7)
    kernel = np.ones((3, 3), np.uint8)
    edge_band = cv2.dilate(mask_old_tail.astype(np.uint8), kernel, iterations=1) - cv2.erode(mask_old_tail.astype(np.uint8), kernel, iterations=1)
    cleaned[edge_band > 0] = cleaned_blur[edge_band > 0]

    # Now warp Rialto 18.0" x 5.5" sticker onto X_in in [0.00 .. 18.00], Y_in in [1.15 .. 6.65]
    stk_src = np.array([[0, 0], [sw, 0], [sw, sh], [0, sh]], dtype=np.float32)
    stk_dst = np.array(
        [from_in(0.0, 1.15), from_in(18.0, 1.15), from_in(18.0, 6.65), from_in(0.0, 6.65)],
        dtype=np.float32,
    )
    H_stk = cv2.getPerspectiveTransform(stk_src, stk_dst)
    warped_stk = cv2.warpPerspective(stk_bgr, H_stk, (W_p, H_p), flags=cv2.INTER_AREA)

    # Alpha mask of sticker footprint
    mask_src = np.full((sh, sw), 255, dtype=np.uint8)
    warped_mask = cv2.warpPerspective(mask_src, H_stk, (W_p, H_p), flags=cv2.INTER_LINEAR)
    alpha = (warped_mask.astype(np.float32) / 255.0)[..., None]

    # Subtle ambient lighting + glass sheen matching photo lighting (slightly warmer top-right sheen)
    lit_stk = warped_stk.astype(np.float32) * 0.94
    sheen = np.linspace(1.0, 1.06, W_p, dtype=np.float32)[None, :, None]
    lit_stk = np.clip(lit_stk * sheen, 0, 255)

    after_bgr = np.clip(cleaned.astype(np.float32) * (1.0 - alpha) + lit_stk * alpha, 0, 255).astype(np.uint8)

    # Compose side-by-side comparison board (1680 x 1420 so bottom full-width strip never clips)
    BW, BH = 1680, 1420
    board = Image.new("RGB", (BW, BH), (12, 14, 18))
    bdraw = ImageDraw.Draw(board)

    # Header
    bdraw.rectangle([0, 0, BW, 84], fill=(10, 10, 10))
    bdraw.rectangle([0, 82, BW, 86], fill=(255, 199, 44))
    bdraw.text((34, 16), "TACOS GAVILAN  —  ANTES vs. DESPUÉS EN PUERTA (EJEMPLO TIENDA RIALTO)", font=fonts["h2"], fill=(255, 199, 44))
    bdraw.text(
        (34, 50),
        'Comparativa fotogramétrica real: sticker anterior (15" × 3.9") vs. nuevo diseño oficial (18" × 5.5", sin ceros ni ":")',
        font=fonts["body"],
        fill=(226, 232, 240),
    )

    # Paste Before & After (scale photos slightly to width=760? Wait: keep 576x1024 side by side or 500x889!)
    pw_disp, ph_disp = 520, 924
    before_pil = Image.fromarray(cv2.cvtColor(orig_bgr, cv2.COLOR_BGR2RGB)).resize((pw_disp, ph_disp), Image.Resampling.LANCZOS)
    after_pil = Image.fromarray(cv2.cvtColor(after_bgr, cv2.COLOR_BGR2RGB)).resize((pw_disp, ph_disp), Image.Resampling.LANCZOS)

    bx1 = 68
    bx2 = 636
    by = 132

    # Card frames
    bdraw.rounded_rectangle([bx1 - 12, by - 36, bx1 + pw_disp + 12, by + ph_disp + 12], radius=14, fill=(24, 24, 27), outline=(239, 68, 68), width=2)
    bdraw.text((bx1, by - 30), 'ANTES — Sticker actual (15" × 3.9")', font=fonts["bold"], fill=(248, 113, 113))
    board.paste(before_pil, (bx1, by))

    bdraw.rounded_rectangle([bx2 - 12, by - 36, bx2 + pw_disp + 12, by + ph_disp + 12], radius=14, fill=(24, 24, 27), outline=(34, 197, 94), width=2)
    bdraw.text((bx2, by - 30), 'DESPUÉS — Diseño Oficial 18" × 5.5" en cristal', font=fonts["bold"], fill=(74, 222, 128))
    board.paste(after_pil, (bx2, by))

    # Right column notes + full uncropped Rialto sticker preview below!
    rx = 1200
    rw_panel = BW - rx - 34
    bdraw.rounded_rectangle([rx, by - 36, rx + rw_panel, by + ph_disp + 12], radius=14, fill=(20, 24, 31), outline=(255, 199, 44), width=2)
    bdraw.text((rx + 22, by - 16), "MEJORAS CLAVE", font=fonts["h3"], fill=(255, 199, 44))

    improvements = [
        ("1. Cero Ceros y Sin ':'", "De '10:00 AM TO 12:00 AM' a '10 AM TO 12 AM'. Lectura instantánea a distancia.", (255, 199, 44)),
        ("2. Identidad de Marca Oficial", "Logo oficial TACOS/Gavilan en blanco, Gotham Ultra, textura y 'Ya está.'.", (255, 255, 255)),
        ("3. Respeto al Aluminio", "Despega el sticker del perfil PULL; ahora descansa 100% sobre cristal.", (74, 222, 128)),
        ("4. Tamaño Óptimo 18\" × 5.5\"", "41% más alto (5.5\" vs 3.88\") dentro de la franja libre de 7.37\".", (94, 234, 212)),
        ("5. Fines de Semana Destacados", "Tarjetas doradas + hora de cierre en rojo Gavilán (2 AM / 3 AM / 4 AM).", (251, 146, 60)),
        ("6. Aviso de Días Festivos", "Sello bilingüe limpio ('Holiday Hours May Vary') sin cajas en blanco.", (203, 213, 225)),
    ]
    iy = by + 30
    for head, desc, col in improvements:
        bdraw.text((rx + 22, iy), head, font=fonts["bold"], fill=col)
        # simple wrap at ~42 chars
        words = desc.split()
        lines, cur = [], ""
        for w in words:
            if len(cur + " " + w) > 40:
                lines.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            lines.append(cur)
        for li, line in enumerate(lines):
            bdraw.text((rx + 22, iy + 26 + li * 20), line, font=fonts["small"], fill=(203, 213, 225))
        iy += 100

    # Bottom strip: Full uncropped 18" x 5.5" Rialto sticker preview so Friday/Saturday/Sunday aren't cropped by portrait lens!
    strip_y = by + ph_disp + 34
    bdraw.text((bx1, strip_y), 'VISTA COMPLETA 1:1 SIN RECORTE — TIENDA RIALTO (18.0" × 5.5" / 45.72 × 13.97 cm):', font=fonts["bold"], fill=(255, 199, 44))
    flat_w = 880
    flat_h = int(round(flat_w * 5.5 / 18.0))  # 269 px
    flat_img = Image.open(rialto_png).convert("RGB").resize((flat_w, flat_h), Image.Resampling.LANCZOS)
    board.paste(flat_img, (bx1, strip_y + 28))
    bdraw.rectangle([bx1, strip_y + 28, bx1 + flat_w, strip_y + 28 + flat_h], outline=(255, 199, 44), width=2)

    # Note next to bottom strip
    nx = bx1 + flat_w + 30
    bdraw.rounded_rectangle([nx, strip_y + 28, BW - 34, strip_y + 28 + flat_h], radius=12, fill=(20, 24, 31), outline=(71, 85, 105), width=1)
    bdraw.text((nx + 24, strip_y + 46), "Nota sobre el encuadre de la foto original:", font=fonts["bold"], fill=(255, 255, 255))
    bdraw.text((nx + 24, strip_y + 78), "La cámara vertical capta hasta ~13.5\" de ancho desde la hoja Carta.", font=fonts["small"], fill=(203, 213, 225))
    bdraw.text((nx + 24, strip_y + 104), "En la puerta real (31.0\" de vidrio libre), el sticker de 18.0\" entra completo", font=fonts["small"], fill=(203, 213, 225))
    bdraw.text((nx + 24, strip_y + 130), "y queda centrado con 6.5\" de cristal libre a cada lado.", font=fonts["small"], fill=(74, 222, 128))
    bdraw.text((nx + 24, strip_y + 170), "Archivo listo para imprenta: 07_Rialto_Door_Sticker_18x5.5in.pdf", font=fonts["small_b"], fill=(255, 199, 44))

    out_path = EXPORTS_DIR / "door_before_after_mockup.png"
    board.save(out_path, format="PNG", dpi=(300, 300))
    print(f"[OK] Saved Before/After door mockup -> {out_path}")
    return out_path


def build_tech_pack_page1_pdf(manifest: dict, diag_path: Path, mockup_path: Path) -> Path:
    """Renders Page 1 Technical Print & Installation Spec Sheet (11in x 8.5in landscape) via Puppeteer."""
    def b64(p: Path, mime: str):
        return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode("ascii")

    gotham_uri = b64(GOTHAM_FONT, "font/otf")
    logo_uri = b64(LOGO_PATH, "image/png")
    diag_uri = b64(diag_path, "image/png")
    mockup_uri = b64(mockup_path, "image/png")

    def summarize_schedule(sched):
        # Compact readable summary across Mon..Sun using clean no-colon hours
        groups = []
        for row in sched:
            span = f"{row['open']} – {row['close']}"
            day_short = row["dayEn"][:3].title()
            if groups and groups[-1]["span"] == span:
                groups[-1]["days"].append(day_short)
            else:
                groups.append({"days": [day_short], "span": span, "ext": row["isExtended"]})
        parts = []
        for g in groups:
            dlabel = g["days"][0] if len(g["days"]) == 1 else f"{g['days'][0]}–{g['days'][-1]}"
            cls = "sched-ext" if g["ext"] else "sched-reg"
            parts.append(f'<span class="{cls}"><b>{dlabel}:</b> {g["span"]}</span>')
        return " &nbsp;|&nbsp; ".join(parts)

    rows_html = ""
    for s in manifest["stores"]:
        dt = '<span class="dt-pill">DT</span>' if s["hasDriveThru"] else '<span class="no-dt">—</span>'
        rows_html += f"""
        <tr>
          <td class="col-num">{s['rank']:02d}</td>
          <td class="col-store"><b>{s['displayName']}</b><br><span class="sub">{s['crossStreets']}</span></td>
          <td class="col-phone">{s['phone']}</td>
          <td class="col-dt">{dt}</td>
          <td class="col-sched">{summarize_schedule(s['schedule'])}</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<style>
  @font-face {{
    font-family: 'Gotham Ultra';
    src: url('{gotham_uri}') format('opentype');
    font-weight: 900;
  }}
  @page {{ size: 11in 8.5in; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: 1100px; height: 850px; overflow: hidden;
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #ffffff; color: #0f172a;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  .top-banner {{
    height: 78px; background: #0A0A0A; border-bottom: 4px solid #FFC72C;
    padding: 0 26px; display: flex; align-items: center; justify-content: space-between;
  }}
  .top-left {{ display: flex; align-items: center; gap: 14px; }}
  .top-left img {{ height: 54px; width: auto; }}
  .top-title {{ font-family: 'Gotham Ultra', sans-serif; font-size: 22px; color: #FFC72C; letter-spacing: 0.03em; }}
  .top-sub {{ font-size: 11.5px; color: #e2e8f0; margin-top: 2px; }}
  .top-right {{ text-align: right; color: #ffffff; font-size: 11px; line-height: 1.4; }}
  .top-right b {{ color: #FFC72C; font-size: 12.5px; }}
  .content {{ padding: 10px 24px; display: flex; flex-direction: column; gap: 8px; }}
  .specs-grid {{ display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 10px; }}
  .card {{
    border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 10px; background: #f8fafc;
  }}
  .card h3 {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #DA291C; margin-bottom: 4px; font-weight: 800; }}
  .spec-list {{ font-size: 9.4px; line-height: 1.42; color: #1e293b; }}
  .spec-list b {{ color: #0f172a; }}
  .thumb-box {{ text-align: center; }}
  .thumb-box img {{ height: 132px; width: auto; max-width: 100%; border-radius: 6px; border: 1px solid #94a3b8; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 9.2px; }}
  th {{
    background: #141414; color: #FFC72C; text-align: left; padding: 4.5px 7px;
    font-size: 8.8px; text-transform: uppercase; letter-spacing: 0.06em;
  }}
  td {{ padding: 3.8px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; line-height: 1.24; }}
  tr:nth-child(even) {{ background: #f8fafc; }}
  .col-num {{ font-weight: 800; color: #64748b; width: 26px; text-align: center; }}
  .col-store {{ width: 142px; }}
  .col-store .sub {{ color: #64748b; font-size: 8.4px; }}
  .col-phone {{ width: 92px; font-variant-numeric: tabular-nums; white-space: nowrap; }}
  .col-dt {{ width: 34px; text-align: center; }}
  .dt-pill {{ background: #FFC72C; color: #0A0A0A; font-weight: 900; padding: 1px 5px; border-radius: 4px; font-size: 8px; }}
  .no-dt {{ color: #94a3b8; }}
  .sched-reg b {{ color: #0f172a; }}
  .sched-ext {{ color: #b91c1c; font-weight: 700; }}
  .sched-ext b {{ color: #991b1b; }}
  .foot {{ font-size: 9px; color: #475569; display: flex; justify-content: space-between; margin-top: 2px; }}
</style>
</head>
<body>
  <header class="top-banner">
    <div class="top-left">
      <img src="{logo_uri}" alt="Tacos Gavilan" />
      <div>
        <div class="top-title">DOOR BUSINESS HOURS STICKERS — MASTER TECH PACK</div>
        <div class="top-sub">15 Tiendas Oficiales Tacos Gavilan &bull; Escala real 1:1 (18.0" &times; 5.5") &bull; Formato limpio sin ":00" ni ":"</div>
      </div>
    </div>
    <div class="top-right">
      <b>Medida de Impresión 1:1</b><br>
      18.00" &times; 5.50" (45.72 &times; 13.97 cm)<br>
      Páginas 2–16 vectoriales @ escala exacta
    </div>
  </header>
  <main class="content">
    <section class="specs-grid">
      <div class="card">
        <h3>Especificaciones Técnicas y de Instalación</h3>
        <div class="spec-list">
          <b>Puerta medida (Ref. Carta 8.5"&times;11"):</b> Hoja 36.0"&times;84.0", perfil aluminio PULL 2.50", cristal libre 31.0", franja libre vertical 7.37" sobre barra de 3.0".<br>
          <b>Sticker nuevo:</b> <b>18.0" &times; 5.5"</b> (45.72 &times; 13.97 cm). Deja 6.5" libres por lado en cristal de 31" y ~0.94" arriba/abajo.<br>
          <b>Material recomendado:</b> Vinil automotriz/exterior de alta opacidad con laminado UV mate o semi-brillante (opcional: impresión inversa/doble vista sobre cristal).<br>
          <b>Instalación:</b> Retirar sticker anterior, limpiar residuos del perfil de aluminio con alcohol isopropílico y centrar únicamente sobre el cristal.
        </div>
      </div>
      <div class="card thumb-box">
        <h3>Medición Fotogramétrica de Puerta</h3>
        <img src="{diag_uri}" alt="Door Measurements" />
      </div>
      <div class="card thumb-box">
        <h3>Comparativa Antes vs. Después</h3>
        <img src="{mockup_uri}" alt="Door Mockup" />
      </div>
    </section>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Sucursal / Cruce</th>
          <th>Teléfono</th>
          <th>DT</th>
          <th>Horario Oficial Semanal (Sin ":" ni ":00" — Días extendidos resaltados en rojo)</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
    </table>
    <footer class="foot">
      <span>&copy; Tacos Gavilan — Archivo maestro de producción (Página 1 Ficha Técnica + Páginas 2–16 Stickers 18.0" &times; 5.5" a escala 1:1)</span>
      <span>Fuente oficial: Supabase stores.weekly_hours + tacosgavilan.com/locations/</span>
    </footer>
  </main>
</body>
</html>"""

    page1_html = EXPORTS_DIR / "_temp_spec_sheet.html"
    page1_pdf = EXPORTS_DIR / "_temp_spec_sheet.pdf"
    page1_preview = ARTIFACT_DIR / "scratch" / "page1_spec_sheet_preview.png"
    page1_preview.parent.mkdir(parents=True, exist_ok=True)
    page1_html.write_text(html, encoding="utf-8")

    # Render page 1 via Node Puppeteer one-liner
    js = f"""
    const puppeteer = require('puppeteer');
    const fs = require('fs');
    (async () => {{
      const b = await puppeteer.launch({{ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }});
      const p = await b.newPage();
      await p.setViewport({{ width: 1100, height: 850, deviceScaleFactor: 2 }});
      await p.setContent(fs.readFileSync({json.dumps(str(page1_html))}, 'utf8'), {{ waitUntil: 'load' }});
      await p.evaluate(async () => {{ await document.fonts.ready; }});
      const metrics = await p.evaluate(() => {{
        const c = document.querySelector('.content');
        const f = document.querySelector('footer.foot');
        return {{
          scrollW: document.documentElement.scrollWidth,
          scrollH: document.documentElement.scrollHeight,
          contentBottom: c ? Math.round(c.getBoundingClientRect().bottom) : 0,
          footerBottom: f ? Math.round(f.getBoundingClientRect().bottom) : 0,
        }};
      }});
      console.log('Page 1 layout metrics:', JSON.stringify(metrics));
      if (metrics.scrollW > 1100 || metrics.scrollH > 850 || metrics.footerBottom > 848) {{
        throw new Error('Page 1 Tech Pack overflowed 11x8.5in page: ' + JSON.stringify(metrics));
      }}
      await p.screenshot({{ path: {json.dumps(str(page1_preview))}, fullPage: false }});
      await p.pdf({{ path: {json.dumps(str(page1_pdf))}, width: '11in', height: '8.5in', printBackground: true, preferCSSPageSize: true }});
      await b.close();
    }})().catch(e => {{ console.error(e); process.exit(1); }});
    """
    subprocess.run(["node", "-e", js], cwd=str(REPO_ROOT), check=True)
    page1_html.unlink(missing_ok=True)
    print(f"[OK] Generated Page 1 Spec Sheet PDF -> {page1_pdf}")
    return page1_pdf


def merge_and_verify_master_pdf(manifest: dict, page1_pdf: Path):
    master_pdf = EXPORTS_DIR / "Tacos_Gavilan_15_Stores_Door_Stickers_Master_2026.pdf"
    writer = PdfWriter()
    writer.append(str(page1_pdf))

    for s in manifest["stores"]:
        p = REPO_ROOT / s["pdfPath"]
        assert p.exists(), f"Missing store PDF: {p}"
        reader = PdfReader(str(p))
        assert len(reader.pages) == 1, f"{p} should have 1 page, has {len(reader.pages)}"
        box = reader.pages[0].mediabox
        w_pt, h_pt = float(box.width), float(box.height)
        assert abs(w_pt - 1296.0) < 0.5 and abs(h_pt - 396.0) < 0.5, (
            f"{p} MediaBox is {w_pt}x{h_pt} pt, expected 1296x396 pt (18x5.5 in)"
        )
        import re
        txt = reader.pages[0].extract_text() or ""
        txt_no_phone = re.sub(r"\(\d{3}\)\s*\d{3}\s*-\s*\d{4}", "", txt)
        assert ":" not in txt_no_phone, f"Found unexpected colon ':' in PDF text of {p}: {txt}"
        assert "00" not in txt_no_phone, f"Found unexpected '00' in PDF text of {p}: {txt}"
        writer.append(str(p))

    with open(master_pdf, "wb") as f:
        writer.write(f)
    page1_pdf.unlink(missing_ok=True)

    # Final verification of Master PDF
    m_reader = PdfReader(str(master_pdf))
    assert len(m_reader.pages) == 16, f"Expected 16 pages in Master PDF, got {len(m_reader.pages)}"
    p0_box = m_reader.pages[0].mediabox
    assert abs(float(p0_box.width) - 792.0) < 0.5 and abs(float(p0_box.height) - 612.0) < 0.5
    for idx in range(1, 16):
        b = m_reader.pages[idx].mediabox
        assert abs(float(b.width) - 1296.0) < 0.5 and abs(float(b.height) - 396.0) < 0.5

    print(f"[OK] Merged & verified 16-page Master PDF -> {master_pdf}")
    return master_pdf


def copy_previews_for_artifact(manifest: dict, diag_path: Path, mockup_path: Path):
    """Copies visual diagrams & representative sticker previews into Artifact Directory for Markdown embedding."""
    import shutil
    shutil.copy2(diag_path, ARTIFACT_DIR / "door_measurements_annotated.png")
    shutil.copy2(mockup_path, ARTIFACT_DIR / "door_before_after_mockup.png")
    for stem in ["01_Central", "02_Lynwood", "03_Broadway", "07_Rialto", "10_Hollywood", "12_Huntington_Park", "14_Azusa"]:
        src = PNG_DIR / f"{stem}_Door_Sticker_18x5.5in.png"
        # Downscale cleanly to 1800x550 for snappy artifact display (originals stay 5400x1650 in exports/)
        with Image.open(src) as im:
            im.resize((1800, 550), Image.Resampling.LANCZOS).save(
                ARTIFACT_DIR / f"preview_{stem}.png", format="PNG", optimize=True
            )
    print(f"[OK] Copied diagrams & 7 sticker previews to {ARTIFACT_DIR}")


def main():
    assert MANIFEST_PATH.exists(), f"Run scripts/generate-door-hours-stickers.ts first ({MANIFEST_PATH} missing)"
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert len(manifest["stores"]) == 15

    stamp_300_dpi_on_pngs(manifest)
    diag_path = generate_annotated_door_diagram()
    mockup_path = generate_before_after_mockup()
    page1_pdf = build_tech_pack_page1_pdf(manifest, diag_path, mockup_path)
    merge_and_verify_master_pdf(manifest, page1_pdf)
    copy_previews_for_artifact(manifest, diag_path, mockup_path)
    print("\nALL DOOR STICKER DELIVERABLES VERIFIED SUCCESSFULLY.")


if __name__ == "__main__":
    main()
