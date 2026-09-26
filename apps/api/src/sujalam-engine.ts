/**
 * Sujalam Bharat Integration Layer — Phase 2 engines (pure, provider-agnostic).
 *
 * Two side-effect-free engines the API composes over the declarative config
 * rows (FieldMapping, ValidationRule):
 *
 *  - mapEntity(): applies field mappings + transforms to turn an internal SWATI
 *    record into an external provider payload, reporting any required fields
 *    that came out empty.
 *  - validateEntity(): evaluates validation rules against an internal record,
 *    returning structured errors and warnings.
 *
 * Kept free of Prisma/Nest so it is trivially unit-testable and reusable by the
 * Phase 3 sync runner. The service layer loads the config rows and calls these.
 */

export type TransformType =
  | 'DIRECT'
  | 'CONSTANT'
  | 'UPPERCASE'
  | 'LOWERCASE'
  | 'TITLECASE'
  | 'TRIM'
  | 'DATE_ISO'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'MAP';

export interface MappingSpec {
  internalField: string;
  externalField: string;
  transform: TransformType | string;
  transformArg?: string | null;
  required?: boolean;
  enabled?: boolean;
}

export type RuleType =
  | 'REQUIRED'
  | 'REGEX'
  | 'MIN'
  | 'MAX'
  | 'ENUM'
  | 'LENGTH_MAX'
  | 'GIS_PRESENT';

export type Severity = 'ERROR' | 'WARNING';

export interface ValidationRuleSpec {
  field: string;
  ruleType: RuleType | string;
  param?: string | null;
  severity?: Severity | string;
  message: string;
  enabled?: boolean;
}

export interface MappedResult {
  external: Record<string, unknown>;
  missingRequired: string[];
}

export interface ValidationIssue {
  field: string;
  ruleType: string;
  severity: Severity;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

type Rec = Record<string, unknown>;

/** True when a value counts as "empty" for required / presence checks. */
export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Parse a JSON object arg safely; returns null on any problem. */
function parseObjectArg(arg?: string | null): Rec | null {
  if (!arg) return null;
  try {
    const o = JSON.parse(arg);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Rec) : null;
  } catch {
    return null;
  }
}

/**
 * Apply a single transform to a value. CONSTANT ignores the input and emits the
 * arg. Unknown transforms pass the value through unchanged (DIRECT semantics).
 */
export function applyTransform(value: unknown, transform: TransformType | string, arg?: string | null): unknown {
  switch (transform) {
    case 'CONSTANT':
      return arg ?? null;
    case 'DIRECT':
      return value ?? null;
    case 'TRIM':
      return typeof value === 'string' ? value.trim() : value ?? null;
    case 'UPPERCASE':
      return typeof value === 'string' ? value.toUpperCase() : value ?? null;
    case 'LOWERCASE':
      return typeof value === 'string' ? value.toLowerCase() : value ?? null;
    case 'TITLECASE':
      return typeof value === 'string' ? titleCase(value) : value ?? null;
    case 'DATE_ISO': {
      if (isEmpty(value)) return null;
      const d = value instanceof Date ? value : new Date(value as string);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'NUMBER': {
      if (isEmpty(value)) return null;
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'BOOLEAN': {
      if (isEmpty(value)) return null;
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      return ['true', '1', 'yes', 'y', 'active'].includes(s);
    }
    case 'MAP': {
      const table = parseObjectArg(arg);
      if (!table) return value ?? null;
      const key = String(value);
      return key in table ? table[key] : value ?? null;
    }
    default:
      return value ?? null;
  }
}

/**
 * Build an external payload from an internal record using the field mappings.
 * Disabled mappings are skipped. A required mapping whose transformed value is
 * empty is reported in missingRequired (but still emitted as null so the shape
 * is complete for the caller to inspect).
 */
export function mapEntity(record: Rec, mappings: MappingSpec[]): MappedResult {
  const external: Rec = {};
  const missingRequired: string[] = [];
  for (const m of mappings) {
    if (m.enabled === false) continue;
    const raw = m.transform === 'CONSTANT' ? undefined : record[m.internalField];
    const out = applyTransform(raw, m.transform, m.transformArg);
    external[m.externalField] = out;
    if (m.required && isEmpty(out)) missingRequired.push(m.internalField);
  }
  return { external, missingRequired };
}

/** Evaluate one rule against a record; returns an issue or null if it passes. */
export function evaluateRule(record: Rec, rule: ValidationRuleSpec): ValidationIssue | null {
  if (rule.enabled === false) return null;
  const severity: Severity = rule.severity === 'WARNING' ? 'WARNING' : 'ERROR';
  const value = record[rule.field];
  const fail = (): ValidationIssue => ({ field: rule.field, ruleType: String(rule.ruleType), severity, message: rule.message });

  switch (rule.ruleType) {
    case 'REQUIRED':
      return isEmpty(value) ? fail() : null;

    case 'GIS_PRESENT':
      // Passes when a boundary/coords value is present and non-empty.
      return isEmpty(value) ? fail() : null;

    case 'REGEX': {
      if (isEmpty(value)) return null; // presence is REQUIRED's job
      if (!rule.param) return null;
      try {
        return new RegExp(rule.param).test(String(value)) ? null : fail();
      } catch {
        return null; // a broken rule config never blocks data
      }
    }

    case 'ENUM': {
      if (isEmpty(value)) return null;
      const allowed = (rule.param ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return allowed.length === 0 || allowed.includes(String(value)) ? null : fail();
    }

    case 'LENGTH_MAX': {
      if (isEmpty(value)) return null;
      const max = Number(rule.param);
      if (!Number.isFinite(max)) return null;
      return String(value).length <= max ? null : fail();
    }

    case 'MIN': {
      if (isEmpty(value)) return null;
      const min = Number(rule.param);
      const n = Number(value);
      if (!Number.isFinite(min) || !Number.isFinite(n)) return null;
      return n >= min ? null : fail();
    }

    case 'MAX': {
      if (isEmpty(value)) return null;
      const max = Number(rule.param);
      const n = Number(value);
      if (!Number.isFinite(max) || !Number.isFinite(n)) return null;
      return n <= max ? null : fail();
    }

    default:
      return null;
  }
}

/**
 * Run all rules against a record. valid === true when there are zero ERROR-level
 * issues; warnings never affect validity.
 */
export function validateEntity(record: Rec, rules: ValidationRuleSpec[]): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  for (const rule of rules) {
    const issue = evaluateRule(record, rule);
    if (!issue) continue;
    (issue.severity === 'WARNING' ? warnings : errors).push(issue);
  }
  return { valid: errors.length === 0, errors, warnings };
}
