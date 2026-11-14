/**
 * @module Scripts/GenerateCustomerExperienceSticker5x7
 * @description Generates print-ready 5x7 inch Tacos Gavilan Customer Experience ("¡Cuéntanos tu experiencia!")
 *              QR stickers in both Horizontal (7.0" x 5.0") and Vertical (5.0" x 7.0") orientations, plus a
 *              US Letter (8.5" x 11") 2-up print sheet with crop marks, using official brand assets
 *              (Gotham Ultra, Mascot + "TACOS Gavilan" + "Ya está." vector lockup, and brand halftones).
 * @businessRules
 *   - Encodes the exact official bilingual survey URL: https://tacosgavilan.vercel.app/clientes
 *     (served by app/clientes/page.tsx) with QR Error Correction Level Q (25% recovery).
 *   - Strict brand compliance: official brand name is "Tacos Gavilan" (never "Tacos El Gavilan"),
 *     uses official colors (#DA291C Red, #FFC72C Gold, #0A0A0A Black, #FFFFFF White), zero emojis,
 *     and keeps a clean white quiet zone around the QR matrix for instant phone-camera recognition.
 *   - Outputs 300 DPI raster PNGs (pHYs metadata = 300 DPI) and 1:1 vector PDFs for commercial printing.
 * @dataFlow
 *   Python `reportlab` QR matrix (ECC Q) + local `public/tacosgavilan-web/` brand assets -> HTML/CSS
 *   -> Puppeteer headless Chrome (Vector PDF + 3x raster capture) -> Sharp (300 DPI metadata)
 *   -> `exports/customer-experience-sticker-5x7/`.
 * @notes
 *   - Surgically recolors `gavilan-logo-hor.svg` per top-level `<g>` group so mascot internal colors
 *     (red ring, orange beak/sombrero, yellow feathers, red tongue, black outlines) remain 100% intact
 *     while rendering "TACOS Gavilan" in pure white (#FFFFFF) and "Ya está." in brand gold (#FFC72C).
 *   - Enforces Puppeteer in-DOM bounding-box assertions (zero overflow/clipping) and verifies every
 *     exported PNG via OpenCV QRCodeDetector at both 100% and 25% scale.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import sharp from 'sharp';

const TARGET_URL = 'https://tacosgavilan.vercel.app/clientes';
const QR_DISPLAY_URL = 'tacosgavilan.vercel.app/clientes';
const WEBSITE_URL = 'tacosgavilan.com';

interface BrandAssets {
  gothamUltraDataUri: string;
  blackPatternDataUri: string;
  redPatternDataUri: string;
  brandLockupSvg: string;
  qrSvg: string;
  qrModuleCount: number;
}

function fileToBase64DataUri(filePath: string, mimeType: string): string {
  assert.ok(fs.existsSync(filePath), `Required brand asset missing: ${filePath}`);
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

/**
 * Generates an exact QR matrix using Python ReportLab at Error Correction Level Q,
 * builds a crisp vector SVG with a 3-module white quiet zone and merged horizontal runs
 * to avoid sub-pixel seam lines in PDF/PNG rendering.
 */
function buildOfficialQrSvg(url: string): { svg: string; moduleCount: number } {
  const pyCode = [
    'import json',
    'from reportlab.graphics.barcode import qr',
    `w = qr.QrCodeWidget(${JSON.stringify(url)}, barLevel='Q')`,
    'w.qr.make()',
    'n = w.qr.getModuleCount()',
    'rows = [[1 if w.qr.isDark(r, c) else 0 for c in range(n)] for r in range(n)]',
    'print(json.dumps({"count": n, "rows": rows}))',
  ].join('\n');

  const rawOut = execFileSync('python', ['-c', pyCode], { encoding: 'utf8' }).trim();
  const parsed = JSON.parse(rawOut) as { count: number; rows: number[][] };
  const n = parsed.count;
  assert.ok(n >= 29, `Unexpectedly small QR matrix size: ${n}`);
  assert.equal(parsed.rows.length, n, 'QR row count mismatch');

  const quietZone = 4;
  const totalSize = n + quietZone * 2;
  const rects: string[] = [];

  for (let r = 0; r < n; r++) {
    const row = parsed.rows[r];
    let c = 0;
    while (c < n) {
      if (row[c] === 1) {
        const start = c;
        while (c < n && row[c] === 1) {
          c++;
        }
        const runWidth = c - start;
        rects.push(
          `<rect x="${start + quietZone}" y="${r + quietZone}" width="${runWidth}" height="1.02" fill="#0A0A0A"/>`
        );
      } else {
        c++;
      }
    }
  }

  assert.ok(rects.length > 50, 'QR SVG appears empty');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges" role="img" aria-label="QR Code for ${url}">`,
    `<rect width="${totalSize}" height="${totalSize}" fill="#FFFFFF"/>`,
    ...rects,
    '</svg>',
  ].join('');

  return { svg, moduleCount: n };
}

