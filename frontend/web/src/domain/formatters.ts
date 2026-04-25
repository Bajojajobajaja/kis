export function normalizePhoneStrict(value: string): { ok: boolean; formatted: string } {
  const digits = value.replace(/\D+/g, '')
  if (!digits) {
    return { ok: false, formatted: '' }
  }
  if (digits.length !== 11 || digits[0] !== '7' || digits[1] !== '9') {
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
