/**
 * @module scripts/prepare-viele-images
 * @description Extracts, downloads from Viele CDN, and normalizes product images for all 89 Viele & Sons catalog items.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const targetDir = path.join(process.cwd(), 'public', 'images', 'viele');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 1. Load catalog mapping and API items
const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scratch', 'viele_catalog_mapping.json'), 'utf8'));
let apiItems = [];
if (fs.existsSync(path.join(process.cwd(), 'scratch', 'viele-api-response.json'))) {
  const apiResp = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scratch', 'viele-api-response.json'), 'utf8'));
  apiItems = apiResp.data.detail || [];
}

const apiItemMap = {};
for (const item of apiItems) {
  apiItemMap[item.ItemID.trim()] = item;
}

// Download helper
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return resolve(false);
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });
    }).on('error', (err) => {
      resolve(false);
    });
  });
}

// Category determination helper
function determineCategory(code, desc) {
  const d = desc.toLowerCase();
  const c = code.toLowerCase();
  if (d.includes('cup') || d.includes('lid') || c.includes('lid') || d.includes('sip') || d.includes('cone')) {
    return 'Vasos y Tapas';
  }
  if (d.includes('bag') || d.includes('seal2go') || d.includes('wax paper') || d.includes('tote')) {
    return 'Bolsas y Empaques';
  }
  if (d.includes('plate') || d.includes('container') || d.includes('steam table') || d.includes('tray') || d.includes('carrier') || d.includes('foil')) {
    return 'Platos y Contenedores';
  }
  if (d.includes('napkin') || d.includes('towel') || d.includes('tissue') || d.includes('toilet seat')) {
    return 'Papelería y Toallas';
  }
  if (d.includes('coca-cola') || d.includes('coke') || d.includes('sprite') || d.includes('fanta') || d.includes('lemonade') || d.includes('tea') || d.includes('creamer') || d.includes('sugar') || d.includes('splenda') || d.includes('sweetener')) {
    return 'Bebidas y Jarabes';
  }
  if (d.includes('cleaner') || d.includes('bleach') || d.includes('detergent') || d.includes('disinfectant') || d.includes('degreaser') || d.includes('sanitizer') || d.includes('scale') || d.includes('deodorizer') || d.includes('aerosol')) {
    return 'Químicos y Limpieza';
  }
  if (d.includes('fork') || d.includes('spoon') || d.includes('knife') || d.includes('glove') || d.includes('straw') || d.includes('stirrer') || d.includes('plug') || d.includes('toothpick') || d.includes('salt')) {
    return 'Cubiertos y Desechables';
  }
  return 'Insumos Generales';
}

async function processAll() {
  const codes = Object.keys(mapping.itemCodeDetails);
  console.log(`Processing ${codes.length} catalog items...`);

  const catalogItems = [];
  let downloadedCount = 0;
  let excelCopiedCount = 0;
  let fallbackCount = 0;

  for (let idx = 0; idx < codes.length; idx++) {
    const code = codes[idx];
    const details = mapping.itemCodeDetails[code];
    const apiItem = apiItemMap[code];
    const excelImageInfo = mapping.itemCodeToImage[code];

    let destFileName = `${code}.jpg`;
    let destPath = path.join(targetDir, destFileName);
    let imageSource = '';

    // Step A: Try CDN if ImageFile exists in API
    if (apiItem && apiItem.ImageFile) {
      const cdnUrl = `https://shop.vieleandsons.com/catalog/items/${apiItem.ImageFile}`;
      const ext = path.extname(apiItem.ImageFile) || '.jpg';
      destFileName = `${code}${ext}`;
      destPath = path.join(targetDir, destFileName);

      const ok = await downloadFile(cdnUrl, destPath);
      if (ok && fs.existsSync(destPath) && fs.statSync(destPath).size > 500) {
        downloadedCount++;
        imageSource = 'CDN (' + apiItem.ImageFile + ')';
      }
    }

    // Step B: If not downloaded from CDN, copy from Excel extracted media
    if (!imageSource && excelImageInfo && excelImageInfo.imgFile) {
      const srcMedia = path.join(process.cwd(), 'scratch', 'xlsx_extracted', 'xl', 'media', excelImageInfo.imgFile);
      if (fs.existsSync(srcMedia)) {
        const ext = path.extname(excelImageInfo.imgFile) || '.png';
        destFileName = `${code}${ext}`;
        destPath = path.join(targetDir, destFileName);
        fs.copyFileSync(srcMedia, destPath);
        excelCopiedCount++;
        imageSource = 'Excel Media (' + excelImageInfo.imgFile + ')';
      }
    }

    // Fallback check
    if (!fs.existsSync(destPath)) {
      fallbackCount++;
      destFileName = 'placeholder.png';
      imageSource = 'Placeholder';
    }

    const price = apiItem ? parseFloat(apiItem.Price) || 0 : 0;
    const uom = apiItem ? (apiItem.UnitOfMeasure || 'CS') : 'CS';
    const desc = details.desc || (apiItem ? apiItem.Description : code);
    const category = determineCategory(code, desc);

    catalogItems.push({
      item_code: code,
      description: desc,
      uom: uom,
      unit_price: price,
      category: category,
      image_file: `/images/viele/${destFileName}`,
      sort_order: idx + 1,
      source: imageSource
    });
  }

  console.log(`\nResults:`);
  console.log(`  Downloaded from CDN: ${downloadedCount}`);
  console.log(`  Copied from Excel Media: ${excelCopiedCount}`);
  console.log(`  Fallback placeholders: ${fallbackCount}`);
  console.log(`  Total catalog items processed: ${catalogItems.length}`);

  // Create a minimal transparent/colored placeholder.png just in case
  const placeholderPath = path.join(targetDir, 'placeholder.png');
  if (!fs.existsSync(placeholderPath) && fs.existsSync(path.join(targetDir, `${codes[0]}.jpg`))) {
    fs.copyFileSync(path.join(targetDir, `${codes[0]}.jpg`), placeholderPath);
  }

  // Save metadata JSON
  const catalogDataJson = path.join(process.cwd(), 'scratch', 'viele_master_catalog.json');
  fs.writeFileSync(catalogDataJson, JSON.stringify(catalogItems, null, 2), 'utf8');
  console.log(`Saved master catalog JSON to: ${catalogDataJson}`);

  // Save TypeScript definition file
  const tsContent = `/**
 * @module lib/viele-catalog-data
 * @description Catálogo maestro y tipos oficiales para insumos de Viele & Sons.
 *              Contiene los 89 SKUs auditados con precios, categorías, UOM y fotos.
 *
 * @businessRules
 * - Nombres oficiales de marca: Tacos Gavilan
 * - UOM principal: CS (Case / Caja)
 * - Los PARs por tienda se cruzan por store_id y item_code
 */

export interface VieleCatalogItem {
  item_code: string;
  description: string;
  uom: string;
  unit_price: number;
  category: string;
  image_file: string;
  sort_order: number;
}

export const VIELE_MASTER_CATALOG: VieleCatalogItem[] = ${JSON.stringify(catalogItems.map(({ source, ...rest }) => rest), null, 2)};
`;

  fs.writeFileSync(path.join(process.cwd(), 'lib', 'viele-catalog-data.ts'), tsContent, 'utf8');
  console.log(`Saved lib/viele-catalog-data.ts`);
}

processAll().catch(console.error);
