/**
 * @module Scripts/GenerateDoorHoursStickers
 * @description Generates 15 custom print-ready storefront Business Hours door stickers (18.0" x 5.5",
 *              1:1 Vector PDF + 300 DPI 5400x1650 PNG) using live Supabase store schedules and
 *              official Tacos Gavilan brand assets (Gotham Ultra, Mascot, "Ya esta." SVG, Halftones).
 * @businessRules
 *   - Storefront glass opening measures 31.0" wide (within a standard 36" x 84" door with 2.5" aluminum stiles),
 *     with 7.37" vertical clear glass space between the bottom of the laminated service-animal sign and the 3.0" push bar.
 *   - Optimal sticker print size is 18.0" x 5.5" (45.72 cm x 13.97 cm), centered on the glass (clear of the PULL stile).
 *   - Brand name is strictly "Tacos Gavilan" (never "Tacos El Gavilan").
 *   - Door clock format omits trailing ":00" zeros and colons ":" (e.g., "10 AM", "12 AM", "2 AM", "11 PM").
 *   - Weekly schedule queries live Supabase `stores.weekly_hours` for all 15 active locations.
 * @dataFlow
 *   Supabase `stores` (read-only) + local brand assets (`public/tacosgavilan-web/`) -> HTML/CSS template
 *   -> Puppeteer headless Chrome (`5400x1650` PNG & `18in x 5.5in` PDF) -> `exports/door-stickers-2026/`.
 * @notes
 *   - Uses the official GAVILAN-LOGO-STANDARD vector lockup extracted from `gavilan-logo-hor.svg`
 *     (`TACOS` tucked in the G–i crevice per Brand Standards p.4 & p.14, excluding "Ya está.") in
 *     high-contrast White (#FFFFFF) on the black header, with `BUSINESS HOURS` centered at ~900px
 *     and store details on `.header-right` (01_Central / 03_Broadway omit "LA " per owner sign-off).
 *   - Overrides the raw SVG viewBox of `ya_esta-home-hor.svg` cleanly so zero glyphs are clipped.
 *   - Verifies in-DOM layout dimensions (`scrollWidth <= 1800`, `scrollHeight <= 550`, zero card overflow,
 *     and >= 36px horizontal clearance between header zones across all 15 stores) plus zero ":" or "00" in clocks.
 *   - Supports `--preview [--preview-dir=<path>]` to validate all 15 stores and render preview PNGs
 *     of 01_Central without overwriting `exports/door-stickers-2026/`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

interface WeeklyHourEntry {
  day: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

interface StoreRow {
  id: number;
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string;
  is_active: boolean;
  has_drive_thru: boolean;
  weekly_hours: WeeklyHourEntry[];
}

interface FormattedDoorTime {
  numeral: string;
  minutes: string;
  period: 'AM' | 'PM';
  display: string;
  minutesSinceBusinessStart: number;
}

interface StorePresentationMeta {
  rank: number;
  slug: string;
  fileStem: string;
  displayName: string;
  crossStreets: string;
}

const STORE_PRESENTATION: Record<string, StorePresentationMeta> = {
  LACENTRAL: {
    rank: 1,
    slug: 'central',
    fileStem: '01_Central',
    displayName: 'CENTRAL',
    crossStreets: 'Central & Washington',
  },
  LYNWOOD: {
    rank: 2,
    slug: 'lynwood',
    fileStem: '02_Lynwood',
    displayName: 'LYNWOOD',
    crossStreets: 'Imperial & Long Beach',
  },
  LABROADWY: {
    rank: 3,
    slug: 'broadway',
    fileStem: '03_Broadway',
    displayName: 'BROADWAY',
    crossStreets: 'Vernon & Broadway',
  },
  NORWALK: {
    rank: 4,
    slug: 'norwalk',
    fileStem: '04_Norwalk',
    displayName: 'NORWALK',
    crossStreets: 'Rosecrans & Studebaker',
  },
  SLAUSON: {
    rank: 5,
    slug: 'slauson',
    fileStem: '05_Slauson',
    displayName: 'SLAUSON',
    crossStreets: 'Slauson & Broadway',
  },
  WCOVINA: {
    rank: 6,
    slug: 'west-covina',
    fileStem: '06_West_Covina',
    displayName: 'WEST COVINA',
    crossStreets: '10 FWY & Azusa',
  },
  RIALTO: {
    rank: 7,
    slug: 'rialto',
    fileStem: '07_Rialto',
    displayName: 'RIALTO',
    crossStreets: 'Baseline & Riverside',
  },
  SOUTHGATE: {
    rank: 8,
    slug: 'south-gate',
    fileStem: '08_South_Gate',
    displayName: 'SOUTH GATE',
    crossStreets: 'Firestone & Garfield',
  },
  DOWNEY: {
    rank: 9,
    slug: 'downey',
    fileStem: '09_Downey',
    displayName: 'DOWNEY',
    crossStreets: 'Florence & Paramount',
  },
  HOLLYWOOD: {
    rank: 10,
    slug: 'hollywood',
    fileStem: '10_Hollywood',
    displayName: 'HOLLYWOOD',
    crossStreets: 'Sunset & La Brea',
  },
  SANTAANA: {
    rank: 11,
    slug: 'santa-ana',
    fileStem: '11_Santa_Ana',
    displayName: 'SANTA ANA',
    crossStreets: '17th & Grand',
  },
  HPARK: {
    rank: 12,
    slug: 'huntington-park',
    fileStem: '12_Huntington_Park',
    displayName: 'HUNTINGTON PARK',
    crossStreets: 'Florence & Santa Fe',
  },
  LAPUENTE: {
    rank: 13,
    slug: 'la-puente',
    fileStem: '13_La_Puente',
    displayName: 'LA PUENTE',
    crossStreets: '605 FWY & Valley',
  },
  AZUSA: {
    rank: 14,
    slug: 'azusa',
    fileStem: '14_Azusa',
    displayName: 'AZUSA',
    crossStreets: 'Azusa & Arrow',
  },
  BELL: {
    rank: 15,
    slug: 'bell',
    fileStem: '15_Bell',
    displayName: 'BELL',
    crossStreets: 'Florence & Atlantic',
  },
};

const WEEKDAY_COLUMNS: ReadonlyArray<{
  dayIndex: number;
  en: string;
  es: string;
}> = [
  { dayIndex: 1, en: 'MONDAY', es: 'LUNES' },
  { dayIndex: 2, en: 'TUESDAY', es: 'MARTES' },
  { dayIndex: 3, en: 'WEDNESDAY', es: 'MIÉRCOLES' },
  { dayIndex: 4, en: 'THURSDAY', es: 'JUEVES' },
  { dayIndex: 5, en: 'FRIDAY', es: 'VIERNES' },
  { dayIndex: 6, en: 'SATURDAY', es: 'SÁBADO' },
  { dayIndex: 0, en: 'SUNDAY', es: 'DOMINGO' },
];

/**
 * Formats an "HH:MM" 24-hour string into a clean storefront clock string without ":" or ":00".
 * Example: "10:00" -> "10 AM", "00:00" -> "12 AM", "23:00" -> "11 PM", "02:00" -> "2 AM".
 */
