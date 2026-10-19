import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import express from 'express'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { handleCommand, settings, commands } from './commands.js'

// libsignal prints whole session objects (including private ratchet keys) via console.info/warn.
// Drop those lines so they never reach the Render logs.
const SIGNAL_NOISE = /^(Closing session|Opening session|Removing old closed session|Migrating session|Session already (closed|open)|Closing open session)/
for (const level of ['info', 'warn', 'log']) {
  const orig = console[level].bind(console)
  console[level] = (...a) => {
    if (typeof a[0] === 'string' && SIGNAL_NOISE.test(a[0])) return
    orig(...a)
  }
}

const PHONE = (process.env.PHONE_NUMBER || '').replace(/\D/g, '')
const PORT = process.env.PORT || 3000
const PAIR_KEY = process.env.PAIR_KEY || ''
const AUTH_DIR = 'auth'
const SESSION_PREFIX = 'HACKER~'

// small in-memory cache of recent messages, used by getMessage
const sentCache = new Map()
const rememberMsg = (m) => {
  if (!m?.key?.id || !m.message) return
  sentCache.set(m.key.id, m)
  if (sentCache.size > 500) sentCache.delete(sentCache.keys().next().value)
}

let sock = null
let linked = false
let sessionSent = false
let welcomeSent = false

// Packs every file in the auth folder into one text string
function encodeSession() {
  const files = {}
  for (const f of fs.readdirSync(AUTH_DIR)) {
    files[f] = fs.readFileSync(path.join(AUTH_DIR, f), 'utf8')
  }
  return SESSION_PREFIX + Buffer.from(JSON.stringify(files)).toString('base64')
}

// If SESSION_ID is set and there is no auth folder yet, rebuild the folder from it
function restoreSessionFromEnv() {
  const sid = (process.env.SESSION_ID || '').trim()
  if (!sid || fs.existsSync(AUTH_DIR)) return
  const raw = sid.startsWith(SESSION_PREFIX) ? sid.slice(SESSION_PREFIX.length) : sid
  const files = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(AUTH_DIR, name), content)
  }
  console.log('✅ Session restored from SESSION_ID')
}

// Logs the session ID and sends it to the bot's own WhatsApp chat (once per start)
async function sendSessionToOwner(s) {
  if (sessionSent) return
  sessionSent = true
  const sid = encodeSession()
  console.log('\n===== SESSION ID (keep private) =====\n' + sid + '\n=====================================\n')
  try {
    const me = s.user.id.split(':')[0] + '@s.whatsapp.net'
    await s.sendMessage(me, {
      document: Buffer.from(sid),
      fileName: 'session.txt',
      mimetype: 'text/plain',
      caption: 'Your HACKER MD session ID. Keep it private. Set it as SESSION_ID on your host.'
    })
  } catch (e) {
    console.log('Could not send session file:', e.message)
  }
}

// Welcome alert sent to the bot's own chat when it connects (once per start, not on every reconnect)
async function sendWelcome(s) {
  if (welcomeSent) return
  welcomeSent = true
  try {
    const me = s.user.id.split(':')[0] + '@s.whatsapp.net'
    const name = settings.botName || process.env.BOT_NAME || 'HACKER MD'
    const now = new Date().toLocaleString('en-GB', { timeZone: settings.tz })
    const text = [
      '┏▣ ◈ *BOT CONNECTED* ◈',
      `┃ 🤖 *${name}* is now online`,
      `┃ 🔑 Prefix : [ ${settings.prefix} ]`,
      `┃ 🌍 Mode : ${settings.mode}`,
      `┃ 📦 Commands : ${Object.keys(commands).length}`,
      `┃ 🕒 Time : ${now}`,
      `┃ 🖥️ Host : ${process.env.RENDER ? 'Render' : process.platform}`,
      '┗▣',
      '',
      `Type ${settings.prefix}menu to see all commands.`
    ].join('\n')
    await s.sendMessage(me, { text })
  } catch (e) {
    console.log('Could not send welcome message:', e.message)
  }
}

async function start() {
  restoreSessionFromEnv()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const s = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // Lets WhatsApp re-request a message the phone could not decrypt ("Waiting for this message")
    getMessage: async (key) => sentCache.get(key.id)?.message || undefined
  })
  sock = s

  // Remember every message we send or receive so retries can be answered
  const rawSend = s.sendMessage.bind(s)
  s.sendMessage = async (...a) => {
    const sent = await rawSend(...a)
    if (sent?.key?.id) rememberMsg(sent)
    return sent
  }
  s.ev.on('messages.upsert', ({ messages }) => messages.forEach(rememberMsg))
  linked = !!s.authState.creds.registered

  s.ev.on('creds.update', saveCreds)

  // If PHONE_NUMBER is set and this login is new, request the code automatically
  if (!s.authState.creds.registered && PHONE) {
    await new Promise((r) => setTimeout(r, 3000))
    const code = await s.requestPairingCode(PHONE)
    console.log(`Pairing code: ${code}`)
  } else if (!s.authState.creds.registered) {
    console.log(`Not linked yet. Open the pairing page on port ${PORT} to get a code.`)
  }

  s.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      linked = true
      console.log('✅ Bot connected')
      sendSessionToOwner(s)
      sendWelcome(s)
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        linked = false
        console.log('Logged out. Remove SESSION_ID and restart to pair again.')
      } else {
        console.log('Connection closed, reconnecting...')
        start()
      }
    }
  })

  s.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) {
      if (!m.message) continue
      const text = m.message.conversation || m.message.extendedTextMessage?.text || ''
      if (!text.startsWith(settings.prefix)) continue

      const [name, ...args] = text.slice(settings.prefix.length).trim().split(/\s+/)
      await handleCommand(s, m, name.toLowerCase(), args)
    }
  })
}

// ---------- Web: pairing page and API ----------
const app = express()
app.use(express.json())
app.use(express.static('public'))

app.get('/health', (req, res) => res.json({ status: 'ok', linked }))

app.post('/api/pair', async (req, res) => {
  try {
    if (PAIR_KEY && req.body?.key !== PAIR_KEY) {
      return res.status(403).json({ error: 'Wrong access key.' })
    }
    if (linked) {
      return res.status(409).json({ error: 'The bot is already linked.' })
    }
    if (!sock) {
      return res.status(503).json({ error: 'Bot is starting. Try again in a few seconds.' })
    }
    const number = String(req.body?.number || '').replace(/\D/g, '')
    if (number.length < 8) {
      return res.status(400).json({ error: 'Enter the number with country code, no + or spaces.' })
    }
    const code = await sock.requestPairingCode(number)
    res.json({ code: String(code).replace(/(.{4})(.{4})/, '$1-$2') })
  } catch (e) {
    res.status(500).json({ error: 'Could not get a code: ' + e.message })
  }
})

app.listen(PORT, () => {
  console.log(`🌐 Web server on port ${PORT}`)
})

start()
        
