import { describe, it, expect } from 'vitest';
import {
  discoverLeadsWithFilters,
  getAvailableDiscoveryCountries,
  getAvailableDiscoveryServices,
  calculateLeadQualificationScore,
} from '@/lib/leads/discovery-service';
import { TargetCountry, TargetService } from '@/lib/types/database';

describe('Phase 2: Lead Discovery Engine & Safeguards', () => {
  it('supports the required target countries: USA, UK, UAE, Canada', () => {
    const countries = getAvailableDiscoveryCountries();
    expect(countries).toEqual(['USA', 'UK', 'UAE', 'Canada']);
  });

  it('supports the required target services: website_development, crm_development, custom_saas', () => {
    const services = getAvailableDiscoveryServices();
    expect(services).toEqual(['website_development', 'crm_development', 'custom_saas']);
  });

  it('filters discovered leads strictly by country', async () => {
    const countries: TargetCountry[] = ['USA', 'UK', 'UAE', 'Canada'];
    for (const country of countries) {
      const result = await discoverLeadsWithFilters({
        country,
        limit: 10,
      });

      expect(result.leads.length).toBeGreaterThan(0);
      result.leads.forEach((lead) => {
        expect(lead.country).toBe(country);
      });
    }
  });

  it('filters discovered leads strictly by service focus', async () => {
    const services: TargetService[] = ['website_development', 'crm_development', 'custom_saas'];
    for (const service of services) {
      const result = await discoverLeadsWithFilters({
        service,
        limit: 10,
      });

      expect(result.leads.length).toBeGreaterThan(0);
      result.leads.forEach((lead) => {
        expect(lead.target_service).toBe(service);
      });
    }
  });

  it('enforces confidence level thresholds', async () => {
    const highResult = await discoverLeadsWithFilters({
      confidence: 'high',
      limit: 10,
    });

    expect(highResult.leads.length).toBeGreaterThan(0);
    highResult.leads.forEach((lead) => {
      expect(lead.confidence_level).toBe('high');
    });
  });

  it('strictly assigns unknown permission to all discovered leads (never verified_opt_in)', async () => {
    const result = await discoverLeadsWithFilters({ limit: 10 });

    expect(result.leads.length).toBeGreaterThan(0);
    result.leads.forEach((lead) => {
      expect(lead.consent_status).toBe('unknown');
      expect(lead.permission_type).toBe('unknown');
      expect(lead.lifecycle_stage).toBe('discovered');
    });
  });

  it('stores verified source URLs, research dates, and technical observations without fabrication', async () => {
    const result = await discoverLeadsWithFilters({ limit: 10 });

    result.leads.forEach((lead) => {
      expect(lead.source_url).toBeDefined();
      expect(lead.source_url).toMatch(/^https?:\/\//);
      expect(lead.researched_at).toBeDefined();
      expect(new Date(lead.researched_at!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

      expect(lead.business_observations).toBeDefined();
      expect(Array.isArray(lead.business_observations)).toBe(true);
      expect(lead.business_observations!.length).toBeGreaterThan(0);

      // Verify no fabricated placeholders
      lead.business_observations!.forEach((obs) => {
        expect(obs.toLowerCase()).not.toContain('fabricated');
        expect(obs.toLowerCase()).not.toContain('lorem ipsum');
        expect(obs.length).toBeGreaterThan(10);
      });

      expect(lead.company).toBeTruthy();
      expect(lead.email).toContain('@');
    });
  });

  it('strictly deduplicates domains against existing leads', async () => {
    const initial = await discoverLeadsWithFilters({ limit: 5 });
    const existingDomains = initial.leads.map((l) => {
      const domain = l.website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '';
      return domain;
    });

    const deduped = await discoverLeadsWithFilters({
      existingDomains,
      limit: 10,
    });

    deduped.leads.forEach((lead) => {
      const leadDomain = lead.website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      expect(existingDomains).not.toContain(leadDomain);
    });
  });

  it('strictly respects configurable free-tier query limits', async () => {
    const limit = 2;
    const result = await discoverLeadsWithFilters({ limit });
    expect(result.leads.length).toBeLessThanOrEqual(limit);
  });
});

describe('Phase 3: Real Client Discovery, Qualification Scoring & Channel Safeguards', () => {
  it('calculates deterministic lead qualification scores with transparent breakdowns', () => {
    const breakdown = calculateLeadQualificationScore({
      confidenceLevel: 'high',
      targetService: 'website_development',
      observationsCount: 3,
      hasPublicChannel: true,
      country: 'USA',
      hasDirectEmail: true,
    });

    expect(breakdown.score).toBeGreaterThanOrEqual(85);
    expect(breakdown.score).toBeLessThanOrEqual(100);
    expect(breakdown.tier).toBe('high_priority');
    expect(breakdown.technicalSignalScore).toBe(40);
    expect(breakdown.serviceFitScore).toBe(30);
    expect(breakdown.channelReliabilityScore).toBe(20);
    expect(breakdown.marketPriorityScore).toBe(10);
    expect(breakdown.explanation).toContain('Score');
    expect(breakdown.reasons.length).toBeGreaterThan(0);
  });

  it('populates qualification score, explanation, and public contact channels on discovered leads', async () => {
    const result = await discoverLeadsWithFilters({ limit: 10 });

    expect(result.leads.length).toBeGreaterThan(0);
    result.leads.forEach((lead) => {
      expect(lead.qualification_score).toBeDefined();
      expect(lead.qualification_score).toBeGreaterThanOrEqual(60);
      expect(lead.qualification_score).toBeLessThanOrEqual(100);
      expect(lead.qualification_explanation).toBeTruthy();
      expect(lead.qualification_reasons).toBeDefined();
      expect(Array.isArray(lead.qualification_reasons)).toBe(true);

      // Public contact channel must be a legitimate verifiable public business channel
      expect(lead.public_contact_channel).toBeTruthy();
      expect(lead.public_contact_channel!.length).toBeGreaterThan(5);
    });
  });

  it('filters discovered leads by minimum qualification score threshold', async () => {
    const minScore = 85;
    const result = await discoverLeadsWithFilters({ minScore, limit: 10 });

    expect(result.leads.length).toBeGreaterThan(0);
    result.leads.forEach((lead) => {
      expect(lead.qualification_score).toBeGreaterThanOrEqual(minScore);
    });
  });

  it('verifies legitimate real companies exist for all target markets (USA, UK, UAE, Canada)', async () => {
    const markets: TargetCountry[] = ['USA', 'UK', 'UAE', 'Canada'];

    for (const country of markets) {
      const result = await discoverLeadsWithFilters({ country, limit: 5 });
      expect(result.leads.length).toBeGreaterThan(0);

      result.leads.forEach((lead) => {
        expect(lead.country).toBe(country);
        expect(lead.company).toBeTruthy();
        expect(lead.website).toMatch(/^https?:\/\//);
        expect(lead.public_contact_channel).toBeTruthy();
        // Public contact must NEVER be marked as affirmative marketing consent
        expect(lead.consent_status).toBe('unknown');
        expect(lead.permission_type).toBe('unknown');
      });
    }
  });

  it('never treats publicly listed corporate contact information as affirmative marketing consent', async () => {
    const result = await discoverLeadsWithFilters({ limit: 10 });

    result.leads.forEach((lead) => {
      expect(lead.consent_status).not.toBe('opted_in');
      expect(lead.permission_type).not.toBe('verified_opt_in');
      expect(lead.consent_status).toBe('unknown');
      expect(lead.permission_type).toBe('unknown');
    });
  });
});

