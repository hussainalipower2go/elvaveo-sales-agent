import { describe, it, expect } from 'vitest';
import {
  discoverLeadsWithFilters,
  getAvailableDiscoveryCountries,
  getAvailableDiscoveryServices,
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
