import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { handleCommand } from './commands.js'

const PHONE = (process.env.PHONE_NUMBER || '').replace(/\D/g, '')
const PREFIX = process.env.PREFIX || '.'
const AUTH_DIR = 'auth'
const SESSION_PREFIX = 'HACKER~'

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

let sessionSent = false

async function sendSessionToOwner(sock) {
  if (sessionSent) return
  sessionSent = true
  const sid = encodeSession()
  console.log('\n===== SESSION ID (keep private) =====\n' + sid + '\n=====================================\n')
  try {
    const me = sock.user.id.split(':')[0] + '@s.whatsapp.net'
    await sock.sendMessage(me, {
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

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  })

  sock.ev.on('creds.update', saveCreds)

  // First run without a session: ask WhatsApp for a pairing code
  if (!sock.authState.creds.registered) {
    if (!PHONE) {
      console.log('Set PHONE_NUMBER in .env (country code, no + or spaces) and restart.')
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 3000))
    const code = await sock.requestPairingCode(PHONE)
    console.log(`Pairing code: ${code}`)
    console.log('On the phone: WhatsApp > Linked devices > Link a device > Link with phone number instead')
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('✅ Bot connected')
      sendSessionToOwner(sock)
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Remove SESSION_ID / delete the auth folder and restart to pair again.')
      } else {
        console.log('Connection closed, reconnecting...')
        start()
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) {
      if (!m.message) continue
      const text = m.message.conversation || m.message.extendedTextMessage?.text || ''
      if (!text.startsWith(PREFIX)) continue

      const [name, ...args] = text.slice(PREFIX.length).trim().split(/\s+/)
      await handleCommand(sock, m, name.toLowerCase(), args)
    }
  })
}

start()
