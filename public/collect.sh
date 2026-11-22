#!/usr/bin/env bash
# mytune host collector — runs on YOUR machine only.
# Prints a mytune URL with query params + optional OS metrics for paste.
# Nothing is uploaded.
# Usage:
#   curl -fsSL https://mytune.dmosk.net/collect.sh | bash
#   curl -fsSL https://mytune.dmosk.net/collect.sh | bash -s -- ru
# Env: MYTUNE_ORIGIN (default https://mytune.dmosk.net), MYTUNE_LANG

set -euo pipefail

ORIGIN="${MYTUNE_ORIGIN:-https://mytune.dmosk.net}"
ORIGIN="${ORIGIN%/}"
LANG_CODE="${1:-${MYTUNE_LANG:-en}}"

os_type="linux"
uname_s="$(uname -s 2>/dev/null || echo unknown)"
case "$uname_s" in
  Darwin) os_type="mac" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) os_type="windows" ;;
  *) os_type="linux" ;;
esac

ram_gb=""
mem_total_mb=""
mem_avail_mb=""
swap_used_mb=""

if [ -r /proc/meminfo ]; then
  kb="$(awk '/MemTotal:/ {print $2; exit}' /proc/meminfo)"
  avail_kb="$(awk '/MemAvailable:/ {print $2; exit}' /proc/meminfo)"
  swap_total_kb="$(awk '/SwapTotal:/ {print $2; exit}' /proc/meminfo)"
  swap_free_kb="$(awk '/SwapFree:/ {print $2; exit}' /proc/meminfo)"
  if [ -n "${kb:-}" ]; then
    ram_gb=$(( (kb + 1048575) / 1048576 ))
    mem_total_mb=$(( (kb + 1023) / 1024 ))
  fi
  if [ -n "${avail_kb:-}" ]; then
    mem_avail_mb=$(( (avail_kb + 1023) / 1024 ))
  fi
  if [ -n "${swap_total_kb:-}" ] && [ -n "${swap_free_kb:-}" ]; then
    swap_used_mb=$(( (swap_total_kb - swap_free_kb + 1023) / 1024 ))
  fi
elif command -v sysctl >/dev/null 2>&1; then
  bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
  if [ -n "${bytes:-}" ]; then
    ram_gb=$(( (bytes + 1073741823) / 1073741824 ))
    mem_total_mb=$(( (bytes + 1048575) / 1048576 ))
  fi
fi
if [ -z "${ram_gb:-}" ] || [ "$ram_gb" -lt 1 ]; then
  ram_gb=16
fi

if command -v free >/dev/null 2>&1; then
  if [ -z "${mem_avail_mb:-}" ]; then
    mem_avail_mb="$(free -m 2>/dev/null | awk '/^Mem:/ {print $7; exit}')"
  fi
  if [ -z "${swap_used_mb:-}" ]; then
    swap_used_mb="$(free -m 2>/dev/null | awk '/^Swap:/ {print $3; exit}')"
  fi
fi

cpu=""
if command -v nproc >/dev/null 2>&1; then
  cpu="$(nproc 2>/dev/null || true)"
elif command -v sysctl >/dev/null 2>&1; then
  cpu="$(sysctl -n hw.ncpu 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || true)"
elif [ -r /proc/cpuinfo ]; then
  cpu="$(grep -c ^processor /proc/cpuinfo 2>/dev/null || true)"
fi
if [ -z "${cpu:-}" ] || [ "$cpu" -lt 1 ]; then
  cpu=""
fi

hd="ssd"
iops_est=""
if command -v lsblk >/dev/null 2>&1; then
  rota="$(lsblk -ndo ROTA 2>/dev/null | awk 'NR==1 {print $1}')"
  name="$(lsblk -ndo NAME 2>/dev/null | awk 'NR==1 {print $1}')"
  if [ "${rota:-1}" = "1" ]; then
    hd="hdd"
    iops_est=200
  elif echo "${name:-}" | grep -qi 'nvme'; then
    hd="nvme"
    iops_est=10000
  else
    hd="ssd"
    iops_est=2000
  fi
elif [ "$os_type" = "mac" ]; then
  hd="ssd"
  iops_est=2000
fi

