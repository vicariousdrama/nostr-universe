/* eslint-disable */
// @ts-nocheck
import NDK, { NDKRelaySet, NDKRelay, NDKEvent } from '@nostrband/ndk'
import { Event, nip19 } from '@nostrband/nostr-tools'
import { decode as bolt11Decode } from 'light-bolt11-decoder'
import { walletstore } from './walletstore'
import { AuthoredEvent, createAuthoredEvent } from '@/types/authored-event'
import { AugmentedEvent, createEvent } from '@/types/augmented-event'
import { MetaEvent, createMetaEvent } from '@/types/meta-event'
import { Meta, createMeta } from '@/types/meta'
import { NDKFilter, NDKNip07Signer, NDKNip46Signer, NDKSubscription, NostrEvent, NostrTop } from '@nostrband/ndk'
import { ZapEvent, createZapEvent } from '@/types/zap-event'
import {
  CommunityApprovalInfo,
  CommunityEvent,
  ExtendedCommunityEvent,
  createCommunityApprovalInfo,
  createCommunityEvent,
  createExtendedCommunityEvent
} from '@/types/communities'
import { LongNoteEvent, createLongNoteEvent } from '@/types/long-note-event'
import { HighlightEvent, createHighlightEvent } from '@/types/highlight-event'
import { LiveEvent, createLiveEvent } from '@/types/live-events'
import { WalletInfo } from '@/types/wallet-info'
import { ContactListEvent, createContactListEvent } from '@/types/contact-list-event'
import { AppNostr } from '@/types/app-nostr'

const KIND_META: number = 0
const KIND_NOTE: number = 1
const KIND_CONTACT_LIST: number = 3
const KIND_COMMUNITY_APPROVAL: number = 4550
const KIND_ZAP: number = 9735
const KIND_HIGHLIGHT: number = 9802
const KIND_BOOKMARKS: number = 30001
const KIND_LONG_NOTE: number = 30023
const KIND_APP: number = 31990
const KIND_LIVE_EVENT: number = 30311
const KIND_COMMUNITY: number = 34550
const KIND_NWC_PAYMENT_REQUEST: number = 23194
const KIND_NWC_PAYMENT_REPLY: number = 23195

const MAX_TOP_APPS = 200

// we only care about web apps
const PLATFORMS = ['web']

const ADDR_TYPES = ['', 'npub', 'note', 'nevent', 'nprofile', 'naddr']

export const nostrbandRelay = 'wss://relay.nostr.band/'
export const nostrbandRelayAll = 'wss://relay.nostr.band/all'

const readRelays = [
  nostrbandRelay,
  //  "wss://relay.damus.io", // too slow
  'wss://eden.nostr.land',
  'wss://nos.lol',
  'wss://relay.nostr.bg',
  'wss://nostr.mom'
]
const writeRelays = [...readRelays, 'wss://nostr.mutinywallet.com'] // for broadcasting
export const allRelays = [nostrbandRelayAll, ...writeRelays]

const nsbRelays = ['wss://relay.nsecbunker.com']

// global ndk instance for now
let ndk: NDK = null
let nsbNDK: NDK = new NDK({ explicitRelayUrls: nsbRelays })
nsbNDK
  .connect(2000)
  .then(() => console.log('nsb ndk connected'))
  .catch(() => console.log('nsb ndk connect error'))

let nsbSigner: NDKNip46Signer = null

interface EventAddr {
  kind?: number
  pubkey?: string
  event_id?: string
  d_tag?: string
  relays?: string[]
  hex: boolean
}

interface AppUrl {
  url: string
  type: string
}

export interface AppHandlerEvent extends AugmentedEvent {
  naddr: string
  meta: MetaEvent | null
  inheritedProfile: boolean
  profile: Meta | null
  kinds: number[]
  urls: AppUrl[]
  platforms: string[]
  app_id: string
  eventUrl: string
}

function createAppHandlerEvent(e: AugmentedEvent): AppHandlerEvent {
  const c = e as AppHandlerEvent
  c.naddr = ''
  c.meta = null
  c.inheritedProfile = false
  c.profile = null
  c.kinds = []
  c.urls = []
  c.platforms = []
  c.app_id = ''
  c.eventUrl = ''
  return c
}

interface App {
  app_id: string
  handlers: AppHandlerEvent[]
  kinds: number[]
  platforms: string[]
}

export interface AppInfos {
  meta: MetaEvent | null
  apps: Map<string, App>
  handlers: AppHandlerEvent[]
  kinds: number[]
  platforms: string[]
}

const kindAppsCache = new Map<number, AppInfos>()
const metaCache = new Map<string, MetaEvent>()
const eventCache = new Map<string, AugmentedEvent>()
const addrCache = new Map<string, AugmentedEvent>()

function rawEvent(e: NDKEvent): AugmentedEvent {
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags,
    content: e.content,
    identifier: getTagValue(e, 'd'),
    order: e.created_at,
    sig: e.sig
  }
}

function parseContentJson(c: string): object {
  try {
    return JSON.parse(c)
  } catch (e) {
    console.log('Bad json: ', c, e)
    return {}
  }
}

export function parseProfileJson(e: Event): Meta {
  // all meta fields are optional so 'as' works fine
  const profile = createMeta(parseContentJson(e.content))
  profile.pubkey = e.pubkey
  profile.npub = nip19.npubEncode(e.pubkey)
  return profile
}

function getEventAddr(e: NDKEvent | AugmentedEvent): string {
  let addr = e.id
  if (
    e.kind === KIND_META ||
    e.kind === KIND_CONTACT_LIST ||
    (e.kind >= 10000 && e.kind < 20000) ||
    (e.kind >= 10000 && e.kind < 20000)
  ) {
    addr = e.kind + ':' + e.pubkey + ':' + getTagValue(e, 'd')
  }
  return addr
}

function fetchEventsRead(ndk: NDK, filter: NDKFilter): Promise<Set<NDKEvent>> {
  return new Promise(async (ok) => {
    const events = await ndk.fetchEvents(filter, {}, NDKRelaySet.fromRelayUrls(readRelays, ndk))
    for (const e of events.values()) {
      const augmentedEvent = rawEvent(e)
      putEventToCache(augmentedEvent)
    }
    ok(events)
  })
}

export function getTags(e: AugmentedEvent | NDKEvent | Event | AuthoredEvent | MetaEvent, name: string): string[] {
  return e.tags.filter((t: string[]) => t.length > 0 && t[0] === name)
}

export function getTag(e: AugmentedEvent | NDKEvent | Event | AuthoredEvent | MetaEvent, name: string): string | null {
  const tags = getTags(e, name)
  if (tags.length === 0) return null
  return tags[0]
}

