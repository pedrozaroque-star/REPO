/**
 * @module Scripts/GenerateStaffEvalGlossyStickers
 * @description Generates print-ready single-sticker Tacos Gavilan Staff Evaluation ("¡Cuéntanos!")
 *              QR artwork in both Vertical (5.0" x 7.0") and Horizontal (7.0" x 5.0") 1:1 commercial
 *              print formats (1:1 Vector PDF + 300 DPI edge-to-edge PNG + Vector QR SVG), matching
 *              the clean V2 Tacos Gavilan brand system without Word templates or multi-up layouts.
 * @businessRules
 *   - Encodes the exact official kiosk URL: https://tacosgavilan.vercel.app/evaluacion/kiosk
 *     (served by app/evaluacion/kiosk/page.tsx) with QR Error Correction Level Q (25% recovery).
 *   - Strict brand compliance: official brand name is "Tacos Gavilan" (never "Tacos El Gavilan"),
 *     uses Gotham Ultra, official vector lockup (`[Mascot] TACOS Gavilan Ya está.`), brand colors
 *     (#DA291C Red, #FFC72C Gold, #0A0A0A Black, #FFFFFF White), brand halftones, zero visible URLs,
 *     and zero visual clutter.
 *   - Full-bleed rectangular edge-to-edge canvas (`border-radius: 0`) for crisp commercial print trimming.
 * @dataFlow
 *   Python `reportlab` QR matrix (ECC Q, ISO 4-module quiet zone) + local `public/tacosgavilan-web/` assets
 *   -> Puppeteer headless Chrome (1:1 Vector PDF + 3x raster capture)
 *   -> Sharp (300 DPI metadata via `toBuffer()` + `fs.writeFileSync`)
 *   -> `exports/staff-evaluation-stickers-glossy/`.
 * @notes
 *   - Uses `sharp(...).toBuffer()` + `fs.writeFileSync()` instead of `sharp.toFile()` to avoid Windows
 *     libvips overwrite locks.
 *   - Enforces Puppeteer in-DOM assertions (`assertLayoutFits`) ensuring zero text wrapping/clipping.
 *   - Top `.brand-header` and `.qr-card-header` use uniform flat matte black (`#111111`) with zero
 *     yellow radial glow, zero gradient sheen, and zero pattern overlay.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import sharp from 'sharp';

const TARGET_URL = 'https://tacosgavilan.vercel.app/evaluacion/kiosk';

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
 * building a crisp vector SVG with a 4-module white quiet zone and merged horizontal runs.
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
 * Surgically recolors `gavilan-logo-hor.svg` per top-level `<g>` group so mascot internal
 * colors remain untouched while rendering "TACOS Gavilan" in white and "Ya está." in gold.
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

function buildQrCardHtml(assets: BrandAssets, variant: 'vertical' | 'horizontal'): string {
  return `
    <aside class="qr-card qr-card-${variant}">
      <div class="qr-card-header">
        <span class="qr-hd-es">ESCANEA AQUÍ</span>
        <span class="qr-hd-dot">&bull;</span>
        <span class="qr-hd-en">SCAN HERE</span>
      </div>
      <div class="qr-card-body">
        <div class="qr-svg-wrap">
          ${assets.qrSvg}
        </div>
      </div>
    </aside>
  `;
}

function buildVerticalStaffInnerHtml(assets: BrandAssets): string {
  return `
    <main class="sticker sticker-vertical" data-variant="staff-5x7-vertical">
      <header class="brand-header brand-header-v">
        <div class="header-lockup-v">
          ${assets.brandLockupSvg}
        </div>
      </header>

      <section class="canvas-zone canvas-zone-v">
        <div class="headline-stack-v">
          <span class="staff-badge staff-badge-v">STAFF</span>
          <p class="staff-line1-v">ERES PARTE DE NUESTRO EQUIPO</p>
          <p class="staff-line2-v">TU VOZ ES ESCUCHADA</p>
          <h1 class="staff-cta-v">¡CUÉNTANOS!</h1>
        </div>

        ${buildQrCardHtml(assets, 'vertical')}
      </section>
    </main>
  `;
}

function buildHorizontalStaffInnerHtml(assets: BrandAssets): string {
  return `
    <main class="sticker sticker-horizontal" data-variant="staff-7x5-horizontal">
      <header class="brand-header brand-header-h">
        <div class="header-lockup-h">
          ${assets.brandLockupSvg}
        </div>
      </header>

      <section class="canvas-zone canvas-zone-h">
        ${buildQrCardHtml(assets, 'horizontal')}

        <div class="copy-col-h">
          <span class="staff-badge staff-badge-h">STAFF</span>
          <p class="staff-line1-h">
            <span>ERES PARTE DE</span>
            <span>NUESTRO EQUIPO</span>
          </p>
          <div class="gold-rule-h" aria-hidden="true"></div>
          <p class="staff-line2-h">TU VOZ ES ESCUCHADA</p>
          <h1 class="staff-cta-h">¡CUÉNTANOS!</h1>
        </div>
      </section>
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
      border-radius: 0;
      position: relative;
      overflow: hidden;
    }

    /* ================= TOP BRAND HEADER (FLAT MATTE BLACK) ================= */
    .brand-header {
      width: 100%;
      background: #111111;
      border-bottom: 4px solid #FFC72C;
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.42);
      position: relative;
      z-index: 3;
      flex-shrink: 0;
    }

    .brand-lockup-svg {
      display: block;
      width: auto;
    }

    .staff-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #FFC72C;
      color: #0A0A0A;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      text-transform: uppercase;
      white-space: nowrap;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.38);
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
      background: #111111;
      border-bottom: 3px solid #DA291C;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 0 10px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
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
      padding: 10px;
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

    /* ================= VERTICAL 5.0" x 7.0" ================= */
    .sticker-vertical {
      width: 500px;
      height: 700px;
    }

    .brand-header-v {
      height: 116px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .header-lockup-v .brand-lockup-svg {
      height: 78px;
    }

    .canvas-zone-v {
      height: 584px;
      width: 100%;
      padding: 20px 32px 24px 32px;
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

    .staff-badge-v {
      font-size: 13px;
      letter-spacing: 0.14em;
      padding: 4px 14px 3px 14px;
      border-radius: 6px;
      margin-bottom: 10px;
    }

    .staff-line1-v {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 18.5px;
      line-height: 1.14;
      letter-spacing: 0.015em;
      color: #FFFFFF;
      text-transform: uppercase;
      text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
      white-space: nowrap;
      padding: 1px 0;
    }

    .staff-line2-v {
      margin-top: 3px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 25px;
      line-height: 1.12;
      letter-spacing: 0.01em;
      color: #FFFFFF;
      text-transform: uppercase;
      text-shadow: 0 2.5px 0 rgba(0, 0, 0, 0.50);
      white-space: nowrap;
      padding: 1px 0;
    }

    .staff-cta-v {
      margin-top: 4px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 42px;
      line-height: 1.10;
      letter-spacing: 0.015em;
      color: #FFC72C;
      text-transform: uppercase;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.56);
      white-space: nowrap;
      padding: 2px 0;
    }

    .qr-card-vertical {
      width: 310px;
      height: 342px;
    }

    .qr-card-vertical .qr-card-header {
      height: 44px;
      font-size: 13px;
    }

    .qr-card-vertical .qr-svg-wrap {
      width: 264px;
      height: 264px;
    }

    /* ================= HORIZONTAL 7.0" x 5.0" ================= */
    .sticker-horizontal {
      width: 700px;
      height: 500px;
    }

    .brand-header-h {
      height: 114px;
      padding: 0 28px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .header-lockup-h .brand-lockup-svg {
      height: 82px;
    }

    .canvas-zone-h {
      height: 386px;
      width: 100%;
      padding: 26px 34px;
      display: flex;
      align-items: center;
      gap: 30px;
    }

    .qr-card-horizontal {
      width: 276px;
      height: 322px;
    }

    .qr-card-horizontal .qr-card-header {
      height: 42px;
      font-size: 12.5px;
    }

    .qr-card-horizontal .qr-svg-wrap {
      width: 242px;
      height: 242px;
    }

    .copy-col-h {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
    }

    .staff-badge-h {
      font-size: 13px;
      letter-spacing: 0.14em;
      padding: 5px 14px 4px 14px;
      border-radius: 6px;
      margin-bottom: 12px;
    }

    .staff-line1-h {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 27px;
      line-height: 1.10;
      letter-spacing: 0.01em;
      color: #FFFFFF;
      text-transform: uppercase;
      text-shadow: 0 2.5px 0 rgba(0, 0, 0, 0.50);
      display: flex;
      flex-direction: column;
      padding: 1px 0;
    }

    .gold-rule-h {
      width: 84px;
      height: 4px;
      background: #FFC72C;
      border-radius: 2px;
      margin: 12px 0;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.35);
    }

    .staff-line2-h {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 19px;
      line-height: 1.14;
      letter-spacing: 0.01em;
      color: #FFFFFF;
      text-transform: uppercase;
      text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
      white-space: nowrap;
      padding: 1px 0;
    }

    .staff-cta-h {
      margin-top: 6px;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 39px;
      line-height: 1.10;
      letter-spacing: 0.015em;
      color: #FFC72C;
      text-transform: uppercase;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.56);
      white-space: nowrap;
      padding: 2px 0;
    }
  `;
}

function buildStandaloneHtml(
  variant: 'vertical' | 'horizontal',
  assets: BrandAssets
): string {
  const pageSize = variant === 'vertical' ? '5in 7in' : '7in 5in';
  const bodyDims =
    variant === 'vertical'
      ? 'width: 500px; height: 700px;'
      : 'width: 700px; height: 500px;';
  const inner =
    variant === 'vertical'
      ? buildVerticalStaffInnerHtml(assets)
      : buildHorizontalStaffInnerHtml(assets);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Tacos Gavilan - Sticker STAFF ${variant === 'vertical' ? '5x7in' : '7x5in'}</title>
  <style>
    @page {
      size: ${pageSize};
      margin: 0;
    }
    html, body {
      ${bodyDims}
      overflow: hidden;
      background: #DA291C;
    }
    ${buildSharedBrandCss(assets)}
  </style>
</head>
<body>
  ${inner}
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
      '.qr-card',
      '.qr-card-header',
      '.staff-badge',
      '.staff-line1-v',
      '.staff-line2-v',
      '.staff-cta-v',
      '.staff-line1-h',
      '.staff-line2-h',
      '.staff-cta-h',
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

  assert.ok(metrics.qrW >= 220 && metrics.qrH >= 220, `${label}: QR too small (${metrics.qrW}x${metrics.qrH})`);
  assert.ok(
    metrics.lockupW >= 340 && metrics.lockupH >= 70,
    `${label}: Brand lockup SVG too small (${metrics.lockupW}x${metrics.lockupH})`
  );
}

async function main(): Promise<void> {
  const assets = loadBrandAssets();
  const outDir = path.resolve(process.cwd(), 'exports', 'staff-evaluation-stickers-glossy');
  fs.mkdirSync(outDir, { recursive: true });

  const qrSvgPath = path.join(outDir, 'qr_evaluacion_staff_oficial.svg');
  fs.writeFileSync(qrSvgPath, assets.qrSvg, 'utf8');

  const vPdfPath = path.join(outDir, 'Tacos_Gavilan_Sticker_STAFF_5x7in_Vertical.pdf');
  const vPngPath = path.join(outDir, 'Tacos_Gavilan_Sticker_STAFF_5x7in_Vertical_300DPI.png');
  const hPdfPath = path.join(outDir, 'Tacos_Gavilan_Sticker_STAFF_7x5in_Horizontal.pdf');
  const hPngPath = path.join(outDir, 'Tacos_Gavilan_Sticker_STAFF_7x5in_Horizontal_300DPI.png');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // 1. Vertical 5.0" x 7.0" (1500 x 2100 px @ 300 DPI)
    await page.setViewport({ width: 500, height: 700, deviceScaleFactor: 3 });
    await page.setContent(buildStandaloneHtml('vertical', assets), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await assertLayoutFits(page, 500, 700, 'STAFF Vertical 5x7');

    const vRawPng = (await page.screenshot({ type: 'png' })) as Buffer;
    const vFinalPng = await sharp(vRawPng).withMetadata({ density: 300 }).png().toBuffer();
    fs.writeFileSync(vPngPath, vFinalPng);
    await page.pdf({
      path: vPdfPath,
      width: '5in',
      height: '7in',
      scale: 0.96,
      printBackground: true,
      preferCSSPageSize: true,
    });

    // 2. Horizontal 7.0" x 5.0" (2100 x 1500 px @ 300 DPI)
    await page.setViewport({ width: 700, height: 500, deviceScaleFactor: 3 });
    await page.setContent(buildStandaloneHtml('horizontal', assets), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await assertLayoutFits(page, 700, 500, 'STAFF Horizontal 7x5');

    const hRawPng = (await page.screenshot({ type: 'png' })) as Buffer;
    const hFinalPng = await sharp(hRawPng).withMetadata({ density: 300 }).png().toBuffer();
    fs.writeFileSync(hPngPath, hFinalPng);
    await page.pdf({
      path: hPdfPath,
      width: '7in',
      height: '5in',
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
      vertical: {
        dimensionsInches: { width: 5.0, height: 7.0 },
        rasterPx: { width: 1500, height: 2100, dpi: 300 },
        pdfPath: path.relative(process.cwd(), vPdfPath).replace(/\\/g, '/'),
        pngPath: path.relative(process.cwd(), vPngPath).replace(/\\/g, '/'),
      },
      horizontal: {
        dimensionsInches: { width: 7.0, height: 5.0 },
        rasterPx: { width: 2100, height: 1500, dpi: 300 },
        pdfPath: path.relative(process.cwd(), hPdfPath).replace(/\\/g, '/'),
        pngPath: path.relative(process.cwd(), hPngPath).replace(/\\/g, '/'),
      },
      qrSvgPath: path.relative(process.cwd(), qrSvgPath).replace(/\\/g, '/'),
    },
  };

  fs.writeFileSync(
    path.join(outDir, 'staff_sticker_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  console.log('Generated Tacos Gavilan single STAFF print stickers successfully:');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error('Error generating STAFF print stickers:', err);
  process.exitCode = 1;
});
