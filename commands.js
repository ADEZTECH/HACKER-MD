const BOT_NAME = process.env.BOT_NAME || 'HACKER MD'

const commands = {
  ping: async (sock, m) => {
    await sock.sendMessage(m.key.remoteJid, { text: 'Pong! 🏓' }, { quoted: m })
  },

  time: async (sock, m) => {
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })
    await sock.sendMessage(m.key.remoteJid, { text: `🕒 ${now}` }, { quoted: m })
  },

  echo: async (sock, m, args) => {
    const text = args.join(' ') || 'Usage: .echo <text>'
    await sock.sendMessage(m.key.remoteJid, { text }, { quoted: m })
  },

  menu: async (sock, m) => {
    const text = [
      `┌─ ${BOT_NAME} ─`,
      '│ • .ping   check the bot',
      '│ • .time   current time',
      '│ • .echo   repeat your text',
      '└─'
    ].join('\n')
    await sock.sendMessage(m.key.remoteJid, { text }, { quoted: m })
  }
}

export async function handleCommand(sock, m, name, args) {
  const run = commands[name]
  if (!run) return
  try {
    await run(sock, m, args)
  } catch (e) {
    console.log(`Command "${name}" failed:`, e.message)
  }
}
