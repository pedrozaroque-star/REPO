/**
 * @module lib/basecamp-person-resolver
 * @description Resolves any authenticated Tacos Gavilan (TEG) user to their corresponding
 *              `bc_people` record in Supabase, healing masked Basecamp emails (`e•••@•••`)
 *              and fuzzy-matching Spanish name variations (Erick/Erik, Velazquez/Velasquez,
 *              Nunez/Nuñez, Alex/Alejandro, first-name-only records, etc.).
 *              Also provides helpers to stamp and parse real TEG author attribution when
 *              mirroring actions to the Basecamp 3 API via the shared company OAuth token.
 *
 * @businessRules
 * - Basecamp 3 API masks employee emails (`e•••@••••••••••••.•••`) and uses a single company
 *   OAuth token (owned by Carlos). Therefore:
 *   1. Local TEG authorship (`created_by_person_id` / `author_person_id`) must ALWAYS resolve
 *      to the actual logged-in TEG user (auto-creating a `bc_people` record if the user does
 *      not have a Basecamp 3 account).
 *   2. Background syncs, webhooks, and detail hydration must NEVER overwrite an existing
 *      local TEG creator/author with the OAuth token owner.
 *   3. Payloads mirrored to Basecamp 3 API include a clean attribution line when the author
 *      is not the OAuth token owner, so users viewing Basecamp 3 directly also see who
 *      submitted the case/order/comment.
 *
 * @dataFlow
 * - `resolveOrCreateTegPerson(supabase, user)` -> `{ id: string, bc_id: number | null, name: string, email: string }`
 */

export interface ResolvedBcPerson {
  id: string
  bc_id: number | null
  name: string
  email: string
}

/**
 * Normalizes a person name for resilient comparison across TEG `users` and Basecamp `bc_people`.
 * Handles accents/diacritics and common spelling variations across the organization.
 */
export function normalizePersonName(raw?: string | null): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Strip accents (á->a, ñ->n, etc.)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\berick\b/g, 'erik')
    .replace(/\bvelazquez\b/g, 'velasquez')
    .replace(/\bgonzalez\b/g, 'gonzales')
    .replace(/\bfransisco\b/g, 'francisco')
    .replace(/\balejandro\b/g, 'alex')
    .replace(/\bfreddie\b/g, 'freddy')
    .replace(/\bteg\s+bell\b/g, 'bell')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Synthetic `bc_id` threshold (`100_000_000_000` / `1e11`).
 * Real Basecamp 3 IDs are 9–11 digits (< 1e11), whereas locally generated IDs
 * (`Date.now() * 1000 + rand`) are ~1.7e15 (>= 1e11).
 */
export const SYNTHETIC_BC_ID_THRESHOLD = 100_000_000_000

export function isRealBasecampId(bcId?: number | string | null): boolean {
  const n = Number(bcId)
  return Number.isFinite(n) && n > 0 && n < SYNTHETIC_BC_ID_THRESHOLD
}

/**
 * Checks whether an email returned by Basecamp 3 API is masked (contains bullet characters) or empty.
 */
export function isMaskedOrEmptyEmail(email?: string | null): boolean {
  if (!email) return true
  const trimmed = email.trim()
  return trimmed.length === 0 || trimmed.includes('•') || trimmed.includes('*')
}

/**
 * Finds a person in an in-memory `bc_people` list using:
 * - Pass 1: Case-insensitive unmasked email match (when `targetEmail` provided)
 * - Pass 2: Normalized full-name match (Erick/Erik, Velazquez/Velasquez, Nuñez/Nunez, Alejandro/Alex)
 * - Pass 3: Unambiguous first-name or first-name + single-letter last-initial match (e.g. "Victor Muñoz" <-> "Victor M", "Marco Salgado" <-> "Marco")
 */
export function findPersonInListByFuzzyName<
  T extends { id: string; name?: string | null; email?: string | null }
