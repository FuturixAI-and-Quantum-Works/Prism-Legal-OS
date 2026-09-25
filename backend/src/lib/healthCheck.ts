import { db } from "../db/index.js";
import { serviceHealthChecks } from "../db/schema/index.js";
import { desc, gte, sql, and, eq } from "drizzle-orm";
import { getEmailConfigHealth } from "./email.js";

type HealthStatus = "operational" | "degraded" | "down";
let apiHealthUrl = "http://localhost:3001/health";

export function configureHealthChecks(url: string): void {
  apiHealthUrl = url;
}

interface ServiceDefinition {
  name: string;
  displayName: string;
  checkFn: () => Promise<{ status: HealthStatus; responseTimeMs: number; error?: string }>;
}

const SERVICES: ServiceDefinition[] = [
  {
    name: "api-core",
    displayName: "API Core",
    checkFn: async () => {
      const start = Date.now();
      try {
        const response = await fetch(apiHealthUrl);
        const responseTimeMs = Date.now() - start;
        if (response.ok) {
          return { status: responseTimeMs > 5000 ? "degraded" : "operational", responseTimeMs };
        }
        return { status: "down", responseTimeMs, error: `HTTP ${response.status}` };
      } catch (err) {
        return { status: "down", responseTimeMs: Date.now() - start, error: String(err) };
      }
    },
  },
  {
    name: "email",
    displayName: "Email Service",
    checkFn: async () => {
      const start = Date.now();
      try {
        const health = await getEmailConfigHealth();
        const responseTimeMs = Date.now() - start;
        switch (health.status) {
          case "configured":
            return {
              status: "degraded",
              responseTimeMs,
              error: "Mail provider is configured but was not probed",
            };
          case "suppressed":
            return { status: "degraded", responseTimeMs, error: "Mail delivery is suppressed" };
          default: {
            const unsupported: never = health.status;
            throw new Error(`Unsupported mail health status: ${String(unsupported)}`);
          }
        }
      } catch (err) {
        return { status: "down", responseTimeMs: Date.now() - start, error: String(err) };
      }
    },
  },
  {
    name: "database",
    displayName: "Database",
    checkFn: async () => {
      const start = Date.now();
      try {
        await db.execute(sql`SELECT 1`);
        const responseTimeMs = Date.now() - start;
        return { status: responseTimeMs > 5000 ? "degraded" : "operational", responseTimeMs };
      } catch (err) {
        return { status: "down", responseTimeMs: Date.now() - start, error: String(err) };
      }
    },
  },
];

export async function checkServiceHealth(service: ServiceDefinition): Promise<{
  serviceName: string;
  status: HealthStatus;
  responseTimeMs: number;
  error?: string;
}> {
  const result = await service.checkFn();
  return {
    serviceName: service.name,
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    error: result.error,
  };
}

export async function runAllHealthChecks(): Promise<void> {
  console.log("[health-check] Running health checks for all services...");

  for (const service of SERVICES) {
    try {
      const result = await checkServiceHealth(service);
      await db.insert(serviceHealthChecks).values({
        serviceName: result.serviceName,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        errorMessage: result.error ?? null,
      });
      console.log(`[health-check] ${service.name}: ${result.status} (${result.responseTimeMs}ms)`);
    } catch (err) {
      console.error(`[health-check] Failed to check ${service.name}:`, err);
      await db.insert(serviceHealthChecks).values({
        serviceName: service.name,
        status: "down",
        responseTimeMs: 0,
        errorMessage: String(err),
      });
    }
  }

  console.log("[health-check] Health checks completed");
}

