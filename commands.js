// commands.js — HACKER MD (all commands from the menu)
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
export const settings = {
  prefix: '.', mode: 'public', botName: '', tz: 'Africa/Nairobi', emoji: '😎',
  autobio: false, autoread: false, autoreact: false, autotype: false, autoviewstatus: false,
  anticall: false, antidelete: false, antilink: {}, antispam: {}, antisticker: {}, welcome: {}
}
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
const shuffle = a => [...a].sort(() => Math.random() - 0.5)
const fmtUp = s => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${Math.floor(s % 60)}s`

const textOf = msg => {
  const x = msg?.message || msg
  return x?.conversation || x?.extendedTextMessage?.text || x?.imageMessage?.caption || x?.videoMessage?.caption || ''
}
const quotedOf = m => {
  const c = m.message?.extendedTextMessage?.contextInfo
  return c?.quotedMessage ? { key: { remoteJid: jidOf(m), id: c.stanzaId, participant: c.participant }, message: c.quotedMessage } : null
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
  const i = path.join(os.tmpdir(), id + '.in'), o = path.join(os.tmpdir(), id + '.' + ext)
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

// ───────── AI (free keyless service; different models where available) ─────────
const ai = async (prompt, sys, model = 'openai') => {
  const j = await getJSON('https://text.pollinations.ai/openai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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

// ───────── image / logo helpers ─────────
const sendImg = (sock, m, url, caption = '') => sock.sendMessage(jidOf(m), { image: { url }, caption }, { quoted: m })
const logo = style => async (sock, m, args) => {
  const t = args.join(' ')
  if (!t) return reply(sock, m, 'Usage: give a text for the logo')
  const p = encodeURIComponent(`${style} text logo that says "${t}", centered, high quality, dark background`)
  await sendImg(sock, m, `https://image.pollinations.ai/prompt/${p}?width=1024&height=1024&nologo=true`, `${style} logo`)
}
const avatarOf = async (sock, m, args) => {
  const t = targetOf(m, args) || senderOf(m)
  try { return await sock.profilePictureUrl(t, 'image') } catch { return 'https://i.imgur.com/6VBx3io.png' }
}
const overlay = base => async (sock, m, args) => {
  const url = base + encodeURIComponent(await avatarOf(sock, m, args))
  const buf = await getBuf(url)
  await sock.sendMessage(jidOf(m), url.includes('triggered') ? { video: buf, gifPlayback: true } : { image: buf }, { quoted: m })
}
const anime = kind => async (sock, m) => {
  const j = await getJSON(`https://api.waifu.pics/sfw/${kind}`)
  await sock.sendMessage(jidOf(m), j.url.endsWith('.gif') ? { video: { url: j.url }, gifPlayback: true } : { image: { url: j.url } }, { quoted: m })
}

// ───────── audio effects ─────────
const fx = filter => async (sock, m) => {
  const md = await getMedia(sock, m)
  if (!md) return reply(sock, m, '❌ Reply to an audio/voice note/video')
  const out = await ff(md.buf, `-vn -af "${filter}"`, 'mp3')
  await sock.sendMessage(jidOf(m), { audio: out, mimetype: 'audio/mpeg' }, { quoted: m })
}
const ptt = async (sock, m) => {
  const md = await getMedia(sock, m)
  if (!md) return reply(sock, m, '❌ Reply to an audio/video')
  const out = await ff(md.buf, '-vn -c:a libopus -b:a 64k', 'ogg')
  await sock.sendMessage(jidOf(m), { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m })
}
const toMp3 = async (sock, m) => {
  const md = await getMedia(sock, m)
  if (!md) return reply(sock, m, '❌ Reply to an audio/video')
  const out = await ff(md.buf, '-vn -b:a 128k', 'mp3')
  await sock.sendMessage(jidOf(m), { audio: out, mimetype: 'audio/mpeg' }, { quoted: m })
}

