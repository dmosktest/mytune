# mytune

Browser-only MySQL / MariaDB configuration tuner. Sibling of [pgtune](https://github.com/dmosktest/pgtune) for PostgreSQL.

**Version:** `1.0.0`

## Features

- MySQL 8.0 / 8.4 / 9.0 and MariaDB 10.11 / 11.4
- Core form first; advanced options and optional stats/config paste behind spoilers
- Result immediately after generate: memory budget, multi-format export, explanations; warnings below
- Export: my.cnf, `SET GLOBAL` / `SET PERSIST`, Docker, Compose, Helm/Operator, Migration SQL, Orchestrator YAML, Ansible
- Pooler modes, server roles, AWS/Yandex presets, conf diff, status / performance_schema ingest
- Health Score and Plan vs Fact on two status snapshots; optional OS metrics from the collector
- Host collector scripts (`collect.sh` / `collect.ps1`) that print a parameterized mytune URL plus OS lines
- Downloadable briefs for a human DBA and for an AI agent
- 37 UI languages; shareable URL

Everything runs in the browser. There is no API that accepts your server parameters.

## License

MIT � see [LICENSE](LICENSE).

## Upstream

Product docs and deploy live in the private GitLab `mksrv` monorepo. This GitHub tree is the public application source mirror only.
