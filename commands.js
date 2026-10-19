// commands.js — HACKER MD (50 commands)
import os from 'os'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'

const baileys = await import('@whiskeysockets/baileys').catch(() => import('baileys'))
const { downloadMediaMessage } = baileys

const BOT_NAME = process.env.BOT_NAME || 'HACKER MD'
const DEV_NAME = 'Arnold Adez'
const DEV_NUMBER = '254111783552'
const VERSION = '1.0.0'

// ───────── settings (in-memory, saved to settings.json when possible) ─────────
const SETTINGS_FILE = './settings.json'
export const settings = { prefix: '.', mode: 'public', botName: '', tz: 'Africa/Nairobi' }
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))) } catch {}
const save = () => { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings)) } catch {} }
const botName = () => settings.botName || BOT_NAME

// ───────── helpers ─────────
const START = Date.now()
const jidOf = m => m.key.remoteJid
const isGroup = j => j.endsWith('@g.us')
const senderOf = m => m.key.participant || m.participant || m.key.remoteJid
const isOwner = m => m.key.fromMe || senderOf(m).split('@')[0].split(':')[0] === DEV_NUMBER
const reply = (sock, m, text, extra = {}) => sock.sendMessage(jidOf(m), { text, ...extra }, { quoted: m })
const rnd = a => a[Math.floor(Math.random() * a.length)]
const fmtUp = s => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${Math.floor(s % 60)}s`

const textOf = msg => {
  const x = msg?.message || msg
  return x?.conversation || x?.extendedTextMessage?.text || x?.imageMessage?.caption || x?.videoMessage?.caption || ''
}
const quotedOf = m => {
  const c = m.message?.extendedTextMessage?.contextInfo
  return c?.quotedMessage
    ? { key: { remoteJid: jidOf(m), id: c.stanzaId, participant: c.participant }, message: c.quotedMessage }
    : null
}
const inputOf = (m, args) => args.join(' ') || textOf(quotedOf(m))
const targetOf = (m, args) => {
  const c = m.message?.extendedTextMessage?.contextInfo
  const num = (args[0] || '').replace(/\D/g, '')
  return c?.mentionedJid?.[0] || c?.participant || (num ? num + '@s.whatsapp.net' : null)
}

const getJSON = async (url, opts = {}) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000), ...opts })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}
const getText = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.text()
}
const getBuf = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return Buffer.from(await r.arrayBuffer())
}

// media + ffmpeg (ffmpeg must be installed on the host)
const getMedia = async (sock, m) => {
  const q = quotedOf(m) || m
  let msg = q.message
  msg = msg?.viewOnceMessage?.message || msg?.viewOnceMessageV2?.message || msg?.viewOnceMessageV2Extension?.message || msg
  const type = Object.keys(msg || {})[0]
  if (!/image|video|audio|sticker|document/i.test(type || '')) return null
  const buf = await downloadMediaMessage({ key: q.key, message: msg }, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
  return { buf, type }
}
const ff = (buf, args, ext = 'mp3') => new Promise((resolve, reject) => {
  const id = Date.now() + Math.random().toString(36).slice(2)
  const i = path.join(os.tmpdir(), id + '.in')
  const o = path.join(os.tmpdir(), id + '.' + ext)
  fs.writeFileSync(i, buf)
  exec(`ffmpeg -y -i "${i}" ${args} "${o}"`, err => {
    try { err ? reject(err) : resolve(fs.readFileSync(o)) } finally { fs.rm(i, () => {}); fs.rm(o, () => {}) }
  })
})

// admin / owner wrappers
const groupCmd = (fn, admin = true) => async (sock, m, args) => {
  const jid = jidOf(m)
  if (!isGroup(jid)) return reply(sock, m, '❌ Groups only')
  const meta = await sock.groupMetadata(jid)
  const s = senderOf(m)
  const ok = isOwner(m) || meta.participants.some(p => p.id === s && p.admin)
  if (admin && !ok) return reply(sock, m, '❌ Admins only')
  return fn(sock, m, args, meta)
}
const ownerCmd = fn => async (sock, m, args) => {
  if (!isOwner(m)) return reply(sock, m, '❌ Owner only')
  return fn(sock, m, args)
}

// ───────── AI (free keyless service) ─────────
const ai = async (prompt, sys, model = 'openai') => {
  const j = await getJSON('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] })
  })
  return j.choices[0].message.content
}
const mkAI = (model, sys = 'You are a helpful assistant. Keep answers concise and suitable for WhatsApp.') =>
  async (sock, m, args) => {
    const q = inputOf(m, args)
    if (!q) return reply(sock, m, 'Usage: type your question after the command')
    await reply(sock, m, await ai(q, sys, model))
  }

// ───────── image helpers ─────────
const sendImg = (sock, m, url, caption = '') => sock.sendMessage(jidOf(m), { image: { url }, caption }, { quoted: m })
const anime = kind => async (sock, m) => {
  const j = await getJSON(`https://api.waifu.pics/sfw/${kind}`)
  await sock.sendMessage(
    jidOf(m),
    j.url.endsWith('.gif') ? { video: { url: j.url }, gifPlayback: true } : { image: { url: j.url } },
    { quoted: m }
  )
}