// ───────── downloaders (need your own API, see DL_API) ─────────
const dl = (kind, as) => async (sock, m, args) => {
  const q = args.join(' ')
  if (!q) return reply(sock, m, `Usage: .${kind} <link or name>`)
  if (!process.env.DL_API) return reply(sock, m, '⚙️ Set the DL_API env variable to your downloader API base URL first.')
  const j = await getJSON(`${process.env.DL_API}/${kind}?q=${encodeURIComponent(q)}`)
  const r = j.result || j
  if (as === 'list') return reply(sock, m, (r.items || r).slice(0, 15).map((x, i) => `${i + 1}. ${x.title || x}`).join('\n'))
  const url = r.url || r.download || r.link
  if (!url) return reply(sock, m, '❌ Nothing found')
  const cap = r.title || ''
  const msg = as === 'audio' ? { audio: { url }, mimetype: 'audio/mpeg' }
    : as === 'doc' ? { document: { url }, fileName: cap || 'file', mimetype: 'application/octet-stream' }
    : { video: { url }, caption: cap }
  await sock.sendMessage(jidOf(m), msg, { quoted: m })
}

// ───────── fun data ─────────
const EIGHT = ['Yes', 'No', 'Maybe', 'Definitely', 'Ask again later', 'Very doubtful', 'Without a doubt', 'Not likely']
const TRUTHS = ['What is your biggest fear?', 'Who was your first crush?', 'What is the last lie you told?', 'What is your most embarrassing moment?', 'What secret have you never told anyone?']
const DARES = ['Send a voice note singing a song', 'Change your status to "I love pineapple pizza" for 1 hour', 'Text your crush "hi"', 'Do 10 pushups and send proof', 'Speak in rhymes for the next 5 messages']
const WORDS = ['planet', 'garden', 'rocket', 'guitar', 'puzzle', 'jungle', 'castle', 'window', 'silver', 'dragon', 'wizard', 'pirate']
const W5 = ['crane', 'slate', 'house', 'media', 'stone', 'plant', 'light', 'water', 'happy', 'bread', 'smile', 'chair', 'night', 'brave', 'cloud']

// per-chat game state
const G = { hang: new Map(), num: new Map(), ttt: new Map(), snake: new Map(), mem: new Map(), trivia: new Map(), wordle: new Map() }

const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
const tttWin = (b, p) => TTT_LINES.some(l => l.every(i => b[i] === p))
const tttShow = b => [0, 3, 6].map(r => b.slice(r, r + 3).map((c, i) => c || ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][r + i]).join('')).join('\n')
const tttBot = b => {
  const free = b.map((c, i) => c ? -1 : i).filter(i => i >= 0)
  for (const p of ['⭕', '❌']) for (const i of free) { const t = [...b]; t[i] = p; if (tttWin(t, p)) return i }
  return b[4] ? rnd(free) : 4
}

const SN = 8
const snakeShow = s => {
  let out = ''
  for (let y = 0; y < SN; y++) {
    for (let x = 0; x < SN; x++) out += s.snake.some(([a, b]) => a === x && b === y) ? (s.snake[0][0] === x && s.snake[0][1] === y ? '🟢' : '🟩') : (s.food[0] === x && s.food[1] === y ? '🍎' : '⬛')
    out += '\n'
  }
  return out + `Score: ${s.score}\nMove: .snake w/a/s/d`
}

