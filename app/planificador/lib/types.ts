export type Shift = {
    id?: string
    employee_id: string | null // null for Open Shift
    job_id: string
    store_id: string
    start_time: string // ISO
    end_time: string   // ISO
    status: 'draft' | 'published'
    notes?: string
    is_open?: boolean
    shift_date: string // YYYY-MM-DD
}

export type Employee = {
    id: string
    first_name: string
    last_name: string
    chosen_name?: string
    toast_guid: string
    deleted?: boolean
    job_references?: { guid: string, title?: string }[]
    wage_data?: { job_guid: string, wage: number }[]
    email?: string
    phone?: string
}

export type Job = {
    id: string
    guid: string
    title: string
}