export function getTagValue(
  e: AugmentedEvent | NDKEvent | Event | AuthoredEvent | MetaEvent,
  name: string,
  index: number = 0,
  def: string = ''
): string {
  const tag = getTag(e, name)
  if (tag === null || !tag.length || (index && index >= tag.length)) return def
  return tag[1 + index]
}

export function getEventTagA(e: AugmentedEvent | NDKEvent | Event | AuthoredEvent | MetaEvent): string {
  let addr = e.kind + ':' + e.pubkey + ':'
  if (e.kind >= 30000 && e.kind < 40000) addr += getTagValue(e, 'd')
  return addr
}

function isWeb(e: Event): boolean {
  for (const t of e.tags) {
    if (t[0] === 'web') return true

    if (t[0] === 'android' || t[0] === 'ios' || t[0] === 'windows' || t[0] === 'macos' || t[0] === 'linux') return false
  }

  return true
}

function findHandlerUrl(e: Event, k: number) {
  for (const t of e.tags) {
    if (t[0] !== 'web' || t.length < 3) continue

    if (k === KIND_META && (t[2] === 'npub' || t[2] === 'nprofile')) {
      return [t[1], t[2]]
    }

    if (k >= 30000 && k < 40000 && t[2] === 'naddr') {
      return [t[1], t[2]]
    }

    return [t[1], t[2]]
  }

  return null
}

function sortAsc(arr: AugmentedEvent[] | AuthoredEvent[] | MetaEvent[]) {
  arr.sort((a, b) => a.order - b.order)
}

function sortDesc(arr: AugmentedEvent[] | AuthoredEvent[] | MetaEvent[]) {
  arr.sort((a, b) => b.order - a.order)
}

export async function fetchApps() {
  // try to fetch best apps list from our relay
  const top = null
  // const top = await ndk.fetchTop(
  //   {
  //     kinds: [KIND_APP],
  //     limit: MAX_TOP_APPS
  //   },
  //   // note: send to this separate endpoint bcs this req might be slow
  //   NDKRelaySet.fromRelayUrls([nostrbandRelayAll], ndk)
  // )
  // console.log('top apps', top?.ids.length)

  let events: AugmentedEvent[] = []
  if (top?.ids.length) {
    // fetch the app events themselves from the list
    events = await fetchEventsByIds({ ids: top.ids, kinds: [KIND_APP] })
  } else {
    console.log('top apps empty, fetching new ones')
    // load non-best apps from other relays just to avoid
    // completely breaking the UX due to our relay being down
    const ndkEvents = await fetchEventsRead(ndk, {
      kinds: [KIND_APP],
      limit: MAX_TOP_APPS
    })

    events = [...ndkEvents.values()].map((e) => rawEvent(e))
  }
  console.log('top app events', events.length)

  // load authors of the apps, we need them both for the app
  // info and for apps that inherit the author's profile info
  const profiles = await fetchMetas(events.map((e) => e.pubkey))

  // assign order to the apps, sort by top or by published date
  if (top)
    events.forEach((e) => {
      e.order = top.ids.findIndex((i: string) => e.id === i)
    })
  else
    events.forEach((e) => {
      e.order = Number(getTagValue(e, 'published_at'))
    })

  // sort events by order desc
  sortDesc(events)

  // convert to a convenient app object
  const apps: AppNostr[] = []
  events.forEach((e) => {
    // app author
    const author = profiles.find((p) => p.pubkey == e.pubkey)

    // app profile - it's own, or inherited from the author
    const profile = e.content ? parseProfileJson(e) : author?.profile

    // app's handled kinds and per-kind handler urls for the 'web' platform,
    // we don't add a kind that doesn't have a proper handler
    const kinds: number[] = []
    const handlers: { [key: string]: { url: string; type: string } } = {}
    e.tags.forEach((t) => {
      let k = 0
      if (t.length < 2 || t[0] != 'k') return

      try {
        k = parseInt(t[1])
      } catch (e) {
        return
      }

      const url_type = findHandlerUrl(e, k)
      if (!url_type) return

      kinds.push(k)
      handlers[k] = {
        url: url_type[0],
        type: url_type[1]
      }
    })

    if (!isWeb(e)) return

    //    if (Object.keys(handlers).length == 0)
    //      return;

    const app: AppNostr = {
      naddr: nip19.naddrEncode({
        pubkey: e.pubkey,
        kind: e.kind,
        identifier: getTagValue(e, 'd')
      }),
      name: profile?.display_name || profile?.name || '<Noname app>',
      url: profile?.website || '',
      picture: profile?.picture || '',
      about: profile?.about || '',
      kinds,
      handlers,
      order: e.order
    }

    if (app.name && app.url) apps.push(app)
  })

  return apps
}

export function parseAddr(id: string): EventAddr | null {
  let addr: EventAddr = {
    hex: false
  }

  try {
    const { type, data } = nip19.decode(id)

    switch (type) {
      case 'npub':
        addr.kind = 0
        addr.pubkey = data
        break
      case 'nprofile':
        addr.kind = 0
        addr.pubkey = data.pubkey
        addr.relays = data.relays
        break
      case 'note':
        addr.event_id = data
        break
      case 'nevent':
        addr.event_id = data.id
        addr.relays = data.relays
        addr.pubkey = data.author
        // FIXME add support for kind to nevent to nostr-tool
        break
      case 'naddr':
        addr.d_tag = data.identifier || ''
        addr.kind = data.kind
        addr.pubkey = data.pubkey
        addr.relays = data.relays
        break
      default:
        throw 'bad id'
    }
  } catch (e) {
    if (id.length === 64) {
      addr.event_id = id
      addr.hex = true
    } else {
      console.error('Failed to parse addr', e)
      return null
    }
  }

  return addr
}

function dedupEvents(events: NDKEvent[]): NDKEvent[] {
  const map = new Map<string, NDKEvent>()
  for (const e of events) {
    let addr: string = e.id
    if (e.kind === 0 || e.kind === 3 || (e.kind >= 10000 && e.kind < 20000) || (e.kind >= 30000 && e.kind < 40000)) {
      addr = getEventTagA(e)
    }
    const dup = map.get(addr)
    if (!dup || dup.created_at < e.created_at) {
      map.set(addr, e)
    }
  }
  return [...map.values()]
}

async function collectEvents(reqs: Promise<Set<NDKEvent>>[] | Promise<Set<NDKEvent>> | Promise<NDKEvent>) {
  const results = await Promise.allSettled(Array.isArray(reqs) ? reqs : [reqs])
  const events: NDKEvent[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value !== null) {
        if (typeof r.value[Symbol.iterator] === 'function') events.push(...r.value)
        else events.push(r.value)
      }
    }
  }
  return dedupEvents(events)
}

