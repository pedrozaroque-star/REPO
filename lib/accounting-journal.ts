/**
 * @module accounting-journal
 * @description Core business logic for generating balanced journal entries from POS sales data.
 * Replaces the legacy Cohesion module by matching its exact output structure and account mappings.
 * @businessRules
 * - Business day starts at 6:00 AM, timezone America/Los_Angeles.
 * - Only generates lines with amounts > 0.
 * - Must output a balanced journal (Total Debits === Total Credits).
 * - Exact account mapping matching the legacy system.
 * @dataFlow POS Sales Data -> generateJournalLines -> JournalResult -> QBO API
 * @notes Uses Math.round(x * 100) / 100 for all monetary calculations to avoid floating point precision issues.
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
  drive_thru_sales?: number;
  kiosk_dine_in_sales?: number;
  kiosk_takeout_sales?: number;
  toast_online_sales?: number;
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
  cash_on_hand_account?: string;
  tips_account?: string;
  cogs_account?: string;
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

  const addLine = (account: string, memo: string, debit: number, credit: number, sourceMemo: string) => {
    if (debit === 0 && credit === 0) return;
    lines.push({
      account,
      memo,
      debit: round(debit),
      credit: round(credit),
      sourceMemo,
      location: siteMapping.location,
      className: siteMapping.className,
    });
  };

  // --- CREDITS ---
  addLine(dineInAcct, 'For Here', 0, salesData.for_here_sales, 'Dining Option: For Here');
  if (salesData.toast_delivery_sales) {
    addLine(dineInAcct, 'Toast Delivery Services', 0, salesData.toast_delivery_sales, 'Dining Option: Toast Delivery Services');
  }
  addLine(dineInAcct, 'To Go', 0, salesData.to_go_sales, 'Dining Option: To Go');
  if (salesData.drive_thru_sales) {
    addLine(dineInAcct, 'Drive Thru', 0, salesData.drive_thru_sales, 'Dining Option: Drive Thru');
  }
  if (salesData.kiosk_takeout_sales) {
    addLine(dineInAcct, 'Kiosk Take Out', 0, salesData.kiosk_takeout_sales, 'Dining Option: Kiosk Take Out');
  }
  if (salesData.kiosk_dine_in_sales) {
    addLine(dineInAcct, 'Kiosk Dine In', 0, salesData.kiosk_dine_in_sales, 'Dining Option: Kiosk Dine In');
  }
  if (salesData.toast_online_sales) {
    addLine(dineInAcct, 'Toast Online', 0, salesData.toast_online_sales, 'Dining Option: Toast Online');
  }
  addLine(uberSalesAcct, 'Uber Eats - Delivery', 0, salesData.uber_delivery_sales, 'Dining Option: Uber Eats - Delivery');
  addLine(uberSalesAcct, 'Uber Eats Takeout', 0, salesData.uber_takeout_sales, 'Dining Option: Uber Eats Takeout');
  addLine(ddSalesAcct, 'DoorDash - Takeout', 0, salesData.doordash_takeout_sales, 'Dining Option: DoorDash - Takeout');
  addLine(ddSalesAcct, 'DoorDash - Delivery', 0, salesData.doordash_delivery_sales, 'Dining Option: DoorDash - Delivery');
  addLine(ghSalesAcct, 'GrubHub Delivery', 0, salesData.grubhub_delivery_sales, 'Dining Option: GrubHub Delivery');
  if (salesData.grubhub_takeout_sales) {
    addLine(ghSalesAcct, 'Grubhub - Takeout', 0, salesData.grubhub_takeout_sales, 'Dining Option: Grubhub - Takeout');
  }
  
  if (salesData.delivery_service_charges) {
    addLine(ccFeesAcct, 'Delivery Service', 0, salesData.delivery_service_charges, 'Service Charge: Delivery Service');
  }
  if (salesData.deferred_gift_cards) {
    addLine(giftCardAcct, 'Deferred Sales - Gift Cards', 0, salesData.deferred_gift_cards, 'Deferred Sales: Gift Cards');
  }

  addLine(uberArAcct, 'Tax Paid by Uber Eats', 0, salesData.tax_paid_by_uber, 'Tax Paid by Facilitator');
  addLine(salesTaxAcct, 'Sales Tax', 0, salesData.sales_tax, `Tax Rate: ${siteMapping.sales_tax_rate_name}`);
  addLine(salesTaxAcct, 'Marketplace Facilitator Taxes', 0, salesData.marketplace_tax, 'Tax Rate: Marketplace Facilitator Taxes Not Paid');
  if (salesData.tips_payable) {
    addLine(tipsAcct, 'Tips/Grat Payable', 0, salesData.tips_payable, 'Tips Payable');
  }
  if (salesData.deposits_collected) {
    addLine(openOrdersAcct, 'Deposit Sales Collected & Open Orders', 0, salesData.deposits_collected, 'Deposit Sales Collected');
  }
  if (salesData.paid_in) {
    // Pagos de hoy por cheques de otra fecha comercial o pedidos futuros (Cohesion: Paid In Total (Deposits Received) -> cuenta openOrdersAcct)
    addLine(openOrdersAcct, 'Paid In Total (Deposits Received)', 0, salesData.paid_in, 'Paid In Totals');
  }

  // --- DEBITS ---
  if (salesData.gift_card_redemption) {
    addLine(giftCardAcct, 'Gift Card Redemption', salesData.gift_card_redemption, 0, 'Payment Other: Gift Card Redeemed');
  }
  addLine(siteMapping.bank_account, 'EBT', salesData.ebt_amount, 0, 'Payment Other: EBT');
  addLine(uberArAcct, 'Uber Eats', salesData.uber_payment, 0, 'Payment Other: Uber Eats');
  addLine(ddArAcct, 'DoorDash', salesData.doordash_payment, 0, 'Payment Other: DoorDash');
  addLine(ghArAcct, 'GrubHub', salesData.grubhub_payment, 0, 'Payment Other: GrubHub');
  addLine(siteMapping.bank_account, 'Credit Card Deposit', salesData.credit_card_deposit, 0, 'Combined Credit Card Deposit');
  addLine(ccFeesAcct, 'Credit Card Fees', salesData.credit_card_fees, 0, 'Credit Cards: Merchant Fees');
  if (salesData.credit_card_other_deductions) {
    // Cohesion (verificado 10/3): Broadway y Central registran las Other Deductions en tipsAcct (12100); otras tiendas en ccFeesAcct (51030)
    const otherDedAcct = /broadway|central/i.test(siteMapping.location || '') ? tipsAcct : ccFeesAcct;
    addLine(otherDedAcct, 'Credit Card Other Deductions', salesData.credit_card_other_deductions, 0, 'Credit Cards: Other Deductions');
  }
  addLine(undepositedAcct, 'Deposit To Bank', salesData.cash_deposits, 0, 'Cash Deposits');

  // --- CASH OVER / SHORT ---
  // If actual cash deposit differs from expected cash, balance with cashOverShortAcct
  const expectedCash = calculateExpectedCash(salesData);
  const cashDiff = round(salesData.cash_deposits - expectedCash);

  if (cashDiff > 0) {
    // Sobrante (Over): Credit
    addLine(cashOverShortAcct, 'Cash Over/(Short)', 0, cashDiff, 'Cash Overage');
  } else if (cashDiff < 0) {
    // Faltante (Short): Debit (Cohesion usa memo: 'Over/(Short)' y source memo: 'Calculated')
    addLine(cashOverShortAcct, 'Over/(Short)', Math.abs(cashDiff), 0, 'Calculated');
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
  // caused by sum of individually rounded items, balance it via cashOverShortAcct so QuickBooks Online
  // never rejects with "unbalanced journal"
  const pennyDiff = round(totalDebits - totalCredits);
  if (Math.abs(pennyDiff) > 0 && Math.abs(pennyDiff) <= 0.05) {
    const cashOverShortLine = lines.find(l => l.account === cashOverShortAcct);
    if (cashOverShortLine) {
      if (pennyDiff > 0) {
        // Debits exceed credits: add difference to credit
        cashOverShortLine.credit = round(cashOverShortLine.credit + pennyDiff);
      } else {
        // Credits exceed debits: add difference to debit
        cashOverShortLine.debit = round(cashOverShortLine.debit + Math.abs(pennyDiff));
      }
    } else {
      lines.push({
        account: cashOverShortAcct,
        memo: 'Cash Over/(Short)',
        debit: pennyDiff < 0 ? Math.abs(pennyDiff) : 0,
        credit: pennyDiff > 0 ? pennyDiff : 0,
        sourceMemo: 'Penny Rounding Balancing',
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
    (salesData.drive_thru_sales || 0) +
    (salesData.kiosk_dine_in_sales || 0) +
    (salesData.kiosk_takeout_sales || 0) +
    (salesData.toast_online_sales || 0) +
    (salesData.toast_delivery_sales || 0) +
    (salesData.uber_delivery_sales || 0) +
    (salesData.uber_takeout_sales || 0) +
    (salesData.doordash_takeout_sales || 0) +
    (salesData.doordash_delivery_sales || 0) +
    (salesData.grubhub_delivery_sales || 0) +
    (salesData.grubhub_takeout_sales || 0)
  );
  const netSales = sumDiningOptions > 0 ? sumDiningOptions : salesData.net_sales;

  const totalGrossReceipts = round(
    netSales + 
    (salesData.sales_tax || 0) +
    (salesData.marketplace_tax || 0) +
    (salesData.tax_paid_by_uber || 0) + 
    (salesData.deferred_gift_cards || 0) + 
    (salesData.delivery_service_charges || 0) +
    (salesData.tips_payable || 0) +
    (salesData.deposits_collected || 0) +
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
    (salesData.gift_card_redemption || 0)
  );
  return round(totalGrossReceipts - nonCashPayments);
}
