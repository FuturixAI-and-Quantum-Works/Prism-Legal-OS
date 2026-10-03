import { Router } from "express";
import {
  getLatestServiceStatus,
  getServiceHistory,
  runAllHealthChecks,
  getServiceDefinitions,
} from "../lib/healthCheck.js";
import { requireAuth } from "../middleware/auth.js";
import { accessAuthority } from "../modules/access/access.composition.js";

export const statusRouter = Router();

/**
 * @swagger
 * /status:
 *   get:
 *     tags: [Status]
 *     summary: Get overall system status
 *     description: Returns the current health status of all monitored services
 *     security: []
 *     responses:
 *       200:
 *         description: System status
 */
statusRouter.get("/", async (_req, res) => {
  try {
    const status = await getLatestServiceStatus();
    res.json(status);
  } catch (err) {
    console.error("[status] Failed to get system status:", err);
    res.status(500).json({
      status: "down",
      message: "Unable to retrieve system status",
      lastUpdated: null,
      services: [],
    });
  }
});

/**
 * @swagger
 * /status/services:
 *   get:
 *     tags: [Status]
 *     summary: Get list of monitored services
 *     description: Returns the list of services being monitored
 *     security: []
 *     responses:
 *       200:
 *         description: List of services
 */
statusRouter.get("/services", (_req, res) => {
  const services = getServiceDefinitions();
  res.json({ services });
});

/**
 * @swagger
 * /status/history:
 *   get:
 *     tags: [Status]
 *     summary: Get 90-day status history
 *     description: Returns the health status history for all services over the past 90 days
 *     security: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 90
 *         description: Number of days of history to retrieve (max 90)
 *     responses:
 *       200:
 *         description: Status history
 */
statusRouter.get("/history", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 90, 90);
    const history = await getServiceHistory(days);
    res.json(history);
  } catch (err) {
    console.error("[status] Failed to get status history:", err);
    res.status(500).json({ services: [] });
  }
});

/**
 * @swagger
 * /status/check:
 *   post:
 *     tags: [Status]
 *     summary: Trigger immediate health check
 *     description: Triggers an immediate health check cycle (admin only)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Health check triggered
 *       403:
 *         description: Admin access required
 */
statusRouter.post("/check", requireAuth, async (_req, res) => {
  const userId = res.locals.auth.user.id;

  if (!(await accessAuthority.grants.isGlobalAdmin(userId))) {
    return void res.status(403).json({ detail: "Admin access required" });
  }

  try {
    await runAllHealthChecks();
    const status = await getLatestServiceStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    console.error("[status] Failed to run health checks:", err);
    res.status(500).json({ ok: false, error: "Failed to run health checks" });
  }
});
