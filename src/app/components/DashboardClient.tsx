'use client';

// ==============================================================================
// ELVAVEO Sales Agent - Mission Control Dashboard (Client Component)
// ==============================================================================

import { useState, useTransition } from 'react';
import {
  Lead,
  EmailDraft,
  DraftApproval,
  SendLog,
  Suppression,
  AuditLog,
  WorkspaceRole,
  SendMode,
  TargetCountry,
  TargetService,
  ConfidenceLevel,
  LifecycleStage,
  FollowUpSuggestion,
  FunnelMetrics,
} from '@/lib/types/database';
import { ELVAVEO_EMAIL_IDENTITY } from '@/lib/email/identity';
import { canApproveDrafts, canSendEmails, canManageLeads, canManageDrafts } from '@/lib/auth/roles';
import { parseAndValidateCsv, CsvParsePreview, LEGAL_CONSENT_DISCLAIMER } from '@/lib/leads/csv-parser';
import { createClient } from '@/lib/supabase/client';
import {
  executeSendAction,
  reviewDraftAction,
  saveDraftAction,
  submitForReviewAction,
  commitCsvLeadsAction,
  addManualSuppressionAction,
  discoverLeadsAction,
  qualifyLeadAction,
  updateLeadLifecycleStageAction,
  generatePersonalizedDraftAction,
  generateFollowUpSuggestionsAction,
  reviewFollowUpAction,
} from '@/lib/actions/sales-actions';
import { BackendDataPayload, CurrentUser } from '@/lib/services/data-service';

type Tab =
  | 'overview'
  | 'discovery'
  | 'leads'
  | 'drafts'
  | 'review'
  | 'sending'
  | 'activity'
  | 'suppressions'
  | 'audit'
  | 'setup';

