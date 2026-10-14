/**
 * @module accounting-journal
 * @description Core business logic for generating balanced journal entries from POS sales data.
 * Replaces the legacy Cohesion module by matching its exact output structure and account mappings.
 * @businessRules
 * - Business day starts at 6:00 AM, timezone America/Los_Angeles.
 * - Only generates lines with amounts > 0.
 * - Must output a balanced journal (Total Debits === Total Credits).
 * - Exact account mapping matching the legacy system.
 * - Open orders and deposits collected are debited to account 12049 (Deposit Sales Collected & Open Orders)
 *   and added to Non-Cash Payments, ensuring perfect parity with Cohesion and exact Expected Cash calculation.
 * - Cash In & Cash Out: Movimientos de gaveta registrados en Toast Cash Management se registran en la cuenta 12100
 *   (Tips/Grat Payable / Cash Clearing): Cash In como Crédito y Cash Out como Débito, afectando el efectivo esperado.
 * @dataFlow POS Sales Data -> generateJournalLines -> JournalResult -> QBO API
 * @notes Uses Math.round(x * 100) / 100 for all monetary calculations to avoid floating point precision issues.
 *   Paridad total con Cohesion en Lynwood 2026-10-12: Cash In y Cash Out de $200.00 llevan los totales a $14,611.67 balanceados al centavo.
 */

export interface JournalLine {
  account: string;
  memo: string;
  debit: number;
  credit: number;
  sourceMemo: string;
  location: string;
  className: string;
}

export interface SalesPacketData {
  net_sales: number;
  total_taxes: number;

  for_here_sales: number;
  to_go_sales: number;
  phone_sales?: number;
  curbside_sales?: number;
  drive_thru_sales?: number;
  kiosk_dine_in_sales?: number;
  kiosk_takeout_sales?: number;
  toast_online_sales?: number;
  online_ordering_takeout_sales?: number;
  toast_delivery_sales?: number;
  tips_payable?: number;
  deposits_collected?: number;
  paid_in?: number;
  uber_delivery_sales: number;
  uber_takeout_sales: number;
  doordash_takeout_sales: number;
  doordash_delivery_sales: number;
  grubhub_delivery_sales: number;
  grubhub_takeout_sales?: number;

  deferred_gift_cards?: number;
  delivery_service_charges?: number;
  gift_card_redemption?: number;

  tax_paid_by_uber: number;
  sales_tax: number;
  marketplace_tax: number;

  ebt_amount: number;
  uber_payment: number;
  doordash_payment: number;
  grubhub_payment: number;

  credit_card_deposit: number;
  credit_card_fees: number;
  credit_card_other_deductions?: number;
  cash_deposits: number;
  cash_payouts?: Array<{ amount: number; reason?: string; comment?: string }>;
  cash_payouts_total?: number;
  cash_in?: number;
  cash_out?: number;
  tip_out?: number;
}

export interface SiteMappingConfig {
  location: string;
  className: string;
  bank_account: string;
  sales_tax_rate_name: string;
  sales_dine_in_account?: string;
  sales_uber_account?: string;
  sales_doordash_account?: string;
  sales_grubhub_account?: string;
  sales_tax_account?: string;
  ar_uber_account?: string;
  ar_doordash_account?: string;
  ar_grubhub_account?: string;
  ar_postmates_account?: string;
  cc_fees_account?: string;
  undeposited_funds_account?: string;
  cash_over_short_account?: string;
  gift_card_account?: string;
  open_orders_account?: string;
  paid_in_account?: string;
  cash_on_hand_account?: string;
  tips_account?: string;
  cogs_account?: string;
  alt_memos?: Record<string, string>;
  line_class_overrides?: Record<string, string>;
}

export interface JournalResult {
  lines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}

const round = (val: number) => Math.round(val * 100) / 100;

/**
 * Generates the journal entry lines from sales data and site configuration.
 */
