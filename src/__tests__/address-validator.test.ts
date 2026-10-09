// ==============================================================================
// ELVAVEO Sales Agent - Physical Postal Address Validator Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import { validatePhysicalPostalAddress } from '@/lib/email/address-validator';

describe('Physical Postal Address Validator (CAN-SPAM / International)', () => {
  it('rejects empty, null, and undefined addresses with clear diagnostic', () => {
    expect(validatePhysicalPostalAddress('')).toEqual({
      valid: false,
      errors: ['Missing physical postal address: address is empty or not provided.'],
    });
    expect(validatePhysicalPostalAddress(null)).toEqual({
      valid: false,
      errors: ['Missing physical postal address: address is empty or not provided.'],
    });
    expect(validatePhysicalPostalAddress(undefined)).toEqual({
      valid: false,
      errors: ['Missing physical postal address: address is empty or not provided.'],
    });
  });

  it('rejects addresses that only pass minimum length check but lack postal structure', () => {
    // 25 characters, but just a random string
    const arbitraryString = 'This is a long test string';
    const result = validatePhysicalPostalAddress(arbitraryString);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('strictly rejects known placeholder and dummy addresses', () => {
    const placeholders = [
      '100 Innovation Way, Austin, TX 78701, USA',
      '123 Fake Street, New York, NY 10001, USA',
      'Dummy Address, Suite 100, San Francisco, CA 94105, USA',
      'Sample Address 456, Chicago, IL 60601, USA',
      'Lorem Ipsum Dolor Sit Amet, London, UK',
    ];

    for (const address of placeholders) {
      const res = validatePhysicalPostalAddress(address);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('placeholder text'))).toBe(true);
    }
  });

  it('rejects incomplete addresses missing postal code or street number', () => {
    // Missing postal code
    const missingPostal = '100 Congress Ave, Austin, Texas, United States';
    const res1 = validatePhysicalPostalAddress(missingPostal);
    expect(res1.valid).toBe(false);
    expect(res1.errors.some((e) => e.includes('postal code or ZIP code'))).toBe(true);

    // Missing country
    const missingCountry = '500 4th Ave, Suite 300, Seattle, WA 98104';
    const res2 = validatePhysicalPostalAddress(missingCountry);
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes('must explicitly specify the country'))).toBe(true);

    // Missing premises / street indicator
    const missingStreet = 'Austin, TX 78701, United States';
    const res3 = validatePhysicalPostalAddress(missingStreet);
    expect(res3.valid).toBe(false);
    expect(res3.errors.some((e) => e.includes('street address, building number, or registered P.O. Box'))).toBe(true);
  });

  it('accepts valid, complete physical postal addresses across multiple jurisdictions', () => {
    const validAddresses = [
      '111 Congress Ave, Suite 400, Austin, TX 78701, United States',
      '350 5th Ave, Floor 25, New York, NY 10118, USA',
      '100 King Street West, Suite 5600, Toronto, ON M5X 1C9, Canada',
      '1 Canada Square, Canary Wharf, London, E14 5AA, United Kingdom',
      'P.O. Box 7890, San Jose, CA 95101, USA',
    ];

    for (const addr of validAddresses) {
      const res = validatePhysicalPostalAddress(addr);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.normalizedAddress).toBe(addr);
    }
  });

  it('accepts valid physical addresses in jurisdictions without postal codes (e.g. UAE, Qatar, Hong Kong)', () => {
    const internationalAddresses = [
      'Al Saada Tower, Level 15, DIFC, Dubai, United Arab Emirates',
      'Building 4, Office 202, Dubai Media City, UAE',
      'Two International Finance Centre, 8 Finance Street, Central, Hong Kong',
      'Tornado Tower, Floor 22, West Bay, Doha, Qatar',
    ];

    for (const addr of internationalAddresses) {
      const res = validatePhysicalPostalAddress(addr);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.normalizedAddress).toBe(addr);
    }
  });
});