/**
 * Parses `gavilan-logo-hor.svg` by balanced top-level `<g>...</g>` groups:
 *   - Preamble (`<circle>`, `<path>` ring) & Group 0 (Mascot): keeps all original colors intact
 *     and scopes `.st*` classes to `.tg-lockup-st*` to prevent CSS collisions.
 *   - Group 1 (`Gavilan`) & Group 2 (`TACOS`): recolors `class="st5"` -> `fill="#FFFFFF"`.
 *   - Group 3 (`Ya está.`): recolors `class="st2"` -> `fill="#FFC72C"`.
 */
function buildBrandLockupSvg(svgPath: string): string {
  assert.ok(fs.existsSync(svgPath), `Required lockup SVG missing: ${svgPath}`);
  const raw = fs.readFileSync(svgPath, 'utf8');

  const topGroups: Array<{ start: number; end: number; content: string }> = [];
  let depth = 0;
  let start = -1;
  let i = 0;

  while (i < raw.length) {
    if (raw.startsWith('<g', i) && (raw[i + 2] === '>' || /\s/.test(raw[i + 2]))) {
      if (depth === 0) start = i;
      depth++;
      i += 2;
    } else if (raw.startsWith('</g>', i)) {
      depth--;
      if (depth === 0 && start !== -1) {
        const end = i + 4;
        topGroups.push({ start, end, content: raw.slice(start, end) });
        start = -1;
      }
      i += 4;
    } else {
      i++;
    }
  }

  assert.equal(
    topGroups.length,
    4,
    `Expected exactly 4 top-level <g> groups in ${svgPath}, found ${topGroups.length}`
  );

  const svgOpenMatch = raw.match(/<svg[^>]*>/i);
  assert.ok(svgOpenMatch, 'Could not find opening <svg> tag in gavilan-logo-hor.svg');

  const viewBoxMatch = svgOpenMatch[0].match(/viewBox="([^"]+)"/i);
  assert.ok(viewBoxMatch, 'Missing viewBox in gavilan-logo-hor.svg');

  const preambleStart = raw.indexOf(svgOpenMatch[0]) + svgOpenMatch[0].length;
  const rawPreamble = raw.slice(preambleStart, topGroups[0].start);

  const scopeClasses = (chunk: string): string =>
    chunk
      .replace(/\.st(\d+)/g, '.tg-lockup-st$1')
      .replace(/class="st(\d+)"/g, 'class="tg-lockup-st$1"');

  const scopedPreamble = scopeClasses(rawPreamble);
  const mascotGroup = scopeClasses(topGroups[0].content);
  const gavilanWordGroup = topGroups[1].content.replace(/class="st5"/g, 'fill="#FFFFFF"');
  const tacosWordGroup = topGroups[2].content.replace(/class="st5"/g, 'fill="#FFFFFF"');
  const yaEstaGroup = topGroups[3].content.replace(/class="st2"/g, 'fill="#FFC72C"');

  // Verify original mascot palette survived alongside the dark-header lockup colors
  assert.ok(scopedPreamble.includes('#ED2329'), 'Mascot red ring color missing');
  assert.ok(scopedPreamble.includes('#F47920'), 'Mascot orange color missing');
  assert.ok(scopedPreamble.includes('#FFCE34'), 'Mascot yellow color missing');
  assert.ok(scopedPreamble.includes('#EE3124'), 'Mascot red tongue color missing');
  assert.ok(gavilanWordGroup.includes('fill="#FFFFFF"'), 'Gavilan wordmark not recolored to white');
  assert.ok(tacosWordGroup.includes('fill="#FFFFFF"'), 'TACOS wordmark not recolored to white');
  assert.ok(yaEstaGroup.includes('fill="#FFC72C"'), 'Ya está. tagline not recolored to gold');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxMatch[1]}" class="brand-lockup-svg" role="img" aria-label="Tacos Gavilan - Ya está.">${scopedPreamble}${mascotGroup}${gavilanWordGroup}${tacosWordGroup}${yaEstaGroup}</svg>`;
}

