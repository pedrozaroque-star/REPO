/**
 * @module Basecamp Data Importer
 * @description Script de consola para importar datos locales desde los HTMLs descargados de Basecamp.
 *              Escanea directorios, parsea metadatos, personas, proyectos, chats, tareas, mensajes y comentarios
 *              e inserta todo en la base de datos Supabase utilizando el rol de Administrador.
 * @businessRules
 *   - Lee los archivos HTML de 'C:\\Downloaded Web Sites\\launchpad.37signals.com\\5052386\\buckets'.
 *   - Inserta personas en bc_people y mapea IDs de Basecamp a UUIDs de Supabase.
 *   - Inserta proyectos, chats, to-dos, mensajes y comentarios.
 *   - Evita duplicados haciendo upsert por el ID externo de Basecamp (bc_id).
 */

import fs from 'fs'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

const BASE_DIR = 'C:\\Downloaded Web Sites\\launchpad.37signals.com\\5052386\\buckets'

interface PersonInfo {
    bc_id: number
    name: string
    title: string
    avatar_url: string
}

async function run() {
    console.log('🚀 [Basecamp Import] Iniciando importación de datos desde HTMLs...')

    if (!fs.existsSync(BASE_DIR)) {
        console.error(`❌ El directorio base de descarga no existe: ${BASE_DIR}`)
        process.exit(1)
    }

    // 1. Encontrar todos los archivos HTML recursivamente
    const htmlFiles: string[] = []
    function getFiles(dir: string) {
        const files = fs.readdirSync(dir)
        for (const file of files) {
            const fullPath = path.join(dir, file)
            if (fs.statSync(fullPath).isDirectory()) {
                getFiles(fullPath)
            } else if (file.endsWith('.html') || file.endsWith('.htm')) {
                htmlFiles.push(fullPath)
            }
        }
    }
    getFiles(BASE_DIR)
    console.log(`📂 Encontrados ${htmlFiles.length} archivos HTML para procesar.`)

    // 2. Extraer personas (bc_people) desde avatares de cualquier archivo HTML
    console.log('👥 [Basecamp Import] Escaneando personas...')
    const peopleMap: Record<number, PersonInfo> = {}
    
    // Agregamos a Carlos Roque manualmente por si acaso
    peopleMap[43166202] = {
        bc_id: 43166202,
        name: 'Carlos Roque Velazquez',
        title: 'Manager',
        avatar_url: 'https://app.basecamp.com/5052386/my/avatar'
    }

    const avatarRegex = /data-avatar-for-person-id="(\d+)"[^>]*alt="([^"]*)"[^>]*title="([^"]*)"[^>]*src="([^"]+)"/g
    const altAvatarRegex = /data-avatar-for-person-id="(\d+)"[^>]*title="([^"]*)"[^>]*alt="([^"]*)"[^>]*src="([^"]+)"/g

    for (const filePath of htmlFiles) {
        const content = fs.readFileSync(filePath, 'utf-8')
        
        let match
        // Escaneo 1
        avatarRegex.lastIndex = 0
        while ((match = avatarRegex.exec(content)) !== null) {
            const bcId = parseInt(match[1])
            const alt = match[2]?.trim()
            const titleText = match[3]?.trim()
            const src = match[4]
            if (bcId && alt) {
                // Limpiar título (ej: "Freddie Gurrusquieta, Manager at Tacos Gavilan" -> "Manager")
                let cleanTitle = 'Staff'
                if (titleText) {
                    const titleParts = titleText.split(',')
                    if (titleParts.length > 1) {
                        cleanTitle = titleParts[1].trim()
                    } else {
                        cleanTitle = titleText
                    }
                }
                peopleMap[bcId] = {
                    bc_id: bcId,
                    name: alt,
                    title: cleanTitle,
                    avatar_url: src
                }
            }
        }

        // Escaneo 2 (caso alternativo de orden de atributos)
        altAvatarRegex.lastIndex = 0
        while ((match = altAvatarRegex.exec(content)) !== null) {
            const bcId = parseInt(match[1])
            const titleText = match[2]?.trim()
            const alt = match[3]?.trim()
            const src = match[4]
            if (bcId && alt) {
                let cleanTitle = 'Staff'
                if (titleText) {
                    const titleParts = titleText.split(',')
                    if (titleParts.length > 1) {
                        cleanTitle = titleParts[1].trim()
                    } else {
                        cleanTitle = titleText
                    }
                }
                peopleMap[bcId] = {
                    bc_id: bcId,
                    name: alt,
                    title: cleanTitle,
                    avatar_url: src
                }
            }
        }
    }

    const peopleList = Object.values(peopleMap)
    console.log(`👥 Encontradas ${peopleList.length} personas reales. Guardando en Supabase...`)

    // Insertar personas en bc_people
    for (const p of peopleList) {
        const { error } = await supabaseAdmin
            .from('bc_people')
            .upsert({
                bc_id: p.bc_id,
                name: p.name,
                email: p.bc_id === 43166202 ? 'carlos@tacosgavilan.com' : `${p.name.toLowerCase().replace(/\s+/g, '')}@tacosgavilan.com`,
                avatar_url: p.avatar_url,
                role: p.title.toLowerCase().includes('manager') ? 'manager' : p.title.toLowerCase().includes('supervisor') ? 'supervisor' : 'employee',
                title: p.title,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'bc_id' })
        
        if (error) {
            console.error(`❌ Error guardando persona ${p.name}:`, error.message)
        }
    }

    // Volver a consultar personas desde Supabase para tener mapeo bc_id -> db_uuid
    const { data: dbPeople } = await supabaseAdmin.from('bc_people').select('id, bc_id')
    const dbPeopleMap: Record<number, string> = {}
    if (dbPeople) {
        dbPeople.forEach(dp => {
            dbPeopleMap[Number(dp.bc_id)] = dp.id
        })
    }

    // 3. Crear Proyectos por defecto si no existen
    console.log('📂 [Basecamp Import] Creando proyectos...')
    const projects = [
        { bc_id: 21853276, name: 'All Locations', description: 'Proyecto general para todas las sucursales de Tacos Gavilan.', color: 'blue' },
        { bc_id: 35593512, name: 'Edison cases', description: 'Coordinación de casos e incidencias en la sucursal de Edison.', color: 'pink' },
        { bc_id: 46408455, name: 'Willian\'s Grupo', description: 'Grupo de trabajo y coordinación supervisado por Willian Aguilar.', color: 'white' }
    ]

    const dbProjectMap: Record<number, string> = {}
    for (const pr of projects) {
        const { data, error } = await supabaseAdmin
            .from('bc_projects')
            .upsert({
                bc_id: pr.bc_id,
                name: pr.name,
                description: pr.description,
                color: pr.color,
                is_pinned: pr.bc_id === 21853276,
                is_archived: false,
                member_count: pr.bc_id === 46408455 ? 5 : 34,
                updated_at: new Date().toISOString()
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

        if (error) {
            console.error(`❌ Error guardando proyecto ${pr.name}:`, error.message)
        } else if (data) {
            dbProjectMap[pr.bc_id] = data.id
        }
    }

    // 4. Procesar Campfire (Chats)
    console.log('💬 [Basecamp Import] Procesando chats (Campfire)...')
    for (const filePath of htmlFiles) {
        if (filePath.includes('\\chats\\')) {
            const projectBcIdStr = filePath.match(/buckets\\(\d+)\\chats/)?.[1]
            if (!projectBcIdStr) continue
            const projectBcId = parseInt(projectBcIdStr)
            const projectDbId = dbProjectMap[projectBcId]
            if (!projectDbId) continue

            const filename = path.basename(filePath, '.html')
            const campfireBcId = parseInt(filename.split('-')[0]) // p.ej. 3669710634

            // Upsert bc_campfires
            const { data: cfData, error: cfErr } = await supabaseAdmin
                .from('bc_campfires')
                .upsert({
                    bc_id: campfireBcId,
                    project_id: projectDbId,
                    created_at: new Date().toISOString()
                }, { onConflict: 'bc_id' })
                .select('id')
                .single()

            if (cfErr) {
                console.error(`❌ Error guardando campfire ${campfireBcId}:`, cfErr.message)
                continue
            }

            const campfireDbId = cfData.id
            const content = fs.readFileSync(filePath, 'utf-8')

            // Regex para capturar líneas de chat
            const lineRegex = /class="chat-line[^"]*editable[^"]*recording"[^>]*data-recording-id="(\d+)"[^>]*data-creator-id="(\d+)"[^>]*data-datetime="([^"]+)"[\s\S]*?<div class="chat-line__body[^"]*">([\s\S]+?)<\/div>/g
            
            let lineMatch
            const linesToInsert: any[] = []

            while ((lineMatch = lineRegex.exec(content)) !== null) {
                const lineBcId = parseInt(lineMatch[1])
                const creatorBcId = parseInt(lineMatch[2])
                const datetime = lineMatch[3]
                let body = lineMatch[4]?.trim() || ''

                // Limpiar HTML de body (sacar divs internos si los hay)
                body = body.replace(/<div>/g, '').replace(/<\/div>/g, '\n').trim()

                const authorUuid = dbPeopleMap[creatorBcId] || null

                linesToInsert.push({
                    bc_id: lineBcId,
                    project_id: projectDbId,
                    campfire_id: campfireDbId,
                    content: body,
                    author_person_id: authorUuid,
                    created_at: datetime
                })
            }

            if (linesToInsert.length > 0) {
                const { error: insErr } = await supabaseAdmin
                    .from('bc_campfire_lines')
                    .upsert(linesToInsert, { onConflict: 'bc_id' })
                if (insErr) {
                    console.error(`❌ Error guardando lineas de campfire para ${campfireBcId}:`, insErr.message)
                } else {
                    console.log(`   ✅ Guardadas ${linesToInsert.length} líneas de campfire en proyecto ${projectBcId}`)
                }
            }
        }
    }

    // 5. Procesar To-do Lists & To-dos
    console.log('📋 [Basecamp Import] Procesando listas y tareas (To-dos)...')
    for (const filePath of htmlFiles) {
        if (filePath.includes('\\todolists\\') || filePath.includes('\\todosets\\')) {
            const projectBcIdStr = filePath.match(/buckets\\(\d+)\\t/)?.[1]
            if (!projectBcIdStr) continue
            const projectBcId = parseInt(projectBcIdStr)
            const projectDbId = dbProjectMap[projectBcId]
            if (!projectDbId) continue

            const content = fs.readFileSync(filePath, 'utf-8')

            // Encontrar todosets
            let todosetBcId = projectBcId + 1000 // default dummy set
            const currentRecMatch = content.match(/data-recording-id="(\d+)"[^>]*data-behavior="[^"]*todoset"/i)
            if (currentRecMatch) {
                todosetBcId = parseInt(currentRecMatch[1])
            }

            // Upsert bc_todosets
            const { data: tsData, error: tsErr } = await supabaseAdmin
                .from('bc_todosets')
                .upsert({
                    bc_id: todosetBcId,
                    project_id: projectDbId,
                    name: 'To-dos',
                    created_at: new Date().toISOString()
                }, { onConflict: 'bc_id' })
                .select('id')
                .single()

            if (tsErr) {
                console.error(`❌ Error guardando todoset:`, tsErr.message)
                continue
            }

            const todosetDbId = tsData.id

            // Buscar todolists en el archivo
            const todolistBlockRegex = /<article class="todolist[^"]*recording"[^>]*data-recording-id="(\d+)"[\s\S]*?<h2 class="todolist__title"[^>]*>[\s\S]*?<a[^>]*permalink[^>]*>([\s\S]+?)<\/a>([\s\S]+?)<\/article>/g
            
            let listMatch
            while ((listMatch = todolistBlockRegex.exec(content)) !== null) {
                const listBcId = parseInt(listMatch[1])
                const listName = listMatch[2].trim()
                const innerContent = listMatch[3]

                // Buscar estadísticas de completadas
                let completedCount = 0
                let totalCount = 0
                const statMatch = innerContent.match(/(\d+)\/(\d+)\s+Completed/i)
                if (statMatch) {
                    completedCount = parseInt(statMatch[1])
                    totalCount = parseInt(statMatch[2])
                }

                // Upsert todolist
                const { data: listData, error: listErr } = await supabaseAdmin
                    .from('bc_todolists')
                    .upsert({
                        bc_id: listBcId,
                        project_id: projectDbId,
                        todoset_id: todosetDbId,
                        name: listName,
                        description: '',
                        position: 1,
                        completed_count: completedCount,
                        total_count: totalCount,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'bc_id' })
                    .select('id')
                    .single()

                if (listErr) {
                    console.error(`❌ Error guardando todolist ${listName}:`, listErr.message)
                    continue
                }

                const listDbId = listData.id

                // Buscar tareas individuales (remaining y completed)
                const todoItemRegex = /<li[^>]*class="todo[^"]*recording"[^>]*data-recording-id="(\d+)"[^>]*data-creator-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g
                let todoMatch
                const todosToInsert: any[] = []
                const assigneesToInsert: { todo_bc_id: number; person_id: string }[] = []

                while ((todoMatch = todoItemRegex.exec(innerContent)) !== null) {
                    const todoBcId = parseInt(todoMatch[1])
                    const creatorBcId = parseInt(todoMatch[2])
                    const todoInner = todoMatch[3]

                    // Título de tarea
                    const titleTextMatch = todoInner.match(/<div class="todo__content[^>]*>[\s\S]*?<a[^>]*>([\s\S]+?)<\/a>/i)
                    if (!titleTextMatch) continue
                    let title = titleTextMatch[1].trim()
                    title = title.replace(/\s+/g, ' ') // limpiar espacios extra

                    // ¿Completada?
                    const isCompleted = todoInner.includes('checked="checked"') || todoInner.includes('data-todo-form-placeholder-target="todosContainer"') === false && !filePath.includes('remaining')

                    // Notas/descripción
                    const notesMatch = todoInner.match(/title="([^"]+)"[^>]*><svg class="svg-icon svg-icon--file-text"/i)
                    const description = notesMatch ? notesMatch[1].trim() : ''

                    const authorUuid = dbPeopleMap[creatorBcId] || null

                    todosToInsert.push({
                        bc_id: todoBcId,
                        project_id: projectDbId,
                        todolist_id: listDbId,
                        title: title,
                        description: description,
                        is_completed: isCompleted,
                        completed_at: isCompleted ? new Date().toISOString() : null,
                        created_by_person_id: authorUuid,
                        position: todosToInsert.length + 1,
                        updated_at: new Date().toISOString()
                    })

                    // Extraer assignees en esta tarea
                    const assigneeAvatarRegex = /data-avatar-for-person-id="(\d+)"/g
                    let avatarMatch
                    const currentAssignees = new Set<number>()
                    while ((avatarMatch = assigneeAvatarRegex.exec(todoInner)) !== null) {
                        const personBcId = parseInt(avatarMatch[1])
                        if (personBcId && personBcId !== creatorBcId) {
                            currentAssignees.add(personBcId)
                        }
                    }

                    currentAssignees.forEach(pBcId => {
                        const personUuid = dbPeopleMap[pBcId]
                        if (personUuid) {
                            assigneesToInsert.push({
                                todo_bc_id: todoBcId,
                                person_id: personUuid
                            })
                        }
                    })
                }

                if (todosToInsert.length > 0) {
                    const { error: tErr } = await supabaseAdmin
                        .from('bc_todos')
                        .upsert(todosToInsert, { onConflict: 'bc_id' })
                    if (tErr) {
                        console.error(`❌ Error guardando tareas para todolist ${listName}:`, tErr.message)
                    } else {
                        console.log(`   ✅ Guardadas ${todosToInsert.length} tareas en lista "${listName}"`)

                        // Insertar assignees si los hay
                        if (assigneesToInsert.length > 0) {
                            // Buscar UUID reales de tareas insertadas para evitar llaves foráneas inválidas
                            const { data: insertedTodos } = await supabaseAdmin.from('bc_todos').select('id, bc_id').in('bc_id', todosToInsert.map(t => t.bc_id))
                            if (insertedTodos) {
                                const todoBcToUuid: Record<number, string> = {}
                                insertedTodos.forEach(it => { todoBcToUuid[Number(it.bc_id)] = it.id })

                                const cleanAssignees = assigneesToInsert.map(a => {
                                    return {
                                        todo_id: todoBcToUuid[a.todo_bc_id],
                                        person_id: a.person_id
                                    }
                                }).filter(a => a.todo_id !== undefined)

                                if (cleanAssignees.length > 0) {
                                    // Limpiamos viejas asignaciones para evitar duplicados/violaciones
                                    const targetTodoUuids = Array.from(new Set(cleanAssignees.map(a => a.todo_id)))
                                    await supabaseAdmin.from('bc_todo_assignees').delete().in('todo_id', targetTodoUuids)

                                    const { error: assErr } = await supabaseAdmin.from('bc_todo_assignees').insert(cleanAssignees)
                                    if (assErr) {
                                        console.error(`❌ Error guardando asignaciones para todolist ${listName}:`, assErr.message)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 6. Procesar Message Board & Messages & Comments
    console.log('📢 [Basecamp Import] Procesando posts del Message Board y comentarios...')
    for (const filePath of htmlFiles) {
        if (filePath.includes('\\messages\\')) {
            const projectBcIdStr = filePath.match(/buckets\\(\d+)\\m/)?.[1]
            if (!projectBcIdStr) continue
            const projectBcId = parseInt(projectBcIdStr)
            const projectDbId = dbProjectMap[projectBcId]
            if (!projectDbId) continue

            const content = fs.readFileSync(filePath, 'utf-8')

            const filename = path.basename(filePath, '.html')
            const messageBcId = parseInt(filename.split('-')[0])
            if (isNaN(messageBcId)) {
                // Saltar archivos de edición, borrador o paginaciones que no son mensajes reales
                continue
            }

            // Encontrar o crear message board para el proyecto
            const boardBcId = projectBcId + 2000
            const { data: brdData } = await supabaseAdmin
                .from('bc_message_boards')
                .upsert({
                    bc_id: boardBcId,
                    project_id: projectDbId,
                    created_at: new Date().toISOString()
                }, { onConflict: 'bc_id' })
                .select('id')
                .single()

            if (!brdData) continue
            const boardDbId = brdData.id

            // Título de la página
            const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i)
            const title = titleMatch ? titleMatch[1].trim() : 'Sin Título'

            // Autor
            const authorMatch = content.match(/data-avatar-for-person-id="(\d+)"/i)
            const authorBcId = authorMatch ? parseInt(authorMatch[1]) : 43166202
            const authorUuid = dbPeopleMap[authorBcId] || dbPeopleMap[43166202]

            // Fecha
            const dateMatch = content.match(/datetime="([^"]+)"/i)
            const createdDate = dateMatch ? dateMatch[1] : new Date().toISOString()

            // Cuerpo del mensaje
            const bodyMatch = content.match(/<div class="formatted_content formatted_content--large">([\s\S]+?)<\/div>/i)
            const bodyHtml = bodyMatch ? bodyMatch[1].trim() : ''

            // Contar comentarios
            const commentsBlock = content.match(/<section class="thread thread--comments">([\s\S]+?)<\/section>/i)
            let commentCount = 0
            if (commentsBlock) {
                const commentMatches = commentsBlock[1].match(/<article[^>]+data-type="comment"/g)
                commentCount = commentMatches ? commentMatches.length : 0
            }

            // Upsert bc_messages
            const { data: msgData, error: msgErr } = await supabaseAdmin
                .from('bc_messages')
                .upsert({
                    bc_id: messageBcId,
                    project_id: projectDbId,
                    board_id: boardDbId,
                    title: title,
                    content: bodyHtml,
                    category: title.toLowerCase().includes('aviso') || title.toLowerCase().includes('informar') ? 'Announcement' : 'FYI',
                    author_person_id: authorUuid,
                    comments_count: commentCount,
                    created_at: createdDate,
                    updated_at: createdDate
                }, { onConflict: 'bc_id' })
                .select('id')
                .single()

            if (msgErr) {
                console.error(`❌ Error guardando mensaje ${title}:`, msgErr.message)
                continue
            }
            console.log(`   ✅ Guardado mensaje: "${title}" (${commentCount} comentarios)`)

            const messageDbId = msgData.id

            // Parsear comentarios del mensaje
            if (commentsBlock) {
                const commentRegex = /<article[^>]+data-recording-id="(\d+)"[^>]+data-creator-id="(\d+)"[^>]+data-type="comment"[^>]*>[\s\S]*?<time[^>]+datetime="([^"]+)"[\s\S]*?<div class="formatted_content">([\s\S]+?)<\/div>/g
                let comMatch
                const commentsToInsert: any[] = []

                while ((comMatch = commentRegex.exec(commentsBlock[1])) !== null) {
                    const comBcId = parseInt(comMatch[1])
                    const creatorBcId = parseInt(comMatch[2])
                    const datetime = comMatch[3]
                    const body = comMatch[4].trim()

                    const comAuthorUuid = dbPeopleMap[creatorBcId] || dbPeopleMap[43166202]

                    commentsToInsert.push({
                        bc_id: comBcId,
                        project_id: projectDbId,
                        parent_type: 'message',
                        parent_id: messageDbId,
                        content: body,
                        author_person_id: comAuthorUuid,
                        created_at: datetime
                    })
                }

                if (commentsToInsert.length > 0) {
                    const { error: cErr } = await supabaseAdmin
                        .from('bc_comments')
                        .upsert(commentsToInsert, { onConflict: 'bc_id' })
                    if (cErr) {
                        console.error(`❌ Error guardando comentarios para el mensaje ${title}:`, cErr.message)
                    } else {
                        console.log(`      ✅ Guardados ${commentsToInsert.length} comentarios`)
                    }
                }
            }
        }
    }

    console.log('🎉 [Basecamp Import] Sincronización e Importación completadas con éxito!')
}

run().catch(err => {
    console.error('❌ [Basecamp Import] Error fatal:', err)
})
