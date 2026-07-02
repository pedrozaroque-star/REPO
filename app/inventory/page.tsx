'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InventoryDashboard() {
    const router = useRouter()
    useEffect(() => {
        router.replace('/inventory/items')
    }, [router])

    return (
        <div className="p-8 text-center text-slate-500 font-sans">
            Redireccionando...
        </div>
    )
}
