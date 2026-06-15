import re
import os

page_path = r"c:\Users\pedro\Desktop\teg-modernizado\app\roles\page.tsx"
if not os.path.exists(page_path):
    print("Page file not found")
    exit(1)

content = open(page_path, 'r', encoding='utf-8').read()

# We need to find the showActivitiesModal block.
# Let's locate the start of showActivitiesModal and showStationActivitiesModal in the file.
start_idx = content.find("{showActivitiesModal && (")
if start_idx == -1:
    print("Could not find start of showActivitiesModal block")
    exit(1)

# Find the start of the next modal which is showStationActivitiesModal
next_modal_idx = content.find("{showStationActivitiesModal && (")
if next_modal_idx == -1:
    print("Could not find start of showStationActivitiesModal block")
    exit(1)

# Backtrack from next_modal_idx to find the closing parentheses/brace of showActivitiesModal
# We look for '        )}' which terminates the AnimatePresence or showActivitiesModal block
# Let's look at the lines around the end of showActivitiesModal
# It should end with '        )}' followed by some empty lines/whitespace.
target_end_pattern = re.compile(r'\s*\}\)\s*\}\s*</AnimatePresence>\s*', re.MULTILINE)
# Or let's search backwards for the nearest ')}' before next_modal_idx
block_end_idx = content.rfind(")}", 0, next_modal_idx)
if block_end_idx == -1:
    print("Could not find end of showActivitiesModal block")
    exit(1)

# Adjust block_end_idx to include the ')}'
block_end_idx += 2

original_block = content[start_idx : block_end_idx]
print(f"Original block length: {len(original_block)}")

# Define the clean replacement modal content
clean_replacement = """{showActivitiesModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 md:p-8 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.9, y: 20 }} 
              className="bg-white w-full max-w-6xl max-h-[95vh] md:max-h-[90vh] rounded-[2rem] md:rounded-[3rem] border border-black/5 shadow-2xl flex flex-col overflow-hidden relative"
            >
              <div className="p-5 md:p-8 pb-4 border-b border-slate-100 flex items-center justify-between bg-white z-20">
                <div className="flex items-center gap-4 md:gap-5">
                  <div className="bg-slate-900 text-white p-3 md:p-4 rounded-[1.2rem] md:rounded-[1.5rem] shadow-lg shadow-slate-200 shrink-0">
                    <FileText size={24} className="md:w-7 md:h-7" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight truncate">Centro de Control</h3>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Librería Operativa GAVILÁN</p>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setShowActivitiesModal(false)} 
                  className="p-3 hover:bg-red-50 hover:text-red-600 rounded-[1.2rem] transition-all text-slate-400"
                >
                  <X size={22} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
                <div className="w-full lg:w-[450px] shrink-0 bg-slate-50/50 p-6 md:p-8 lg:border-r lg:border-slate-100 overflow-y-auto custom-scrollbar">
                  <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest mb-6">Editor de Tareas</h4>
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm space-y-5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 ml-2">Nombre</label>
                        <input 
                          type="text" 
                          placeholder="Ej: Limpieza Planchas" 
                          value={newActivity.name} 
                          onChange={(e) => setNewActivity({...newActivity, name: e.target.value})} 
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Turno</label>
                        <select 
                          value={newActivity.shift || 'AM'}
                          onChange={(e) => setNewActivity({...newActivity, shift: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-4 text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all appearance-none cursor-pointer"
                        >
                          <option value="AM">☀️ AM</option>
                          <option value="PM">🌙 PM</option>
                          <option value="AMBOS">⚡ AMBOS</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Categoría</label>
                        <select 
                          value={newActivity.category}
                          onChange={(e) => setNewActivity({...newActivity, category: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-4 text-sm font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all appearance-none cursor-pointer"
                        >
                          <option value="APERTURA">🌄 APERTURA</option>
                          <option value="CIERRE">🌙 CIERRE</option>
                          <option value="ACTIVIDAD REGULAR">⚡ ACTIVIDAD REGULAR</option>
                          <option value="OTRO">⚙️ OTRO</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 pb-8 lg:pb-0">
                      <button 
                        onClick={() => finalizeSaveActivity()}
                        className={`w-full py-5 rounded-[1.5rem] transition-all shadow-lg flex items-center justify-center gap-4 group active:scale-95 bg-slate-900 hover:bg-black text-white`}
                      >
                        <Save size={18} />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          {editingActivityId ? 'Actualizar Tarea' : 'Registrar Actividad'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-6 md:p-8 lg:overflow-y-auto custom-scrollbar bg-white">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Listado de la Librería</h4>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        placeholder="BUSCAR TAREA..." 
                        value={activitySearchQuery}
                        onChange={(e) => setActivitySearchQuery(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all w-64"
                      />
                    </div>
                  </div>
                  <div className="space-y-12">
                    {activities.length === 0 ? (
                      <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 italic text-sm p-6">
                        {t('roles_hub.no_catalog_activities')}
                      </div>
                    ) : (() => {
                      const filteredActs = activities.filter(act => {
                        if (activitySearchQuery) {
                          const query = activitySearchQuery.toLowerCase();
                          return act.name.toLowerCase().includes(query) || (act.category || '').toLowerCase().includes(query);
                        }
                        return true;
                      });

                      return ['APERTURA', 'CIERRE', 'ACTIVIDAD REGULAR', 'OTRO'].map(cat => {
                        const acts = filteredActs.filter(a => a.category === cat);
                        if (acts.length === 0) return null;
                        return (
                          <div key={cat} className="space-y-4">
                            <h4 className="text-[11px] font-bold text-indigo-600 uppercase tracking-widest border-b border-indigo-100 pb-2">{cat}</h4>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {acts.map((act) => (
                                <div key={act.id} className="group flex items-center justify-between p-5 rounded-[2rem] border border-slate-100 bg-white hover:bg-slate-50 transition-all">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-bold text-slate-900">{act.name}</span>
                                    <span className="text-[9px] font-black text-indigo-400 uppercase">{act.shift}</span>
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => { setEditingActivityId(act.id); setNewActivity({ name: act.name, category: act.category, startTime: act.startTime || '', endTime: act.endTime || '', shift: act.shift || 'AM' }); }} className="p-3 text-slate-300 hover:text-indigo-600 rounded-xl"><RefreshCw size={16} /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )"""

# Perform replacement
new_content = content[:start_idx] + clean_replacement + content[block_end_idx:]
open(page_path, 'w', encoding='utf-8').write(new_content)
print("Successfully replaced activities modal block!")
