# Backup/Restore And Secrets

## Secrets management

1. Create local secrets file from template:

```powershell
Copy-Item infra/docker/.env.example infra/docker/.env
```

2. Replace all `CHANGE_ME_STRONG_PASSWORD` values in `infra/docker/.env`.
3. Keep `infra/docker/.env` out of Git (already ignored in `.gitignore`).
4. For security profile, run Vault from compose:

```powershell
cd infra/docker
docker compose --profile security up -d vault
```

## PostgreSQL backup

Create SQL dump from running compose stack:

```powershell
powershell -File scripts/ops/backup-postgres.ps1
```

Default output path inside the repository:

```text
infra/docker/postgres/backups
```

For a full repo snapshot in the `database-per-service` architecture, dump the
entire cluster:

```powershell
powershell -File scripts/ops/backup-postgres.ps1 -AllDatabases
```

Custom destination:

```powershell
powershell -File scripts/ops/backup-postgres.ps1 -OutputDir "D:\KIS\backups\postgres"
```

## PostgreSQL restore

Restore database from dump file:

```powershell
powershell -File scripts/ops/restore-postgres.ps1 -BackupFile "infra\docker\postgres\backups\postgres-platform-YYYYMMDD-HHMMSS.sql"
```

Restore a full-cluster dump:

```powershell
powershell -File scripts/ops/restore-postgres.ps1 -BackupFile "infra\docker\postgres\backups\postgres-cluster-YYYYMMDD-HHMMSS.sql" -AllDatabases
```

## Operational notes

- Run backups on schedule (Task Scheduler/CI runner).
- Validate restore regularly on a non-production environment.
- Use separate credentials per environment (`dev/stage/prod`).
- Rotate admin and DB passwords periodically.
