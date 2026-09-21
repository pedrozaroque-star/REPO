"""Extract auditable Cingular PDF evidence; never writes payroll records.
Match the printed SITE against the existing RONOS catalog, never filename prefixes.
Retain unknown payment classification and missing identifiers rather than inventing them.
All cover, summary and weekly totals must reconcile before atomically replacing evidence.
"""
from pathlib import Path
from decimal import Decimal
from datetime import datetime, timedelta
import hashlib, json, re, argparse
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ['payRate','grossPay','billRate','billedAmount','credit','totalHours','regularHours','salaryHours','overtimeHours','doubleTimeHours','vacationHours','sickHours','mealHours','bereavementHours','unpaidHours','holidayHours']
NUMBER = r'-?\d[\d,]*(?:\.\d+)?'
IDENTIFIER = r'(?:\d+|EMP\d+)'


def catalog():
    source = (ROOT / 'lib/ronos-api.ts').read_text(encoding='utf-8')
    rows = re.findall(r"tegName: '([^']+)'.*?ronosCompanyId: (\d+), ronosName: '([^']+)'", source)
    result = {}
    for name, company, remote_name in rows:
        for label in [name, remote_name.removeprefix('TEG - ').removeprefix('Tacos Gavilan - ')]:
            result[label.casefold()] = int(company)
    # Printed geographic aliases, not employee/payment constants. Santa Fe's cover
    # explicitly states Huntington Park; Vernon is the catalog's warehouse location.
    result['slauson'] = result['Slauson'.casefold()]
    result['santa fe'] = result['huntington park']
    result['vernon'] = result['la bodega']
    return result


def extract(file, companies):
    pages = [p.extract_text() or '' for p in PdfReader(file).pages]
    text = '\n'.join(pages)
    site_match = re.search(r'SITE:\s*TEG - ([^\n]+)', pages[0])
    if not site_match: raise ValueError(f'{file.name}: missing printed SITE')
    site = site_match[1].strip()
    if site.casefold() not in companies: raise ValueError(f'{file.name}: unknown printed SITE {site}')
    if site == 'Santa Fe' and 'Huntington Park, CA' not in pages[0]:
        raise ValueError(f'{file.name}: Santa Fe address no longer confirms Huntington Park')
    invoice_id_match = re.search(r'INVOICE DATE Invoice ID\s*\d{2}/\d{2}/\d{4}\s+(\S+)', pages[0])
    if not invoice_id_match or invoice_id_match[1] != file.stem.removeprefix('invoice-'):
        raise ValueError(f'{file.name}: filename and printed invoice ID differ')
    weeks = sorted(set(datetime.strptime(x, '%m/%d/%Y').date() for x in re.findall(r'WEEK WORKED:\s*(\d{2}/\d{2}/\d{4})', text)))
    if not weeks or any((b-a).days != 7 for a,b in zip(weeks,weeks[1:])):
        raise ValueError(f'{file.name}: absent/discontinuous weekly period')
    rows, weekly_amounts = [], []
    for page_no, page in enumerate(pages, 1):
        if 'Summary Report' in page:
            for line in page.splitlines():
                m = re.match(r'^(.+?)\s+TEG - (.+?)\s+(' + NUMBER + r'(?:\s+' + NUMBER + r'){15})\s*$', line)
                if not m: continue
                if m[2].strip() != site: raise ValueError(f'{file.name}: row SITE differs from cover')
                identity = re.match(r'^(' + IDENTIFIER + r')\s+(.+)$', m[1])
                employee_number, full_name = (identity[1], identity[2]) if identity else (None, m[1])
                values = [Decimal(x.replace(',','')) for x in m[3].split()]
                rows.append({'employeeNumber': employee_number, 'identifierNamespace': 'printed_emp_id' if employee_number else 'missing',
                    'fullName': full_name.strip(), 'page':page_no, **dict(zip(FIELDS,map(float,values)))})
        else:
            for line in page.splitlines():
                # A weekly row ends in bill rate, four hour/cost pairs and total cost.
                m = re.match(r'^.+?\s+\d{2}/\d{2}/\d{4}\s+.+?\s+(' + NUMBER + r'(?:\s+' + NUMBER + r'){9})\s*$', line.replace('$', ''))
                if m: weekly_amounts.append(Decimal(m[1].split()[-1].replace(',','')))
    ids = [r['employeeNumber'] for r in rows if r['employeeNumber']]
    if not rows or len(set(ids)) != len(ids): raise ValueError(f'{file.name}: absent/duplicate summary identifiers')
    summary_total = re.search(r'^TOTALS\s+([\d.,]+)\s+([\d.,]+)', text, re.M)
    invoice_total = re.search(r'TOTAL INVOICE\s+\$([\d,.]+)', text)
    if not summary_total or not invoice_total: raise ValueError(f'{file.name}: missing totals')
    gross, billed = [Decimal(x.replace(',','')) for x in summary_total.groups()]
    for actual, expected, label in [
        (sum(Decimal(str(r['grossPay'])) for r in rows),gross,'gross summary'),
        (sum(Decimal(str(r['billedAmount'])) for r in rows),billed,'bill summary'),
        (billed,Decimal(invoice_total[1].replace(',','')),'cover'),
        (sum(weekly_amounts),billed,'weekly detail')]:
        if actual != expected: raise ValueError(f'{file.name}: {label} mismatch {actual} != {expected}')
    return {'invoiceId':invoice_id_match[1], 'companyId':companies[site.casefold()], 'siteName':site,
        'sourceFile':file.name, 'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),
        'periodStart':str(weeks[0]-timedelta(days=6)), 'periodEnd':str(weeks[-1]),
        'weekEndings':[str(w) for w in weeks], 'mode':'unclassified',
        'grossPay':float(gross), 'billedAmount':float(billed), 'employees':rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate all PDFs without writing evidence')
    args = parser.parse_args()
    invoices = [extract(file, catalog()) for file in sorted(ROOT.glob('invoice-*.pdf'))]
    if not invoices: raise ValueError('No invoice PDFs found; existing evidence preserved')
    if not args.check:
        target = ROOT/'data'/'payroll'/'invoice-evidence.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        pending = target.with_suffix('.json.tmp')
        pending.write_text(json.dumps(invoices,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        pending.replace(target)
    print(json.dumps([{'invoice':i['invoiceId'],'companyId':i['companyId'], 'period':[i['periodStart'],i['periodEnd']],
        'employees':len(i['employees']),'total':i['billedAmount']} for i in invoices],indent=2))


if __name__ == '__main__': main()


