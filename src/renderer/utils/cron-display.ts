/** Convert cron expression to human-readable Chinese string */
export function cronToDisplay(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dom, month, dow] = parts;

  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  // Every N minutes
  if (minute.startsWith("*/") && hour === "*") {
    return `每${minute.slice(2)}分钟`;
  }
  // Every N hours
  if (minute !== "*" && hour.startsWith("*/")) {
    return `每${hour.slice(2)}小时`;
  }
  // Specific day of week
  if (dow !== "*" && dom === "*" && month === "*") {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    const dayStr = dow.split(",").map((d) => days[parseInt(d)] ?? d).join("、");
    return `每周${dayStr} ${time}`;
  }
  // Specific day of month
  if (dom !== "*" && dow === "*" && month === "*") {
    return `每月${dom}日 ${time}`;
  }
  // Every day at specific time
  if (dom === "*" && month === "*" && dow === "*" && hour !== "*" && minute !== "*") {
    return `每天 ${time}`;
  }
  // Fallback
  return cron;
}