async function fetchEventByAddr(ndk: NDK, addr: EventAddr): Promise<AugmentedEvent | null> {
  let id = ''
  const filter: NDKFilter = {}
  if (addr.event_id) {
    // note, nevent
    filter.ids = [addr.event_id]
    id = addr.event_id
  } else if (addr.pubkey && addr.d_tag !== undefined && addr.kind !== undefined) {
    // naddr
    filter['#d'] = [addr.d_tag]
    filter.authors = [addr.pubkey]
    filter.kinds = [addr.kind]
    id = addr.kind + ':' + addr.pubkey + ':' + addr.d_tag
  } else if (addr.pubkey && addr.kind !== undefined) {
    // npub, nprofile
    filter.authors = [addr.pubkey]
    filter.kinds = [addr.kind]
    id = addr.kind + ':' + addr.pubkey + ':'
  }

  const cachedEvent = addrCache.get(id)
  if (cachedEvent) {
    console.log('event in addr cache', id)
    return { ...cachedEvent }
  }

  console.log('loading event by filter', JSON.stringify(filter))

  const reqs = [fetchEventsRead(ndk, filter)]
  if (addr.hex && addr.event_id) {
    const profileFilter: NDKFilter = {
      kinds: [0],
      authors: [addr.event_id]
    }
    // console.log("loading profile by filter", profile_filter);
    reqs.push(fetchEventsRead(ndk, profileFilter))
  }

  const events = await collectEvents(reqs)
  const event = events.length > 0 ? rawEvent(events[0]) : null
  if (event) putEventToCache(event)
  return event
}

function prepareHandlers(events: AugmentedEvent[], filterKinds: number[], metaPubkey: string = ''): AppInfos {
  const info: AppInfos = {
    meta: null,
    apps: new Map<string, App>(),
    handlers: [],
    kinds: [],
    platforms: []
  }

  const metas = new Map<string, MetaEvent>()
  for (const e of events) {
    if (e.kind === KIND_META) {
      const m = createMetaEvent(e)
      m.profile = parseProfileJson(e)
      metas.set(e.pubkey, e)

      if (metaPubkey && metaPubkey === e.pubkey) info.meta = e
    }
  }

  for (const ev of events) {
    if (ev.kind !== KIND_APP) continue

    const e = createAppHandlerEvent(ev)

    // set naddr
    e.naddr = nip19.naddrEncode({
      pubkey: e.pubkey,
      kind: e.kind,
      identifier: getTagValue(e, 'd')
    })

    // init handler profile, inherit from pubkey meta if needed
    e.inheritedProfile = !e.content
    e.meta = metas.get(e.pubkey) || null
    if (e.inheritedProfile) e.profile = e.meta?.profile || null
    else e.profile = parseProfileJson(e)

    // parse handler kinds
    const kinds = new Set<number>()
    for (const t of getTags(e, 'k')) {
      if (t.length < 2) continue
      const k = Number(t[1])
      if (k < 0 || k > 10000000 || isNaN(k)) continue
      kinds.add(k)
    }
    e.kinds = [...kinds]

    // drop handlers that don't handle our kinds
    if (filterKinds && filterKinds.length) e.kinds = e.kinds.filter((k) => filterKinds.includes(k))
    if (!e.kinds.length) continue

    // parse platforms and urls
    const ps = new Set<string>()
    e.urls = []
    for (const p of PLATFORMS) {
      // urls for platform p
      const urls = getTags(e, p)
      for (const url of urls) {
        if (url.length < 2) continue

        const type = url.length > 2 ? url[2] : ''

        // default or one of known types?
        if (type != '' && !ADDR_TYPES.find((t) => t === type)) continue

        ps.add(p)
        e.urls.push({
          url: url[1],
          type
        } as AppUrl)
      }
    }
    e.platforms = [...ps.values()]

    // dedup by app name
    e.app_id = getTagValue(e, 'd')
    if (e.content !== '') e.app_id = e.profile?.name || e.profile?.display_name || ''

    // init
    if (!info.apps.get(e.app_id)) {
      info.apps.set(e.app_id, {
        app_id: e.app_id,
        handlers: [],
        kinds: [],
        platforms: []
      } as App)
    }

    // add app handler
    const app = info.apps.get(e.app_id)
    if (!app) continue // impossible
    app.handlers.push(e)
    app.kinds.push(...e.kinds)
    app.platforms.push(...e.platforms)
  }

  return info
}

async function fetchAppsByKinds(ndk: NDK, kinds: number[] = []): Promise<AppInfos> {
  // fetch apps ('handlers')
  const filter: NDKFilter = {
    kinds: [KIND_APP],
    limit: 50
  }
  if (kinds.length > 0) filter['#k'] = kinds.map((k) => '' + k)

  //  let events = await collectEvents(fetchEventsRead(ndk, filter));
  //  console.log('events', events);

  const top: NostrTop | null = null // await ndk.fetchTop(filter, NDKRelaySet.fromRelayUrls([nostrbandRelayAll], ndk))
  console.log('top kind apps', top?.ids.length)

  let ndkEvents: NDKEvent[] = []
  if (top?.ids.length) {
    // fetch the app events themselves from the list
    ndkEvents = await collectEvents(fetchEventsRead(ndk, { ids: top.ids }))
  } else {
    console.log('top apps empty, fetching new ones')
    // load non-best apps from other relays just to avoid
    // completely breaking the UX due to our relay being down
    ndkEvents = await collectEvents(fetchEventsRead(ndk, filter))
  }
  //  console.log('events', events);

  const augmentedEvents = [...ndkEvents.values()].map((e) => rawEvent(e))

  if (top)
    top.ids.forEach((id, i) => {
      const e = augmentedEvents.find((e) => e.id == id)
      if (e) e.order = top.ids.length - i
    })
  else augmentedEvents.forEach((e, i) => (e.order = augmentedEvents.length - i))

  // we need profiles in case app info inherits content
  // from it's profile
  if (augmentedEvents.length > 0) {
    let pubkeys: string[] = []
    for (const e of augmentedEvents) pubkeys.push(e.pubkey)
    pubkeys = [...new Set(pubkeys)]

    const metasNdkEvents = await collectEvents(
      fetchEventsRead(ndk, {
        kinds: [KIND_META],
        authors: Object.keys(pubkeys)
      })
    )
    //    console.log('metas', metas);

    augmentedEvents.push(...metasNdkEvents.map((e) => rawEvent(e)))
  }

  // parse
  const info = prepareHandlers(augmentedEvents, kinds)
  return info
}