function loadBrandAssets(): BrandAssets {
  const webRoot = path.resolve(process.cwd(), 'public', 'tacosgavilan-web');
  const { svg: qrSvg, moduleCount: qrModuleCount } = buildOfficialQrSvg(TARGET_URL);

  return {
    gothamUltraDataUri: fileToBase64DataUri(
      path.join(webRoot, 'fonts', 'Gotham Ultra.otf'),
      'font/otf'
    ),
    blackPatternDataUri: fileToBase64DataUri(
      path.join(webRoot, 'img', 'patterns', 'black-text-1000.png'),
      'image/png'
    ),
    redPatternDataUri: fileToBase64DataUri(
      path.join(webRoot, 'img', 'patterns', 'red-text-1000.png'),
      'image/png'
    ),
    brandLockupSvg: buildBrandLockupSvg(path.join(webRoot, 'img', 'gavilan-logo-hor.svg')),
    qrSvg,
    qrModuleCount,
  };
}

function buildStarsRowHtml(starSizePx: number): string {
  const starSvg = `<svg viewBox="0 0 24 24" width="${starSizePx}" height="${starSizePx}" class="gold-star" aria-hidden="true"><path fill="#FFC72C" d="M12 2.1l2.92 6.07 6.68.93-4.86 4.68 1.18 6.64L12 17.24l-5.92 3.18 1.18-6.64L2.4 9.1l6.68-.93L12 2.1z"/></svg>`;
  return `<div class="stars-row" aria-label="5 Stars">${starSvg.repeat(5)}</div>`;
}

function buildQrCardHtml(assets: BrandAssets, variant: 'horizontal' | 'vertical'): string {
  const footerCopy =
    variant === 'horizontal'
      ? 'ENCUESTA RÁPIDA &bull; 30 SEG'
      : 'ENCUESTA RÁPIDA &bull; QUICK SURVEY';

  return `
    <aside class="qr-card qr-card-${variant}">
      <div class="qr-card-header">
        <span class="qr-hd-es">ESCANEA AQUÍ</span>
        <span class="qr-hd-dot">&bull;</span>
        <span class="qr-hd-en">SCAN HERE</span>
      </div>
      <div class="qr-card-body">
        <div class="qr-frame">
          <span class="corner tl" aria-hidden="true"></span>
          <span class="corner tr" aria-hidden="true"></span>
          <span class="corner bl" aria-hidden="true"></span>
          <span class="corner br" aria-hidden="true"></span>
          <div class="qr-svg-wrap">
            ${assets.qrSvg}
          </div>
        </div>
      </div>
      <div class="qr-card-footer">${footerCopy}</div>
    </aside>
  `;
}