export function generateJournalLines(salesData: SalesPacketData, siteMapping: SiteMappingConfig): JournalResult {
  const lines: JournalLine[] = [];

  const loc = (siteMapping.location || '').trim();
  const isRialto = /rialto/i.test(loc);
  const isBroadway = /broadway/i.test(loc);
  const isCentral = /central/i.test(loc);
  const isDowney = /downey/i.test(loc);
  const isSouthGate = /south\s*gate|souht\s*gate/i.test(loc);
  const isWestCovina = /west\s*covina/i.test(loc);
  const isHuntingtonPark = /huntington/i.test(loc);
  const isNorwalk = /norwalk/i.test(loc);
  const isHollywood = /hollywood/i.test(loc);
  const isSantaAna = /santa\s*ana/i.test(loc);
  const isSlauson = /slauson/i.test(loc);

  const dineInAcct = siteMapping.sales_dine_in_account || '40050';
  const uberSalesAcct = siteMapping.sales_uber_account || '40060';
  const ddSalesAcct = siteMapping.sales_doordash_account || '40062';
  const ghSalesAcct = siteMapping.sales_grubhub_account || '40063';
  const salesTaxAcct = siteMapping.sales_tax_account || '24001';
  const uberArAcct = siteMapping.ar_uber_account || '12050';
  const ddArAcct = siteMapping.ar_doordash_account || '12053';
  const ghArAcct = siteMapping.ar_grubhub_account || '12054';
  const ccFeesAcct = siteMapping.cc_fees_account || '51030';
  const undepositedAcct = siteMapping.undeposited_funds_account || '13200';
  const cashOverShortAcct = siteMapping.cash_over_short_account || '51050';
  const giftCardAcct = siteMapping.gift_card_account || '20500';
  const openOrdersAcct = siteMapping.open_orders_account || '12049';
  const tipsAcct = siteMapping.tips_account || '12100';

  const altMemos = siteMapping.alt_memos || {};
  const classOverrides = siteMapping.line_class_overrides || {};

  const addLine = (account: string, memo: string, debit: number, credit: number, sourceMemo: string, overrideKey?: string) => {
    if (debit === 0 && credit === 0) return;
    const finalMemo = (overrideKey && altMemos[overrideKey]) || altMemos[sourceMemo] || memo;
    const finalClass = (overrideKey && classOverrides[overrideKey]) || classOverrides[sourceMemo] || siteMapping.className;
    lines.push({
      account,
      memo: finalMemo,
      debit: round(debit),
      credit: round(credit),
      sourceMemo,
      location: siteMapping.location,
      className: finalClass,
    });
  };

  // --- CREDITS ---
  addLine(dineInAcct, 'For Here', 0, salesData.for_here_sales, 'Dining Option: For Here', 'for_here');
  if (salesData.toast_delivery_sales) {
    const toastDelAcct = isBroadway ? '53060' : dineInAcct;
    addLine(toastDelAcct, 'Toast Delivery Services', 0, salesData.toast_delivery_sales, 'Dining Option: Toast Delivery Services', 'toast_delivery');
  }
  addLine(dineInAcct, 'To Go', 0, salesData.to_go_sales, 'Dining Option: To Go', 'to_go');
  if (salesData.phone_sales) {
    addLine(dineInAcct, 'Phone', 0, salesData.phone_sales, 'Dining Option: Phone', 'phone');
  }
  if (salesData.curbside_sales) {
    addLine(dineInAcct, 'Curbside Pickup', 0, salesData.curbside_sales, 'Dining Option: Curbside Pickup', 'curbside');
  }
  if (salesData.drive_thru_sales) {
    addLine(dineInAcct, 'Drive Thru', 0, salesData.drive_thru_sales, 'Dining Option: Drive Thru', 'drive_thru');
  }
  if (salesData.kiosk_takeout_sales) {
    addLine(dineInAcct, 'Kiosk Take Out', 0, salesData.kiosk_takeout_sales, 'Dining Option: Kiosk Take Out', 'kiosk_takeout');
  }
  if (salesData.kiosk_dine_in_sales) {
    addLine(dineInAcct, 'Kiosk Dine In', 0, salesData.kiosk_dine_in_sales, 'Dining Option: Kiosk Dine In', 'kiosk_dine_in');
  }
  if (salesData.toast_online_sales) {
    addLine(dineInAcct, 'Toast Online', 0, salesData.toast_online_sales, 'Dining Option: Toast Online', 'toast_online');
  }
  if (salesData.online_ordering_takeout_sales) {
    const onlineTakeoutAcct = isCentral ? tipsAcct : dineInAcct;
    addLine(onlineTakeoutAcct, 'Online Ordering - Takeout', 0, salesData.online_ordering_takeout_sales, 'Dining Option: Online Ordering - Takeout', 'online_ordering_takeout');
  }
  addLine(uberSalesAcct, 'Uber Eats - Delivery', 0, salesData.uber_delivery_sales, 'Dining Option: Uber Eats - Delivery', 'uber_delivery');
  addLine(uberSalesAcct, 'Uber Eats Takeout', 0, salesData.uber_takeout_sales, 'Dining Option: Uber Eats Takeout', 'uber_takeout');
  addLine(ddSalesAcct, 'DoorDash - Takeout', 0, salesData.doordash_takeout_sales, 'Dining Option: DoorDash - Takeout', 'doordash_takeout');
  addLine(ddSalesAcct, 'DoorDash - Delivery', 0, salesData.doordash_delivery_sales, 'Dining Option: DoorDash - Delivery', 'doordash_delivery');

  const ghDelMemo = isRialto ? 'Grubhub - Delivery' : 'GrubHub Delivery';
  const ghDelSrc = isRialto ? 'Dining Option: Grubhub - Delivery' : 'Dining Option: GrubHub Delivery';
  addLine(ghSalesAcct, ghDelMemo, 0, salesData.grubhub_delivery_sales, ghDelSrc, 'grubhub_delivery');

  if (salesData.grubhub_takeout_sales) {
    addLine(ghSalesAcct, 'Grubhub - Takeout', 0, salesData.grubhub_takeout_sales, 'Dining Option: Grubhub - Takeout', 'grubhub_takeout');
  }

  if (salesData.delivery_service_charges) {
    const delChargeAcct = isDowney ? dineInAcct : ccFeesAcct;
    const delChargeMemo = isRialto ? 'Delivery Charge' : 'Delivery Service';
    addLine(delChargeAcct, delChargeMemo, 0, salesData.delivery_service_charges, 'Service Charge: Delivery Service', 'delivery_service');
  }
  if (salesData.deferred_gift_cards) {
    addLine(giftCardAcct, 'Deferred Sales - Gift Cards', 0, salesData.deferred_gift_cards, 'Deferred: Gift Cards', 'deferred_gift_cards');
  }

  addLine(uberArAcct, 'Tax Paid by Uber Eats', 0, salesData.tax_paid_by_uber, 'Tax Paid by Facilitator', 'tax_paid_by_uber');

  // Store-specific Sales Tax Memo & Source Memo matching Cohesion 1:1
  const rawTaxRateName = (siteMapping.sales_tax_rate_name || loc).trim();
  const effectiveTaxRateName = isBroadway && /^broadway\s+la$/i.test(rawTaxRateName)
    ? 'Broadway'
    : isCentral && /^central\s+la$/i.test(rawTaxRateName)
    ? 'Central'
    : isRialto && /^rialto$/i.test(rawTaxRateName)
    ? 'Rialto Tax Rate'
    : rawTaxRateName;
  const salesTaxMemo = isSlauson
    ? 'Slauson'
    : (isHuntingtonPark || isRialto || isSantaAna || isWestCovina)
    ? 'Sale Tax'
    : 'Sales Tax';
  addLine(salesTaxAcct, salesTaxMemo, 0, salesData.sales_tax, `Tax Rate: ${effectiveTaxRateName}`, 'sales_tax');

  const mktTaxMemo = isSlauson ? 'SALE TAX' : 'Marketplace Facilitator Taxes Not Paid';
  addLine(salesTaxAcct, mktTaxMemo, 0, salesData.marketplace_tax, 'Tax Rate: Marketplace Facilitator Taxes Not Paid', 'marketplace_tax');

  if (salesData.tips_payable) {
    addLine(tipsAcct, 'Tips/Grat Payable', 0, salesData.tips_payable, 'Tips Payable', 'tips_payable');
  }
  if (salesData.paid_in) {
    // Pagos de hoy por cheques de otra fecha comercial o pedidos futuros (Cohesion: Paid In Total (Deposits Received))
    const paidInAcct = siteMapping.paid_in_account || (
      (isHuntingtonPark || isNorwalk) ? cashOverShortAcct
      : isHollywood ? dineInAcct
      : openOrdersAcct
    );
    addLine(paidInAcct, 'Paid In Total (Deposits Received)', 0, salesData.paid_in, 'Paid In Totals', 'paid_in');
  }
  if (salesData.cash_in && salesData.cash_in > 0) {
    // Cohesion: Movimientos de entrada de efectivo a gaveta (Toast Cash Management) van a cuenta 12100 como Crédito
    addLine(tipsAcct, 'Cash In', 0, salesData.cash_in, 'Cash In: Drawer', 'cash_in');
  }

  // --- DEBITS ---
  if (salesData.gift_card_redemption) {
    addLine(giftCardAcct, 'Gift Card Redemption', salesData.gift_card_redemption, 0, 'Payment: Gift Card Redeemed', 'gift_card_redemption');
  }
  addLine(siteMapping.bank_account, 'EBT', salesData.ebt_amount, 0, 'Payment Other: EBT', 'ebt');
  addLine(uberArAcct, 'Uber Eats', salesData.uber_payment, 0, 'Payment Other: Uber Eats', 'uber_payment');
  addLine(ddArAcct, 'DoorDash', salesData.doordash_payment, 0, 'Payment Other: DoorDash', 'doordash_payment');

  const ghPayMemo = isRialto ? 'Grubhub' : 'GrubHub';
  const ghPaySrc = isRialto ? 'Payment Other: Grubhub' : 'Payment Other: GrubHub';
  addLine(ghArAcct, ghPayMemo, salesData.grubhub_payment, 0, ghPaySrc, 'grubhub_payment');

  if (salesData.deposits_collected) {
    // Cohesion: Ordenes abiertas y depositos cobrados (> 0) se registran en Debito en cuenta 12049;
    // sobrepagos de cheques (< 0, ej. descuento Taco Tuesday aplicado tras cobro con tarjeta) se registran en Credito en cuenta 12049.
    const depDr = salesData.deposits_collected > 0 ? salesData.deposits_collected : 0;
    const depCr = salesData.deposits_collected < 0 ? Math.abs(salesData.deposits_collected) : 0;
    addLine(openOrdersAcct, 'Deposit Sales Collected & Open Orders', depDr, depCr, 'Deposit Sales Collected', 'deposits_collected');
  }
  addLine(siteMapping.bank_account, 'Credit Card Deposit', salesData.credit_card_deposit, 0, 'Combined Credit Card Deposit', 'cc_deposit');
  addLine(ccFeesAcct, 'Credit Card Fees', salesData.credit_card_fees, 0, 'Credit Cards: Merchant Fees', 'cc_fees');
  if (salesData.credit_card_other_deductions) {
    // Cohesion: Broadway y Central -> 12100; Downey, Rialto, South Gate, West Covina -> 40050; resto -> 51030
    const otherDedAcct = (isBroadway || isCentral)
      ? tipsAcct
      : (isDowney || isRialto || isSouthGate || isWestCovina)
      ? dineInAcct
      : ccFeesAcct;
    addLine(otherDedAcct, 'Credit Card Other Deductions', salesData.credit_card_other_deductions, 0, 'Credit Cards: Other Deductions', 'cc_other_deductions');
  }
  addLine(undepositedAcct, 'Deposit To Bank', salesData.cash_deposits, 0, 'Cash Deposits', 'cash_deposit');

  // --- CASH PAYOUTS (Toast POS Cash Management Pay Outs) ---
  if (salesData.cash_payouts && salesData.cash_payouts.length > 0) {
    const cogsAcct = (!siteMapping.cogs_account || siteMapping.cogs_account === '53060') ? '50006' : siteMapping.cogs_account;
    for (const payout of salesData.cash_payouts) {
      if (payout.amount > 0) {
        const reasonStr = payout.reason || 'COGS-Materials and Supplies';
        const commentStr = payout.comment && payout.comment.trim() ? payout.comment.trim() : 'Pay Out Comment Not Entered';
        addLine(cogsAcct, `${reasonStr} : ${commentStr}`, payout.amount, 0, `Cash Payout: ${reasonStr}`, 'cash_payout');
      }
    }
  }

  // --- CASH OUT & TIP OUT (Toast POS Cash Management Drawer Out / Tips Out) ---
  if (salesData.cash_out && salesData.cash_out > 0) {
    addLine(tipsAcct, 'Cash Out', salesData.cash_out, 0, 'Cash Out: Drawer', 'cash_out');
  }
  if (salesData.tip_out && salesData.tip_out > 0) {
    addLine(tipsAcct, 'Tip Out', salesData.tip_out, 0, 'Cash Payout: Tips', 'tip_out');
  }

  // --- CASH OVER / SHORT ---
  const expectedCashFromSales = calculateExpectedCash(salesData);
  const cashPayoutsTotal = salesData.cash_payouts_total || (salesData.cash_payouts?.reduce((s, p) => s + (p.amount || 0), 0) || 0);
  const cashIn = salesData.cash_in || 0;
  const cashOut = salesData.cash_out || 0;
  const tipOut = salesData.tip_out || 0;
  const expectedCashDeposit = round(expectedCashFromSales + cashIn - cashOut - tipOut - cashPayoutsTotal);
  const cashDiff = round(salesData.cash_deposits - expectedCashDeposit);

  const effectiveCashOverShortAcct = isRialto && (!siteMapping.cash_over_short_account || siteMapping.cash_over_short_account === '51050')
    ? tipsAcct
    : cashOverShortAcct;

  if (cashDiff > 0) {
    // Sobrante (Over): Credit
    addLine(effectiveCashOverShortAcct, 'Over/(Short)', 0, cashDiff, 'Calculated', 'cash_over_short');
  } else if (cashDiff < 0) {
    // Faltante (Short): Debit
    addLine(effectiveCashOverShortAcct, 'Over/(Short)', Math.abs(cashDiff), 0, 'Calculated', 'cash_over_short');
  }

  let totalDebits = 0;
  let totalCredits = 0;

  for (const line of lines) {
    totalDebits += line.debit;
    totalCredits += line.credit;
  }

  totalDebits = round(totalDebits);
  totalCredits = round(totalCredits);

  // Penny plug: If there is a small rounding difference (up to 5 cents) between debits and credits
  // caused by sum of individually rounded items, balance it via the Over/(Short) line so QuickBooks Online
  // never rejects with "unbalanced journal"
  const pennyDiff = round(totalDebits - totalCredits);
  if (Math.abs(pennyDiff) > 0 && Math.abs(pennyDiff) <= 0.05) {
    const cashOverShortLine = lines.find(l => l.sourceMemo === 'Calculated' || l.sourceMemo === 'Penny Rounding Balancing');
    if (cashOverShortLine) {
      const netLine = round((cashOverShortLine.debit - cashOverShortLine.credit) - pennyDiff);
      if (netLine > 0) {
        cashOverShortLine.debit = netLine;
        cashOverShortLine.credit = 0;
      } else if (netLine < 0) {
        cashOverShortLine.debit = 0;
        cashOverShortLine.credit = Math.abs(netLine);
      } else {
        const idx = lines.indexOf(cashOverShortLine);
        if (idx !== -1) lines.splice(idx, 1);
      }
    } else {
      lines.push({
        account: effectiveCashOverShortAcct,
        memo: 'Over/(Short)',
        debit: pennyDiff < 0 ? Math.abs(pennyDiff) : 0,
        credit: pennyDiff > 0 ? pennyDiff : 0,
        sourceMemo: 'Calculated',
        location: siteMapping.location,
        className: siteMapping.className,
      });
    }
    totalDebits = round(lines.reduce((sum, l) => sum + l.debit, 0));
    totalCredits = round(lines.reduce((sum, l) => sum + l.credit, 0));
  }

  return {
    lines,
    totalDebits,
    totalCredits,
    isBalanced: totalDebits === totalCredits
  };
}