function getUrl(app: AppHandlerEvent, ad: EventAddr): string {
  if (ad.kind === undefined) return ''

  const findUrlType = (type: string): AppUrl | undefined => {
    return app.urls.find((u) => u.type === type)
  }

  const allUrl = findUrlType('')

  const findUrl = (id: string): string => {
    const { type } = nip19.decode(id)
    const u = findUrlType(type) || allUrl
    if (u != null) return u.url.replace('<bech32>', id)
    return ''
  }

  const naddrId: nip19.AddressPointer = {
    identifier: ad.d_tag || '',
    pubkey: ad.pubkey || '',
    kind: ad.kind,
    relays: ad.relays
  }
  const neventId: nip19.EventPointer = {
    // FIXME add kind!
    id: ad.event_id || '',
    relays: ad.relays,
    author: ad.pubkey
  }

  let url = ''
  if (ad.kind === 0) {
    if (!url && ad.pubkey)
      url =
        findUrl(nip19.npubEncode(ad.pubkey)) || findUrl(nip19.nprofileEncode({ pubkey: ad.pubkey, relays: ad.relays }))
    // || findUrl(nip19.naddrEncode(naddrId))
    if (!url && ad.event_id) url = findUrl(nip19.neventEncode(neventId)) || findUrl(nip19.noteEncode(ad.event_id))
  } else if (ad.kind === 3 || (ad.kind >= 10000 && ad.kind < 20000)) {
    // specific order - naddr preferred
    url =
      // FIXME naddr?
      findUrl(nip19.neventEncode(neventId)) || findUrl(nip19.noteEncode(ad.event_id || ''))
  } else if (ad.kind >= 30000 && ad.kind < 40000) {
    // specific order - naddr preferred
    url = findUrl(nip19.naddrEncode(naddrId))
    if (!url && ad.event_id) url = findUrl(nip19.neventEncode(neventId)) || findUrl(nip19.noteEncode(ad.event_id))
  } else {
    // specific order - naddr preferred
    url = findUrl(nip19.neventEncode(neventId)) || findUrl(nip19.noteEncode(ad.event_id || ''))
  }

  return url
}

export async function fetchAppsForEvent(id: string, event: Event | null = null): Promise<[AppInfos, EventAddr]> {
  const addr = parseAddr(id)
  if (!addr) throw new Error('Bad address')

  // if event content is known take kind from there
  if (event && addr.kind === undefined) addr.kind = event.kind

  // if kind unknown need to fetch event from network
  if (addr.kind === undefined) {
    if (!event) event = await fetchEventByAddr(ndk, addr)

    if (!event) throw new Error('Failed to fetch target event')

    addr.kind = event.kind
    addr.event_id = event.id
    addr.pubkey = event.pubkey
    if (event.kind >= 30000 && event.kind < 40000) {
      addr.d_tag = getTagValue(event, 'd')
    }
  }
  console.log('resolved addr', addr, event)

  // now fetch the apps for event kind
  let info = kindAppsCache.get(addr.kind)
  if (info) {
    info = { ...info }
    console.log('apps for kind', addr.kind, 'in cache', info)
  }
  if (!info) info = await fetchAppsByKinds(ndk, [addr.kind])

  // put to cache
  if (info.apps.size > 0) {
    kindAppsCache.set(addr.kind, info)
  }

  // init convenient url property for each handler
  // to redirect to this event
  for (const [_, app] of info.apps) {
    for (const h of app.handlers) {
      h.eventUrl = getUrl(h, addr)
    }
  }

  return [info, addr]
}

export async function fetchEventByBech32(b32: string): Promise<AugmentedEvent | null> {
  const addr = parseAddr(b32)
  console.log('b32', b32, 'addr', JSON.stringify(addr))
  if (!addr) throw new Error('Bad address')

  return await fetchEventByAddr(ndk, addr)
}

export async function searchProfiles(q: string): Promise<MetaEvent[]> {
  // try to fetch best profiles from our relay
  const top: NostrTop | null = await ndk.fetchTop(
    {
      kinds: [KIND_META],
      search: q,
      limit: 30
    },
    NDKRelaySet.fromRelayUrls([nostrbandRelay], ndk)
  )
  console.log('top profiles', top?.ids.length)

  const events: MetaEvent[] = []
  if (!top) return events

  if (top.ids.length) {
    const augmentedEvents = await fetchEventsByIds({ ids: top.ids, kinds: [KIND_META] })

    // convert to meta events
    const metaEvents = augmentedEvents.map((e) => {
      const c = createMetaEvent(e)
      c.profile = parseProfileJson(c)
      return c
    })

    // put to cache
    metaEvents.forEach((e) => putEventToCache(e))

    events.push(...metaEvents)
  }

  // order by top.ids
  events.forEach((e) => {
    e.order = top.ids.findIndex((i) => e.id === i)
  })

  sortAsc(events)

  return events
}

async function fetchMetas(pubkeys: string[]): Promise<MetaEvent[]> {
  const metas: MetaEvent[] = []
  const reqPubkeys: string[] = []
  pubkeys.forEach((p) => {
    const meta = metaCache.get(p)
    if (meta) metas.push({ ...meta })
    else reqPubkeys.push(p)
  })

  if (reqPubkeys.length > 0) {
    const ndkEvents = await fetchEventsRead(ndk, {
      kinds: [KIND_META],
      authors: reqPubkeys
    })

    // drop ndk stuff
    const metaEvents = [...ndkEvents.values()].map((e) => createMetaEvent(rawEvent(e)))

    // parse profiles
    metaEvents.forEach((e) => {
      e.profile = parseProfileJson(e)
    })

    // put to cache
    metaEvents.forEach((e) => putEventToCache(e))

    // merge with cached results
    metas.push(...metaEvents)
  }

  console.log('meta cache', metaCache.size)
  return metas
}

async function augmentEventAuthors(events: AugmentedEvent[]): Promise<AuthoredEvent[]> {
  const authoredEvents = events.map((e) => createAuthoredEvent(e))
  if (authoredEvents.length > 0) {
    // profile infos
    const metas = await fetchMetas(events.map((e) => e.pubkey))

    // assign to notes
    authoredEvents.forEach((e) => (e.author = metas.find((m) => m.pubkey === e.pubkey)))
  }

  return authoredEvents
}

interface IFetchEventByIdsParams {
  ids: string[]
  kinds: number[]
}

