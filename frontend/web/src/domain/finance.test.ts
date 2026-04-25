import { describe, expect, it } from 'vitest'

import {
  financeReportPeriodFromMonthInputValue,
  financeReportPeriodToMonthInputValue,
} from './finance'

describe('finance report period helpers', () => {
  it('converts stored report period into native month input value', () => {
    expect(financeReportPeriodToMonthInputValue('02.2026')).toBe('2026-02')
    expect(financeReportPeriodToMonthInputValue('2026-02')).toBe('2026-02')
    expect(financeReportPeriodToMonthInputValue('13.2026')).toBe('')
    expect(financeReportPeriodToMonthInputValue('invalid')).toBe('')
  })

  it('converts native month input value into stored report period', () => {
    expect(financeReportPeriodFromMonthInputValue('2026-02')).toBe('02.2026')
    expect(financeReportPeriodFromMonthInputValue('02.2026')).toBe('02.2026')
    expect(financeReportPeriodFromMonthInputValue('2026-13')).toBe('')
    expect(financeReportPeriodFromMonthInputValue('')).toBe('')
  })
})