const STORE_CODE_MAP: Record<string, string> = {
  'HUNTINGTON PARK': 'HP',
  'SAN BERNARDINO': 'SB',
  'WEST COVINA': 'WCOV',
  'SANTA ANA': 'SANA',
  'LOS ANGELES': 'LA',
  'LA CENTRAL': 'LACE',
  'LONG BEACH': 'LB',
  'SOUTH GATE': 'SG',
  'PICO RIVERA': 'PR',
  'BELL': 'BELL',
  'AZUSA': 'AZUSA',
  'LYNWOOD': 'LYNW',
  'WHITTIER': 'WHIT',
  'NORWALK': 'NORW',
  'PARAMOUNT': 'PARA',
  'VAN NUYS': 'VANN',
};

/**
 * Formats the document number for QuickBooks.
 * Ensures the string never exceeds QuickBooks Online's strict 21-character limit.
 * e.g., 'AZUSA-20260831', 'HP-20260831'
 */
export function formatDocNumber(storeName: string, date: string): string {
  const cleanDate = date.replace(/-/g, '');
  const rawName = storeName.replace(/^Tacos Gavilan\s*-\s*/i, '').replace(/^Tacos Gavilan\s*/i, '').trim().toUpperCase();
  const code = STORE_CODE_MAP[rawName] || rawName.replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const doc = `${code}-${cleanDate}`;
  return doc.slice(0, 21);
}

