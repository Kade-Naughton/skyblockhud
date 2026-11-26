import { memo, useEffect, useState } from 'react'
import { DeskThing } from '@deskthing/client'

type Tab = 'home' | 'skills' | 'combat' | 'collect' | 'market' | 'ah'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'skills', label: 'Skills' },
  { id: 'combat', label: 'Combat' },
  { id: 'collect', label: 'Collect' },
  { id: 'market', label: 'Market' },
  { id: 'ah', label: 'Auctions' },
]

const SKILL_COLOR: Record<string, string> = {
  FARMING: '#7bd86b', MINING: '#9fb7d0', COMBAT: '#ef6a5b', FORAGING: '#4fae6a', FISHING: '#4aa8f0',
  ENCHANTING: '#b78cf2', ALCHEMY: '#f08cc4', CARPENTRY: '#d9a066', TAMING: '#f2c14e',
}
const SLAYER_COLOR: Record<string, string> = {
  zombie: '#7bd86b', spider: '#a58cf2', wolf: '#d4d9e2', enderman: '#c26cf0', blaze: '#f59e42', vampire: '#ef6a5b',
}
const TIER_COLOR: Record<string, string> = {
  COMMON: '#d4d9e2', UNCOMMON: '#5fd68a', RARE: '#5a8ff5', EPIC: '#b78cf2', LEGENDARY: '#f5b942',
  MYTHIC: '#f08cc4', DIVINE: '#5ae6e6', SPECIAL: '#ef6a5b', VERY_SPECIAL: '#ef6a5b', ULTIMATE: '#ef6a5b',
}
const COLLECTION_NAMES: Record<string, string> = {
  'INK_SACK:3': 'Cocoa Beans', 'INK_SACK:4': 'Lapis Lazuli', LOG: 'Oak Log', 'LOG:1': 'Spruce Log',
  'LOG:2': 'Birch Log', 'LOG:3': 'Jungle Log', LOG_2: 'Acacia Log', 'LOG_2:1': 'Dark Oak Log',
  CARROT_ITEM: 'Carrot', POTATO_ITEM: 'Potato', MUSHROOM_COLLECTION: 'Mushroom', SUGAR_CANE: 'Sugar Cane',
  RAW_FISH: 'Raw Fish', 'RAW_FISH:1': 'Raw Salmon', 'RAW_FISH:2': 'Clownfish', 'RAW_FISH:3': 'Pufferfish',
}
const SB_MONTHS = ['Early Spring', 'Spring', 'Late Spring', 'Early Summer', 'Summer', 'Late Summer',
  'Early Autumn', 'Autumn', 'Late Autumn', 'Early Winter', 'Winter', 'Late Winter']

const fmt = (n: number) => {
  const a = Math.abs(n)
  if (!n) return '0'
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n))
const pretty = (id: string) =>
  COLLECTION_NAMES[id] || id.toLowerCase().replace(/[_:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`)
const chg = (v: number[]) => (v && v.length > 1 && v[0] ? ((v[v.length - 1] - v[0]) / v[0]) * 100 : 0)

// Format a time as "3:30 PM" using the PC's UTC offset (the Car Thing's browser has no timezone data)
const clock = (ms: number, tzMin?: number) => {
  if (tzMin === undefined) return ''
  const d = new Date(ms + tzMin * 60_000)
  const h = d.getUTCHours()
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const sbDate = () => {
  const s = Date.now() / 1000 - 1560275700
  const year = Math.floor(s / 446400) + 1
  const inYear = s % 446400
  return `${SB_MONTHS[Math.floor(inYear / 37200)]} ${Math.floor((inYear % 37200) / 1200) + 1}, Year ${year}`
}

const useNow = (ms: number) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/* ---------------- small pieces ---------------- */
const Bar = memo(({ pct, color }: { pct: number; color: string }) => (
  <div className="bar"><i style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`, background: color }} /></div>
))

