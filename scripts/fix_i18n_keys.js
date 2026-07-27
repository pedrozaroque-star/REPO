const fs = require('fs');
let content = fs.readFileSync('app/inventory/uniforms/page.tsx', 'utf8');

const replacements = {
  // Stock table headers
  "uniforms.table.item": "uniforms.stock.item",
  "uniforms.table.size": "uniforms.stock.size",
  "uniforms.table.qty": "uniforms.stock.qty_on_hand",
  "uniforms.table.min_stock": "uniforms.stock.min_stock",
  "uniforms.table.status": "uniforms.stock.status",
  
  // Executive matrix headers
  "uniforms.table.store": "uniforms.matrix.store_name",
  "uniforms.table.stock_count": "uniforms.matrix.stock_count",
  "uniforms.table.stock_value": "uniforms.matrix.stock_value",
  "uniforms.table.last_audit": "uniforms.matrix.last_audit",
  
  // History table headers
  "uniforms.table.date": "uniforms.history.date",
  "uniforms.table.type": "uniforms.history.type",
  "uniforms.table.item_size": "uniforms.history.item",
  "uniforms.table.employee": "uniforms.history.employee",
  "uniforms.table.amount": "uniforms.history.amount",
  "uniforms.table.created_by": "uniforms.history.created_by",
  
  // Groups
  "uniforms.group.red_team": "uniforms.stock.red_team",
  "uniforms.group.black_leadership": "uniforms.stock.black_team",
  
  // Audit
  "uniforms.audit.start": "uniforms.stock.audit_mode",
  "uniforms.audit.save": "uniforms.stock.save_audit",
  "uniforms.audit.reason_placeholder": "uniforms.stock.reason",
  
  // Setup wizard
  "uniforms.setup.title": "uniforms.wizard.title",
  "uniforms.setup.description": "uniforms.wizard.description",
  "uniforms.setup.save_button": "uniforms.wizard.save",
  
  // Status badges
  "uniforms.status.ok": "uniforms.stock.ok",
  "uniforms.status.low": "uniforms.stock.low",
  "uniforms.status.out": "uniforms.stock.out",
  "uniforms.status.active": "uniforms.matrix.active",
  "uniforms.status.pending_setup": "uniforms.matrix.pending",
  
  // Executive
  "uniforms.executive.stores_overview": "uniforms.matrix.title",
  
  // Pricing
  "uniforms.pricing.edit": "uniforms.stock.edit_pricing",
  
  // Errors -> toast.error
  "uniforms.error.load_initial": "uniforms.toast.error",
  "uniforms.error.load_stock": "uniforms.toast.error",
  "uniforms.error.load_dashboard": "uniforms.toast.error",
  "uniforms.error.save_setup": "uniforms.toast.error",
  "uniforms.error.reason_required": "uniforms.toast.error",
  "uniforms.error.save_audit": "uniforms.toast.error",
  "uniforms.error.save_pricing": "uniforms.toast.error",
  "uniforms.error.emp_name_required": "uniforms.toast.error",
  "uniforms.error.insufficient_stock": "uniforms.toast.no_stock",
  "uniforms.error.transaction_failed": "uniforms.toast.error",
  "uniforms.error.empty_reception": "uniforms.toast.error",
  "uniforms.error.reception_failed": "uniforms.toast.error",
  "uniforms.error.load_history": "uniforms.toast.error",
  
  // Misc
  "uniforms.never": "uniforms.matrix.no_audit",
  "uniforms.select_store_prompt": "uniforms.select_store",
  "uniforms.toast.setup_success": "uniforms.toast.initial_saved",
  "uniforms.toast.audit_success": "uniforms.toast.audit_saved",
  
  // KPI stores_active
  "uniforms.kpi.stores_active": "uniforms.kpi.active_stores",
};

let count = 0;
for (const [oldKey, newKey] of Object.entries(replacements)) {
  const search = `t('${oldKey}')`;
  const replace = `t('${newKey}')`;
  const occurrences = content.split(search).length - 1;
  if (occurrences > 0) {
    content = content.split(search).join(replace);
    count += occurrences;
    console.log(`  ${oldKey} -> ${newKey} (${occurrences}x)`);
  }
}

fs.writeFileSync('app/inventory/uniforms/page.tsx', content);
console.log(`\nDone! Replaced ${count} i18n key references.`);
