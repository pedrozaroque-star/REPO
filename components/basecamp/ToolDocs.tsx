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
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga documentos de `bc_documents` y subidas de `bc_uploads` para el proyecto.
 *   - Escritura: Llama a `/api/basecamp/action` o directamente a `supabase.from('bc_uploads').insert` para archivos locales.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: Trabaja localmente con Supabase si no hay tokens de Basecamp configurados.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { FolderOpen, FileText, Plus, FileSpreadsheet, FileDown, Trash2, ArrowLeft, Upload, Loader2, FileUp } from 'lucide-react'
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
    const [vault, setVault] = useState<{ id: string; bc_id: number } | null>(null)
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [currentPerson, setCurrentPerson] = useState<any>(null)

    // Estados de navegación interna
    const [selectedDoc, setSelectedDoc] = useState<any | null>(null)
    const [showCreateForm, setShowCreateForm] = useState(false)

    // Formulario de nuevo doc
    const [newDocName, setNewDocName] = useState('')
    const [newDocContent, setNewDocContent] = useState('')

    // Carga de archivo real
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)

    // Resolve current user details
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

    // Fetch vault and items
    const fetchVaultAndItems = async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // 1. Get or create vault container
            let { data: dbVault } = await supabase
                .from('bc_vaults')
                .select('id, bc_id')
                .eq('project_id', project.db_id)
                .limit(1)
                .single()

            if (!dbVault) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newVault, error: vaultErr } = await supabase
                    .from('bc_vaults')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId
                    })
                    .select('id, bc_id')
                    .single()
                if (vaultErr) throw vaultErr
                dbVault = newVault
            }

            if (dbVault) {
                setVault({ id: dbVault.id, bc_id: Number(dbVault.bc_id) })

                // 2. Fetch documents
                const { data: dbDocs, error: docsErr } = await supabase
                    .from('bc_documents')
                    .select(`
                        id, bc_id, title, content, created_at,
                        author:bc_people(name)
                    `)
                    .eq('vault_id', dbVault.id)
                    .order('created_at', { ascending: false })

                if (docsErr) throw docsErr

                // 3. Fetch uploads
                const { data: dbUploads, error: upsErr } = await supabase
                    .from('bc_uploads')
                    .select(`
                        id, bc_id, filename, content_type, byte_size, download_url, created_at,
                        author:bc_people(name)
                    `)
                    .eq('vault_id', dbVault.id)
                    .order('created_at', { ascending: false })

                if (upsErr) throw upsErr

                // Combine them
                const combined: any[] = []
                if (dbDocs) {
                    dbDocs.forEach(d => {
                        combined.push({
                            id: d.id,
                            bc_id: d.bc_id,
                            name: d.title,
                            type: 'doc',
                            content: d.content,
                            author: (d.author as any)?.name || 'Unknown',
                            size: `${Math.round((d.content?.length || 0) / 1024 * 10) / 10} KB`,
                            date: new Date(d.created_at).toISOString().split('T')[0]
                        })
                    })
                }

                if (dbUploads) {
                    dbUploads.forEach(u => {
                        const fileExt = u.filename.split('.').pop() || 'file'
                        const sizeStr = u.byte_size > 1024 * 1024 
                            ? `${Math.round(u.byte_size / 1024 / 1024 * 10) / 10} MB` 
                            : `${Math.round(u.byte_size / 1024 * 10) / 10} KB`

                        combined.push({
                            id: u.id,
                            bc_id: u.bc_id,
                            name: u.filename,
                            type: fileExt === 'xlsx' || fileExt === 'csv' || fileExt === 'xls' ? 'xlsx' : 'file',
                            download_url: u.download_url,
                            author: (u.author as any)?.name || 'Unknown',
                            size: sizeStr,
                            date: new Date(u.created_at).toISOString().split('T')[0]
                        })
                    })
                }

                // Sort combined list by date (newest first)
                combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                setItems(combined)

                if (selectedDoc) {
                    const found = combined.find(i => i.id === selectedDoc.id)
                    if (found) setSelectedDoc(found)
                }
            }
        } catch (err: any) {
            console.error('❌ [ToolDocs Fetch] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchVaultAndItems()
        setSelectedDoc(null)
    }, [project.id, project.db_id])

    // Save internal text document
    const handleSaveDoc = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newDocName.trim() || !newDocContent.trim() || !vault) return
        setLoading(true)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_document',
                    projectId: project.id,
                    vaultId: vault.bc_id,
                    vaultDbId: vault.id,
                    title: newDocName.trim(),
                    content: newDocContent.trim()
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewDocName('')
            setNewDocContent('')
            setShowCreateForm(false)
            await fetchVaultAndItems()
        } catch (err: any) {
            console.error('❌ [ToolDocs SaveDoc] Error:', err.message)
            setLoading(false)
        }
    }

    // Delete document or file upload
    const handleDeleteDoc = async (item: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_doc_confirm'))) return
        setLoading(true)
        try {
            const tableName = item.type === 'doc' ? 'bc_documents' : 'bc_uploads'
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
            await fetchVaultAndItems()
        } catch (err: any) {
            console.error('❌ [ToolDocs Delete] Error:', err.message)
            setLoading(false)
        }
    }

    // Upload real file to Supabase Storage
    const handleFileUploadReal = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !vault) return

        setIsUploading(true)
        setUploadProgress(10)

        try {
            const fileExt = file.name.split('.').pop() || 'file'
            const filePath = `basecamp-uploads/${project.db_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

            setUploadProgress(30)
            
            // Upload to Supabase Storage Bucket
            const { error: uploadError } = await supabase.storage
                .from('checklist-photos')
                .upload(filePath, file)

            if (uploadError) throw uploadError
            setUploadProgress(70)

            // Get public URL
            const { data } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
            if (!data?.publicUrl) throw new Error('Failed to retrieve file public URL')

            setUploadProgress(90)

            // Insert upload record in Supabase
            const tempBcId = Math.floor(Date.now() / 1000)
            const { error: insertErr } = await supabase
                .from('bc_uploads')
                .insert({
                    bc_id: tempBcId,
                    project_id: project.db_id,
                    vault_id: vault.id,
                    filename: file.name,
                    content_type: file.type || 'application/octet-stream',
                    byte_size: file.size,
                    download_url: data.publicUrl,
                    author_person_id: currentPerson?.id || null
                })

            if (insertErr) throw insertErr
            setUploadProgress(100)

            // Small delay for animation
            setTimeout(() => {
                setIsUploading(false)
                fetchVaultAndItems()
            }, 500)
        } catch (err: any) {
            console.error('❌ [ToolDocs Upload] Error:', err.message)
            alert('Error al cargar archivo: ' + err.message)
            setIsUploading(false)
        }
    }

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col gap-6">
            {/* Cabecera */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-yellow-500/10 text-yellow-600 flex items-center justify-center border border-yellow-200/30">
                        <FolderOpen size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-extrabold text-slate-850 dark:text-slate-100">
                            {t('basecamp.docs_files')}
                        </h3>
                        <p className="text-[10px] text-slate-450 dark:text-slate-400 uppercase tracking-wider">
                            Almacenamiento del Proyecto / Project Docs & Files
                        </p>
                    </div>
                </div>

                {!showCreateForm && !selectedDoc && (
                    <div className="flex items-center gap-2">
                        {/* Selector de archivo real */}
                        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 font-bold text-xs shadow-sm cursor-pointer transition-all">
                            <Upload size={14} />
                            <span>{t('basecamp.upload_file')}</span>
                            <input
                                type="file"
                                onChange={handleFileUploadReal}
                                className="hidden"
                                disabled={isUploading}
                            />
                        </label>

                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow-sm transition-all"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.new_doc_btn')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Barra de progreso de subida real */}
            {isUploading && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200/30 dark:border-blue-900/30 rounded-2xl p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs font-bold text-blue-800 dark:text-blue-300">
                        <span className="flex items-center gap-1.5">
                            <Loader2 className="animate-spin text-[#1D7DB5]" size={14} />
                            {t('basecamp.uploading_real_file')}
                        </span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                        <div
                            className="bg-[#1D7DB5] h-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* ── 1. FORMULARIO CREAR DOCUMENTO ── */}
            {showCreateForm && (
                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
                    <button
                        type="button"
                        onClick={() => setShowCreateForm(false)}
                        className="text-xs text-slate-450 hover:text-slate-700 dark:hover:text-slate-200 font-bold mb-4 block"
                    >
                        {t('basecamp.back')}
                    </button>
                    <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2.5 mb-4">
                        {t('basecamp.new_doc_btn')}
                    </h4>
                    <form onSubmit={handleSaveDoc} className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.document_title_label')}</label>
                            <input
                                type="text"
                                required
                                value={newDocName}
                                onChange={(e) => setNewDocName(e.target.value)}
                                placeholder={t('basecamp.new_doc_title')}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.document_content_label')}</label>
                            <textarea
                                required
                                value={newDocContent}
                                onChange={(e) => setNewDocContent(e.target.value)}
                                placeholder={t('basecamp.new_doc_content')}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs h-40"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow-sm"
                            >
                                {t('basecamp.save_doc')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── 2. DETALLE DE UN DOCUMENTO ── */}
            {selectedDoc && (
                <div className="flex-grow flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                        <button
                            onClick={() => setSelectedDoc(null)}
                            className="text-xs text-slate-455 hover:text-slate-750 dark:hover:text-slate-200 font-bold"
                        >
                            {t('basecamp.back')}
                        </button>
                        <button
                            onClick={(e) => handleDeleteDoc(selectedDoc, e)}
                            className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 px-3 py-1 rounded-xl transition-all"
                        >
                            <Trash2 size={13} />
                             <span>{t('basecamp.delete')}</span>
                        </button>
                    </div>

                    <article className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-6 rounded-2xl shadow-sm flex-1">
                        <span className="text-[10px] font-black text-yellow-700 dark:text-yellow-400 uppercase tracking-widest bg-yellow-50/50 dark:bg-yellow-950/20 px-2 py-0.5 rounded border border-yellow-250/30 dark:border-yellow-900/20">
                            {selectedDoc.type === 'doc' ? t('basecamp.text_document') : t('basecamp.external_file')}
                        </span>
                        <h2 className="text-xl font-extrabold text-slate-850 dark:text-slate-100 mt-2 mb-4 font-serif">
                            {selectedDoc.name}
                        </h2>
                        <div className="flex items-center gap-4 text-[10.5px] text-slate-455 border-y border-slate-100 dark:border-slate-800 py-2.5 mb-6">
                            <span>{t('basecamp.author_label')}: <strong>{selectedDoc.author}</strong></span>
                            <span>•</span>
                            <span>{t('basecamp.date_label')}: {selectedDoc.date}</span>
                            <span>•</span>
                            <span>{t('basecamp.size_label')}: {selectedDoc.size}</span>
                        </div>
 
                        {selectedDoc.type === 'doc' ? (
                            <div className="text-xs text-slate-650 dark:text-slate-355 leading-relaxed whitespace-pre-wrap">
                                {selectedDoc.content}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-10 text-center text-xs">
                                <FileSpreadsheet size={48} className="text-emerald-500 mb-2" />
                                <p className="font-bold text-slate-700 dark:text-slate-300">{t('basecamp.binary_file_desc')}</p>
                                <p className="text-slate-400 mt-1">{t('basecamp.binary_file_sub')}</p>
                                <a
                                    href={selectedDoc.download_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 px-4 py-2 bg-[#1D7DB5] hover:bg-[#155D8A] text-white rounded-xl font-bold mt-4 border border-blue-600 text-xs shadow-sm transition-colors cursor-pointer"
                                >
                                    <FileDown size={14} />
                                    {t('basecamp.download_file_btn')}
                                </a>
                            </div>
                        )}
                    </article>
                </div>
            )}

            {/* ── 3. LISTADO DE ARCHIVOS Y CARPETAS ── */}
            {!showCreateForm && !selectedDoc && (
                <div>
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : items.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {items.map((doc) => (
                                <div
                                    key={doc.id}
                                    onClick={() => setSelectedDoc(doc)}
                                    className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-900 dark:border-slate-800 hover:shadow-md cursor-pointer transition-shadow relative group"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-850 flex items-center justify-center shrink-0 border border-slate-200/30">
                                        {doc.type === 'xlsx' ? (
                                            <FileSpreadsheet size={20} className="text-emerald-500" />
                                        ) : doc.type === 'doc' ? (
                                            <FileText size={20} className="text-blue-500" />
                                        ) : (
                                            <FileUp size={20} className="text-[#1D7DB5]" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate pr-6">{doc.name}</h4>
                                        <p className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-wide">
                                            {doc.type} • {doc.size} • {t('basecamp.by')} {doc.author.split(' ')[0]}
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => handleDeleteDoc(doc, e)}
                                        className="absolute right-3 top-4 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-[#fcfaf6] dark:bg-slate-800/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                            <FolderOpen size={40} className="text-slate-355 mx-auto mb-3" />
                            <p className="text-xs text-slate-400 italic">{t('basecamp.no_docs')}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