const Spark = memo(({ v, color }: { v: number[]; color: string }) => {
  if (!v || v.length < 2) return <span className="spk" />
  const min = Math.min(...v), max = Math.max(...v), r = max - min || 1
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * 58 + 1).toFixed(1)},${(17 - ((y - min) / r) * 16).toFixed(1)}`).join(' ')
  return (
    <svg className="spk" viewBox="0 0 60 18">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
})

const Change = ({ v }: { v: number[] }) => {
  const c = chg(v)
  if (v.length < 2) return <span className="muted">-</span>
  return <span className={c > 0.05 ? 'green' : c < -0.05 ? 'red' : 'muted'}>{c > 0 ? '+' : ''}{c.toFixed(1)}%</span>
}

const Clock = ({ tz }: { tz?: number }) => {
  const now = useNow(15000)
  return <div className="clock">{clock(now, tz)}</div>
}

const Footer = ({ at, tz }: { at?: number; tz?: number }) => {
  const now = useNow(15000)
  const stale = at ? now - at > 10 * 60_000 : false
  return (
    <div className="foot">
      <span>{sbDate()}</span>
      <span className={stale ? 'stale' : ''}>
        {at ? `${stale ? 'Stale - last update ' : 'Updated '}${clock(at, tz)}` : 'Waiting for data...'}
      </span>
    </div>
  )
}

/* ---------------- tabs ---------------- */
const Home = memo(({ d }: { d: any }) => {
  const s = d.session
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="g3">
        <div className="card"><div className="lbl">PURSE</div><div className="big gold">{fmt(d.purse)}</div></div>
        <div className="card">
          <div className="lbl">BANK</div>
          <div className="big green">{fmt(d.bank + d.personalBank)}</div>
          {!d.bankKnown ? (
            <div className="sub red">Not visible: turn on Banking API in-game</div>
          ) : d.coopHidden ? (
            <div className="sub red">Co-op bank hidden (Banking API off)</div>
          ) : d.coopMode ? (
            <div className="sub">Co-op {fmt(d.bank)} / personal {fmt(d.personalBank)}</div>
          ) : null}
        </div>
        <div className="card"><div className="lbl">TOTAL COINS</div><div className="big">{fmt(d.purse + d.bank + d.personalBank)}</div></div>
      </div>
      <div className="g3">
        <div className="card">
          <div className="lbl">SKYBLOCK LEVEL</div>
          <div className="mid" style={{ color: '#5ae6e6' }}>{d.sbLevel} <span className="sub">{d.sbPct}/100 XP</span></div>
          <div style={{ marginTop: 6 }}><Bar pct={d.sbPct} color="#5ae6e6" /></div>
        </div>
        <div className="card">
          <div className="lbl">SKILL AVERAGE</div>
          <div className="mid purple">{d.skillAvg ? d.skillAvg.toFixed(2) : '-'}</div>
          <div className="sub">{d.fairy != null ? `${d.fairy} fairy souls` : d.profileName}</div>
        </div>
        <div className="card">
          <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>SESSION ({dur(s.minutes)})</span>
            <button className="btn" style={{ padding: '0 7px', fontSize: 11 }} onClick={() => DeskThing.send({ type: 'get', request: 'reset_session' })}>Reset</button>
          </div>
          <div className={`mid ${s.coinsDelta > 0 ? 'green' : s.coinsDelta < 0 ? 'red' : ''}`}>{signed(s.coinsDelta)}</div>
          <div className="sub">{s.coinsPerHr != null ? `${signed(s.coinsPerHr)} coins / hour` : 'Rate after 10 min'}</div>
        </div>
      </div>
      <div className="g2">
        <div className="card">
          <div className="lbl">PROFILE &amp; PET</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{d.profileName}</div>
          <div className="sub">{d.pet ? `${pretty(d.pet.name)} (${pretty(d.pet.tier)})` : 'No active pet'}</div>
        </div>
        <div className="card">
          <div className="lbl">MAYOR</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{d.mayor ? d.mayor.name : '-'}</div>
          <div className="sub">{d.mayor ? d.mayor.perks.join(' / ') : 'Not loaded yet'}</div>
        </div>
      </div>
      {d.essence?.length > 0 && (
        <div className="chips">
          {d.essence.map((e: any) => (
            <span className="chip" key={e.name}><span className="muted">{pretty(e.name)}</span> <b>{fmt(e.amount)}</b></span>
          ))}
        </div>
      )}
    </div>
  )
})

const Skills = memo(({ d }: { d: any }) => (
  <div>
    <div className="chips mb">
      <span className="chip">Skill Average <b className="purple">{d.skillAvg ? d.skillAvg.toFixed(2) : '-'}</b></span>
      <span className="chip">Total XP <b>{fmt(d.skills.reduce((a: number, s: any) => a + s.xp, 0))}</b></span>
      <span className="chip muted">Session gains update every refresh</span>
    </div>
    <div className="g2">
      {d.skills.map((s: any) => {
        const c = SKILL_COLOR[s.key] || '#8791a5'
        return (
          <div className="sk" key={s.key}>
            <div className="t">
              <span className="nm" style={{ color: c }}>{pretty(s.key)}</span>
              <span className="lv" style={{ color: s.maxed ? '#f5b942' : undefined }}>{s.maxed ? `Lv ${s.level} MAX` : `Lv ${s.level}`}</span>
            </div>
            <Bar pct={s.pct} color={c} />
            <div className="b">
              <span>{s.maxed ? `${fmt(s.xp)} XP` : `${s.pct.toFixed(1)}% - ${fmt(s.toNext)} to go`}</span>
              <span className="gain">{s.gain > 0 ? `${signed(s.gain)}${s.perHr ? ` - ${fmt(s.perHr)}/h` : ''}` : ''}</span>
            </div>
          </div>
        )
      })}
    </div>
  </div>
))

const Combat = memo(({ d }: { d: any }) => {
  const dg = d.dungeons
  return (
    <div className="g2">
      <div>
        <div className="h gold">Slayers</div>
        <div className="col">
          {d.slayers.length === 0 && <div className="muted">No slayer XP yet</div>}
          {d.slayers.map((s: any) => (
            <div className="sk" key={s.id}>
              <div className="t">
                <span className="nm" style={{ color: SLAYER_COLOR[s.id] }}>{s.name}</span>
                <span className="lv" style={{ color: s.maxed ? '#f5b942' : undefined }}>Lv {s.level}{s.maxed ? ' MAX' : ''}</span>
              </div>
              <Bar pct={s.pct} color={SLAYER_COLOR[s.id]} />
              <div className="b"><span>{fmt(s.xp)} XP</span><span>{s.maxed ? '' : `${s.pct.toFixed(0)}% - ${fmt(s.toNext)} to go`}</span></div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="h" style={{ color: '#ef6a5b' }}>Dungeons</div>
        {!dg && <div className="muted">No Catacombs XP yet</div>}
        {dg && (
          <div className="col">
            <div className="card">
              <div className="lbl">CATACOMBS</div>
              <div className="mid" style={{ color: '#ef6a5b' }}>Level {dg.level}</div>
              <div style={{ margin: '6px 0 3px' }}><Bar pct={dg.pct} color="#ef6a5b" /></div>
              <div className="sub">{dg.pct.toFixed(1)}% - {fmt(dg.toNext)} to go{dg.secrets ? ` - ${dg.secrets.toLocaleString()} secrets` : ''}</div>
            </div>
            <div className="card">
              <div className="lbl" style={{ marginBottom: 2 }}>CLASSES</div>
              {dg.classes.map((c: any) => (
                <div className="row" key={c.name} style={{ padding: '3px 0', fontSize: 13 }}>
                  <span className="nm" style={{ color: c.name === dg.selected ? '#f5b942' : undefined }}>{pretty(c.name)}</span>
                  <span style={{ flex: 1, maxWidth: 110 }}><Bar pct={c.pct} color="#ef6a5b" /></span>
                  <span>{c.level}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

const Collect = memo(({ d }: { d: any }) => {
  const top = d.collections[0]?.amount || 1
  return (
    <div className="g2">
      {d.collections.map((c: any, i: number) => (
        <div className="sk" key={c.name}>
          <div className="t"><span className="nm">{i + 1}. {pretty(c.name)}</span><span className="lv green">{fmt(c.amount)}</span></div>
          <Bar pct={(c.amount / top) * 100} color="#5fd68a" />
        </div>
      ))}
    </div>
  )
})

const Market = memo(({ d }: { d: any }) => {
  const m = d.market || {}
  const bzDown = m.bz?.ok === false
  const lbDown = m.lbin?.ok === false
  return (
    <div className="g2">
      <div>
        <div className="h green">Bazaar</div>
        {bzDown && <div className="sub red" style={{ margin: '-4px 0 7px' }}>Unavailable: {m.bz.err}</div>}
        <div className="col">
          {d.bazaar.length === 0 && <div className="muted">Add item IDs in settings</div>}
          {d.bazaar.map((b: any) => {
            const spread = b.sell ? ((b.buy - b.sell) / b.sell) * 100 : 0
            const up = chg(b.hist) >= 0
            return (
              <div className="card" key={b.id} style={{ padding: '8px 11px' }}>
                <div className="mk">
                  <span style={{ fontWeight: 800, fontSize: 14 }}>{pretty(b.id)}</span>
                  <Spark v={b.hist} color={up ? '#5fd68a' : '#f0685c'} />
                </div>
                <div className="mk" style={{ marginTop: 3, fontSize: 13 }}>
                  {b.buy || b.sell ? (
                    <>
                      <span><span className="muted">Buy</span> <b className="green">{fmt(b.buy)}</b>  <span className="muted">Sell</span> <b className="gold">{fmt(b.sell)}</b></span>
                      <span><span className="muted">Spread</span> <b>{spread.toFixed(1)}%</b> <Change v={b.hist} /></span>
                    </>
                  ) : (
                    <span className="red">{bzDown ? 'Unavailable' : 'Item ID not found'}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div>
        <div className="h blue">Lowest BIN</div>
        <div className={lbDown ? 'sub red' : 'sub'} style={{ margin: '-4px 0 7px' }}>
          {lbDown ? `Unavailable: ${m.lbin.err}` : m.lbin?.src ? `via ${m.lbin.src}` : ''}
        </div>
        <div className="col">
          {d.lowestBins.length === 0 && <div className="muted">Add item IDs in settings</div>}
          {d.lowestBins.map((l: any) => (
            <div className="card" key={l.id} style={{ padding: '8px 11px' }}>
              <div className="mk">
                <span style={{ fontWeight: 800, fontSize: 14 }}>{pretty(l.id)}</span>
                <Spark v={l.hist} color={chg(l.hist) >= 0 ? '#5fd68a' : '#f0685c'} />
              </div>
              <div className="mk" style={{ marginTop: 3, fontSize: 13 }}>
                {l.price ? <b className="blue">{fmt(l.price)}</b> : lbDown ? <b className="red">Unavailable</b> : <b className="muted">Not listed</b>}
                <Change v={l.hist} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

const Auctions = memo(({ d }: { d: any }) => {
  const a = d.auctions
  const Item = ({ x }: { x: any }) => (
    <div className="item" style={{ borderLeftColor: TIER_COLOR[x.tier] || '#8791a5' }}>
      <div className="t"><span>{x.item}</span><span className="green">{fmt(x.price)}</span></div>
      <div className="b">
        <span>{x.sold === undefined ? (x.bin ? 'BIN' : `${x.bids} bids`) : x.sold ? 'Sold - ready to claim' : 'Expired - take it back'}</span>
        <span className={x.sold === undefined && x.endsInMin < 15 ? 'gold' : ''}>{x.sold === undefined ? `ends ${dur(x.endsInMin)}` : ''}</span>
      </div>
    </div>
  )
  return (
    <div className="g2">
      <div>
        <div className="h gold">Active ({a.active.length}) <span className="muted">worth {fmt(a.activeValue)}</span></div>
        {d.auctionsInfo?.ok === false && <div className="sub red" style={{ margin: '-4px 0 7px' }}>Auctions unavailable: {d.auctionsInfo.err}</div>}
        {a.other > 0 && <div className="sub" style={{ margin: '-4px 0 7px' }}>{a.other} listing(s) on your other profiles (set Profile Name in settings)</div>}
        <div className="col">
          {a.active.length === 0 && <div className="muted">No active listings</div>}
          {a.active.map((x: any, i: number) => <Item x={x} key={i} />)}
        </div>
      </div>
      <div>
        <div className="h green">To claim ({a.ready.length}) <span className="muted">{fmt(a.readyValue)} coins waiting</span></div>
        <div className="col">
          {a.ready.length === 0 && <div className="muted">Nothing to claim</div>}
          {a.ready.map((x: any, i: number) => <Item x={x} key={i} />)}
        </div>
      </div>
    </div>
  )
})

/* ---------------- app ---------------- */
export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const offData = DeskThing.on('skyblock_data', (msg: any) => {
      setError('')
      setData(msg.payload)
    })
    const offErr = DeskThing.on('skyblock_error', (msg: any) => setError(String(msg.payload || 'Unknown error')))
    DeskThing.send({ type: 'get', request: 'skyblock_data' })
    return () => {
      offData()
      offErr()
    }
  }, [])

  // Dial / scroll wheel switches tabs (instead of changing volume)
  useEffect(() => {
    let last = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault() // DeskThing skips events that are already handled
      const now = Date.now()
      if (now - last < 140) return // one tab per notch
      last = now
      const dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1
      setTab((t) => TABS[(TABS.findIndex((x) => x.id === t) + dir + TABS.length) % TABS.length].id)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    DeskThing.overrideKeys(['wheel', 'Scroll'])
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      DeskThing.restoreKeys(['wheel', 'Scroll'])
    }
  }, [])

  const ready = data?.auctions?.ready?.filter((x: any) => x.sold).length || 0

  return (
    <div className="app">
      <div className="top">
        <div className="tabs">
          {TABS.map((t) => (
            <button type="button" key={t.id} className={tab === t.id ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'ah' && ready > 0 && <span className="badge">{ready}</span>}
            </button>
          ))}
        </div>
        <Clock tz={data?.tzMin} />
      </div>

      <div className="panel">
        {error && <div className="msg err">{error}</div>}
        {!data && !error && <div className="msg wait">Waiting for Hypixel API data... (check the app settings in DeskThing)</div>}
        {data && tab === 'home' && <Home d={data} />}
        {data && tab === 'skills' && <Skills d={data} />}
        {data && tab === 'combat' && <Combat d={data} />}
        {data && tab === 'collect' && <Collect d={data} />}
        {data && tab === 'market' && <Market d={data} />}
        {data && tab === 'ah' && <Auctions d={data} />}
      </div>

      <Footer at={data?.checkedAt} tz={data?.tzMin} />
    </div>
  )
}
