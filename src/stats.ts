import type { DbSize, DbType, DbVersion, HdType, TuneInput } from "./tune";

export const STATS_COLLECT_SQL = `-- Run as a privileged MySQL/MariaDB account.
-- Paste the full result back into mytune. Nothing is uploaded.
-- Optional: also paste OS lines from collect.sh (os_mem_available_mb, os_iops_…).

SELECT 'buffer_pool_hit_ratio' AS metric,
       ROUND(
         (1 - (Innodb_buffer_pool_reads / NULLIF(Innodb_buffer_pool_read_requests, 0))) * 100,
         2
       ) AS value
FROM (
  SELECT
    MAX(CASE WHEN Variable_name = 'Innodb_buffer_pool_reads' THEN Variable_value END) + 0 AS Innodb_buffer_pool_reads,
    MAX(CASE WHEN Variable_name = 'Innodb_buffer_pool_read_requests' THEN Variable_value END) + 0 AS Innodb_buffer_pool_read_requests
  FROM performance_schema.global_status
  WHERE Variable_name IN ('Innodb_buffer_pool_reads', 'Innodb_buffer_pool_read_requests')
) s
UNION ALL
SELECT 'threads_connected', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Threads_connected'
UNION ALL
SELECT 'threads_running', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Threads_running'
UNION ALL
SELECT 'max_used_connections', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Max_used_connections'
UNION ALL
SELECT 'aborted_connects', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Aborted_connects'
UNION ALL
SELECT 'aborted_clients', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Aborted_clients'
UNION ALL
SELECT 'created_tmp_disk_tables', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Created_tmp_disk_tables'
UNION ALL
SELECT 'created_tmp_tables', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Created_tmp_tables'
UNION ALL
SELECT 'innodb_log_waits', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Innodb_log_waits'
UNION ALL
SELECT 'innodb_buffer_pool_wait_free', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Innodb_buffer_pool_wait_free'
UNION ALL
SELECT 'innodb_buffer_pool_pages_flushed', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Innodb_buffer_pool_pages_flushed'
UNION ALL
SELECT 'slow_queries', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Slow_queries'
UNION ALL
SELECT 'questions', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Questions'
UNION ALL
SELECT 'connections', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Connections'
UNION ALL
SELECT 'com_select', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Com_select'
UNION ALL
SELECT 'com_insert', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Com_insert'
UNION ALL
SELECT 'com_update', Variable_value
FROM performance_schema.global_status WHERE Variable_name = 'Com_update'
UNION ALL
SELECT 'max_connections', @@max_connections
UNION ALL
SELECT 'innodb_buffer_pool_size', @@innodb_buffer_pool_size
UNION ALL
SELECT 'version', @@version;
`;

export type StatsMetrics = Record<string, string>;

export type StatsHint = {
  id: string;
  params?: Record<string, string | number>;
};

export type HealthSeverity = "ok" | "warn" | "crit";

export type HealthFinding = {
  id: string;
  severity: HealthSeverity;
  params?: Record<string, string | number>;
};

export type HealthReport = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  findings: HealthFinding[];
};

export type StatsCompareDirection = "better" | "worse" | "same" | "unknown";

export type StatsCompareRow = {
  id: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  direction: StatsCompareDirection;
  unit: "ratio" | "count" | "pct";
};

export type StatsCompareReport = {
  rows: StatsCompareRow[];
  improved: number;
  worsened: number;
};

export type StatsAnalysis = {
  metrics: StatsMetrics;
  hints: StatsHint[];
  patch: Partial<TuneInput>;
  health: HealthReport;
};

function num(metrics: StatsMetrics, key: string): number | null {
  const v = Number(metrics[key]);
  return Number.isFinite(v) ? v : null;
}

function ratio01(hit: number): number {
  return hit > 1 ? hit / 100 : hit;
}

