import type { SubsystemNavItem } from '../config/navigation'
import { subsystemRoadmaps, type PhaseStatus } from '../config/subsystemRoadmap'
import { CrmSalesWorkbench } from './CrmSalesWorkbench'
import { FinanceReportingWorkbench } from './FinanceReportingWorkbench'
import { InventoryWarehouseWorkbench } from './InventoryWarehouseWorkbench'
import { PlatformServicesWorkbench } from './PlatformServicesWorkbench'
import { ServiceRepairWorkbench } from './ServiceRepairWorkbench'

const phaseStatusLabel: Record<PhaseStatus, string> = {
  next: 'Следующий этап',
  planned: 'В плане',
  later: 'Позже',
}

export function SectionPage({ item }: { item: SubsystemNavItem }) {
  if (item.slug === 'crm-sales') {
    return <CrmSalesWorkbench item={item} />
  }
  if (item.slug === 'service') {
    return <ServiceRepairWorkbench item={item} />
  }
  if (item.slug === 'inventory') {
    return <InventoryWarehouseWorkbench item={item} />
  }
  if (item.slug === 'finance') {
    return <FinanceReportingWorkbench item={item} />
  }
  if (item.slug === 'platform') {
    return <PlatformServicesWorkbench item={item} />
  }

  const roadmap = subsystemRoadmaps[item.slug]

  return (
    <section>
      <header className="section-header">
        <p className="section-header__tag">Подсистема</p>
        <h2 className="section-header__title">{item.title}</h2>
        <p className="section-header__subtitle">{item.summary}</p>
      </header>

      {roadmap ? (
        <>
          <div className="roadmap-meta-grid">
            <article className="focus-panel">
              <div>
                <p className="focus-panel__label">Метрика подсистемы</p>
                <p className="focus-panel__value">{item.metricValue}</p>
              </div>
              <p className="focus-panel__note">{item.metricLabel}</p>
            </article>

            <article className="focus-panel">
              <div>
                <p className="focus-panel__label">Источник требований</p>
                <p className="focus-panel__value roadmap-meta-value">{roadmap.sourceDocs.length}</p>
              </div>
              <ul className="roadmap-chip-list">
                {roadmap.sourceDocs.map((doc) => (
                  <li key={`${item.slug}-${doc}`}>{doc}</li>
                ))}
              </ul>
            </article>
          </div>

          <div className="roadmap-meta-grid">
            <article className="roadmap-meta-card">
              <h3>Ключевые сущности</h3>
              <ul className="roadmap-chip-list">
                {roadmap.keyEntities.map((entity) => (
                  <li key={`${item.slug}-entity-${entity}`}>{entity}</li>
                ))}
              </ul>
            </article>

            <article className="roadmap-meta-card">
              <h3>Ключевые события</h3>
              <ul className="roadmap-chip-list">
                {roadmap.keyEvents.map((eventName) => (
                  <li key={`${item.slug}-event-${eventName}`}>
                    <code>{eventName}</code>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <div className="roadmap-grid">
            {roadmap.phases.map((phase, index) => (
              <article
                key={phase.id}
                className="roadmap-card"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="roadmap-card__head">
                  <p className="roadmap-card__title">{phase.title}</p>
                  <span className={`roadmap-status roadmap-status--${phase.status}`}>
                    {phaseStatusLabel[phase.status]}
                  </span>
                </div>
                <p className="roadmap-card__outcome">{phase.outcome}</p>

                <p className="roadmap-card__label">Функционал</p>
                <ul className="roadmap-list">
                  {phase.items.map((task) => (
                    <li key={`${phase.id}-task-${task}`}>{task}</li>
                  ))}
                </ul>

                <p className="roadmap-card__label">Сервисы</p>
                <ul className="roadmap-chip-list">
                  {phase.services.map((service) => (
                    <li key={`${phase.id}-service-${service}`}>
                      <code>{service}</code>
                    </li>
                  ))}
                </ul>

                <p className="roadmap-card__label">Интеграции</p>
                <ul className="roadmap-chip-list">
                  {phase.integrations.map((integration) => (
                    <li key={`${phase.id}-integration-${integration}`}>
                      <code>{integration}</code>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </>
      ) : (
        <article className="focus-panel">
          <div>
            <p className="focus-panel__label">{item.metricLabel}</p>
            <p className="focus-panel__value">{item.metricValue}</p>
          </div>
          <p className="focus-panel__note">
            Дорожная карта для этой подсистемы еще не добавлена.
          </p>
        </article>
      )}
    </section>
  )
}