>(people: T[], targetName?: string | null, targetEmail?: string | null): T | null {
  if (!Array.isArray(people) || people.length === 0) return null

  const cleanEmail = (targetEmail || '').trim().toLowerCase()
  if (cleanEmail && !isMaskedOrEmptyEmail(cleanEmail)) {
    const byEmail = people.find(
      (p) => !isMaskedOrEmptyEmail(p.email) && String(p.email).trim().toLowerCase() === cleanEmail
    )
    if (byEmail) return byEmail
  }

  const normTarget = normalizePersonName(targetName)
  if (!normTarget) return null

  // Pass 2: Exact normalized full-name match
  const exactMatch = people.find((p) => normalizePersonName(p.name) === normTarget)
  if (exactMatch) return exactMatch

  // Pass 3: Unambiguous first-name or first-name + last-initial match
  const targetTokens = normTarget.split(' ').filter(Boolean)
  if (targetTokens.length === 0) return null

  const targetFirst = targetTokens[0]
  const targetLast = targetTokens.length > 1 ? targetTokens[targetTokens.length - 1] : ''

  const candidates = people.filter((p) => {
    const normP = normalizePersonName(p.name)
    const pTokens = normP.split(' ').filter(Boolean)
    if (pTokens.length === 0) return false

    // Special single-token containment (e.g. "Bell" <-> "Teg Bell")
    if (targetTokens.length === 1 && pTokens.includes(targetFirst)) return true

    const pFirst = pTokens[0]
    if (pFirst !== targetFirst) return false

    if (pTokens.length === 1 || targetTokens.length === 1) return true

    const pLast = pTokens[pTokens.length - 1]
    if (pLast.length === 1 && targetLast.startsWith(pLast)) return true
    if (targetLast.length === 1 && pLast.startsWith(targetLast)) return true

    return false
  })

  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Resolves a logged-in TEG user (`{ email, name, role }`) to a row in `bc_people`.
 * - Pass 1: Exact unmasked email match (case-insensitive)
 * - Pass 2: Normalized full-name match (e.g. "Erick Martinez" <-> "Erik Martinez", "Eloy Velazquez" <-> "Eloy Velasquez")
 * - Pass 3: Unambiguous first-name or first-name + last-initial match (e.g. "Victor Muñoz" <-> "Victor M", "Marco Salgado" <-> "Marco")
 * - Auto-heals masked emails in `bc_people` when matched by Pass 2 or Pass 3.
 * - Pass 4: Auto-creates a `bc_people` record if the TEG user does not exist in `bc_people` yet.
 */
export async function resolveOrCreateTegPerson(
  supabase: any,
  user: { email?: string | null; name?: string | null; role?: string | null }
): Promise<ResolvedBcPerson | null> {
  const userEmail = (user.email || '').trim().toLowerCase()
  const userName = (user.name || '').trim()

  if (!userEmail && !userName) return null

  const { data: allPeople, error } = await supabase
    .from('bc_people')
    .select('id, bc_id, name, email, is_active')
    .limit(5000)

  if (error) {
    console.warn('⚠️ [Basecamp Person Resolver] Failed to query bc_people:', error.message)
  }

  const people: any[] = allPeople || []

  // Pass 1: Exact email match
  if (userEmail) {
    const byEmail = people.find(
      (p) => !isMaskedOrEmptyEmail(p.email) && String(p.email).trim().toLowerCase() === userEmail
    )
    if (byEmail) {
      return {
        id: byEmail.id,
        bc_id: byEmail.bc_id ? Number(byEmail.bc_id) : null,
        name: userName || byEmail.name,
        email: userEmail,
      }
    }
  }

  // Pass 2 + Pass 3: Normalized full-name & unambiguous first-name / last-initial match
  const matchedPerson = findPersonInListByFuzzyName(people, userName)

  if (matchedPerson) {
    // Auto-heal masked email in bc_people so future queries match in Pass 1
    if (userEmail && isMaskedOrEmptyEmail(matchedPerson.email)) {
      await supabase
        .from('bc_people')
        .update({ email: userEmail, updated_at: new Date().toISOString() })
        .eq('id', matchedPerson.id)
    }

    return {
      id: matchedPerson.id,
      bc_id: matchedPerson.bc_id ? Number(matchedPerson.bc_id) : null,
      name: userName || matchedPerson.name,
      email: userEmail || matchedPerson.email || '',
    }
  }

  // Pass 4: Auto-create a bc_people record for this TEG user so authorPersonId is never null
  const syntheticBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
  const displayName = userName || userEmail.split('@')[0] || 'Usuario TEG'

  const { data: createdPerson, error: insertErr } = await supabase
    .from('bc_people')
    .insert({
      bc_id: syntheticBcId,
      name: displayName,
      email: userEmail,
      avatar_url: '',
      role: 'employee',
      title: user.role || 'TEG',
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select('id, bc_id, name, email')
    .maybeSingle()

  if (insertErr || !createdPerson) {
    console.warn('⚠️ [Basecamp Person Resolver] Failed to auto-create bc_people record:', insertErr?.message)
    return null
  }

  console.log(`✅ [Basecamp Person Resolver] Created bc_people profile for TEG user "${displayName}" (${userEmail}) -> ${createdPerson.id}`)
  return {
    id: createdPerson.id,
    bc_id: Number(createdPerson.bc_id),
    name: createdPerson.name,
    email: createdPerson.email || userEmail,
  }
}

/**
 * Returns true if the given user is the owner of the shared Basecamp OAuth token (Carlos).
 */
export function isBasecampOAuthOwner(email?: string | null, name?: string | null): boolean {
  const e = (email || '').trim().toLowerCase()
  if (e === 'carlos@tacosgavilan.com') return true
  const norm = normalizePersonName(name)
  return norm === 'carlos roque velasquez' || norm === 'carlos roque'
}

/**
 * Formats an HTML attribution header to prepend when mirroring a To-do description,
 * comment, or message to the Basecamp 3 API on behalf of another TEG user.
 */
export function buildBasecampDescriptionWithAuthor(
  descriptionHtml: string | undefined | null,
  authorName: string,
  authorEmail?: string | null
): string {
  const cleanDesc = (descriptionHtml || '').trim()
  if (!authorName || isBasecampOAuthOwner(authorEmail, authorName)) {
    return cleanDesc
  }
  const stamp = `<p data-teg-author="${authorName}"><em>👤 Solicitado por: <strong>${authorName}</strong> (Sistema TEG)</em></p>`
  if (cleanDesc.includes('Solicitado por:')) return cleanDesc
  return cleanDesc ? `${stamp}${cleanDesc}` : stamp
}

/**
 * Formats an HTML comment/message body with author attribution for Basecamp 3 API.
 */
export function buildBasecampCommentWithAuthor(
  contentHtml: string,
  authorName: string,
  authorEmail?: string | null
): string {
  const cleanContent = (contentHtml || '').trim()
  if (!authorName || isBasecampOAuthOwner(authorEmail, authorName)) {
    return cleanContent
  }
  if (cleanContent.includes(`<strong>👤 ${authorName}:</strong>`)) return cleanContent
  return `<p data-teg-author="${authorName}"><strong>👤 ${authorName}:</strong></p>${cleanContent}`
}

/**
 * Strips the Basecamp-only attribution banner from HTML when displaying or syncing back to TEG,
 * since TEG already displays the real creator's native avatar and name.
 */
export function stripTegAuthorBanner(html?: string | null): {
  cleanHtml: string
  extractedAuthorName: string | null
} {
  if (!html) return { cleanHtml: '', extractedAuthorName: null }

  let extractedAuthorName: string | null = null

  // Match data-teg-author attribute or visible "👤 Solicitado por: <strong>Name</strong>" / "<strong>👤 Name:</strong>"
  const attrMatch = html.match(/data-teg-author=["']([^"']+)["']/i)
  const solMatch = html.match(/👤\s*Solicitado por:\s*<strong>([^<]+)<\/strong>/i)
  const comMatch = html.match(/<strong>\s*👤\s*([^<:]+):\s*<\/strong>/i)

  if (attrMatch?.[1]?.trim()) {
    extractedAuthorName = attrMatch[1].trim()
  } else if (solMatch?.[1]?.trim()) {
    extractedAuthorName = solMatch[1].trim()
  } else if (comMatch?.[1]?.trim()) {
    extractedAuthorName = comMatch[1].trim()
  }

  const cleanHtml = html
    .replace(/<(?:p|div)\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/(?:p|div)>/gi, '')
    .replace(/<(?:p|div)\b[^>]*>\s*<em>\s*👤\s*Solicitado por:\s*<strong>[^<]+<\/strong>\s*\(Sistema TEG\)\s*<\/em>\s*<\/(?:p|div)>/gi, '')
    .replace(/<(?:p|div)\b[^>]*>\s*<strong>\s*👤\s*[^<:]+:\s*<\/strong>\s*<\/(?:p|div)>/gi, '')
    .trim()

  return { cleanHtml, extractedAuthorName }
}
