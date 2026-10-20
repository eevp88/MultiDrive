import { prisma } from '../config/prisma.js'
import { encryptText } from '../utils/crypto.js'
import { microsoftScopes } from '../modules/microsoft/microsoft.service.js'

const placeholders = ['your-microsoft-client-id', 'your-microsoft-client-secret', 'your-client-id', 'your-client-secret']

function configured(value: string | undefined) {
  return Boolean(value?.trim()) && !placeholders.includes(value!.trim())
}

async function main() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim()
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim()
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI?.trim() || 'http://localhost:4000/connected-accounts/onedrive/callback'

  if (!configured(clientId) || !configured(clientSecret)) {
    console.warn('Skipping OneDrive config seed: MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET not configured.')
    return
  }

  await prisma.providerConfig.updateMany({ where: { userId: null, provider: 'onedrive', status: 'active' }, data: { status: 'disabled' } })
  const config = await prisma.providerConfig.create({
    data: { userId: null, provider: 'onedrive', clientIdEncrypted: encryptText(clientId!), clientSecretEncrypted: encryptText(clientSecret!), redirectUri, scopes: microsoftScopes, status: 'active' },
  })
  console.log(`Seeded global OneDrive config: ${config.id}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
