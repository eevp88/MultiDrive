import { prisma } from '../config/prisma.js'
import { sealShareToken } from '../utils/share-token.js'

// Encrypts share tokens that were stored in plain text before they were sealed. Safe to run any number of times:
// sealed values contain a colon and are skipped, and each update only applies if the row still holds the value read.
// Usage: npm run encrypt-share-tokens
const BATCH_SIZE = 500

async function main() {
  let sealed = 0
  for (;;) {
    const rows = await prisma.fileShare.findMany({
      where: { AND: [{ token: { not: null } }, { token: { not: '' } }, { NOT: { token: { contains: ':' } } }] },
      select: { id: true, token: true },
      take: BATCH_SIZE,
    })
    if (rows.length === 0) break
    let sealedInBatch = 0
    for (const row of rows) {
      if (!row.token) continue
      const result = await prisma.fileShare.updateMany({ where: { id: row.id, token: row.token }, data: { token: sealShareToken(row.token) } })
      sealedInBatch += result.count
    }
    sealed += sealedInBatch
    if (sealedInBatch === 0) {
      // Another instance sealed these rows first, or they changed under us. Anything left is picked up on the next start.
      console.warn('Share tokens: a batch had nothing to update; stopping. It will be retried on the next run.')
      break
    }
  }
  console.log(`Share tokens encrypted: ${sealed}.`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
