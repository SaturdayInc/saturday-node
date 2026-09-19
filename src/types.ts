/**
 * SDK configuration options.
 */
export interface SaturdayConfig {
  /** Your partner API key (sk_live_... or sk_test_...). */
  apiKey: string;

  /** Base URL override. Defaults to https://api.saturday.fit */
  baseUrl?: string;

  /** Per-attempt timeout including response body reads, in milliseconds. Defaults to 30000 for JSON requests; an unconfigured AI stream deadline is 60000. */
  timeout?: number;

  /** Maximum retry attempts for transient failures. Defaults to 3. */
  maxRetries?: number;

  /** OAuth2 Bearer token (alternative to API key for athlete-delegated access). */
  bearerToken?: string;
}

// --- Core Enums ---

export type ActivityType = 'bike' | 'run' | 'swim' | 'row' | 'ski' | 'lift' | 'hike';
export type Sex = 'male' | 'female' | 'intersex';
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
  warnings: string[] | null;

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

export interface Attribution {
  text: string;
  logo_url: string;
  link: string;
  required: boolean;
}

export interface TrialMetadata {
  tier_source?: string;
  /** Epoch milliseconds. */
  trial_ends_at?: number;
  trial_calls_remaining_today?: number;
  trial_cap_reached?: boolean;
  trial_cap_note?: string;
}

export interface NutritionCalculateResponse extends TrialMetadata {
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
  attribution: Attribution;

  /**
   * Missing-input details and an optional athlete-scoped onboarding link.
   * A full tier with incomplete inputs can still carry ranges.
   */
  precision?: Precision;

  // Teaser tier only — upsell prompt
  subscription_cta?: SubscriptionCTA;
}

/** The upsell attached to any teaser-tier response, prescriptions and products alike. */
export interface SubscriptionCTA {
  message: string;
  subscribe_url: string;
  features: string[];
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
  display_label?: string;
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
  settings: AthleteSettings;
  profile_complete: boolean;
  subscription_status?: string;
  partner_plan?: string;
  org_id?: string;
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
  settings?: AthleteSettings;
  partner_plan?: string;
  org_id?: string;
}

export interface AthleteSettings {
  sweat_level?: number;
  saltiness?: number;
  satiety_level?: number;
  fitness_level?: number;
  carb_experience?: CarbExperience;
  usual_carb_consumption?: UsualCarbConsumption;
  carb_upper_limit_override?: number;
  muscle_cramps?: boolean;
  gut_distress?: boolean;
  performance?: boolean;
  hunger?: boolean;
  heat_tolerance?: boolean;
  faintness?: boolean;
  drinking_resistance?: boolean;
  thirst?: boolean;
  concerns_answered?: boolean;
}

// --- Activities ---

export interface Activity {
  id: string;
  athlete_id: string;
  partner_id: string;
  /** Activity type. The API field is `type` (not `activity_type`). */
  type: ActivityType;
  /** @deprecated Not returned by the activity API. */
  name?: string;
  duration_min: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  /** Whether this is a race. The API field is `is_race_event`. */
  is_race_event?: boolean;
  meal_before_min?: number;
  external_id?: string;
  prescription?: ActivityPrescription;
  feedback?: ActivityFeedback;
  /** @deprecated Not returned by the activity API. */
  scheduled_at?: string;
  /** @deprecated Use the presence of prescription instead. */
  has_prescription?: boolean;
  /** @deprecated Not returned by the activity API. */
  prescription_stale?: boolean;
  /** Epoch seconds. */
  created_at: number;
  /** Epoch seconds. */
  updated_at: number;
}

export interface CreateActivityRequest {
  /** Activity type. The API field is `type` (not `activity_type`). */
  type: ActivityType;
  /** @deprecated Ignored by the activity API; keep display names in your system. */
  name?: string;
  duration_min: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  /** Whether this is a race. The API field is `is_race_event`. */
  is_race_event?: boolean;
  meal_before_min?: number;
  external_id?: string;
  /** @deprecated Ignored by the activity API. */
  scheduled_at?: string;
}

export interface ActivityPrescription {
  total_carb_g: number;
  total_sodium_mg: number;
  total_fluid_ml: number;
  carb_g_per_hr: number;
  sodium_mg_per_hr: number;
  fluid_ml_per_hr: number;
  /** Epoch seconds. */
  calculated_at: number;
  /** False means the ranges carry the result; numeric fields are zero. */
  profile_complete?: boolean;
  carb_range_g_per_hr?: string;
  sodium_range_mg_per_hr?: string;
  fluid_range_ml_per_hr?: string;
  carriage_tactic_id?: string;
  activity_subtype?: string;
}

export interface PrescriptionEnvelope extends TrialMetadata {
  tier: SubscriptionTier;
  prescription?: ActivityPrescription;
  carb_range_g_per_hr?: string;
  sodium_range_mg_per_hr?: string;
  fluid_range_ml_per_hr?: string;
  safety: SafetyMetadata;
  attribution: Attribution;
  subscription_cta?: SubscriptionCTA;
  precision?: Precision;
}

