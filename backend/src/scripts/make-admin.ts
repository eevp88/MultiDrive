import { prisma } from '../config/prisma.js'
import { ADMIN_ROLE } from '../middleware/admin.middleware.js'

// Usage: npm run make-admin -- user@example.com [--revoke]
async function main() {
  const args = process.argv.slice(2)
  const revoke = args.includes('--revoke')
  const email = args.find((arg) => !arg.startsWith('--'))?.trim().toLowerCase()
  if (!email) throw new Error('Usage: npm run make-admin -- <email> [--revoke]')

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } })
  if (!user) throw new Error(`No user registered with email ${email}.`)

  const role = revoke ? 'user' : ADMIN_ROLE
  if (user.role === role) {
    console.log(`${user.email} already has role "${role}". Nothing to change.`)
    return
  }
  await prisma.user.update({ where: { id: user.id }, data: { role } })
  console.log(`${user.email}: role changed from "${user.role}" to "${role}".`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
