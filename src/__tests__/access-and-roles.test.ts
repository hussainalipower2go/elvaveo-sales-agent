// ==============================================================================
// ELVAVEO Sales Agent - Access Control & Role Permission Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import {
  canManageLeads,
  canManageDrafts,
  canApproveDrafts,
  canSendEmails,
  canManageWorkspace,
  assertPermission,
} from '@/lib/auth/roles';
import { WorkspaceRole } from '@/lib/types/database';

describe('Workspace Role-Based Access Control', () => {
  it('allows operators to manage leads and drafts, but strictly forbids approval and sending', () => {
    const operator: WorkspaceRole = 'operator';

    expect(canManageLeads(operator)).toBe(true);
    expect(canManageDrafts(operator)).toBe(true);
    expect(canApproveDrafts(operator)).toBe(false);
    expect(canSendEmails(operator)).toBe(false);
    expect(canManageWorkspace(operator)).toBe(false);

    // Assert permission throws for approval
    expect(() =>
      assertPermission(operator, canApproveDrafts, 'approve drafts')
    ).toThrow(/Forbidden/);

    // Assert permission throws for sending
    expect(() =>
      assertPermission(operator, canSendEmails, 'send outreach emails')
    ).toThrow(/Forbidden/);
  });

  it('allows reviewers to review, approve, and send, but forbids workspace administration', () => {
    const reviewer: WorkspaceRole = 'reviewer';

    expect(canManageLeads(reviewer)).toBe(true);
    expect(canManageDrafts(reviewer)).toBe(true);
    expect(canApproveDrafts(reviewer)).toBe(true);
    expect(canSendEmails(reviewer)).toBe(true);
    expect(canManageWorkspace(reviewer)).toBe(false);

    expect(() =>
      assertPermission(reviewer, canApproveDrafts, 'approve drafts')
    ).not.toThrow();
  });

  it('allows admins and owners full control over workflows and workspace administration', () => {
    const admin: WorkspaceRole = 'admin';
    const owner: WorkspaceRole = 'owner';

    for (const role of [admin, owner]) {
      expect(canManageLeads(role)).toBe(true);
      expect(canManageDrafts(role)).toBe(true);
      expect(canApproveDrafts(role)).toBe(true);
      expect(canSendEmails(role)).toBe(true);
      expect(canManageWorkspace(role)).toBe(true);
    }
  });

  it('blocks null or undefined roles from any privileged action', () => {
    expect(canManageLeads(null)).toBe(false);
    expect(canManageDrafts(null)).toBe(false);
    expect(canApproveDrafts(null)).toBe(false);
    expect(canSendEmails(null)).toBe(false);
    expect(canManageWorkspace(null)).toBe(false);

    expect(canManageLeads(undefined)).toBe(false);
    expect(canManageDrafts(undefined)).toBe(false);
    expect(canApproveDrafts(undefined)).toBe(false);
    expect(canSendEmails(undefined)).toBe(false);
    expect(canManageWorkspace(undefined)).toBe(false);

    expect(() =>
      assertPermission(null, canSendEmails, 'send outreach')
    ).toThrow(/Forbidden/);

    expect(() =>
      assertPermission(undefined, canApproveDrafts, 'approve drafts')
    ).toThrow(/Forbidden/);
  });
});