export interface StoredPrescriptionResponse {
  prescription: ActivityPrescription;
  safety: SafetyMetadata;
}

export interface ActivityFeedback {
  rating?: number;
  notes?: string;
  /** Epoch seconds. */
  created_at: number;
}

export interface BatchError {
  index: number;
  code: string;
  message: string;
}

export interface BatchSummary {
  errors?: BatchError[];
  total: number;
  succeeded: number;
  failed: number;
  request_id: string;
}

export interface BatchCalculateResponse extends BatchSummary {
  results: NutritionCalculateResponse[];
  estimated_ms: number;
  elapsed_ms: number;
}

export interface BatchAthleteResponse extends BatchSummary {
  created: Athlete[];
}

export interface ImportActivityRequest {
  type: ActivityType;
  duration_min: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  is_race_event?: boolean;
  external_id?: string;
  calculate?: boolean;
}

export interface ImportPrescriptionItem {
  index: number;
  activity_id: string;
  result?: PrescriptionEnvelope;
  code?: string;
  message?: string;
}

export interface ActivityImportResponse extends BatchSummary {
  imported: Activity[];
  prescriptions?: ImportPrescriptionItem[];
}

// --- Products ---

/** Which shape a product response carries. `teaser` means the athlete's
 *  subscription did not open the catalog: product fields are empty and the
 *  taxonomy plus a subscribe CTA come back instead. */
export type ProductTier = 'full' | 'teaser';

/** Summary-level product, returned by search and the curated listing. */
export interface ProductSummary {
  id: string;
  name?: string;
  product_name?: string;
  brand?: string;
  product_type?: string;
  image_url?: string;
  /** Per-response watermark identifying the partner this copy was served to. */
  _fingerprint?: string;
}

/** Full product record, returned by the barcode lookup. */
export interface Product extends ProductSummary {
  display_name?: string;
  barcode?: string;
  flavor?: string;
  serving_size?: number;
  serving_unit?: string;
  carb_gram?: number;
  sodium_mg?: number;
  fluid_ml?: number;
  calories?: number;
  sugar_g?: number;
  fat_g?: number;
  protein_g?: number;
  fiber_g?: number;
  caffeine_mg?: number;
  potassium_mg?: number;
  magnesium_mg?: number;
  gf_ratio?: number;
  ingredients?: string;
  allergens?: string;
  keywords?: string;
  verified?: boolean;
  source?: string;
  editorial_review?: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  description: string;
}

export interface ProductLookupResponse {
  tier: ProductTier;
  product: Product | null;
  /** Teaser tier only. */
  categories?: ProductCategory[];
  cta?: SubscriptionCTA;
  request_id: string;
}

export interface ProductSearchResponse {
  tier: ProductTier;
  products: ProductSummary[];
  total: number;
  /** Teaser tier only. */
  categories?: ProductCategory[];
  cta?: SubscriptionCTA;
  request_id: string;
}