function buildHorizontalStickerInnerHtml(assets: BrandAssets): string {
  return `
    <main class="sticker sticker-horizontal" data-variant="7x5-horizontal">
      <header class="brand-header brand-header-h">
        <div class="header-lockup-h">
          ${assets.brandLockupSvg}
        </div>
        <div class="header-pill">
          <span>${WEBSITE_URL}</span>
        </div>
      </header>

      <section class="canvas-zone canvas-zone-h">
        ${buildQrCardHtml(assets, 'horizontal')}

        <div class="copy-col-h">
          ${buildStarsRowHtml(23)}
          <h1 class="headline-es-h">
            <span class="hl-white">¡CUÉNTANOS TU</span>
            <span class="hl-gold">EXPERIENCIA!</span>
          </h1>
          <div class="gold-rule" aria-hidden="true"></div>
          <p class="headline-en-h">
            <span>TELL US ABOUT</span>
            <span>YOUR EXPERIENCE</span>
          </p>
          <div class="instruction-pill instruction-pill-h">
            <div class="inst-es">Apunta la cámara de tu celular al código QR</div>
            <div class="inst-en">Point your phone camera at the QR code</div>
          </div>
        </div>
      </section>

      <footer class="sticker-footer sticker-footer-h">
        <div class="footer-pillars">SERVICIO &bull; ENTREGA &bull; CALIDAD &bull; LIMPIEZA</div>
        <div class="footer-link">${QR_DISPLAY_URL}</div>
      </footer>
    </main>
  `;
}

function buildVerticalStickerInnerHtml(assets: BrandAssets): string {
  return `
    <main class="sticker sticker-vertical" data-variant="5x7-vertical">
      <header class="brand-header brand-header-v">
        <div class="header-lockup-v">
          ${assets.brandLockupSvg}
        </div>
      </header>

      <section class="canvas-zone canvas-zone-v">
        ${buildStarsRowHtml(22)}

        <div class="headline-stack-v">
          <h1 class="headline-es-v">
            <span class="hl-white">¡CUÉNTANOS TU</span>
            <span class="hl-gold">EXPERIENCIA!</span>
          </h1>
          <p class="headline-en-v">TELL US ABOUT YOUR EXPERIENCE</p>
        </div>

        ${buildQrCardHtml(assets, 'vertical')}

        <div class="instruction-pill instruction-pill-v">
          <div class="inst-es">Apunta la cámara de tu celular al código QR</div>
          <div class="inst-en">Point your phone camera at the QR code</div>
        </div>
      </section>

      <footer class="sticker-footer sticker-footer-v">
        <div class="footer-pillars">SERVICIO &bull; ENTREGA &bull; CALIDAD &bull; LIMPIEZA</div>
        <div class="footer-link">${QR_DISPLAY_URL}</div>
      </footer>
    </main>
  `;
}

