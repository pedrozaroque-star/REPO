import { useMemo } from 'react'
import { Employee, Shift, Job } from '../lib/types'
import { getRoleWeight } from '../lib/utils'

export function useVisibleEmployees(employees: Employee[], shifts: Shift[], jobs: Job[]) {
    return useMemo(() => {
        // Roles we want to show for Active employees (without shifts)
        const ALLOWED_ROLES = ['manager', 'shift', 'cook', 'cocinero', 'cashier', 'cajero', 'prep', 'taquero', 'assistant', 'asst'];

        const filtered = employees.filter(emp => {
            // 1. ALWAYS SHOW if they have a shift this week
            const hasShift = shifts.some(s => s.employee_id === emp.id);
            if (hasShift) return true;

            // 2. If no shift, ONLY SHOW if NOT deleted AND has a relevant role
            if (emp.deleted) return false;

            // Check roles
            const empJobGuids = new Set<string>();
            if (emp.job_references && Array.isArray(emp.job_references)) {
                emp.job_references.forEach((r: any) => empJobGuids.add(r.guid));
            }
            if (emp.wage_data && Array.isArray(emp.wage_data)) {
                emp.wage_data.forEach((w: any) => empJobGuids.add(w.job_guid));
            }

            let hasAllowedRole = false;
            for (const guid of empJobGuids) {
                const job = jobs.find(j => j.guid === guid || j.id === guid);
                if (job && job.title) {
                    const titleLower = job.title.toLowerCase();
                    if (ALLOWED_ROLES.some(role => titleLower.includes(role))) {
                        hasAllowedRole = true;
                        break;
                    }
                }
            }

            return hasAllowedRole;
        });

        // 3. SORT by Role Weight (Manager -> AM -> PM)
        return filtered.sort((a, b) => {
            const getTitle = (e: Employee) => {
                const ref = e.job_references?.[0];
                if (!ref) return '';
                const j = jobs.find(job => job.guid === ref.guid || job.id === ref.guid);
                return j?.title || '';
            }

            const shiftsA = shifts.filter(s => s.employee_id === a.id);
            const shiftsB = shifts.filter(s => s.employee_id === b.id);

            // Import helper locally or assume it's imported at top (need to add import)
            const weightA = getRoleWeight(getTitle(a), shiftsA);
            const weightB = getRoleWeight(getTitle(b), shiftsB);

            if (weightA !== weightB) return weightA - weightB;

            // Secondary sort by name
            return (a.chosen_name || a.first_name || '').localeCompare(b.chosen_name || b.first_name || '');
        });
    }, [employees, shifts, jobs]);
}
