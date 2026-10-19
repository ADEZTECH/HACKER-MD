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
import { handleCommand } from './commands.js'

const PHONE = (process.env.PHONE_NUMBER || '').replace(/\D/g, '')
const PREFIX = process.env.PREFIX || '.'
const PORT = process.env.PORT || 3000
const PAIR_KEY = process.env.PAIR_KEY || ''
const AUTH_DIR = 'auth'
const SESSION_PREFIX = 'HACKER~'

let sock = null
let linked = false
let sessionSent = false

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

async function start() {
  restoreSessionFromEnv()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const s = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  })
  sock = s
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
      if (!text.startsWith(PREFIX)) continue

      const [name, ...args] = text.slice(PREFIX.length).trim().split(/\s+/)
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