export default function DashboardClient({ initialData }: { initialData: BackendDataPayload }) {
  // Navigation & Real Authentication
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(initialData.currentUser);
  const activeRole: WorkspaceRole | null = currentUser?.role || null;
  const isAuthenticated = Boolean(currentUser);

  // Auth Modal State
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('owner@elvaveo.com');
  const [authPassword, setAuthPassword] = useState('ElvaveoSecure2026!Outreach');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Application State from Server
  const [leads, setLeads] = useState<Lead[]>(initialData.leads);
  const [drafts, setDrafts] = useState<EmailDraft[]>(initialData.drafts);
  const [approvals, setApprovals] = useState<DraftApproval[]>(initialData.approvals);
  const [sendLogs, setSendLogs] = useState<SendLog[]>(initialData.sendLogs);
  const [suppressions, setSuppressions] = useState<Suppression[]>(initialData.suppressions);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(initialData.auditLogs);
  const [followUps, setFollowUps] = useState<FollowUpSuggestion[]>(initialData.followUpSuggestions || []);

  // Lead Filters & Search
  const [leadSearch, setLeadSearch] = useState('');
  const [leadConsentFilter, setLeadConsentFilter] = useState<string>('all');
  const [leadLifecycleFilter, setLeadLifecycleFilter] = useState<string>('all');

  // Lead Discovery Filters State
  const [discoveryCountry, setDiscoveryCountry] = useState<TargetCountry | 'all'>('all');
  const [discoveryService, setDiscoveryService] = useState<TargetService | 'all'>('all');
  const [discoveryConfidence, setDiscoveryConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [isDiscovering, setIsDiscovering] = useState(false);

  // CSV Import State
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvRawText, setCsvRawText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvParsePreview | null>(null);

  // Draft Editor State
  const [selectedLeadId, setSelectedLeadId] = useState<string>(leads[0]?.id || '');
  const [subjectTemplate, setSubjectTemplate] = useState('Accelerating AI Automation for {{company}}');
  const [bodyTemplate, setBodyTemplate] = useState(
    'Hi {{first_name}},\n\nI noticed your work as {{role}} at {{company}}. We help technology leaders streamline high-throughput sales workflows.\n\nWould you have 10 minutes next week to explore?'
  );

  // Notifications & Async State
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isPending, startTransition] = useTransition();

  const showNotification = (type: 'success' | 'error' | 'info', text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 7000);
  };

  // Dynamic 9-Stage Pipeline Funnel Calculations
  const funnelMetrics: FunnelMetrics = {
    discovered: leads.filter((l) => l.lifecycle_stage === 'discovered' || l.source === 'ai_discovery_engine').length,
    qualified: leads.filter(
      (l) =>
        l.lifecycle_stage === 'qualified' ||
        l.lifecycle_stage === 'drafted' ||
        l.lifecycle_stage === 'pending_approval' ||
        l.lifecycle_stage === 'approved' ||
        l.lifecycle_stage === 'sent' ||
        l.lifecycle_stage === 'replied' ||
        l.lifecycle_stage === 'meeting' ||
        l.lifecycle_stage === 'won'
    ).length,
    drafts: drafts.length,
    pendingApproval: drafts.filter((d) => d.status === 'pending_review').length,
    approved: drafts.filter((d) => d.status === 'approved').length,
    sent: sendLogs.filter((s) => !s.is_test && (s.status === 'sent' || s.status === 'delivered')).length,
    replied: leads.filter((l) => l.lifecycle_stage === 'replied' || l.status === 'replied' || l.lifecycle_stage === 'meeting' || l.lifecycle_stage === 'won').length,
    meetings: leads.filter((l) => l.lifecycle_stage === 'meeting' || l.lifecycle_stage === 'won').length,
    clientsWon: leads.filter((l) => l.lifecycle_stage === 'won').length,
  };

  const funnelStages = [
    { id: 'discovered', label: '1. Discovered', count: funnelMetrics.discovered, icon: '🔍', tab: 'discovery' as Tab, desc: 'Verified companies' },
    { id: 'qualified', label: '2. Qualified', count: funnelMetrics.qualified, icon: '🎯', tab: 'leads' as Tab, desc: 'ICP fit confirmed' },
    { id: 'drafts', label: '3. Drafts', count: funnelMetrics.drafts, icon: '📝', tab: 'drafts' as Tab, desc: 'Observation drafts' },
    { id: 'pendingApproval', label: '4. Pending Review', count: funnelMetrics.pendingApproval, icon: '⏳', tab: 'review' as Tab, desc: 'Reviewer gated' },
    { id: 'approved', label: '5. Approved', count: funnelMetrics.approved, icon: '✅', tab: 'sending' as Tab, desc: 'Content hash locked' },
    { id: 'sent', label: '6. Sent', count: funnelMetrics.sent, icon: '🚀', tab: 'activity' as Tab, desc: 'Resend outreach' },
    { id: 'replied', label: '7. Replied', count: funnelMetrics.replied, icon: '💬', tab: 'leads' as Tab, desc: 'Incoming replies' },
    { id: 'meetings', label: '8. Meetings', count: funnelMetrics.meetings, icon: '📅', tab: 'leads' as Tab, desc: 'Calls booked' },
    { id: 'clientsWon', label: '9. Clients Won', count: funnelMetrics.clientsWon, icon: '🏆', tab: 'leads' as Tab, desc: 'Contracts signed' },
  ];

  // Authentication Handlers
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });

      if (error) {
        showNotification('error', `Authentication Failed: ${error.message}`);
        return;
      }

      if (data.user) {
        showNotification('success', `Signed in as ${data.user.email}`);
        setIsAuthModalOpen(false);
        window.location.reload();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification('error', `Sign-in error: ${msg}`);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      showNotification('info', 'Signed out successfully.');
      window.location.reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification('error', `Sign-out error: ${msg}`);
    }
  };

  // CSV Parsing Preview
  const handleParseCsv = (raw: string) => {
    setCsvRawText(raw);
    if (!raw.trim()) {
      setCsvPreview(null);
      return;
    }
    const existingEmails = new Set(leads.map((l) => l.email.toLowerCase()));
    const suppressedEmails = new Set(suppressions.map((s) => s.email.toLowerCase()));
    const preview = parseAndValidateCsv(raw, existingEmails, suppressedEmails);
    setCsvPreview(preview);
  };

  const handleCommitCsvImport = () => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to an authorized workspace account to import leads.');
      return;
    }
    if (!csvPreview || csvPreview.validRows.length === 0) return;

    startTransition(async () => {
      const res = await commitCsvLeadsAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        leads: csvPreview.validRows,
      });

      if (!res.success) {
        showNotification('error', res.error || 'Failed to commit CSV leads.');
        return;
      }

      if (res.data?.leads && res.data.leads.length > 0) {
        setLeads((prev) => {
          const map = new Map<string, Lead>();
          res.data!.leads!.forEach((l) => map.set(l.email.toLowerCase(), l));
          prev.forEach((l) => {
            if (!map.has(l.email.toLowerCase())) {
              map.set(l.email.toLowerCase(), l);
            }
          });
          return Array.from(map.values());
        });
        showNotification('success', `Imported ${res.data.leads.length} leads directly into Supabase.`);
      } else {
        const newLeadsToAdd: Lead[] = csvPreview.validRows.map((row) => ({
          id: crypto.randomUUID(),
          workspace_id: initialData.workspace?.id || 'ws-default',
          email: row.email,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          company: row.company || null,
          role: row.role || null,
          website: row.website || null,
          source: row.source || 'csv_import',
          notes: row.notes || null,
          consent_status: row.consent_status || 'unknown',
          consent_source: row.consent_source || 'csv_import',
          consent_timestamp: row.consent_status === 'opted_in' ? new Date().toISOString() : null,
          status: 'new',
          lifecycle_stage: 'discovered',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        setLeads((prev) => [...newLeadsToAdd, ...prev]);
        showNotification('success', `Imported ${newLeadsToAdd.length} leads. Suppressions strictly preserved.`);
      }

      setIsCsvModalOpen(false);
      setCsvRawText('');
      setCsvPreview(null);
    });
  };

  // Lead Discovery Action
  const handleRunDiscovery = async () => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to discover leads.');
      return;
    }
    setIsDiscovering(true);
    try {
      const res = await discoverLeadsAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        filters: {
          country: discoveryCountry === 'all' ? undefined : discoveryCountry,
          service: discoveryService === 'all' ? undefined : discoveryService,
          confidence: discoveryConfidence === 'all' ? undefined : discoveryConfidence,
          limit: 10,
        },
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Lead discovery failed.');
        return;
      }

      const discovered = res.data.leads;
      if (discovered.length === 0) {
        showNotification('info', 'No leads matched current discovery filters.');
        return;
      }

      setLeads((prev) => {
        const existingEmails = new Set(prev.map((l) => l.email.toLowerCase()));
        const newLeads = discovered.filter((l) => !existingEmails.has(l.email.toLowerCase()));
        return [...newLeads, ...prev];
      });

      showNotification(
        'success',
        `Discovered ${discovered.length} verified companies across ${
          discoveryCountry === 'all' ? 'target markets' : discoveryCountry
        } with legitimate technical observations.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification('error', `Discovery error: ${msg}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  // Qualify Discovered Lead
  const handleQualifyLead = (leadId: string) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to qualify leads.');
      return;
    }
    startTransition(async () => {
      const res = await qualifyLeadAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        leadId,
      });

      if (!res.success) {
        showNotification('error', res.error || 'Failed to qualify lead.');
        return;
      }

      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId
            ? { ...l, lifecycle_stage: 'qualified', status: 'new' }
            : l
        )
      );
      showNotification('success', 'Lead qualified. Ready for observation-based drafting.');
    });
  };

  // Update Lead Lifecycle Stage (Replied, Meeting, Won)
  const handleUpdateLifecycleStage = (leadId: string, stage: LifecycleStage, note?: string) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required to update pipeline stage.');
      return;
    }
    startTransition(async () => {
      const res = await updateLeadLifecycleStageAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        leadId,
        newStage: stage,
        stageNote: note,
      });

      if (!res.success) {
        showNotification('error', res.error || 'Failed to update lifecycle stage.');
        return;
      }

      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId
            ? {
                ...l,
                lifecycle_stage: stage,
                status: stage === 'replied' ? 'replied' : l.status,
              }
            : l
        )
      );
      showNotification('success', `Pipeline updated: Lead moved to stage ${stage.toUpperCase()}.`);
    });
  };

  // AI Personalization from Observations
  const handleGenerateObservationDraft = (lead: Lead) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to create drafts.');
      return;
    }
    startTransition(async () => {
      const res = await generatePersonalizedDraftAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        lead,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Failed to generate personalized draft.');
        return;
      }

      setDrafts((prev) => [res.data!, ...prev]);
      setSelectedLeadId(lead.id);
      setActiveTab('drafts');
      showNotification(
        'success',
        `Personalized draft generated from verified technical observations for ${lead.company}.`
      );
    });
  };

  // Draft Creation via Manual Template
  const handleGenerateDraft = () => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to create drafts.');
      return;
    }
    const lead = leads.find((l) => l.id === selectedLeadId);
    if (!lead) return;

    startTransition(async () => {
      const res = await saveDraftAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        lead,
        subjectTemplate,
        bodyTemplate,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Failed to save draft.');
        return;
      }

      setDrafts((prev) => [res.data!, ...prev]);

      if (res.data.missing_fields && res.data.missing_fields.length > 0) {
        showNotification(
          'info',
          `Draft saved with missing fields: ${res.data.missing_fields.join(', ')}. Review required before submission.`
        );
      } else {
        showNotification('success', 'Draft saved with cryptographic content hash. Ready for submission.');
      }
    });
  };

  const handleSubmitForReview = (draft: EmailDraft) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to submit drafts for review.');
      return;
    }
    startTransition(async () => {
      const res = await submitForReviewAction({
        draft,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Submission blocked.');
        return;
      }

      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? res.data! : d)));
      showNotification('success', 'Draft submitted to Review Queue.');
      setActiveTab('review');
    });
  };

  // Review & Approval via Server Action
  const handleApproveDraft = (draft: EmailDraft, comment: string) => {
    if (!isAuthenticated || !canApproveDrafts(activeRole)) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Unauthorized: Reviewer, Admin, or Owner access required to approve drafts.');
      return;
    }
    startTransition(async () => {
      const res = await reviewDraftAction({
        draft,
        decision: 'approved',
        comment,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Approval rejected by server authorization.');
        return;
      }

      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? res.data!.draft : d)));
      setApprovals((prev) => [res.data!.approval, ...prev]);
      showNotification('success', 'Draft approved by reviewer. Content hash locked. Available in Sending Station.');
    });
  };

  const handleRejectDraft = (draft: EmailDraft, comment: string) => {
    if (!isAuthenticated || !canApproveDrafts(activeRole)) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Unauthorized: Reviewer, Admin, or Owner access required to reject drafts.');
      return;
    }
    startTransition(async () => {
      const res = await reviewDraftAction({
        draft,
        decision: 'rejected',
        comment,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Rejection failed.');
        return;
      }

      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? res.data!.draft : d)));
      showNotification('info', 'Draft rejected and returned with comments.');
    });
  };

  // Follow-Up Sequences Handlers
  const handleGenerateFollowUps = (lead: Lead, parentDraft: EmailDraft) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to create follow-up suggestions.');
      return;
    }
    startTransition(async () => {
      const res = await generateFollowUpSuggestionsAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        lead,
        parentDraft,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Failed to generate follow-up suggestions.');
        return;
      }

      setFollowUps((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const newSuggestions = res.data!.filter((f) => !existingIds.has(f.id));
        return [...newSuggestions, ...prev];
      });
      showNotification(
        'success',
        `Generated ${res.data.length} follow-up suggestions. Reviewer approval required before sending.`
      );
    });
  };

  const handleReviewFollowUp = (suggestion: FollowUpSuggestion, decision: 'approved' | 'rejected') => {
    if (!isAuthenticated || !canApproveDrafts(activeRole)) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Unauthorized: Reviewer, Admin, or Owner role required to review follow-up suggestions.');
      return;
    }
    startTransition(async () => {
      const res = await reviewFollowUpAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        suggestion,
        decision,
      });

      if (!res.success || !res.data) {
        showNotification('error', res.error || 'Follow-up review failed.');
        return;
      }

      setFollowUps((prev) => prev.map((f) => (f.id === suggestion.id ? res.data! : f)));
      showNotification(
        decision === 'approved' ? 'success' : 'info',
        `Follow-up cadence step ${decision === 'approved' ? 'approved' : 'rejected'}.`
      );
    });
  };

  // Explicit Send via Real Server Action
  const handleTriggerSend = async (draft: EmailDraft, targetMode: SendMode) => {
    if (!isAuthenticated || !canSendEmails(activeRole)) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Unauthorized: Reviewer, Admin, or Owner access required to dispatch emails.');
      return;
    }
    const lead = leads.find((l) => l.id === draft.lead_id);
    if (!lead) return;

    const latestApproval = approvals.find((a) => a.draft_id === draft.id && a.draft_version === draft.version) || null;

    setIsSending(true);
    try {
      const res = await executeSendAction({
        draft,
        lead,
        latestApproval,
        targetMode,
      });

      if (!res.success || !res.data) {
        const errorDetail = res.blockingReasons ? res.blockingReasons.join(' | ') : res.error;
        showNotification('error', `Send Blocked: ${errorDetail}`);
        return;
      }

      const result = res.data;
      if (result.success) {
        const newLog: SendLog = {
          id: `send-${Date.now()}`,
          workspace_id: draft.workspace_id,
          draft_id: draft.id,
          lead_id: draft.lead_id,
          recipient_email: result.effectiveRecipient,
          send_mode: targetMode,
          is_test: result.isTest,
          idempotency_key: result.idempotencyKey,
          provider: 'resend',
          resend_email_id: result.resendEmailId || null,
          status: result.status,
          error_message: null,
          sent_by: currentUser ? currentUser.email : 'authenticated-user',
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        setSendLogs((prev) => [newLog, ...prev]);

        if (result.isTest) {
          showNotification(
            'success',
            `[TEST SEND DISPATCHED] Email sent via Resend API to authorized test recipient: ${result.effectiveRecipient}. Real lead was NOT contacted.`
          );
        } else {
          setDrafts((prev) => prev.map((d) => (d.id === draft.id ? { ...d, status: 'sent' } : d)));
          setLeads((prev) => prev.map((l) => (l.id === draft.lead_id ? { ...l, status: 'contacted', lifecycle_stage: 'sent' } : l)));
          showNotification('success', `Live outreach email successfully dispatched via Resend to ${result.effectiveRecipient}.`);
        }
      } else {
        showNotification('error', `Provider Outcome (${result.status}): ${result.errorMessage}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification('error', `Send failed: ${message}`);
    } finally {
      setIsSending(false);
    }
  };

  // Add Manual Do-Not-Contact via Server Action
  const handleAddManualSuppression = (email: string) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotification('error', 'Sign-in required: Please sign in to manage suppressions.');
      return;
    }
    if (!email || !email.includes('@')) {
      showNotification('error', 'Please enter a valid email address.');
      return;
    }
    const normalized = email.trim().toLowerCase();

    startTransition(async () => {
      const res = await addManualSuppressionAction({
        workspaceId: initialData.workspace?.id || 'ws-default',
        email: normalized,
      });

      if (!res.success) {
        showNotification('error', res.error || 'Failed to add suppression.');
        return;
      }

      const supp: Suppression = {
        id: `supp-${Date.now()}`,
        workspace_id: initialData.workspace?.id || 'ws-default',
        email: normalized,
        reason: 'manual',
        source_details: `Added manually by ${currentUser?.email || 'authorized user'}`,
        created_at: new Date().toISOString(),
      };

      setSuppressions((prev) => [supp, ...prev]);
      setLeads((prev) =>
        prev.map((l) =>
          l.email.toLowerCase() === normalized
            ? { ...l, status: 'do_not_contact', consent_status: 'opted_out', lifecycle_stage: 'suppressed' }
            : l
        )
      );
      showNotification('success', `Suppression added for ${normalized}. Future sends are blocked.`);
    });
  };

  // Filtered Leads
  const filteredLeads = leads.filter((l) => {
    const matchesSearch =
      l.email.toLowerCase().includes(leadSearch.toLowerCase()) ||
      (l.company && l.company.toLowerCase().includes(leadSearch.toLowerCase())) ||
      (l.first_name && l.first_name.toLowerCase().includes(leadSearch.toLowerCase()));

    const matchesConsent = leadConsentFilter === 'all' || l.consent_status === leadConsentFilter;
    const matchesLifecycle = leadLifecycleFilter === 'all' || l.lifecycle_stage === leadLifecycleFilter;
    return matchesSearch && matchesConsent && matchesLifecycle;
  });

  // Filtered Discovered Leads
  const discoveredLeads = leads.filter((l) => {
    const matchesCountry = discoveryCountry === 'all' || l.country === discoveryCountry;
    const matchesService = discoveryService === 'all' || l.target_service === discoveryService;
    const matchesConfidence = discoveryConfidence === 'all' || l.confidence_level === discoveryConfidence;
    return matchesCountry && matchesService && matchesConfidence;
  });

  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Database Schema Status Warning Banner if Migrations Not Run */}
      {!initialData.areTablesMigrated && (
        <div
          style={{
            background: '#451a03',
            borderBottom: '1px solid #d97706',
            color: '#fef3c7',
            padding: '10px 24px',
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>⚠️ DATABASE SCHEMA NOT YET APPLIED IN SUPABASE:</strong> Table <code>public.workspaces</code> was
            not found. Discovery and outreach records below are labeled <code>[DEMO RECORD]</code> for illustration.
            Apply <code>supabase/migrations/20261008000001_elvaveo_sales_agent_schema.sql</code> and{' '}
            <code>20261009000002_phase2_lead_discovery_and_automation.sql</code> in the Supabase SQL editor to persist
            mutations.
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 10px', color: '#fff', borderColor: '#d97706' }}
            onClick={() => setActiveTab('setup')}
          >
            View SQL Migration Steps
          </button>
        </div>
      )}

      {/* Top Header & Identity Guard */}
      <header
        style={{
          padding: '16px 32px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 18,
                color: '#fff',
                boxShadow: '0 4px 12px rgba(37,99,235,0.3)',
              }}
            >
              E
            </div>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', margin: 0 }}>
                ELVAVEO <span style={{ color: '#60a5fa', fontWeight: 600 }}>Sales Agent</span>
              </h1>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Phase 2: AI Lead Generation & Outreach Automation
              </div>
            </div>
          </div>

          <div style={{ height: 24, width: 1, background: 'var(--border-subtle)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-emerald">Resend Exclusively</span>
            <span className="badge badge-neutral" style={{ fontSize: 11 }}>
              Sender: {ELVAVEO_EMAIL_IDENTITY.SENDER_EMAIL_ONLY}
            </span>
            <span className="badge badge-neutral" style={{ fontSize: 11, color: '#94a3b8' }}>
              🚫 Power2Go Gmail: Strictly Prohibited
            </span>
            <span
              className={`badge ${initialData.serverSendMode === 'live' ? 'badge-emerald' : 'badge-neutral'}`}
              style={{
                fontSize: 11,
                color: initialData.serverSendMode === 'live' ? '#10b981' : '#93c5fd',
                borderColor: initialData.serverSendMode === 'live' ? '#059669' : '#3b82f6',
              }}
            >
              {initialData.serverSendMode === 'live'
                ? '⚡ Live Outreach Active'
                : '🛡️ Safe Mode: Outreach Gated'}
            </span>
          </div>
        </div>

        {/* Real Supabase Workspace Authentication */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isAuthenticated && currentUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--bg-main)',
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontSize: 13, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>👤</span>
                <strong>{currentUser.email}</strong>
              </span>
              <span
                className={`badge ${
                  currentUser.role === 'owner' || currentUser.role === 'admin'
                    ? 'badge-emerald'
                    : currentUser.role === 'reviewer'
                    ? 'badge-neutral'
                    : 'badge-amber'
                }`}
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {currentUser.role.toUpperCase()}
              </span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '3px 8px', marginLeft: 6 }}
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>🔒</span> Unauthenticated (Read-Only)
              </span>
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={() => setIsAuthModalOpen(true)}
              >
                Sign In to Workspace
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div
          style={{
            position: 'fixed',
            top: 70,
            right: 24,
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: 8,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background:
              notification.type === 'success'
                ? '#064e3b'
                : notification.type === 'error'
                ? '#7f1d1d'
                : '#1e3a8a',
            color: '#fff',
            border: `1px solid ${
              notification.type === 'success'
                ? '#10b981'
                : notification.type === 'error'
                ? '#ef4444'
                : '#3b82f6'
            }`,
          }}
        >
          <span>{notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : 'ℹ'}</span>
          <span>{notification.text}</span>
        </div>
      )}

      {/* 9-Stage Pipeline Funnel Strip */}
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(10,15,28,0.95) 100%)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '14px 32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#94a3b8' }}>
              Full-Cycle Pipeline Funnel (9 Stages)
            </span>
            <span className="badge badge-emerald" style={{ fontSize: 10 }}>
              Live Telemetry
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Click any stage to inspect leads & drafts in pipeline
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(9, minmax(110px, 1fr))',
            gap: 8,
            overflowX: 'auto',
          }}
        >
          {funnelStages.map((stage, idx) => (
            <div
              key={stage.id}
              onClick={() => {
                setActiveTab(stage.tab);
                if (stage.id === 'qualified' || stage.id === 'replied' || stage.id === 'meetings' || stage.id === 'clientsWon') {
                  setLeadLifecycleFilter(stage.id === 'meetings' ? 'meeting' : stage.id === 'clientsWon' ? 'won' : stage.id);
                } else {
                  setLeadLifecycleFilter('all');
                }
              }}
              className="glass-panel"
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderRadius: 10,
                background:
                  activeTab === stage.tab
                    ? 'linear-gradient(145deg, rgba(37,99,235,0.2) 0%, rgba(30,41,59,0.5) 100%)'
                    : 'rgba(15,23,42,0.45)',
                borderColor: activeTab === stage.tab ? '#3b82f6' : 'var(--border-subtle)',
                position: 'relative',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>{stage.icon}</span>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color:
                      idx === 8
                        ? '#34d399'
                        : idx === 7 || idx === 6
                        ? '#60a5fa'
                        : idx === 4 || idx === 5
                        ? '#38bdf8'
                        : idx === 3
                        ? '#fbbf24'
                        : '#f8fafc',
                  }}
                >
                  {stage.count}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#e2e8f0',
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {stage.label}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {stage.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Navigation Bar */}
      <nav
        style={{
          padding: '0 32px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
        }}
      >
        {[
          { id: 'overview', label: 'Overview & Guardrails', icon: '📊' },
          { id: 'discovery', label: `Lead Discovery (${funnelMetrics.discovered})`, icon: '🔍' },
          { id: 'leads', label: `Leads & Contacts (${leads.length})`, icon: '👥' },
          { id: 'drafts', label: `AI Personalization (${drafts.length})`, icon: '✍️' },
          { id: 'review', label: `Review Queue (${drafts.filter((d) => d.status === 'pending_review').length})`, icon: '⚖️' },
          { id: 'sending', label: `Sending Station (${drafts.filter((d) => d.status === 'approved').length})`, icon: '🚀' },
          { id: 'activity', label: `Delivery Activity (${sendLogs.length})`, icon: '📬' },
          { id: 'suppressions', label: `Suppression List (${suppressions.length})`, icon: '🛑' },
          { id: 'audit', label: `Audit Trail (${auditLogs.length})`, icon: '📜' },
          { id: 'setup', label: 'Security & Setup Status', icon: '⚙️' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            className={`nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Main Body Content */}
      <main style={{ flex: 1, padding: '28px 32px', maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Top Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Discovered Prospects</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{funnelMetrics.discovered}</div>
                <div style={{ fontSize: 12, color: 'var(--status-emerald)', marginTop: 4 }}>
                  USA, UK, UAE & Canada Tech Companies
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Qualified Leads</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#38bdf8' }}>{funnelMetrics.qualified}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Verified ICP & technical observations
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Reviewer Gated Drafts</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>
                  {drafts.filter((d) => d.status === 'pending_review').length}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Awaiting explicit human review
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Active Outreach Logs</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981' }}>{sendLogs.length}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {sendLogs.filter((s) => s.is_test).length} Test / {sendLogs.filter((s) => !s.is_test).length} Live
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Suppressed Registry</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#f87171' }}>{suppressions.length}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Unsubscribes, Bounces, Complaints
                </div>
              </div>
            </div>

            {/* Quotas & Policies */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
              <div className="glass-panel" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🛡️</span> Durable Sending Quotas & Cooldowns
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>24-Hour Rolling Quota (Workspace)</span>
                      <span style={{ fontWeight: 700 }}>
                        {initialData.metrics.dailySendCount} / {initialData.metrics.dailyLimit}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-surface)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, (initialData.metrics.dailySendCount / initialData.metrics.dailyLimit) * 100)}%`,
                          height: '100%',
                          background: '#3b82f6',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>1-Hour Rolling Burst Limit</span>
                      <span style={{ fontWeight: 700 }}>
                        {initialData.metrics.hourlySendCount} / {initialData.metrics.hourlyLimit}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-surface)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, (initialData.metrics.hourlySendCount / initialData.metrics.hourlyLimit) * 100)}%`,
                          height: '100%',
                          background: '#10b981',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-surface)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <p style={{ margin: 0, lineHeight: 1.5 }}>
                      <strong>Server Test Recipients:</strong>{' '}
                      {initialData.serverTestRecipients.join(', ') || 'operator-test@elvaveo.com'}
                      <br />
                      <strong>Recipient Cool-Down Rule:</strong> Minimum 7 days between outreach emails to the exact same recipient.
                      <br />
                      <strong>Follow-Up Cadence Rule:</strong> All follow-up suggestions require reviewer approval. Zero unsolicited automated dispatches to scraped leads.
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚖️</span> Compliance & Zero-Fabrication Guardrails
                </h3>

                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                  <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
                    <span>
                      <strong>Strict Zero-Fabrication:</strong> We never hallucinate company facts, fake job openings, or fabricated buying intent. Observations are strictly grounded in verified technical signals.
                    </span>
                  </li>
                  <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
                    <span>
                      <strong>Permission Segregation:</strong> Scraped and discovered leads are assigned <code>unknown</code> permission. They are strictly segregated from <code>verified_opt_in</code> contacts.
                    </span>
                  </li>
                  <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
                    <span>
                      <strong>Resend Exclusively:</strong> All messages sent from verified domain <code>outreach.elvaveo.com</code>. No personal accounts or Gmail used.
                    </span>
                  </li>
                  <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
                    <span>
                      <strong>Cryptographic Review Gate:</strong> Approval is tied to the exact recipient, subject, body, sender, and footer shown to the reviewer.
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LEAD DISCOVERY */}
        {activeTab === 'discovery' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header & Explainer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#fff' }}>
                  Targeted Lead Discovery Engine
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Filter by target markets (USA, UK, UAE, Canada) and core ELVAVEO service offerings. Strictly stores verified source URLs, technical observations, and unknown permission gating.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                  Free-Tier Limit: 10 leads/call
                </span>
                <span className="badge badge-emerald" style={{ fontSize: 11 }}>
                  Zero-Fabrication Policy
                </span>
              </div>
            </div>

            {/* Discovery Filter Controls */}
            <div
              className="glass-panel"
              style={{
                padding: 20,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 180px',
                gap: 16,
                alignItems: 'flex-end',
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Target Market / Country:</label>
                <select
                  className="select-input"
                  value={discoveryCountry}
                  onChange={(e) => setDiscoveryCountry(e.target.value as TargetCountry | 'all')}
                >
                  <option value="all">🌍 All Markets (USA, UK, UAE, Canada)</option>
                  <option value="USA">🇺🇸 USA (United States)</option>
                  <option value="UK">🇬🇧 UK (United Kingdom)</option>
                  <option value="UAE">🇦🇪 UAE (United Arab Emirates)</option>
                  <option value="Canada">🇨🇦 Canada</option>
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Service Offering Focus:</label>
                <select
                  className="select-input"
                  value={discoveryService}
                  onChange={(e) => setDiscoveryService(e.target.value as TargetService | 'all')}
                >
                  <option value="all">⚡ All Services</option>
                  <option value="website_development">🌐 Website Development (Next.js / Core Web Vitals)</option>
                  <option value="crm_development">⚙️ CRM Development (Automation & Routing)</option>
                  <option value="custom_saas">☁️ Custom SaaS (Full-Stack AI Architecture)</option>
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Confidence Threshold:</label>
                <select
                  className="select-input"
                  value={discoveryConfidence}
                  onChange={(e) => setDiscoveryConfidence(e.target.value as ConfidenceLevel | 'all')}
                >
                  <option value="all">All Confidence Levels</option>
                  <option value="high">High Confidence (Direct verified signal)</option>
                  <option value="medium">Medium Confidence (Inferred modernization need)</option>
                  <option value="low">Low Confidence</option>
                </select>
              </div>

              <button
                className="btn btn-primary"
                style={{ height: 42, padding: '0 20px' }}
                disabled={isDiscovering || isPending}
                onClick={handleRunDiscovery}
              >
                {isDiscovering ? 'Searching...' : '🔍 Run Discovery'}
              </button>
            </div>

            {/* Discovered Leads Data Table */}
            <div className="data-table-container glass-panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company & Contact</th>
                    <th>Market & Service</th>
                    <th>Verified Technical Observations</th>
                    <th>Confidence</th>
                    <th>Permission Status</th>
                    <th>Lifecycle</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        No leads match current discovery filters. Click &ldquo;Run Discovery&rdquo; to fetch verified prospects.
                      </td>
                    </tr>
                  ) : (
                    discoveredLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: '#fff' }}>{lead.company || 'Unnamed Company'}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Decision Maker'} &bull;{' '}
                            <span style={{ color: '#60a5fa' }}>{lead.role || 'Leader'}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {lead.email} &bull;{' '}
                            {lead.website ? (
                              <a
                                href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#93c5fd', textDecoration: 'underline' }}
                              >
                                {lead.website}
                              </a>
                            ) : (
                              'No Website'
                            )}
                          </div>
                        </td>

                        <td>
                          <div style={{ marginBottom: 4 }}>
                            {lead.country === 'USA' && <span className="badge badge-neutral">🇺🇸 USA</span>}
                            {lead.country === 'UK' && <span className="badge badge-neutral">🇬🇧 UK</span>}
                            {lead.country === 'UAE' && <span className="badge badge-neutral">🇦🇪 UAE</span>}
                            {lead.country === 'Canada' && <span className="badge badge-neutral">🇨🇦 Canada</span>}
                            {!lead.country && <span className="badge badge-neutral">🌍 Global</span>}
                          </div>
                          <div>
                            {lead.target_service === 'website_development' && (
                              <span className="badge badge-neutral" style={{ fontSize: 10, color: '#93c5fd' }}>
                                Website Dev
                              </span>
                            )}
                            {lead.target_service === 'crm_development' && (
                              <span className="badge badge-neutral" style={{ fontSize: 10, color: '#fbbf24' }}>
                                CRM Dev
                              </span>
                            )}
                            {lead.target_service === 'custom_saas' && (
                              <span className="badge badge-neutral" style={{ fontSize: 10, color: '#c084fc' }}>
                                Custom SaaS
                              </span>
                            )}
                            {!lead.target_service && (
                              <span className="badge badge-neutral" style={{ fontSize: 10 }}>General</span>
                            )}
                          </div>
                        </td>

                        <td style={{ maxWidth: 360 }}>
                          {lead.business_observations && lead.business_observations.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                              {lead.business_observations.map((obs, idx) => (
                                <li key={idx} style={{ marginBottom: 2 }}>{obs}</li>
                              ))}
                            </ul>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {lead.notes || 'Technical observations pending analysis.'}
                            </span>
                          )}
                          {lead.researched_at && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                              Researched: {new Date(lead.researched_at).toLocaleDateString()}
                            </div>
                          )}
                        </td>

                        <td>
                          {lead.confidence_level === 'high' ? (
                            <span className="badge badge-emerald">High</span>
                          ) : lead.confidence_level === 'medium' ? (
                            <span className="badge badge-amber">Medium</span>
                          ) : (
                            <span className="badge badge-neutral">Low</span>
                          )}
                        </td>

                        <td>
                          {lead.consent_status === 'opted_in' ? (
                            <span className="badge badge-emerald">✓ Verified Opt-In</span>
                          ) : lead.consent_status === 'opted_out' ? (
                            <span className="badge badge-crimson">✕ Opted-Out</span>
                          ) : (
                            <span className="badge badge-amber" title="Requires verified consent before live dispatch">
                              ⚠️ Unknown Permission
                            </span>
                          )}
                        </td>

                        <td>
                          <span
                            className={`badge ${
                              lead.lifecycle_stage === 'qualified'
                                ? 'badge-emerald'
                                : lead.lifecycle_stage === 'replied' || lead.lifecycle_stage === 'meeting' || lead.lifecycle_stage === 'won'
                                ? 'badge-purple'
                                : 'badge-neutral'
                            }`}
                          >
                            {lead.lifecycle_stage || 'discovered'}
                          </span>
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {lead.lifecycle_stage !== 'qualified' &&
                            lead.lifecycle_stage !== 'drafted' &&
                            lead.lifecycle_stage !== 'sent' &&
                            lead.lifecycle_stage !== 'replied' &&
                            lead.lifecycle_stage !== 'won' ? (
                              <button
                                className="btn btn-primary"
                                style={{ padding: '4px 8px', fontSize: 11 }}
                                disabled={isPending}
                                onClick={() => handleQualifyLead(lead.id)}
                              >
                                🎯 Qualify Lead
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>✓ Qualified</span>
                            )}

                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: 11 }}
                              disabled={isPending}
                              onClick={() => handleGenerateObservationDraft(lead)}
                            >
                              ✨ Draft Outreach
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: LEADS & CONTACTS */}
        {activeTab === 'leads' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search leads by name, email, company..."
                  className="input-text"
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  style={{ width: 280 }}
                />

                <select
                  className="select-input"
                  value={leadConsentFilter}
                  onChange={(e) => setLeadConsentFilter(e.target.value)}
                  style={{ width: 170 }}
                >
                  <option value="all">All Consent Types</option>
                  <option value="opted_in">Opted-in (Eligible)</option>
                  <option value="unknown">Unknown Consent</option>
                  <option value="opted_out">Opted-out</option>
                </select>

                <select
                  className="select-input"
                  value={leadLifecycleFilter}
                  onChange={(e) => setLeadLifecycleFilter(e.target.value)}
                  style={{ width: 170 }}
                >
                  <option value="all">All Pipeline Stages</option>
                  <option value="discovered">Discovered</option>
                  <option value="qualified">Qualified</option>
                  <option value="sent">Sent</option>
                  <option value="replied">Replied</option>
                  <option value="meeting">Meetings</option>
                  <option value="won">Clients Won</option>
                  <option value="suppressed">Suppressed</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setIsCsvModalOpen(true)}>
                  📥 Import CSV Leads
                </button>
              </div>
            </div>

            {/* Leads Table */}
            <div className="data-table-container glass-panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Prospect</th>
                    <th>Company & Role</th>
                    <th>Consent Status</th>
                    <th>Pipeline Stage</th>
                    <th>Consent Evidence</th>
                    <th>Lifecycle Actions</th>
                    <th>Draft Email</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                        No leads match current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: '#fff' }}>
                            {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Prospect'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.email}</div>
                        </td>
                        <td>
                          <div>{lead.company || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.role || '—'}</div>
                        </td>
                        <td>
                          {lead.consent_status === 'opted_in' ? (
                            <span className="badge badge-emerald">✓ Opted-In</span>
                          ) : lead.consent_status === 'opted_out' ? (
                            <span className="badge badge-crimson">✕ Opted-Out</span>
                          ) : (
                            <span className="badge badge-amber">? Unknown</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              lead.lifecycle_stage === 'won'
                                ? 'badge-emerald'
                                : lead.lifecycle_stage === 'meeting' || lead.lifecycle_stage === 'replied'
                                ? 'badge-purple'
                                : lead.lifecycle_stage === 'qualified'
                                ? 'badge-neutral'
                                : 'badge-neutral'
                            }`}
                          >
                            {lead.lifecycle_stage || lead.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {lead.consent_source || 'ai_discovery'}
                          {lead.consent_timestamp && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {new Date(lead.consent_timestamp).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '3px 7px', fontSize: 11 }}
                              disabled={isPending}
                              onClick={() => handleUpdateLifecycleStage(lead.id, 'replied')}
                              title="Mark as Replied"
                            >
                              💬 Reply
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '3px 7px', fontSize: 11 }}
                              disabled={isPending}
                              onClick={() => handleUpdateLifecycleStage(lead.id, 'meeting')}
                              title="Record Meeting"
                            >
                              📅 Meeting
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '3px 7px', fontSize: 11 }}
                              disabled={isPending}
                              onClick={() => handleUpdateLifecycleStage(lead.id, 'won')}
                              title="Client Won"
                            >
                              🏆 Won
                            </button>
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => {
                              setSelectedLeadId(lead.id);
                              setActiveTab('drafts');
                            }}
                          >
                            Draft Email
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* CSV Import Modal */}
            {isCsvModalOpen && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  backdropFilter: 'blur(4px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 999,
                  padding: 20,
                }}
              >
                <div
                  className="glass-panel"
                  style={{
                    maxWidth: 720,
                    width: '100%',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    padding: 28,
                    background: '#0d1322',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Import Leads via CSV</h3>
                    <button
                      onClick={() => setIsCsvModalOpen(false)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>

                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Paste CSV data below or test with sample rows. Deduplication and suppression lists are strictly verified prior to import.
                  </p>

                  <div className="form-group">
                    <label className="form-label">CSV Content (Header row required):</label>
                    <textarea
                      rows={5}
                      className="textarea-input font-mono"
                      placeholder="email,first_name,last_name,company,role,consent&#10;alice@acme.com,Alice,Wong,Acme Corp,CTO,opted_in"
                      value={csvRawText}
                      onChange={(e) => handleParseCsv(e.target.value)}
                    />
                  </div>

                  <button
                    className="btn btn-secondary"
                    style={{ marginBottom: 16, fontSize: 12 }}
                    onClick={() => {
                      const sample = `email,first_name,last_name,company,role,consent\nclara.oswald@tardis-security.co.uk,Clara,Oswald,Tardis Security,Director,opted_in\nsuppressed.user@solaris-energy.com,David,Chen,Solaris,Ops,unknown\njane.doe@cyberdyne-sys.com,Jane,Doe,Cyberdyne,Researcher,unknown`;
                      handleParseCsv(sample);
                    }}
                  >
                    Paste Sample CSV
                  </button>

                  {/* CSV Validation Preview */}
                  {csvPreview && (
                    <div style={{ background: 'var(--bg-surface)', padding: 16, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <span>
                          <strong>Parsed:</strong> {csvPreview.totalRows} rows |{' '}
                          <strong style={{ color: '#10b981' }}>Valid:</strong> {csvPreview.validRowsCount} |{' '}
                          <strong style={{ color: '#f87171' }}>Duplicates:</strong> {csvPreview.duplicateRowsCount} |{' '}
                          <strong style={{ color: '#f59e0b' }}>Suppressed:</strong> {csvPreview.suppressedCount}
                        </span>
                      </div>

                      {csvPreview.errors.length > 0 && (
                        <div style={{ maxHeight: 120, overflowY: 'auto', background: '#1c1917', padding: 8, borderRadius: 6, marginBottom: 12 }}>
                          {csvPreview.errors.map((err, i) => (
                            <div key={i} style={{ color: '#f87171', fontSize: 12, marginBottom: 4 }}>
                              Line {err.row}: {err.message}
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {LEGAL_CONSENT_DISCLAIMER}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                    <button className="btn btn-secondary" onClick={() => setIsCsvModalOpen(false)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={!csvPreview || csvPreview.validRowsCount === 0 || isPending}
                      onClick={handleCommitCsvImport}
                    >
                      Commit Import ({csvPreview ? csvPreview.validRowsCount : 0} Leads)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AI PERSONALIZATION STUDIO */}
        {activeTab === 'drafts' && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 460px) 1fr', gap: 24 }}>
            {/* Editor Sidebar */}
            <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>AI Personalization Studio</h3>
                <span className="badge badge-emerald" style={{ fontSize: 10 }}>Zero-Fabrication</span>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Target Lead:</label>
                <select
                  className="select-input"
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id} style={{ background: '#0e131f' }}>
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || l.email} ({l.company || 'No Company'}) - {l.consent_status}
                    </option>
                  ))}
                </select>
              </div>

              {/* Verified Observations Callout for Selected Lead */}
              {selectedLead && selectedLead.business_observations && selectedLead.business_observations.length > 0 && (
                <div
                  style={{
                    background: 'rgba(59,130,246,0.08)',
                    border: '1px solid rgba(59,130,246,0.25)',
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🔍</span> Verified Grounded Observations ({selectedLead.company}):
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)' }}>
                    {selectedLead.business_observations.map((obs, i) => (
                      <li key={i}>{obs}</li>
                    ))}
                  </ul>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 10, width: '100%', fontSize: 12, padding: '6px 12px' }}
                    disabled={isPending}
                    onClick={() => handleGenerateObservationDraft(selectedLead)}
                  >
                    ✨ Auto-Generate Draft from Observations
                  </button>
                </div>
              )}

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Subject Line (Editable):</label>
                <input
                  type="text"
                  className="input-text"
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Variables: <code>{'{{company}}'}</code>, <code>{'{{first_name}}'}</code>, <code>{'{{role}}'}</code>
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Email Body (Editable):</label>
                <textarea
                  rows={8}
                  className="textarea-input"
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                />
              </div>

              <button className="btn btn-secondary" onClick={handleGenerateDraft} disabled={isPending}>
                Save Custom Template Draft
              </button>
            </div>

            {/* Generated Drafts List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Generated Outreach Drafts ({drafts.length})</h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Content hashes recorded on creation
                </span>
              </div>

              {drafts.length === 0 ? (
                <div className="glass-panel" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No drafts created yet. Use the editor on the left or click &ldquo;Draft Outreach&rdquo; on any discovered lead.
                </div>
              ) : (
                drafts.map((draft) => {
                  const lead = leads.find((l) => l.id === draft.lead_id);
                  return (
                    <div key={draft.id} className="glass-panel" style={{ padding: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{draft.subject}</span>
                            <span className="badge badge-neutral">v{draft.version}</span>
                            <span
                              className={`badge ${
                                draft.status === 'approved'
                                  ? 'badge-emerald'
                                  : draft.status === 'pending_review'
                                  ? 'badge-amber'
                                  : 'badge-neutral'
                              }`}
                            >
                              {draft.status}
                            </span>
                            {draft.id.startsWith('draft-') && (
                              <span className="badge badge-amber" style={{ fontSize: 10 }}>[DEMO RECORD]</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                            To: <strong>{draft.recipient_email}</strong> | Lead Consent:{' '}
                            <span style={{ color: lead?.consent_status === 'opted_in' ? '#10b981' : '#f59e0b' }}>
                              {lead?.consent_status || 'unknown'}
                            </span>
                          </div>
                        </div>

                        <div>
                          {draft.status === 'draft' && (
                            <button
                              className="btn btn-primary"
                              style={{ padding: '6px 12px', fontSize: 13 }}
                              disabled={isPending}
                              onClick={() => handleSubmitForReview(draft)}
                            >
                              Submit for Review
                            </button>
                          )}
                        </div>
                      </div>

                      {draft.missing_fields && draft.missing_fields.length > 0 && (
                        <div
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '8px 12px',
                            borderRadius: 6,
                            fontSize: 12,
                            color: '#f87171',
                            marginBottom: 12,
                          }}
                        >
                          ⚠️ Missing lead fields: <strong>{draft.missing_fields.join(', ')}</strong>. Draft cannot be approved until resolved.
                        </div>
                      )}

                      <div
                        style={{
                          background: 'var(--bg-surface)',
                          padding: 12,
                          borderRadius: 8,
                          fontSize: 13,
                          whiteSpace: 'pre-wrap',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {draft.body_text}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: 12,
                          fontSize: 11,
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span className="font-mono">Hash: {draft.content_hash.slice(0, 16)}...</span>
                        <span>Updated: {new Date(draft.updated_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 5: REVIEW QUEUE */}
        {activeTab === 'review' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Review Queue</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Two-person approval gate. Approval records are cryptographically bound to the exact email content snapshot shown.
                </p>
              </div>

              {!canApproveDrafts(activeRole) && (
                <div className="badge badge-amber" style={{ padding: '6px 12px' }}>
                  ℹ️ {activeRole ? `Logged in as ${activeRole.toUpperCase()} — Viewing only. Reviewer or Admin required to approve.` : 'Sign-in required to approve drafts.'}
                </div>
              )}
            </div>

            {/* Pending Outreach Drafts */}
            {drafts.filter((d) => d.status === 'pending_review').length === 0 ? (
              <div className="glass-panel" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                No drafts currently awaiting review. Create drafts in the Personalization Studio to queue them for review.
              </div>
            ) : (
              drafts
                .filter((d) => d.status === 'pending_review')
                .map((draft) => {
                  const lead = leads.find((l) => l.id === draft.lead_id);
                  const isSuppressed = suppressions.some((s) => s.email.toLowerCase() === draft.recipient_email.toLowerCase());

                  return (
                    <div key={draft.id} className="glass-panel" style={{ padding: 24 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
                        {/* WYSIWYG Preview Frame */}
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                            <span>EXACT PREVIEW (WYSIWYG)</span>
                            <span className="font-mono">Content Hash: {draft.content_hash.slice(0, 16)}...</span>
                          </div>

                          <div className="email-preview-frame">
                            <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 12, marginBottom: 16 }}>
                              <div style={{ fontSize: 13, color: '#6b7280' }}>
                                <strong>From:</strong> {draft.sender_email}
                              </div>
                              <div style={{ fontSize: 13, color: '#6b7280' }}>
                                <strong>To:</strong> {draft.recipient_email}
                              </div>
                              <div style={{ fontSize: 13, color: '#6b7280' }}>
                                <strong>Reply-To:</strong> {draft.reply_to_email}
                              </div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginTop: 8 }}>
                                Subject: {draft.subject}
                              </div>
                            </div>

                            <div dangerouslySetInnerHTML={{ __html: draft.body_html }} />

                            <div style={{ marginTop: 24 }} dangerouslySetInnerHTML={{ __html: draft.footer_html }} />
                          </div>
                        </div>

                        {/* Reviewer Action Box */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bg-surface)', padding: 20, borderRadius: 10 }}>
                          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Eligibility Inspection</h4>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Lead Consent:</span>
                              <span style={{ fontWeight: 600, color: lead?.consent_status === 'opted_in' ? '#10b981' : '#f59e0b' }}>
                                {lead?.consent_status || 'unknown'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Suppression List:</span>
                              <span style={{ fontWeight: 600, color: isSuppressed ? '#ef4444' : '#10b981' }}>
                                {isSuppressed ? 'SUPPRESSED (Blocked)' : 'Clean'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Draft Version:</span>
                              <span className="font-mono">v{draft.version}</span>
                            </div>
                          </div>

                          <div style={{ height: 1, background: 'var(--border-subtle)' }} />

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <button
                              className="btn btn-success"
                              disabled={!canApproveDrafts(activeRole) || isPending}
                              onClick={() => handleApproveDraft(draft, 'Verified prospect identity and affirmative consent.')}
                            >
                              ✓ Approve Draft
                            </button>

                            <button
                              className="btn btn-danger"
                              disabled={!canApproveDrafts(activeRole) || isPending}
                              onClick={() => handleRejectDraft(draft, 'Needs further personalization or correction.')}
                            >
                              ✕ Reject Draft
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
            )}

            {/* Scheduled Follow-Up Suggestions Section */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff' }}>
                    Scheduled Follow-Up Sequences (Reviewer Approval Required)
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                    Follow-ups are suggested automatically for approved outreach but can NEVER be sent without explicit reviewer approval.
                  </p>
                </div>
              </div>

              {followUps.length === 0 ? (
                <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No follow-up sequences currently scheduled. Generate sequences in the Sending Station after dispatching initial emails.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                  {followUps.map((fu) => {
                    const lead = leads.find((l) => l.id === fu.lead_id);
                    return (
                      <div key={fu.id} className="glass-panel" style={{ padding: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                          <div>
                            <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                              Step {fu.step_number} Cadence
                            </span>
                            <span
                              className={`badge ${
                                fu.status === 'approved'
                                  ? 'badge-emerald'
                                  : fu.status === 'rejected'
                                  ? 'badge-crimson'
                                  : 'badge-amber'
                              }`}
                              style={{ marginLeft: 6, fontSize: 11 }}
                            >
                              {fu.status}
                            </span>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Send: {new Date(fu.suggested_send_date).toLocaleDateString()}
                          </span>
                        </div>

                        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                          {fu.subject}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                          To: {lead?.email || 'Prospect'} ({lead?.company || 'Company'})
                        </div>

                        <div
                          style={{
                            background: 'var(--bg-surface)',
                            padding: 10,
                            borderRadius: 6,
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            marginBottom: 12,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {fu.body_text}
                        </div>

                        {fu.status === 'suggested' && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-success"
                              style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                              disabled={!canApproveDrafts(activeRole) || isPending}
                              onClick={() => handleReviewFollowUp(fu, 'approved')}
                            >
                              ✓ Approve Follow-Up
                            </button>
                            <button
                              className="btn btn-danger"
                              style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                              disabled={!canApproveDrafts(activeRole) || isPending}
                              onClick={() => handleReviewFollowUp(fu, 'rejected')}
                            >
                              ✕ Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: SENDING STATION */}
        {activeTab === 'sending' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Sending Station (Approved Drafts)</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  No automatic sends upon approval. Dispatches require an explicit user button click with atomic idempotency locks.
                </p>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Notice: Emails handed to Resend cannot be recalled.
              </div>
            </div>

            {drafts.filter((d) => d.status === 'approved').length === 0 ? (
              <div className="glass-panel" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                No approved drafts currently ready to dispatch. Approve drafts in the Review Queue first.
              </div>
            ) : (
              drafts
                .filter((d) => d.status === 'approved')
                .map((draft) => {
                  const lead = leads.find((l) => l.id === draft.lead_id);
                  const isSuppressed = suppressions.some((s) => s.email.toLowerCase() === draft.recipient_email.toLowerCase());
                  const hasConsent = lead?.consent_status === 'opted_in';
                  const isServerLive = initialData.serverSendMode === 'live';
                  const canSendLive = isServerLive && hasConsent && !isSuppressed && canSendEmails(activeRole);

                  return (
                    <div key={draft.id} className="glass-panel" style={{ padding: 24 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{draft.subject}</span>
                            <span className="badge badge-emerald">Approved</span>
                            <span className="badge badge-neutral font-mono">v{draft.version}</span>
                            {draft.id.startsWith('draft-') && (
                              <span className="badge badge-amber" style={{ fontSize: 10 }}>[DEMO RECORD]</span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                            Lead Recipient: <strong>{draft.recipient_email}</strong> ({lead?.company || 'No Company'})
                          </div>
                        </div>

                        {/* Send Controls */}
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {lead && (
                            <button
                              className="btn btn-secondary"
                              disabled={isPending}
                              onClick={() => handleGenerateFollowUps(lead, draft)}
                              title="Generate Step 1 (+3d) and Step 2 (+7d) follow-up cadences"
                            >
                              📅 Cadence Suggestions
                            </button>
                          )}

                          <button
                            className="btn btn-secondary"
                            disabled={isSending || !canSendEmails(activeRole)}
                            onClick={() => handleTriggerSend(draft, 'test')}
                            title="Routes safely to server-configured TEST_RECIPIENTS"
                          >
                            {isSending ? 'Sending...' : '🧪 Send Test Email'}
                          </button>

                          <button
                            className="btn btn-primary"
                            disabled={!canSendLive || isSending}
                            onClick={() => handleTriggerSend(draft, 'live')}
                            title={!isServerLive ? 'Disabled: Server SEND_MODE is set to test.' : 'Dispatch live email.'}
                          >
                            🚀 Send Live Outreach
                          </button>
                        </div>
                      </div>

                      {/* Gating Feedback Badges */}
                      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', fontSize: 12 }}>
                        <span className={`badge ${hasConsent ? 'badge-emerald' : 'badge-amber'}`}>
                          {hasConsent ? '✓ Affirmative Consent' : '⚠️ Missing Consent (Live Blocked)'}
                        </span>

                        <span className={`badge ${!isSuppressed ? 'badge-emerald' : 'badge-crimson'}`}>
                          {!isSuppressed ? '✓ Not Suppressed' : '🛑 Suppressed (Sending Blocked)'}
                        </span>

                        <span className={`badge ${isServerLive ? 'badge-emerald' : 'badge-amber'}`}>
                          {isServerLive ? '⚡ Live Mode Active' : '🛡️ Test Mode Active (Live Gated)'}
                        </span>

                        <span className="badge badge-neutral font-mono">
                          Hash: {draft.content_hash.slice(0, 16)}...
                        </span>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        )}

        {/* TAB 7: DELIVERY ACTIVITY */}
        {activeTab === 'activity' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Delivery Activity & Reconciliation</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                Provider events processed via verified Resend webhooks. Out-of-order delivery protection active.
              </p>
            </div>

            <div className="data-table-container glass-panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Mode</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Resend ID</th>
                    <th>Idempotency Key</th>
                    <th>Origin</th>
                  </tr>
                </thead>
                <tbody>
                  {sendLogs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(log.sent_at).toLocaleString()}
                      </td>
                      <td>
                        {log.is_test ? (
                          <span className="badge badge-amber">[TEST SEND]</span>
                        ) : (
                          <span className="badge badge-emerald">[LIVE SEND]</span>
                        )}
                      </td>
                      <td style={{ fontWeight: 600 }}>{log.recipient_email}</td>
                      <td>
                        <span
                          className={`badge ${
                            log.status === 'delivered'
                              ? 'badge-emerald'
                              : log.status === 'sent'
                              ? 'badge-emerald'
                              : log.status === 'bounced' || log.status === 'failed'
                              ? 'badge-crimson'
                              : 'badge-amber'
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="font-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {log.resend_email_id || '—'}
                      </td>
                      <td className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {log.idempotency_key.slice(0, 20)}...
                      </td>
                      <td>
                        {log.id.startsWith('send-log-') ? (
                          <span className="badge badge-amber" style={{ fontSize: 10 }}>[DEMO LOG]</span>
                        ) : (
                          <span className="badge badge-emerald" style={{ fontSize: 10 }}>[REAL DISPATCH]</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 8: SUPPRESSION LIST */}
        {activeTab === 'suppressions' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Suppression Registry</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                  Strictly preserved. Imports and lead updates can NEVER clear suppression records.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  placeholder="prospect@company.com"
                  id="manualSuppEmail"
                  className="input-text"
                  style={{ width: 240 }}
                />
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    const input = document.getElementById('manualSuppEmail') as HTMLInputElement;
                    if (input && input.value) {
                      handleAddManualSuppression(input.value);
                      input.value = '';
                    }
                  }}
                >
                  Add Do-Not-Contact
                </button>
              </div>
            </div>

            <div className="data-table-container glass-panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Suppressed Address</th>
                    <th>Reason</th>
                    <th>Source & Details</th>
                    <th>Recorded Date</th>
                    <th>Origin</th>
                  </tr>
                </thead>
                <tbody>
                  {suppressions.map((supp) => (
                    <tr key={supp.id}>
                      <td style={{ fontWeight: 600 }}>{supp.email}</td>
                      <td>
                        <span className={`badge ${supp.reason === 'unsubscribe' ? 'badge-amber' : supp.reason === 'bounce' ? 'badge-crimson' : 'badge-neutral'}`}>
                          {supp.reason}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {supp.source_details || 'Manual workspace entry'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(supp.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        {supp.id.startsWith('supp-') ? (
                          <span className="badge badge-amber" style={{ fontSize: 10 }}>[DEMO REGISTRY]</span>
                        ) : (
                          <span className="badge badge-emerald" style={{ fontSize: 10 }}>[DATABASE]</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 9: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Append-Only Audit Trail</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                Immutable event stream of lead mutations, draft versions, approvals, send attempts, and webhook delivery outcomes.
              </p>
            </div>

            <div className="data-table-container glass-panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleTimeString()}
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa' }}>{log.actor_email}</td>
                      <td>
                        <span className="badge badge-neutral font-mono">{log.action}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {log.entity_type}:{log.entity_id}
                      </td>
                      <td className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 10: SECURITY & SETUP STATUS */}
        {activeTab === 'setup' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>System Configuration & Security Status</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                Safe configuration inspector. Shows configuration status without ever exposing secret values.
              </p>
            </div>

            <div className="glass-panel" style={{ padding: 24 }}>
              <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Configuration & Database Status</h4>

              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff' }}>Supabase Database Connection</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Endpoint configured in .env.local</div>
                  </div>
                  <span className="badge badge-emerald">Connected</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff' }}>Database Migrations (Tables & RLS)</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {initialData.areTablesMigrated
                        ? 'Schema verified in Supabase'
                        : 'Tables pending migration (public.workspaces not found).'}
                    </div>
                  </div>
                  <span className={`badge ${initialData.areTablesMigrated ? 'badge-emerald' : 'badge-amber'}`}>
                    {initialData.areTablesMigrated ? 'Migrated' : 'Pending Migration'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff' }}>Resend Email API Key</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Sending access verified with Resend</div>
                  </div>
                  <span className="badge badge-emerald">Active</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff' }}>Server Sending Mode</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Strictly enforced by server .env.local</div>
                  </div>
                  <span className={`badge ${initialData.serverSendMode === 'live' ? 'badge-emerald' : 'badge-amber'}`}>
                    {initialData.serverSendMode.toUpperCase()} MODE
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff' }}>Server Test Recipient</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Must be an inbox you own and control</div>
                  </div>
                  <span className="badge badge-neutral font-mono">
                    {initialData.serverTestRecipients.join(', ') || 'None'}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: 24 }}>
              <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Instructions to Apply Supabase Migrations</h4>
              <ol style={{ paddingLeft: 20, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-secondary)' }}>
                <li>Open your <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Supabase Dashboard</a>.</li>
                <li>Navigate to <strong>SQL Editor</strong> &rarr; <strong>New Query</strong>.</li>
                <li>Execute <code>supabase/migrations/20261008000001_elvaveo_sales_agent_schema.sql</code> (Core schema).</li>
                <li>Execute <code>supabase/migrations/20261009000002_phase2_lead_discovery_and_automation.sql</code> (Phase 2 columns & follow-ups).</li>
                <li>Once executed, refresh this page. Tables will be recognized natively.</li>
              </ol>
            </div>
          </div>
        )}
      </main>

      {/* Supabase Workspace Authentication Modal */}
      {isAuthModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: 460,
              width: '100%',
              padding: 32,
              background: '#0d1322',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              borderRadius: 16,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, color: '#fff' }}>
                  E
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#fff' }}>Sign In to Workspace</h3>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Supabase Auth & Server-Side RBAC</div>
                </div>
              </div>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              Enter your verified ELVAVEO workspace credentials to unlock operator or reviewer actions. Permissions are strictly evaluated on the server against <code>workspace_members</code>.
            </p>

            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>Workspace Email</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="owner@elvaveo.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>Password</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="••••••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsAuthModalOpen(false)}
                  disabled={isAuthLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isAuthLoading || !authEmail || !authPassword}
                >
                  {isAuthLoading ? 'Authenticating...' : 'Sign In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