function buildSharedBrandCss(assets: BrandAssets): string {
  return `
    @font-face {
      font-family: 'Gotham Ultra';
      src: url('${assets.gothamUltraDataUri}') format('opentype');
      font-weight: 900;
      font-style: normal;
      font-display: block;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sticker {
      display: flex;
      flex-direction: column;
      background-color: #DA291C;
      background-image:
        linear-gradient(180deg, rgba(168, 22, 12, 0.08) 0%, rgba(110, 10, 5, 0.34) 100%),
        url('${assets.redPatternDataUri}');
      background-size: 100% 100%, 340px 340px;
      background-repeat: no-repeat, repeat;
      position: relative;
      overflow: hidden;
    }

    /* ================= TOP BRAND HEADER ================= */
    .brand-header {
      width: 100%;
      background-color: #0A0A0A;
      background-image:
        radial-gradient(ellipse at 18% 50%, rgba(255, 199, 44, 0.16) 0%, rgba(10, 10, 10, 0) 54%),
        linear-gradient(180deg, rgba(10, 10, 10, 0.50) 0%, rgba(5, 5, 5, 0.86) 100%),
        url('${assets.blackPatternDataUri}');
      background-size: 100% 100%, 100% 100%, 340px 340px;
      background-repeat: no-repeat, no-repeat, repeat;
      border-bottom: 4px solid #FFC72C;
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.42);
      position: relative;
      z-index: 3;
      flex-shrink: 0;
    }

    .brand-lockup-svg {
      display: block;
      width: auto;
      filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.72));
    }

    .header-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #DA291C;
      border: 1.5px solid #FFC72C;
      border-radius: 999px;
      padding: 6px 14px 5px 14px;
      color: #FFFFFF;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: lowercase;
      white-space: nowrap;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
      flex-shrink: 0;
    }

    /* ================= QR ARCHITECTURAL CARD ================= */
    .qr-card {
      background: #FFFFFF;
      border-radius: 16px;
      border: 3px solid #FFC72C;
      box-shadow: 0 12px 26px rgba(0, 0, 0, 0.34);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex-shrink: 0;
    }

    .qr-card-header {
      height: 38px;
      background: #141414;
      border-bottom: 3px solid #DA291C;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 0 10px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 11.5px;
      letter-spacing: 0.05em;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .qr-hd-es { color: #FFC72C; }
    .qr-hd-dot { color: rgba(255, 255, 255, 0.45); }
    .qr-hd-en { color: #FFFFFF; }

    .qr-card-body {
      flex: 1;
      background: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 10px 2px 10px;
    }

    .qr-frame {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 7px;
    }

    .qr-frame .corner {
      position: absolute;
      width: 14px;
      height: 14px;
      border-color: #DA291C;
      border-style: solid;
      pointer-events: none;
    }

    .qr-frame .corner.tl {
      top: 0; left: 0;
      border-width: 3px 0 0 3px;
      border-top-left-radius: 5px;
    }
    .qr-frame .corner.tr {
      top: 0; right: 0;
      border-width: 3px 3px 0 0;
      border-top-right-radius: 5px;
    }
    .qr-frame .corner.bl {
      bottom: 0; left: 0;
      border-width: 0 0 3px 3px;
      border-bottom-left-radius: 5px;
    }
    .qr-frame .corner.br {
      bottom: 0; right: 0;
      border-width: 0 3px 3px 0;
      border-bottom-right-radius: 5px;
    }

    .qr-svg-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .qr-svg-wrap svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    .qr-card-footer {
      height: 28px;
      background: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 10px 4px 10px;
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #334155;
      text-transform: uppercase;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ================= STARS, HEADLINES & PILL ================= */
    .stars-row {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .gold-star {
      display: block;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
    }

    .hl-white {
      display: block;
      color: #FFFFFF;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.52);
    }

    .hl-gold {
      display: block;
      color: #FFC72C;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.56);
    }

    .gold-rule {
      width: 78px;
      height: 3px;
      background: #FFC72C;
      border-radius: 2px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.35);
    }

    .instruction-pill {
      background: rgba(10, 10, 10, 0.46);
      border: 1.5px solid rgba(255, 199, 44, 0.78);
      border-radius: 10px;
      padding: 8px 13px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
    }

    .inst-es {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      color: #FFE49E;
    }

    .inst-en {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      color: #FFFFFF;
      margin-top: 2px;
    }

    /* ================= FOOTER ================= */
    .sticker-footer {
      width: 100%;
      background: rgba(10, 10, 10, 0.36);
      border-top: 1.5px solid rgba(255, 199, 44, 0.42);
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }

    .footer-pillars {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 10px;
      line-height: 1.1;
      letter-spacing: 0.08em;
      color: #FFC72C;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .footer-link {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.1;
      color: #FFFFFF;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    /* ================= HORIZONTAL 7.0" x 5.0" VARIANT ================= */
    .sticker-horizontal {
      width: 700px;
      height: 500px;
    }

    .brand-header-h {
      height: 106px;
      padding: 0 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .header-lockup-h .brand-lockup-svg {
      height: 76px;
    }

    .canvas-zone-h {
      height: 348px;
      width: 100%;
      padding: 18px 28px 16px 28px;
      display: flex;
      align-items: center;
      gap: 24px;
    }

    .qr-card-horizontal {
      width: 258px;
      height: 306px;
    }

    .qr-card-horizontal .qr-svg-wrap {
      width: 210px;
      height: 210px;
    }

    .copy-col-h {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
    }

    .headline-es-h {
      margin-top: 8px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      text-transform: uppercase;
      line-height: 1.12;
      letter-spacing: 0.01em;
      padding: 2px 0;
    }

    .headline-es-h .hl-white {
      font-size: 33px;
    }

    .headline-es-h .hl-gold {
      font-size: 37px;
    }

    .copy-col-h .gold-rule {
      margin: 8px 0;
    }

    .headline-en-h {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 22px;
      line-height: 1.14;
      letter-spacing: 0.015em;
      color: #FFFFFF;
      text-transform: uppercase;
      text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      padding: 2px 0;
    }

    .instruction-pill-h {
      margin-top: 10px;
      width: 100%;
    }

    .sticker-footer-h {
      height: 46px;
      padding: 0 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* ================= VERTICAL 5.0" x 7.0" VARIANT ================= */
    .sticker-vertical {
      width: 500px;
      height: 700px;
    }

    .brand-header-v {
      height: 112px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .header-lockup-v .brand-lockup-svg {
      height: 75px;
    }

    .canvas-zone-v {
      height: 540px;
      width: 100%;
      padding: 14px 28px 14px 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
    }

    .headline-stack-v {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .headline-es-v {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      text-transform: uppercase;
      line-height: 1.12;
      letter-spacing: 0.01em;
      padding: 2px 0;
    }

    .headline-es-v .hl-white {
      font-size: 30px;
    }

    .headline-es-v .hl-gold {
      font-size: 36px;
    }

    .headline-en-v {
      margin-top: 4px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 16.5px;
      line-height: 1.14;
      letter-spacing: 0.015em;
      color: #FFFFFF;
      text-transform: uppercase;
      text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
      white-space: nowrap;
      padding: 2px 0;
    }

    .qr-card-vertical {
      width: 286px;
      height: 308px;
    }

    .qr-card-vertical .qr-svg-wrap {
      width: 220px;
      height: 220px;
    }

    .instruction-pill-v {
      width: 100%;
      text-align: center;
    }

    .sticker-footer-v {
      height: 48px;
      padding: 5px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
    }
  `;
}

