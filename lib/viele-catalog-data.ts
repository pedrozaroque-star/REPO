/**
 * @module lib/viele-catalog-data
 * @description Catálogo maestro y tipos oficiales para insumos de Viele & Sons.
 *              Contiene los 89 SKUs auditados con precios, categorías, UOM y fotos.
 *
 * @businessRules
 * - Nombres oficiales de marca: Tacos Gavilan
 * - UOM principal: CS (Case / Caja)
 * - Los PARs por tienda se cruzan por store_id y item_code
 * - Las Sodas (Bag-in-Box 5 gal) se facturan en orden separada por regulaciones fiscales de California (CRV)
 *
 * @dataFlow
 * - Importado por /api/viele/catalog, /api/viele/orders, /admin/compras/viele y scripts de inicialización.
 * - Sirve como catálogo maestro estático sincronizado con viele_items en Supabase.
 *
 * @notes
 * - [2026-09-07] Incorporada partición de SKUs de Sodas Bag-in-Box (VIELE_SODA_CODES e isVieleSoda)
 *   para soportar el flujo de doble facturación consecutiva en Viele & Sons.
 */

export interface VieleCatalogItem {
  item_code: string;
  description: string;
  uom: string;
  unit_price: number;
  category: string;
  image_file: string;
  sort_order: number;
  is_soda?: boolean;
  is_chemical?: boolean;
  is_taxable?: boolean;
  bin_no?: string;
  previous_price?: number | null;
  price_change_percent?: number | null;
  price_changed_at?: string | null;
  price_status?: 'increased' | 'decreased' | 'unchanged' | 'new' | null;
  last_scanned_at?: string | null;
}

export const VIELE_SODA_CODES = new Set([
  'BCLCO',
  'BDICO',
  'BDRPE',
  'BMMLE',
  'BMMOR',
  'BRATE',
  'BSPRI',
  'BSTRA',
  'BZECO'
]);

export function isVieleSoda(itemCode: string): boolean {
  if (!itemCode) return false;
  const code = itemCode.toUpperCase().trim();
  return VIELE_SODA_CODES.has(code);
}

export const VIELE_CHEMICAL_CODES = new Set([
  'IC5GLIDI',
  'IC5SANI',
  '3BLEA',
  'IC4FLCL',
  'IC4DEGR',
  'IC4DESC',
  'IC4DICL',
  'IC4OVGR',
  'QT10',
  'POURSC',
  'AEASFR',
  'AEDISP',
  'EF4CLEA'
]);

export function isVieleChemical(itemCode: string): boolean {
  if (!itemCode) return false;
  const code = itemCode.toUpperCase().trim();
  return VIELE_CHEMICAL_CODES.has(code) || code.startsWith('IC') || code.startsWith('EF');
}

