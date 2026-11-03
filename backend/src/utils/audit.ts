/**
 * Audit-row construction.
 *
 * One shape for every writer, so `AuditLog` cannot accumulate a second dialect
 * when a later module adds an action. Metadata carries changed field *names*,
 * never their values: an audit trail must not become a copy of the profile.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type { Prisma } from "../generated/prisma/client.js";
import type { AuditActorType } from "../constants/constants.js";

export interface AuditEntryInput {
  businessId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Prisma.InputJsonObject;
}

export function auditEntry(input: AuditEntryInput) {
  return {
    businessId: input.businessId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
