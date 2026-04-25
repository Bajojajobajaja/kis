import { useMemo, useRef, useState, type FormEvent } from 'react'

import type { SubsystemNavItem } from '../config/navigation'
import { resourceOptions } from '../domain/fieldOptions'

type Seq = {
  route: number
  audit: number
  contract: number
  notification: number
  saga: number
  slo: number
  alert: number
  backup: number
  release: number
  event: number
}

type Route = {
  id: string
  prefix: string
  target: string
  auth: boolean
  limit: number
  status: 'active' | 'disabled'
  hits: number
  blocked: number
}

type Binding = { subjectID: string; roles: string[] }
type Audit = { id: string; actor: string; action: string; resource: string; hash: string }
type Contract = { id: string; eventType: string; version: string }
type Notification = { id: string; eventType: string; channel: 'email' | 'sms'; recipient: string }
type Saga = { id: string; name: string; steps: number }
type SLO = { id: string; name: string; target: number; status: 'healthy' | 'degraded' | 'breached' }
type Alert = { id: string; name: string; severity: 'low' | 'medium' | 'high' | 'critical'; triggers: number }
type Backup = { id: string; scope: string; status: 'ready' | 'restored' }
type Release = {
  id: string
  name: string
  env: 'dev' | 'stage' | 'prod'
  strategy: 'rolling' | 'canary' | 'blue-green'
  status: 'planned' | 'rolling_out' | 'active' | 'rolled_back'
}
type TimelineEvent = { id: string; type: string; note: string }

