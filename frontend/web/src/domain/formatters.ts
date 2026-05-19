export function formatPhoneMask(value: string): string {
  let digits = value.replace(/\D+/g, '')
  if (digits.startsWith('8')) {
    digits = '7' + digits.slice(1)
  }
  if (!digits) {
    return ''
  }
  if (digits[0] !== '7') {
    digits = '7' + digits
  }
  digits = digits.slice(0, 11)
  let out = '+7'
  if (digits.length > 1) out += ' (' + digits.slice(1, 4)
  if (digits.length > 4) out += ') ' + digits.slice(4, 7)
  if (digits.length > 7) out += '-' + digits.slice(7, 9)
  if (digits.length > 9) out += '-' + digits.slice(9, 11)
  return out
}

export function normalizePhoneStrict(value: string): { ok: boolean; formatted: string } {
  const digits = value.replace(/\D+/g, '')
  if (!digits) {
    return { ok: false, formatted: '' }
  }
  if (digits.length !== 11 || digits[0] !== '7') {
    return { ok: false, formatted: '' }
  }
  const part1 = digits.slice(1, 4)
  const part2 = digits.slice(4)
  return { ok: true, formatted: `+7 ${part1} ${part2}` }
}

export function formatMoneyString(value: string): string {
  const digits = value.replace(/\D+/g, '')
  if (!digits) {
    return ''
  }
  const reversed = digits.split('').reverse()
  const grouped: string[] = []
  for (let i = 0; i < reversed.length; i += 3) {
    grouped.push(reversed.slice(i, i + 3).reverse().join(''))
  }
  return grouped.reverse().join(' ')
}
