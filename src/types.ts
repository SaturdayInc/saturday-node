/**
 * SDK configuration options.
 */
export interface SaturdayConfig {
  /** Your partner API key (sk_live_... or sk_test_...). */
  apiKey: string;

  /** Base URL override. Defaults to https://api.saturday.fit */
  baseUrl?: string;

  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;

  /** Maximum retry attempts for transient failures. Defaults to 3. */
  maxRetries?: number;

  /** OAuth2 Bearer token (alternative to API key for athlete-delegated access). */
  bearerToken?: string;
}

// --- Core Enums ---

export type ActivityType = 'bike' | 'run' | 'swim' | 'row' | 'ski' | 'lift' | 'hike';
export type Sex = 'male' | 'female';
export type SubscriptionTier = 'full' | 'teaser';
export type CarbExperience = 'range_0_30' | 'range_40_60' | 'range_gt_70';
export type UsualCarbConsumption = 'range_lt_60' | 'range_60_80' | 'range_80_100' | 'range_gt_100';
export type GearType = 'bottle' | 'flask' | 'softflask' | 'bladder' | 'jersey_pocket';
export type WebhookEventType =
  | 'athlete.created' | 'athlete.updated' | 'athlete.deleted'
  | 'activity.created' | 'activity.updated' | 'activity.deleted'
  | 'prescription.calculated' | 'prescription.updated'
  | 'feedback.submitted'
  | 'subscription.created' | 'subscription.updated' | 'subscription.cancelled'
  | 'partner.rate_limit_approaching' | 'partner.rate_limit_exceeded';

// --- Safety (always included in nutrition responses) ---

/**
 * Safety metadata is ALWAYS included in nutrition responses regardless of
 * subscription tier. Athlete safety cannot be paywalled. This is non-negotiable.
 *
 * The `not_instructions` field exists specifically for AI agent consumption —
 * AI models must not treat prescriptions as executable medical instructions.
 */
export interface SafetyMetadata {
  /** Maximum safe fluid intake rate (mL/hr). */
  max_safe_fluid_ml_per_hr: number;

  /** Maximum safe sodium intake rate (mg/hr). */
  max_safe_sodium_mg_per_hr: number;

  /** Confidence in the safety assessment (0-1). */
  confidence_score: number;

  /** True if the prescription should be reviewed by a professional. */
  requires_human_review: boolean;

  /** Human-readable safety warnings. */
  warnings: string[];

  /**
   * Legal flag — these are recommendations, not medical instructions.
   * Always true. AI consumers MUST NOT treat prescriptions as executable commands.
   */
  not_instructions: true;
}

// --- Nutrition ---

export interface NutritionCalculateRequest {
  // Required
  activity_type: ActivityType;
  duration_min: number;

  // Recommended (improves precision)
  athlete_weight_kg?: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  sex?: Sex;
  age?: number;
  is_race?: boolean;

  // Advanced (Saturday-specific tuning)
  sweat_level?: number;
  saltiness?: number;
  satiety_level?: number;
  fitness_level?: number;
  carb_experience?: CarbExperience;
  usual_carb_consumption?: UsualCarbConsumption;
  carb_upper_limit_override?: number;
  concerns?: {
    muscle_cramps?: boolean;
    gut_distress?: boolean;
    performance?: boolean;
    hunger?: boolean;
    heat_tolerance?: boolean;
    faintness?: boolean;
    drinking_resistance?: boolean;
    thirst?: boolean;
  };
  meal_before_min?: number;
  athlete_id?: string;
}

export interface NutritionCalculateResponse {
  tier: SubscriptionTier;

  // Full tier — per-hour rates
  carb_g_per_hr?: number;
  sodium_mg_per_hr?: number;
  fluid_ml_per_hr?: number;

  // Full tier — totals for the activity
  total_carb_g?: number;
  total_sodium_mg?: number;
  total_fluid_ml?: number;

  // Teaser tier — human-readable ranges
  carb_range_g_per_hr?: string;
  sodium_range_mg_per_hr?: string;
  fluid_range_ml_per_hr?: string;

  safety: SafetyMetadata;
  attribution?: {
    text: string;
    logo_url: string;
    link: string;
    required: boolean;
  };

