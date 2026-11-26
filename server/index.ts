import { DeskThing } from '@deskthing/server'
import { DESKTHING_EVENTS, SETTING_TYPES } from '@deskthing/types'

// ============================ Config ====================================
const API = 'https://api.hypixel.net/v2'
const SB = `${API}/skyblock`
const RES = `${API}/resources/skyblock`
const UA = 'SkyBlockHUD-DeskThing/0.12 (personal dashboard)'
// Tried in order until one works
const LBIN_FULL = [
  { name: 'lb.tricked.pro', url: 'https://lb.tricked.pro/lowestbins' },
  { name: 'moulberry.codes', url: 'https://moulberry.codes/lowestbin.json' },
]
const LBIN_ITEM_URL = 'https://lb.tricked.pro/lowestbin/' // tiny per-item fallback

const MARKET_EVERY_MS = 5 * 60_000 // bazaar + lowest BIN (big downloads)
const MAYOR_EVERY_MS = 60 * 60_000
const SKILLS_EVERY_MS = 12 * 60 * 60_000
const T_SMALL = 10_000
const T_BIG = 25_000
const MAX_BACKOFF_STEPS = 3
const HIST_LEN = 24 // 24 market refreshes ~ 2 hours of sparkline
const RATE_MIN_HOURS = 1 / 6 // show per-hour rates after 10 min of data

const NO_KEY_MSG = 'Enter your Hypixel API Key & UUID in DeskThing App Settings.'

// ============================ Static tables =============================
const cumulative = (inc: number[]) => {
  let t = 0
  return inc.map((x) => (t += x))
}

// Standard SkyBlock skill XP per level (1..60)
const SKILL_CUM = cumulative([
  50, 125, 200, 300, 500, 750, 1000, 1500, 2000, 3500, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000,
  100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000, 1100000, 1200000, 1300000,
  1400000, 1500000, 1600000, 1700000, 1800000, 1900000, 2000000, 2100000, 2200000, 2300000, 2400000, 2500000,
  2600000, 2750000, 2900000, 3100000, 3400000, 3700000, 4000000, 4300000, 4600000, 4900000, 5200000, 5500000,
  5800000, 6100000, 6400000, 6700000, 7000000,
])
const SKILL_CAPS: Record<string, number> = {
  FARMING: 60, MINING: 60, COMBAT: 60, ENCHANTING: 60, FORAGING: 50, FISHING: 50, ALCHEMY: 50, CARPENTRY: 50, TAMING: 50,
}
const SKILL_ORDER = ['FARMING', 'MINING', 'COMBAT', 'FORAGING', 'FISHING', 'ENCHANTING', 'ALCHEMY', 'TAMING', 'CARPENTRY']

// Catacombs / dungeon class XP per level (1..50), +200M per level after that
const CATA_CUM = cumulative([
  50, 75, 110, 160, 230, 330, 470, 670, 950, 1340, 1890, 2665, 3760, 5260, 7380, 10300, 14400, 20000, 27600, 38000,
  52500, 71500, 97000, 132000, 180000, 243000, 328000, 445000, 600000, 800000, 1065000, 1410000, 1900000, 2500000,
  3300000, 4300000, 5600000, 7200000, 9200000, 12000000, 15000000, 19000000, 24000000, 30000000, 38000000, 48000000,
  60000000, 75000000, 93000000, 116250000,
])

const T_NORMAL = [10, 30, 250, 1500, 5000, 20000, 100000, 400000, 1000000]
const SLAYERS = [
  { id: 'zombie', name: 'Revenant', t: [5, 15, 200, 1000, 5000, 20000, 100000, 400000, 1000000] },
  { id: 'spider', name: 'Tarantula', t: [5, 25, 200, 1000, 5000, 20000, 100000, 400000, 1000000] },
  { id: 'wolf', name: 'Sven', t: T_NORMAL },
  { id: 'enderman', name: 'Voidgloom', t: T_NORMAL },
  { id: 'blaze', name: 'Inferno', t: T_NORMAL },
  { id: 'vampire', name: 'Rift Vampire', t: [20, 75, 240, 840, 2400] },
]
const CLASSES = ['healer', 'mage', 'berserk', 'archer', 'tank']
const ESSENCE = ['WITHER', 'DRAGON', 'SPIDER', 'UNDEAD', 'GOLD', 'DIAMOND', 'ICE', 'CRIMSON']