async function fetchEventsByIds({ ids, kinds }: IFetchEventByIdsParams): Promise<AugmentedEvent[]> {
  const results: AugmentedEvent[] = []
  const reqIds: string[] = []
  ids.forEach((id) => {
    const ne = eventCache.get(id)
    if (ne) {
      // make sure kinds match
      if (kinds.includes(ne.kind)) results.push({ ...ne })
    } else {
      reqIds.push(id)
    }
  })

  if (reqIds.length > 0) {
    const ndkEvents = await ndk.fetchEvents(
      {
        ids: reqIds,
        kinds
      },
      {}, // opts
      NDKRelaySet.fromRelayUrls(readRelays, ndk)
    )
    //    console.log('ids', ids, 'reqIds', reqIds, 'kinds', kinds, 'events', ndkEvents)

    const augmentedEvents = [...ndkEvents.values()].map((e) => rawEvent(e)).filter((e) => ids.includes(e.id))

    augmentedEvents.forEach((e) => putEventToCache(e))

    results.push(...augmentedEvents)

    console.log('event cache', eventCache.size)
  }

  // desc by tm
  sortDesc(results)

  console.log('events by ids prepared', results)
  return results
}

function augmentLongNotes(events: AuthoredEvent[]): LongNoteEvent[] {
  const longNotes = events.map((e) => createLongNoteEvent(e))
  longNotes.forEach((e) => {
    e.title = getTagValue(e, 'title')
    e.summary = getTagValue(e, 'summary')
    e.published_at = Number(getTagValue(e, 'published_at'))
  })
  return longNotes
}

async function augmentZaps(augmentedEvents: AugmentedEvent[], minZap: number): Promise<ZapEvent[]> {
  let zapEvents = augmentedEvents.map((e) => createZapEvent(e))

  zapEvents.forEach((e) => {
    e.description = createEvent(parseContentJson(getTagValue(e, 'description')))
    try {
      e.bolt11 = bolt11Decode(getTagValue(e, 'bolt11'))
    } catch {
      e.bolt11 = undefined
    }
    e.amountMsat = Number(e.bolt11?.sections?.find((s) => s.name === 'amount')?.value || '')
    e.targetEventId = getTagValue(e, 'e')
    e.targetAddr = getTagValue(e, 'a')
    e.targetPubkey = getTagValue(e, 'p')
    e.providerPubkey = e.pubkey
    e.senderPubkey = e.description?.pubkey
  })

  // drop zaps w/o a target event
  zapEvents = zapEvents.filter((e) => !!e.targetEventId)

  if (minZap) {
    zapEvents = zapEvents.filter((e) => e.amountMsat / 1000 >= minZap)
  }

  if (zapEvents.length > 0) {
    // target event infos
    const ids = zapEvents.map((e) => e.targetEventId).filter((id) => !!id)
    const augmentedTargetsEvents = await fetchEventsByIds({
      ids,
      kinds: [KIND_NOTE, KIND_LONG_NOTE, KIND_COMMUNITY, KIND_LIVE_EVENT, KIND_APP]
    })

    // profile infos
    const pubkeys = new Set<string>()
    zapEvents.forEach((e) => {
      pubkeys.add(e.providerPubkey)
      if (e.targetPubkey) pubkeys.add(e.targetPubkey)
      if (e.senderPubkey) pubkeys.add(e.senderPubkey)
    })
    augmentedTargetsEvents.forEach((e) => pubkeys.add(e.pubkey))

    console.log('zap meta pubkeys', pubkeys)
    const metas = await fetchMetas([...pubkeys.values()])

    // assign to zaps
    zapEvents.forEach((e) => {
      let target = augmentedTargetsEvents.find((t) => t.id === e.targetEventId)
      if (target) {
        e.targetEvent = createAuthoredEvent(target)
        // FIXME receive frozen object property error when change profile!
        e.targetEvent.author = metas.find((m) => m.pubkey === e.targetEvent?.pubkey)
      }

      e.targetMeta = metas.find((m) => m.pubkey === e.targetPubkey)
      e.providerMeta = metas.find((m) => m.pubkey === e.providerPubkey)
      e.senderMeta = metas.find((m) => m.pubkey === e.senderPubkey)
      e.author = e.providerMeta
    })
  }

  // desc
  sortDesc(zapEvents)

  return zapEvents
}

async function augmentCommunities(events: AugmentedEvent[]): Promise<CommunityEvent[]> {
  const pubkeys = new Set<string>()
  const communities = events.map((e) => createCommunityEvent(e))
  communities.forEach((e) => {
    e.name = e.identifier
    e.description = getTagValue(e, 'description')
    e.image = getTagValue(e, 'image')
    e.moderators = getTags(e, 'p')
      .filter((p) => p.length >= 4 && p[3] === 'moderator')
      .map((p) => p[1])

    pubkeys.add(e.pubkey)
    e.moderators.forEach((m) => pubkeys.add(m))
  })

  console.log('communities meta pubkeys', pubkeys)
  const metas = await fetchMetas([...pubkeys.values()])

  // assign to events
  communities.forEach((e) => {
    e.author = metas.find((m) => m.pubkey === e.pubkey)
    e.moderatorsMetas = metas.filter((m) => e.moderators.includes(m.pubkey))
  })

  return communities
}

function augmentCommunitiesApprovals(
  communities: CommunityEvent[],
  approvals: CommunityApprovalInfo[]
): ExtendedCommunityEvent[] {
  // extend
  const ecs = communities.map((e) => {
    const c = createExtendedCommunityEvent(e)
    const apprs = approvals.filter((a) => a.communityPubkey === e.pubkey && a.communityIdentifier === e.identifier)
    c.last_post_tm = apprs[0].created_at
    c.order = c.last_post_tm
    c.posts = apprs.length
    return c
  })

  // desc
  sortDesc(ecs)

  return ecs
}

interface SearchEventsParams {
  q: string
  kind: number
  limit?: number
}

async function searchEvents({ q, kind, limit = 30 }: SearchEventsParams): Promise<AugmentedEvent[]> {
  const ndkEvents = await ndk.fetchEvents(
    {
      kinds: [kind],
      search: q,
      limit
    },
    {}, // opts
    NDKRelaySet.fromRelayUrls([nostrbandRelay], ndk)
  )
  const augmentedEvents = [...ndkEvents.values()].map((e) => rawEvent(e))

  // desc by tm
  sortDesc(augmentedEvents)

  if (augmentedEvents.length > limit) augmentedEvents.length = limit

  console.log('search events prepared', augmentedEvents)

  return augmentedEvents
}

async function searchAuthoredEvents(params: SearchEventsParams): Promise<AuthoredEvent[]> {
  const augmentedEvents = await searchEvents(params)
  return await augmentEventAuthors(augmentedEvents)
}

