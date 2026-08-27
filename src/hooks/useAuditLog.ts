import { useSyncExternalStore } from "react";
import { getAuditEvents, getAuditVersion, subscribeAudit, type AuditEvent } from "../lib/auditLog";

/* Suscripción reactiva al registro de auditoría */
export function useAuditLog(): AuditEvent[] {
  useSyncExternalStore(subscribeAudit, getAuditVersion);
  return getAuditEvents();
}
