import { NameplateData } from './types'

const STORAGE_KEY = 'np_board'
const TOKEN_KEY = 'np_visitor_token'
const SUBMITTED_TOKEN_KEY = 'np_submitted_token'

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  let token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    token = crypto.randomUUID()
    localStorage.setItem(TOKEN_KEY, token)
  }
  return token
}

function getLocal(): NameplateData[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveLocal(plates: NameplateData[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plates))
}

function markSubmitted(token: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SUBMITTED_TOKEN_KEY, token)
}

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_NAMEPLATE_API_BASE ?? '')
  : ''

export async function fetchNameplates(): Promise<NameplateData[]> {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/nameplates?limit=200`)
      if (res.ok) {
        const data = await res.json()
        return data.nameplates ?? data
      }
    } catch { /* fall through to local */ }
  }
  return getLocal()
}

export async function createNameplate(
  plate: Omit<NameplateData, 'id' | 'createdAt' | 'visitorToken'>,
): Promise<{ ok: boolean; plate?: NameplateData; error?: string }> {
  const token = getToken()

  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/nameplates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...plate, visitorToken: token }),
      })
      if (res.status === 409) {
        markSubmitted(token)
        return { ok: false, error: 'You already placed a nameplate!' }
      }
      if (res.ok) {
        const data = await res.json()
        const createdPlate = data.nameplate ?? data
        markSubmitted(token)
        return { ok: true, plate: createdPlate }
      }
      return { ok: false, error: 'Something went wrong.' }
    } catch {
      /* fall through to local */
    }
  }

  const existing = getLocal()
  if (existing.some(p => p.visitorToken === token)) {
    return { ok: false, error: 'You already placed a nameplate!' }
  }

  const newPlate: NameplateData = {
    ...plate,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    visitorToken: token,
  }
  const updated = [...existing, newPlate]
  saveLocal(updated)
  markSubmitted(token)
  return { ok: true, plate: newPlate }
}

export async function updateNameplatePosition(
  id: string,
  coords: { x: number; y: number; rotation: number },
): Promise<{ ok: boolean }> {
  const token = getToken()
  if (!API_BASE) return { ok: false }

  try {
    const res = await fetch(`${API_BASE}/nameplates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...coords, visitorToken: token }),
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}

export function hasSubmitted(): boolean {
  if (typeof window === 'undefined') return false
  const token = getToken()
  const submittedToken = localStorage.getItem(SUBMITTED_TOKEN_KEY)
  if (submittedToken === token) return true
  const existing = getLocal()
  return existing.some(p => p.visitorToken === token)
}
