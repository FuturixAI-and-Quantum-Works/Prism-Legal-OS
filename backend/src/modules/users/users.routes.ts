import { Router } from "express";
import { requireAuth, requireSession } from "../../middleware/auth.js";
import { createUsersController, type UsersControllerDependencies } from "./users.controller.js";

export function createUsersRouter(dependencies: UsersControllerDependencies): Router {
  const router = Router();
  const controller = createUsersController(dependencies);

  router.put("/onboarding", requireSession, controller.completeOnboarding);
  router.post("/profile", requireSession, controller.ensureProfile);
  router.get("/profile", requireSession, controller.getProfile);
  router.patch("/profile", requireAuth, controller.updateProfile);
  router.get("/ai/connections", requireAuth, controller.listConnections);
  router.post("/ai/connections", requireAuth, controller.createConnection);
  router.put("/ai/connections/:connectionId", requireAuth, controller.updateConnection);
  router.delete("/ai/connections/:connectionId", requireAuth, controller.deleteConnection);
  router.post("/ai/connections/:connectionId/test", requireAuth, controller.testConnection);
  router.get("/ai/models", requireAuth, controller.listModels);
  router.get("/ai/preferences", requireAuth, controller.getPreferences);
  router.put("/ai/preferences/:task", requireAuth, controller.setPreference);
  router.delete("/account", requireAuth, controller.deleteAccount);

  return router;
}
