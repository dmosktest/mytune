export type DbVersion =
  | "mysql-8.0"
  | "mysql-8.4"
  | "mysql-9.0"
  | "mariadb-10.11"
  | "mariadb-11.4";
export type OsType = "linux" | "windows" | "mac";
export type DbType = "web" | "oltp" | "dw" | "desktop" | "mixed";
export type HdType = "ssd" | "hdd" | "san" | "nvme";
export type DbSize = "less_ram" | "mid_ram" | "greater_ram";
export type MemoryUnit = "MB" | "GB" | "TB";
export type ServerRole =
  | "standalone"
  | "primary"
  | "replica"
  | "primary_cdc"
  | "primary_pitr";

export type PoolerMode = "none" | "transaction" | "session";

export type TuneInput = {
  dbVersion: DbVersion;
  osType: OsType;
  dbType: DbType;
  totalMemory: number;
  totalMemoryUnit: MemoryUnit;
  /** Share of host RAM reserved for MySQL (50–100). */
  mysqlRamPercent: number;
  serverRole: ServerRole;
  /** Peak concurrent complex queries that may each allocate sort/join buffers. */
  peakComplexQueries: number;
  /** Connection pooler in front of MySQL. */
  poolerMode: PoolerMode;
  cpuNum: number | null;
  connectionNum: number | null;
  hdType: HdType;
  dbSize: DbSize;
  /** Optional scales from stats ingest (1 = unchanged). */
  sortBufferScale?: number;
  redoLogScale?: number;
  bufferPoolScale?: number;
};

export type MemoryBudget = {
  hostRamKb: number;
  mysqlRamKb: number;
  bufferPoolKb: number;
  tmpTablesKb: number;
  connectionsWorkMemKb: number;
  osCacheKb: number;
  peakRisk: boolean;
  peakFactor: number;
};

export type SettingValue = string | number;

export type TuneSetting = {
  key: string;
  value: SettingValue;
  isMemory?: boolean;
  restart?: boolean;
};

export type WarningLevel = "startup" | "memory" | "note";

export type TuneWarning = {
  level: WarningLevel;
  id: string;
  params?: Record<string, string | number>;
  code?: string;
};

export type TuneResult = {
  settings: TuneSetting[];
  warnings: TuneWarning[];
  assumedConnections: number;
  confText: string;
  budget: MemoryBudget;
  hugePagesSysctl: string | null;
};

const KB = 1024;
const MB = 1048576;
const GB = 1073741824;
const TB = 1099511627776;

const UNIT_BYTES: Record<MemoryUnit, number> = { MB, GB, TB };

const MIN_SORT_BUFFER_KB = (256 * KB) / KB;
const DEFAULT_CONNECTIONS = 150;

const RESTART_KEYS = new Set([
  "innodb_buffer_pool_size",
  "innodb_buffer_pool_instances",
  "innodb_log_file_size",
  "innodb_redo_log_capacity",
  "innodb_flush_method",
  "innodb_read_io_threads",
  "innodb_write_io_threads",
  "thread_cache_size",
  "table_open_cache",
  "max_connections",
]);

const MYSQL_DOC: Record<string, string> = {
  max_connections:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_max_connections",
  innodb_buffer_pool_size:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_buffer_pool_size",
  innodb_buffer_pool_instances:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_buffer_pool_instances",
  innodb_log_file_size:
    "https://dev.mysql.com/doc/refman/8.0/en/innodb-parameters.html#sysvar_innodb_log_file_size",
  innodb_redo_log_capacity:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_redo_log_capacity",
  innodb_flush_log_at_trx_commit:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_flush_log_at_trx_commit",
  innodb_flush_method:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_flush_method",
  innodb_io_capacity:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_io_capacity",
  innodb_io_capacity_max:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_io_capacity_max",
  innodb_read_io_threads:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_read_io_threads",
  innodb_write_io_threads:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_write_io_threads",
  innodb_purge_threads:
    "https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_purge_threads",
  tmp_table_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_tmp_table_size",
  max_heap_table_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_max_heap_table_size",
  sort_buffer_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_sort_buffer_size",
  join_buffer_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_join_buffer_size",
  read_rnd_buffer_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_read_rnd_buffer_size",
  table_open_cache:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_table_open_cache",
  table_definition_cache:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_table_definition_cache",
  thread_cache_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_thread_cache_size",
  key_buffer_size:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_key_buffer_size",
  sync_binlog:
    "https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html#sysvar_sync_binlog",
  binlog_expire_logs_seconds:
    "https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html#sysvar_binlog_expire_logs_seconds",
  binlog_cache_size:
    "https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html#sysvar_binlog_cache_size",
  max_binlog_size:
    "https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html#sysvar_max_binlog_size",
  read_only:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_read_only",
  super_read_only:
    "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_super_read_only",
};