export async function searchNotes(q: string, limit: number = 30): Promise<AuthoredEvent[]> {
  return searchAuthoredEvents({
    q,
    kind: KIND_NOTE,
    limit
  })
}

export async function searchLongNotes(q: string, limit: number = 30): Promise<LongNoteEvent[]> {
  const events = await searchAuthoredEvents({
    q,
    kind: KIND_LONG_NOTE,
    limit
  })
  return await augmentLongNotes(events)
}

export async function searchLiveEvents(q: string, limit: number = 30): Promise<LiveEvent[]> {
  const events = await searchEvents({
    q,
    kind: KIND_LIVE_EVENT,
    limit
  })
  return await augmentLiveEvents(events, [], limit, /*ended*/ true)
}

export async function searchCommunities(q: string, limit: number = 30): Promise<CommunityEvent[]> {
  const augmentedEvents = await searchEvents({
    q,
    kind: KIND_COMMUNITY,
    limit
  })
  const communities = await augmentCommunities(augmentedEvents)
  console.log('search communities', communities)
  return communities
}

interface PromiseQueueCb {
  cb: (...args: any[]) => void
  args: any[]
}

// used for handling a sequence of events and an eose after them,
// since each event-handling callback might be async we have to execute
// them one by one through a queue to ensure eose marker comes last
class PromiseQueue {
  queue: PromiseQueueCb[] = []

  constructor() {}

  appender(cb: (...cbArgs: any[]) => void): (...apArgs: any[]) => void {
    return (...args) => {
      this.queue.push({ cb, args })
      if (this.queue.length === 1) this.execute()
    }
  }

  async execute() {
    // the next cb in the queue
    const { cb, args } = this.queue[0]

    // execute the next cb
    await cb(...args)

    // mark the last cb as done
    this.queue.shift()

    // have the next one? proceed
    if (this.queue.length > 0) this.execute()
  }
}

interface IFetchPubkeyEventsParams {
  kind: number
  pubkeys: string[]
  tagged?: boolean
  limit?: number
  identifiers?: string[]
}

async function fetchPubkeyEvents({
  kind,
  pubkeys,
  tagged = false,
  limit = 30,
  identifiers = undefined
}: IFetchPubkeyEventsParams): Promise<AugmentedEvent[]> {
  const pks = [...pubkeys]
  if (pks.length > 200) pks.length = 200

  const filter: NDKFilter = {
    kinds: [kind],
    limit
  }

  if (tagged) filter['#p'] = pks
  else filter.authors = pks

  if (identifiers && identifiers.length > 0) filter['#d'] = identifiers

  const ndkEvents = await fetchEventsRead(ndk, filter)
  const augmentedEvents = [...ndkEvents.values()].map((e) => rawEvent(e))

  // desc by tm
  sortDesc(augmentedEvents)

  if (augmentedEvents.length > limit) augmentedEvents.length = limit

  return augmentedEvents
}

async function fetchPubkeyAuthoredEvents(params: IFetchPubkeyEventsParams): Promise<AuthoredEvent[]> {
  const augmentedEvents = await fetchPubkeyEvents(params)
  return await augmentEventAuthors(augmentedEvents)
}

export async function fetchFollowedLongNotes(contactPubkeys: string[]): Promise<LongNoteEvent[]> {
  const events = await fetchPubkeyAuthoredEvents({
    kind: KIND_LONG_NOTE,
    pubkeys: contactPubkeys
  })
  return await augmentLongNotes(events)
}

export async function fetchFollowedHighlights(contactPubkeys: string[]): Promise<HighlightEvent[]> {
  const events = await fetchPubkeyAuthoredEvents({
    kind: KIND_HIGHLIGHT,
    pubkeys: contactPubkeys
  })
  return events.map((e) => createHighlightEvent(e))
}

export async function fetchFollowedZaps(contactPubkeys: string[], minZap: number): Promise<ZapEvent[]> {
  const events = await fetchPubkeyEvents({
    kind: KIND_ZAP,
    pubkeys: contactPubkeys,
    tagged: true,
    limit: 200
  })
  return await augmentZaps(events, minZap)
}

export async function fetchFollowedCommunities(contactPubkeys: string[]): Promise<ExtendedCommunityEvent[]> {
  const approvalEvents = await fetchPubkeyEvents({
    kind: KIND_COMMUNITY_APPROVAL,
    pubkeys: contactPubkeys,
    limit: 100
  })

  // desc
  sortDesc(approvalEvents)
  //  console.log("approvals", approvals);

  const approvals: CommunityApprovalInfo[] = approvalEvents
    .map((e) => {
      return { tm: e.created_at, p: getTagValue(e, 'a').split(':') }
    })
    .filter((a) => a.p.length == 3 && Number(a.p[0]) === KIND_COMMUNITY)
    .map((a) => {
      const i = createCommunityApprovalInfo()
      i.created_at = a.tm
      i.communityPubkey = a.p[1]
      i.communityIdentifier = a.p[2]
      return i
    })
  //  console.log("addrs", addrs);

  const authoredEvents = await fetchPubkeyAuthoredEvents({
    kind: KIND_COMMUNITY,
    pubkeys: [...new Set(approvals.map((a) => a.communityPubkey))],
    identifiers: [...new Set(approvals.map((a) => a.communityIdentifier))],
    limit: 100
  })

  const communities = await augmentCommunities(authoredEvents)
  const extendedCommunities = await augmentCommunitiesApprovals(communities, approvals)
  console.log('communities extended', extendedCommunities)
  return extendedCommunities
}