// ───────── fun data ─────────
const EIGHT = ['Yes', 'No', 'Maybe', 'Definitely', 'Ask again later', 'Very doubtful', 'Without a doubt', 'Not likely']
const TRUTHS = ['What is your biggest fear?', 'Who was your first crush?', 'What is the last lie you told?', 'What is your most embarrassing moment?', 'What secret have you never told anyone?']
const DARES = ['Send a voice note singing a song', 'Change your status to "I love pineapple pizza" for 1 hour', 'Text your crush "hi"', 'Do 10 pushups and send proof', 'Speak in rhymes for the next 5 messages']

// per-chat game state
const GUESS = new Map()

// ───────── the 50 commands ─────────
const commands = {
  // ── core / info (8) ──
  ping: async (sock, m) => {
    const ms = Math.max(0, Date.now() - Number(m.messageTimestamp || 0) * 1000)
    await reply(sock, m, `Pong! 🏓 ${ms} ms`)
  },
  time: async (sock, m) => reply(sock, m, `🕒 ${new Date().toLocaleString('en-GB', { timeZone: settings.tz })}`),
  uptime: async (sock, m) => reply(sock, m, `⏱️ Uptime: ${fmtUp((Date.now() - START) / 1000)}`),
  alive: async (sock, m) => reply(sock, m, `✅ ${botName()} is alive and running.\nVersion: ${VERSION}\nUptime: ${fmtUp((Date.now() - START) / 1000)}`),
  owner: async (sock, m) => reply(sock, m, [
    `┌─ ${botName()} OWNER ─`,
    `│ • Developer : ${DEV_NAME}`,
    `│ • Number    : +${DEV_NUMBER}`,
    `│ • Chat      : wa.me/${DEV_NUMBER}`,
    '└─'
  ].join('\n')),
  botstatus: async (sock, m) => {
    const tm = os.totalmem()
    const used = Math.round((tm - os.freemem()) / 1048576)
    await reply(sock, m, [
      `🤖 *${botName()} status*`,
      `Mode: ${settings.mode}`,
      `Prefix: ${settings.prefix}`,
      `Timezone: ${settings.tz}`,
      `Platform: ${process.env.RENDER ? 'Render' : os.platform()}`,
      `Node: ${process.version}`,
      `RAM: ${used} MB / ${Math.round(tm / 1048576)} MB`,
      `Uptime: ${fmtUp((Date.now() - START) / 1000)}`
    ].join('\n'))
  },
  whoami: async (sock, m) => {
    const s = senderOf(m)
    await reply(sock, m, `👤 You are @${s.split('@')[0].split(':')[0]}\nOwner: ${isOwner(m) ? 'yes' : 'no'}`, { mentions: [s] })
  },
  menu: async (sock, m) => {
    const p = settings.prefix
    const body = Object.entries(CATS)
      .map(([n, l]) => `┏▣ ◈ *${n}* ◈\n${l.map(c => `┃➽ ${p}${c}`).join('\n')}\n┗▣`)
      .join('\n\n')
    const head = [
      `┏▣ ◈ *${botName()}* ◈`,
      `┃ *OWNER* : ${DEV_NAME}`,
      `┃ *PREFIX* : [ ${p} ]`,
      `┃ *MODE* : ${settings.mode}`,
      `┃ *COMMANDS* : ${Object.keys(commands).length}`,
      `┃ *VERSION* : ${VERSION}`,
      `┃ *UPTIME* : ${fmtUp((Date.now() - START) / 1000)}`,
      '┗▣'
    ].join('\n')
    await reply(sock, m, `${head}\n\n${body}\n\n◈ POWERED BY ${botName()} ◈`)
  },

  // ── owner (5) ──
  setprefix: ownerCmd(async (sock, m, args) => {
    const v = args[0]
    if (!v || v.length > 3) return reply(sock, m, 'Usage: .setprefix <symbol> (max 3 chars)')
    settings.prefix = v; save()
    await reply(sock, m, `✅ Prefix set to ${v}`)
  }),
  setmode: ownerCmd(async (sock, m, args) => {
    const v = (args[0] || '').toLowerCase()
    if (!['public', 'private'].includes(v)) return reply(sock, m, `Usage: .setmode public|private (now: ${settings.mode})`)
    settings.mode = v; save()
    await reply(sock, m, `✅ Mode set to ${v}`)
  }),
  setbotname: ownerCmd(async (sock, m, args) => {
    const v = args.join(' ').trim()
    if (!v) return reply(sock, m, 'Usage: .setbotname <name>')
    settings.botName = v; save()
    await reply(sock, m, `✅ Bot name set to ${v}`)
  }),
  settimezone: ownerCmd(async (sock, m, args) => {
    const v = args[0]
    if (!v) return reply(sock, m, 'Usage: .settimezone Africa/Nairobi')
    try { new Date().toLocaleString('en-GB', { timeZone: v }) } catch { return reply(sock, m, '❌ Invalid timezone') }
    settings.tz = v; save()
    await reply(sock, m, `✅ Timezone set to ${v}`)
  }),
  restart: ownerCmd(async (sock, m) => {
    await reply(sock, m, '♻️ Restarting...')
    setTimeout(() => process.exit(0), 1500)
  }),

  // ── fun (8) ──
  '8ball': async (sock, m, args) => reply(sock, m, args.length ? `🎱 ${rnd(EIGHT)}` : 'Usage: .8ball <question>'),
  coinflip: async (sock, m) => reply(sock, m, rnd(['🪙 Heads', '🪙 Tails'])),
  dice: async (sock, m) => reply(sock, m, `🎲 You rolled a ${Math.floor(Math.random() * 6) + 1}`),
  dare: async (sock, m) => reply(sock, m, `😈 Dare: ${rnd(DARES)}`),
  truth: async (sock, m) => reply(sock, m, `🤔 Truth: ${rnd(TRUTHS)}`),
  joke: async (sock, m) => {
    const j = await getJSON('https://official-joke-api.appspot.com/random_joke')
    await reply(sock, m, `😂 ${j.setup}\n\n${j.punchline}`)
  },
  fact: async (sock, m) => {
    const j = await getJSON('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en')
    await reply(sock, m, `💡 ${j.text}`)
  },
  quote: async (sock, m) => {
    const [q] = await getJSON('https://zenquotes.io/api/random')
    await reply(sock, m, `💬 "${q.q}"\n— ${q.a}`)
  },

  // ── AI (5) ──
  gpt: mkAI('openai'),
  deepseek: mkAI('deepseek'),
  story: mkAI('openai', 'Write a short, engaging story (under 250 words) about the given idea.'),
  summarize: mkAI('openai', 'Summarize the given text in a few short bullet points.'),
  translate2: async (sock, m, args) => {
    const [lang, ...rest] = args
    const q = rest.join(' ') || textOf(quotedOf(m))
    if (!lang || !q) return reply(sock, m, 'Usage: .translate2 <language> <text>')
    await reply(sock, m, await ai(q, `Translate the user's text to ${lang}. Reply with the translation only.`))
  },

  // ── tools (7) ──
  calc: async (sock, m, args) => {
    const expr = args.join(' ').replace(/\^/g, '**')
    if (!expr || !/^[\d+\-*/().%\s*]+$/.test(expr)) return reply(sock, m, 'Usage: .calc 12*(3+4)  (numbers and + - * / % ^ ( ) only)')
    let out
    try { out = Function(`"use strict"; return (${expr})`)() } catch { return reply(sock, m, '❌ Invalid expression') }
    await reply(sock, m, `🧮 ${expr} = ${out}`)
  },
  weather: async (sock, m, args) => {
    const city = args.join(' ')
    if (!city) return reply(sock, m, 'Usage: .weather <city>')
    await reply(sock, m, `🌤️ ${(await getText(`https://wttr.in/${encodeURIComponent(city)}?format=3`)).trim()}`)
  },
  define: async (sock, m, args) => {
    const w = args[0]
    if (!w) return reply(sock, m, 'Usage: .define <word>')
    const j = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`).catch(() => null)
    const d = j?.[0]?.meanings?.[0]
    if (!d) return reply(sock, m, '❌ No definition found')
    await reply(sock, m, `📖 *${w}* (${d.partOfSpeech})\n${d.definitions[0].definition}`)
  },
  wiki: async (sock, m, args) => {
    const q = args.join(' ')
    if (!q) return reply(sock, m, 'Usage: .wiki <topic>')
    const j = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`).catch(() => null)
    if (!j?.extract) return reply(sock, m, '❌ Nothing found')
    await reply(sock, m, `📚 *${j.title}*\n\n${j.extract}`)
  },
  qr: async (sock, m, args) => {
    const t = inputOf(m, args)
    if (!t) return reply(sock, m, 'Usage: .qr <text or link>')
    await sendImg(sock, m, `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(t)}`, 'QR code')
  },
  shorturl: async (sock, m, args) => {
    const u = args[0]
    if (!/^https?:\/\//i.test(u || '')) return reply(sock, m, 'Usage: .shorturl https://example.com')
    const j = await getJSON(`https://is.gd/create.php?format=json&url=${encodeURIComponent(u)}`)
    await reply(sock, m, j.shorturl ? `🔗 ${j.shorturl}` : `❌ ${j.errormessage || 'Failed'}`)
  },
  iplookup: async (sock, m, args) => {
    const ip = args[0]
    if (!ip) return reply(sock, m, 'Usage: .iplookup <ip>')
    const j = await getJSON(`https://ipwho.is/${encodeURIComponent(ip)}`)
    if (!j.success) return reply(sock, m, '❌ Lookup failed')
    await reply(sock, m, `🌐 ${j.ip}\nCountry: ${j.country}\nRegion: ${j.region}\nCity: ${j.city}\nISP: ${j.connection?.isp || 'n/a'}`)
  },

  // ── group (9) ──
  tagall: groupCmd(async (sock, m, args, meta) => {
    const note = args.join(' ') || 'Attention everyone!'
    const list = meta.participants.map(p => `@${p.id.split('@')[0]}`).join(' ')
    await sock.sendMessage(jidOf(m), { text: `📢 ${note}\n\n${list}`, mentions: meta.participants.map(p => p.id) }, { quoted: m })
  }),
  hidetag: groupCmd(async (sock, m, args, meta) => {
    const text = inputOf(m, args) || ''
    await sock.sendMessage(jidOf(m), { text, mentions: meta.participants.map(p => p.id) }, { quoted: m })
  }),
  kick: groupCmd(async (sock, m, args) => {
    const t = targetOf(m, args)
    if (!t) return reply(sock, m, 'Usage: reply to a user, mention them, or give their number')
    await sock.groupParticipantsUpdate(jidOf(m), [t], 'remove')
    await reply(sock, m, '✅ Removed')
  }),
  add: groupCmd(async (sock, m, args) => {
    const num = (args[0] || '').replace(/\D/g, '')
    if (!num) return reply(sock, m, 'Usage: .add 2547xxxxxxxx')
    await sock.groupParticipantsUpdate(jidOf(m), [num + '@s.whatsapp.net'], 'add')
    await reply(sock, m, '✅ Add request sent')
  }),
  promote: groupCmd(async (sock, m, args) => {
    const t = targetOf(m, args)
    if (!t) return reply(sock, m, 'Usage: reply to a user, mention them, or give their number')
    await sock.groupParticipantsUpdate(jidOf(m), [t], 'promote')
    await reply(sock, m, '✅ Promoted to admin')
  }),
  demote: groupCmd(async (sock, m, args) => {
    const t = targetOf(m, args)
    if (!t) return reply(sock, m, 'Usage: reply to a user, mention them, or give their number')
    await sock.groupParticipantsUpdate(jidOf(m), [t], 'demote')
    await reply(sock, m, '✅ Demoted')
  }),
  link: groupCmd(async (sock, m) => {
    await reply(sock, m, `🔗 https://chat.whatsapp.com/${await sock.groupInviteCode(jidOf(m))}`)
  }),
  setname: groupCmd(async (sock, m, args) => {
    const v = args.join(' ').trim()
    if (!v) return reply(sock, m, 'Usage: .setname <new group name>')
    await sock.groupUpdateSubject(jidOf(m), v)
    await reply(sock, m, '✅ Group name updated')
  }),
  setdesc: groupCmd(async (sock, m, args) => {
    const v = args.join(' ').trim()
    if (!v) return reply(sock, m, 'Usage: .setdesc <new description>')
    await sock.groupUpdateDescription(jidOf(m), v)
    await reply(sock, m, '✅ Group description updated')
  }),

  // ── media (3) ──
  tosticker: async (sock, m) => {
    const md = await getMedia(sock, m)
    if (!md || !/image|video|sticker/i.test(md.type)) return reply(sock, m, '❌ Reply to an image/video/gif')
    const vf = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:-1:-1:color=0x00000000'
    const out = /video/i.test(md.type)
      ? await ff(md.buf, `-t 6 -an -vf "fps=12,${vf}" -vcodec libwebp -loop 0`, 'webp')
      : await ff(md.buf, `-vf "${vf}" -vcodec libwebp`, 'webp')
    await sock.sendMessage(jidOf(m), { sticker: out }, { quoted: m })
  },
  tts: async (sock, m, args) => {
    const t = inputOf(m, args).slice(0, 200)
    if (!t) return reply(sock, m, 'Usage: .tts <text>')
    const buf = await getBuf(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(t)}`)
    await sock.sendMessage(jidOf(m), { audio: buf, mimetype: 'audio/mpeg' }, { quoted: m })
  },
  vv: async (sock, m) => {
    const md = await getMedia(sock, m)
    if (!md) return reply(sock, m, '❌ Reply to a view-once photo or video')
    const msg = /video/i.test(md.type) ? { video: md.buf } : { image: md.buf }
    await sock.sendMessage(jidOf(m), msg, { quoted: m })
  },

  // ── games (2) ──
  numberguess: async (sock, m, args) => {
    const jid = jidOf(m)
    const g = GUESS.get(jid)
    const n = parseInt(args[0], 10)
    if (!g || args[0] === 'new') {
      GUESS.set(jid, { n: Math.floor(Math.random() * 100) + 1, tries: 0 })
      return reply(sock, m, '🔢 I picked a number from 1 to 100. Guess with .numberguess <number>')
    }
    if (Number.isNaN(n)) return reply(sock, m, 'Usage: .numberguess <number>  (or .numberguess new)')
    g.tries++
    if (n === g.n) { GUESS.delete(jid); return reply(sock, m, `🎉 Correct! It was ${n}. Tries: ${g.tries}`) }
    await reply(sock, m, n < g.n ? '⬆️ Higher' : '⬇️ Lower')
  },
  slots: async (sock, m) => {
    const S = ['🍒', '🍋', '🍇', '🍉', '⭐', '7️⃣']
    const r = [rnd(S), rnd(S), rnd(S)]
    const win = r[0] === r[1] && r[1] === r[2]
    await reply(sock, m, `🎰 ${r.join(' | ')}\n${win ? '🎉 JACKPOT!' : 'No luck, try again.'}`)
  },

  // ── anime (3) ──
  neko: async (sock, m) => anime('neko')(sock, m),
  waifu: async (sock, m) => anime('waifu')(sock, m),
  hug: async (sock, m) => anime('hug')(sock, m)
}

// ───────── categories (drive the menu) ─────────
const CATS = {
  INFO: ['ping', 'time', 'uptime', 'alive', 'owner', 'botstatus', 'whoami', 'menu'],
  OWNER: ['setprefix', 'setmode', 'setbotname', 'settimezone', 'restart'],
  FUN: ['8ball', 'coinflip', 'dice', 'dare', 'truth', 'joke', 'fact', 'quote'],
  AI: ['gpt', 'deepseek', 'story', 'summarize', 'translate2'],
  TOOLS: ['calc', 'weather', 'define', 'wiki', 'qr', 'shorturl', 'iplookup'],
  GROUP: ['tagall', 'hidetag', 'kick', 'add', 'promote', 'demote', 'link', 'setname', 'setdesc'],
  MEDIA: ['tosticker', 'tts', 'vv'],
  GAMES: ['numberguess', 'slots'],
  ANIME: ['neko', 'waifu', 'hug']
}

// ───────── dispatcher ─────────
export const handleCommand = async (sock, m) => {
  const body = textOf(m).trim()
  if (!body.startsWith(settings.prefix)) return false
  const [name, ...args] = body.slice(settings.prefix.length).trim().split(/\s+/)
  const fn = commands[(name || '').toLowerCase()]
  if (!fn) return false
  if (settings.mode === 'private' && !isOwner(m)) return false
  try {
    await fn(sock, m, args)
  } catch (e) {
    console.error(`[command:${name}]`, e)
    await reply(sock, m, `❌ ${name} failed: ${e.message || e}`).catch(() => {})
  }
  return true
}

export { commands }
export default handleCommand
  