export function parseMetricMap(text: string): StatsMetrics {
  const out: StatsMetrics = {};
  const lines = text.trim().split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[-+|]+$/.test(line) || /^metric\b/i.test(line)) continue;
    if (/^#/.test(line)) continue;
    if (line.includes("|")) {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2 && parts[0] && parts[1] !== "") {
        out[parts[0].toLowerCase()] = parts[1];
      }
      continue;
    }
    const m = line.match(/^([a-z0-9_]+)\s*[:=\t]\s*(.+)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

function detectVersion(raw: string | undefined): DbVersion | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("mariadb")) {
    if (/\b11\.4\b/.test(v) || /\b11\./.test(v)) return "mariadb-11.4";
    return "mariadb-10.11";
  }
  if (/\b9\./.test(v)) return "mysql-9.0";
  if (/\b8\.4\b/.test(v)) return "mysql-8.4";
  if (/\b8\.0\b/.test(v) || /\b8\./.test(v)) return "mysql-8.0";
  return undefined;
}

function gradeFromScore(score: number): HealthReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function computeHealthScore(metrics: StatsMetrics): HealthReport {
  let score = 100;
  const findings: HealthFinding[] = [];

  const hitRaw = num(metrics, "buffer_pool_hit_ratio");
  if (hitRaw !== null) {
    const hit = ratio01(hitRaw);
    if (hit < 0.9) {
      score -= 25;
      findings.push({
        id: "healthHitCrit",
        severity: "crit",
        params: { hit: hit.toFixed(3), pct: (hit * 100).toFixed(1) },
      });
    } else if (hit < 0.99) {
      score -= 10;
      findings.push({
        id: "healthHitWarn",
        severity: "warn",
        params: { hit: hit.toFixed(3), pct: (hit * 100).toFixed(1) },
      });
    } else {
      findings.push({
        id: "healthHitOk",
        severity: "ok",
        params: { hit: hit.toFixed(3), pct: (hit * 100).toFixed(1) },
      });
    }
  }

  const tmpDisk = num(metrics, "created_tmp_disk_tables");
  const tmpAll = num(metrics, "created_tmp_tables");
  if (tmpDisk !== null && tmpAll !== null && tmpAll > 0) {
    const share = tmpDisk / tmpAll;
    if (share > 0.25 || tmpDisk > 1000) {
      score -= 20;
      findings.push({
        id: "healthTmpDiskCrit",
        severity: "crit",
        params: { files: tmpDisk, pct: (share * 100).toFixed(1) },
      });
    } else if (share > 0.1 || tmpDisk > 100) {
      score -= 10;
      findings.push({
        id: "healthTmpDiskWarn",
        severity: "warn",
        params: { files: tmpDisk, pct: (share * 100).toFixed(1) },
      });
    } else {
      findings.push({
        id: "healthTmpDiskOk",
        severity: "ok",
        params: { files: tmpDisk, pct: (share * 100).toFixed(1) },
      });
    }
  } else if (tmpDisk !== null && tmpDisk > 100) {
    score -= 10;
    findings.push({
      id: "healthTmpDiskWarn",
      severity: "warn",
      params: { files: tmpDisk, pct: "?" },
    });
  }

  const slow = num(metrics, "slow_queries");
  const questions = num(metrics, "questions");
  if (slow !== null && questions !== null && questions > 0) {
    const share = slow / questions;
    if (share > 0.01) {
      score -= 15;
      findings.push({
        id: "healthSlowCrit",
        severity: "crit",
        params: { slow, questions, pct: (share * 100).toFixed(2) },
      });
    } else if (share > 0.001) {
      score -= 5;
      findings.push({
        id: "healthSlowWarn",
        severity: "warn",
        params: { slow, questions, pct: (share * 100).toFixed(2) },
      });
    } else {
      findings.push({
        id: "healthSlowOk",
        severity: "ok",
        params: { slow, questions, pct: (share * 100).toFixed(2) },
      });
    }
  }

  const aborted = num(metrics, "aborted_connects");
  const connections = num(metrics, "connections");
  if (aborted !== null && connections !== null && connections > 0) {
    const share = aborted / connections;
    if (share > 0.05 || aborted > 1000) {
      score -= 15;
      findings.push({
        id: "healthAbortedCrit",
        severity: "crit",
        params: { aborted, connections, pct: (share * 100).toFixed(2) },
      });
    } else if (share > 0.01 || aborted > 100) {
      score -= 7;
      findings.push({
        id: "healthAbortedWarn",
        severity: "warn",
        params: { aborted, connections, pct: (share * 100).toFixed(2) },
      });
    } else {
      findings.push({
        id: "healthAbortedOk",
        severity: "ok",
        params: { aborted, connections, pct: (share * 100).toFixed(2) },
      });
    }
  }

  const maxUsed = num(metrics, "max_used_connections");
  const maxConn = num(metrics, "max_connections");
  if (maxUsed !== null && maxConn !== null && maxConn > 0) {
    const share = maxUsed / maxConn;
    if (share > 0.9) {
      score -= 12;
      findings.push({
        id: "healthConnCrit",
        severity: "crit",
        params: { used: maxUsed, max: maxConn, pct: (share * 100).toFixed(0) },
      });
    } else if (share > 0.8) {
      score -= 6;
      findings.push({
        id: "healthConnWarn",
        severity: "warn",
        params: { used: maxUsed, max: maxConn, pct: (share * 100).toFixed(0) },
      });
    } else {
      findings.push({
        id: "healthConnOk",
        severity: "ok",
        params: { used: maxUsed, max: maxConn, pct: (share * 100).toFixed(0) },
      });
    }
  }

  const logWaits = num(metrics, "innodb_log_waits");
  if (logWaits !== null && logWaits > 0) {
    score -= logWaits > 10 ? 12 : 6;
    findings.push({
      id: "healthLogWaits",
      severity: logWaits > 10 ? "crit" : "warn",
      params: { waits: logWaits },
    });
  }

  const waitFree = num(metrics, "innodb_buffer_pool_wait_free");
  const flushed = num(metrics, "innodb_buffer_pool_pages_flushed");
  if (waitFree !== null && flushed !== null && flushed > 0) {
    const pct = (waitFree / flushed) * 100;
    if (pct > 5) {
      score -= 10;
      findings.push({
        id: "healthPageCleaner",
        severity: "warn",
        params: { pct: pct.toFixed(1) },
      });
    }
  }

  const swapUsed = num(metrics, "os_swap_used_mb");
  if (swapUsed !== null && swapUsed > 64) {
    score -= swapUsed > 512 ? 15 : 8;
    findings.push({
      id: "healthSwapPressure",
      severity: swapUsed > 512 ? "crit" : "warn",
      params: { mb: Math.round(swapUsed) },
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (findings.length === 0) {
    findings.push({ id: "healthNoData", severity: "ok" });
  }
  return { score, grade: gradeFromScore(score), findings };
}

function derivedRatio(
  metrics: StatsMetrics,
  numKey: string,
  denKey: string,
): number | null {
  const a = num(metrics, numKey);
  const b = num(metrics, denKey);
  if (a === null || b === null || b <= 0) return null;
  return a / b;
}

export function compareStatsSnapshots(
  beforeText: string,
  afterText: string,
): StatsCompareReport | null {
  const before = parseMetricMap(beforeText);
  const after = parseMetricMap(afterText);
  if (Object.keys(before).length < 2 || Object.keys(after).length < 2) return null;

  const specs: Array<{
    id: string;
    unit: StatsCompareRow["unit"];
    higherIsBetter: boolean;
    read: (m: StatsMetrics) => number | null;
  }> = [
    {
      id: "cmpHitRatio",
      unit: "ratio",
      higherIsBetter: true,
      read: (m) => {
        const v = num(m, "buffer_pool_hit_ratio");
        return v === null ? null : ratio01(v);
      },
    },
    {
      id: "cmpTmpDiskShare",
      unit: "pct",
      higherIsBetter: false,
      read: (m) => {
        const r = derivedRatio(m, "created_tmp_disk_tables", "created_tmp_tables");
        return r === null ? null : r * 100;
      },
    },
    {
      id: "cmpSlowShare",
      unit: "pct",
      higherIsBetter: false,
      read: (m) => {
        const r = derivedRatio(m, "slow_queries", "questions");
        return r === null ? null : r * 100;
      },
    },
    {
      id: "cmpLogWaits",
      unit: "count",
      higherIsBetter: false,
      read: (m) => num(m, "innodb_log_waits"),
    },
    {
      id: "cmpAbortedShare",
      unit: "pct",
      higherIsBetter: false,
      read: (m) => {
        const r = derivedRatio(m, "aborted_connects", "connections");
        return r === null ? null : r * 100;
      },
    },
    {
      id: "cmpMaxUsedConn",
      unit: "count",
      higherIsBetter: false,
      read: (m) => num(m, "max_used_connections"),
    },
    {
      id: "cmpHealthScore",
      unit: "count",
      higherIsBetter: true,
      read: (m) => computeHealthScore(m).score,
    },
  ];

  const rows: StatsCompareRow[] = [];
  let improved = 0;
  let worsened = 0;
  for (const spec of specs) {
    const b = spec.read(before);
    const a = spec.read(after);
    let delta: number | null = null;
    let direction: StatsCompareDirection = "unknown";
    if (b !== null && a !== null) {
      delta = a - b;
      const eps = spec.unit === "ratio" ? 0.0005 : spec.unit === "pct" ? 0.05 : 0.5;
      if (Math.abs(delta) <= eps) direction = "same";
      else if (spec.higherIsBetter ? delta > 0 : delta < 0) {
        direction = "better";
        improved += 1;
      } else {
        direction = "worse";
        worsened += 1;
      }
    }
    rows.push({
      id: spec.id,
      before: b,
      after: a,
      delta,
      direction,
      unit: spec.unit,
    });
  }
  return { rows, improved, worsened };
}

function applyOsMetrics(
  metrics: StatsMetrics,
  hints: StatsHint[],
  patch: Partial<TuneInput>,
): void {
  const avail = num(metrics, "os_mem_available_mb");
  const total = num(metrics, "os_mem_total_mb");
  if (avail !== null && total !== null && total > 0) {
    const freeShare = avail / total;
    if (freeShare < 0.1) {
      hints.push({
        id: "statsHintMemTight",
        params: { avail: Math.round(avail), total: Math.round(total) },
      });
      patch.mysqlRamPercent = Math.min(patch.mysqlRamPercent ?? 85, 75);
      patch.dbSize = "less_ram" satisfies DbSize;
    } else if (freeShare > 0.35) {
      hints.push({
        id: "statsHintMemHeadroom",
        params: { avail: Math.round(avail), total: Math.round(total) },
      });
    }
  }

  const swapUsed = num(metrics, "os_swap_used_mb");
  if (swapUsed !== null && swapUsed > 64) {
    hints.push({
      id: "statsHintSwapPressure",
      params: { mb: Math.round(swapUsed) },
    });
    patch.mysqlRamPercent = Math.min(patch.mysqlRamPercent ?? 80, 70);
    patch.dbSize = "less_ram" satisfies DbSize;
  }

  const iops =
    num(metrics, "os_iops_est") ??
    num(metrics, "os_iops_read") ??
    num(metrics, "os_iops");
  if (iops !== null && iops > 0) {
    let hd: HdType;
    if (iops < 400) hd = "hdd";
    else if (iops < 3000) hd = "ssd";
    else if (iops < 8000) hd = "san";
    else hd = "nvme";
    patch.hdType = hd;
    hints.push({
      id: "statsHintIoCapacity",
      params: { iops: Math.round(iops), hd },
    });
  }
}

export function analyzeStatsPaste(text: string): StatsAnalysis | null {
  const metrics = parseMetricMap(text);
  if (Object.keys(metrics).length < 2) return null;

  const hints: StatsHint[] = [];
  const patch: Partial<TuneInput> = {};

  applyOsMetrics(metrics, hints, patch);

  const hit = Number(metrics.buffer_pool_hit_ratio);
  if (Number.isFinite(hit)) {
    const ratio = ratio01(hit);
    if (ratio >= 0.99) {
      patch.dbSize = "less_ram" satisfies DbSize;
      hints.push({
        id: "statsHintHighCache",
        params: { hit: ratio.toFixed(3) },
      });
    } else if (ratio < 0.9) {
      patch.dbSize = "greater_ram" satisfies DbSize;
      patch.bufferPoolScale = 1.15;
      hints.push({
        id: "statsHintLowCache",
        params: { hit: ratio.toFixed(3) },
      });
    } else {
      hints.push({
        id: "statsHintMidCache",
        params: { hit: ratio.toFixed(3) },
      });
    }
  }

  const tmpDisk = Number(metrics.created_tmp_disk_tables);
  const tmpAll = Number(metrics.created_tmp_tables);
  if (Number.isFinite(tmpDisk) && tmpDisk > 100) {
    patch.sortBufferScale = 1.3;
    hints.push({
      id: "statsHintTempFiles",
      params: { files: tmpDisk },
    });
    if (Number.isFinite(tmpAll) && tmpAll > 0 && tmpDisk / tmpAll > 0.25) {
      hints.push({ id: "statsHintTempFilesBoost" });
    }
  }

  const logWaits = Number(metrics.innodb_log_waits);
  if (Number.isFinite(logWaits) && logWaits > 0) {
    patch.redoLogScale = 1.5;
    hints.push({
      id: "statsHintWalBoost",
      params: { waits: logWaits },
    });
  }

  const waitFree = Number(metrics.innodb_buffer_pool_wait_free);
  const flushed = Number(metrics.innodb_buffer_pool_pages_flushed);
  if (
    Number.isFinite(waitFree) &&
    Number.isFinite(flushed) &&
    flushed > 0 &&
    waitFree / flushed > 0.05
  ) {
    hints.push({
      id: "statsHintBgwriterPressure",
      params: { pct: ((waitFree / flushed) * 100).toFixed(1) },
    });
  }

  const slow = Number(metrics.slow_queries);
  const questions = Number(metrics.questions);
  if (Number.isFinite(slow) && Number.isFinite(questions) && questions > 0) {
    if (slow / questions > 0.01) {
      hints.push({
        id: "statsHintSlowStatements",
        params: { slow, questions },
      });
    }
  }

  const aborted = Number(metrics.aborted_connects);
  const connections = Number(metrics.connections);
  if (Number.isFinite(aborted) && aborted > 100) {
    hints.push({
      id: "statsHintAbortedConnects",
      params: {
        aborted,
        pct:
          Number.isFinite(connections) && connections > 0
            ? ((aborted / connections) * 100).toFixed(2)
            : "?",
      },
    });
  }

  const selects = Number(metrics.com_select);
  const writes =
    Number(metrics.com_insert || 0) + Number(metrics.com_update || 0);
  if (Number.isFinite(selects) && Number.isFinite(writes) && selects + writes > 0) {
    const writeShare = writes / (selects + writes);
    if (writeShare > 0.45) {
      patch.dbType = "oltp" satisfies DbType;
      hints.push({ id: "statsHintPointHeavy" });
    } else if (writeShare < 0.1) {
      patch.dbType = "web" satisfies DbType;
      hints.push({ id: "statsHintSeqHeavy" });
    }
  }

  const maxUsed = Number(metrics.max_used_connections);
  const maxConn = Number(metrics.max_connections);
  if (Number.isFinite(maxUsed) && Number.isFinite(maxConn) && maxConn > 0) {
    if (maxUsed / maxConn > 0.8) {
      hints.push({
        id: "statsHintConnPressure",
        params: { used: maxUsed, max: maxConn },
      });
    } else {
      hints.push({
        id: "statsHintConnOk",
        params: { used: maxUsed, max: maxConn },
      });
    }
  }

  const version = detectVersion(metrics.version);
  if (version) {
    patch.dbVersion = version;
    hints.push({ id: "statsHintVersion", params: { version } });
  }

  if (hints.length === 0) {
    hints.push({ id: "statsHintParsedNoAction" });
  }

  return {
    metrics,
    hints,
    patch,
    health: computeHealthScore(metrics),
  };
}