export const DB_VERSIONS: DbVersion[] = [
  "mysql-9.0",
  "mysql-8.4",
  "mysql-8.0",
  "mariadb-11.4",
  "mariadb-10.11",
];

export const DEFAULT_INPUT: TuneInput = {
  dbVersion: "mysql-8.4",
  osType: "linux",
  dbType: "web",
  totalMemory: 16,
  totalMemoryUnit: "GB",
  mysqlRamPercent: 100,
  serverRole: "standalone",
  peakComplexQueries: 2,
  poolerMode: "none",
  cpuNum: 8,
  connectionNum: null,
  hdType: "ssd",
  dbSize: "mid_ram",
};

export function isMariaDb(version: DbVersion): boolean {
  return version.startsWith("mariadb-");
}

export function usesRedoLogCapacity(version: DbVersion): boolean {
  return version === "mysql-8.4" || version === "mysql-9.0";
}

export function settingDocsUrl(_dbVersion: DbVersion, key: string): string {
  return (
    MYSQL_DOC[key] ??
    `https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_${key}`
  );
}

export function clampMysqlRamPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(50, Math.round(value)));
}

export function clampPeakQueries(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(16, Math.max(1, Math.round(value)));
}

function roundDownToMb(valueKb: number): number {
  const mbInKb = MB / KB;
  return Math.floor(valueKb / mbInKb) * mbInKb;
}

function roundToPowerOfTwoMb(valueKb: number): number {
  const mb = Math.max(1, Math.floor(valueKb / (MB / KB)));
  let p = 1;
  while (p * 2 <= mb) p *= 2;
  return p * (MB / KB);
}

export function formatMemoryKb(valueKb: number): string {
  if (valueKb >= GB / KB && valueKb % (GB / KB) === 0) {
    return `${valueKb / (GB / KB)}G`;
  }
  if (valueKb >= MB / KB && valueKb % (MB / KB) === 0) {
    return `${valueKb / (MB / KB)}M`;
  }
  return `${Math.round(valueKb)}K`;
}

export function formatSettingValue(setting: TuneSetting): string {
  if (setting.isMemory && typeof setting.value === "number") {
    return formatMemoryKb(setting.value);
  }
  return String(setting.value);
}

export function normalizeSettingDisplay(value: string | number): string {
  return String(value).trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}

export function formatConf(settings: TuneSetting[]): string {
  const lines = [
    "# mytune — suggested MySQL / MariaDB fragment",
    "# Review under real load before applying in production.",
    "",
    "[mysqld]",
  ];
  for (const s of settings) {
    const restart = s.restart ? "  # restart required" : "";
    lines.push(`${s.key} = ${formatSettingValue(s)}${restart}`);
  }
  return lines.join("\n");
}

