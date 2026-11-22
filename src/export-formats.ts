import { formatSettingValue, type TuneSetting } from "./tune";

export type ManagedTarget =
  | "selfhosted"
  | "rds"
  | "aurora"
  | "cloudsql"
  | "azure"
  | "yandex";

export type ExportTab =
  | "conf"
  | "alter"
  | "docker"
  | "compose"
  | "helm"
  | "migrate"
  | "orchestrator"
  | "ansible";

export type ExportBundle = {
  conf: string;
  alterSystem: string;
  dockerArgs: string;
  dockerRunSnippet: string;
  composeYaml: string;
  helmYaml: string;
  migrateSql: string;
  orchestratorYaml: string;
  ansibleYaml: string;
  managedNoteId: string;
  managedSkipped: Array<{ key: string; reasonId: string }>;
  managedSettings: TuneSetting[];
};

const MANAGED_BLOCKED: Record<
  Exclude<ManagedTarget, "selfhosted">,
  Set<string>
> = {
  rds: new Set([
    "innodb_buffer_pool_size",
    "innodb_flush_method",
    "innodb_log_file_size",
    "innodb_redo_log_capacity",
    "key_buffer_size",
  ]),
  aurora: new Set([
    "innodb_buffer_pool_size",
    "innodb_flush_method",
    "innodb_log_file_size",
    "innodb_redo_log_capacity",
    "sync_binlog",
    "read_only",
    "super_read_only",
  ]),
  cloudsql: new Set([
    "innodb_buffer_pool_size",
    "innodb_flush_method",
    "innodb_log_file_size",
    "innodb_redo_log_capacity",
  ]),
  azure: new Set([
    "innodb_buffer_pool_size",
    "innodb_flush_method",
    "innodb_log_file_size",
    "innodb_redo_log_capacity",
  ]),
  yandex: new Set(["innodb_flush_method"]),
};

function setGlobalLine(s: TuneSetting): string {
  const value = formatSettingValue(s).replace(/'/g, "''");
  return `SET GLOBAL ${s.key} = '${value}';`;
}

function yamlQuote(value: string): string {
  if (/^[\w.+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function formatAlterSystem(settings: TuneSetting[]): string {
  return settings
    .map(setGlobalLine)
    .concat([
      "-- Persist with SET PERSIST … (MySQL 8+) or write into my.cnf and restart.",
    ])
    .join("\n");
}

export function formatMigrationSql(settings: TuneSetting[]): string {
  const reload = settings.filter((s) => !s.restart);
  const restart = settings.filter((s) => s.restart);
  const parts: string[] = [
    "-- mytune migration: apply dynamic settings first,",
    "-- then schedule a restart for variables that require it.",
    "",
  ];
  if (reload.length) {
    parts.push("-- === Dynamic (no restart) ===");
    for (const s of reload) {
      parts.push(`SET PERSIST ${s.key} = '${formatSettingValue(s).replace(/'/g, "''")}';`);
    }
    parts.push("");
  } else {
    parts.push("-- (no dynamic settings in this set)");
    parts.push("");
  }
  if (restart.length) {
    parts.push("-- === Requires service restart ===");
    parts.push("-- Put these into my.cnf /mysqld/ and restart mysqld.");
    for (const s of restart) {
      parts.push(`-- ${s.key} = ${formatSettingValue(s)}`);
    }
    parts.push("-- systemctl restart mysqld   # or your orchestrator restart");
  } else {
    parts.push("-- (no restart-required settings in this set)");
  }
  return parts.join("\n");
}

export function formatOrchestratorYaml(settings: TuneSetting[]): string {
  const lines = [
    "# Orchestrator fragment — merge under mysql/mariadb parameters map",
    "mysql:",
    "  parameters:",
  ];
  for (const s of settings) {
    lines.push(`    ${s.key}: ${yamlQuote(formatSettingValue(s))}`);
  }
  return lines.join("\n");
}

export function formatAnsibleYaml(settings: TuneSetting[]): string {
  const lines = [
    "# Ansible — community.mysql.mysql_variables (loop)",
    "- name: Apply mytune MySQL settings",
    "  community.mysql.mysql_variables:",
    "    variable: \"{{ item.name }}\"",
    "    value: \"{{ item.value }}\"",
    "  loop:",
  ];
  for (const s of settings) {
    lines.push(
      `    - { name: ${s.key}, value: ${yamlQuote(formatSettingValue(s))} }`,
    );
  }
  return lines.join("\n");
}

export function formatDockerArgs(settings: TuneSetting[]): string {
  return settings
    .map((s) => `--${s.key.replace(/_/g, "-")}=${formatSettingValue(s)}`)
    .join(" \\\n  ");
}

export function formatDockerRunSnippet(settings: TuneSetting[]): string {
  const args = formatDockerArgs(settings);
  return `docker run -d --name mysql \\
  -e MYSQL_ROOT_PASSWORD=secret \\
  mysql:8.4 \\
  ${args}`;
}

export function formatComposeYaml(settings: TuneSetting[]): string {
  const cmd = [
    "mysqld",
    ...settings.flatMap((s) => [
      `--${s.key.replace(/_/g, "-")}=${formatSettingValue(s)}`,
    ]),
  ];
  const cmdYaml = cmd.map((c) => `      - ${yamlQuote(c)}`).join("\n");
  return `# docker compose — mysql with mytune flags
services:
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: secret
    ports:
      - "3306:3306"
    command:
${cmdYaml}
`;
}

export function formatHelmYaml(settings: TuneSetting[]): string {
  const lines = [
    "# Helm values fragment — merge under primary.configuration / my.cnf style map",
    "primary:",
    "  configuration: |",
    "    [mysqld]",
  ];
  for (const s of settings) {
    lines.push(`    ${s.key}=${formatSettingValue(s)}`);
  }
  return lines.join("\n");
}

export function filterManaged(
  settings: TuneSetting[],
  target: ManagedTarget,
): {
  settings: TuneSetting[];
  skipped: Array<{ key: string; reasonId: string }>;
  noteId: string;
} {
  if (target === "selfhosted") {
    return {
      settings,
      skipped: [],
      noteId: "managedNoteSelf",
    };
  }
  const blocked = MANAGED_BLOCKED[target];
  const kept: TuneSetting[] = [];
  const skipped: Array<{ key: string; reasonId: string }> = [];
  for (const s of settings) {
    if (blocked.has(s.key)) {
      skipped.push({ key: s.key, reasonId: "managedSkipPlatform" });
    } else {
      kept.push(s);
    }
  }
  return {
    settings: kept,
    skipped,
    noteId: `managedNote_${target}`,
  };
}

export function buildExports(
  settings: TuneSetting[],
  confText: string,
  target: ManagedTarget,
): ExportBundle {
  const managed = filterManaged(settings, target);
  return {
    conf: confText,
    alterSystem: formatAlterSystem(managed.settings),
    dockerArgs: formatDockerArgs(managed.settings),
    dockerRunSnippet: formatDockerRunSnippet(managed.settings),
    composeYaml: formatComposeYaml(managed.settings),
    helmYaml: formatHelmYaml(managed.settings),
    migrateSql: formatMigrationSql(managed.settings),
    orchestratorYaml: formatOrchestratorYaml(managed.settings),
    ansibleYaml: formatAnsibleYaml(managed.settings),
    managedNoteId: managed.noteId,
    managedSkipped: managed.skipped,
    managedSettings: managed.settings,
  };
}
