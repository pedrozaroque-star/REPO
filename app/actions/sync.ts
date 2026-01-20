'use server'

import { syncToastEmployees } from '@/lib/toast-labor'
import { revalidatePath } from 'next/cache'

export async function syncEmployeesAction(storeId: string) {
    try {
        const result = await syncToastEmployees(storeId)
        revalidatePath('/planificador')
        return result
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}