export function formatCleanDoorHour(hhmm: string): FormattedDoorTime {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) {
    throw new Error(`Invalid HH:MM time value: "${hhmm}"`);
  }
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) {
    throw new Error(`Out-of-range time value: "${hhmm}"`);
  }

  const period: 'AM' | 'PM' = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const numeral = String(hour12);
  const minutes = minute === 0 ? '' : String(minute).padStart(2, '0');
  const display = minutes ? `${numeral} ${minutes} ${period}` : `${numeral} ${period}`;

  // Business day starts at 06:00 AM (360 min); hours < 06:00 belong to the post-midnight tail.
  const effectiveHour = hour24 < 6 ? hour24 + 24 : hour24;
  const minutesSinceBusinessStart = effectiveHour * 60 + minute;

  assert.ok(!display.includes(':'), `Formatted time contains forbidden colon: ${display}`);
  if (minute === 0) {
    assert.ok(!display.includes('00'), `Formatted top-of-hour contains forbidden 00: ${display}`);
  }

  return { numeral, minutes, period, display, minutesSinceBusinessStart };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileToBase64DataUri(filePath: string, mimeType: string): string {
  assert.ok(fs.existsSync(filePath), `Required brand asset missing: ${filePath}`);
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

function loadYaEstaSvgInline(svgPath: string, fillColor: string): string {
  assert.ok(fs.existsSync(svgPath), `Required Ya esta SVG missing: ${svgPath}`);
  const raw = fs.readFileSync(svgPath, 'utf8');
  const pathsMatch = raw.match(/<g>[\s\S]*?<\/g>/i);
  assert.ok(pathsMatch, `Could not extract <g> paths from ${svgPath}`);
  const cleanGroup = pathsMatch[0].replace(/class="st0"/g, `fill="${fillColor}"`);
  // ya_esta-home-hor.svg path bounds are x:12.5..842.0, y:21.6..214.1 inside 856.1 x 241.7
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 16 840 205" class="ya-esta-svg" aria-label="Ya está.">${cleanGroup}</svg>`;
}

function extractTopLevelSvgGroups(svgContent: string): string[] {
  const groups: string[] = [];
  const tagRegex = /<\/?g(?:\s[^>]*)?>/gi;
  let depth = 0;
  let groupStart = -1;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(svgContent)) !== null) {
    const isClosing = match[0].startsWith('</');
    if (!isClosing) {
      if (depth === 0) groupStart = match.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && groupStart >= 0) {
        groups.push(svgContent.slice(groupStart, match.index + match[0].length));
        groupStart = -1;
      }
    }
  }
  return groups;
}