if command -v iostat >/dev/null 2>&1; then
  # Best-effort sample; ignore failure.
  sample="$(iostat -dx 1 2 2>/dev/null | awk 'NF>=2 && $1 !~ /^(Device|Linux|avg-cpu)/ {r=$4; w=$5; if (r+w>max) max=r+w} END {if (max>0) printf "%.0f", max}')" || sample=""
  if [ -n "${sample:-}" ]; then
    iops_est="$sample"
    if [ "$iops_est" -lt 400 ] 2>/dev/null; then hd="hdd"
    elif [ "$iops_est" -lt 3000 ] 2>/dev/null; then hd="ssd"
    elif [ "$iops_est" -lt 8000 ] 2>/dev/null; then hd="san"
    else hd="nvme"
    fi
  fi
fi

map_version() {
  local raw="$1"
  raw="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  if echo "$raw" | grep -qi 'mariadb'; then
    local maj min
    maj="$(echo "$raw" | grep -oE '[0-9]+\.[0-9]+' | head -n1 | cut -d. -f1)"
    min="$(echo "$raw" | grep -oE '[0-9]+\.[0-9]+' | head -n1 | cut -d. -f2)"
    if [ "${maj:-}" = "11" ] && [ "${min:-0}" -ge 4 ]; then
      echo "mariadb-11.4"
    else
      echo "mariadb-10.11"
    fi
    return
  fi
  local ver
  ver="$(echo "$raw" | grep -oE '[0-9]+\.[0-9]+' | head -n1 || true)"
  case "$ver" in
    9.*|10.*) echo "mysql-9.0" ;;
    8.4*) echo "mysql-8.4" ;;
    8.*) echo "mysql-8.0" ;;
    *) echo "mysql-8.4" ;;
  esac
}

db_ver=""
ver_raw=""
if command -v mysql >/dev/null 2>&1; then
  ver_raw="$(mysql --version 2>/dev/null || true)"
elif command -v mariadb >/dev/null 2>&1; then
  ver_raw="$(mariadb --version 2>/dev/null || true)"
elif command -v mysqld >/dev/null 2>&1; then
  ver_raw="$(mysqld --version 2>/dev/null || true)"
fi
if [ -n "${ver_raw:-}" ]; then
  db_ver="$(map_version "$ver_raw")"
fi
if [ -z "${db_ver:-}" ]; then
  db_ver="mysql-8.4"
fi

myp=""
if [ -n "${mem_avail_mb:-}" ] && [ -n "${mem_total_mb:-}" ] && [ "$mem_total_mb" -gt 0 ]; then
  # Suggest MySQL RAM share from currently free headroom (rough).
  used_pct=$(( 100 - (mem_avail_mb * 100 / mem_total_mb) ))
  if [ "$used_pct" -gt 70 ]; then
    myp=70
  elif [ "$used_pct" -gt 40 ]; then
    myp=85
  fi
fi

qs="v=${db_ver}&os=${os_type}&ram=${ram_gb}&unit=GB&hd=${hd}&db=web"
if [ -n "${cpu:-}" ]; then
  qs="${qs}&cpu=${cpu}"
fi
if [ -n "${myp:-}" ]; then
  qs="${qs}&myp=${myp}"
fi

url="${ORIGIN}/${LANG_CODE}/?${qs}"

echo "mytune collector (local only — nothing uploaded)"
echo "  os=${os_type} ram=${ram_gb}GB cpu=${cpu:-?} hd=${hd} db=${db_ver}${myp:+ myp=${myp}%}"
if [ -n "${mem_avail_mb:-}" ] || [ -n "${iops_est:-}" ] || [ -n "${swap_used_mb:-}" ]; then
  echo "  mem_avail_mb=${mem_avail_mb:-?} swap_used_mb=${swap_used_mb:-?} iops_est=${iops_est:-?}"
fi
echo
echo "$url"
echo
echo "Open the link, review values, then press Generate."
echo
echo "# Optional: paste these OS lines into mytune → Real workload (with SHOW GLOBAL STATUS)"
if [ -n "${mem_total_mb:-}" ]; then
  echo "os_mem_total_mb: ${mem_total_mb}"
fi
if [ -n "${mem_avail_mb:-}" ]; then
  echo "os_mem_available_mb: ${mem_avail_mb}"
fi
if [ -n "${swap_used_mb:-}" ]; then
  echo "os_swap_used_mb: ${swap_used_mb}"
fi
if [ -n "${iops_est:-}" ]; then
  echo "os_iops_est: ${iops_est}"
fi
