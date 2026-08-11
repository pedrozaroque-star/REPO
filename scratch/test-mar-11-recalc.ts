import { scheduleBreaksWithDemand } from '../lib/breaks-engine'

const mockShifts: any[] = [
    {
        id: '1',
        employee_name: 'Jennifer Lizbeth Baltazar',
        job_title: 'cashier',
        start_time: '2026-08-11T17:00:00-07:00',
        end_time: '2026-08-12T00:00:00-07:00', // 12 AM (7h)
        breaks_schedule: []
    },
    {
        id: '2',
        employee_name: 'Sandra Yoselyn Gonon',
        job_title: 'cashier',
        start_time: '2026-08-11T17:00:00-07:00',
        end_time: '2026-08-12T01:00:00-07:00', // 1 AM (8h)
        breaks_schedule: []
    },
    {
        id: '3',
        employee_name: 'Teresa de Jesus',
        job_title: 'cashier',
        start_time: '2026-08-11T17:00:00-07:00',
        end_time: '2026-08-12T00:00:00-07:00', // 12 AM (7h)
        breaks_schedule: []
    },
    {
        id: '4',
        employee_name: 'Alberto Rodriguez',
        job_title: 'cook',
        start_time: '2026-08-11T17:00:00-07:00',
        end_time: '2026-08-12T01:00:00-07:00', // 1 AM (8h)
        breaks_schedule: []
    },
    {
        id: '5',
        employee_name: 'Arturo Juarez',
        job_title: 'cook',
        start_time: '2026-08-11T17:00:00-07:00',
        end_time: '2026-08-12T00:00:00-07:00', // 12 AM (7h)
        breaks_schedule: []
    },
    {
        id: '6',
        employee_name: 'Carlos Roca',
        job_title: 'cook',
        start_time: '2026-08-11T18:00:00-07:00',
        end_time: '2026-08-11T23:00:00-07:00', // 11 PM (5h)
        breaks_schedule: []
    },
    {
        id: '7',
        employee_name: 'Juan Hernandez',
        job_title: 'cook',
        start_time: '2026-08-11T18:00:00-07:00',
        end_time: '2026-08-12T02:00:00-07:00', // 2 AM (8h)
        breaks_schedule: []
    },
    {
        id: '8',
        employee_name: 'Lorenzo Marcos',
        job_title: 'cook',
        start_time: '2026-08-11T17:00:00-07:00',
        end_time: '2026-08-12T02:00:00-07:00', // 2 AM (9h)
        breaks_schedule: []
    }
]

const mockOperatingHours: any[] = [
    { hour: 17, projected_sales: 500 },
    { hour: 18, projected_sales: 900 },
    { hour: 19, projected_sales: 950 },
    { hour: 20, projected_sales: 800 },
    { hour: 21, projected_sales: 600 },
    { hour: 22, projected_sales: 400 },
    { hour: 23, projected_sales: 300 },
    { hour: 0, projected_sales: 150 },
    { hour: 1, projected_sales: 50 }
]

const result = scheduleBreaksWithDemand(mockShifts, mockOperatingHours, [])

console.log("\n=== FINAL SCHEDULE FOR COOKS ===")
result.filter(s => s.job_title === 'cook').forEach(s => {
    console.log(`\n👤 ${s.employee_name} (${new Date(s.start_time).toLocaleTimeString()} - ${new Date(s.end_time).toLocaleTimeString()})`)
    s.breaks_schedule.forEach((b: any) => {
        console.log(`  ${b.type === 'meal_30' ? '🍽️ MEAL' : '☕ REST'}: ${new Date(b.start_time).toLocaleTimeString()} - ${new Date(b.end_time).toLocaleTimeString()}`)
    })
})