export const VIELE_MASTER_CATALOG: VieleCatalogItem[] = [
  {
    "item_code": "BCLCO",
    "description": "Coca-Cola (Coke) Classic, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BCLCO.jpg",
    "sort_order": 1,
    "is_soda": true
  },
  {
    "item_code": "BDICO",
    "description": "Diet Coke, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BDICO.jpg",
    "sort_order": 2,
    "is_soda": true
  },
  {
    "item_code": "BMMLE",
    "description": "Minute Maid Lemonade, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BMMLE.jpg",
    "sort_order": 3,
    "is_soda": true
  },
  {
    "item_code": "BMMOR",
    "description": "Fanta Orange, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BMMOR.jpg",
    "sort_order": 4,
    "is_soda": true
  },
  {
    "item_code": "BSPRI",
    "description": "Sprite, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BSPRI.JPG",
    "sort_order": 5,
    "is_soda": true
  },
  {
    "item_code": "BRATE",
    "description": "Fuze Raspberry Iced Tea, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BRATE.jpg",
    "sort_order": 6,
    "is_soda": true
  },
  {
    "item_code": "BSTRA",
    "description": "Fanta Strawberry, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BSTRA.jpg",
    "sort_order": 7,
    "is_soda": true
  },
  {
    "item_code": "BZECO",
    "description": "Coca-Cola - Coke Zero Sugar, 5 gal Bag in a Box",
    "uom": "EACH",
    "unit_price": 118.32,
    "category": "Sodas (Bag-in-Box)",
    "image_file": "/images/viele/BZECO.jpg",
    "sort_order": 8,
    "is_soda": true
  },
  {
    "item_code": "10WRTO",
    "description": "Toothpicks, Plain Cello Wrapped",
    "uom": "12CS",
    "unit_price": 20.24,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/10WRTO.jpg",
    "sort_order": 9
  },
  {
    "item_code": "412W",
    "description": "Solo - Cup, 12 oz White Single Sided Poly Paper Hot Cup, 1000 count",
    "uom": "CS",
    "unit_price": 47.69,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/412W.jpg",
    "sort_order": 10
  },
  {
    "item_code": "12PR",
    "description": "Karat - Cold Cup, 12 oz Clear PP Ribbed Plastic",
    "uom": "CS",
    "unit_price": 32.5,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/12PR.jpg",
    "sort_order": 11
  },
  {
    "item_code": "2BT1000",
    "description": "Toilet Tissue Rolls, 2-Ply Jumbo Super Soft 9\"",
    "uom": "CS",
    "unit_price": 20.6,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/2BT1000.jpg",
    "sort_order": 12
  },
  {
    "item_code": "GR800",
    "description": "Allied West - Pacifica Universal Hardwound Roll Towels, 7.9\"x800' White",
    "uom": "CS",
    "unit_price": 34.79,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/GR800.jpg",
    "sort_order": 13
  },
  {
    "item_code": "2HOHA",
    "description": "Cup Carrier with Handle, 2 Hole",
    "uom": "CS",
    "unit_price": 58.67,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/2HOHA.jpg",
    "sort_order": 14
  },
  {
    "item_code": "4HOHADO",
    "description": "Cup Carry Out Tray with Handle, Holds 4 Drinks",
    "uom": "CS",
    "unit_price": 73.19,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/4HOHADO.jpg",
    "sort_order": 15
  },
  {
    "item_code": "501GE",
    "description": "Platinum I Dispenser Napkins, 1-Ply White, 7x13.5 para UBER",
    "uom": "CS",
    "unit_price": 35.08,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/501GE.JPG",
    "sort_order": 16
  },
  {
    "item_code": "DX900GE",
    "description": "Dispenser Napkin, 2-Ply White Interfold",
    "uom": "CS",
    "unit_price": 25.13,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/DX900GE.jpg",
    "sort_order": 17
  },
  {
    "item_code": "MUFO",
    "description": "Platinum II Multifold Towels, 2-Ply White",
    "uom": "CS",
    "unit_price": 22.12,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/MUFO.JPG",
    "sort_order": 18
  },
  {
    "item_code": "EL1025RED",
    "description": "El Gavilan - Straw, 10.25\" Wrapped, 24/300",
    "uom": "24CS",
    "unit_price": 50.4,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/EL1025RED.png",
    "sort_order": 19
  },
  {
    "item_code": "1175YLPR",
    "description": "Primo - Wrapped Straw, 11.75\" Yellow, 6/300 coun",
    "uom": "CS",
    "unit_price": 19.25,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/1175YLPR.png",
    "sort_order": 20
  },
  {
    "item_code": "6STIR",
    "description": "Unwrapped Stirrer, Sip & Stir Cocktail, 6.5\" Red/White Striped",
    "uom": "10CS",
    "unit_price": 21.25,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/6STIR.jpg",
    "sort_order": 21
  },
  {
    "item_code": "721PR",
    "description": "Primo - Foil Sheets, 12x10.75, 6/500 count",
    "uom": "6CS",
    "unit_price": 86.25,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/721PR.jpg",
    "sort_order": 22
  },
  {
    "item_code": "78",
    "description": "Chix Pro-Quat Fresh Guy Towels, Heavy Duty Red 12.5x17",
    "uom": "CS",
    "unit_price": 94.37,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/78.jpg",
    "sort_order": 23
  },
  {
    "item_code": "8R",
    "description": "Solo - Cup, 8 oz White Paper Cone/Water Refill",
    "uom": "CS",
    "unit_price": 112.49,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/8R.jpg",
    "sort_order": 24
  },
  {
    "item_code": "CPLUG-OR",
    "description": "StixToGo - Hot Beverage Plug, Orange Plastic Circle",
    "uom": "CS",
    "unit_price": 53.85,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/CPLUG-OR.jpg",
    "sort_order": 25
  },
  {
    "item_code": "CRCOMA",
    "description": "Nestle - Coffee-Mate Original Creamer",
    "uom": "CS",
    "unit_price": 43.93,
    "category": "Bebidas y Jarabes",
    "image_file": "/images/viele/CRCOMA.jpg",
    "sort_order": 26
  },
  {
    "item_code": "EL1254",
    "description": "El Gavilan - Wax Paper, 14x14, 4/1000 count",
    "uom": "CS",
    "unit_price": 85.77,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/EL1254.jpg",
    "sort_order": 27
  },
  {
    "item_code": "KDL76PP",
    "description": "El Gavilan - Flat Lid for 4 oz PP Container, 1000 count",
    "uom": "CS",
    "unit_price": 0,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/KDL76PP.png",
    "sort_order": 28
  },
  {
    "item_code": "EL4OZ",
    "description": "El Gavilan - Cup, 4 oz Paper, 1000 count",
    "uom": "CS",
    "unit_price": 27.5,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/EL4OZ.jpg",
    "sort_order": 29
  },
  {
    "item_code": "EL8LID",
    "description": "Karat - Flat Lid, Fits 8 oz Food Container, Clear PP Plastic",
    "uom": "CS",
    "unit_price": 30.09,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/EL8LID.jpg",
    "sort_order": 30
  },
  {
    "item_code": "EL8OZ",
    "description": "Karat - Hot/Cold Paper Food Container, 8 oz White",
    "uom": "CS",
    "unit_price": 46.2,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/EL8OZ.jpg",
    "sort_order": 31
  },
  {
    "item_code": "ELDP22",
    "description": "El Gavilan - Cup, 22 oz Paper, 1000 count",
    "uom": "CS",
    "unit_price": 55,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/ELDP22.jpg",
    "sort_order": 32
  },
  {
    "item_code": "ELDP32",
    "description": "El Gavilan - Cup, 32 oz Paper, 500 count",
    "uom": "CS",
    "unit_price": 48,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/ELDP32.jpg",
    "sort_order": 33
  },
  {
    "item_code": "ELSDR16",
    "description": "El Gavilan - Cup, 16 oz Hot, 600 count",
    "uom": "CS",
    "unit_price": 58,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/ELSDR16.jpg",
    "sort_order": 34
  },
  {
    "item_code": "L16KRT",
    "description": "Karat - Cold Cup Slot Flat Lid, Fits 12-22 oz",
    "uom": "CS",
    "unit_price": 22.82,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/L16KRT.jpg",
    "sort_order": 35
  },
  {
    "item_code": "L32KRT",
    "description": "Karat - Cold Cup Slot Flat Lid, Fits 32 oz",
    "uom": "CS",
    "unit_price": 20.13,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/L32KRT.jpg",
    "sort_order": 36
  },
  {
    "item_code": "HL1020PR",
    "description": "PRIMO - Sip Lid  White, Fits 10-20 oz Cups",
    "uom": "CS",
    "unit_price": 29,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/HL1020PR.png",
    "sort_order": 37
  },
  {
    "item_code": "ELGBEVTO",
    "description": "El Gavilan - Beverage Tote, 96 oz, 25 count",
    "uom": "CS",
    "unit_price": 98.75,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/ELGBEVTO.jpg",
    "sort_order": 38
  },
  {
    "item_code": "ELLAS2G",
    "description": "El Gavilan - Bag, 21x19+10 Seal2Go, 250 count",
    "uom": "CS",
    "unit_price": 52.8,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/ELLAS2G.jpg",
    "sort_order": 39
  },
  {
    "item_code": "ELMES2G",
    "description": "El Gavilan - Bag, 15x16+7 Seal2Go, 500 count",
    "uom": "CS",
    "unit_price": 56,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/ELMES2G.jpg",
    "sort_order": 40
  },
  {
    "item_code": "EL1CS2G",
    "description": "El Gavilan - Bag, 7x15+2.5 Seal2Go, 500 count",
    "uom": "CS",
    "unit_price": 27.68,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/EL1CS2G.jpg",
    "sort_order": 41
  },
  {
    "item_code": "EL2CS2G",
    "description": "El Gavilan - Bag, 14x15+2.5 Seal2Go, 250 count",
    "uom": "CS",
    "unit_price": 25.99,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/EL2CS2G.jpg",
    "sort_order": 42
  },
  {
    "item_code": "ELTSBALA",
    "description": "El Gavilan - Bag, 12x6x19 Plastic, 2000 count \nT-SHIRT",
    "uom": "CS",
    "unit_price": 43.85,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/ELTSBALA.jpg",
    "sort_order": 43
  },
  {
    "item_code": "EP9PR",
    "description": "Primo - MFPP Plate, 9\" 3/COMP Ivory, 500 count",
    "uom": "CS",
    "unit_price": 29.98,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/EP9PR.jpg",
    "sort_order": 44
  },
  {
    "item_code": "BG6IN",
    "description": "Primo - Plate, 6\" Round Bagasse, 1000 count",
    "uom": "CS",
    "unit_price": 30.74,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/BG6IN.jpg",
    "sort_order": 45
  },
  {
    "item_code": "HEFO",
    "description": "Fork, Heavy White PP Plastic",
    "uom": "CS",
    "unit_price": 11.99,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/HEFO.JPG",
    "sort_order": 46
  },
  {
    "item_code": "HEKN",
    "description": "Knife, Heavy White PP Plastic",
    "uom": "CS",
    "unit_price": 11.99,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/HEKN.JPG",
    "sort_order": 47
  },
  {
    "item_code": "HESP",
    "description": "Spoon, Heavy White PP Plastic",
    "uom": "CS",
    "unit_price": 11.99,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/HESP.JPG",
    "sort_order": 48
  },
  {
    "item_code": "WRHEFOBL",
    "description": "Fork, Heavy Black PS Plastic, Individually Wrapped, 1000 count",
    "uom": "CS",
    "unit_price": 16.68,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/WRHEFOBL.jpg",
    "sort_order": 49
  },
  {
    "item_code": "WRHESPBL",
    "description": "Spoon, Wrapped Black Plastic, Extra Heavy",
    "uom": "CS",
    "unit_price": 16.68,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/WRHESPBL.jpg",
    "sort_order": 50
  },
  {
    "item_code": "UP918PR",
    "description": "Primo - Food Container, 16 oz Round Black Base with Clear Lid, 150 count",
    "uom": "CS",
    "unit_price": 17.8,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/UP918PR.jpg",
    "sort_order": 51
  },
  {
    "item_code": "981BLKB",
    "description": "Container, 9x8 Black Base with 1 Compartment, 300 count",
    "uom": "CS",
    "unit_price": 42.55,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/981BLKB.png",
    "sort_order": 52
  },
  {
    "item_code": "983BLKB",
    "description": "Container, 9x8 Black Base with 3 Compartments, 300 count",
    "uom": "CS",
    "unit_price": 42.55,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/983BLKB.png",
    "sort_order": 53
  },
  {
    "item_code": "981LID",
    "description": "Lid for 9x8 Black Base 1 Compartment, 300 count",
    "uom": "CS",
    "unit_price": 31.8,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/981LID.png",
    "sort_order": 54
  },
  {
    "item_code": "983LID",
    "description": "Lid for 9x8 Black Base 3 Compartment, 300 count",
    "uom": "CS",
    "unit_price": 31.2,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/983LID.png",
    "sort_order": 55
  },
  {
    "item_code": "77PB",
    "description": "Poly Bag 7\"x7\" FLIPTOP",
    "uom": "CS",
    "unit_price": 8.77,
    "category": "Bolsas y Empaques",
    "image_file": "/images/viele/77PB.jpg",
    "sort_order": 56
  },
  {
    "item_code": "PCNDLI",
    "description": "Liquid Creamer",
    "uom": "CS",
    "unit_price": 13.81,
    "category": "Bebidas y Jarabes",
    "image_file": "/images/viele/PCNDLI.jpg",
    "sort_order": 57
  },
  {
    "item_code": "PCSALT",
    "description": "Diamond Crystal - Salt Packets, 3000 count",
    "uom": "CS",
    "unit_price": 11.58,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/PCSALT.jpg",
    "sort_order": 58
  },
  {
    "item_code": "PCSPDA",
    "description": "Splenda, Sweetener, Individual Packs",
    "uom": "CS",
    "unit_price": 37.89,
    "category": "Bebidas y Jarabes",
    "image_file": "/images/viele/PCSPDA.jpg",
    "sort_order": 59
  },
  {
    "item_code": "PCSUIN500",
    "description": "Sugar in the Raw Packets",
    "uom": "CS",
    "unit_price": 12.87,
    "category": "Bebidas y Jarabes",
    "image_file": "/images/viele/PCSUIN500.jpg",
    "sort_order": 60
  },
  {
    "item_code": "PFLAVI",
    "description": "Vinyl Gloves, Powder Free, Large",
    "uom": "10CS",
    "unit_price": 19.5,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/PFLAVI.jpg",
    "sort_order": 61
  },
  {
    "item_code": "PFMEVI",
    "description": "Vinyl Gloves, Powder Free, Medium",
    "uom": "10CS",
    "unit_price": 19.5,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/PFMEVI.jpg",
    "sort_order": 62
  },
  {
    "item_code": "PFXLVI",
    "description": "Vinyl Gloves, Powder Free, Extra Large",
    "uom": "10CS",
    "unit_price": 19.5,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/PFXLVI.jpg",
    "sort_order": 63
  },
  {
    "item_code": "PFLAVIBLK",
    "description": "Vinyl Gloves, Powder Free, Large Black, 10/100",
    "uom": "10CS",
    "unit_price": 26.25,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/PFLAVIBLK.jpg",
    "sort_order": 64
  },
  {
    "item_code": "LDGLGE",
    "description": "Poly Gloves, Medium/Large Clear, 20/500",
    "uom": "10CS",
    "unit_price": 22.8,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/LDGLGE.jpg",
    "sort_order": 65
  },
  {
    "item_code": "RC1124",
    "description": "Aluminum Steam Table - 1/3 Size Deep, 12.53x 6.5",
    "uom": "CS",
    "unit_price": 66.7,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/RC1124.jpg",
    "sort_order": 66
  },
  {
    "item_code": "RC1150",
    "description": "Primo - Steam Table Pan, 1/2 Size Aluminum, 100 count",
    "uom": "CS",
    "unit_price": 40.5,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/RC1150.jpg",
    "sort_order": 67
  },
  {
    "item_code": "RC1174",
    "description": "Primo - Steam Table Pan, Full Size Deep, 20.75x 12.8125 Aluminum, 50 count",
    "uom": "CS",
    "unit_price": 57.8,
    "category": "Platos y Contenedores",
    "image_file": "/images/viele/RC1174.jpg",
    "sort_order": 68
  },
  {
    "item_code": "709DO",
    "description": "Lid, 9\" Clear Plastic Round Dome Lid",
    "uom": "CS",
    "unit_price": 26.45,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/709DO.jpg",
    "sort_order": 69
  },
  {
    "item_code": "RC478",
    "description": "Aluminum Round Closeable Contain",
    "uom": "CS",
    "unit_price": 73.6,
    "category": "Insumos Generales",
    "image_file": "/images/viele/RC478.jpg",
    "sort_order": 70
  },
  {
    "item_code": "RL940",
    "description": "Aluminum Lid - Foil Lid 1/3 Size, 12.6875x6.5625",
    "uom": "CS",
    "unit_price": 33,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/RL940.jpg",
    "sort_order": 71
  },
  {
    "item_code": "RL970",
    "description": "Aluminum Lid - Foil Lid Half Size, 13x10.5625",
    "uom": "CS",
    "unit_price": 24.68,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/RL970.jpg",
    "sort_order": 72
  },
  {
    "item_code": "RL990",
    "description": "Primo - Steam Table Pan Lid, Full Size Aluminum, 50 count",
    "uom": "CS",
    "unit_price": 31.07,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/RL990.jpg",
    "sort_order": 73
  },
  {
    "item_code": "10SPOON",
    "description": "Serving Spoon, 10\" Black Plastic, 144 count",
    "uom": "CS",
    "unit_price": 24.08,
    "category": "Cubiertos y Desechables",
    "image_file": "/images/viele/10SPOON.jpg",
    "sort_order": 74
  },
  {
    "item_code": "TSCO",
    "description": "Toilet Seat Covers",
    "uom": "20CS",
    "unit_price": 35,
    "category": "Papelería y Toallas",
    "image_file": "/images/viele/TSCO.jpg",
    "sort_order": 75
  },
  {
    "item_code": "IC5GLIDI",
    "description": "Infinite Chemical - Super Green Pot n Pan Warewash Hand Detergent, 5 gal",
    "uom": "PAIL",
    "unit_price": 75.58,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC5GLIDI.png",
    "sort_order": 76,
    "is_chemical": true,
    "is_taxable": true,
    "bin_no": "2801B"
  },
  {
    "item_code": "IC5SANI",
    "description": "Infinite Chemical - Sani-10% Quat Ammonium Disinfectant and Sanitizer, 5 gal",
    "uom": "PAIL",
    "unit_price": 93.1,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC5SANI.jpg",
    "sort_order": 77,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "3BLEA",
    "description": "Restaurants Pride - Bleach",
    "uom": "3CS",
    "unit_price": 12.01,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/3BLEA.jpg",
    "sort_order": 78,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "IC4FLCL",
    "description": "Infinite Chemical - Enzyme Floor Cleaner, 4/1 gal",
    "uom": "4CS",
    "unit_price": 78.55,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC4FLCL.jpg",
    "sort_order": 79,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "IC4DEGR",
    "description": "Infinite Chemical - Degreaser, 4/1 gal",
    "uom": "4CS",
    "unit_price": 43.2,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC4DEGR.jpg",
    "sort_order": 80,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "IC4DESC",
    "description": "Infinite Chemical - Lime Scale Cleaner, 4/1 gal",
    "uom": "4CS",
    "unit_price": 62.3,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC4DESC.jpg",
    "sort_order": 81,
    "is_chemical": true,
    "is_taxable": true,
    "bin_no": "2806B"
  },
  {
    "item_code": "IC4DICL",
    "description": "Infinite Chemical - Sani-Clean Disinfectant, Lemon Scent, Red, 4/1 gal",
    "uom": "4CS",
    "unit_price": 86.4,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC4DICL.jpg",
    "sort_order": 82,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "IC4OVGR",
    "description": "OVER AND GRILL CLEANERS 1/4",
    "uom": "4CS",
    "unit_price": 60,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/IC4OVGR.jpg",
    "sort_order": 83,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "QT10",
    "description": "Hydrion Sanitizer (Quat) Test Paper Roll",
    "uom": "PKG",
    "unit_price": 13.5,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/QT10.jpg",
    "sort_order": 84,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "POURSC",
    "description": "Urinal Deodorizer Screen, Red, Spiced Apple Scent",
    "uom": "BOX",
    "unit_price": 28.62,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/POURSC.jpg",
    "sort_order": 85,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "AEASFR",
    "description": "Aerosol Fruit Scents, 7 oz Assorted",
    "uom": "CS",
    "unit_price": 58.14,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/AEASFR.JPG",
    "sort_order": 86,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "AEDISP",
    "description": "Misty Aerosol Dispenser",
    "uom": "EA",
    "unit_price": 27.19,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/AEDISP.jpg",
    "sort_order": 87,
    "is_chemical": true,
    "is_taxable": true
  },
  {
    "item_code": "EL4LID",
    "description": "El Gavilan - Flat Lid for 4 oz PP Container, 1000 count",
    "uom": "CS",
    "unit_price": 0,
    "category": "Vasos y Tapas",
    "image_file": "/images/viele/EL4LID.png",
    "sort_order": 88
  },
  {
    "item_code": "EF4CLEA",
    "description": "ENZIME FLOOR CLEANER",
    "uom": "CS",
    "unit_price": 0,
    "category": "Químicos y Limpieza",
    "image_file": "/images/viele/EF4CLEA.png",
    "sort_order": 89,
    "is_chemical": true,
    "is_taxable": true
  }
];