// ============================ State =====================================
let timer: NodeJS.Timeout | null = null
let settingsTimer: NodeJS.Timeout | null = null
let running = false
let stopped = true
let failures = 0
let intervalMs = 2 * 60_000
let lastErr = ''
let lastIdent = ''
let lastLists = ''
let lastRefresh = 2
let latest: any = { type: 'skyblock_error', payload: NO_KEY_MSG }

let skillTbl: Record<string, { cap: number; cum: number[] }> = {}
let skillTblAt = 0
let mayor: any = null
let mayorAt = 0

let marketAt = 0
let bazaarRaw: any = null
let lbinRaw: Record<string, number> | null = null
const hist = new Map<string, number[]>()
let lbinFull = true // false when lbinRaw only holds the watched items
let bzInfo: any = { ok: true }
let lbinInfo: any = { ok: true, src: '' }
let auctionsInfo: any = { ok: true }

let core: any = null // everything from the last good profile poll
let auctions: any = { active: [], ready: [], activeValue: 0, readyValue: 0 }
let baseline: { t: number; coins: number; xp: Record<string, number> } | null = null

process.on('unhandledRejection', (e) => console.error('[SkyBlockHUD] unhandled rejection', e))
process.on('uncaughtException', (e) => console.error('[SkyBlockHUD] uncaught exception', e))

// ============================ Helpers ===================================
const fetchJson = async (url: string, timeoutMs: number, headers?: Record<string, string>) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const splitIds = (s: unknown) =>
  String(s || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)

