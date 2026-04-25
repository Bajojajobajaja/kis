import type { EntityCreateField, EntityFieldOptionsSource, EntityRecord } from './model'

export type EntityRecordGetter = (storeKey: string) => EntityRecord[]

type ResolveReferenceRecordOptions = {
  allowLegacyMatch?: boolean
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeVin(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

export function getReferenceTextFieldKey(fieldKey: string): string {
  return `${fieldKey}Text`
}

export function isReferenceTextFieldKey(key: string): boolean {
  return key.endsWith('Text')
}

export function isStoreReferenceField(
  field: Pick<EntityCreateField, 'optionsSource'> | undefined,
): field is Pick<EntityCreateField, 'optionsSource'> & {
  optionsSource: EntityFieldOptionsSource & { type: 'store' }
} {
  return field?.optionsSource?.type === 'store'
}

export function extractEntityRecordValue(record: EntityRecord, key: string): string {
  if (key === 'id') {
    return record.id
  }
  if (key === 'title') {
    return record.title
  }
  if (key === 'subtitle') {
    return record.subtitle
  }
  return record.values[key] ?? ''
}

export function buildEntityRecordPath(storeKey?: string, recordId?: string): string | null {
  if (!storeKey || !recordId) {
    return null
  }
  const [subsystemSlug, tabSlug] = storeKey.split('/')
  if (!subsystemSlug || !tabSlug) {
    return null
  }
  return `/${subsystemSlug}/${tabSlug}/${recordId}`
}

function matchesLegacyReference(
  source: EntityFieldOptionsSource,
  record: EntityRecord,
  value: string,
): boolean {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue) {
    return false
  }

  const candidateValues = [
    record.id,
    record.title,
    record.subtitle,
    extractEntityRecordValue(record, source.valueKey),
    source.labelKey ? extractEntityRecordValue(record, source.labelKey) : '',
  ]

  if (normalizeVin(value)) {
    candidateValues.push(record.values.vin ?? '')
  }

  return candidateValues.some((candidate) => normalizeText(candidate) === normalizedValue) ||
    candidateValues.some((candidate) => normalizeVin(candidate) === normalizeVin(value))
}

export function matchStoreReferenceRecords(
  source: EntityFieldOptionsSource,
  value: string,
  getRecords: EntityRecordGetter,
): EntityRecord[] {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return []
  }

  const records = getRecords(source.storeKey)
  const directMatch = records.find((record) => record.id === trimmedValue)
  if (directMatch) {
    return [directMatch]
  }

  return records.filter((record) => matchesLegacyReference(source, record, trimmedValue))
}

export function resolveStoreReferenceRecord(
  source: EntityFieldOptionsSource,
  value: string,
  getRecords: EntityRecordGetter,
  options: ResolveReferenceRecordOptions = {},
): EntityRecord | undefined {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return undefined
  }

  const records = getRecords(source.storeKey)
  const directMatch = records.find((record) => record.id === trimmedValue)
  if (directMatch) {
    return directMatch
  }

  if (!options.allowLegacyMatch) {
    return undefined
  }

  const legacyMatches = matchStoreReferenceRecords(source, trimmedValue, getRecords)
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined
}

export function resolveStoreReferenceLabel(
  source: EntityFieldOptionsSource,
  value: string,
  getRecords: EntityRecordGetter,
  fallbackText?: string,
): string {
  const record = resolveStoreReferenceRecord(source, value, getRecords, { allowLegacyMatch: true })
  if (record) {
    const labelKey = source.labelKey ?? 'title'
    return extractEntityRecordValue(record, labelKey) || record.title || record.id
  }

  const text = (fallbackText ?? '').trim()
  if (text) {
    return text
  }

  return value.trim()
}

export function resolveStoreReferencePath(
  source: EntityFieldOptionsSource,
  value: string,
  getRecords: EntityRecordGetter,
): string | null {
  const record = resolveStoreReferenceRecord(source, value, getRecords, { allowLegacyMatch: true })
  if (!record) {
    return null
  }

  return buildEntityRecordPath(source.storeKey, record.id)
}

export function setStoreReferenceRecordId(
  values: Record<string, string>,
  fieldKey: string,
  recordId: string,
): Record<string, string> {
  const textKey = getReferenceTextFieldKey(fieldKey)
  return {
    ...values,
    [fieldKey]: recordId,
    [textKey]: '',
  }
}

export function setStoreReferenceCustomText(
  values: Record<string, string>,
  fieldKey: string,
  text: string,
): Record<string, string> {
  const textKey = getReferenceTextFieldKey(fieldKey)
  return {
    ...values,
    [fieldKey]: '',
    [textKey]: text,
  }
}

export function getStoreReferenceCustomText(
  values: Record<string, string>,
  fieldKey: string,
): string {
  return values[getReferenceTextFieldKey(fieldKey)] ?? ''
}
