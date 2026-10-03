import {
  createProviderConnection,
  deleteProviderConnection,
  getAiPreferences,
  getUserAiRuntime,
  listAvailableModels,
  listProviderConnections,
  setAiPreference,
  updateProviderConnection,
} from "../../lib/aiRegistry.js";
import { completeText } from "../../lib/llm/index.js";
import { DrizzleUsersRepository } from "./users.repository.js";
import { createUsersRouter } from "./users.routes.js";
import { UsersService, type UserAiSettings } from "./users.service.js";

const aiSettings: UserAiSettings = {
  listConnections: listProviderConnections,
  createConnection: createProviderConnection,
  updateConnection: updateProviderConnection,
  deleteConnection: deleteProviderConnection,
  listModels: listAvailableModels,
  getPreferences: getAiPreferences,
  setPreference: setAiPreference,
  async testConnection(userId, connectionId) {
    const runtime = await getUserAiRuntime(userId);
    const connection = runtime.connections.find(({ id }) => id === connectionId);
    if (!connection) return "not-found";
    const model = runtime.models.find(
      (candidate) =>
        candidate.connectionId === connection.id ||
        (!candidate.connectionId && candidate.provider === connection.provider),
    );
    if (!model) return "no-model";
    await completeText({
      model: model.id,
      connectionId: connection.id,
      task: model.tasks[0],
      user: "Reply with OK.",
      maxTokens: 8,
      runtime: {
        connections: [connection, ...runtime.connections.filter(({ id }) => id !== connection.id)],
        models: runtime.models,
      },
    });
    return "ok";
  },
};

const repository = new DrizzleUsersRepository();

export const userRouter = createUsersRouter({
  profiles: new UsersService(repository, aiSettings),
  accounts: repository,
  ai: aiSettings,
});