// ───────── command categories (drives the menu) ─────────
const CATS = {
  'AI': ['analyze', 'blackbox', 'cat', 'chatbot', 'chatgpt', 'claudeai', 'deepseek', 'gemini', 'gpt', 'grok', 'kimi', 'llama', 'metai', 'mistral', 'perplexity', 'qwen', 'story', 'summarize', 'translate2'],
  'ANIME': ['anime', 'cuddle', 'hug', 'kiss', 'neko', 'pat', 'slap', 'waifu', 'wink'],
  'AUDIO': ['bassboost', 'deep', 'echo', 'fast', 'nightcore', 'reverse', 'robot', 'slow', 'toaudio', 'tomp3', 'toptt'],
  'DOWNLOAD': ['apk', 'facebook', 'instagram', 'mediafire', 'song', 'spotify', 'tiktok', 'twitter', 'ytmp3', 'ytmp4', 'ytv', 'playlist'],
  'FUN': ['8ball', 'coinflip', 'dare', 'dice', 'fact', 'joke', 'quote', 'truth', 'trivia', 'wordle'],
  'GAMES': ['chess', 'hangman', 'memory', 'slots', 'snake', 'ttt', 'numberguess'],
  'GROUP': ['add', 'demote', 'hidetag', 'kick', 'leave', 'link', 'mute', 'promote', 'revoke', 'setdesc', 'setname', 'tagall', 'unmute', 'warn', 'welcome'],
  'IMAGE': ['carbon', 'jail', 'remini', 'rainbow', 'trigger', 'wanted', 'wasted', 'wallpaper'],
  'LOGO': ['neonlogo', 'firelogo', 'goldlogo', 'silverlogo', 'rainbowlogo', 'dragonlogo', 'phoenixlogo', 'moonlogo', 'lightninglogo', 'crystallogo'],
  'TOOLS': ['calc', 'define', 'google', 'iplookup', 'ping', 'qr', 'shorturl', 'speed', 'translate', 'uptime', 'url', 'weather', 'wiki'],
  'OWNER': ['about', 'broadcast', 'owner', 'pair', 'repo', 'restart', 'sessionid', 'setbotname', 'setmode', 'setprefix', 'settimezone', 'shutdown'],
  'INFO': ['alive', 'botstatus', 'platform', 'prefixinfo', 'sessioninfo', 'whoami'],
  'SETTINGS': ['autobio', 'autoread', 'autoreact', 'autotype', 'autoviewstatus', 'setemoji', 'anticall', 'antidelete', 'antilink', 'antispam', 'antisticker'],
  'MEDIA': ['logo', 'status', 'groupst', 'tosticker', 'toimage', 'tovideo', 'tovoice', 'tts', 'vv'],
  'MUSIC': ['lyrics', 'shazam', 'spotify', 'musicmenu'],
  'SPORTS': ['sportsnews', 'matches', 'standings', 'scorers']
}
const bar = p => { const n = Math.round(p / 10); return '█'.repeat(n) + '░'.repeat(10 - n) }
const catBlock = (name, list) => `┏▣ ◈ *${name} MENU* ◈\n${list.map(c => `┃➽ ${c}`).join('\n')}\n┗▣`

// ───────── toggles ─────────
const toggle = (key, label) => async (sock, m, args) => {
  const v = (args[0] || '').toLowerCase()
  if (!['on', 'off'].includes(v)) return reply(sock, m, `Usage: .${key} on|off  (now: ${settings[key] ? 'on' : 'off'})`)
  settings[key] = v === 'on'; save()
  if (key === 'autobio') startBio(sock)
  await reply(sock, m, `✅ ${label} ${v}`)
}
const groupToggle = (key, label) => groupCmd(async (sock, m, args) => {
  const v = (args[0] || '').toLowerCase()
  if (!['on', 'off'].includes(v)) return reply(sock, m, `Usage: .${key} on|off`)
  settings[key][jidOf(m)] = v === 'on'; save()
  await reply(sock, m, `✅ ${label} ${v} for this group`)
})
let bioTimer
const startBio = sock => {
  clearInterval(bioTimer)
  if (!settings.autobio) return
  const tick = () => sock.updateProfileStatus(`${botName()} | online ${fmtUp((Date.now() - START) / 1000)}`).catch(() => {})
  tick(); bioTimer = setInterval(tick, 60000)
}

