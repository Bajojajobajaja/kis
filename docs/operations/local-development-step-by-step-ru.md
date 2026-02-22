# Пошаговый запуск проекта (для начинающих)

Это руководство для Windows и PowerShell.

Цель: запустить весь backend-стек (PostgreSQL, Redis и все микросервисы) так, чтобы система работала локально.

## 1. Что должно быть установлено

Проверьте, что установлены:

- Docker Desktop
- Go (1.22+)
- goreman

Проверка командами:

```powershell
docker --version
go version
goreman version
```

Если `goreman` не найден:

```powershell
go install github.com/mattn/goreman@latest
$env:Path += ";$HOME\go\bin"
goreman version
```

## 2. Первый запуск (делается один раз)

### 2.1 Откройте PowerShell и перейдите в проект

```powershell
cd D:\KIS
```

### 2.2 Подготовьте файл окружения для Docker-инфры

```powershell
Copy-Item .\infra\docker\.env.example .\infra\docker\.env
```

Откройте `infra/docker/.env` и замените все `CHANGE_ME_STRONG_PASSWORD` на ваши значения.

### 2.3 Соберите бинарники всех сервисов

```powershell
powershell -File .\scripts\dev\build-services.ps1
```

После этого в `D:\KIS\bin` появятся `*.exe` для сервисов.

### 2.4 Один раз добавьте правила брандмауэра (PowerShell от администратора)

Откройте **новый PowerShell от имени администратора** и выполните:

```powershell
cd D:\KIS
powershell -File .\scripts\dev\allow-firewall-services.ps1 -PrivateOnly
```

Это убирает необходимость нажимать 20+ всплывающих окон для каждого сервиса.

## 3. Ежедневный запуск проекта

Обычный PowerShell (не админ):

```powershell
cd D:\KIS
powershell -File .\scripts\dev\start-goreman.ps1
```

Что делает команда:

- поднимает Docker-инфру (`Postgres`, `Redis` и др.)
- проверяет/собирает сервисные бинарники
- запускает все сервисы в одном окне через goreman

## 4. Быстрый запуск (когда уже всё собрано и infra уже работает)

```powershell
cd D:\KIS
powershell -File .\scripts\dev\start-goreman.ps1 -SkipInfra -SkipBuild
```

## 5. Остановка

В окне goreman нажмите:

```text
Ctrl + C
```

Если нужно остановить Docker-инфру:

```powershell
cd D:\KIS\infra\docker
docker compose down
```

## 6. Проверка, что система реально работает

В новом окне PowerShell:

```powershell
curl http://localhost:19083/healthz
curl http://localhost:19084/healthz
curl http://localhost:19098/healthz
```

Если видите JSON со статусом `ok`/`ready`, сервисы работают.

## 7. Типовые проблемы и решения

### Ошибка: `dockerDesktopLinuxEngine ... cannot find/open pipe`

Причина: Docker Desktop не запущен.
Решение: запустите Docker Desktop и повторите команду.

### Ошибка: `bind ... already in use`

Порт занят старым процессом.
Освобождение dev-портов:

```powershell
$ports=19080..19105
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

После этого снова:

```powershell
powershell -File .\scripts\dev\start-goreman.ps1 -SkipInfra -SkipBuild
```

### Ошибка: `goreman is not recognized`

Добавьте путь к `goreman.exe`:

```powershell
$env:Path += ";$HOME\go\bin"
goreman version
```

### Появляются окна Windows Firewall

Сделайте шаг 2.4 (правила брандмауэра от администратора) и запускайте сервисы через `start-goreman.ps1`.

### Нужно полностью перезапустить всё с нуля

```powershell
cd D:\KIS
cd .\infra\docker
docker compose down
cd D:\KIS
powershell -File .\scripts\dev\build-services.ps1
powershell -File .\scripts\dev\start-goreman.ps1
```

## 8. Мини-чеклист для команды

Каждому новому разработчику:

1. Установить Docker, Go, goreman.
2. Скопировать `infra/docker/.env.example` в `.env`.
3. Выполнить `build-services.ps1`.
4. Один раз выполнить `allow-firewall-services.ps1 -PrivateOnly` (от администратора).
5. Работать через `start-goreman.ps1`.