  /**
   * Graduated precision (API_OB, 2026-06). Present on every tier once the gate
   * is live. `profile_complete: false` means the response carries honest
   * **bands** (`carb_range_g_per_hr` etc.) — never falsely exact, never wider
   * than free-tier teaser ranges. `missing_fields` is sorted most-impactful-
   * first (your collection roadmap), and `onboarding.url` is a durable,
   * athlete-scoped link to the hosted onboarding page. See the Athlete
   * Onboarding guide.
   */
  precision?: Precision;

  // Teaser tier only — upsell prompt
  subscription_cta?: {
    message: string;
    subscribe_url: string;
    features: string[];
  };
}

/**
 * The honesty object attached to every prescription response when the
 * graduated-precision gate is on (API_OB).
 */
export interface Precision {
  /** True → the response carries exact numbers; false → honest bands. */
  profile_complete: boolean;
  /**
   * Unanswered fields, sorted most-impactful-first. Each entry names what
   * answering it would narrow — build your collection UX directly from this.
   * Omitted when the profile is complete.
   */
  missing_fields?: MissingField[];
  /** Plain-language note naming the critical missing fields. */
  message?: string;
  /** Where the athlete answers the gaps. Omitted when the profile is complete. */
  onboarding?: OnboardingInvite;
}

/** One unanswered profile/activity field and what answering it narrows. */
export interface MissingField {
  /** The field name to collect (e.g. `sweat_level`). */
  field: string;
  /** Safety-core fields are `required: true`; recommended fields `false`. */
  required: boolean;
  /** How much this one field's answer would narrow each output (per hour). */
  band_impact: BandImpact;
}

/** A field's contribution to band width, per output, in per-hour units. */
export interface BandImpact {
  carb_g_per_hr: number;
  sodium_mg_per_hr: number;
  fluid_ml_per_hr: number;
}

/** Points the athlete at the paths to precision. */
export interface OnboardingInvite {
  /** Hosted onboarding page (`https://saturday.fit/onboard?ot=...`), athlete-scoped. */
  url?: string;
  /** Human-readable invite copy (includes the app-once path mention). */
  message: string;
}

// --- Onboarding (headless schema) ---

/** A single onboarding question from the versioned schema. */
export interface OnboardingQuestion {
  /** The field name the answer writes (e.g. `sweat_level`, `year_of_birth`). */
  field: string;
  /** Render hint: `single_select` | `multi_select` | `year_of_birth` | `weight`. */
  type: 'single_select' | 'multi_select' | 'year_of_birth' | 'weight';
  /** Safety-core questions are required; exactness needs all questions answered. */
  required: boolean;
  /** English question copy (the `l10n_key` resolves localized copy in your UI). */
  title_en: string;
  /** Localization key for `title_en`. */
  l10n_key?: string;
  /** The exact answer values Saturday stores (odd-point scales, not sliders). */
  options?: OnboardingOption[];
  /** Numeric inputs (`year_of_birth`, `weight`) carry a min/max bound. */
  min?: number;
  max?: number;
}

/** One selectable answer for a single/multi-select onboarding question. */
export interface OnboardingOption {
  /** The value written when chosen (string or number per the field). */
  value: string | number;
  /** English label. */
  label_en: string;
  /** Localization key for `label_en`. */
  l10n_key?: string;
  /** Multi-select questions may pre-check sensible defaults (e.g. `performance`). */
  pre_checked?: boolean;
}

/**
 * The `GET /v1/onboarding/questions` response — the versioned question schema,
 * the single source of truth the hosted page also renders. **Attribution is
 * required** when you render these questions in your own UI.
 */
export interface OnboardingQuestionsResponse {
  /** Schema version (drives the schema-evolution grandfather promise). */
  schema_version: string;
  questions: OnboardingQuestion[];
  attribution?: {
    text: string;
    logo_url: string;
    link: string;
    required: boolean;
  };
}

// --- Athletes ---

export interface Athlete {
  id: string;
  partner_id: string;
  external_id?: string;
  name?: string;
  email?: string;
  sex?: Sex;
  /** Birth year (e.g. 1990) — the API stores year of birth, not age. */
  year_of_birth?: number;
  weight_kg?: number;
  /** ID of the athlete's Saturday subscription, when one is active. Empty/absent if not subscribed. */
  subscription_id?: string;
  /** Epoch seconds. */
  created_at: number;
  /** Epoch seconds. */
  updated_at: number;
}

export interface CreateAthleteRequest {
  external_id?: string;
  name?: string;
  email?: string;
  sex?: Sex;
  /** Birth year (e.g. 1990) — the API stores year of birth, not age. */
  year_of_birth?: number;
  weight_kg?: number;
}

