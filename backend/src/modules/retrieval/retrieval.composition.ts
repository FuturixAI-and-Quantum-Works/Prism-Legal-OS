import type { AppConfig } from "../../config.js";
import { RetrievalProviderClient } from "./retrieval.provider.js";

export let retrievalProvider = new RetrievalProviderClient();

export function configureRetrieval(config: AppConfig["rag"]): void {
  retrievalProvider = new RetrievalProviderClient(config);
}
