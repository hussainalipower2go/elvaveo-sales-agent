// ==============================================================================
// ELVAVEO Sales Agent - Physical Postal Address Validation Engine
// ==============================================================================
// CAN-SPAM (16 CFR Part 316) & International Postal Compliance Validator.
// Verifies genuine postal address structure (street/number/box, city, state/province,
// postal code, country) and strictly rejects placeholders and minimum-length bypasses.
// ==============================================================================

export interface AddressValidationResult {
  valid: boolean;
  errors: string[];
  normalizedAddress?: string;
  detectedCountry?: string;
  components?: {
    premises?: string;
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
}

const BANNED_PLACEHOLDERS = [
  'innovation way',
  'fake street',
  'dummy address',
  'sample address',
  'lorem ipsum',
  'test address',
  'example st',
  'asdf',
  'unknown address',
  'not provided',
  'placeholder',
];

// Jurisdictions that do not have mandatory or standard postal/ZIP codes
const COUNTRIES_WITHOUT_POSTAL_CODES = new Set([
  'united arab emirates',
  'uae',
  'u.a.e.',
  'dubai',
  'abu dhabi',
  'qatar',
  'hong kong',
  'hk',
  'h.k.',
  'macau',
  'macao',
  'panama',
  'bahamas',
  'bermuda',
  'fiji',
  'seychelles',
  'vanuatu',
]);

// Postal code patterns for global jurisdictions with standard codes (US, Canada, UK, Europe, Australia, India, etc.)
const POSTAL_CODE_REGEX = /\b(\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d|[A-Z]{1,2}\d[A-Z\d]?[ -]?\d[A-Z]{2}|\d{3}[ -]?\d{3}|\d{4,6})\b/i;

// Broad international premises indicators (street number, PO Box, building, tower, floor, suite, office, unit, plot, block)
const PREMISES_REGEX = /\b(\d{1,6}[A-Za-z]?\s+[A-Za-z0-9#.,\s-]+|p\.?o\.?\s*box\s*\d+|suite|ste\.?|apt\.?|unit|fl\.?|floor|level|lvl|bldg|building|tower|towers|complex|plaza|centre|center|park|gate|square|house|villa|block|plot|sector|office|bay|wharf|avenue|ave|street|st|road|rd|boulevard|blvd|lane|ln|drive|dr|way)\b/i;

// Recognizable country tokens
const COUNTRY_REGEX = /\b(united states|usa|u\.s\.a\.|u\.s\.|us|canada|ca|united kingdom|uk|u\.k\.|great britain|gb|germany|deutschland|de|france|fr|australia|au|new zealand|nz|ireland|ie|netherlands|nl|singapore|sg|japan|jp|switzerland|ch|austria|at|sweden|se|norway|no|denmark|dk|finland|fi|italy|it|spain|es|india|in|brazil|br|mexico|mx|united arab emirates|uae|u\.a\.e\.|qatar|saudi arabia|ksa|hong kong|hk|h\.k\.|macau|macao|panama|south africa|za|pakistan|pk)\b/i;

/**
 * Validates that an address is a genuine physical postal address with valid structure.
 * Respects international differences: countries without ZIP codes (e.g. UAE, Qatar, HK)
 * are not forced to provide a postal code, while US/UK/Canada/EU still require appropriate codes.
 */
export function validatePhysicalPostalAddress(rawAddress: string | null | undefined): AddressValidationResult {
  const errors: string[] = [];

  if (!rawAddress || typeof rawAddress !== 'string') {
    return {
      valid: false,
      errors: ['Missing physical postal address: address is empty or not provided.'],
    };
  }

  const cleaned = rawAddress.trim().replace(/\s+/g, ' ');

  if (cleaned.length < 15) {
    errors.push('Physical address is too short to be a valid postal address (minimum 15 characters required).');
  }

  const lower = cleaned.toLowerCase();
  for (const placeholder of BANNED_PLACEHOLDERS) {
    if (lower.includes(placeholder)) {
      errors.push(`Address contains invalid or prohibited placeholder text ("${placeholder}"). Provide your actual registered business address.`);
    }
  }

  // Check country identification
  const countryMatch = lower.match(COUNTRY_REGEX);
  if (!countryMatch) {
    errors.push('Address must explicitly specify the country (e.g. United States, United Kingdom, Canada, UAE, Germany, etc.).');
  }

  const detectedCountry = countryMatch ? countryMatch[0].trim() : undefined;
  const isNoPostalCodeCountry = detectedCountry ? COUNTRIES_WITHOUT_POSTAL_CODES.has(detectedCountry) : false;

  // Check for premises / building / street / suite
  if (!PREMISES_REGEX.test(cleaned)) {
    errors.push('Address must include a specific street address, building number, or registered P.O. Box.');
  }

  // Check for postal / ZIP code (only if country requires one)
  const postalCodeMatch = cleaned.match(POSTAL_CODE_REGEX);
  if (!isNoPostalCodeCountry && !postalCodeMatch) {
    errors.push('Address is missing a recognizable postal code or ZIP code (e.g. 78701, SW1A 1AA, K1A 0B1, 10115).');
  }

  // Multi-part verification: Postal addresses must have distinct postal components (e.g. comma or line-separated)
  const segments = cleaned.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 3) {
    errors.push('Address must be formatted with distinct postal components (e.g. "Street/Building, City/Region, Country").');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      detectedCountry,
    };
  }

  return {
    valid: true,
    errors: [],
    normalizedAddress: cleaned,
    detectedCountry,
    components: {
      premises: segments[0],
      city: segments[1],
      postalCode: postalCodeMatch ? postalCodeMatch[0] : undefined,
      country: segments[segments.length - 1],
    },
  };
}