export interface AthleteSettings {
  athlete_id: string;
  sweat_level?: number;
  saltiness?: number;
  satiety_level?: number;
  fitness_level?: number;
  carb_experience?: CarbExperience;
  usual_carb_consumption?: UsualCarbConsumption;
  carb_upper_limit_override?: number;
  concerns?: {
    muscle_cramps?: boolean;
    gut_distress?: boolean;
    performance?: boolean;
    hunger?: boolean;
    heat_tolerance?: boolean;
    faintness?: boolean;
    drinking_resistance?: boolean;
    thirst?: boolean;
  };
  meal_before_min?: number;
  updated_at?: string;
}

// --- Activities ---

export interface Activity {
  id: string;
  athlete_id: string;
  /** Activity type. The API field is `type` (not `activity_type`). */
  type: ActivityType;
  name?: string;
  duration_min: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  /** Whether this is a race. The API field is `is_race_event`. */
  is_race_event?: boolean;
  scheduled_at?: string;
  has_prescription?: boolean;
  prescription_stale?: boolean;
  /** Epoch seconds. */
  created_at: number;
  /** Epoch seconds. */
  updated_at: number;
}

export interface CreateActivityRequest {
  /** Activity type. The API field is `type` (not `activity_type`). */
  type: ActivityType;
  name?: string;
  duration_min: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  /** Whether this is a race. The API field is `is_race_event`. */
  is_race_event?: boolean;
  scheduled_at?: string;
}

// --- Products ---

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  barcode?: string;
  serving_size?: string;
  nutrients: {
    calories?: number;
    carbohydrate_g?: number;
    sugar_g?: number;
    sodium_mg?: number;
    potassium_mg?: number;
    caffeine_mg?: number;
  };
  tags?: string[];
  curated: boolean;
}

// --- AI Coach ---

export interface AIConversation {
  id: string;
  athlete_id: string;
  partner_id: string;
  message_count: number;
  summary?: string;
  model_used: string;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tools_called?: string[];
}

// --- Webhooks ---

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description?: string;
  fail_count: number;
  disabled_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookFull extends Webhook {
  /** HMAC-SHA256 signing secret. Only returned at creation time. */
  secret: string;
}

// --- Organizations ---

export interface Organization {
  id: string;
  partner_id: string;
  display_name: string;
  description?: string;
  sport?: string;
  member_count: number;
  created_at: string;
}

// --- Gear ---

export interface GearItem {
  id: string;
  name: string;
  type: GearType;
  capacity_ml: number;
  is_default: boolean;
  created_at: string;
}

// --- Pagination ---

/**
 * Cursor-paginated list response.
 *
 * The array lives under a resource-named key (`athletes`, `activities`),
 * not a generic `data` key. Pass `cursor` back on the next request to page
 * forward; `has_more` indicates whether another page exists.
 */
export interface AthleteListResponse {
  athletes: Athlete[];
  has_more: boolean;
  /** Opaque cursor for the next page. Pass as the `cursor` query param. */
  cursor?: string;
  total?: number;
}

export interface ActivityListResponse {
  activities: Activity[];
  has_more: boolean;
  /** Opaque cursor for the next page. Pass as the `cursor` query param. */
  cursor?: string;
  total?: number;
}

// --- Error ---

export interface SaturdayErrorDetail {
  type: string;
  code: string;
  message: string;
  param?: string;
  documentation_url?: string;
  request_id?: string;
}

// --- Coach API (Module 5 · /v1/coach/*) ---
//
// The coach surface reads a coach's roster fueling data and writes the coach's
// OWN alerting/report config. Reached with either a coach API key (cp_live_ /
// cp_test_, passed as `apiKey`) or an OAuth2 coach-scoped bearer token. Requires
// the Pro-Coach+ tier; athlete data is READ-ONLY (a coach can never author an
// athlete's data via the API). Every {uid} is confined to the coach's roster —
// a non-roster athlete returns 404 (never an existence oracle).

/** Look-back window for coach reads. Always one of 7, 14, or 30 days. */
export type CoachWindow = 7 | 14 | 30;

/** Report focus mode. */
export type CoachFocus = 'worst' | 'rolling' | 'key';

/** Config scope precedence: athlete > group > overall (most-specific wins). */
export type CoachScope = 'overall' | 'group' | 'athlete';