// ───────── the commands ─────────
const commands = {
  // core (existing)
  ping: async (sock, m) => reply(sock, m, 'Pong! 🏓'),
  time: async (sock, m) => reply(sock, m, `🕒 ${new Date().toLocaleString('en-GB', { timeZone: settings.tz })}`),
  echo: async (sock, m, args) => {
    const md = await getMedia(sock, m).catch(() => null)
    if (md && /audio/.test(md.type)) return fx('aecho=0.8:0.9:1000:0.3')(sock, m)
    await reply(sock, m, args.join(' ') || 'Usage: .echo <text> (or reply to audio for echo effect)')
  },
  owner: async (sock, m) => reply(sock, m, [`┌─ ${botName()} OWNER ─`, `│ • Developer : ${DEV_NAME}`, `│ • Number    : +${DEV_NUMBER}`, `│ • Chat      : wa.me/${DEV_NUMBER}`, '└─'].join('\n')),

  // menu
  menu: async (sock, m) => {
    const total = Object.values(commandsRef).length
    const mem = process.memoryUsage().rss, tm = os.totalmem(), pct = Math.round(((tm - os.freemem()) / tm) * 100)
    const speed = Math.max(0, Date.now() - Number(m.messageTimestamp || 0) * 1000)
    const host = process.env.RENDER ? 'Render' : process.env.DYNO ? 'Heroku' : os.platform()
    const head = [
      `┏▣ ◈ *${botName()}* ◈`,
      `┃ *ᴏᴡɴᴇʀ* : ${DEV_NAME}`, `┃ *ᴘʀᴇғɪx* : [ ${settings.prefix} ]`, `┃ *ʜᴏsᴛ* : ${host}`,
      `┃ *ᴘʟᴜɢɪɴs* : ${total}`, `┃ *ᴍᴏᴅᴇ* : ${settings.mode}`, `┃ *ᴠᴇʀsɪᴏɴ* : ${VERSION}`,
      `┃ *sᴘᴇᴇᴅ* : ${speed} ms`, `┃ *ᴜsᴀɢᴇ* : ${Math.round(mem / 1048576)} MB of ${Math.round(tm / 1073741824)} GB`,
      `┃ *ʀᴀᴍ* : [${bar(pct)}] ${pct}%`, `┃ *ᴜᴘᴛɪᴍᴇ* : ${fmtUp((Date.now() - START) / 1000)}`, '┗▣'
    ].join('\n')
    const body = Object.entries(CATS).map(([n, l]) => catBlock(n, l)).join('\n\n')
    await reply(sock, m, `${head}\n\n${body}\n\n◈ ♔ OWNER : ${DEV_NAME}\n◈ ◇ POWERED BY ${botName()} ◇`)
  },

  // ── AI ──
  analyze: mkAI('openai', 'Analyze the given text or topic: key points, tone, strengths, weaknesses. Be concise.'),
  blackbox: mkAI('openai', 'You are a coding assistant. Give working code with short explanations.'),
  cat: mkAI('openai', 'You are a playful cat. Answer helpfully but sprinkle in meows and cat puns.'),
  chatbot: mkAI('openai', 'You are a friendly chatbot. Chat casually and briefly.'),
  chatgpt: mkAI('openai'), gpt: mkAI('openai'),
  claudeai: mkAI('openai'), gemini: mkAI('openai'), grok: mkAI('openai', 'You are witty and direct. Answer concisely with a little humor.'),
  kimi: mkAI('openai'), metai: mkAI('llama'), perplexity: mkAI('openai', 'Answer like a research assistant: direct answer first, then key facts.'),
  deepseek: mkAI('deepseek'), llama: mkAI('llama'), mistral: mkAI('mistral'), qwen: mkAI('qwen-coder'),
  story: mkAI('openai', 'Write a short, engaging story (under 250 words) about the given idea.'),
  summarize: mkAI('openai', 'Summarize the given text in a few short bullet points.'),
  translate2: async (sock, m, args) => {
    const [lang, ...rest] = args
    const q = rest.join(' ') || textOf(quotedOf(m))
    if (!lang || !q) return reply(sock, m, 'Usage: .translate2 <language> <text>')
    await reply(sock, m, await ai(q, `Translate the user's text to ${lang}. Reply with the translation only.`))
  },

  // ── anime ──
  anime: anime('waifu'), cuddle: anime('cuddle'), hug: anime('hug'), kiss: anime('kiss'), neko: anime('neko'),
  pat: anime('pat'), slap: anime('slap'), waifu: anime('waifu'), wink: anime('wink'),

  // ── audio ──
  bassboost: fx('bass=g=20,dynaudnorm'), deep: fx('asetrate=44100*0.75,aresample=44100'),
  fast: fx('atempo=1.5'), slow: fx('atempo=0.7'), nightcore: fx('asetrate=44100*1.25,aresample=44100'),
  reverse: fx('areverse'), robot: fx("afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75"),
  toaudio: toMp3, tomp3: toMp3, toptt: ptt,

  // ── downloads ──
  apk: dl('apk', 'doc'), facebook: dl('facebook'), instagram: dl('instagram'), mediafire: dl('mediafire', 'doc'),
  song: dl('song', 'audio'), spotify: dl('spotify', 'audio'), tiktok: dl('tiktok'), twitter: dl('twitter'),
  ytmp3: dl('ytmp3', 'audio'), ytmp4: dl('ytmp4'), ytv: dl('ytv'), playlist: dl('playlist', 'list'),

  // ── fun ──
  '8ball': async (sock, m, args) => reply(sock, m, args.length ? `🎱 ${rnd(EIGHT)}` : 'Usage: .8ball <question>'),
  coinflip: async (sock, m) => reply(sock, m, rnd(['🪙 Heads', '🪙 Tails'])),
  flip: async (sock, m) => reply(sock, m, rnd(['🪙 Heads', '🪙 Tails'])),
  dare: async (sock, m) => reply(sock, m, `😈 Dare: ${rnd(DARES)}`),
  truth: async (sock, m) => reply(sock, m, `🤔 Truth: ${rnd(TRUTHS)}`),
  dice: async (sock, m) => reply(sock, m, `🎲 You rolled a ${Math.floor(Math.random() * 6) + 1}`),
  fact: async (sock, m) => reply(sock, m, `💡 ${(await getJSON('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en')).text}`),
  joke: async (sock, m) => { const j = await getJSON('https://official-joke-api.appspot.com/random_joke'); await reply(sock, m, `😂 ${j.setup}\n\n${j.punchline}`) },
  quote: async (sock, m) => { const [q] = await getJSON('https://zenquotes.io/api/random'); await reply(sock, m, `💬 "${q.q}"\n— ${q.a}`) },
  trivia: async (sock, m, args) => {
    const jid = jidOf(m), cur = G.trivia.get(jid), a = (args[0] || '').toLowerCase()
    if (cur && 'abcd'.includes(a) && a) {
      G.trivia.delete(jid)
      return reply(sock, m, cur.ans === a ? '✅ Correct!' : `❌ Wrong. Answer: ${cur.ans.toUpperCase()}) ${cur.text}`)
    }
    const { results: [q] } = await getJSON('https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986')
    const d = s => decodeURIComponent(s)
    const opts = shuffle([q.correct_answer, ...q.incorrect_answers].map(d))
    G.trivia.set(jid, { ans: 'abcd'[opts.indexOf(d(q.correct_answer))], text: d(q.correct_answer) })
    await reply(sock, m, `🧠 ${d(q.question)}\n\n${opts.map((o, i) => `${'ABCD'[i]}) ${o}`).join('\n')}\n\nAnswer with .trivia a/b/c/d`)
  },
  wordle: async (sock, m, args) => {
    const jid = jidOf(m), g = args[0]?.toLowerCase()
    let s = G.wordle.get(jid)
    if (!s || !g) { s = { word: rnd(W5), tries: [] }; G.wordle.set(jid, s); if (!g) return reply(sock, m, '🟩 Wordle started! Guess a 5-letter word: .wordle crane') }
    if (g.length !== 5) return reply(sock, m, '❌ Use a 5-letter word')
    const res = [...g].map((c, i) => c === s.word[i] ? '🟩' : s.word.includes(c) ? '🟨' : '⬛').join('')
    s.tries.push(`${res} ${g.toUpperCase()}`)
    if (g === s.word) { G.wordle.delete(jid); return reply(sock, m, `${s.tries.join('\n')}\n\n🎉 Solved in ${s.tries.length}!`) }
    if (s.tries.length >= 6) { G.wordle.delete(jid); return reply(sock, m, `${s.tries.join('\n')}\n\n😢 It was ${s.word.toUpperCase()}`) }
    await reply(sock, m, `${s.tries.join('\n')}\n\n${6 - s.tries.length} tries left`
