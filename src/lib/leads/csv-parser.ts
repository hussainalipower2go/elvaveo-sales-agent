// ==============================================================================
// ELVAVEO Sales Agent - Lead CSV Parser & Validation Engine
// ==============================================================================

import Papa from 'papaparse';
import { LeadConsentStatus } from '../types/database';

export interface CsvLeadRow {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  role?: string;
  website?: string;
  source?: string;
  notes?: string;
  consent_status?: LeadConsentStatus;
  consent_source?: string;
}

export interface CsvValidationError {
  row: number;
  email?: string;
  field: string;
  message: string;
}

export interface CsvParsePreview {
  totalRows: number;
  validRowsCount: number;
  duplicateRowsCount: number;
  errors: CsvValidationError[];
  validRows: CsvLeadRow[];
  suppressedCount: number;
  headers: string[];
}

export const LEGAL_CONSENT_DISCLAIMER =
  'Notice: Recording affirmative consent helps maintain internal outreach compliance, but does not inherently guarantee compliance with all international privacy and anti-spam regulations (CAN-SPAM, GDPR, CASL). Consult legal counsel for jurisdiction-specific requirements.';

/**
 * Normalizes email address by trimming whitespace and converting to lowercase.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Validates standard email address syntax.
 */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(email);
}

/**
 * Maps arbitrary header keys to normalized field names.
 */
function findHeaderField(headers: string[], candidates: string[]): string | null {
  const normHeaders = headers.map((h) => h.toLowerCase().trim().replace(/[-_ ]/g, ''));
  for (const candidate of candidates) {
    const normCand = candidate.toLowerCase().replace(/[-_ ]/g, '');
    const idx = normHeaders.indexOf(normCand);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

/**
 * Parses and validates CSV lead files.
 * Previews validation errors before committing.
 * Deduplicates rows and checks against existing suppressions without clearing them.
 */
export function parseAndValidateCsv(
  csvContent: string,
  existingEmails: Set<string> = new Set(),
  suppressedEmails: Set<string> = new Set()
): CsvParsePreview {
  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const headers = parsed.meta.fields || [];
  const errors: CsvValidationError[] = [];
  const validRows: CsvLeadRow[] = [];

  const emailCol = findHeaderField(headers, ['email', 'workemail', 'emailaddress', 'contactemail']);
  const firstNameCol = findHeaderField(headers, ['firstname', 'first', 'givenname']);
  const lastNameCol = findHeaderField(headers, ['lastname', 'last', 'surname']);
  const companyCol = findHeaderField(headers, ['company', 'companyname', 'organization', 'account']);
  const roleCol = findHeaderField(headers, ['role', 'title', 'jobtitle', 'position']);
  const websiteCol = findHeaderField(headers, ['website', 'url', 'companywebsite', 'domain']);
  const sourceCol = findHeaderField(headers, ['source', 'leadsource']);
  const notesCol = findHeaderField(headers, ['notes', 'comment', 'description']);
  const consentCol = findHeaderField(headers, ['consent', 'consentstatus', 'optin']);
  const consentSourceCol = findHeaderField(headers, ['consentsource', 'optinsource']);

  if (!emailCol) {
    return {
      totalRows: 0,
      validRowsCount: 0,
      duplicateRowsCount: 0,
      errors: [
        {
          row: 1,
          field: 'email',
          message: 'Missing required "email" column in CSV header.',
        },
      ],
      validRows: [],
      suppressedCount: 0,
      headers,
    };
  }

  const seenInBatch = new Set<string>();
  let duplicateCount = 0;
  let suppressedCount = 0;

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for header line
    const rawEmail = emailCol ? row[emailCol] : '';
    const email = normalizeEmail(rawEmail);

    if (!email) {
      errors.push({
        row: rowNumber,
        field: 'email',
        message: 'Empty or missing email address.',
      });
      return;
    }

    if (!isValidEmail(email)) {
      errors.push({
        row: rowNumber,
        email,
        field: 'email',
        message: `Invalid email format: "${rawEmail}".`,
      });
      return;
    }

    if (seenInBatch.has(email)) {
      duplicateCount++;
      errors.push({
        row: rowNumber,
        email,
        field: 'email',
        message: `Duplicate email within CSV: "${email}" already seen in earlier row.`,
      });
      return;
    }

    if (existingEmails.has(email)) {
      duplicateCount++;
      errors.push({
        row: rowNumber,
        email,
        field: 'email',
        message: `Duplicate email: "${email}" already exists in this workspace.`,
      });
      return;
    }

    seenInBatch.add(email);

    if (suppressedEmails.has(email)) {
      suppressedCount++;
      errors.push({
        row: rowNumber,
        email,
        field: 'suppression',
        message: `Suppressed: "${email}" is on the workspace suppression list and will remain suppressed.`,
      });
      // We still permit import, but flag it prominently, and suppression will NEVER be cleared.
    }

    let consentStatus: LeadConsentStatus = 'unknown';
    const rawConsent = consentCol ? row[consentCol]?.toLowerCase().trim() : '';
    if (['opted_in', 'opted-in', 'yes', 'true', 'optin', 'explicit'].includes(rawConsent)) {
      consentStatus = 'opted_in';
    } else if (['opted_out', 'opted-out', 'no', 'false', 'optout', 'unsubscribed'].includes(rawConsent)) {
      consentStatus = 'opted_out';
    }

    validRows.push({
      email,
      first_name: firstNameCol ? row[firstNameCol]?.trim() || undefined : undefined,
      last_name: lastNameCol ? row[lastNameCol]?.trim() || undefined : undefined,
      company: companyCol ? row[companyCol]?.trim() || undefined : undefined,
      role: roleCol ? row[roleCol]?.trim() || undefined : undefined,
      website: websiteCol ? row[websiteCol]?.trim() || undefined : undefined,
      source: sourceCol ? row[sourceCol]?.trim() || undefined : 'csv_import',
      notes: notesCol ? row[notesCol]?.trim() || undefined : undefined,
      consent_status: consentStatus,
      consent_source: consentSourceCol ? row[consentSourceCol]?.trim() || undefined : 'csv_import',
    });
  });

  return {
    totalRows: parsed.data.length,
    validRowsCount: validRows.length,
    duplicateRowsCount: duplicateCount,
    errors,
    validRows,
    suppressedCount,
    headers,
  };
}