/**
 * Extracts the official GAVILAN-LOGO-STANDARD horizontal vector lockup
 * (Sparrowhawk mascot + "TACOS" tucked in the G-i crevice of "Gavilan", excluding "Ya está.")
 * from `gavilan-logo-hor.svg` per Tacos Gavilan Brand Standards (pp. 4, 10, 14).
 */
function loadOfficialHeaderLogoSvgInline(svgPath: string, wordmarkColor: string): string {
  assert.ok(fs.existsSync(svgPath), `Required official horizontal logo SVG missing: ${svgPath}`);
  const raw = fs.readFileSync(svgPath, 'utf8');

  const ringMatch = raw.match(/<path\s+class="st1"[\s\S]*?\/>/i);
  assert.ok(ringMatch, `Could not extract red circle ring from ${svgPath}`);
  const redRingPath = ringMatch[0].replace(/class="st1"/g, 'fill="#DA291C"');

  const topGroups = extractTopLevelSvgGroups(raw);
  assert.equal(
    topGroups.length,
    4,
    `Expected 4 top-level <g> groups (Mascot, Gavilan, TACOS, Ya esta) in ${svgPath}, got ${topGroups.length}`
  );

  const mascotGroup = topGroups[0]
    .replace(/class="st2"/g, 'fill="#F47920"')
    .replace(/class="st3"/g, 'fill="#FFCE34" stroke="#FFCE34" stroke-miterlimit="10"')
    .replace(/class="st4"/g, 'fill="#FFFFFF"')
    .replace(/class="st5"/g, 'fill="#DA291C"');

  const gavilanWordmarkGroup = topGroups[1].replace(/class="st5"/g, `fill="${wordmarkColor}"`);
  const tacosWordmarkGroup = topGroups[2].replace(/class="st5"/g, `fill="${wordmarkColor}"`);

  // White backing strictly inside the red ring so black outlines pop cleanly while keeping exterior transparent on dark header
  const innerWhiteDisc = '<circle cx="252.8" cy="252.2" r="203.5" fill="#FFFFFF"/>';
  const result = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="30 30 1742 446" class="brand-lockup-svg" aria-label="Tacos Gavilan">${innerWhiteDisc}${redRingPath}${mascotGroup}${gavilanWordmarkGroup}${tacosWordmarkGroup}</svg>`;

  assert.ok(!result.includes('1999.2'), 'Header logo SVG unexpectedly included "Ya está." paths');
  assert.ok(!/class="st\d+"/i.test(result), 'Header logo SVG contains unresolved class="st*" styles');
  return result;
}

interface BrandAssets {
  gothamUltraDataUri: string;
  headerLogoSvg: string;
  blackPatternDataUri: string;
  redPatternDataUri: string;
  yaEstaSvg: string;
}

function loadBrandAssets(wordmarkColor = '#FFFFFF'): BrandAssets {
  const webRoot = path.resolve(process.cwd(), 'public', 'tacosgavilan-web');
  return {
    gothamUltraDataUri: fileToBase64DataUri(
      path.join(webRoot, 'fonts', 'Gotham Ultra.otf'),
      'font/otf'
    ),
    headerLogoSvg: loadOfficialHeaderLogoSvgInline(
      path.join(webRoot, 'img', 'gavilan-logo-hor.svg'),
      wordmarkColor
    ),
    blackPatternDataUri: fileToBase64DataUri(
      path.join(webRoot, 'img', 'patterns', 'black-text-1000.png'),
      'image/png'
    ),
    redPatternDataUri: fileToBase64DataUri(
      path.join(webRoot, 'img', 'patterns', 'red-text-1000.png'),
      'image/png'
    ),
    yaEstaSvg: loadYaEstaSvgInline(
      path.join(webRoot, 'img', 'ya_esta-home-hor.svg'),
      '#FFC72C'
    ),
  };
}

function buildStickerHtml(
  store: StoreRow,
  meta: StorePresentationMeta,
  assets: BrandAssets
): {
  html: string;
  scheduleSummary: Array<{ dayEn: string; dayEs: string; open: string; close: string; isExtended: boolean }>;
} {
  const byDay = new Map<number, WeeklyHourEntry>();
  for (const entry of store.weekly_hours || []) {
    byDay.set(Number(entry.day), entry);
  }
  assert.equal(byDay.size, 7, `Store ${store.name} does not have all 7 weekly_hours rows`);

  const parsedDays = WEEKDAY_COLUMNS.map((col) => {
    const raw = byDay.get(col.dayIndex);
    assert.ok(raw, `Missing day ${col.dayIndex} for store ${store.name}`);
    const open = formatCleanDoorHour(raw.open);
    const close = formatCleanDoorHour(raw.close);
    return { col, open, close };
  });

  const minCloseMinutes = Math.min(...parsedDays.map((d) => d.close.minutesSinceBusinessStart));
  const maxCloseMinutes = Math.max(...parsedDays.map((d) => d.close.minutesSinceBusinessStart));

  const scheduleSummary = parsedDays.map((d) => ({
    dayEn: d.col.en,
    dayEs: d.col.es,
    open: d.open.display,
    close: d.close.display,
    isExtended: maxCloseMinutes > minCloseMinutes && d.close.minutesSinceBusinessStart > minCloseMinutes,
  }));

  const dayCardsHtml = parsedDays
    .map((d) => {
      const isExtended =
        maxCloseMinutes > minCloseMinutes && d.close.minutesSinceBusinessStart > minCloseMinutes;
      const cardClass = isExtended ? 'day-card day-card-extended' : 'day-card';
      return `
        <article class="${cardClass}">
          <header class="day-header">
            <span class="day-en">${escapeHtml(d.col.en)}</span>
            <span class="day-es">${escapeHtml(d.col.es)}</span>
          </header>
          <div class="day-body">
            <div class="time-row time-open">
              <span class="time-num">${escapeHtml(d.open.numeral)}</span>${
                d.open.minutes ? `<span class="time-min">${escapeHtml(d.open.minutes)}</span>` : ''
              }<span class="time-ampm">${escapeHtml(d.open.period)}</span>
            </div>
            <div class="to-divider">
              <span class="to-line"></span>
              <span class="to-label">TO</span>
              <span class="to-line"></span>
            </div>
            <div class="time-row time-close">
              <span class="time-num">${escapeHtml(d.close.numeral)}</span>${
                d.close.minutes ? `<span class="time-min">${escapeHtml(d.close.minutes)}</span>` : ''
              }<span class="time-ampm">${escapeHtml(d.close.period)}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join('\n');

  const driveThruBadge = store.has_drive_thru
    ? `<span class="drive-thru-badge">DRIVE-THRU</span>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tacos Gavilan - ${escapeHtml(meta.displayName)} Door Sticker</title>
  <style>
    @font-face {
      font-family: 'Gotham Ultra';
      src: url('${assets.gothamUltraDataUri}') format('opentype');
      font-weight: 900;
      font-style: normal;
      font-display: block;
    }

    @page {
      size: 18in 5.5in;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      width: 1800px;
      height: 550px;
      overflow: hidden;
      background: #DA291C;
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sticker {
      width: 1800px;
      height: 550px;
      display: flex;
      flex-direction: column;
      background-color: #DA291C;
      background-image:
        linear-gradient(180deg, rgba(168, 22, 12, 0.10) 0%, rgba(120, 12, 6, 0.34) 100%),
        url('${assets.redPatternDataUri}');
      background-size: 100% 100%, 340px 340px;
      background-repeat: no-repeat, repeat;
      position: relative;
    }

    /* ================= TOP BRAND HEADER (144px) ================= */
    .brand-header {
      height: 144px;
      width: 100%;
      background-color: #0A0A0A;
      background-image:
        radial-gradient(ellipse at 50% 50%, rgba(255, 199, 44, 0.14) 0%, rgba(10, 10, 10, 0) 48%),
        linear-gradient(180deg, rgba(10, 10, 10, 0.55) 0%, rgba(5, 5, 5, 0.85) 100%),
        url('${assets.blackPatternDataUri}');
      background-size: 100% 100%, 100% 100%, 360px 360px;
      background-repeat: no-repeat, no-repeat, repeat;
      border-bottom: 5px solid #FFC72C;
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.42);
      padding: 0 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: relative;
      z-index: 3;
    }

    .header-left {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }

    .brand-lockup-svg {
      height: 108px;
      width: auto;
      display: block;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.85));
    }

    .header-center {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 2;
    }

    .main-title {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 58px;
      line-height: 0.94;
      letter-spacing: 0.015em;
      color: #FFC72C;
      text-transform: uppercase;
      white-space: nowrap;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.65);
    }

    .header-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: center;
      text-align: right;
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }

    .store-top-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 14px;
    }

    .drive-thru-badge {
      display: inline-flex;
      align-items: center;
      background: #FFC72C;
      color: #0A0A0A;
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 13.5px;
      letter-spacing: 0.08em;
      padding: 6px 13px 5px 13px;
      border-radius: 6px;
      text-transform: uppercase;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }

    .store-name {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 36px;
      line-height: 1;
      letter-spacing: 0.02em;
      color: #FFFFFF;
      text-transform: uppercase;
    }

    .store-meta-row {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 20px;
      line-height: 1.1;
    }

    .store-cross {
      font-weight: 800;
      color: #FFC72C;
      letter-spacing: 0.01em;
    }

    .meta-dot {
      color: rgba(255, 255, 255, 0.45);
      font-weight: 900;
    }

    .store-phone {
      font-weight: 700;
      color: #FFFFFF;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
    }

    /* ================= 7-DAY SCHEDULE GRID (324px) ================= */
    .schedule-zone {
      height: 324px;
      width: 100%;
      padding: 18px 34px 10px 34px;
      display: flex;
      align-items: stretch;
    }

    .days-grid {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 14px;
    }

    .day-card {
      background: #FFFFFF;
      border-radius: 15px;
      border: 2.5px solid rgba(255, 255, 255, 0.96);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
    }

    .day-card-extended {
      background: #FFFDF6;
      border: 3px solid #FFC72C;
      box-shadow: 0 10px 22px rgba(0, 0, 0, 0.36);
    }

    .day-header {
      height: 58px;
      background: #141414;
      border-bottom: 3px solid #DA291C;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4px 6px;
    }

    .day-card-extended .day-header {
      background: #FFC72C;
      border-bottom: 3px solid #0A0A0A;
    }

    .day-en {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 18.5px;
      line-height: 1.05;
      letter-spacing: 0.05em;
      color: #FFFFFF;
      text-transform: uppercase;
    }

    .day-card-extended .day-en {
      color: #0A0A0A;
    }

    .day-es {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: 0.16em;
      color: #FFC72C;
      text-transform: uppercase;
      margin-top: 2px;
    }

    .day-card-extended .day-es {
      color: #141414;
    }

    .day-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 10px 8px 12px 8px;
      gap: 7px;
    }

    .time-row {
      display: inline-flex;
      align-items: baseline;
      justify-content: center;
      white-space: nowrap;
      line-height: 0.95;
    }

    .time-num {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 58px;
      line-height: 0.92;
      color: #0A0A0A;
      letter-spacing: -0.02em;
    }

    .time-min {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 26px;
      color: #0A0A0A;
      margin-left: 4px;
    }

    .time-ampm {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 23px;
      line-height: 1;
      color: #334155;
      margin-left: 6px;
      letter-spacing: 0.02em;
    }

    .day-card-extended .time-close .time-num,
    .day-card-extended .time-close .time-min,
    .day-card-extended .time-close .time-ampm {
      color: #DA291C;
    }

    .to-divider {
      width: 72%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      margin: 2px 0;
    }

    .to-line {
      flex: 1;
      height: 2px;
      background: rgba(15, 23, 42, 0.16);
      border-radius: 2px;
    }

    .day-card-extended .to-line {
      background: rgba(218, 41, 28, 0.28);
    }

    .to-label {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-weight: 900;
      font-size: 12.5px;
      letter-spacing: 0.18em;
      color: #DA291C;
      text-transform: uppercase;
    }

    /* ================= BOTTOM BRAND FOOTER (82px) ================= */
    .sticker-footer {
      height: 82px;
      width: 100%;
      padding: 2px 34px 10px 34px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .footer-left {
      display: flex;
      align-items: center;
      min-width: 240px;
    }

    .ya-esta-svg {
      height: 54px;
      width: auto;
      display: block;
      filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.35));
    }

    .footer-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .footer-url {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 22px;
      line-height: 1.05;
      letter-spacing: 0.05em;
      color: #FFFFFF;
      text-transform: lowercase;
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    .footer-order {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.14em;
      color: #FFE49E;
      text-transform: uppercase;
      margin-top: 3px;
    }

    .footer-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      min-width: 340px;
    }

    .holiday-pill {
      background: rgba(10, 10, 10, 0.44);
      border: 1.75px solid rgba(255, 199, 44, 0.78);
      border-radius: 10px;
      padding: 8px 18px;
      text-align: right;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
    }

    .holiday-en {
      font-family: 'Gotham Ultra', 'Arial Black', sans-serif;
      font-size: 13.5px;
      line-height: 1.1;
      letter-spacing: 0.08em;
      color: #FFC72C;
      text-transform: uppercase;
    }

    .holiday-es {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: 0.03em;
      color: #FFFFFF;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <main class="sticker" data-store-code="${escapeHtml(store.code)}">
    <header class="brand-header">
      <div class="header-left">
        ${assets.headerLogoSvg}
      </div>
      <div class="header-center">
        <h1 class="main-title">BUSINESS HOURS</h1>
      </div>
      <div class="header-right">
        <div class="store-top-row">
          ${driveThruBadge}
          <div class="store-name">${escapeHtml(meta.displayName)}</div>
        </div>
        <div class="store-meta-row">
          <span class="store-cross">${escapeHtml(meta.crossStreets)}</span>
          <span class="meta-dot">&bull;</span>
          <span class="store-phone">${escapeHtml(store.phone)}</span>
        </div>
      </div>
    </header>

    <section class="schedule-zone" aria-label="Weekly Store Hours">
      <div class="days-grid">
        ${dayCardsHtml}
      </div>
    </section>

    <footer class="sticker-footer">
      <div class="footer-left">
        ${assets.yaEstaSvg}
      </div>
      <div class="footer-center">
        <div class="footer-url">tacosgavilan.com</div>
        <div class="footer-order">ORDER ONLINE &bull; ORDENA EN LÍNEA</div>
      </div>
      <div class="footer-right">
        <div class="holiday-pill">
          <div class="holiday-en">HOLIDAY HOURS MAY VARY</div>
          <div class="holiday-es">Horario Especial en Días Festivos</div>
        </div>
      </div>
    </footer>
  </main>
</body>
</html>`;

  return { html, scheduleSummary };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(supabaseUrl && supabaseKey, 'Missing Supabase credentials in .env.local');

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: stores, error } = await supabase
    .from('stores')
    .select('id, code, name, address, city, state, zip_code, phone, is_active, has_drive_thru, weekly_hours')
    .eq('is_active', true)
    .order('id');

  if (error || !stores) {
    throw new Error(`Failed to fetch stores from Supabase: ${error?.message || 'empty response'}`);
  }

  assert.equal(stores.length, 15, `Expected 15 active stores, got ${stores.length}`);

  const typedStores = (stores as StoreRow[]).sort((a, b) => {
    const ra = STORE_PRESENTATION[a.code]?.rank ?? 999;
    const rb = STORE_PRESENTATION[b.code]?.rank ?? 999;
    return ra - rb;
  });

  const isPreview = process.argv.includes('--preview');
  const previewDirArg = process.argv.find((a) => a.startsWith('--preview-dir='))?.slice('--preview-dir='.length);
  const wordmarkArg = process.argv.find((a) => a.startsWith('--wordmark-color='))?.slice('--wordmark-color='.length);
  const wordmarkColor = wordmarkArg === 'red' ? '#DA291C' : '#FFFFFF';

  const assets = loadBrandAssets(wordmarkColor);
  const assetsWhitePreview = isPreview ? loadBrandAssets('#FFFFFF') : null;

  const outBase = path.resolve(process.cwd(), 'exports', 'door-stickers-2026');
  const pdfDir = path.join(outBase, 'pdf-1to1');
  const pngDir = path.join(outBase, 'png-300dpi');
  const previewOutDir = previewDirArg
    ? path.resolve(previewDirArg)
    : path.resolve(process.cwd(), 'exports', 'door-stickers-2026', 'preview-v2');

  if (isPreview) {
    fs.mkdirSync(previewOutDir, { recursive: true });
    fs.mkdirSync(path.join(previewOutDir, 'scratch'), { recursive: true });
  } else {
    fs.mkdirSync(pdfDir, { recursive: true });
    fs.mkdirSync(pngDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const manifest: Array<{
    rank: number;
    id: number;
    code: string;
    name: string;
    displayName: string;
    crossStreets: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    phone: string;
    hasDriveThru: boolean;
    pdfPath: string;
    pngPath: string;
    schedule: Array<{ dayEn: string; dayEs: string; open: string; close: string; isExtended: boolean }>;
  }> = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1800, height: 550, deviceScaleFactor: isPreview ? 2 : 3 });

    for (const store of typedStores) {
      const meta = STORE_PRESENTATION[store.code];
      assert.ok(meta, `Missing presentation metadata for store code "${store.code}"`);

      const { html, scheduleSummary } = buildStickerHtml(store, meta, assets);

      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const layoutMetrics = await page.evaluate(() => {
        const body = document.body;
        const cards = Array.from(document.querySelectorAll('.day-card')).map((card, idx) => {
          const rect = card.getBoundingClientRect();
          return {
            idx,
            width: rect.width,
            height: rect.height,
            scrollWidth: card.scrollWidth,
            scrollHeight: card.scrollHeight,
          };
        });
        const yaEsta = document.querySelector('.ya-esta-svg')?.getBoundingClientRect();
        const leftBox = document.querySelector('.header-left')?.getBoundingClientRect();
        const titleBox = document.querySelector('.main-title')?.getBoundingClientRect();
        const rightBox = document.querySelector('.header-right')?.getBoundingClientRect();
        return {
          bodyScrollW: body.scrollWidth,
          bodyScrollH: body.scrollHeight,
          cardCount: cards.length,
          cards,
          yaEstaH: yaEsta?.height ?? 0,
          gapLeft: leftBox && titleBox ? titleBox.left - leftBox.right : -999,
          gapRight: titleBox && rightBox ? rightBox.left - titleBox.right : -999,
        };
      });

      assert.equal(layoutMetrics.cardCount, 7, `${store.name}: expected 7 day cards`);
      assert.ok(
        layoutMetrics.bodyScrollW <= 1800 && layoutMetrics.bodyScrollH <= 550,
        `${store.name}: sticker overflow detected (${layoutMetrics.bodyScrollW}x${layoutMetrics.bodyScrollH})`
      );
      for (const c of layoutMetrics.cards) {
        assert.ok(
          c.scrollWidth <= Math.ceil(c.width) + 1 && c.scrollHeight <= Math.ceil(c.height) + 1,
          `${store.name}: day card ${c.idx} clipped/overflowed (${c.scrollWidth}x${c.scrollHeight} vs ${c.width}x${c.height})`
        );
      }
      assert.ok(layoutMetrics.yaEstaH >= 48, `${store.name}: Ya esta SVG too small (${layoutMetrics.yaEstaH})`);
      assert.ok(
        layoutMetrics.gapLeft >= 36 && layoutMetrics.gapRight >= 36,
        `${store.name}: insufficient header clearance (left=${layoutMetrics.gapLeft.toFixed(1)}px, right=${layoutMetrics.gapRight.toFixed(1)}px)`
      );

      if (isPreview) {
        if (meta.rank === 1) {
          const redPreview = path.join(previewOutDir, 'preview_v2_01_LA_Central_red.png');
          await page.screenshot({ path: redPreview, type: 'png' });

          assert.ok(assetsWhitePreview, 'White preview assets missing');
          const whiteHtml = buildStickerHtml(store, meta, assetsWhitePreview).html;
          await page.setContent(whiteHtml, { waitUntil: 'load' });
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          const whitePreview = path.join(previewOutDir, 'preview_v2_01_LA_Central_white.png');
          await page.screenshot({ path: whitePreview, type: 'png' });
        } else if (meta.rank === 6) {
          const widestPreview = path.join(previewOutDir, 'scratch', 'preview_v2_06_West_Covina_red.png');
          await page.screenshot({ path: widestPreview, type: 'png' });
        }
        console.log(
          `[${String(meta.rank).padStart(2, '0')}/15] Verified ${meta.displayName} (gaps: L=${Math.round(layoutMetrics.gapLeft)}px, R=${Math.round(layoutMetrics.gapRight)}px)`
        );
        continue;
      }

      const pngFile = `${meta.fileStem}_Door_Sticker_18x5.5in.png`;
      const pdfFile = `${meta.fileStem}_Door_Sticker_18x5.5in.pdf`;
      const pngPath = path.join(pngDir, pngFile);
      const pdfPath = path.join(pdfDir, pdfFile);

      await page.screenshot({ path: pngPath, type: 'png' });
      await page.pdf({
        path: pdfPath,
        width: '18in',
        height: '5.5in',
        printBackground: true,
        preferCSSPageSize: true,
      });

      manifest.push({
        rank: meta.rank,
        id: store.id,
        code: store.code,
        name: store.name,
        displayName: meta.displayName,
        crossStreets: meta.crossStreets,
        address: store.address,
        city: store.city,
        state: store.state,
        zipCode: store.zip_code,
        phone: store.phone,
        hasDriveThru: store.has_drive_thru,
        pdfPath: path.relative(process.cwd(), pdfPath).replace(/\\/g, '/'),
        pngPath: path.relative(process.cwd(), pngPath).replace(/\\/g, '/'),
        schedule: scheduleSummary,
      });

      console.log(
        `[${String(meta.rank).padStart(2, '0')}/15] Rendered ${meta.displayName} (${meta.crossStreets}) -> ${pdfFile} + ${pngFile}`
      );
    }
  } finally {
    await browser.close();
  }

  if (isPreview) {
    console.log(`\nPreview ready! V2 previews saved to ${previewOutDir} (exports/door-stickers-2026/ untouched).`);
    return;
  }

  const manifestPath = path.join(outBase, 'stores_door_stickers_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), dimensionsInches: { width: 18.0, height: 5.5 }, stores: manifest }, null, 2));
  console.log(`\nDone! Generated 15 PDFs + 15 PNGs + manifest at ${manifestPath}`);
}

main().catch((err) => {
  console.error('Error generating door hours stickers:', err);
  process.exitCode = 1;
});
