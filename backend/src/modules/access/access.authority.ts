import { accessAllows, accessDenialReason } from "./access.matrix.js";
import type { AccessGrantReader } from "./access.repository.js";
import type { AccessActor, AccessDecision, AccessGrant, AccessRequest } from "./access.types.js";

export class AccessAuthority {
  constructor(readonly grants: AccessGrantReader) {}

  async decide(request: AccessRequest): Promise<AccessDecision> {
    const grant = await this.grants.findGrant(request.actor, request.resource);
    if (!grant) return { allowed: false, reason: "not-found" };
    return this.decideKnownGrant(request, grant);
  }

  decideKnownGrant(request: AccessRequest, grant: AccessGrant): AccessDecision {
    return accessAllows(grant, request)
      ? { allowed: true, grant }
      : { allowed: false, reason: accessDenialReason(grant, request) };
  }

  async filterDocumentIds(actor: AccessActor, documentIds: readonly string[]): Promise<string[]> {
    const uniqueIds = [...new Set(documentIds)];
    const decisions = await Promise.all(
      uniqueIds.map(async (id) => ({
        id,
        decision: await this.decide({
          actor,
          resource: { kind: "document", id },
          action: "read_document",
        }),
      })),
    );
    return decisions.flatMap(({ id, decision }) => (decision.allowed ? [id] : []));
  }
}