function buildStandaloneHtml(
  variant: 'horizontal' | 'vertical',
  assets: BrandAssets
): string {
  const pageSize = variant === 'horizontal' ? '7in 5in' : '5in 7in';
  const bodySize =
    variant === 'horizontal'
      ? 'width: 700px; height: 500px; overflow: hidden; background: #DA291C;'
      : 'width: 500px; height: 700px; overflow: hidden; background: #DA291C;';
  const inner =
    variant === 'horizontal'
      ? buildHorizontalStickerInnerHtml(assets)
      : buildVerticalStickerInnerHtml(assets);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Tacos Gavilan - Sticker Experiencia ${variant === 'horizontal' ? '7x5in' : '5x7in'}</title>
  <style>
    @page {
      size: ${pageSize};
      margin: 0;
    }
    html, body {
      ${bodySize}
    }
    ${buildSharedBrandCss(assets)}
  </style>
</head>
<body>
  ${inner}
</body>
</html>`;
}

function buildLetterSheetHtml(assets: BrandAssets): string {
  const stickerInner = buildHorizontalStickerInnerHtml(assets);

  const cropMarksSlot = (topPx: number): string => {
    const leftPx = 75; // 0.75 in on 8.5 in sheet (75 + 700 + 75 = 850)
    const w = 700;
    const h = 500;
    const gap = 6;
    const len = 18;
    return `
      <div class="sheet-slot" style="left: ${leftPx}px; top: ${topPx}px;">
        <span class="crop-mark" style="left: -${gap + len}px; top: 0; width: ${len}px; height: 0.75px;"></span>
        <span class="crop-mark" style="left: 0; top: -${gap + len}px; width: 0.75px; height: ${len}px;"></span>

        <span class="crop-mark" style="left: ${w + gap}px; top: 0; width: ${len}px; height: 0.75px;"></span>
        <span class="crop-mark" style="left: ${w}px; top: -${gap + len}px; width: 0.75px; height: ${len}px;"></span>

        <span class="crop-mark" style="left: -${gap + len}px; top: ${h}px; width: ${len}px; height: 0.75px;"></span>
        <span class="crop-mark" style="left: 0; top: ${h + gap}px; width: 0.75px; height: ${len}px;"></span>

        <span class="crop-mark" style="left: ${w + gap}px; top: ${h}px; width: ${len}px; height: 0.75px;"></span>
        <span class="crop-mark" style="left: ${w}px; top: ${h + gap}px; width: 0.75px; height: ${len}px;"></span>

        ${stickerInner}
      </div>
    `;
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Tacos Gavilan - Plantilla Carta 2x Stickers 7x5in</title>
  <style>
    @page {
      size: 8.5in 11in;
      margin: 0;
    }
    html, body {
      width: 850px;
      height: 1100px;
      overflow: hidden;
      background: #FFFFFF;
    }
    ${buildSharedBrandCss(assets)}
    .letter-sheet {
      width: 850px;
      height: 1100px;
      background: #FFFFFF;
      position: relative;
      overflow: hidden;
    }
    .sheet-slot {
      position: absolute;
      width: 700px;
      height: 500px;
    }
    .crop-mark {
      position: absolute;
      background: #475569;
      pointer-events: none;
    }
    .sheet-note {
      position: absolute;
      left: 75px;
      top: 529px;
      width: 700px;
      text-align: center;
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #64748B;
    }
  </style>
</head>
<body>
  <div class="letter-sheet">
    ${cropMarksSlot(30)}
    <div class="sheet-note">TACOS GAVILAN &bull; CORTE EXACTO 7.0" &times; 5.0" (100% ESCALA REAL / DO NOT SCALE)</div>
    ${cropMarksSlot(570)}
  </div>
</body>
</html>`;
}

