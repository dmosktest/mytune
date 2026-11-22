import { valuesEqual, type ParsedConf } from "./parse-conf";
import {
  formatSettingValue,
  type TuneSetting,
} from "./tune";

export type DiffKind = "same" | "changed" | "missing" | "extra";

export type DiffRow = {
  key: string;
  kind: DiffKind;
  current: string | null;
  recommended: string | null;
  restart?: boolean;
};

export type DiffRisk = {
  id: string;
  params?: Record<string, string | number>;
};

export type ConfDiffResult = {
  rows: DiffRow[];
  summary: { same: number; changed: number; missing: number; extra: number };
  risks: DiffRisk[];
};

export function diffAgainstRecommended(
  current: ParsedConf,
  recommended: TuneSetting[],
): ConfDiffResult {
  const rows: DiffRow[] = [];
  const recommendedKeys = new Set(recommended.map((s) => s.key));

  for (const setting of recommended) {
    const rec = formatSettingValue(setting);
    const cur = current[setting.key] ?? null;
    if (cur === null) {
      rows.push({
        key: setting.key,
        kind: "missing",
        current: null,
        recommended: rec,
        restart: setting.restart,
      });
      continue;
    }
    const same = valuesEqual(cur, rec, { isMemory: setting.isMemory });
    rows.push({
      key: setting.key,
      kind: same ? "same" : "changed",
      current: cur,
      recommended: rec,
      restart: setting.restart,
    });
  }

  for (const [key, value] of Object.entries(current)) {
    if (recommendedKeys.has(key)) continue;
    if (
      key.startsWith("log_") ||
      key.startsWith("ssl_") ||
      key.includes("password") ||
      key === "listen_addresses" ||
      key === "port" ||
      key === "data_directory"
    ) {
      continue;
    }
    rows.push({
      key,
      kind: "extra",
      current: value,
      recommended: null,
    });
  }

  const summary = {
    same: rows.filter((r) => r.kind === "same").length,
    changed: rows.filter((r) => r.kind === "changed").length,
    missing: rows.filter((r) => r.kind === "missing").length,
    extra: rows.filter((r) => r.kind === "extra").length,
  };

  const risks: DiffRisk[] = [];
  const maxConn = current.max_connections;
  if (maxConn && Number(maxConn) >= 500) {
    risks.push({ id: "riskHighConnections", params: { n: maxConn } });
  }
  const hasInnoRelated = Object.keys(current).some((k) => k.startsWith("innodb_"));
  if (hasInnoRelated && !current.innodb_buffer_pool_size) {
    risks.push({ id: "riskMissingBufferPool" });
  }
  const changedRestart = rows.filter((r) => r.kind === "changed" && r.restart);
  if (changedRestart.length > 0) {
    risks.push({
      id: "riskRestartNeeded",
      params: { n: changedRestart.length },
    });
  }
  if (summary.missing + summary.changed === 0 && summary.same > 0) {
    risks.push({ id: "riskAlreadyClose" });
  }

  return { rows, summary, risks };
}