const readSettings = async () => {
  const s: any = await DeskThing.getSettings()
  return {
    apiKey: String(s?.apiKey?.value || '').trim(),
    uuid: String(s?.uuid?.value || '').replace(/-/g, '').trim().toLowerCase(),
    profileName: String(s?.profileName?.value || '').trim(),
    refreshMin: Math.min(30, Math.max(1, Number(s?.refreshMinutes?.value) || 2)),
    bzIds: splitIds(s?.bazaarWatchlist?.value),
    lbinIds: splitIds(s?.lbinWatchlist?.value),
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10

// level + progress from a cumulative XP table
const levelInfo = (xp: number, cum: number[], cap: number, overflow = 0) => {
  const lim = Math.min(cap, cum.length)
  let level = 0
  while (level < lim && xp >= cum[level]) level++
  if (level >= lim) {
    if (overflow > 0) {
      const over = xp - cum[lim - 1]
      const extra = Math.floor(over / overflow)
      const into = over - extra * overflow
      return { level: lim + extra, pct: r1((into / overflow) * 100), toNext: Math.ceil(overflow - into), maxed: false }
    }
    return { level, pct: 100, toNext: 0, maxed: true }
  }
  const base = level ? cum[level - 1] : 0
  return { level, pct: r1(((xp - base) / (cum[level] - base)) * 100), toNext: Math.ceil(cum[level] - xp), maxed: false }
}

const slayerInfo = (xp: number, t: number[]) => {
  let level = 0
  while (level < t.length && xp >= t[level]) level++
  if (level >= t.length) return { level, pct: 100, toNext: 0, maxed: true }
  const base = level ? t[level - 1] : 0
  return { level, pct: r1(((xp - base) / (t[level] - base)) * 100), toNext: Math.ceil(t[level] - xp), maxed: false }
}

const pushHist = (key: string, v: number) => {
  const a = hist.get(key) || []
  a.push(v)
  if (a.length > HIST_LEN) a.shift()
  hist.set(key, a)
}

// ============================ Publish ===================================
const publish = (msg: any) => {
  latest = msg
  if (msg.type === 'skyblock_error') {
    if (msg.payload === lastErr) return // don't repeat identical errors
    lastErr = msg.payload
  } else {
    lastErr = ''
  }
  try {
    DeskThing.send(msg)
  } catch (e) {
    console.error('[SkyBlockHUD] send failed', e)
  }
}
const publishError = (m: string) => publish({ type: 'skyblock_error', payload: m })

// ============================ Resource data =============================
const loadSkillTable = async () => {
  skillTblAt = Date.now()
  try {
    const j = await fetchJson(`${RES}/skills`, T_SMALL)
    const out: typeof skillTbl = {}
    for (const [k, v] of Object.entries<any>(j?.skills || {})) {
      const cum = (v?.levels || []).map((l: any) => Number(l.totalExpRequired))
      const ok = cum.length >= 20 && cum.every((n: number, i: number) => isFinite(n) && (i === 0 || n > cum[i - 1])) && cum[10] > 10000
      if (ok) out[k] = { cap: Number(v.maxLevel) || cum.length, cum }
    }
    if (Object.keys(out).length) skillTbl = out
  } catch (e) {
    skillTblAt = Date.now() - SKILLS_EVERY_MS + 10 * 60_000 // retry in 10 min
    console.error('[SkyBlockHUD] skill table fetch failed (using built-in table)', e)
  }
}

const loadMayor = async () => {
  mayorAt = Date.now()
  try {
    const j = await fetchJson(`${RES}/election`, T_SMALL)
    const m = j?.mayor
    if (m?.name) mayor = { name: String(m.name), perks: (m.perks || []).map((p: any) => String(p.name)).slice(0, 4) }
  } catch (e) {
    mayorAt = Date.now() - MAYOR_EVERY_MS + 10 * 60_000
    console.error('[SkyBlockHUD] mayor fetch failed', e)
  }
}

// ============================ Market ====================================
const errMsg = (e: any) => (e?.name === 'AbortError' ? 'timed out' : String(e?.message || e))

// Keep sparkline history in step with the watchlists
const syncHist = (bz: string[], lb: string[], pushAll: boolean) => {
  const keep = new Set<string>()
  for (const id of bz) {
    const k = 'bz:' + id
    keep.add(k)
    const v = Math.round(bazaarRaw?.[id]?.quick_status?.buyPrice || 0)
    if (v > 0 && (pushAll || !hist.has(k))) pushHist(k, v)
  }
  for (const id of lb) {
    const k = 'lb:' + id
    keep.add(k)
    const v = Math.round(lbinRaw?.[id] || 0)
    if (v > 0 && (pushAll || !hist.has(k))) pushHist(k, v)
  }
  for (const k of Array.from(hist.keys())) if (!keep.has(k)) hist.delete(k)
}

const loadLbin = async (ids: string[]) => {
  const errs: string[] = []
  for (const src of LBIN_FULL) {
    try {
      const j = await fetchJson(src.url, T_BIG)
      if (!j || typeof j !== 'object' || Object.keys(j).length < 100) throw new Error('unexpected data')
      lbinRaw = j
      lbinFull = true
      return { ok: true, src: src.name }
    } catch (e) {
      errs.push(`${src.name}: ${errMsg(e)}`)
      console.error(`[SkyBlockHUD] lowest BIN source ${src.name} failed`, e)
    }
  }
  // Last resort: ask for just the watched items
  if (ids.length) {
    const out: Record<string, number> = {}
    let good = 0
    await Promise.all(
      ids.slice(0, 12).map(async (id) => {
        try {
          out[id] = Number(await fetchJson(LBIN_ITEM_URL + encodeURIComponent(id), T_SMALL)) || 0
          good++
        } catch (e: any) {
          if (String(e?.message).startsWith('HTTP 4')) { out[id] = 0; good++ } // item simply not listed
        }
      }),
    )
    if (good > 0) {
      lbinRaw = out
      lbinFull = false
      return { ok: true, src: 'lb.tricked.pro (per item)' }
    }
  }
  return { ok: false, src: '', err: errs.join(' | ').slice(0, 160) }
}

const refreshMarket = async (bz: string[], lb: string[]) => {
  try {
    bazaarRaw = (await fetchJson(`${SB}/bazaar`, T_BIG))?.products || {}
    bzInfo = { ok: true }
  } catch (e) {
    bzInfo = { ok: false, err: errMsg(e) }
    console.error('[SkyBlockHUD] bazaar refresh failed', e)
  }
  lbinInfo = await loadLbin(lb)
  const ok = bzInfo.ok && lbinInfo.ok
  // on failure, retry on the next poll instead of waiting the full interval
  marketAt = ok ? Date.now() : Date.now() - MARKET_EVERY_MS + 60_000
  syncHist(bz, lb, true)
}

// ============================ Profile ===================================
const buildCore = (active: any, member: any) => {
  const farmCap = 50 + Number(member?.jacobs_contest?.perks?.farming_level_cap || 0)

  const skills = Object.entries(member?.player_data?.experience || {})
    .filter(([k]) => k.startsWith('SKILL_') && !k.includes('RUNECRAFTING') && !k.includes('SOCIAL'))
    .map(([k, v]) => {
      const key = k.replace('SKILL_', '')
      const tbl = skillTbl[key] || { cap: SKILL_CAPS[key] ?? 50, cum: SKILL_CUM }
      const cap = key === 'FARMING' ? Math.min(tbl.cap, farmCap) : tbl.cap
      const xp = Math.floor(Number(v) || 0)
      return { key, xp, cap, ...levelInfo(xp, tbl.cum, cap) }
    })
    .sort((a, b) => {
      const ia = SKILL_ORDER.indexOf(a.key), ib = SKILL_ORDER.indexOf(b.key)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  const skillAvg = skills.length ? Math.round((skills.reduce((s, x) => s + x.level + (x.maxed ? 0 : x.pct / 100), 0) / skills.length) * 100) / 100 : 0

  const bosses = member?.slayer?.slayer_bosses || {}
  const slayers = SLAYERS.map((s) => {
    const xp = Math.floor(Number(bosses?.[s.id]?.xp) || 0)
    return { id: s.id, name: s.name, xp, ...slayerInfo(xp, s.t) }
  }).filter((s) => s.xp > 0)

  const dg = member?.dungeons
  const cataXp = Number(dg?.dungeon_types?.catacombs?.experience) || 0
  const dungeons = cataXp > 0
    ? {
        xp: Math.floor(cataXp),
        ...levelInfo(cataXp, CATA_CUM, 50, 200_000_000),
        selected: String(dg?.selected_dungeon_class || ''),
        secrets: Number(dg?.secrets) || 0,
        classes: CLASSES.map((c) => {
          const cx = Number(dg?.player_classes?.[c]?.experience) || 0
          return { name: c, ...levelInfo(cx, CATA_CUM, 50, 200_000_000) }
        }),
      }
    : null

  const collections = Object.entries(member?.collection || {})
    .map(([name, amount]) => ({ name, amount: Number(amount) || 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)

  const ess = member?.currencies?.essence || {}
  const essence = ESSENCE.map((n) => ({ name: n, amount: Math.floor(Number(ess?.[n]?.current) || 0) })).filter((e) => e.amount > 0)

  const petList: any[] = member?.pets_data?.pets || []
  const ap = petList.find((p) => p?.active)
  const pet = ap ? { name: String(ap.type || ''), tier: String(ap.tier || '') } : null

  const lvXp = Number(member?.leveling?.experience) || 0

  // Bank: solo profiles keep the balance in member.profile.bank_account; co-ops have a shared
  // bank (profile.banking.balance, only visible with the Banking API on) plus a personal one.
  const personalRaw = member?.profile?.bank_account
  const coopRaw = active?.banking?.balance
  const hasPersonal = typeof personalRaw === 'number'
  const hasCoop = typeof coopRaw === 'number'
  const coopMode = Object.keys(active?.members || {}).length > 1
  const bank = Math.floor(coopMode ? (hasCoop ? coopRaw : 0) : hasPersonal ? personalRaw : hasCoop ? coopRaw : 0)
  const personalBank = coopMode && hasPersonal ? Math.floor(personalRaw) : 0
  const bankKnown = hasPersonal || hasCoop

  return {
    profileName: active?.cute_name || 'Unknown',
    profileId: active?.profile_id || '',
    purse: Math.floor(member?.currencies?.coin_purse || 0),
    bank,
    personalBank,
    coopMode,
    coopHidden: coopMode && !hasCoop,
    bankKnown,
    sbLevel: Math.floor(lvXp / 100),
    sbPct: Math.round(lvXp % 100),
    fairy: member?.fairy_soul?.total_collected ?? null,
    skills, skillAvg, slayers, dungeons, collections, essence, pet,
  }
}

const buildAuctions = (list: any[], profileId: string) => {
  const now = Date.now()
  const norm = (x: any) => String(x || '').replace(/-/g, '').toLowerCase()
  const unclaimed = list.filter((a) => !a.claimed)
  const mine = unclaimed.filter((a) => !a.profile_id || !profileId || norm(a.profile_id) === norm(profileId))
  const other = unclaimed.length - mine.length
  const row = (a: any) => ({
    item: String(a.item_name || '?'),
    tier: String(a.tier || ''),
    price: a.bin ? Number(a.starting_bid) || 0 : Math.max(Number(a.starting_bid) || 0, Number(a.highest_bid_amount) || 0),
    bin: !!a.bin,
    bids: a.bids?.length || 0,
    endsInMin: Math.max(0, Math.round((a.end - now) / 60000)),
  })
  const active = mine.filter((a) => a.end > now).sort((a, b) => a.end - b.end).slice(0, 12).map(row)
  const ended = mine.filter((a) => a.end <= now)
  const sold = ended.filter((a) => (Number(a.highest_bid_amount) || 0) > 0)
  const expired = ended.filter((a) => !((Number(a.highest_bid_amount) || 0) > 0))
  const ready = [
    ...sold.map((a) => ({ ...row(a), price: Number(a.highest_bid_amount) || 0, sold: true })),
    ...expired.map((a) => ({ ...row(a), sold: false })),
  ].slice(0, 12)
  return {
    other,
    active,
    ready,
    activeValue: mine.filter((a) => a.end > now).reduce((s, a) => s + row(a).price, 0),
    readyValue: sold.reduce((s, a) => s + (Number(a.highest_bid_amount) || 0), 0),
  }
}

// ============================ Payload ===================================
const buildPayload = () => {
  const now = Date.now()
  const coins = core.purse + core.bank + core.personalBank
  if (!baseline) {
    baseline = { t: now, coins, xp: Object.fromEntries(core.skills.map((s: any) => [s.key, s.xp])) }
  }
  const hours = (now - baseline.t) / 3_600_000
  const rated = hours >= RATE_MIN_HOURS
  const coinsDelta = coins - baseline.coins

  const skills = core.skills.map((s: any) => {
    if (baseline!.xp[s.key] === undefined) baseline!.xp[s.key] = s.xp
    const gain = s.xp - baseline!.xp[s.key]
    return { ...s, gain, perHr: rated && gain > 0 ? Math.round(gain / hours) : 0 }
  })

  const bazaar = (core.bzIds as string[]).map((id) => {
    const q = bazaarRaw?.[id]?.quick_status
    const buy = Math.round(q?.buyPrice || 0), sell = Math.round(q?.sellPrice || 0)
    return { id, buy, sell, hist: hist.get('bz:' + id) || [] }
  })
  const lowestBins = (core.lbinIds as string[]).map((id) => ({
    id, price: Math.round(lbinRaw?.[id] || 0), hist: hist.get('lb:' + id) || [],
  }))

  return {
    ...core,
    bzIds: undefined,
    lbinIds: undefined,
    skills,
    session: {
      minutes: Math.round(hours * 60),
      coinsDelta,
      coinsPerHr: rated && coinsDelta !== 0 ? Math.round(coinsDelta / hours) : null,
    },
    mayor,
    market: { bz: bzInfo, lbin: lbinInfo },
    bazaar,
    lowestBins,
    auctions,
    auctionsInfo,
    checkedAt: now,
    tzMin: -new Date().getTimezoneOffset(), // PC's UTC offset (DST-aware); the Car Thing has no timezone data
  }
}

const resetSession = () => {
  baseline = null
  if (core) publish({ type: 'skyblock_data', payload: buildPayload() })
}

// ============================ Poll ======================================
const poll = async (): Promise<boolean> => {
  const cfg = await readSettings()
  intervalMs = cfg.refreshMin * 60_000

  if (!cfg.apiKey || !cfg.uuid) {
    publishError(NO_KEY_MSG)
    return true
  }
  const headers = { 'API-Key': cfg.apiKey }

  if (Date.now() - skillTblAt > SKILLS_EVERY_MS) await loadSkillTable()
  if (Date.now() - mayorAt > MAYOR_EVERY_MS) await loadMayor()

  // --- profile (required) ---
  const prof = await fetchJson(`${SB}/profiles?uuid=${cfg.uuid}`, T_SMALL, headers)
  if (prof?.success === false) throw new Error(prof.cause || 'Hypixel rejected the request')
  const profiles: any[] = prof?.profiles || []
  const want = cfg.profileName.toLowerCase()
  const active =
    (want && profiles.find((p) => String(p.cute_name).toLowerCase() === want)) ||
    profiles.find((p) => p.selected) ||
    profiles[0]
  const member = active?.members?.[cfg.uuid]
  if (!member) throw new Error('No SkyBlock profile found. Check the UUID and that API access is enabled in-game.')
  core = { ...buildCore(active, member), bzIds: cfg.bzIds, lbinIds: cfg.lbinIds }

  // --- auctions (optional) ---
  try {
    const ah = await fetchJson(`${SB}/auction?player=${cfg.uuid}`, T_SMALL, headers)
    if (ah?.success === false) throw new Error(ah.cause || 'Hypixel rejected the request')
    auctions = buildAuctions(ah?.auctions || [], core.profileId)
    auctionsInfo = { ok: true }
  } catch (e) {
    auctionsInfo = { ok: false, err: errMsg(e) }
    console.error('[SkyBlockHUD] auction fetch failed', e)
  }

  // --- market (optional, big, infrequent) ---
  const needMarket =
    Date.now() - marketAt > MARKET_EVERY_MS ||
    !bazaarRaw ||
    !lbinRaw ||
    (!lbinFull && cfg.lbinIds.some((id) => !(id in (lbinRaw as Record<string, number>))))
  if (needMarket) publish({ type: 'skyblock_data', payload: buildPayload() }) // show player data right away
  if (needMarket) await refreshMarket(cfg.bzIds, cfg.lbinIds)

  publish({ type: 'skyblock_data', payload: buildPayload() })
  return true
}

// ============================ Scheduler =================================
const schedule = (ms: number) => {
  if (timer) clearTimeout(timer)
  if (stopped) return
  timer = setTimeout(loop, ms)
}

const loop = async () => {
  if (stopped) return
  if (running) return schedule(5_000)
  running = true
  let ok = true
  try {
    ok = await poll()
  } catch (e: any) {
    ok = false
    publishError('API Fetch Failed: ' + (e?.name === 'AbortError' ? 'timed out' : e?.message || e))
  } finally {
    running = false
  }
  failures = ok ? 0 : Math.min(failures + 1, MAX_BACKOFF_STEPS)
  schedule(intervalMs * 2 ** failures)
}

// ============================ Settings ==================================
const setupSettings = async () => {
  await DeskThing.initSettings({
    apiKey: { id: 'apiKey', label: 'Hypixel API Key', type: SETTING_TYPES.STRING, value: '', description: 'Get from developer.hypixel.net' },
    uuid: { id: 'uuid', label: 'Minecraft UUID (No Dashes)', type: SETTING_TYPES.STRING, value: '', description: 'Trimmed UUID from mcuuid.net' },
    profileName: { id: 'profileName', label: 'Profile Name (optional)', type: SETTING_TYPES.STRING, value: '', description: 'Leave empty to use your selected profile, or type a fruit name like Banana' },
    refreshMinutes: { id: 'refreshMinutes', label: 'Refresh Every (minutes)', type: SETTING_TYPES.NUMBER, value: 2, min: 1, max: 30, description: 'How often to check Hypixel (1-30)' },
    bazaarWatchlist: { id: 'bazaarWatchlist', label: 'Bazaar Item IDs (comma-separated)', type: SETTING_TYPES.STRING, value: 'BOOSTER_COOKIE,RECOMBOBULATOR_3000,ENCHANTED_DIAMOND_BLOCK', description: 'SkyBlock Bazaar IDs to track' },
    lbinWatchlist: { id: 'lbinWatchlist', label: 'Lowest BIN Item IDs (comma-separated)', type: SETTING_TYPES.STRING, value: 'HYPERION,NECRON_CHESTPLATE,TERMINATOR,GOLDEN_DRAGON', description: 'Item IDs for Lowest BIN prices' },
  })
}

type Cfg = Awaited<ReturnType<typeof readSettings>>
const identOf = (c: Cfg) => JSON.stringify([c.apiKey, c.uuid, c.profileName])
const listsOf = (c: Cfg) => JSON.stringify([c.bzIds, c.lbinIds])

// Settings saved in DeskThing: watchlist edits apply instantly from cached
// market data (no restart, no re-download). Key/UUID/profile changes re-poll.
const onSettings = () => {
  if (stopped) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(async () => {
    try {
      const c = await readSettings()
      const identChanged = identOf(c) !== lastIdent
      const listsChanged = listsOf(c) !== lastLists
      const refreshChanged = c.refreshMin !== lastRefresh
      if (!identChanged && !listsChanged && !refreshChanged) return
      lastIdent = identOf(c)
      lastLists = listsOf(c)
      lastRefresh = c.refreshMin
      intervalMs = c.refreshMin * 60_000

      if (identChanged || !core) {
        baseline = null
        marketAt = 0
        failures = 0
        schedule(500)
        return
      }
      if (listsChanged) {
        core.bzIds = c.bzIds
        core.lbinIds = c.lbinIds
        const raw = lbinRaw as Record<string, number> | null
        const haveAll = bazaarRaw && raw && (lbinFull || c.lbinIds.every((id) => id in raw))
        if (haveAll) {
          syncHist(c.bzIds, c.lbinIds, false)
          publish({ type: 'skyblock_data', payload: buildPayload() })
        } else {
          marketAt = 0
          schedule(500)
          return
        }
      }
      if (refreshChanged) schedule(intervalMs)
    } catch (e) {
      console.error('[SkyBlockHUD] settings read failed', e)
    }
  }, 1500)
}

// ============================ Lifecycle =================================
const start = async () => {
  if (!stopped) return
  stopped = false
  failures = 0
  try {
    await setupSettings()
    const c = await readSettings()
    lastIdent = identOf(c)
    lastLists = listsOf(c)
    lastRefresh = c.refreshMin
  } catch (e) {
    console.error('[SkyBlockHUD] setup failed', e)
  }
  schedule(0)
}

const stop = async () => {
  stopped = true
  if (timer) clearTimeout(timer)
  if (settingsTimer) clearTimeout(settingsTimer)
  timer = settingsTimer = null
  bazaarRaw = null
  lbinRaw = null
  marketAt = 0
  hist.clear()
  baseline = null
  core = null
  lastErr = ''
  lbinFull = true
  bzInfo = { ok: true }
  lbinInfo = { ok: true, src: '' }
  auctionsInfo = { ok: true }
}

DeskThing.on(DESKTHING_EVENTS.START, start)
DeskThing.on(DESKTHING_EVENTS.STOP, stop)
DeskThing.on(DESKTHING_EVENTS.SETTINGS, onSettings)
DeskThing.on('get', (data: any) => {
  try {
    if (data?.request === 'skyblock_data') DeskThing.send(latest)
    else if (data?.request === 'reset_session') resetSession()
  } catch (e) {
    console.error('[SkyBlockHUD] get handler failed', e)
  }
})
