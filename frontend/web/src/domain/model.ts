export type SubsystemSlug = 'crm-sales' | 'service' | 'inventory' | 'finance' | 'platform'

export type ViewMode = 'table' | 'kanban' | 'timeline' | 'documents'

export type SortDirection = 'asc' | 'desc'

export type ActionKey =
  | 'create'
  | 'edit'
  | 'delete'
  | 'archive'
  | 'close'
  | 'assign'
  | 'post'
  | 'cancel'
  | 'writeoff'
  | 'reopen'

export type AppRole = 'administrator' | 'sales' | 'mechanic' | 'analyst'
export type AccessRole = AppRole
export type Role = AccessRole

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

export type EntityFieldInputType = 'text' | 'select' | 'date' | 'month'

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

export type EntityStatusActionDefinition = {
  key: ActionKey
  label: string
  nextStatus?: string
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
  storeKey?: string
  recordId?: string
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
  hideStatusUi?: boolean
  actions: EntityActionDefinition[]
  createFields: EntityCreateField[]
  statusActions?: Partial<Record<string, EntityStatusActionDefinition[]>>
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
