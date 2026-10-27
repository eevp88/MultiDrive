import { describe, expect, it } from 'vitest'
import { en } from './en'
import { es } from './es'

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('message dictionaries', () => {
  it('have exactly the same keys in English and Spanish', () => {
    const enKeys = Object.keys(en).sort()
    const esKeys = Object.keys(es).sort()
    expect(esKeys.filter((key) => !(key in en))).toEqual([])
    expect(enKeys.filter((key) => !(key in es))).toEqual([])
  })

  it('have no empty message', () => {
    expect(Object.entries(en).filter(([, value]) => !value.trim())).toEqual([])
    expect(Object.entries(es).filter(([, value]) => !value.trim())).toEqual([])
  })

  it('use the same {placeholders} in both languages, so a variable is never dropped by a translation', () => {
    const mismatched = Object.keys(en).filter((key) => JSON.stringify(placeholders(en[key as keyof typeof en])) !== JSON.stringify(placeholders(es[key as keyof typeof en])))
    expect(mismatched).toEqual([])
  })

  it('translate the error codes the upload and move flows show', () => {
    for (const code of ['UPLOAD_MALFORMED', 'FOLDER_NOT_ON_ACCOUNT', 'FILES_MOVE_FAILED', 'FILES_DELETE_FAILED', 'FOLDER_DELETE_FAILED']) {
      expect(en).toHaveProperty(`error.${code}`)
      expect(es).toHaveProperty(`error.${code}`)
    }
  })
})
