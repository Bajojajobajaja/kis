export type SubsystemSlug = 'crm-sales' | 'service' | 'inventory' | 'finance' | 'platform'

export type ViewMode = 'table' | 'kanban' | 'timeline' | 'documents'

export type SortDirection = 'asc' | 'desc'

export type ActionKey =
  | 'create'
  | 'edit'
  | 'archive'
  | 'close'
  | 'assign'
  | 'post'
  | 'cancel'
  | 'writeoff'
  | 'reopen'

export type Role = 'admin' | 'manager' | 'accountant' | 'viewer'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export type EntityColumn = {
  key: string
  label: string
}

export type EntityFieldOption = {
  value: string
  label: string
}

export type EntityFieldOptionsSource = {
  type: 'store'
  storeKey: string
  valueKey: string
  labelKey?: string
  sort?: 'asc' | 'none'
}

export type EntityFieldInputType = 'text' | 'select'

export type EntityCreateField = {
  key: string
  label: string
  placeholder: string
  required?: boolean
  inputType?: EntityFieldInputType
  allowCustom?: boolean
  emptyOptionLabel?: string
  options?: EntityFieldOption[]
  optionsSource?: EntityFieldOptionsSource
}

export type EntityStatusDefinition = {
  key: string
  label: string
  tone: StatusTone
  closed?: boolean
}

export type EntityActionDefinition = {
  key: ActionKey
  label: string
  critical?: boolean
}

export type EntityHistoryRecord = {
  id: string
  at: string
  text: string
}

export type EntityRelatedRecord = {
  id: string
  label: string
  value: string
}

export type EntityRecord = {
  id: string
  title: string
  subtitle: string
  status: string
  values: Record<string, string>
  history: EntityHistoryRecord[]
  related: EntityRelatedRecord[]
}

export type EntityTabDefinition = {
  slug: string
  title: string
  entityName: string
  entityNamePlural: string
  idPrefix: string
  view: ViewMode
  columns: EntityColumn[]
  statuses: EntityStatusDefinition[]
  actions: EntityActionDefinition[]
  createFields: EntityCreateField[]
  actionStatusMap?: Partial<Record<ActionKey, string>>
}

export type SubsystemDefinition = {
  slug: SubsystemSlug
  title: string
  summary: string
  tabs: EntityTabDefinition[]
}

export type EntityStoreKey = `${SubsystemSlug}/${string}`

export function buildStoreKey(subsystemSlug: SubsystemSlug, tabSlug: string): EntityStoreKey {
  return `${subsystemSlug}/${tabSlug}`
}