export function tune(input: TuneInput): TuneResult {
  const hostMemoryBytes = input.totalMemory * UNIT_BYTES[input.totalMemoryUnit];
  const hostMemoryKb = hostMemoryBytes / KB;
  const mysqlRamPercent = clampMysqlRamPercent(input.mysqlRamPercent);
  const peakComplexQueries = clampPeakQueries(input.peakComplexQueries);
  const totalMemoryKb = Math.floor((hostMemoryKb * mysqlRamPercent) / 100);
  const totalMemoryBytes = totalMemoryKb * KB;
  const cpu = input.cpuNum && input.cpuNum > 0 ? input.cpuNum : 4;

  const bufferPoolShare = {
    web: 0.7,
    oltp: 0.75,
    dw: 0.65,
    desktop: 0.4,
    mixed: 0.7,
  }[input.dbType];

  let bufferPoolKb = roundDownToMb(Math.floor(totalMemoryKb * bufferPoolShare));
  const bufferPoolScale =
    input.bufferPoolScale && input.bufferPoolScale > 0
      ? input.bufferPoolScale
      : 1;
  if (bufferPoolScale !== 1) {
    bufferPoolKb = roundDownToMb(Math.floor(bufferPoolKb * bufferPoolScale));
  }
  if (bufferPoolKb < (128 * MB) / KB) bufferPoolKb = (128 * MB) / KB;

  let bufferPoolInstances = 1;
  if (bufferPoolKb >= (8 * GB) / KB) {
    bufferPoolInstances = Math.min(64, Math.max(8, cpu));
  } else if (bufferPoolKb >= GB / KB) {
    bufferPoolInstances = Math.min(8, Math.max(1, Math.floor(bufferPoolKb / ((GB / KB) * 1))));
  }

  let redoLogKb = roundToPowerOfTwoMb(
    {
      web: Math.floor(bufferPoolKb / 4),
      oltp: Math.floor(bufferPoolKb / 3),
      dw: Math.floor(bufferPoolKb / 2),
      desktop: Math.floor(bufferPoolKb / 8),
      mixed: Math.floor(bufferPoolKb / 4),
    }[input.dbType],
  );
  if (input.serverRole === "primary_pitr" || input.serverRole === "primary_cdc") {
    redoLogKb = Math.max(redoLogKb, (4 * GB) / KB);
  } else if (input.serverRole === "primary") {
    redoLogKb = Math.max(redoLogKb, (2 * GB) / KB);
  }
  const redoLogScale =
    input.redoLogScale && input.redoLogScale > 0 ? input.redoLogScale : 1;
  if (redoLogScale !== 1) {
    redoLogKb = roundToPowerOfTwoMb(Math.floor(redoLogKb * redoLogScale));
  }
  redoLogKb = Math.min(redoLogKb, (16 * GB) / KB);
  redoLogKb = Math.max(redoLogKb, (256 * MB) / KB);

  const flushLogAtTrxCommit =
    input.dbType === "desktop"
      ? 2
      : input.serverRole === "standalone" && input.dbType === "web"
        ? 1
        : 1;

  const flushMethod =
    input.osType === "windows" ? "unbuffered" : "O_DIRECT";

  const ioCapacity = {
    hdd: 200,
    ssd: 2000,
    san: 3000,
    nvme: 10000,
  }[input.hdType];
  const ioCapacityMax = Math.min(ioCapacity * 2, 40000);

  const readIoThreads = Math.min(64, Math.max(4, cpu));
  const writeIoThreads = Math.min(64, Math.max(4, cpu));
  const purgeThreads = Math.min(32, Math.max(1, Math.floor(cpu / 2)));

  let tmpTableKb = roundDownToMb(
    {
      web: Math.floor(totalMemoryKb / 64),
      oltp: Math.floor(totalMemoryKb / 64),
      dw: Math.floor(totalMemoryKb / 32),
      desktop: Math.floor(totalMemoryKb / 128),
      mixed: Math.floor(totalMemoryKb / 48),
    }[input.dbType],
  );
  if (tmpTableKb < (16 * MB) / KB) tmpTableKb = (16 * MB) / KB;
  if (tmpTableKb > (256 * MB) / KB) tmpTableKb = (256 * MB) / KB;

  const poolerMode = input.poolerMode ?? "none";
  let maxConnections: number;
  if (input.connectionNum) {
    maxConnections = input.connectionNum;
  } else if (poolerMode === "transaction") {
    maxConnections = Math.min(Math.max(cpu * 4, 20), 100);
  } else if (poolerMode === "session") {
    const sessionCap = Math.min(Math.max(cpu * 8, 40), 200);
    const byType = { web: 150, oltp: 200, dw: 80, desktop: 80, mixed: 100 }[
      input.dbType
    ];
    maxConnections = Math.min(sessionCap, byType);
  } else {
    const byType = { web: 200, oltp: 300, dw: 100, desktop: 100, mixed: 150 }[
      input.dbType
    ];
    maxConnections = Math.max(DEFAULT_CONNECTIONS, Math.min(byType, cpu * 25));
  }

  const perConnBudgetKb = Math.max(
    MIN_SORT_BUFFER_KB,
    Math.floor((totalMemoryKb - bufferPoolKb - tmpTableKb) / (maxConnections * 4)),
  );
  let sortBufferKb = {
    web: Math.floor(perConnBudgetKb),
    oltp: Math.floor(perConnBudgetKb),
    dw: Math.floor(perConnBudgetKb * 1.5),
    desktop: Math.floor(perConnBudgetKb / 2),
    mixed: Math.floor(perConnBudgetKb),
  }[input.dbType];
  if (input.dbSize === "less_ram") sortBufferKb = Math.floor(sortBufferKb * 1.2);
  else if (input.dbSize === "greater_ram") sortBufferKb = Math.floor(sortBufferKb * 0.85);
  if (poolerMode === "transaction") sortBufferKb = Math.floor(sortBufferKb * 1.25);
  const sortBufferScale =
    input.sortBufferScale && input.sortBufferScale > 0 ? input.sortBufferScale : 1;
  sortBufferKb = Math.floor(sortBufferKb * sortBufferScale);
  sortBufferKb = roundDownToMb(Math.max(MIN_SORT_BUFFER_KB, sortBufferKb));
  if (sortBufferKb > (16 * MB) / KB) sortBufferKb = (16 * MB) / KB;

  let joinBufferKb = Math.max((256 * KB) / KB, Math.floor(sortBufferKb / 2));
  if (joinBufferKb > (8 * MB) / KB) joinBufferKb = (8 * MB) / KB;
  let readRndBufferKb = Math.max((256 * KB) / KB, Math.floor(sortBufferKb / 2));
  if (readRndBufferKb > (4 * MB) / KB) readRndBufferKb = (4 * MB) / KB;

  const tableOpenCache = Math.min(
    8000,
    Math.max(400, maxConnections * 4 + (input.dbType === "dw" ? 1000 : 200)),
  );
  const tableDefinitionCache = Math.min(
    4000,
    Math.max(400, Math.floor(tableOpenCache / 2)),
  );
  const threadCacheSize = Math.min(100, Math.max(8, Math.floor(maxConnections / 2)));
  const keyBufferKb = (8 * MB) / KB;

  const binlogSettings: TuneSetting[] = [];
  if (input.serverRole === "standalone" && input.dbType === "desktop") {
    // keep defaults; no forced binlog
  } else if (input.serverRole !== "replica") {
    binlogSettings.push({ key: "sync_binlog", value: 1 });
    binlogSettings.push({
      key: "binlog_expire_logs_seconds",
      value:
        input.serverRole === "primary_pitr"
          ? 14 * 24 * 3600
          : input.serverRole === "primary_cdc"
            ? 7 * 24 * 3600
            : 3 * 24 * 3600,
    });
    binlogSettings.push({
      key: "binlog_cache_size",
      value: (2 * MB) / KB,
      isMemory: true,
    });
    binlogSettings.push({
      key: "max_binlog_size",
      value: GB / KB,
      isMemory: true,
    });
  }

  const roleSettings: TuneSetting[] = [];
  if (input.serverRole === "replica") {
    roleSettings.push({ key: "read_only", value: "ON" });
    roleSettings.push({ key: "super_read_only", value: "ON" });
  }

  const connectionsWorkMemKb =
    maxConnections * (sortBufferKb + joinBufferKb + readRndBufferKb) * peakComplexQueries;
  const reservedKb = bufferPoolKb + tmpTableKb + connectionsWorkMemKb;
  const osCacheKb = Math.max(0, totalMemoryKb - reservedKb);
  const peakRisk = reservedKb > totalMemoryKb * 0.9;
  const budget: MemoryBudget = {
    hostRamKb: hostMemoryKb,
    mysqlRamKb: totalMemoryKb,
    bufferPoolKb,
    tmpTablesKb: tmpTableKb,
    connectionsWorkMemKb,
    osCacheKb,
    peakRisk,
    peakFactor: peakComplexQueries,
  };

  const isHugePagesRecommended =
    input.osType === "linux" && bufferPoolKb >= (2 * GB) / KB;
  let hugePagesSysctl: string | null = null;
  if (isHugePagesRecommended) {
    const hugepageKb = 2048;
    const pages = Math.ceil((bufferPoolKb * 1.15) / hugepageKb);
    hugePagesSysctl = `vm.nr_hugepages = ${pages}`;
  }

  const warnings: TuneWarning[] = [];
  if (totalMemoryBytes < GB) {
    warnings.push({ level: "note", id: "warnLowMemory" });
  } else if (hostMemoryBytes > 100 * GB) {
    warnings.push({ level: "note", id: "warnHighMemory" });
  }
  if (mysqlRamPercent < 100) {
    warnings.push({
      level: "note",
      id: "warnMysqlRamHeadroom",
      params: { pct: mysqlRamPercent },
    });
  }
  if (perConnBudgetKb < MIN_SORT_BUFFER_KB) {
    warnings.push({
      level: "memory",
      id: "warnOomConnections",
      params: { connections: maxConnections, workers: 0 },
    });
  }
  if (peakRisk) {
    warnings.push({
      level: "memory",
      id: "warnPeakOom",
      params: { peak: peakComplexQueries, connections: maxConnections },
    });
  }
  if (isHugePagesRecommended) {
    warnings.push({
      level: "note",
      id: "warnHugePagesLinux",
      code: hugePagesSysctl
        ? `# /etc/sysctl.conf\n${hugePagesSysctl}\n# Also set large-pages=ON (or innodb_use_large_pages) if supported`
        : undefined,
    });
  }
  if (input.serverRole === "primary_cdc") {
    warnings.push({ level: "note", id: "warnRoleCdc" });
  }
  if (input.serverRole === "primary_pitr") {
    warnings.push({ level: "note", id: "warnRolePitr" });
  }
  if (input.serverRole === "replica") {
    warnings.push({ level: "note", id: "warnRoleReplica" });
  }
  if (poolerMode === "transaction") {
    warnings.push({
      level: "note",
      id: "warnPoolerTransaction",
      params: { connections: maxConnections },
    });
  } else if (poolerMode === "session") {
    warnings.push({
      level: "note",
      id: "warnPoolerSession",
      params: { connections: maxConnections },
    });
  }
  if (input.dbType === "dw" && input.hdType === "hdd") {
    warnings.push({
      level: "note",
      id: "warnDwCost",
      params: { drive: input.hdType },
    });
  }
  if (flushMethod === "O_DIRECT" && input.osType === "mac") {
    warnings.push({ level: "startup", id: "warnFlushMethodMac" });
  }

  const redoSetting: TuneSetting = usesRedoLogCapacity(input.dbVersion)
    ? {
        key: "innodb_redo_log_capacity",
        value: redoLogKb,
        isMemory: true,
        restart: true,
      }
    : {
        key: "innodb_log_file_size",
        value: Math.floor(redoLogKb / 2),
        isMemory: true,
        restart: true,
      };

  const raw: Array<{
    key: string;
    value: SettingValue | null;
    isMemory?: boolean;
  }> = [
    { key: "max_connections", value: maxConnections },
    { key: "innodb_buffer_pool_size", value: bufferPoolKb, isMemory: true },
    {
      key: "innodb_buffer_pool_instances",
      value: bufferPoolInstances > 1 ? bufferPoolInstances : null,
    },
    { key: redoSetting.key, value: redoSetting.value, isMemory: true },
    { key: "innodb_flush_log_at_trx_commit", value: flushLogAtTrxCommit },
    {
      key: "innodb_flush_method",
      value: input.osType === "mac" ? null : flushMethod,
    },
    { key: "innodb_io_capacity", value: ioCapacity },
    { key: "innodb_io_capacity_max", value: ioCapacityMax },
    { key: "innodb_read_io_threads", value: readIoThreads },
    { key: "innodb_write_io_threads", value: writeIoThreads },
    { key: "innodb_purge_threads", value: purgeThreads },
    { key: "tmp_table_size", value: tmpTableKb, isMemory: true },
    { key: "max_heap_table_size", value: tmpTableKb, isMemory: true },
    { key: "sort_buffer_size", value: sortBufferKb, isMemory: true },
    { key: "join_buffer_size", value: joinBufferKb, isMemory: true },
    { key: "read_rnd_buffer_size", value: readRndBufferKb, isMemory: true },
    { key: "table_open_cache", value: tableOpenCache },
    { key: "table_definition_cache", value: tableDefinitionCache },
    { key: "thread_cache_size", value: threadCacheSize },
    { key: "key_buffer_size", value: keyBufferKb, isMemory: true },
    ...binlogSettings,
    ...roleSettings,
  ];

  const settings: TuneSetting[] = raw
    .filter((s) => s.value !== null && s.value !== undefined)
    .map((s) => ({
      key: s.key,
      value: s.value as SettingValue,
      isMemory: s.isMemory,
      restart: RESTART_KEYS.has(s.key),
    }));

  return {
    settings,
    warnings,
    assumedConnections: maxConnections,
    confText: formatConf(settings),
    budget,
    hugePagesSysctl,
  };
}

export function settingExplanationKey(key: string): string {
  return `why_${key}`;
}