function parseRoles(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function hashLike(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return `h${Math.abs(hash).toString(16)}`
}

const routeStatusLabel: Record<Route['status'], string> = {
  active: 'активен',
  disabled: 'отключен',
}

const sloStatusLabel: Record<SLO['status'], string> = {
  healthy: 'норма',
  degraded: 'ухудшен',
  breached: 'нарушен',
}

const alertSeverityLabel: Record<Alert['severity'], string> = {
  low: 'низкий',
  medium: 'средний',
  high: 'высокий',
  critical: 'критичный',
}

const backupStatusLabel: Record<Backup['status'], string> = {
  ready: 'готов',
  restored: 'восстановлен',
}

const releaseEnvLabel: Record<Release['env'], string> = {
  dev: 'dev',
  stage: 'stage',
  prod: 'prod',
}

const releaseStrategyLabel: Record<Release['strategy'], string> = {
  rolling: 'rolling',
  canary: 'canary',
  'blue-green': 'blue-green',
}

const releaseStatusLabel: Record<Release['status'], string> = {
  planned: 'запланирован',
  rolling_out: 'выкатывается',
  active: 'активен',
  rolled_back: 'откачен',
}

export function PlatformServicesWorkbench({ item }: { item: SubsystemNavItem }) {
  const seq = useRef<Seq>({
    route: 1,
    audit: 1,
    contract: 1,
    notification: 1,
    saga: 1,
    slo: 1,
    alert: 1,
    backup: 1,
    release: 1,
    event: 1,
  })

  const nextID = (bucket: keyof Seq, prefix: string): string => {
    const value = seq.current[bucket]
    seq.current[bucket] += 1
    return `${prefix}-${String(value).padStart(4, '0')}`
  }

  const [notice, setNotice] = useState('')
  const [routes, setRoutes] = useState<Route[]>([])
  const [bindings, setBindings] = useState<Binding[]>([])
  const [audits, setAudits] = useState<Audit[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [sagas, setSagas] = useState<Saga[]>([])
  const [slos, setSLOs] = useState<SLO[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [backups, setBackups] = useState<Backup[]>([])
  const [releases, setReleases] = useState<Release[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])

  const [dispatches, setDispatches] = useState(0)
  const [rbacChecks, setRBACChecks] = useState(0)
  const [observabilityRuns, setObservabilityRuns] = useState(0)
  const [restoreRuns, setRestoreRuns] = useState(0)
  const [finopsRuns, setFinopsRuns] = useState(0)
  const [accessResult, setAccessResult] = useState('Проверки RBAC еще не выполнялись.')

  const [routeForm, setRouteForm] = useState({ prefix: '/api/sales', target: 'sales-deals', auth: true, limit: '2' })
  const [dispatchForm, setDispatchForm] = useState({ path: '/api/sales/deals', subject: 'agent-1', token: '' })
  const [bindingForm, setBindingForm] = useState({ subjectID: 'agent-1', roles: 'sales_agent' })
  const [rbacForm, setRBACForm] = useState({ subjectID: 'agent-1', role: 'sales_agent' })
  const [auditForm, setAuditForm] = useState({
    actor: 'manager-1',
    action: 'update_status',
    resource: resourceOptions[0]?.value ?? 'finance/invoices',
  })
  const [contractForm, setContractForm] = useState({ eventType: 'SalePaid', version: 'v1' })
  const [notificationForm, setNotificationForm] = useState({ eventType: 'SalePaid', channel: 'email' as Notification['channel'], recipient: 'client@example.com' })
  const [sagaForm, setSagaForm] = useState({ name: 'sale-fulfillment', steps: '2' })
  const [sloForm, setSLOForm] = useState({ name: 'Доступность gateway', target: '99.9' })
  const [alertForm, setAlertForm] = useState({ name: 'Ошибки gateway', severity: 'high' as Alert['severity'] })
  const [backupForm, setBackupForm] = useState({ scope: 'platform' })
  const [releaseForm, setReleaseForm] = useState({ name: 'platform-wave', env: 'prod' as Release['env'], strategy: 'canary' as Release['strategy'] })

  const pushEvent = (type: string, note: string) => {
    const entity: TimelineEvent = { id: nextID('event', 'evt'), type, note }
    setEvents((prev) => [entity, ...prev].slice(0, 50))
  }

  const onCreateRoute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prefix = routeForm.prefix.trim()
    const target = routeForm.target.trim()
    const limit = Number(routeForm.limit)
    if (!prefix || !target || Number.isNaN(limit) || limit <= 0) {
      setNotice('Нужны префикс маршрута, сервис и положительный rate limit.')
      return
    }
    const entity: Route = {
      id: nextID('route', 'gr'),
      prefix: prefix.startsWith('/') ? prefix : `/${prefix}`,
      target,
      auth: routeForm.auth,
      limit,
      status: 'active',
      hits: 0,
      blocked: 0,
    }
    setRoutes((prev) => [entity, ...prev])
    pushEvent('GatewayRouteCreated', `${entity.prefix} -> ${entity.target}`)
  }

  const onDispatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setDispatches((prev) => prev + 1)
    const path = dispatchForm.path.startsWith('/') ? dispatchForm.path : `/${dispatchForm.path}`
    const route = routes.find((item) => path.startsWith(item.prefix))
    if (!route) {
      setNotice('Маршрут не найден: запрос отклонен.')
      pushEvent('GatewayDispatchDenied', 'route not found')
      return
    }

    setRoutes((prev) =>
      prev.map((item) => {
        if (item.id !== route.id) return item
        if (item.status !== 'active') return { ...item, blocked: item.blocked + 1 }
        if (item.auth && !dispatchForm.token.trim().startsWith('tok_')) return { ...item, blocked: item.blocked + 1 }
        if (item.hits >= item.limit) return { ...item, blocked: item.blocked + 1 }
        return { ...item, hits: item.hits + 1 }
      }),
    )

    if (route.status !== 'active') {
      setNotice('Маршрут отключен: запрос отклонен.')
      pushEvent('GatewayDispatchDenied', `${route.id} disabled`)
      return
    }
    if (route.auth && !dispatchForm.token.trim().startsWith('tok_')) {
      setNotice('Требуется авторизация: запрос отклонен.')
      pushEvent('GatewayAuthDenied', `${route.id} ${dispatchForm.subject}`)
      return
    }
    if (route.hits >= route.limit) {
      setNotice('Превышен rate limit: запрос отклонен.')
      pushEvent('GatewayRateLimited', `${route.id} ${dispatchForm.subject}`)
      return
    }

    setNotice(`Запрос направлен в ${route.target}.`)
    pushEvent('GatewayRequestDispatched', `${route.id} ${dispatchForm.path}`)
  }

  const toggleRouteStatus = (routeID: string) => {
    setRoutes((prev) =>
      prev.map((item) => {
        if (item.id !== routeID) return item
        const nextStatus: Route['status'] = item.status === 'active' ? 'disabled' : 'active'
        pushEvent('GatewayRouteStatusChanged', `${routeID} -> ${nextStatus}`)
        return { ...item, status: nextStatus }
      }),
    )
  }

  const onSaveBinding = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const subjectID = bindingForm.subjectID.trim()
    const roles = parseRoles(bindingForm.roles)
    if (!subjectID || roles.length === 0) {
      setNotice('Нужны субъект и роли.')
      return
    }
    setBindings((prev) => {
      const idx = prev.findIndex((item) => item.subjectID === subjectID)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { subjectID, roles }
        return next
      }
      return [{ subjectID, roles }, ...prev]
    })
    pushEvent('SubjectBindingSaved', `${subjectID}: ${roles.join(',')}`)
  }

  const onRBACCheck = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRBACChecks((prev) => prev + 1)
    const subjectID = rbacForm.subjectID.trim()
    const role = rbacForm.role.trim().toLowerCase()
    const binding = bindings.find((item) => item.subjectID === subjectID)
    const allow = Boolean(binding?.roles.some((item) => item === role))
    setAccessResult(allow ? `ДОСТУП РАЗРЕШЕН: ${subjectID} имеет роль ${role}` : `ДОСТУП ЗАПРЕЩЕН: ${subjectID} не имеет роль ${role}`)
    pushEvent('RBACCheckExecuted', `${subjectID} -> ${role} (${allow ? 'allow' : 'deny'})`)
  }

  const onAppendAudit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!auditForm.actor.trim() || !auditForm.action.trim() || !auditForm.resource.trim()) {
      setNotice('Нужны actor, action и resource.')
      return
    }
    const raw = `${auditForm.actor}|${auditForm.resource}|${auditForm.action}|${audits.length}`
    const entity: Audit = {
      id: nextID('audit', 'ae'),
      actor: auditForm.actor.trim(),
      action: auditForm.action.trim(),
      resource: auditForm.resource.trim(),
      hash: hashLike(raw),
    }
    setAudits((prev) => [entity, ...prev])
    pushEvent('AuditEventRecorded', `${entity.id} ${entity.resource}.${entity.action}`)
  }

  const onCreateContract = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!contractForm.eventType.trim() || !contractForm.version.trim()) {
      setNotice('Нужны тип события и версия.')
      return
    }
    const entity: Contract = {
      id: nextID('contract', 'ec'),
      eventType: contractForm.eventType.trim(),
      version: contractForm.version.trim(),
    }
    setContracts((prev) => [entity, ...prev])
    pushEvent('EventContractPublished', `${entity.eventType} ${entity.version}`)
  }

  const onSendNotification = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!notificationForm.eventType.trim() || !notificationForm.recipient.trim()) {
      setNotice('Нужны триггер-событие и получатель.')
      return
    }
    const entity: Notification = {
      id: nextID('notification', 'ntf'),
      eventType: notificationForm.eventType.trim(),
      channel: notificationForm.channel,
      recipient: notificationForm.recipient.trim(),
    }
    setNotifications((prev) => [entity, ...prev])
    pushEvent('NotificationSent', `${entity.channel} ${entity.recipient}`)
  }

  const onCreateSaga = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const steps = Number(sagaForm.steps)
    if (!sagaForm.name.trim() || Number.isNaN(steps) || steps <= 0) {
      setNotice('Нужны название саги и положительное число шагов.')
      return
    }
    const entity: Saga = { id: nextID('saga', 'sg'), name: sagaForm.name.trim(), steps }
    setSagas((prev) => [entity, ...prev])
    pushEvent('SagaTemplateActivated', `${entity.name} steps:${entity.steps}`)
  }

  const onCaptureObservability = () => {
    setObservabilityRuns((prev) => prev + 1)
    pushEvent('ObservabilitySnapshotCaptured', `calls:${routes.reduce((sum, item) => sum + item.hits, 0)}`)
  }

  const onCreateSLO = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = Number(sloForm.target)
    if (!sloForm.name.trim() || Number.isNaN(target) || target <= 0 || target > 100) {
      setNotice('Нужны название SLO и target в диапазоне (0..100].')
      return
    }
    const entity: SLO = { id: nextID('slo', 'slo'), name: sloForm.name.trim(), target, status: 'healthy' }
    setSLOs((prev) => [entity, ...prev])
    pushEvent('SLOCreated', `${entity.name} ${entity.target}%`)
  }

  const setSLOStatus = (sloID: string, status: SLO['status']) => {
    setSLOs((prev) => prev.map((item) => (item.id === sloID ? { ...item, status } : item)))
    pushEvent('SLOStatusChanged', `${sloID} -> ${status}`)
  }

  const onCreateAlert = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!alertForm.name.trim()) {
      setNotice('Название алерта обязательно.')
      return
    }
    const entity: Alert = {
      id: nextID('alert', 'al'),
      name: alertForm.name.trim(),
      severity: alertForm.severity,
      triggers: 0,
    }
    setAlerts((prev) => [entity, ...prev])
    pushEvent('AlertRuleCreated', `${entity.name} ${entity.severity}`)
  }

  const triggerAlert = (alertID: string) => {
    setAlerts((prev) =>
      prev.map((item) => (item.id === alertID ? { ...item, triggers: item.triggers + 1 } : item)),
    )
    pushEvent('AlertTriggered', alertID)
  }

  const onCreateBackup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!backupForm.scope.trim()) {
      setNotice('Область бэкапа обязательна.')
      return
    }
    const entity: Backup = { id: nextID('backup', 'bk'), scope: backupForm.scope.trim(), status: 'ready' }
    setBackups((prev) => [entity, ...prev])
    pushEvent('BackupCreated', `${entity.id} ${entity.scope}`)
  }

  const onRestoreBackup = (backupID: string) => {
    setBackups((prev) => prev.map((item) => (item.id === backupID ? { ...item, status: 'restored' } : item)))
    setRestoreRuns((prev) => prev + 1)
    pushEvent('BackupRestored', backupID)
  }

  const onCreateRelease = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!releaseForm.name.trim()) {
      setNotice('Название релиза обязательно.')
      return
    }
    const entity: Release = {
      id: nextID('release', 'rls'),
      name: releaseForm.name.trim(),
      env: releaseForm.env,
      strategy: releaseForm.strategy,
      status: 'planned',
    }
    setReleases((prev) => [entity, ...prev])
    pushEvent('ReleasePlanCreated', `${entity.name} ${entity.env}`)
  }

  const setReleaseStatus = (releaseID: string, status: Release['status']) => {
    setReleases((prev) => prev.map((item) => (item.id === releaseID ? { ...item, status } : item)))
    pushEvent(status === 'rolled_back' ? 'ReleaseRolledBack' : 'ReleaseStatusChanged', `${releaseID} -> ${status}`)
  }

  const onRunFinops = () => {
    setFinopsRuns((prev) => prev + 1)
    pushEvent('FinOpsReviewCompleted', `dispatches:${dispatches} alerts:${alerts.length}`)
  }

  const checks = useMemo(
    () => [
      { label: 'API Gateway: маршрутизация/auth/rate limit', done: routes.length > 0 && dispatches > 0 },
      { label: 'Identity & Access RBAC', done: bindings.length > 0 && rbacChecks > 0 },
      { label: 'Audit Log для критичных действий', done: audits.length > 0 },
      { label: 'Контракты событий и версии схем', done: contracts.length > 0 },
      { label: 'Пайплайн уведомлений', done: notifications.length > 0 },
      { label: 'Шаблоны саг и компенсаций', done: sagas.length > 0 },
      { label: 'Использование observability-стека', done: observabilityRuns > 0 },
      { label: 'SLO + alerting + контроль error budget', done: slos.length > 0 && alerts.some((item) => item.triggers > 0) },
      { label: 'Backup/restore и runbooks', done: backups.length > 0 && restoreRuns > 0 },
      { label: 'Production-доставка по окружениям', done: releases.some((item) => item.env === 'prod') },
      { label: 'Надежный rollout и rollback', done: releases.some((item) => item.status === 'rolled_back') },
      { label: 'FinOps-контроль производительности и затрат', done: finopsRuns > 0 },
    ],
    [alerts, audits.length, backups.length, bindings.length, contracts.length, dispatches, finopsRuns, notifications.length, observabilityRuns, rbacChecks, releases, restoreRuns, routes.length, sagas.length, slos.length],
  )

  const finops = useMemo(() => {
    const totalCalls = routes.reduce((sum, item) => sum + item.hits + item.blocked, 0)
    const blocked = routes.reduce((sum, item) => sum + item.blocked, 0)
    const estCost = Math.round((90 + totalCalls * 0.04 + blocked * 0.06) * 100) / 100
    return { totalCalls, blocked, estCost }
  }, [routes])

  return (
    <section className="crm-workbench">
      <div className="crm-workbench__header">
        <article className="focus-panel">
          <div>
            <p className="focus-panel__label">Подсистема</p>
            <p className="focus-panel__value crm-workbench__metric">{item.title}</p>
          </div>
          <p className="focus-panel__note">Платформенные сервисы управляются сквозным образом через веб-интерфейс.</p>
        </article>
        <article className="focus-panel">
          <div>
            <p className="focus-panel__label">KPI платформы</p>
            <p className="focus-panel__value">${finops.estCost}</p>
          </div>
          <p className="focus-panel__note">Вызовы {finops.totalCalls} | блокировки {finops.blocked} | событий {events.length}</p>
        </article>
      </div>

      {notice ? <p className="crm-workbench__notice">{notice}</p> : null}

      <div className="crm-checks-grid">
        {checks.map((check) => (
          <label key={check.label} className={`crm-check ${check.done ? 'done' : ''}`}>
            <input type="checkbox" checked={check.done} readOnly />
            <span>{check.label}</span>
          </label>
        ))}
      </div>

      <div className="crm-workbench-grid">
        <article className="crm-card">
          <h3>Gateway и доступ</h3>
          <form className="crm-form-grid" onSubmit={onCreateRoute}>
            <input placeholder="Префикс маршрута" value={routeForm.prefix} onChange={(event) => setRouteForm((prev) => ({ ...prev, prefix: event.target.value }))} />
            <input placeholder="Целевой сервис" value={routeForm.target} onChange={(event) => setRouteForm((prev) => ({ ...prev, target: event.target.value }))} />
            <input placeholder="Rate limit/мин" value={routeForm.limit} onChange={(event) => setRouteForm((prev) => ({ ...prev, limit: event.target.value }))} />
            <label className="crm-check"><input type="checkbox" checked={routeForm.auth} onChange={(event) => setRouteForm((prev) => ({ ...prev, auth: event.target.checked }))} /><span>Требуется auth</span></label>
            <button className="btn-secondary" type="submit">Создать маршрут</button>
          </form>
          <form className="crm-form-grid" onSubmit={onDispatch}>
            <input placeholder="Путь" value={dispatchForm.path} onChange={(event) => setDispatchForm((prev) => ({ ...prev, path: event.target.value }))} />
            <input placeholder="Субъект" value={dispatchForm.subject} onChange={(event) => setDispatchForm((prev) => ({ ...prev, subject: event.target.value }))} />
            <input placeholder="Токен (tok_...)" value={dispatchForm.token} onChange={(event) => setDispatchForm((prev) => ({ ...prev, token: event.target.value }))} />
            <button className="btn-secondary" type="submit">Отправить запрос</button>
          </form>
          <form className="crm-form-grid" onSubmit={onSaveBinding}>
            <input placeholder="Субъект" value={bindingForm.subjectID} onChange={(event) => setBindingForm((prev) => ({ ...prev, subjectID: event.target.value }))} />
            <input placeholder="Роли (через запятую)" value={bindingForm.roles} onChange={(event) => setBindingForm((prev) => ({ ...prev, roles: event.target.value }))} />
            <button className="btn-secondary" type="submit">Сохранить binding</button>
          </form>
          <form className="crm-form-grid" onSubmit={onRBACCheck}>
            <input placeholder="Субъект" value={rbacForm.subjectID} onChange={(event) => setRBACForm((prev) => ({ ...prev, subjectID: event.target.value }))} />
            <input placeholder="Роль" value={rbacForm.role} onChange={(event) => setRBACForm((prev) => ({ ...prev, role: event.target.value }))} />
            <button className="btn-secondary" type="submit">Проверить RBAC</button>
          </form>
          <p className="crm-mini-title">{accessResult}</p>
          <ul className="crm-list crm-list--compact">
            {routes.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.id}</strong>
                  <p>{item.prefix} {'->'} {item.target} | {routeStatusLabel[item.status]} | хиты {item.hits} / блок {item.blocked}</p>
                </div>
                <div className="crm-list__actions"><button className="btn-secondary" type="button" onClick={() => toggleRouteStatus(item.id)}>Переключить</button></div>
              </li>
            ))}
          </ul>
        </article>

        <article className="crm-card">
          <h3>Audit и контракты событий</h3>
          <form className="crm-form-grid" onSubmit={onAppendAudit}>
            <input placeholder="Исполнитель" value={auditForm.actor} onChange={(event) => setAuditForm((prev) => ({ ...prev, actor: event.target.value }))} />
            <input placeholder="Действие" value={auditForm.action} onChange={(event) => setAuditForm((prev) => ({ ...prev, action: event.target.value }))} />
            <select value={auditForm.resource} onChange={(event) => setAuditForm((prev) => ({ ...prev, resource: event.target.value }))}>
              {resourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="btn-secondary" type="submit">Добавить audit</button>
          </form>
          <form className="crm-form-grid" onSubmit={onCreateContract}>
            <input placeholder="Тип события" value={contractForm.eventType} onChange={(event) => setContractForm((prev) => ({ ...prev, eventType: event.target.value }))} />
            <input placeholder="Версия" value={contractForm.version} onChange={(event) => setContractForm((prev) => ({ ...prev, version: event.target.value }))} />
            <button className="btn-secondary" type="submit">Опубликовать контракт</button>
          </form>
          <form className="crm-form-grid" onSubmit={onSendNotification}>
            <input placeholder="Триггер-событие" value={notificationForm.eventType} onChange={(event) => setNotificationForm((prev) => ({ ...prev, eventType: event.target.value }))} />
            <select value={notificationForm.channel} onChange={(event) => setNotificationForm((prev) => ({ ...prev, channel: event.target.value as Notification['channel'] }))}><option value="email">email</option><option value="sms">sms</option></select>
            <input placeholder="Получатель" value={notificationForm.recipient} onChange={(event) => setNotificationForm((prev) => ({ ...prev, recipient: event.target.value }))} />
            <button className="btn-secondary" type="submit">Отправить уведомление</button>
          </form>
          <form className="crm-form-grid" onSubmit={onCreateSaga}>
            <input placeholder="Название саги" value={sagaForm.name} onChange={(event) => setSagaForm((prev) => ({ ...prev, name: event.target.value }))} />
            <input placeholder="Шаги" value={sagaForm.steps} onChange={(event) => setSagaForm((prev) => ({ ...prev, steps: event.target.value }))} />
            <button className="btn-secondary" type="submit">Создать сагу</button>
          </form>
          <ul className="crm-list crm-list--compact">
            {audits.map((item) => <li key={item.id}><div><strong>{item.id}</strong><p>{item.actor} | {item.resource}.{item.action} | {item.hash}</p></div></li>)}
            {contracts.map((item) => <li key={item.id}><div><strong>{item.id}</strong><p>{item.eventType} {item.version}</p></div></li>)}
            {notifications.map((item) => <li key={item.id}><div><strong>{item.id}</strong><p>{item.channel} {item.recipient}</p></div></li>)}
            {sagas.map((item) => <li key={item.id}><div><strong>{item.id}</strong><p>{item.name} | steps {item.steps}</p></div></li>)}
          </ul>
        </article>

        <article className="crm-card">
          <h3>Observability, SLO и алерты</h3>
          <button className="btn-secondary" type="button" onClick={onCaptureObservability}>Снять observability-снимок</button>
          <form className="crm-form-grid" onSubmit={onCreateSLO}>
            <input placeholder="Название SLO" value={sloForm.name} onChange={(event) => setSLOForm((prev) => ({ ...prev, name: event.target.value }))} />
            <input placeholder="Цель %" value={sloForm.target} onChange={(event) => setSLOForm((prev) => ({ ...prev, target: event.target.value }))} />
            <button className="btn-secondary" type="submit">Создать SLO</button>
          </form>
          <form className="crm-form-grid" onSubmit={onCreateAlert}>
            <input placeholder="Название алерта" value={alertForm.name} onChange={(event) => setAlertForm((prev) => ({ ...prev, name: event.target.value }))} />
            <select value={alertForm.severity} onChange={(event) => setAlertForm((prev) => ({ ...prev, severity: event.target.value as Alert['severity'] }))}><option value="low">низкий</option><option value="medium">средний</option><option value="high">высокий</option><option value="critical">критичный</option></select>
            <button className="btn-secondary" type="submit">Создать алерт</button>
          </form>
          <ul className="crm-list crm-list--compact">
            {slos.map((item) => (
              <li key={item.id}>
                <div><strong>{item.id}</strong><p>{item.name} {item.target}% | {sloStatusLabel[item.status]}</p></div>
                <div className="crm-list__actions"><button className="btn-secondary" type="button" onClick={() => setSLOStatus(item.id, 'degraded')}>Ухудшить</button><button className="btn-secondary" type="button" onClick={() => setSLOStatus(item.id, 'breached')}>Нарушить</button></div>
              </li>
            ))}
            {alerts.map((item) => (
              <li key={item.id}>
                <div><strong>{item.id}</strong><p>{item.name} {alertSeverityLabel[item.severity]} | triggers {item.triggers}</p></div>
                <div className="crm-list__actions"><button className="btn-secondary" type="button" onClick={() => triggerAlert(item.id)}>Сработать</button></div>
              </li>
            ))}
          </ul>
        </article>

        <article className="crm-card">
          <h3>Резервирование, релизы и FinOps</h3>
          <form className="crm-form-grid" onSubmit={onCreateBackup}>
            <input placeholder="Область backup" value={backupForm.scope} onChange={(event) => setBackupForm((prev) => ({ ...prev, scope: event.target.value }))} />
            <button className="btn-secondary" type="submit">Создать backup</button>
          </form>
          <form className="crm-form-grid" onSubmit={onCreateRelease}>
            <input placeholder="Название релиза" value={releaseForm.name} onChange={(event) => setReleaseForm((prev) => ({ ...prev, name: event.target.value }))} />
            <select value={releaseForm.env} onChange={(event) => setReleaseForm((prev) => ({ ...prev, env: event.target.value as Release['env'] }))}><option value="dev">dev</option><option value="stage">stage</option><option value="prod">prod</option></select>
            <select value={releaseForm.strategy} onChange={(event) => setReleaseForm((prev) => ({ ...prev, strategy: event.target.value as Release['strategy'] }))}><option value="rolling">rolling</option><option value="canary">canary</option><option value="blue-green">blue-green</option></select>
            <button className="btn-secondary" type="submit">Запланировать релиз</button>
          </form>
          <button className="btn-secondary" type="button" onClick={onRunFinops}>Запустить FinOps review</button>
          <ul className="crm-list crm-list--compact">
            {backups.map((item) => (
              <li key={item.id}>
                <div><strong>{item.id}</strong><p>{item.scope} | {backupStatusLabel[item.status]}</p></div>
                <div className="crm-list__actions"><button className="btn-secondary" type="button" onClick={() => onRestoreBackup(item.id)}>Восстановить</button></div>
              </li>
            ))}
            {releases.map((item) => (
              <li key={item.id}>
                <div><strong>{item.id}</strong><p>{item.name} | {releaseEnvLabel[item.env]} | {releaseStrategyLabel[item.strategy]} | {releaseStatusLabel[item.status]}</p></div>
                <div className="crm-list__actions"><button className="btn-secondary" type="button" onClick={() => setReleaseStatus(item.id, 'rolling_out')}>Выкатить</button><button className="btn-secondary" type="button" onClick={() => setReleaseStatus(item.id, 'active')}>Активировать</button><button className="btn-secondary" type="button" onClick={() => setReleaseStatus(item.id, 'rolled_back')}>Откатить</button></div>
              </li>
            ))}
            {events.map((item) => <li key={item.id}><div><strong>{item.type}</strong><p>{item.note}</p></div></li>)}
          </ul>
        </article>
      </div>
    </section>
  )
}
