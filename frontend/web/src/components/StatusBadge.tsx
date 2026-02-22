import type { StatusTone } from '../domain/model'

type StatusBadgeProps = {
  label: string
  tone: StatusTone
}

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>
}