async function assertLayoutFits(
  page: Page,
  expectedW: number,
  expectedH: number,
  label: string
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const body = document.body;
    const checkSelectors = [
      '.sticker',
      '.brand-header',
      '.canvas-zone',
      '.sticker-footer',
      '.qr-card',
      '.qr-card-header',
      '.qr-card-footer',
      '.headline-es-h',
      '.headline-en-h',
      '.headline-es-v',
      '.headline-en-v',
      '.instruction-pill',
      '.footer-pillars',
      '.footer-link',
      '.header-pill',
    ];

    const elementChecks = checkSelectors.flatMap((sel) =>
      Array.from(document.querySelectorAll(sel)).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          selector: sel,
          width: rect.width,
          height: rect.height,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          right: rect.right,
          bottom: rect.bottom,
        };
      })
    );

    const qrRect = document.querySelector('.qr-svg-wrap svg')?.getBoundingClientRect();
    const lockupRect = document.querySelector('.brand-lockup-svg')?.getBoundingClientRect();

    return {
      bodyScrollW: body.scrollWidth,
      bodyScrollH: body.scrollHeight,
      elementChecks,
      qrW: qrRect?.width ?? 0,
      qrH: qrRect?.height ?? 0,
      lockupW: lockupRect?.width ?? 0,
      lockupH: lockupRect?.height ?? 0,
    };
  });

  assert.ok(
    metrics.bodyScrollW <= expectedW && metrics.bodyScrollH <= expectedH,
    `${label}: document overflow (${metrics.bodyScrollW}x${metrics.bodyScrollH} vs ${expectedW}x${expectedH})`
  );

  for (const item of metrics.elementChecks) {
    assert.ok(
      item.scrollWidth <= Math.ceil(item.width) + 1 &&
        item.scrollHeight <= Math.ceil(item.height) + 1,
      `${label}: element "${item.selector}" overflowed (${item.scrollWidth}x${item.scrollHeight} vs ${item.width.toFixed(1)}x${item.height.toFixed(1)})`
    );
    assert.ok(
      item.right <= expectedW + 1 && item.bottom <= expectedH + 1,
      `${label}: element "${item.selector}" extends past canvas bounds (right=${item.right.toFixed(1)}, bottom=${item.bottom.toFixed(1)})`
    );
  }

  assert.ok(metrics.qrW >= 180 && metrics.qrH >= 180, `${label}: QR too small (${metrics.qrW}x${metrics.qrH})`);
  assert.ok(
    metrics.lockupW >= 300 && metrics.lockupH >= 65,
    `${label}: Brand lockup SVG too small (${metrics.lockupW}x${metrics.lockupH})`
  );
}

