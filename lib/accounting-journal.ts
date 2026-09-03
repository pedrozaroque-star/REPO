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
  toast_online_sales?: number;
  uber_delivery_sales: number;
  uber_takeout_sales: number;
  doordash_takeout_sales: number;
  doordash_delivery_sales: number;
  grubhub_delivery_sales: number;
  grubhub_takeout_sales?: number;

  tax_paid_by_uber: number;
  sales_tax: number;
  marketplace_tax: number;

  ebt_amount: number;
  uber_payment: number;
  doordash_payment: number;
  grubhub_payment: number;

  credit_card_deposit: number;
  credit_card_fees: number;
  cash_deposits: number;
}

export interface SiteMappingConfig {
  location: string;
  className: string;
  bank_account: string;
  sales_tax_rate_name: string;
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
  addLine('40050', 'For Here', 0, salesData.for_here_sales, 'Dining Option: For Here');
  if (salesData.toast_online_sales) {
    addLine('40050', 'Toast Online', 0, salesData.toast_online_sales, 'Dining Option: Toast Online');
  }
  addLine('40050', 'To Go', 0, salesData.to_go_sales, 'Dining Option: To Go');
  addLine('40060', 'Uber Eats - Delivery', 0, salesData.uber_delivery_sales, 'Dining Option: Uber Eats - Delivery');
  addLine('40060', 'Uber Eats Takeout', 0, salesData.uber_takeout_sales, 'Dining Option: Uber Eats Takeout');
  addLine('40062', 'DoorDash - Takeout', 0, salesData.doordash_takeout_sales, 'Dining Option: DoorDash - Takeout');
  addLine('40062', 'DoorDash - Delivery', 0, salesData.doordash_delivery_sales, 'Dining Option: DoorDash - Delivery');
  addLine('40063', 'GrubHub Delivery', 0, salesData.grubhub_delivery_sales, 'Dining Option: GrubHub Delivery');
  if (salesData.grubhub_takeout_sales) {
    addLine('40063', 'Grubhub - Takeout', 0, salesData.grubhub_takeout_sales, 'Dining Option: Grubhub - Takeout');
  }
  
  addLine('12050', 'Tax Paid by Uber Eats', 0, salesData.tax_paid_by_uber, 'Tax Paid by Facilitator');
  addLine('24001', 'Sales Tax', 0, salesData.sales_tax, `Tax Rate: ${siteMapping.sales_tax_rate_name}`);
  addLine('24001', 'Marketplace Facilitator Taxes', 0, salesData.marketplace_tax, 'Tax Rate: Marketplace Facilitator Taxes Not Paid');

  // --- DEBITS ---
  addLine(siteMapping.bank_account, 'EBT', salesData.ebt_amount, 0, 'Payment Other: EBT');
  addLine('12050', 'Uber Eats', salesData.uber_payment, 0, 'Payment Other: Uber Eats');
  addLine('12053', 'DoorDash', salesData.doordash_payment, 0, 'Payment Other: DoorDash');
  addLine('12054', 'GrubHub', salesData.grubhub_payment, 0, 'Payment Other: GrubHub');
  addLine(siteMapping.bank_account, 'Credit Card Deposit', salesData.credit_card_deposit, 0, 'Combined Credit Card Deposit');
  addLine('51030', 'Credit Card Fees', salesData.credit_card_fees, 0, 'Credit Cards: Merchant Fees');
  addLine('13200', 'Deposit To Bank', salesData.cash_deposits, 0, 'Cash Deposits');

  // --- CASH OVER / SHORT (51050) ---
  // If actual cash deposit differs from expected cash, balance with 51050
  const expectedCash = calculateExpectedCash(salesData);
  const cashDiff = round(salesData.cash_deposits - expectedCash);

  if (cashDiff > 0) {
    // Sobrante (Over): Credit 51050
    addLine('51050', 'Cash Over/(Short)', 0, cashDiff, 'Cash Overage');
  } else if (cashDiff < 0) {
    // Faltante (Short): Debit 51050
    addLine('51050', 'Cash Over/(Short)', Math.abs(cashDiff), 0, 'Cash Shortage');
  }

  let totalDebits = 0;
  let totalCredits = 0;

  for (const line of lines) {
    totalDebits += line.debit;
    totalCredits += line.credit;
  }

  totalDebits = round(totalDebits);
  totalCredits = round(totalCredits);

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
  const totalGrossReceipts = round(salesData.net_sales + salesData.total_taxes);
  const nonCashPayments = round(
    salesData.credit_card_deposit +
    salesData.credit_card_fees +
    salesData.uber_payment +
    salesData.doordash_payment +
    salesData.grubhub_payment +
    salesData.ebt_amount
  );
  return round(totalGrossReceipts - nonCashPayments);
}
