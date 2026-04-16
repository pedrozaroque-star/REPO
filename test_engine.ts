import { scheduleBreaksWithDemand as generateTimeline } from './lib/breaks-engine';

const shifts = [
  { id: 1, employee_name: 'Alberto Romero', job_title: 'Manager', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T02:00:00-07:00', breaks_schedule: [], is_leader: true },
  { id: 2, employee_name: 'Eufrosina Perez', job_title: 'Cashier', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T00:00:00-07:00', breaks_schedule: [], is_leader: false },
  { id: 3, employee_name: 'Sandra Yoselyn', job_title: 'Cashier', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T01:00:00-07:00', breaks_schedule: [], is_leader: false },
  { id: 4, employee_name: 'Teresa', job_title: 'Cashier', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T00:00:00-07:00', breaks_schedule: [], is_leader: false },
  { id: 5, employee_name: 'Veronica', job_title: 'Cashier', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T01:00:00-07:00', breaks_schedule: [], is_leader: false },
  { id: 6, employee_name: 'Arturo', job_title: 'Cook', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T00:00:00-07:00', breaks_schedule: [], is_leader: false },
  { id: 7, employee_name: 'Lorenzo', job_title: 'Cook', start_time: '2026-04-15T17:00:00-07:00', end_time: '2026-04-16T02:00:00-07:00', breaks_schedule: [], is_leader: false },
] as any[];

const hours = [
    { hour: 17, projected_sales: 50 }, 
    { hour: 18, projected_sales: 60 }, 
    { hour: 19, projected_sales: 70 }, 
    { hour: 20, projected_sales: 100 }, 
    { hour: 21, projected_sales: 90 }, 
    { hour: 22, projected_sales: 40 }, 
    { hour: 23, projected_sales: 30 }, 
] as any[];

const result = generateTimeline(shifts, hours);
console.log(JSON.stringify(result.map(s => ({
    name: s.employee_name,
    meal: new Date(s.breaks_schedule.find(b => b.type === 'meal_30')?.start_time).toLocaleTimeString()
})), null, 2));
