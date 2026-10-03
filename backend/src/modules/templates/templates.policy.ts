import type { AccessAuthority } from "../access/access.authority.js";
import type { TemplatesRepository } from "./templates.repository.js";
import { TemplateError, type Template } from "./templates.types.js";

export class TemplatesAuthorizationPolicy {
  constructor(
    private readonly repository: Pick<TemplatesRepository, "findById">,
    private readonly authority: AccessAuthority,
  ) {}

  async requireAccessible(templateId: string, userId: string): Promise<Template> {
    const decision = await this.authority.decide({
      actor: { userId, email: "" },
      resource: { kind: "template", id: templateId },
      action: "read",
    });
    if (!decision.allowed) throw new TemplateError(404, "Template not found");
    const template = await this.repository.findById(templateId);
    if (!template) throw new TemplateError(404, "Template not found");
    return template;
  }

  async requireOwned(templateId: string, userId: string, detail: string): Promise<Template> {
    const decision = await this.authority.decide({
      actor: { userId, email: "" },
      resource: { kind: "template", id: templateId },
      action: "edit",
    });
    if (!decision.allowed) throw new TemplateError(404, detail);
    const template = await this.repository.findById(templateId);
    if (!template) throw new TemplateError(404, detail);
    return template;
  }
}
