import { NavLink } from 'react-router-dom'

type ReadinessItem = {
  title: string
  summary: string
  artifacts: string[]
}

const productionReadiness: ReadinessItem[] = [
  {
    title: 'Kubernetes манифесты и Helm для production',
    summary:
      'Собраны base/overlays для dev-stage-prod и Helm chart для api-gateway с HPA, PDB и Ingress.',
    artifacts: [
      'infra/k8s/base/kustomization.yaml',
      'infra/k8s/overlays/dev/kustomization.yaml',
      'infra/k8s/overlays/stage/kustomization.yaml',
      'infra/k8s/overlays/prod/kustomization.yaml',
      'infra/helm/kis-nexus/Chart.yaml',
    ],
  },
  {
    title: 'CI/CD деплой по окружениям',
    summary:
      'Подготовлен workflow с валидацией манифестов, автодеплоем в dev и ручными деплоями в stage/prod.',
    artifacts: ['.github/workflows/cd.yml', 'docs/operations/cicd-deployments.md'],
  },
  {
    title: 'SLA/SLO и alerting',
    summary:
      'Зафиксированы цели SLA/SLO и подключены правила Prometheus для error-rate, latency и burn-rate.',
    artifacts: [
      'docs/operations/sla-slo-and-alerting.md',
      'infra/docker/prometheus/alerts-kis-nexus.yml',
      'infra/docker/prometheus/prometheus.yml',
    ],
  },
  {
    title: 'План миграции и cutover',
    summary: 'Описан пошаговый план dry-run, freeze, финальный релиз, rollback и критерии отката.',
    artifacts: ['docs/operations/data-migration-and-cutover.md'],
  },
  {
    title: 'Runbook и операционные инструкции',
    summary:
      'Подготовлен production runbook с процедурами реагирования на инциденты и пост-инцидентным циклом.',
    artifacts: ['docs/operations/production-runbook.md'],
  },
]

const postMvpReadiness: ReadinessItem[] = [
  {
    title: 'BI и near real-time витрины',
    summary:
      'Определен поток обновления витрин и целевой лаг: до 5 минут через событийную загрузку.',
    artifacts: ['docs/architecture/post-mvp-development-plan.md'],
  },
  {
    title: 'Расширенные pricing/promotions/commissions',
    summary: 'Зафиксирован этап по rules engine, governance скидок и прозрачному расчету комиссий.',
    artifacts: ['docs/architecture/post-mvp-development-plan.md'],
  },
  {
    title: 'Интеграции с внешними каналами',
    summary: 'Описаны интеграции website/telephony/messaging с единым подходом retries и idempotency.',
    artifacts: ['docs/architecture/post-mvp-development-plan.md'],
  },
  {
    title: 'Оптимизация производительности и стоимости',
    summary: 'Определены capacity baselines, right-sizing и регулярный FinOps review.',
    artifacts: ['docs/architecture/post-mvp-development-plan.md'],
  },
]

const environments = [
  {
    name: 'DEV',
    appEnv: 'dev',
    replicas: '1',
    imageTag: 'dev-latest',
    ingress: 'api.dev.kis.local',
  },
  {
    name: 'STAGE',
    appEnv: 'stage',
    replicas: '2',
    imageTag: 'stage-latest',
    ingress: 'api.stage.kis.example.com',
  },
  {
    name: 'PROD',
    appEnv: 'prod',
    replicas: '3',
    imageTag: 'stable',
    ingress: 'api.kis.example.com',
  },
]

function Checklist({ items }: { items: ReadinessItem[] }) {
  return (
    <div className="readiness-grid">
      {items.map((item) => (
        <article key={item.title} className="readiness-card">
          <div className="readiness-card__head">
            <span className="readiness-card__check" aria-hidden>
              ✓
            </span>
            <h4>{item.title}</h4>
          </div>
          <p>{item.summary}</p>
          <ul className="readiness-card__artifacts">
            {item.artifacts.map((artifact) => (
              <li key={`${item.title}-${artifact}`}>
                <code>{artifact}</code>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}

export function ReadinessPage() {
  return (
    <section>
      <header className="section-header">
        <p className="section-header__tag">Дорожная карта</p>
        <h2 className="section-header__title">Пункты 9 и 10 через сайт</h2>
        <p className="section-header__subtitle">
          Здесь собраны результаты по production readiness и post-MVP развитию без необходимости
          работать в терминале.
        </p>
      </header>

      <div className="readiness-kpi-grid">
        <article className="focus-panel readiness-kpi">
          <div>
            <p className="focus-panel__label">Пункт 9</p>
            <p className="focus-panel__value">5/5</p>
          </div>
          <p className="focus-panel__note">Все задачи подготовки к production закрыты.</p>
        </article>
        <article className="focus-panel readiness-kpi">
          <div>
            <p className="focus-panel__label">Пункт 10</p>
            <p className="focus-panel__value">4/4</p>
          </div>
          <p className="focus-panel__note">План post-MVP зафиксирован в архитектурной документации.</p>
        </article>
        <article className="focus-panel readiness-kpi">
          <div>
            <p className="focus-panel__label">Артефакты</p>
            <p className="focus-panel__value">12+</p>
          </div>
          <p className="focus-panel__note">
            K8s, Helm, CI/CD, SLO/alerts, cutover, runbook и post-MVP roadmap.
          </p>
        </article>
      </div>

      <h3 className="readiness-title">9. Подготовка к production</h3>
      <Checklist items={productionReadiness} />

      <h3 className="readiness-title">10. Пост-MVP развитие</h3>
      <Checklist items={postMvpReadiness} />

      <h3 className="readiness-title">Окружения деплоя</h3>
      <div className="cards-grid">
        {environments.map((env) => (
          <article key={env.name} className="system-card">
            <h3>{env.name}</h3>
            <p>
              <strong>APP_ENV:</strong> {env.appEnv}
            </p>
            <p>
              <strong>Реплики:</strong> {env.replicas}
            </p>
            <p>
              <strong>Образ:</strong> <code>ghcr.io/kis-nexus/api-gateway:{env.imageTag}</code>
            </p>
            <p>
              <strong>Ингресс:</strong> <code>{env.ingress}</code>
            </p>
          </article>
        ))}
      </div>

      <article className="focus-panel readiness-footer">
        <div>
          <p className="focus-panel__label">Что дальше</p>
          <p className="focus-panel__value">UI-first</p>
        </div>
        <p className="focus-panel__note">
          Для просмотра доменных сценариев откройте разделы CRM/Сервис/Склад/Финансы, а для
          быстрого перехода используйте <NavLink className="system-card__link" to="/search">Глобальный поиск</NavLink>.
        </p>
      </article>
    </section>
  )
}
