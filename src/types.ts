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

  // Teaser tier only — upsell prompt
  subscription_cta?: {
    message: string;
    subscribe_url: string;
    features: string[];
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