export async function getLatestServiceStatus(): Promise<{
  status: HealthStatus;
  message: string;
  lastUpdated: string | null;
  services: Array<{
    name: string;
    displayName: string;
    status: HealthStatus;
    responseTimeMs: number | null;
  }>;
}> {
  const services: Array<{
    name: string;
    displayName: string;
    status: HealthStatus;
    responseTimeMs: number | null;
  }> = [];

  let lastUpdated: Date | null = null;

  for (const service of SERVICES) {
    const [latest] = await db
      .select()
      .from(serviceHealthChecks)
      .where(eq(serviceHealthChecks.serviceName, service.name))
      .orderBy(desc(serviceHealthChecks.checkedAt))
      .limit(1);

    if (latest) {
      services.push({
        name: service.name,
        displayName: service.displayName,
        status: latest.status,
        responseTimeMs: latest.responseTimeMs,
      });
      if (!lastUpdated || latest.checkedAt > lastUpdated) {
        lastUpdated = latest.checkedAt;
      }
    } else {
      services.push({
        name: service.name,
        displayName: service.displayName,
        status: "down",
        responseTimeMs: null,
      });
    }
  }

  const hasDown = services.some((s) => s.status === "down");
  const hasDegraded = services.some((s) => s.status === "degraded");

  let overallStatus: HealthStatus = "operational";
  let message = "All Systems Operational";

  if (hasDown) {
    overallStatus = "down";
    message = "Major System Outage";
  } else if (hasDegraded) {
    overallStatus = "degraded";
    message = "Partial System Degradation";
  }

  return {
    status: overallStatus,
    message,
    lastUpdated: lastUpdated?.toISOString() ?? null,
    services,
  };
}

interface DailyStatus {
  date: string;
  status: HealthStatus | "no_data";
}

export function calculateUptimePercentage(
  statuses: readonly DailyStatus["status"][],
): number | null {
  let operationalDays = 0;
  let degradedDays = 0;
  let observedDays = 0;
  for (const status of statuses) {
    if (status === "no_data") continue;
    observedDays += 1;
    if (status === "operational") operationalDays += 1;
    if (status === "degraded") degradedDays += 1;
  }
  if (observedDays === 0) return null;
  return Math.round(((operationalDays + degradedDays * 0.5) / observedDays) * 10000) / 100;
}

export async function getServiceHistory(days: number = 90): Promise<{
  services: Array<{
    name: string;
    displayName: string;
    uptimePercentage: number | null;
    history: DailyStatus[];
  }>;
}> {
  const result: Array<{
    name: string;
    displayName: string;
    uptimePercentage: number | null;
    history: DailyStatus[];
  }> = [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  for (const service of SERVICES) {
    const checks = await db
      .select()
      .from(serviceHealthChecks)
      .where(
        and(
          eq(serviceHealthChecks.serviceName, service.name),
          gte(serviceHealthChecks.checkedAt, startDate),
        ),
      )
      .orderBy(desc(serviceHealthChecks.checkedAt));

    const dailyMap = new Map<string, HealthStatus>();

    for (const check of checks) {
      const dateKey = check.checkedAt.toISOString().split("T")[0];
      const existing = dailyMap.get(dateKey);
      if (!existing || getStatusPriority(check.status) > getStatusPriority(existing)) {
        dailyMap.set(dateKey, check.status);
      }
    }

    const history: DailyStatus[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split("T")[0];
      const status = dailyMap.get(dateKey) ?? "no_data";

      history.push({ date: dateKey, status });
    }

    const uptimePercentage = calculateUptimePercentage(history.map(({ status }) => status));

    result.push({
      name: service.name,
      displayName: service.displayName,
      uptimePercentage,
      history,
    });
  }

  return { services: result };
}

function getStatusPriority(status: HealthStatus): number {
  switch (status) {
    case "down":
      return 2;
    case "degraded":
      return 1;
    case "operational":
      return 0;
  }
}

export async function cleanupOldHealthChecks(retentionDays: number = 120): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await db
    .delete(serviceHealthChecks)
    .where(sql`${serviceHealthChecks.checkedAt} < ${cutoffDate}`);

  return result.rowCount ?? 0;
}

export function getServiceDefinitions() {
  return SERVICES.map((s) => ({ name: s.name, displayName: s.displayName }));
}
