// ==============================================================================
// ELVAVEO Sales Agent - Workspace Roles & Authorization
// ==============================================================================

import { WorkspaceRole } from '../types/database';

export const ROLES: Record<WorkspaceRole, WorkspaceRole> = {
  owner: 'owner',
  admin: 'admin',
  reviewer: 'reviewer',
  operator: 'operator',
};

export function canManageWorkspace(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return role === 'owner' || role === 'admin';
}

export function canManageMembers(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return role === 'owner' || role === 'admin';
}

export function canManageLeads(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin', 'reviewer', 'operator'].includes(role);
}

export function canManageDrafts(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin', 'reviewer', 'operator'].includes(role);
}

export function canApproveDrafts(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return role === 'owner' || role === 'admin' || role === 'reviewer';
}

export function canSendEmails(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return role === 'owner' || role === 'admin' || role === 'reviewer';
}

export function canManageSuppressions(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return ['owner', 'admin', 'reviewer', 'operator'].includes(role);
}

export function canDeleteSuppressions(role?: WorkspaceRole | null): boolean {
  if (!role) return false;
  return role === 'owner';
}

export function assertPermission(
  role: WorkspaceRole | null | undefined,
  permission: (role: WorkspaceRole) => boolean,
  actionName: string
): void {
  if (!role || !permission(role)) {
    throw new Error(`Forbidden: Role "${role || 'none'}" is not authorized to ${actionName}.`);
  }
}
