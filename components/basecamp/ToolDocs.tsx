/**
 * @module ToolDocs
 * @description Módulo de Documentos y Archivos (Docs & Files) para almacenar manuales de operaciones y reportes.
 *              Conecta directamente con Supabase (tablas bc_vaults, bc_documents, bc_uploads)
 *              y realiza cargas reales de archivos a Supabase Storage (bucket checklist-photos)
 *              con sincronización de Basecamp API a través de /api/basecamp/action.
 * @businessRules
 *   - Almacenamiento organizado del proyecto.
 *   - Crear documentos de texto y subir archivos binarios reales con almacenamiento en Supabase Storage.
 *   - Borrar documentos y archivos propaga la eliminación tanto a Basecamp API como a Supabase.
 *   - Los enlaces de Google Drive (documentos y hojas de cálculo) se interceptan para abrirse directamente en una nueva pestaña.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga recursivamente los vaults, documentos y cargas del proyecto.
 *   - Escritura: Llama a `/api/basecamp/action` o directamente a `supabase` para subir archivos.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: Trabaja localmente con Supabase si no hay tokens de Basecamp configurados.
 *   - Navegación recursiva usando `currentVaultId` y breadcrumbs dinámicos basados en la jerarquía `parent_vault_id`.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { FolderOpen, FileText, Plus, FileSpreadsheet, FileDown, Trash2, Upload, Loader2, FileUp, FolderPlus } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'

interface ToolDocsProps {
    project: any
    currentUserName: string
}

export default function ToolDocs({ project, currentUserName }: ToolDocsProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const { user: authUser, loading: authLoading } = useAuth()
    
    // Contenedores cargados en memoria
    const [allVaults, setAllVaults] = useState<any[]>([])
    const [allDocs, setAllDocs] = useState<any[]>([])
    const [allUploads, setAllUploads] = useState<any[]>([])
    
    // Estado de navegación recursiva
    const [currentVaultId, setCurrentVaultId] = useState<string | null>(null)
    const [selectedDoc, setSelectedDoc] = useState<any | null>(null)
    
    // Estado de carga y sesión
    const [loading, setLoading] = useState(true)
    const [currentPerson, setCurrentPerson] = useState<any>(null)

    // Modales / Formularios
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [showCreateFolderForm, setShowCreateFolderForm] = useState(false)

    // Formulario nuevo doc
    const [newDocName, setNewDocName] = useState('')
    const [newDocContent, setNewDocContent] = useState('')

    // Formulario nueva carpeta
    const [newFolderName, setNewFolderName] = useState('')

    // Subida de archivos
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)

    // Cargar persona actual de la sesión
    useEffect(() => {
        if (authLoading || !authUser) return
        const getPerson = async () => {
            const { data } = await supabase
                .from('bc_people')
                .select('id, name, email')
                .eq('email', authUser.email || '')
                .limit(1)
                .single()
            setCurrentPerson(data)
        }
        getPerson()
    }, [authUser, authLoading])

    // Cargar vaults, docs y uploads para el proyecto
    const fetchAllProjectDocsData = async (initialLoad = false) => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // 1. Fetch vaults
            const { data: dbVaults, error: vaultsErr } = await supabase
                .from('bc_vaults')
                .select('id, bc_id, name, parent_vault_id, created_at')
                .eq('project_id', project.db_id)
            if (vaultsErr) throw vaultsErr

            let finalVaults = dbVaults || []

            // Si el proyecto no tiene ningún vault, creamos el root "Docs & Files" por defecto
            if (finalVaults.length === 0) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newVault, error: vaultErr } = await supabase
                    .from('bc_vaults')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId,
                        name: 'Docs & Files',
                        parent_vault_id: null
                    })
                    .select('*')
                    .single()
                if (!vaultErr && newVault) {
                    finalVaults = [newVault]
                }
            }

            // 2. Fetch documents
            const { data: dbDocs, error: docsErr } = await supabase
                .from('bc_documents')
                .select(`
                    id, bc_id, title, content, vault_id, created_at,
                    author:bc_people(name)
                `)
                .eq('project_id', project.db_id)
                .order('created_at', { ascending: false })
            if (docsErr) throw docsErr

            // 3. Fetch uploads
            const { data: dbUploads, error: upsErr } = await supabase
                .from('bc_uploads')
                .select(`
                    id, bc_id, filename, content_type, byte_size, download_url, vault_id, created_at,
                    author:bc_people(name)
                `)
                .eq('project_id', project.db_id)
                .order('created_at', { ascending: false })
            if (upsErr) throw upsErr

            setAllVaults(finalVaults)
            setAllDocs(dbDocs || [])
            setAllUploads(dbUploads || [])

            // Si es la carga inicial del componente, intentamos abrir la carpeta "Docs & Files" por defecto
            if (initialLoad) {
                const docsAndFilesVault = finalVaults.find(v => v.name?.toLowerCase() === 'docs & files')
                if (docsAndFilesVault) {
                    setCurrentVaultId(docsAndFilesVault.id)
                } else {
                    setCurrentVaultId(null)
                }
            }
        } catch (err: any) {
            console.error('❌ [ToolDocs FetchAll] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    // Recargar al cambiar de proyecto
    useEffect(() => {
        setCurrentVaultId(null)
        setSelectedDoc(null)
        setShowCreateForm(false)
        setShowCreateFolderForm(false)
        fetchAllProjectDocsData(true)
    }, [project.id, project.db_id])

    // Vault actual en la navegación
    const currentVault = allVaults.find(v => v.id === currentVaultId)

    // Crear un documento de texto interno
    const handleSaveDoc = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newDocName.trim() || !newDocContent.trim()) return
        setLoading(true)

        let targetVaultDbId = currentVaultId
        let targetVaultBcId = currentVault ? currentVault.bc_id : null

        // Si estamos en la raíz del proyecto, asociamos al vault "Docs & Files"
        if (!targetVaultDbId) {
            const dfVault = allVaults.find(v => v.name?.toLowerCase() === 'docs & files')
            if (dfVault) {
                targetVaultDbId = dfVault.id
                targetVaultBcId = dfVault.bc_id
            }
        }

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_document',
                    projectId: project.id,
                    vaultId: targetVaultBcId ? Number(targetVaultBcId) : null,
                    vaultDbId: targetVaultDbId,
                    title: newDocName.trim(),
                    content: newDocContent.trim()
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewDocName('')
            setNewDocContent('')
            setShowCreateForm(false)
            await fetchAllProjectDocsData()
        } catch (err: any) {
            console.error('❌ [ToolDocs SaveDoc] Error:', err.message)
            setLoading(false)
        }
    }

    // Crear una nueva subcarpeta (vault)
    const handleCreateFolder = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newFolderName.trim()) return
        setLoading(true)

        let targetVaultDbId = currentVaultId
        let targetVaultBcId = currentVault ? currentVault.bc_id : null

        // Si estamos en la raíz del proyecto, asociamos al vault "Docs & Files" como padre
        if (!targetVaultDbId) {
            const dfVault = allVaults.find(v => v.name?.toLowerCase() === 'docs & files')
            if (dfVault) {
                targetVaultDbId = dfVault.id
                targetVaultBcId = dfVault.bc_id
            }
        }

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_vault',
                    projectId: project.id,
                    parentVaultId: targetVaultBcId ? Number(targetVaultBcId) : null,
                    parentVaultDbId: targetVaultDbId,
                    name: newFolderName.trim()
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewFolderName('')
            setShowCreateFolderForm(false)
            await fetchAllProjectDocsData()
        } catch (err: any) {
            console.error('❌ [ToolDocs CreateFolder] Error:', err.message)
            setLoading(false)
        }
    }

    // Borrar elemento (documento, archivo o carpeta)
    const handleDeleteDoc = async (item: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_doc_confirm'))) return
        setLoading(true)
        try {
            const tableName = item.type === 'doc' ? 'bc_documents' : item.type === 'folder' ? 'bc_vaults' : 'bc_uploads'
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: item.bc_id,
                    recordingDbId: item.id,
                    tableName
                })
            })

            if (!res.ok) throw new Error(await res.text())
            setSelectedDoc(null)
            await fetchAllProjectDocsData()
        } catch (err: any) {
            console.error('❌ [ToolDocs Delete] Error:', err.message)
            setLoading(false)
        }
    }

    // Subir archivo real a Supabase Storage
    const handleFileUploadReal = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        setUploadProgress(10)

        try {
            const fileExt = file.name.split('.').pop() || 'file'
            const filePath = `basecamp-uploads/${project.db_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

            setUploadProgress(30)
            
            // Subir al bucket
            const { error: uploadError } = await supabase.storage
                .from('checklist-photos')
                .upload(filePath, file)

            if (uploadError) throw uploadError
            setUploadProgress(70)

            // Obtener URL pública
            const { data } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
            if (!data?.publicUrl) throw new Error('Failed to retrieve file public URL')

            setUploadProgress(90)

            // Si estamos en la raíz del proyecto, asociamos al vault "Docs & Files"
            let targetVaultDbId = currentVaultId
            if (!targetVaultDbId) {
                const dfVault = allVaults.find(v => v.name?.toLowerCase() === 'docs & files')
                if (dfVault) targetVaultDbId = dfVault.id
            }

            const tempBcId = Math.floor(Date.now() / 1000)
            const { error: insertErr } = await supabase
                .from('bc_uploads')
                .insert({
                    bc_id: tempBcId,
                    project_id: project.db_id,
                    vault_id: targetVaultDbId,
                    filename: file.name,
                    content_type: file.type || 'application/octet-stream',
                    byte_size: file.size,
                    download_url: data.publicUrl,
                    author_person_id: currentPerson?.id || null
                })

            if (insertErr) throw insertErr
            setUploadProgress(100)

            setTimeout(() => {
                setIsUploading(false)
                fetchAllProjectDocsData()
            }, 500)
        } catch (err: any) {
            console.error('❌ [ToolDocs Upload] Error:', err.message)
            alert(t('basecamp.file_upload_error') + ': ' + err.message)
            setIsUploading(false)
        }
    }

    // Reconstruir breadcrumbs recursivamente en base a parent_vault_id
    const getPathHistory = (vaultId: string | null) => {
        const history: { id: string | null; name: string }[] = []
        let currentId = vaultId
        while (currentId !== null) {
            const v = allVaults.find(item => item.id === currentId)
            if (!v) break
            history.unshift({ id: v.id, name: v.name })
            currentId = v.parent_vault_id
        }
        // Insertar la raíz al inicio
        history.unshift({ id: null, name: t('basecamp.docs_files') || 'Docs & Files Root' })
        return history
    }

    const pathHistory = getPathHistory(currentVaultId)

    // Filtrar contenido del vault actual
    const subfolders = allVaults
        .filter(v => v.parent_vault_id === currentVaultId)
        .map(v => ({
            id: v.id,
            bc_id: v.bc_id,
            name: v.name,
            type: 'folder',
            author: 'System',
            size: '',
            date: new Date(v.created_at).toISOString().split('T')[0]
        }))

    const docs = allDocs
        .filter(d => d.vault_id === currentVaultId)
        .map(d => ({
            id: d.id,
            bc_id: d.bc_id,
            name: d.title,
            type: 'doc',
            content: d.content,
            author: (d.author as any)?.name || 'Unknown',
            size: `${Math.round((d.content?.length || 0) / 1024 * 10) / 10} KB`,
            date: new Date(d.created_at).toISOString().split('T')[0]
        }))

    const ups = allUploads
        .filter(u => u.vault_id === currentVaultId)
        .map(u => {
            const fileExt = u.filename.split('.').pop()?.toLowerCase() || 'file'
            // Detección de enlaces de Google Drive
            const isGoogle = u.download_url?.includes('docs.google.com') || 
                             u.download_url?.includes('drive.google.com') || 
                             u.content_type?.endsWith('.document') || 
                             u.content_type?.endsWith('.spreadsheet')

            let displayType = 'file'
            if (isGoogle) {
                displayType = 'google_doc'
            } else if (fileExt === 'xlsx' || fileExt === 'csv' || fileExt === 'xls') {
                displayType = 'xlsx'
            } else if (fileExt === 'pdf') {
                displayType = 'pdf'
            }

            const sizeStr = u.byte_size > 1024 * 1024 
                ? `${Math.round(u.byte_size / 1024 / 1024 * 10) / 10} MB` 
                : `${Math.round(u.byte_size / 1024 * 10) / 10} KB`

            return {
                id: u.id,
                bc_id: u.bc_id,
                name: u.filename,
                type: displayType,
                content_type: u.content_type,
                download_url: u.download_url,
                author: (u.author as any)?.name || 'Unknown',
                size: sizeStr,
                date: new Date(u.created_at).toISOString().split('T')[0]
            }
        })

    const combinedItems = [...subfolders, ...docs, ...ups]
    
    // Carpetas primero, luego archivos y documentos por fecha
    combinedItems.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1
        if (a.type !== 'folder' && b.type === 'folder') return 1
        return new Date(b.date).getTime() - new Date(a.date).getTime()
    })

    // Al seleccionar un item
    const handleItemClick = (item: any) => {
        if (item.type === 'folder') {
            setCurrentVaultId(item.id)
            setSelectedDoc(null)
            setShowCreateForm(false)
            setShowCreateFolderForm(false)
        } else if (item.type === 'google_doc' || item.download_url?.includes('docs.google.com') || item.content_type?.endsWith('.document') || item.content_type?.endsWith('.spreadsheet')) {
            // Enlaces de Google Drive abren en pestaña nueva inmediatamente
            window.open(item.download_url, '_blank')
        } else {
            // Documentos nativos y otros archivos abren detalle modal/card
            setSelectedDoc(item)
        }
    }

    // Estilos de icono basados en tipo de archivo
    const getIconStyles = (type: string) => {
        switch (type) {
            case 'folder':
                return {
                    icon: <FolderOpen size={18} />,
                    bgColor: '#FEF3C7', // Amber/yellow
                    color: '#D97706'
                }
            case 'google_doc':
                return {
                    icon: <FileText size={18} />,
                    bgColor: '#E8F0FE', // Google Doc Blue
                    color: '#1A73E8'
                }
            case 'xlsx':
                return {
                    icon: <FileSpreadsheet size={18} />,
                    bgColor: '#E6F4EA', // Excel Green
                    color: '#0F9D58'
                }
            case 'pdf':
                return {
                    icon: <FileText size={18} />,
                    bgColor: '#FEE2E2', // PDF Red
                    color: '#EF4444'
                }
            case 'doc':
                return {
                    icon: <FileText size={18} />,
                    bgColor: '#EFF6FF', // Native Doc Blue
                    color: '#3B82F6'
                }
            default:
                return {
                    icon: <FileUp size={18} />,
                    bgColor: '#F5F3FF', // Purple
                    color: '#8B5CF6'
                }
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, maxWidth: '780px', margin: '0 auto', width: '100%', gap: '20px' }}>
            
            {/* 1. CABECERA CON BREADCRUMBS Y ACCIONES */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderBottom: '1px solid #E8E6E1', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                        {pathHistory.map((step, idx) => (
                            <React.Fragment key={step.id || 'root'}>
                                {idx > 0 && <span style={{ color: '#A0A0A0' }}>›</span>}
                                <span
                                    onClick={() => {
                                        setCurrentVaultId(step.id)
                                        setSelectedDoc(null)
                                        setShowCreateForm(false)
                                        setShowCreateFolderForm(false)
                                    }}
                                    style={{
                                        cursor: 'pointer',
                                        fontWeight: step.id === currentVaultId ? 'bold' : 'normal',
                                        color: step.id === currentVaultId ? '#2E3033' : '#1D7DB5',
                                        transition: 'color 0.2s',
                                    }}
                                    onMouseEnter={(e) => { if (step.id !== currentVaultId) e.currentTarget.style.color = '#155D8A' }}
                                    onMouseLeave={(e) => { if (step.id !== currentVaultId) e.currentTarget.style.color = '#1D7DB5' }}
                                >
                                    {step.name}
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                    <p style={{ fontSize: '10px', color: '#6B7B8D', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                        {t('basecamp.docs_files_created') || 'Documentos y Archivos'}
                    </p>
                </div>

                {/* Acciones solo si no estamos en la vista de detalle y estamos dentro de un vault */}
                {!showCreateForm && !showCreateFolderForm && !selectedDoc && currentVaultId !== null && (
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Subir archivo */}
                        <label style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            borderRadius: '12px',
                            border: '1px solid #C8C6C1',
                            backgroundColor: '#FFFFFF',
                            color: '#2E3033',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F5F5' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF' }}
                        >
                            <Upload size={13} />
                            <span>{t('basecamp.upload_file')}</span>
                            <input
                                type="file"
                                onChange={handleFileUploadReal}
                                className="hidden"
                                disabled={isUploading}
                            />
                        </label>

                        {/* Nueva Carpeta */}
                        <button
                            onClick={() => setShowCreateFolderForm(true)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                borderRadius: '12px',
                                border: '1px solid #C8C6C1',
                                backgroundColor: '#FFFFFF',
                                color: '#2E3033',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F5F5' }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF' }}
                        >
                            <FolderPlus size={13} />
                            <span>{t('basecamp.add_folder')}</span>
                        </button>

                        {/* Nuevo Documento */}
                        <button
                            onClick={() => setShowCreateForm(true)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                borderRadius: '12px',
                                border: 'none',
                                backgroundColor: '#1D7DB5',
                                color: '#FFFFFF',
                                fontSize: '12px',
                                fontWeight: 'extrabold',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#155D8A' }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1D7DB5' }}
                        >
                            <Plus size={13} />
                            <span>{t('basecamp.new_doc_btn')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* BARRA DE PROGRESO DE CARGA */}
            {isUploading && (
                <div style={{
                    backgroundColor: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    borderRadius: '16px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', fontWeight: 'bold', color: '#1E40AF' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Loader2 className="animate-spin" size={13} style={{ color: '#1D7DB5' }} />
                            {t('basecamp.uploading_real_file')}
                        </span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div style={{ width: '100%', backgroundColor: '#E2E8F0', height: '8px', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div
                            style={{
                                backgroundColor: '#1D7DB5',
                                height: '100%',
                                width: `${uploadProgress}%`,
                                transition: 'width 0.3s ease'
                            }}
                        />
                    </div>
                </div>
            )}

            {/* 2. DETALLE DE UN DOCUMENTO NATIVO O ARCHIVO */}
            {selectedDoc && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #E8E6E1', paddingBottom: '10px' }}>
                        <button
                            onClick={() => setSelectedDoc(null)}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#1D7DB5',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                padding: 0
                            }}
                        >
                            {t('basecamp.back')}
                        </button>
                        <button
                            onClick={(e) => handleDeleteDoc(selectedDoc, e)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#EF4444',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                padding: '4px 8px',
                                borderRadius: '8px',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FEE2E2' }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                        >
                            <Trash2 size={13} />
                            <span>{t('basecamp.delete')}</span>
                        </button>
                    </div>

                    <article style={{
                        backgroundColor: '#FCFAF6',
                        border: '1px solid #E8E6E1',
                        padding: '24px',
                        borderRadius: '16px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                        <span style={{
                            fontSize: '9px',
                            fontWeight: 'bold',
                            color: '#B45309',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            backgroundColor: '#FEF3C7',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: '1px solid #FCD34D'
                        }}>
                            {selectedDoc.type === 'doc' ? t('basecamp.text_document') : t('basecamp.external_file')}
                        </span>
                        <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#2E3033', marginTop: '12px', marginBottom: '12px', fontFamily: 'Georgia, serif' }}>
                            {selectedDoc.name}
                        </h2>
                        
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '12px',
                            fontSize: '11px',
                            color: '#6B7B8D',
                            borderTop: '1px solid #E8E6E1',
                            borderBottom: '1px solid #E8E6E1',
                            padding: '8px 0',
                            marginBottom: '20px'
                        }}>
                            <span>{t('basecamp.author_label') || 'Autor'}: <strong>{selectedDoc.author}</strong></span>
                            <span>•</span>
                            <span>{t('basecamp.date_label') || 'Fecha'}: {selectedDoc.date}</span>
                            {selectedDoc.size && (
                                <>
                                    <span>•</span>
                                    <span>{t('basecamp.size_label') || 'Tamaño'}: {selectedDoc.size}</span>
                                </>
                            )}
                        </div>

                        {selectedDoc.type === 'doc' ? (
                            <div style={{ fontSize: '13px', color: '#2E3033', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                                {selectedDoc.content}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', textAlign: 'center' }}>
                                <FileDown size={44} style={{ color: '#10B981', marginBottom: '8px' }} />
                                <p style={{ fontWeight: 'bold', fontSize: '13px', color: '#2E3033', margin: 0 }}>{t('basecamp.binary_file_desc')}</p>
                                <p style={{ fontSize: '11px', color: '#6B7B8D', marginTop: '4px', marginBottom: '16px' }}>{t('basecamp.binary_file_sub')}</p>
                                <a
                                    href={selectedDoc.download_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '8px 16px',
                                        backgroundColor: '#1D7DB5',
                                        color: '#FFFFFF',
                                        borderRadius: '12px',
                                        fontWeight: 'bold',
                                        fontSize: '12px',
                                        textDecoration: 'none',
                                        transition: 'background-color 0.2s',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#155D8A' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1D7DB5' }}
                                >
                                    <FileDown size={14} />
                                    <span>{t('basecamp.download_file_btn')}</span>
                                </a>
                            </div>
                        )}
                    </article>
                </div>
            )}

            {/* 3. FORMULARIO CREAR DOCUMENTO */}
            {showCreateForm && (
                <div style={{
                    backgroundColor: '#FCFAF6',
                    border: '1px solid #E8E6E1',
                    padding: '24px',
                    borderRadius: '16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                }}>
                    <button
                        type="button"
                        onClick={() => setShowCreateForm(false)}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#6B7B8D',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            marginBottom: '16px',
                            padding: 0
                        }}
                    >
                        {t('basecamp.back')}
                    </button>
                    
                    <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#2E3033', borderBottom: '1px solid #E8E6E1', paddingBottom: '8px', marginBottom: '16px', margin: 0 }}>
                        {t('basecamp.new_doc_btn')}
                    </h3>
                    
                    <form onSubmit={handleSaveDoc} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '10px', fontWeight: 'bold', color: '#6B7B8D', textTransform: 'uppercase', marginBottom: '4px' }}>
                                {t('basecamp.document_title_label') || 'Título del documento'}
                            </label>
                            <input
                                type="text"
                                required
                                value={newDocName}
                                onChange={(e) => setNewDocName(e.target.value)}
                                placeholder={t('basecamp.new_doc_title')}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    border: '1px solid #C8C6C1',
                                    borderRadius: '8px',
                                    backgroundColor: '#FFFFFF',
                                    color: '#2E3033',
                                    outline: 'none'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '10px', fontWeight: 'bold', color: '#6B7B8D', textTransform: 'uppercase', marginBottom: '4px' }}>
                                {t('basecamp.document_content_label') || 'Contenido'}
                            </label>
                            <textarea
                                required
                                value={newDocContent}
                                onChange={(e) => setNewDocContent(e.target.value)}
                                placeholder={t('basecamp.new_doc_content')}
                                style={{
                                    width: '100%',
                                    height: '160px',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    border: '1px solid #C8C6C1',
                                    borderRadius: '8px',
                                    backgroundColor: '#FFFFFF',
                                    color: '#2E3033',
                                    outline: 'none',
                                    resize: 'vertical'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '8px 16px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    color: '#6B7B8D',
                                    cursor: 'pointer',
                                    borderRadius: '8px',
                                    transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F5F5' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                style={{
                                    border: 'none',
                                    padding: '8px 16px',
                                    backgroundColor: '#1D7DB5',
                                    color: '#FFFFFF',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    borderRadius: '8px',
                                    transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#155D8A' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1D7DB5' }}
                            >
                                {t('basecamp.save_doc')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* 4. FORMULARIO CREAR CARPETA */}
            {showCreateFolderForm && (
                <div style={{
                    backgroundColor: '#FCFAF6',
                    border: '1px solid #E8E6E1',
                    padding: '24px',
                    borderRadius: '16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                }}>
                    <button
                        type="button"
                        onClick={() => setShowCreateFolderForm(false)}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#6B7B8D',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            marginBottom: '16px',
                            padding: 0
                        }}
                    >
                        {t('basecamp.back')}
                    </button>
                    
                    <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#2E3033', borderBottom: '1px solid #E8E6E1', paddingBottom: '8px', marginBottom: '16px', margin: 0 }}>
                        {t('basecamp.add_folder')}
                    </h3>
                    
                    <form onSubmit={handleCreateFolder} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '10px', fontWeight: 'bold', color: '#6B7B8D', textTransform: 'uppercase', marginBottom: '4px' }}>
                                {t('basecamp.folder_name_label') || 'Nombre de la carpeta'}
                            </label>
                            <input
                                type="text"
                                required
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder={t('basecamp.folder_name_placeholder')}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    border: '1px solid #C8C6C1',
                                    borderRadius: '8px',
                                    backgroundColor: '#FFFFFF',
                                    color: '#2E3033',
                                    outline: 'none'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                            <button
                                type="button"
                                onClick={() => setShowCreateFolderForm(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '8px 16px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    color: '#6B7B8D',
                                    cursor: 'pointer',
                                    borderRadius: '8px',
                                    transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F5F5' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                style={{
                                    border: 'none',
                                    padding: '8px 16px',
                                    backgroundColor: '#1D7DB5',
                                    color: '#FFFFFF',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    borderRadius: '8px',
                                    transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#155D8A' }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1D7DB5' }}
                            >
                                {t('basecamp.save_folder')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* 5. LISTADO DE ELEMENTOS EN FORMATO FILAS */}
            {!showCreateForm && !showCreateFolderForm && !selectedDoc && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : combinedItems.length > 0 ? (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            border: '1px solid #E8E6E1',
                            borderRadius: '16px',
                            backgroundColor: '#FFFFFF',
                            overflow: 'hidden',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                        }}>
                            {combinedItems.map((item, index) => {
                                const styleConfig = getIconStyles(item.type)
                                const isGoogle = item.type === 'google_doc'
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '12px 16px',
                                            borderBottom: index === combinedItems.length - 1 ? 'none' : '1px solid #E8E6E1',
                                            cursor: 'pointer',
                                            transition: 'background-color 0.2s ease',
                                        }}
                                        className="group"
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FAF9F6' }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                                            {/* Icono con fondo */}
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '8px',
                                                backgroundColor: styleConfig.bgColor,
                                                color: styleConfig.color,
                                                flexShrink: 0
                                            }}>
                                                {styleConfig.icon}
                                            </div>
                                            
                                            {/* Título y metadatos */}
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '13.5px', fontWeight: '600', color: '#2E3033', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                        {item.name}
                                                    </span>
                                                    {isGoogle && (
                                                        <span style={{
                                                            fontSize: '8px',
                                                            fontWeight: 'bold',
                                                            color: '#1A73E8',
                                                            backgroundColor: '#E8F0FE',
                                                            border: '1px solid #D2E3FC',
                                                            padding: '1px 5px',
                                                            borderRadius: '4px',
                                                            textTransform: 'uppercase',
                                                            letterSpacing: '0.5px'
                                                        }}>
                                                            Google Drive
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '11px', color: '#6B7B8D', marginTop: '2px' }}>
                                                    {item.type === 'folder' 
                                                        ? t('basecamp.add_folder') || 'Carpeta de archivos'
                                                        : `${item.size} • ${t('basecamp.by') || 'por'} ${item.author.split(' ')[0]} • ${item.date}`}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Botón de Borrar (se oculta y aparece al pasar el cursor) */}
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <button
                                                onClick={(e) => handleDeleteDoc(item, e)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: '6px',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    color: '#9CA3AF',
                                                    transition: 'all 0.2s',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.backgroundColor = '#FEE2E2' }}
                                                onMouseLeave={(e) => { e.currentTarget.style.color = '#9CA3AF'; e.currentTarget.style.backgroundColor = 'transparent' }}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div style={{
                            textAlign: 'center',
                            padding: '48px 24px',
                            backgroundColor: '#FCFAF6',
                            border: '1px dashed #E8E6E1',
                            borderRadius: '16px'
                        }}>
                            <FolderOpen size={36} style={{ color: '#A0A0A0', margin: '0 auto 12px' }} />
                            <p style={{ fontSize: '12px', color: '#6B7B8D', fontStyle: 'italic', margin: 0 }}>
                                {t('basecamp.no_docs') || 'No hay documentos creados todavía.'}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