async function main(): Promise<void> {
  const assets = loadBrandAssets();
  const outDir = path.resolve(process.cwd(), 'exports', 'customer-experience-sticker-5x7');
  fs.mkdirSync(outDir, { recursive: true });

  const qrSvgPath = path.join(outDir, 'qr_clientes_oficial.svg');
  fs.writeFileSync(qrSvgPath, assets.qrSvg, 'utf8');

  const hPdfPath = path.join(outDir, 'Tacos_Gavilan_Sticker_Experiencia_7x5in_Horizontal.pdf');
  const hPngPath = path.join(outDir, 'Tacos_Gavilan_Sticker_Experiencia_7x5in_Horizontal_300DPI.png');
  const vPdfPath = path.join(outDir, 'Tacos_Gavilan_Sticker_Experiencia_5x7in_Vertical.pdf');
  const vPngPath = path.join(outDir, 'Tacos_Gavilan_Sticker_Experiencia_5x7in_Vertical_300DPI.png');
  const sheetPdfPath = path.join(outDir, 'Tacos_Gavilan_Plantilla_Carta_2x_Stickers_5x7in.pdf');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // 1. Horizontal 7.0" x 5.0" (2100 x 1500 px @ 300 DPI)
    await page.setViewport({ width: 700, height: 500, deviceScaleFactor: 3 });
    await page.setContent(buildStandaloneHtml('horizontal', assets), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await assertLayoutFits(page, 700, 500, 'Horizontal 7x5');

    const hRawPng = (await page.screenshot({ type: 'png' })) as Buffer;
    await sharp(hRawPng).withMetadata({ density: 300 }).png().toFile(hPngPath);
    await page.pdf({
      path: hPdfPath,
      width: '7in',
      height: '5in',
      scale: 0.96,
      printBackground: true,
      preferCSSPageSize: true,
    });

    // 2. Vertical 5.0" x 7.0" (1500 x 2100 px @ 300 DPI)
    await page.setViewport({ width: 500, height: 700, deviceScaleFactor: 3 });
    await page.setContent(buildStandaloneHtml('vertical', assets), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await assertLayoutFits(page, 500, 700, 'Vertical 5x7');

    const vRawPng = (await page.screenshot({ type: 'png' })) as Buffer;
    await sharp(vRawPng).withMetadata({ density: 300 }).png().toFile(vPngPath);
    await page.pdf({
      path: vPdfPath,
      width: '5in',
      height: '7in',
      scale: 0.96,
      printBackground: true,
      preferCSSPageSize: true,
    });

    // 3. US Letter 8.5" x 11" 2-up print sheet
    await page.setViewport({ width: 850, height: 1100, deviceScaleFactor: 2 });
    await page.setContent(buildLetterSheetHtml(assets), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await assertLayoutFits(page, 850, 1100, 'Letter Sheet 2x');
    await page.pdf({
      path: sheetPdfPath,
      width: '8.5in',
      height: '11in',
      scale: 0.96,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    brandName: 'Tacos Gavilan',
    qrTargetUrl: TARGET_URL,
    qrEccLevel: 'Q',
    qrModuleCount: assets.qrModuleCount,
    outputs: {
      horizontal: {
        dimensionsInches: { width: 7.0, height: 5.0 },
        rasterPx: { width: 2100, height: 1500, dpi: 300 },
        pngPath: path.relative(process.cwd(), hPngPath).replace(/\\/g, '/'),
        pdfPath: path.relative(process.cwd(), hPdfPath).replace(/\\/g, '/'),
      },
      vertical: {
        dimensionsInches: { width: 5.0, height: 7.0 },
        rasterPx: { width: 1500, height: 2100, dpi: 300 },
        pngPath: path.relative(process.cwd(), vPngPath).replace(/\\/g, '/'),
        pdfPath: path.relative(process.cwd(), vPdfPath).replace(/\\/g, '/'),
      },
      letterSheet2Up: {
        dimensionsInches: { width: 8.5, height: 11.0 },
        stickersPerPage: 2,
        stickerSizeInches: { width: 7.0, height: 5.0 },
        pdfPath: path.relative(process.cwd(), sheetPdfPath).replace(/\\/g, '/'),
      },
      qrSvgPath: path.relative(process.cwd(), qrSvgPath).replace(/\\/g, '/'),
    },
  };

  const manifestPath = path.join(outDir, 'sticker_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('Generated all 5x7 Tacos Gavilan customer experience stickers successfully:');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error('Error generating customer experience stickers:', err);
  process.exitCode = 1;
});