/** Concern trigger types (the shared concern definition). */
export type CoachTrigger =
  | 'under_fuel' | 'symptom' | 'low_rating' | 'hyponatremia_pattern'
  | 'dial_down' | 'sleep_trend' | 'went_quiet';

/** Delivery channels for an alert. SMS is not yet supported. */
export type CoachChannel = 'in_portal' | 'email' | 'push' | 'webhook';

/** Alert cadence: real-time urgent vs bundled daily digest. */
export type CoachCadence = 'realtime' | 'digest';

/** Named starting-point preset for a whole scope. */
export type CoachPreset = 'hands_off' | 'balanced' | 'hands_on';

/** Concern-event types a webhook can subscribe to. */
export type CoachWebhookEvent = 'concern.detected' | 'athlete.needs_attention';

/** Per-athlete needs-attention summary on the roster. */
export interface RosterEntry {
  athlete_uid: string;
  flagged: boolean;
  flagged_count: number;
  top_reasons: string[];
  session_count: number;
}

/** The coach's roster with per-athlete needs-attention markers. */
export interface Roster {
  coach_uid: string;
  window: number;
  athletes: RosterEntry[];
}

/** Flagged-only roster digest (athletes who fueled well are omitted). */
export interface RosterDigest {
  coach_uid: string;
  window: number;
  flagged_count: number;
  total_count: number;
  flagged: RosterEntry[];
}

/** The resolved cutoffs in effect for a coach×athlete (echoed on a rollup). */
export interface CoachSettingsResolved {
  report_window_days: number;
  report_focus: string;
  concern_carb_cutoff: number;
  concern_sodium_cutoff: number;
  concern_fluid_cutoff: number;
  hyponatremia_fluid_min: number;
  hyponatremia_sodium_max: number;
}

/** One athlete's in-window fueling rollup + concern summary. */
export interface FuelingRollup {
  athlete_uid: string;
  window: number;
  focus: string;
  /** The per-session projection (same as the portal table). Shape is opaque pass-through. */
  sessions: Array<Record<string, unknown>>;
  concern: Record<string, unknown>;
  settings_resolved: CoachSettingsResolved;
}

/** The AI fueling report: narrative + the structured concern summary behind it. */
export interface AthleteReport {
  athlete_uid: string;
  window: number;
  focus: string;
  narrative: string;
  concern: Record<string, unknown>;
  generated_at: number;
  latest_session_ms: number;
  from_cache: boolean;
}

/** One session's full projection + the concern markers it crossed. */
export interface SessionDetail {
  athlete_uid: string;
  session: Record<string, unknown> | null;
  markers: Array<Record<string, unknown>>;
}

/** One trigger's configuration at a scope. Thresholds are fractions in (0,1]; null falls through. */
export interface TriggerRule {
  enabled: boolean;
  urgent_threshold?: number;
  amber_threshold?: number;
  channels?: CoachChannel[];
  cadence?: CoachCadence;
}

/** A bounded 2-trigger AND combinator (both legs on the same session). */
export interface Combinator {
  trigger_a: CoachTrigger;
  trigger_b: CoachTrigger;
  channel: CoachChannel;
  cadence?: CoachCadence;
}

/** Quiet hours during which non-urgent alerts are held. */
export interface QuietHours {
  enabled: boolean;
  start?: string; // "HH:MM"
  end?: string;   // "HH:MM"
  tz?: string;    // IANA tz name
}

/** The full alert rule set at one scope (PUT replaces the whole set — idempotent). */
export interface AlertRulesDoc {
  notification_rules?: Record<string, TriggerRule>;
  combinators?: Combinator[];
  quiet_hours?: QuietHours;
  preset?: CoachPreset | 'custom';
}

/** AI-report + concern-threshold settings at a scope. Unset fields fall through to the broader scope. */
export interface CoachReportSettings {
  ai_report_window_days?: CoachWindow;
  ai_report_focus?: CoachFocus;
  concern_carb_cutoff?: number;
  concern_sodium_cutoff?: number;
  concern_fluid_cutoff?: number;
  hyponatremia_fluid_min?: number;
  hyponatremia_sodium_max?: number;
}

/** A registered webhook endpoint (secret only returned at registration). */
export interface CoachWebhookEndpoint {
  id: string;
  coach_uid: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: number;
  updated_at: number;
  fail_count: number;
  disabled_at?: number;
}

/** The registration response — carries the signing secret ONCE. */
export interface CoachWebhookWithSecret extends CoachWebhookEndpoint {
  secret: string;
}