/**
 * Calculates the expected cash based on gross receipts and non-cash payments.
 * Formula: Total Gross Receipts - Non-Cash Payments = Expected Cash
 */
export function calculateExpectedCash(salesData: SalesPacketData): number {
  const sumDiningOptions = round(
    (salesData.for_here_sales || 0) +
    (salesData.to_go_sales || 0) +
    (salesData.phone_sales || 0) +
    (salesData.curbside_sales || 0) +
    (salesData.drive_thru_sales || 0) +
    (salesData.kiosk_dine_in_sales || 0) +
    (salesData.kiosk_takeout_sales || 0) +
    (salesData.toast_online_sales || 0) +
    (salesData.online_ordering_takeout_sales || 0) +
    (salesData.toast_delivery_sales || 0) +
    (salesData.uber_delivery_sales || 0) +
    (salesData.uber_takeout_sales || 0) +
    (salesData.doordash_takeout_sales || 0) +
    (salesData.doordash_delivery_sales || 0) +
    (salesData.grubhub_delivery_sales || 0) +
    (salesData.grubhub_takeout_sales || 0) +
    (salesData.delivery_service_charges || 0)
  );
  const netSales = sumDiningOptions > 0 ? sumDiningOptions : (salesData.net_sales || 0);

  const totalGrossReceipts = round(
    netSales + 
    (salesData.sales_tax || 0) +
    (salesData.marketplace_tax || 0) +
    (salesData.tax_paid_by_uber || 0) + 
    (salesData.deferred_gift_cards || 0) + 
    (salesData.tips_payable || 0) +
    (salesData.paid_in || 0)
  );
  const nonCashPayments = round(
    (salesData.credit_card_deposit || 0) +
    (salesData.credit_card_fees || 0) +
    (salesData.credit_card_other_deductions || 0) +
    (salesData.uber_payment || 0) +
    (salesData.doordash_payment || 0) +
    (salesData.grubhub_payment || 0) +
    (salesData.ebt_amount || 0) +
    (salesData.gift_card_redemption || 0) +
    (salesData.deposits_collected || 0)
  );
  return round(totalGrossReceipts - nonCashPayments);
}
