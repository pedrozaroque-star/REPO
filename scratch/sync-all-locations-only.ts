import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import {
  fetchProjects,
  fetchPeople,
  fetchProjectPeople,
  fetchTodoLists,
  fetchAllTodos,
  fetchMessages,
  fetchCampfireLines,
  fetchDocuments,
  fetchUploads,
  fetchSubVaults,
  fetchScheduleEntries,
  fetchQuestions,
  fetchAnswers,
  fetchComments,
  findDock,
  extractDockId,
} from '../lib/basecamp-api'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
)

async function run() {
  console.log('🔄 Starting sync for project "All Locations" (bc_id: 21853276) ONLY...')
  
  const peopleMap: Record<number, string> = {}
  const projectsMap: Record<number, string> = {}
  const vaultsMap: Record<number, string> = {}
  const documentsMap: Record<number, string> = {}
  const commentsMap: Record<number, string> = {}
  
  // 1. Sync People (required to resolve FKs)
  try {
    const people = await fetchPeople()
    console.log(`👥 Found ${people.length} people. Syncing...`)
    if (people.length > 0) {
      const peopleRows = people.map((p) => ({
        bc_id: p.id,
        name: p.name,
        email: p.email_address,
        avatar_url: p.avatar_url,
        role: p.employee ? 'employee' : p.client ? 'client' : 'user',
        title: p.title || '',
        is_active: p.status !== 'archived',
        updated_at: new Date().toISOString(),
      }))
      await supabase.from('bc_people').upsert(peopleRows, { onConflict: 'bc_id' })
    }
    
    const { data: dbPeople } = await supabase.from('bc_people').select('id, bc_id')
    dbPeople?.forEach((p) => { peopleMap[Number(p.bc_id)] = p.id })
  } catch (err: any) {
    console.error('❌ People sync failed:', err.message)
  }

  // 2. Fetch Projects and filter to All Locations
  let projects = await fetchProjects()
  projects = projects.filter(p => p.id === 21853276)
  if (projects.length === 0) {
    console.log('❌ Project 21853276 not found in Basecamp account!')
    return
  }

  const project = projects[0]
  console.log(`📂 Found project "${project.name}" (bc_id: ${project.id})`)

  // Upsert the project
  const { data: dbProj } = await supabase
    .from('bc_projects')
    .upsert({
      bc_id: project.id,
      name: project.name,
      description: project.description || '',
      color: 'white',
      is_pinned: project.bookmarked || false,
      is_archived: project.status === 'archived',
      member_count: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'bc_id' })
    .select('id')
    .single()

  const projectUuid = dbProj!.id
  projectsMap[project.id] = projectUuid

  // Sync Memberships
  try {
    const members = await fetchProjectPeople(project.id)
    if (members && members.length > 0) {
      const membershipRows = members
        .map((m) => {
          const personUuid = peopleMap[m.id]
          if (!personUuid) return null
          return {
            project_id: projectUuid,
            person_id: personUuid,
            role: m.employee ? 'employee' : m.client ? 'client' : 'user',
          }
        })
        .filter((row) => row !== null)

      if (membershipRows.length > 0) {
        await supabase.from('bc_memberships').upsert(membershipRows, { onConflict: 'project_id,person_id' })
        await supabase.from('bc_projects').update({ member_count: membershipRows.length }).eq('id', projectUuid)
      }
    }
  } catch (err: any) {
    console.warn('⚠️ Memberships sync skipped:', err.message)
  }

  // Recursive Vault Sync Function
  async function syncVaultContents(
    projectId: number,
    projectUuid: string,
    vaultId: number,
    vaultUuid: string
  ) {
    // A. Sync documents
    try {
      const docs = await fetchDocuments(projectId, vaultId)
      console.log(`   📄 Vault ${vaultId}: Found ${docs.length} documents`)
      for (const d of docs) {
        const authorUuid = peopleMap[d.creator?.id] || null
        const { data: dbDoc } = await supabase
          .from('bc_documents')
          .upsert({
            bc_id: d.id,
            project_id: projectUuid,
            vault_id: vaultUuid,
            title: d.title,
            content: d.content || '',
            author_person_id: authorUuid,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'bc_id' })
          .select('id')
          .single()

        const docUuid = dbDoc!.id
        documentsMap[d.id] = docUuid

        if (d.comments_count > 0) {
          const comments = await fetchComments(projectId, d.id)
          const commentRows = comments.map((c) => ({
            bc_id: c.id,
            project_id: projectUuid,
            parent_type: 'document',
            parent_id: docUuid,
            content: c.content || '',
            author_person_id: peopleMap[c.creator?.id] || null,
            created_at: c.created_at || new Date().toISOString(),
          }))
          await supabase.from('bc_comments').upsert(commentRows, { onConflict: 'bc_id' })
        }
      }
    } catch (e: any) {
      console.error(`   ❌ Documents fetch failed for vault ${vaultId}:`, e.message)
    }

    // B. Sync uploads
    try {
      const uploads = await fetchUploads(projectId, vaultId)
      console.log(`   📎 Vault ${vaultId}: Found ${uploads.length} uploads`)
      if (uploads.length > 0) {
        const uploadRows = uploads.map((u) => ({
          bc_id: u.id,
          project_id: projectUuid,
          vault_id: vaultUuid,
          filename: u.filename || u.title,
          content_type: u.content_type || '',
          byte_size: u.byte_size || 0,
          download_url: u.download_url || '',
          author_person_id: peopleMap[u.creator?.id] || null,
          created_at: u.created_at || new Date().toISOString(),
        }))
        await supabase.from('bc_uploads').upsert(uploadRows, { onConflict: 'bc_id' })
      }
    } catch (e: any) {
      console.error(`   ❌ Uploads fetch failed for vault ${vaultId}:`, e.message)
    }

    // C. Sync subvaults (nested folders) recursively
    try {
      const subvaults = await fetchSubVaults(projectId, vaultId)
      console.log(`   📁 Vault ${vaultId}: Found ${subvaults.length} nested folders`)
      for (const sv of subvaults) {
        const { data: dbSubVault } = await supabase
          .from('bc_vaults')
          .upsert({
            bc_id: sv.id,
            project_id: projectUuid,
            name: sv.title || sv.name || 'Folder',
            parent_vault_id: vaultUuid,
            created_at: new Date().toISOString()
          }, { onConflict: 'bc_id' })
          .select('id')
          .single()

        const subVaultUuid = dbSubVault!.id
        vaultsMap[sv.id] = subVaultUuid

        // Recurse!
        await syncVaultContents(projectId, projectUuid, sv.id, subVaultUuid)
      }
    } catch (e: any) {
      console.error(`   ❌ Subvaults fetch failed for vault ${vaultId}:`, e.message)
    }
  }

  // 3. Find and Sync all Vaults in dock
  const vaultDocks = project.dock?.filter((d) => d.name === 'vault' && d.enabled) || []
  console.log(`📂 Found ${vaultDocks.length} root vaults in dock`)

  for (const vaultDock of vaultDocks) {
    const vaultId = extractDockId(vaultDock.url)
    console.log(`📁 Syncing root vault: "${vaultDock.title}" (bc_id: ${vaultId})`)

    const { data: dbVault } = await supabase
      .from('bc_vaults')
      .upsert({
        bc_id: vaultId,
        project_id: projectUuid,
        name: vaultDock.title || 'Docs & Files',
        parent_vault_id: null,
        created_at: new Date().toISOString()
      }, { onConflict: 'bc_id' })
      .select('id')
      .single()

    const vaultUuid = dbVault!.id
    vaultsMap[vaultId] = vaultUuid

    // Sync vault contents recursively
    await syncVaultContents(project.id, projectUuid, vaultId, vaultUuid)
  }

  console.log('🎉 Sync for project "All Locations" completed successfully!')
}

run().catch(console.error)