async function augmentLiveEvents(
  augmentedEvent: AugmentedEvent[],
  contactPubkeys: string[],
  limit: number,
  ended = false
): Promise<LiveEvent[]> {
  // convert to an array of raw events

  let liveEvents = augmentedEvent.map((e) => createLiveEvent(createAuthoredEvent(e)))

  const MAX_LIVE_TTL = 3600
  liveEvents.forEach((e) => {
    e.title = getTagValue(e, 'title')
    e.summary = getTagValue(e, 'summary')
    e.starts = Number(getTagValue(e, 'starts'))
    e.current_participants = Number(getTagValue(e, 'current_participants'))
    e.status = getTagValue(e, 'status')

    // NIP-53: Clients MAY choose to consider status=live events
    // after 1hr without any update as ended.
    if (Date.now() / 1000 - e.created_at > MAX_LIVE_TTL) e.status = 'ended'

    const ps = getTags(e, 'p')
    e.host = ps.find((p) => p.length >= 4 && (p[3] === 'host' || p[3] === 'Host'))?.[1] || ''
    e.members = ps.filter((p) => p.length >= 4 && (!contactPubkeys || contactPubkeys.includes(p[1]))).map((p) => p[1])

    // newest-first
    e.order = e.starts

    // reverse order of all non-live events and make
    // them go after live ones
    if (e.status !== 'live') e.order = -e.order
  })

  // drop ended ones
  liveEvents = liveEvents.filter((e) => {
    return (
      !!e.host &&
      // For now let's show live events where some of our following are participating
      //	&& contactPubkeys.includes(e.host)
      (ended || e.status !== 'ended')
    )
  })

  // desc
  sortDesc(liveEvents)

  // crop
  if (liveEvents.length > limit) liveEvents.length = limit

  // fetch metas
  if (liveEvents.length > 0) {
    // profile infos
    const metas = await fetchMetas(liveEvents.map((e) => [e.pubkey, ...e.members]).flat())

    // assign to live events
    liveEvents.forEach((e) => {
      e.author = metas.find((m) => m.pubkey === e.pubkey) // provider
      e.hostMeta = metas.find((m) => m.pubkey === e.host) // host
      e.membersMeta = metas.filter((m) => e.members.includes(m.pubkey)) // all members: host, speakers, participants
    })
  }

  return liveEvents
}

export async function fetchFollowedLiveEvents(contactPubkeys: string[], limit: number = 30): Promise<LiveEvent[]> {
  let events = await fetchPubkeyEvents({
    kind: KIND_LIVE_EVENT,
    pubkeys: contactPubkeys,
    tagged: true
  })

  return await augmentLiveEvents(events, contactPubkeys, limit)
}

class Subscription<OutputEventType> {
  lastSub: NDKSubscription | null = null
  label: string = ''
  onEvent: (e: AugmentedEvent) => Promise<OutputEventType>

  constructor(label: string, onEvent: (e: AugmentedEvent) => Promise<OutputEventType>) {
    this.label = label
    this.onEvent = onEvent
  }

  async restart(filter: NDKFilter, cb: (e: OutputEventType) => Promise<void>) {
    // gc
    if (this.lastSub) {
      this.lastSub.stop()
      this.lastSub = null
    }

    const events = new Map<string, NDKEvent>()
    let eose = false

    const sub: NDKSubscription = await ndk.subscribe(
      filter,
      { closeOnEose: false },
      NDKRelaySet.fromRelayUrls(readRelays, ndk),
      /* autoStart */ false
    )

    // ensure async callbacks are executed one by one
    const pq = new PromiseQueue()

    // helper to transform and return the event
    const returnEvent = async (event: NDKEvent) => {
      const e = await this.onEvent(rawEvent(event))
      console.log('returning', this.label, e)
      await cb(e)
    }

    // call cb on each event
    sub.on('event', (event: NDKEvent) => {
      // dedup
      const dedupKey = event.deduplicationKey()
      const existingEvent = events.get(dedupKey)
      // console.log("dedupKey", dedupKey, "existingEvent", existingEvent?.created_at, "event", event.created_at);
      if (existingEvent?.created_at > event.created_at) {
        // ignore old event
        return
      }
      events.set(dedupKey, event)

      // add to promise queue
      pq.appender(async (event: NDKEvent) => {
        console.log('got new', this.label, 'event', event, 'from', event.relay.url)

        // we've reached the end and this is still the newest event?
        if (eose && events.get(dedupKey) == event) await returnEvent(event)
      })(event)
    })

    // notify that initial fetch is over
    sub.on(
      'eose',
      pq.appender(async (sub, reason) => {
        console.log('eose was', eose, this.label, 'events', events.size, 'reason', reason, 'at', Date.now())
        if (eose) return // WTF second one?

        eose = true
        for (const e of [...events.values()]) await returnEvent(e)
      })
    )

    // start
    console.log('start', this.label, 'at', Date.now())
    sub.start()

    // store
    this.lastSub = sub
  }
}

const profileSub = new Subscription<MetaEvent>('profile', (p: AugmentedEvent) => {
  const m = createMetaEvent(p)
  m.profile = parseProfileJson(p)
  return Promise.resolve(m)
})

export async function subscribeProfiles(pubkeys: string[], cb: (m: MetaEvent) => Promise<void>) {
  profileSub.restart(
    {
      authors: [...pubkeys],
      kinds: [KIND_META]
    },
    cb
  )
}

const contactListSub = new Subscription<ContactListEvent>('contact list', async (e: AugmentedEvent) => {
  const contactList = createContactListEvent(e)

  contactList.contactPubkeys = [
    ...new Set(contactList.tags.filter((t) => t.length >= 2 && t[0] === 'p').map((t) => t[1]))
  ]
  contactList.contactEvents = []

  if (contactList.contactPubkeys.length) {
    // profiles
    const contactEvents = await fetchMetas(contactList.contactPubkeys)

    // assign order
    contactEvents.forEach((p) => {
      p.order = contactList.contactPubkeys.findIndex((pk) => pk == p.pubkey)
    })

    sortDesc(contactEvents)

    contactList.contactEvents = contactEvents
  }

  return contactList
})

export async function subscribeContactList(pubkey: string, cb: (e: ContactListEvent) => Promise<void>) {
  contactListSub.restart(
    {
      authors: [pubkey],
      kinds: [KIND_CONTACT_LIST]
    },
    cb
  )
}

// const bookmarkListSub = new Subscription('bookmark list', async (bookmarkList) => {
//   bookmarkList.bookmarkEventIds = [
//     ...new Set(bookmarkList.tags.filter((t) => t.length >= 2 && t[0] === 'e').map((t) => t[1]))
//   ]
//   bookmarkList.bookmarkEvents = []

//   if (bookmarkList.bookmarkEventIds.length) {
//     bookmarkList.bookmarkEvents = await fetchAuthoredEventsByIds({
//       ids: bookmarkList.bookmarkEventIds,
//       kinds: [KIND_NOTE, KIND_LONG_NOTE]
//     })

//     bookmarkList.bookmarkEvents.forEach((e) => {
//       e.order = bookmarkList.bookmarkEventIds.findIndex((id) => id == e.id)
//     })

//     sortDesc(bookmarkList.bookmarkEvents)
//   }

//   return bookmarkList
// })

// export async function subscribeBookmarkList(pubkey: string, cb) {
//   bookmarkListSub.restart(
//     {
//       authors: [pubkey],
//       kinds: [KIND_BOOKMARKS]
//     },
//     cb
//   )
// }

