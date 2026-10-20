import { describe, expect, it } from 'vitest'
import { addRecentRecipient } from './sendValidation'

describe('addRecentRecipient', () => {
  it('puts the newest first, de-dupes case-insensitively and caps at 5', () => {
    let l: string[] = []
    for (let i = 1; i <= 6; i++) l = addRecentRecipient(l, `0x${String(i).repeat(40)}`)
    expect(l).toHaveLength(5)
    expect(l[0]).toBe(`0x${'6'.repeat(40)}`)
    l = addRecentRecipient(l, `0x${'3'.repeat(40)}`.toUpperCase().replace('0X', '0x'))
    expect(l.filter((a) => a.toLowerCase() === `0x${'3'.repeat(40)}`)).toHaveLength(1)
    expect(l[0]!.toLowerCase()).toBe(`0x${'3'.repeat(40)}`)
  })
})
