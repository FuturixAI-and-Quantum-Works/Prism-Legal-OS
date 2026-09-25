import "../loadEnv.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { approvalPolicies, approvalPolicyRules, approvalRoles, db } from "../db/index.js";
import {
  parseApproverRole,
  validateApprovalRuleDefinition,
} from "../modules/approvals/approvals.policy.js";
import type { ApprovalRuleDefinition } from "../modules/approvals/approvals.types.js";
import { withScriptDatabase } from "./database.js";

export const CORE_APPROVAL_ROLES = [
  {
    key: "legal_reviewer",
    label: "Legal reviewer",
    description: "Reviews legal rights, obligations, and risk allocation",
    sortOrder: 10,
  },
  {
    key: "business_owner",
    label: "Business owner",
    description: "Reviews scope, delivery, and operational commitments",
    sortOrder: 20,
  },
  {
    key: "finance_reviewer",
    label: "Finance reviewer",
    description: "Reviews financial commitments and commercial terms",
    sortOrder: 30,
  },
  {
    key: "technical_reviewer",
    label: "Technical reviewer",
    description: "Reviews technical, data protection, and information security terms",
    sortOrder: 40,
  },
  {
    key: "executive_approver",
    label: "Executive approver",
    description: "Reviews material strategic commitments and organizational risk",
    sortOrder: 50,
  },
] as const;

export const CORE_APPROVAL_POLICY = {
  key: "core_document_review",
  name: "Core document review",
  description: "Broad review rules for common legal, financial, security, and delivery terms",
  subjectType: "document" as const,
};

export const CORE_APPROVAL_RULES = [
  {
    key: "core.legal_terms",
    roleKey: "legal_reviewer",
    matchTarget: "content",
    pattern: "\\b(indemnity|liabilit(?:y|ies)|governing law|jurisdiction|confidential(?:ity)?)\\b",
    flags: "iu",
    description: "Legal rights, remedies, or obligations changed",
    priority: 10,
    enabled: true,
  },
  {
    key: "core.business_terms",
    roleKey: "business_owner",
    matchTarget: "content",
    pattern:
      "\\b(scope of work|deliverables?|service levels?|termination|renewal|change control)\\b",
    flags: "iu",
    description: "Scope, delivery, or operational commitments changed",
    priority: 20,
    enabled: true,
  },
  {
    key: "core.financial_terms",
    roleKey: "finance_reviewer",
    matchTarget: "content",
    pattern: "\\b(payment terms?|fees?|pricing|invoices?|tax(?:es)?|budget|currency)\\b",
    flags: "iu",
    description: "Financial or commercial terms changed",
    priority: 30,
    enabled: true,
  },
  {
    key: "core.technical_terms",
    roleKey: "technical_reviewer",
    matchTarget: "content",
    pattern:
      "\\b(personal data|data protection|privacy|information security|access control|security incident|integration|availability)\\b",
    flags: "iu",
    description: "Technical, security, privacy, or data protection terms changed",
    priority: 40,
    enabled: true,
  },
  {
    key: "core.executive_terms",
    roleKey: "executive_approver",
    matchTarget: "content",
    pattern:
      "\\b(change of control|merger|acquisition|exclusivity|strategic commitment|material risk)\\b",
    flags: "iu",
    description: "Material strategic commitments or organizational risks changed",
    priority: 50,
    enabled: true,
  },
] satisfies readonly ApprovalRuleDefinition[];

export function validateCoreApprovalPolicySeed(): void {
  const roleKeys = new Set(CORE_APPROVAL_ROLES.map((role) => parseApproverRole(role.key)));
  for (const rule of CORE_APPROVAL_RULES) {
    if (!roleKeys.has(rule.roleKey)) {
      throw new Error(`Approval rule ${rule.key} references an unknown role`);
    }
    validateApprovalRuleDefinition(rule);
  }
}

export async function seedApprovalPolicies(): Promise<void> {
  validateCoreApprovalPolicySeed();

  await db.transaction(async (transaction) => {
    for (const role of CORE_APPROVAL_ROLES) {
      await transaction
        .insert(approvalRoles)
        .values({ ...role, enabled: true })
        .onConflictDoUpdate({
          target: approvalRoles.key,
          set: {
            label: role.label,
            description: role.description,
            enabled: true,
            sortOrder: role.sortOrder,
            updatedAt: new Date(),
          },
        });
    }

    const [currentDefault] = await transaction
      .select({ key: approvalPolicies.key })
      .from(approvalPolicies)
      .where(
        and(
          eq(approvalPolicies.subjectType, CORE_APPROVAL_POLICY.subjectType),
          eq(approvalPolicies.isDefault, true),
        ),
      )
      .limit(1);
    const isDefault =
      currentDefault === undefined || currentDefault.key === CORE_APPROVAL_POLICY.key;

    const [policy] = await transaction
      .insert(approvalPolicies)
      .values({ ...CORE_APPROVAL_POLICY, enabled: true, isDefault })
      .onConflictDoUpdate({
        target: approvalPolicies.key,
        set: {
          name: CORE_APPROVAL_POLICY.name,
          description: CORE_APPROVAL_POLICY.description,
          enabled: true,
          isDefault,
          updatedAt: new Date(),
        },
      })
      .returning({ id: approvalPolicies.id });

    await transaction
      .update(approvalPolicyRules)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(approvalPolicyRules.policyId, policy.id));

    for (const rule of CORE_APPROVAL_RULES) {
      const { roleKey, ...ruleValues } = rule;
      await transaction
        .insert(approvalPolicyRules)
        .values({ ...ruleValues, policyId: policy.id, role: roleKey })
        .onConflictDoUpdate({
          target: approvalPolicyRules.key,
          set: {
            policyId: policy.id,
            role: roleKey,
            matchTarget: rule.matchTarget,
            pattern: rule.pattern,
            flags: rule.flags,
            description: rule.description,
            priority: rule.priority,
            enabled: true,
            updatedAt: new Date(),
          },
        });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--dry-run")) {
    validateCoreApprovalPolicySeed();
    console.info(
      `Validated ${CORE_APPROVAL_ROLES.length} approval roles and ${CORE_APPROVAL_RULES.length} rules.`,
    );
  } else {
    withScriptDatabase(process.env, seedApprovalPolicies)
      .then(() => {
        console.info("Approval policies seeded.");
      })
      .catch((error: unknown) => {
        console.error("Failed to seed approval policies.", error);
        process.exitCode = 1;
      });
  }
}