export interface CuratedProductsResponse {
  tier: ProductTier;
  products: ProductSummary[];
  has_more: boolean;
  next_cursor?: string;
  /** Teaser tier only. */
  categories?: ProductCategory[];
  cta?: SubscriptionCTA;
  request_id: string;
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

export interface PaginationMeta {
  /** Number of records on this page. */
  total: number;
  has_more: boolean;
  /** Pass as the cursor query parameter for the next page. */
  next_cursor?: string;
}

export interface AthleteListResponse {
  athletes: Athlete[];
  pagination: PaginationMeta;
  request_id: string;
}

export interface ActivityListResponse {
  activities: Activity[];
  pagination: PaginationMeta;
  request_id: string;
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

// --- Coach billing (read-only; a key carrying billing:read) ---
//
// The figures the portal's Billing pages show, for the coach who minted the key.
// Every amount is an integer number of cents in the row's `currency`; every
// timestamp is Unix milliseconds. There is no billing write scope.

/** Which ledger directions a page carries. */
export type CoachLedgerView = 'all' | 'expenditures' | 'inflows';

/** The live seat picture from the roster header. */
export interface CoachSeatState {
  tier: string;
  included_total: number;
  included_used: number;
  coach_paid_count: number;
  next_athlete_price_cents: number;
  volume_tier: number;
  volume_discount_pct: number;
  total_monthly_cents: number;
  is_fair_use: boolean;
}

/** One row of the coach's financial ledger. */
export interface CoachLedgerEntry {
  id: string;
  entry_id: string;
  user_uid: string;
  direction: 'charge' | 'receipt' | 'refund' | 'covered_by';
  amount_cents: number;
  currency: string;
  category: string;
  counterparty_type: string;
  counterparty_id?: string;
  counterparty_display_name: string;
  source_type: string;
  source_reference_id: string;
  description: string;
  occurred_at: number;
  created_at: number;
  period_start?: number;
  period_end?: number;
  receipt_url?: string;
  metadata?: Record<string, unknown>;
  related_relationship_id?: string;
  related_arrangement_id?: string;
  tags?: string[];
  charge_group_id?: string;
  settlement_status?: string;
}

/** One page of ledger entries; `next_cursor` is present only when another page exists. */
export interface CoachLedgerPage {
  entries: CoachLedgerEntry[];
  next_cursor?: string;
}

/** One platform tier subscription. */
export interface CoachTierSubscription {
  subscription_id: string;
  subscriber_type: string;
  subscriber_id: string;
  tier: string;
  channel: string;
  source_sku: string;
  stripe_subscription_id?: string;
  iap_original_transaction_id?: string;
  status: string;
  trial_ends_at?: number;
  current_period_start: number;
  current_period_end: number;
  amount_cents: number;
  discount_code?: string;
  lifetime_discount_applied: boolean;
  auto_renew: boolean;
  created_at: number;
  updated_at: number;
  canceled_at?: number;
  grace_until?: number;
  source_purchase_doc_id?: string;
  purchased_assistant_seats?: number;
}

/** Whether any source currently grants the coach access, and which. */
export interface CoachSubscriptionStatus {
  has_purchase: boolean;
  has_tier_sub: boolean;
  is_active: boolean;
  source?: string;
  product_id?: string;
  tier_id?: string;
  expiry_date_ms?: number;
  is_lifetime?: boolean;
  has_coverage?: boolean;
}

/** The coach's active tier subscriptions and access status. */
export interface CoachTierStatus {
  subscriptions: CoachTierSubscription[];
  count: number;
  status: CoachSubscriptionStatus;
}

/** The coach's Stripe Connect account record. */
export interface CoachConnectAccount {
  coach_uid: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  card_payments_status?: string;
  transfers_status?: string;
  requirements_currently_due_count: number;
  country: string;
  default_currency: string;
  capabilities?: Record<string, string>;
  onboarded_at?: number;
  disabled_reason?: string;
  closed?: boolean;
  updated_at: number;
}

/** Connect account status plus month and lifetime totals; `connect_account` is null without an account. */
export interface CoachConnectSummary {
  connect_account: CoachConnectAccount | null;
  is_onboarded: boolean;
  active_arrangements: number;
  month_charges_cents: number;
  month_fees_cents: number;
  month_net_cents: number;
  lifetime_charges_cents: number;
  lifetime_fees_cents: number;
  lifetime_net_cents: number;
  platform_fee_bps: number;
}

/** Fee totals across the coach's settled charges. */
export interface CoachEarningsSummary {
  coach_uid: string;
  total_gross_cents: number;
  total_stripe_fee_cents: number;
  total_platform_fee_cents: number;
  total_net_cents: number;
  charge_count: number;
  settled_count: number;
  settling_count: number;
  currency: string;
}

/** The gross-to-net decomposition of one charge. */
export interface CoachChargeBreakdown {
  charge_group_id: string;
  gross_amount_cents: number;
  stripe_fees_cents: number;
  platform_fee_cents: number;
  net_to_coach_cents: number;
  currency: string;
  settlement_status: string;
  occurred_at: number;
  athlete_uid?: string;
  athlete_display_name?: string;
}

/** The earnings roll-up plus recent breakdowns (`breakdowns` is `[]` when there are none). */
export interface CoachConnectEarnings {
  summary: CoachEarningsSummary;
  breakdowns: CoachChargeBreakdown[];
}

/** One Stripe Connect charge with its fee decomposition. */
export interface CoachConnectCharge {
  charge_id: string;
  arrangement_id?: string;
  coach_uid: string;
  athlete_uid: string;
  amount_cents: number;
  platform_fee_cents: number;
  stripe_fees_cents: number;
  net_to_coach_cents: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed' | 'refunded' | 'disputed' | 'dispute_lost';
  refund_amount_cents?: number;
  captured_at: number;
  stripe_webhook_event_id: string;
}

/** One page of Connect charges; `total` counts this page. */
export interface CoachConnectChargesPage {
  charges: CoachConnectCharge[];
  total: number;
  next_cursor?: string;
}

/** A coach-to-athlete billing arrangement. */
export interface CoachBillingArrangement {
  arrangement_id: string;
  coach_uid: string;
  athlete_uid: string;
  stripe_connect_account_id: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  billing_mode: 'recurring' | 'one_time' | 'invoice';
  amount_cents: number;
  currency: string;
  interval?: string;
  trial_days?: number;
  promo_code?: string;
  refund_policy?: string;
  status: 'active' | 'paused' | 'canceled' | 'past_due';
  platform_fee_bps: number;
  terms_text?: string;
  created_at: number;
  activated_at?: number;
  paused_at?: number;
  canceled_at?: number;
}

/** Every billing arrangement the coach has configured. */
export interface CoachConnectArrangements {
  arrangements: CoachBillingArrangement[];
  total: number;
}