export function stringToBech32(s: string, hex: boolean = false): string {
  if (!s) return ''
  const BECH32_REGEX = /[a-z]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/g

  const array = [...s.matchAll(BECH32_REGEX)].map((a) => a[0])

  let bech32 = ''
  for (let b32 of array) {
    try {
      const { type } = nip19.decode(b32)
      //      console.log("b32", b32, "type", type, "data", data);
      switch (type) {
        case 'npub':
        case 'nprofile':
        case 'note':
        case 'nevent':
        case 'naddr':
          bech32 = b32
          break
      }
    } catch (e) {
      console.log('bad b32', b32, 'e', e)
    }

    if (bech32) return bech32
  }

  if (hex) {
    if (s.length == 64 && s.match(/0-9A-Fa-f]{64}/g)) return s
  }

  return ''
}

export function stringToBolt11(s: string): [string, any] {
  if (!s) return ['', null]

  const INVOICE_REGEX = /^(lnbcrt|lntb|lnbc|LNBCRT|LNTB|LNBC)([0-9]{1,}[a-zA-Z0-9]+){1}$/g

  const array = [...s.matchAll(INVOICE_REGEX)].map((a) => a[0])

  let invoice = null
  for (let b32 of array) {
    console.log('maybe invoice', b32, s)
    if (!b32.toLowerCase().startsWith('lnbc')) continue
    try {
      return [b32, bolt11Decode(b32)]
    } catch (e) {
      console.log('bad invoice', b32, 'e', e)
    }
  }

  return ['', null]
}

export function createAddrOpener(cb: (addr: string) => void): (event: Event) => void {
  return (event: Event) => {
    let addr = event.id

    if (event.kind === KIND_META) {
      // npub
      addr = nip19.npubEncode(event.pubkey)
    } else if ((event.kind >= 10000 && event.kind < 20000) || (event.kind >= 30000 && event.kind < 40000)) {
      // naddr
      addr = nip19.naddrEncode({
        pubkey: event.pubkey,
        kind: event.kind,
        identifier: getTagValue(event, 'd'),
        relays: [nostrbandRelay]
      })
    } else {
      // nevent
      addr = nip19.neventEncode({
        id: event.id,
        relays: [nostrbandRelay]
      })
    }

    console.log('addr', addr)
    cb(addr)
  }
}

export function connect(): Promise<void> {
  // main instance
  ndk = new NDK({ explicitRelayUrls: allRelays })

  const scheduleStats = () => {
    setTimeout(() => {
      console.log('ndk stats', JSON.stringify(ndk.pool.stats()))
      scheduleStats()
    }, 5000)
  }
  scheduleStats()

  return ndk.pool.connect(/* timeoutMs */ 1000, /* minConns */ 3)
}

function addRelay(r: string): NDKRelay {
  if (!ndk.pool.relays.get(r)) ndk.pool.addRelay(new NDKRelay(r))
  return ndk.pool.relays.get(r)
}

export async function addWalletInfo(info: WalletInfo): Promise<void> {
  const relay = await addRelay(info.relay)
  relay.on('notice', (msg: string) => console.log('notice from', info.relay, msg))
  relay.on('publish:failed', (event: NDKEvent, err: string) => console.log('publish failed to', info.relay, event, err))
}

export async function sendPayment(info: WalletInfo, payreq: string) {
  localStorage.debug = 'ndk:-'

  const relay = await addRelay(info.relay)
  console.log('relay', relay.url, 'status', relay.status)

  const req = {
    method: 'pay_invoice',
    params: {
      invoice: payreq
    }
  }

  const encReq = await walletstore.encrypt(info.publicKey, JSON.stringify(req))
  console.log('encReq', encReq)

  const event = {
    pubkey: info.publicKey,
    kind: KIND_NWC_PAYMENT_REQUEST,
    tags: [['p', info.publicKey]],
    content: encReq,
    created_at: Math.floor(Date.now() / 1000)
  }

  const signed = await walletstore.signEvent(event)
  console.log('signed', JSON.stringify(signed))
  console.log('signed id', signed.id)

  const relaySet = NDKRelaySet.fromRelayUrls([info.relay], ndk)

  const sub = await ndk.subscribe(
    {
      kinds: [KIND_NWC_PAYMENT_REPLY],
      '#e': [signed.id],
      authors: [info.publicKey]
    },
    { closeOnEose: false },
    relaySet,
    /* autoStart */ false
  )

  return new Promise((ok, err) => {
    // make sure we don't wait forever
    const TIMEOUT_MS = 30000 // 30 sec
    const to = setTimeout(() => {
      sub.stop()
      err('Timeout error, payment might have failed')
    }, TIMEOUT_MS)

    sub.on('event', async (e: NDKEvent) => {
      e = rawEvent(e)
      if (
        e.pubkey === info.publicKey &&
        e.tags.find((t: string[]) => t.length >= 2 && t[0] === 'e' && t[1] === signed.id)
      ) {
        clearTimeout(to)
        console.log('payment reply event', JSON.stringify(e))

        const rep = JSON.parse(await walletstore.decrypt(e.pubkey, e.content))
        console.log('payment reply', JSON.stringify(rep))

        if (rep.result_type === 'pay_invoice') {
          if (rep.error) err(rep.error.message || 'Error from the wallet')
          else ok({ preimage: rep.result.preimage })
        } else {
          err('Invalid payment reply')
        }
      } else {
        console.log('irrelevant event received', JSON.stringify(e))
      }
    })

    // publish when we're 100% sure we've subscribed to replies
    sub.on('eose', async () => {
      // publish
      try {
        const r = await ndk.publish(new NDKEvent(ndk, signed), relaySet, TIMEOUT_MS / 2)
        console.log('published', r)
      } catch (e) {
        err('Failed to send payment request: ' + e)
      }
    })

    // subscribe before publishing
    sub.start()
  })
}

export function putEventToCache(e: AugmentedEvent | MetaEvent) {
  if (e.kind === KIND_META) metaCache.set(e.pubkey, e)
  eventCache.set(e.id, e)
  addrCache.set(getEventAddr(e), e)
}

export function setNsbSigner(token: string) {
  nsbSigner = new NDKNip46Signer(nsbNDK, token, new NDKNip07Signer())
}

export async function nsbSignEvent(pubkey: string, event: NostrEvent): Promise<NostrEvent> {
  if (!nsbSigner) throw new Error(`NSB signer not found for ${pubkey}`)
  if (!nsbSigner.connected) {
    console.log('nsb connecting for pubkey', pubkey)
    await nsbSigner.blockUntilReady()
    nsbSigner.connected = true
  }

  event.pubkey = pubkey
  event.id = getEventHash(event)
  console.log('nsb signing event ', event.id, 'by', pubkey)
  event.sig = await nsbSigner.sign(event)

  return event
}
