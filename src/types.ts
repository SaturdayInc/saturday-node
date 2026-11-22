/**
 * SDK configuration options.
 */
export interface SaturdayConfig {
  /** Your API key: a partner key (`sk_live_...` or `sk_test_...`) or a coach key (`cp_live_...` or `cp_test_...`). */
  apiKey: string;

  /** Base URL override. Defaults to https://api.saturday.fit */
  baseUrl?: string;

  /** Per-attempt timeout including the response body read, in milliseconds. Defaults to 30000. */
  timeout?: number;

  /** Maximum retries for throttled or briefly paced 429s and for 5xx responses. Defaults to 3; 0 disables retries. */
  maxRetries?: number;

  /** OAuth2 access token for athlete-delegated access. Sent in place of `apiKey` when set. */
  bearerToken?: string;
}

// --- Core enums ---

/** A single sport. Each leg of a brick or triathlon is one of these. */
export type ActivityType = 'bike' | 'run' | 'swim' | 'row' | 'ski' | 'lift' | 'hike';
/** A session made of 2 to 10 legs, each a single sport. */
export type LinkedSessionType = 'brick' | 'triathlon';
/** What a calculation or an activity can be: a single sport, or a brick or triathlon with legs. */
export type SessionType = ActivityType | LinkedSessionType;
export type Sex = 'male' | 'female' | 'intersex';
export type SubscriptionTier = 'full' | 'teaser';
export type CarbExperience = 'range_0_30' | 'range_40_60' | 'range_gt_70';
export type UsualCarbConsumption = 'range_lt_60' | 'range_60_80' | 'range_80_100' | 'range_gt_100';
/**
 * Event names a partner webhook can register. Registration rejects the whole request on one
 * unknown name. `subscription.updated` and `partner.rate_limit_approaching` are accepted but
 * never sent to a partner webhook.
 */
export type WebhookEventType =
  | 'athlete.created' | 'athlete.updated' | 'athlete.profile_completed'
  | 'athlete.profile_sharing_changed' | 'athlete.fueling_profile_updated' | 'athlete.deleted'
  | 'activity.created' | 'activity.updated' | 'activity.deleted'
  | 'prescription.calculated'
  | 'feedback.submitted'
  | 'subscription.created' | 'subscription.updated' | 'subscription.cancelled'
  | 'partner.rate_limit_approaching'
  | 'webhook.test';
/** Whether an athlete shares their Saturday app answers with you; `not_linked` means no Saturday account is connected. */
export type ProfileSharing = 'on' | 'off' | 'not_linked';
/** Where the value Saturday's calculations use for a field comes from: your stored value, the app answer, or neither (a default, so numbers come back as ranges). */
export type CalculationsUse = 'partner' | 'saturday_app' | 'default';

// --- Safety and attribution (on every prescription) ---

/**
 * Safety metadata, on every prescription and product answer at every tier.
 * `not_instructions` is always true: the numbers are recommendations, and software
 * acting on them (an AI agent included) must not treat them as commands.
 */
export interface SafetyMetadata {
  /** Most fluid an hour Saturday treats as safe, mL. */
  max_safe_fluid_ml_per_hr: number;
  /** Most sodium an hour Saturday treats as safe, mg. */
  max_safe_sodium_mg_per_hr: number;
  /** 0 to 1. */
  confidence_score: number;
  /** True when the prescription should be reviewed by a professional. */
  requires_human_review: boolean;
  /** Warnings to show the athlete. May be `null` or empty. */
  warnings: string[] | null;
  not_instructions: true;
}

/** The credit to show wherever you show Saturday's numbers. `required` is true. */
export interface Attribution {
  text: string;
  logo_url: string;
  link: string;
  required: boolean;
}

// --- Nutrition ---

/** Concern flags, as an athlete answers them. */
export interface Concerns {
  muscle_cramps?: boolean;
  gut_distress?: boolean;
  performance?: boolean;
  hunger?: boolean;
  heat_tolerance?: boolean;
  faintness?: boolean;
  drinking_resistance?: boolean;
  thirst?: boolean;
}

/**
 * One leg of a brick or triathlon on a calculate request. All four fields are required.
 * The legs together may be at most 2160 minutes.
 */
export interface CalculateLeg {
  activity_type: ActivityType;
  /** 5 to 2160 minutes. */
  duration_min: number;
  /** The leg's effort, 1 to 9 (lift and hike: 1 to 3; a higher value computes as 3). */
  intensity_level: number;
  /** The leg's heat and humidity, 1 (cold, dry) to 9 (hot, humid). */
  thermal_stress_level: number;
}

/** The profile and session fields every calculate request may carry. */
interface CalculateRequestFields {
  athlete_id?: string;
  athlete_weight_kg?: number;
  /** Minutes since the last carb-rich meal. Over 180 plans a fasted start. Left out, the answer is ranges until it is sent. */
  meal_before_min?: number;
  /** Whether this is a race. Left out, the answer is ranges until it is sent. */
  is_race?: boolean;
  sex?: Sex;
  age?: number;
  sweat_level?: number;
  saltiness?: number;
  satiety_level?: number;
  fitness_level?: number;
  carb_experience?: CarbExperience;
  usual_carb_consumption?: UsualCarbConsumption;
  carb_upper_limit_override?: number;
  concerns?: Concerns;
}

/** A calculation for one sport. */
export interface SingleSessionCalculateRequest extends CalculateRequestFields {
  activity_type: ActivityType;
  /** 1 to 2160 minutes. */
  duration_min: number;
  /** Effort, 1 to 9 (lift and hike: 1 to 3). Odd levels are the app's bands; even levels fall between them. Left out, the answer is ranges until it is sent. */
  intensity_level?: number;
  /** Heat and humidity, 1 (cold, dry) to 9 (hot, humid). Left out, the answer is ranges until it is sent. */
  thermal_stress_level?: number;
  legs?: never;
}

/**
 * A brick or triathlon: 2 to 10 legs, each with its own effort and heat. Send it as one request
 * with legs, never as one request per leg.
 */
export interface LinkedSessionCalculateRequest extends CalculateRequestFields {
  activity_type: LinkedSessionType;
  legs: CalculateLeg[];
  /** The legs' total minutes. Leave it out, or send that total. */
  duration_min?: number;
  intensity_level?: never;
  thermal_stress_level?: never;
}

/**
 * `POST /v1/nutrition/calculate`, and each scenario of a batch. With `athlete_id`, the athlete's
 * stored profile is used and any profile field you also send here overrides it for this call.
 * A field the request does not take is refused with a `ValidationError` of code
 * `unsupported_field`: `param` names it and `suggestion` the field it was probably meant to be.
 */
export type NutritionCalculateRequest = SingleSessionCalculateRequest | LinkedSessionCalculateRequest;

/**
 * Trial and sandbox fields on a calculation. `partner.get()` gives the trial's length in
 * `rate_limits.trial_days` and the exact answers it gives in all in `rate_limits.trial_answers`.
 */
export interface TrialMetadata {
  /** `trial` while a partner trial gives this athlete the full tier. */
  tier_source?: string;
  /** When the trial ends, Unix seconds. */
  trial_ends_at?: number;
  trial_calls_remaining_today?: number;
  /** The athlete's trial has used today's calls, so these numbers are ranges; `trial_cap_note` says so in words you can show the athlete. */
  trial_cap_reached?: boolean;
  trial_cap_note?: string;
  /**
   * Your key has started its new trials for the UTC day (`rate_limits.trial_starts_per_day`), so
   * this athlete's trial starts on a later day and these numbers are ranges.
   */
  trial_start_deferred?: boolean;
  /**
   * The athlete's trial already covers its allowance of distinct profiles
   * (`rate_limits.trial_profiles_per_athlete`), so this new one is answered in ranges. Earlier
   * profiles stay exact.
   */
  trial_profile_limit_reached?: boolean;
  /**
   * The athlete's trial has given all its exact answers (`rate_limits.trial_answers`), so these
   * numbers are ranges until the athlete subscribes.
   */
  trial_answers_used_up?: boolean;
  /** With `trial_start_deferred`, `trial_profile_limit_reached` or `trial_answers_used_up`, why these numbers are ranges, in words you can show the athlete. */
  trial_note?: string;
  /**
   * Test environment only: the athlete's simulated subscription has given its allowance of exact
   * answers or distinct profiles, so these numbers are ranges.
   */
  simulated_limit_reached?: boolean;
  /** With `simulated_limit_reached`, which allowance was reached. */
  simulation_note?: string;
}

/**
 * A calculation. Exactly one of two shapes carries the numbers:
 * exact (`carb_g_per_hr` ... and `total_*`) when the profile is complete and the tier is full,
 * otherwise ranges (`carb_range_g_per_hr` ...). Read `precision.profile_complete` to tell them
 * apart; `tier: 'full'` alone does not mean exact. A zero value may be omitted.
 *
 * Per-hour figures are whole numbers, as the Saturday app's Fuel card shows them, which is not
 * always the total divided by the session's hours. The totals are for the whole session.
 */
export interface NutritionCalculateResponse extends TrialMetadata {
  tier: SubscriptionTier;
  carb_g_per_hr?: number;
  sodium_mg_per_hr?: number;
  fluid_ml_per_hr?: number;
  total_carb_g?: number;
  total_sodium_mg?: number;
  total_fluid_ml?: number;
  /** Ranges, such as `"60-80"`, when the answer is not exact. */
  carb_range_g_per_hr?: string;
  sodium_range_mg_per_hr?: string;
  fluid_range_ml_per_hr?: string;
  safety: SafetyMetadata;
  attribution: Attribution;
  precision?: Precision;
  /** Teaser tier only. */
  subscription_cta?: SubscriptionCTA;
  /** A brick or triathlon with exact numbers: each leg's share, in the order of the legs sent. Absent for a single sport and on answers with ranges. */
  legs?: LegPrescription[];
}

/**
 * One leg's share of a brick's or triathlon's prescription, as the Saturday app's leg cards show
 * it. The legs' totals add up to the session's totals before the session's own rounding. Per hour
 * is as the app's leg card shows it, which is not always the leg's total divided by its hours.
 */
export interface LegPrescription {
  duration_min: number;
  total_carb_g: number;
  total_sodium_mg: number;
  total_fluid_ml: number;
  carb_g_per_hr: number;
  sodium_mg_per_hr: number;
  fluid_ml_per_hr: number;
}

/** The subscribe prompt on any teaser answer. */
export interface SubscriptionCTA {
  message: string;
  subscribe_url: string;
  features: string[];
}

/** What a calculation still needs for exact numbers. */
export interface Precision {
  /** True: the answer carries exact numbers. False: it carries ranges. */
  profile_complete: boolean;
  /**
   * Every field this calculation still needs: profile answers and session inputs alike. With a
   * partner API key they arrive most impactful first; with an athlete's OAuth access token, in a
   * fixed order. A field the athlete answered in a linked Saturday app is listed too, so the list
   * never shows which answers the app holds. Absent when nothing is missing.
   */
  missing_fields?: MissingField[];
  /**
   * With a partner API key, on every tier: the athlete's profile answers this calculation lacks,
   * by the names `missing_fields` uses. The onboarding link collects them. Absent when none is
   * missing.
   */
  missing_profile_fields?: string[];
  /**
   * With a partner API key, on every tier: the session inputs your request or activity left out.
   * Send them. Absent when none is missing. Both lists empty is one condition of exact numbers;
   * the other is the athlete's access (a subscription, a seat license or the trial).
   */
  missing_session_inputs?: SessionInput[];
  /**
   * Names what is missing. With a partner API key: the athlete's profile answers (the onboarding
   * link collects them) apart from the session inputs your request or activity left out, and
   * where to send those.
   */
  message?: string;
  /**
   * Where the athlete can answer the gaps. With a partner API key, present only when profile
   * answers are missing: a missing session input is yours to send.
   */
  onboarding?: OnboardingInvite;
}

/** One unanswered field and how much answering it narrows each range. */
export interface MissingField {
  /** The field name to collect, such as `sweat_level`. */
  field: string;
  /**
   * True for the safety core: sex, age, weight, sweat, saltiness, carb experience, usual carbs,
   * effort and heat. False does not mean optional: the answer stays ranges while any listed field
   * is missing, `required` or not.
   */
  required: boolean;
  /** Sent with a partner API key; absent with an athlete's OAuth access token. */
  band_impact?: BandImpact;
  /** A plain-language label for the question, such as "how much you sweat". */
  display_label?: string;
}

/** A field's contribution to range width, per output, per hour. */
export interface BandImpact {
  carb_g_per_hr: number;
  sodium_mg_per_hr: number;
  fluid_ml_per_hr: number;
}

/** Points the athlete at the ways to complete their profile. */
export interface OnboardingInvite {
  /** Hosted onboarding page for this athlete. Absent when the call named no stored athlete. */
  url?: string;
  message: string;
}

/** A language the hosted onboarding page opens in. */
export type OnboardingLocale = 'en' | 'es' | 'fr' | 'pt' | 'de' | 'ja';

export interface CreateOnboardingLinkParams {
  /** Opens the page in this language. */
  locale?: OnboardingLocale;
}

/** `POST /v1/athletes/{athlete_id}/onboarding-link`: a fresh link to the hosted onboarding page. */
export interface OnboardingLink {
  object: 'onboarding_link';
  athlete_id: string;
  url: string;
  /** Unix seconds; the link stops working then, 90 days after it was made. */
  expires_at: number;
}

/**
 * Why a plan is from ranges:
 * - `profile_incomplete`: the athlete's profile answers are missing (`missing_profile_fields`).
 * - `session_incomplete`: session inputs your request or the activity left out (`missing_session_inputs`).
 * - `profile_and_session_incomplete`: both.
 * - `stored_ranges`: an activity's stored ranges with nothing missing that can be named now (the
 *   athlete has answered since): calculate the activity again.
 * - `trial_allowance`: the athlete's trial has used today's calls or given all its exact
 *   answers, or this profile is past the trial's allowance of profiles. `message` says which, in
 *   words you can show the athlete.
 * - `simulation_allowance` (test environment only): the athlete's simulated subscription has
 *   given its allowance of exact answers or profiles.
 */
export type PlanBasisSource =
  | 'profile_incomplete' | 'session_incomplete' | 'profile_and_session_incomplete' | 'stored_ranges'
  | 'trial_allowance' | 'simulation_allowance';

/** A session input a plan from ranges can be missing. */
export type SessionInput = 'intensity_level' | 'thermal_stress_level' | 'meal_before_min' | 'is_race';

/**
 * Present on prep, product fit and product compare when the plan is not the athlete's exact
 * numbers: the profile or the session is missing inputs, or a trial or simulated subscription is
 * past its allowance (`source`), so the plan uses the middle of the per-hour ranges for the
 * session. With every input in and the athlete's access open, it is absent and the plan uses the
 * exact numbers.
 */
export interface PlanBasis {
  source: PlanBasisSource;
  /** Names what is missing and where each goes, or which allowance was reached. Show it with the plan. */
  message: string;
  /** The athlete's profile answers the plan lacks, by the names `precision.missing_fields` uses. */
  missing_profile_fields?: string[];
  /** The session inputs the plan lacks: send them in the request (fit, compare), or set them on the activity (prep). */
  missing_session_inputs?: SessionInput[];
  carb_range_g_per_hr: string;
  sodium_range_mg_per_hr: string;
  fluid_range_ml_per_hr: string;
  /** Present only when profile answers are missing. */
  onboarding?: OnboardingInvite;
}

/** `POST /v1/nutrition/extract`: read a nutrition label from photos. Send `image_base64` or `images_base64`. */
export interface NutritionExtractRequest {
  image_base64?: string;
  /** Up to the label's front and back panels, base64 without a data-URL prefix. */
  images_base64?: string[];
  barcode?: string;
  label_region?: string;
}

/** What Saturday read from a nutrition label. Fields the label does not show are absent. */
export interface NutritionExtractResponse {
  product_name: string;
  carbs_per_serving: number;
  /** The carbs that count for fueling, after the label's country rules (polyols and fiber handling). */
  fueling_carbs_per_serving: number;
  carb_basis?: string;
  polyols_g?: number;
  sodium_per_serving: number;
  serving_size: string;
  /** 0 to 1. */
  confidence: number;
  rejected?: boolean;
  rejection_reason?: string;
  unsupported?: boolean;
  unsupported_message?: string;
  error?: string;
  brand?: string;
  form?: string;
  calories?: number;
  total_fat_g?: number;
  saturated_fat_g?: number;
  trans_fat_g?: number;
  cholesterol_mg?: number;
  dietary_fiber_g?: number;
  total_sugars_g?: number;
  added_sugars_g?: number;
  protein_g?: number;
  potassium_mg?: number;
  magnesium_mg?: number;
  calcium_mg?: number;
  other_minerals?: Record<string, number>;
  caffeine_mg?: number;
  vitamin_d_mcg?: number;
  vitamin_b6_mg?: number;
  vitamin_b12_mcg?: number;
  ingredients?: string;
  other_ingredients_text?: string;
  serving_size_grams?: number;
  servings_per_container?: number;
  scoops_per_serving?: number;
  scoop_size_grams?: number;
  fluid_oz?: number;
  fluid_ml?: number;
  sodium_sources?: string[];
  potassium_sources?: string[];
  calcium_sources?: string[];
  magnesium_sources?: string[];
  carbs_sources?: string[];
  protein_sources?: string[];
  caffeine_sources?: string[];
  salt_g?: number;
  salt_basis?: string;
  sodium_looks_like_salt?: boolean;
}

// --- Products: fit, compare and prep ---

/** A catalog product by id or by text. `product_id` wins when both are sent. */
export interface ProductRef {
  product_id?: string;
  /** Matched against catalog product names, brands and keywords, for example `"maurten gel 100"`. */
  product_query?: string;
}

/** The session fields fit and compare share. */
interface ProductSessionFields {
  athlete_id: string;
  /** Over 180 plans a fasted start. */
  meal_before_min?: number;
  /** Whether this is a race. */
  is_race?: boolean;
}

/** A single sport to size a product for. */
export interface SingleProductSession extends ProductSessionFields {
  activity_type: ActivityType;
  /** 1 to 2160 minutes. */
  duration_min: number;
  intensity_level?: number;
  thermal_stress_level?: number;
  legs?: never;
}

/** A brick or triathlon to size a product for: its legs, each with its own effort and heat, as on calculate. */
export interface LinkedProductSession extends ProductSessionFields {
  activity_type: LinkedSessionType;
  legs: CalculateLeg[];
  /** The legs' total minutes. Leave it out, or send that total. */
  duration_min?: number;
  intensity_level?: never;
  thermal_stress_level?: never;
}

/**
 * The session the product is sized for. Saturday computes the athlete's prescription for it.
 * Send every session input (effort and heat, on the legs for a brick or triathlon, plus
 * `meal_before_min` and `is_race`): one left out computes at its everyday value (effort 5, heat 5,
 * fed, training), and the plan is the middle of the athlete's ranges, with `plan_basis` naming the
 * input. A session error names its field in `param`.
 */
export type ProductSession = SingleProductSession | LinkedProductSession;

/** `POST /v1/nutrition/products/fit`. Name the product with `product_id` or `product_query`. */
export type ProductFitRequest = ProductSession & ProductRef;

/** `POST /v1/nutrition/products/compare`. */
export type ProductCompareRequest = ProductSession & {
  product_a: ProductRef;
  product_b: ProductRef;
};

/** Whole-session amounts. */
export interface NutrientAmounts {
  carb_g: number;
  sodium_mg: number;
  fluid_ml: number;
}

/** What one serving carries. `caffeine_mg` is absent when Saturday has no caffeine figure for the product. */
export interface PerServing extends NutrientAmounts {
  caffeine_mg?: number;
}

export type LimitingFactor = 'carbs' | 'sodium' | 'fluid' | 'product_too_large' | 'negligible_per_serving' | 'no_nutrients';

/** How one product fits the prescription. */
export interface ProductFitDetail {
  product_id: string;
  product_name: string;
  /** A category id, matching `ProductCategory.id`. */
  product_type: string;
  brand: string;
  per_serving: PerServing;
  /** The most servings, in the app's Prep steps (a quarter scoop, half a gel), before a nutrient overshoots. 0 when one step already overshoots. */
  max_servings: number;
  at_max_servings: NutrientAmounts;
  carb_coverage_pct: number;
  sodium_coverage_pct: number;
  fluid_coverage_pct: number;
  limiting_factor: LimitingFactor;
  remaining_gap: NutrientAmounts;
  /** One sentence summing up the fit. */
  verdict: string;
}

/** A product category. */
export interface ProductCategory {
  id: string;
  name: string;
  description: string;
}

/**
 * One leg of a brick or triathlon on a fit answer, in the order of the legs sent: its share of
 * the session's plan, as the Saturday app's leg cards show it, and the product sized against that
 * share, as the app's Prep page for that leg sizes it.
 */
export interface ProductFitLeg {
  activity_type: ActivityType;
  duration_min: number;
  prescription: NutrientAmounts;
  fit: ProductFitDetail;
}

/**
 * Product fit. `tier: 'full'` carries `prescription` and `fit`. `tier: 'teaser'` (the athlete's
 * subscription or trial does not open the catalog) carries `categories`, `cta` and `request_id`.
 */
export interface ProductFitResponse {
  tier: SubscriptionTier;
  /** The whole session's plan. */
  prescription?: NutrientAmounts;
  /** The product sized against the whole session. */
  fit?: ProductFitDetail;
  /** A brick or triathlon with exact numbers: each leg's share and the product sized against it. Absent for a single sport and on a plan from ranges (`plan_basis`). */
  legs?: ProductFitLeg[];
  plan_basis?: PlanBasis;
  safety: SafetyMetadata;
  categories?: ProductCategory[];
  cta?: SubscriptionCTA;
  request_id?: string;
  /** Teaser tier only: your key has started its new trials for the UTC day, so this athlete's trial starts on a later day. */
  trial_start_deferred?: boolean;
  /** With `trial_start_deferred`, why, in words you can show the athlete. */
  trial_note?: string;
}

export type ProductChoice = 'product_a' | 'product_b';

/** The product covering more of each nutrient at its `max_servings`; `overall` by average coverage. A tie goes to `product_a`. */
export interface ComparisonWinner {
  carb: ProductChoice;
  sodium: ProductChoice;
  fluid: ProductChoice;
  overall: ProductChoice;
}

/** One leg of a brick or triathlon on a compare answer, in the order of the legs sent: its share of the plan and both products sized against it. */
export interface ProductCompareLeg {
  activity_type: ActivityType;
  duration_min: number;
  prescription: NutrientAmounts;
  product_a: ProductFitDetail;
  product_b: ProductFitDetail;
  winner: ComparisonWinner;
}

/** Product compare. Same tiers as product fit. */
export interface ProductCompareResponse {
  tier: SubscriptionTier;
  /** The whole session's plan. */
  prescription?: NutrientAmounts;
  product_a?: ProductFitDetail;
  product_b?: ProductFitDetail;
  winner?: ComparisonWinner;
  /** A brick or triathlon with exact numbers: each leg's share and both products sized against it. Absent for a single sport and on a plan from ranges (`plan_basis`). */
  legs?: ProductCompareLeg[];
  plan_basis?: PlanBasis;
  safety: SafetyMetadata;
  categories?: ProductCategory[];
  cta?: SubscriptionCTA;
  request_id?: string;
  /** Teaser tier only: your key has started its new trials for the UTC day, so this athlete's trial starts on a later day. */
  trial_start_deferred?: boolean;
  /** With `trial_start_deferred`, why, in words you can show the athlete. */
  trial_note?: string;
}

/** One product for prep. Without `servings`, Saturday sizes it to what the plan still needs, in list order. */
export interface PrepProductInput extends ProductRef {
  /** Servings over the whole activity, or over one leg when the list is sized per leg. */
  servings?: number;
}

/** One leg's products on a prep request for a brick or triathlon. */
export interface PrepLegInput {
  products?: PrepProductInput[];
}

/**
 * `POST /v1/athletes/{athlete_id}/activities/{activity_id}/prep`. On a brick or triathlon with
 * exact numbers, `products` is sized against each leg (its `servings` counting per leg); send
 * `legs` instead for a product list per leg. Send one or the other: both together are refused
 * with a `ValidationError` (`invalid_value` on `products`).
 */
export interface PrepRequest {
  products?: PrepProductInput[];
  /**
   * A brick or triathlon only: one entry per leg of the activity, in order. Refused with a
   * `ValidationError` (`invalid_value` on `legs`) on a single session or with another count.
   * On a plan from ranges, which has no legs, the lists are sized together as one list.
   */
  legs?: PrepLegInput[];
}

/** One product at its servings. */
export interface PrepProduct extends NutrientAmounts {
  product_id: string;
  product_name: string;
  servings: number;
}

/** An athlete's carrier (bottle, flask). */
export interface GearItem {
  id: string;
  name: string;
  type: string;
  capacity_ml: number;
  is_default: boolean;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds. */
  updated_at: number;
}

/**
 * One leg of a brick or triathlon on a prep answer, in leg order: the leg's share of the plan, as
 * the Saturday app's leg card shows it, and its products sized against that share, as the app's
 * Prep page for that leg sizes them.
 */
export interface PrepLeg {
  activity_type: ActivityType;
  duration_min: number;
  prescription: NutrientAmounts;
  products: PrepProduct[];
  totals_from_products: NutrientAmounts;
  remaining_gap: NutrientAmounts;
  coverage_pct: { carb: number; sodium: number; fluid: number };
  /** Present when the leg's products overshoot its share. */
  warnings?: string[];
  /** Present when a gap remains on the leg, saying what the base mix covers. */
  note?: string;
}

/**
 * Prep: the activity's prescription, what the products deliver, and what is left. Totals are for
 * the whole activity. On a brick or triathlon with exact numbers, `legs` preps each leg and the
 * top level is the legs added up: each product once with its servings and nutrients summed over
 * the legs, `totals_from_products` and `remaining_gap` the legs' sums, `coverage_pct` those totals
 * against `prescription`, and `warnings` the legs' warnings, each naming its leg. `prescription`
 * stays the session's plan; the legs' shares add up to it before the session's own rounding, so
 * `prescription` less the totals can differ from `remaining_gap` by that rounding.
 */
export interface PrepResponse {
  prescription: NutrientAmounts;
  /** Each resolved product at its servings. A product that matches nothing in the catalog is left out. */
  products: PrepProduct[];
  totals_from_products: NutrientAmounts;
  /** What the prescription still needs after the products, never below 0. */
  remaining_gap: NutrientAmounts;
  /** Percent covered, 0 to 100. */
  coverage_pct: { carb: number; sodium: number; fluid: number };
  gear?: GearItem[];
  /** Present when the products overshoot the prescription. */
  warnings?: string[];
  /** Present when a gap remains, saying what the base mix covers. */
  note?: string;
  /** A brick or triathlon with exact numbers: each leg prepped against its share. Absent for a single session and on a plan from ranges. */
  legs?: PrepLeg[];
  plan_basis?: PlanBasis;
  safety: SafetyMetadata;
}

// --- Onboarding (headless schema) ---

/** One onboarding question. */
export interface OnboardingQuestion {
  /** The field the answer writes, such as `sweat_level` or `year_of_birth`. */
  field: string;
  type: 'single_select' | 'multi_select' | 'year_of_birth' | 'weight';
  required: boolean;
  title_en: string;
  l10n_key?: string;
  options?: OnboardingOption[];
  /** Bounds for `year_of_birth` and `weight`. */
  min?: number;
  max?: number;
}

/** One answer to a select question. */
export interface OnboardingOption {
  /** The value to store when chosen. */
  value: string | number;
  label_en: string;
  l10n_key?: string;
  /** Multi-select questions may pre-check an option. */
  pre_checked?: boolean;
}

/** `GET /v1/onboarding/questions`. Show `attribution` wherever you render the questions. */
export interface OnboardingQuestionsResponse {
  schema_version: string;
  questions: OnboardingQuestion[];
  attribution: Attribution;
  request_id: string;
}

// --- Athletes ---

export interface Athlete {
  id: string;
  partner_id: string;
  external_id?: string;
  name?: string;
  email?: string;
  sex?: Sex;
  year_of_birth?: number;
  weight_kg?: number;
  /** Set while the athlete has a Saturday subscription. */
  subscription_id?: string;
  settings: AthleteSettings;
  profile_complete: boolean;
  subscription_status?: string;
  /** Returned by `athletes.get` and in the sharing webhooks; absent on lists. */
  profile_sharing?: ProfileSharing;
  partner_plan?: string;
  org_id?: string;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds. */
  updated_at: number;
}

/**
 * Every field is optional on a single create; the answer carries the athlete's `id`. In
 * `batchCreate`, each item needs at least one of `name`, `email` or `external_id`, or it fails
 * with `missing_identifier`.
 */
export interface CreateAthleteRequest {
  /**
   * Your platform's identifier for this athlete, unique within your partner account. A create or
   * update with an `external_id` another of your athletes holds changes nothing and throws a
   * `ConflictError` (409 `athlete_exists`) whose `athleteId` names that athlete, so a retried
   * create is safe.
   */
  external_id?: string;
  name?: string;
  email?: string;
  sex?: Sex;
  year_of_birth?: number;
  weight_kg?: number;
  settings?: AthleteSettings;
  partner_plan?: string;
  org_id?: string;
}

/** Flat profile settings; concerns are flat flags. */
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
  /** Set true once the athlete has answered the concerns question, even with no concern checked. */
  concerns_answered?: boolean;
}

/** Query options for `athletes.list`. */
export interface ListAthletesParams {
  limit?: number;
  cursor?: string;
  /**
   * Only the athletes you created with this `external_id`, newest first, in one page. Athletes
   * created before `external_id` became unique may share one.
   */
  externalId?: string;
  /** Only athletes whose stored profile is (or is not) complete. */
  profileComplete?: boolean;
}

// --- Fueling profile (the athlete's Saturday app answers, when shared) ---

/** One shared answer. `value` is `null` when the athlete has not answered it in the app. */
export interface FuelingProfileField<T> {
  value: T | null;
  calculations_use: CalculationsUse;
}

export interface FuelingConcerns {
  performance: boolean;
  gut_distress: boolean;
  heat_tolerance: boolean;
  muscle_cramps: boolean;
  faintness: boolean;
  hunger: boolean;
  thirst: boolean;
  drinking_resistance: boolean;
}

/** The shared answers, under the calculation field names. */
export interface FuelingProfileAnswers {
  sex: FuelingProfileField<Sex>;
  /** Whole years. */
  age: FuelingProfileField<number>;
  /** Kilograms, one decimal. */
  athlete_weight_kg: FuelingProfileField<number>;
  sweat_level: FuelingProfileField<number>;
  saltiness: FuelingProfileField<number>;
  satiety_level: FuelingProfileField<number>;
  fitness_level: FuelingProfileField<number>;
  carb_experience: FuelingProfileField<CarbExperience>;
  usual_carb_consumption: FuelingProfileField<UsualCarbConsumption>;
  /** `null` when the athlete never answered the concerns question. */
  concerns: FuelingProfileField<FuelingConcerns>;
}

/** A shared answer's name, as `athlete.fueling_profile_updated` lists it in `changed_fields`. */
export type FuelingProfileFieldName = keyof FuelingProfileAnswers;

export interface FuelingProfileShared {
  object: 'fueling_profile';
  athlete_id: string;
  sharing: 'on';
  message: null;
  profile: FuelingProfileAnswers;
  /** Unix seconds. */
  updated_at: number;
}

export interface FuelingProfileNotShared {
  object: 'fueling_profile';
  athlete_id: string;
  sharing: 'off' | 'not_linked';
  message: string;
  profile?: undefined;
  updated_at?: undefined;
}

/** Narrow on `sharing`. */
export type FuelingProfile = FuelingProfileShared | FuelingProfileNotShared;

// --- Activities ---

/** One leg of a stored brick or triathlon. All four fields are required on a write. */
export interface ActivityLeg {
  type: ActivityType;
  /** 5 to 2160 minutes. The legs together may be at most 2160. */
  duration_min: number;
  /** The leg's effort, 1 to 9 (lift and hike: 1 to 3; a higher value is stored as 3). */
  intensity_level: number;
  /** The leg's heat and humidity, 1 (cold, dry) to 9 (hot, humid). */
  thermal_stress_level: number;
}

export interface Activity {
  id: string;
  athlete_id: string;
  partner_id: string;
  type: SessionType;
  /** Minutes; for a brick or triathlon, its legs' total. */
  duration_min: number;
  /** A brick's or triathlon's legs, in order. Absent for a single sport. */
  legs?: ActivityLeg[];
  /** Absent for a brick or triathlon, whose legs carry it. */
  intensity_level?: number;
  /** Absent for a brick or triathlon, whose legs carry it. */
  thermal_stress_level?: number;
  is_race_event?: boolean;
  meal_before_min?: number;
  external_id?: string;
  /** The stored prescription, once the activity has been calculated. */
  prescription?: ActivityPrescription;
  feedback?: ActivityFeedback;
  /** Credit lines the activity's data sources require. Show each verbatim with the activity. */
  source_attributions?: string[];
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds. */
  updated_at: number;
}

/** The fields every activity write may carry. */
interface ActivityFields {
  /** Whether this is a race. Exact numbers need it. */
  is_race_event?: boolean;
  /** Minutes since the last carb-rich meal. Over 180 plans a fasted start. Exact numbers need it. */
  meal_before_min?: number;
  external_id?: string;
}

/** An activity of one sport. */
export interface SingleActivityRequest extends ActivityFields {
  type: ActivityType;
  /** 1 to 2160 minutes. */
  duration_min: number;
  /** 1 to 9 (lift and hike: 1 to 3). Exact numbers need it. */
  intensity_level?: number;
  /** 1 (cold, dry) to 9 (hot, humid). Exact numbers need it. */
  thermal_stress_level?: number;
  legs?: never;
}

/** A brick or triathlon: 2 to 10 legs, each with its own effort and heat. */
export interface LinkedActivityRequest extends ActivityFields {
  type: LinkedSessionType;
  legs: ActivityLeg[];
  /** The legs' total minutes. Leave it out, or send that total. */
  duration_min?: number;
  intensity_level?: never;
  thermal_stress_level?: never;
}

/**
 * `POST /v1/athletes/{athlete_id}/activities`. The fields are `type` and `is_race_event`; any
 * field the request does not take (`activity_type` and `is_race` included) is refused with a
 * `ValidationError` of code `unsupported_field`.
 */
export type CreateActivityRequest = SingleActivityRequest | LinkedActivityRequest;

/**
 * `PATCH` an activity. `legs` replaces a brick's or triathlon's legs and sets `duration_min` to
 * their total. Changing `type` to `brick` or `triathlon` needs `legs` in the same request unless
 * the activity holds legs already, and drops its stored effort and heat; changing it to a single
 * sport removes the legs. A brick or triathlon refuses `intensity_level`, `thermal_stress_level`
 * and a `duration_min` other than its legs' total: change its legs instead.
 *
 * A change to `type`, `legs`, `duration_min`, `intensity_level`, `thermal_stress_level`,
 * `is_race_event` or `meal_before_min` removes the activity's stored prescription:
 * `getPrescription` answers 404 `prescription_not_found` until you calculate the activity again.
 * A field sent at its stored value changes nothing, and `external_id` alone keeps the prescription.
 */
export interface UpdateActivityRequest {
  type?: SessionType;
  duration_min?: number;
  legs?: ActivityLeg[];
  intensity_level?: number;
  thermal_stress_level?: number;
  is_race_event?: boolean;
  meal_before_min?: number;
  external_id?: string;
}

/**
 * A stored prescription. Exact numbers when the profile is complete; when `profile_complete` is
 * false the ranges carry the answer and the six numbers are absent.
 */
export interface ActivityPrescription {
  total_carb_g?: number;
  total_sodium_mg?: number;
  total_fluid_ml?: number;
  carb_g_per_hr?: number;
  sodium_mg_per_hr?: number;
  fluid_ml_per_hr?: number;
  /** Unix seconds. */
  calculated_at: number;
  profile_complete?: boolean;
  carb_range_g_per_hr?: string;
  sodium_range_mg_per_hr?: string;
  fluid_range_ml_per_hr?: string;
  carriage_tactic_id?: string;
  activity_subtype?: string;
  /** A brick or triathlon with exact numbers: each leg's share, in the order of the activity's legs. Absent for a single sport and on a prescription of ranges. */
  legs?: LegPrescription[];
}

/** `activities.calculatePrescription`: full-tier numbers under `prescription`, teaser ranges at the top level. */
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

/** `activities.getPrescription`. */
export interface StoredPrescriptionResponse {
  prescription: ActivityPrescription;
  safety: SafetyMetadata;
}

export interface ActivityFeedbackRequest {
  /** 1 (poor) to 5 (excellent). */
  rating: number;
  notes?: string;
}

export interface ActivityFeedback {
  rating?: number;
  notes?: string;
  /** Unix seconds. */
  created_at: number;
}

// --- Batches and import ---

export interface BatchError {
  /** The failed item's position in your request. */
  index: number;
  code: string;
  message: string;
  /** For `athlete_exists`: the athlete that holds the item's `external_id`. */
  athlete_id?: string;
}

export interface BatchSummary {
  errors?: BatchError[];
  total: number;
  succeeded: number;
  failed: number;
  request_id: string;
}

/** `results` keeps request order with failed items left out; match failures by `errors[].index`. */
export interface BatchCalculateResponse extends BatchSummary {
  results: NutritionCalculateResponse[];
  estimated_ms: number;
  elapsed_ms: number;
}

export interface BatchAthleteResponse extends BatchSummary {
  created: Athlete[];
}

/** One activity to import: the fields of `CreateActivityRequest`, and `calculate`. */
export type ImportActivityRequest = CreateActivityRequest & {
  /** Calculate this activity's prescription even when the request-level `calculate` is false. */
  calculate?: boolean;
};

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

// --- Reference ---

export interface ActivityTypeInfo {
  id: ActivityType;
  name: string;
  description: string;
}

/** A session type made of legs, and the rules for its legs. */
export interface LinkedSessionTypeInfo {
  id: LinkedSessionType;
  name: string;
  description: string;
  min_legs: number;
  max_legs: number;
  /** The sports a leg may be. */
  leg_types: ActivityType[];
  /** The fewest minutes one leg may have. */
  min_leg_duration_min: number;
  /** The most minutes the legs may add up to. */
  max_duration_min: number;
}

export interface ActivityTypesResponse {
  /** The single sports. */
  activity_types: ActivityTypeInfo[];
  /** How many entries `activity_types` holds. */
  total: number;
  /** `brick` and `triathlon`, with the rules for their legs. */
  linked_session_types?: LinkedSessionTypeInfo[];
  request_id: string;
}

/** One athlete setting's type, bounds and default. */
export interface SettingsFieldSchema {
  field: string;
  type: 'integer' | 'string' | 'boolean';
  description: string;
  min?: number;
  max?: number;
  default: number | string | boolean;
  /** The accepted values of a string setting. */
  options?: string[];
}

export interface SettingsSchemaResponse {
  settings: SettingsFieldSchema[];
  total: number;
  request_id: string;
}

/** `POST /v1/infer/activity-type`: what you know about a workout from your system. */
export interface InferActivityTypeRequest {
  activity_name?: string;
  title?: string;
  description?: string;
  pre_activity_comment?: string;
  tags?: string[];
  source_type?: string;
  workout_type?: string;
  device?: string;
  tss_calculation_method?: string;
  structure_summary?: string;
  velocity?: number;
  has_power?: boolean;
  cadence?: number;
}

export interface InferActivityTypeResponse {
  /** A Saturday activity type, or a multisport kind such as `brick`. */
  activity_type: string;
  /** Same value as `activity_type`. */
  type: string;
  confidence: number;
  intensity?: number;
  rest_day?: boolean;
  reasoning?: string;
  alternatives?: { activity_type: ActivityType; confidence: number }[];
  request_id: string;
}

export interface InferBrickRequest {
  activity_name?: string;
  title?: string;
  description?: string;
  structure_summary?: string;
  tags?: string[];
}

export interface InferBrickResponse {
  segments: { activity_type: ActivityType; order: number; name?: string; estimated_duration_min?: number; confidence?: number }[];
  sub_types: ActivityType[];
  total_duration_min?: number;
  confidence: number;
  request_id: string;
}

/** `GET /v1/`: the routes and features this key can see, and how a key is had. */
export interface DiscoveryResponse {
  name: string;
  version: string;
  /** Resource names to paths. A feature short of general availability carries its stage in its name (`"nutrition (alpha)"`); a hidden feature is absent. */
  links: Record<string, string>;
  get_a_key: DiscoveryKeyInfo;
  request_id: string;
}

/**
 * How a key is had, in plain text values: a key comes with any paid Saturday plan and is made by
 * the signed-in account at saturday.fit/api; it covers `athletes_per_key` athletes until Saturday
 * raises it.
 */
export interface DiscoveryKeyInfo {
  how: string;
  /** `https://saturday.fit/api`. */
  page: string;
  /** The account routes that page calls. They take a signed-in Saturday account, not an API key, so the SDK does not call them. */
  account_routes?: string;
  athletes_per_key: number;
  /** How to ask for more athletes. */
  more_athletes: string;
  trial?: string;
  limits?: string;
  platforms?: string;
  /** `api@saturday.fit`. */
  contact: string;
  docs?: string;
  quickstart?: string;
  llms_txt?: string;
  who_is_this?: string;
}

export interface ErrorCatalogEntry {
  code: string;
  type: string;
  http_status: number;
  message: string;
  /** Whether a client may retry the same call automatically after `Retry-After`. False for the daily ceilings, which clear only at midnight UTC. */
  retryable: boolean;
  documentation_url: string;
}

export interface ErrorCatalogResponse {
  errors: ErrorCatalogEntry[];
  total: number;
  request_id: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

// --- Partner account ---

export interface PartnerAccount {
  id: string;
  name: string;
  contact_email: string;
  status: 'active' | 'suspended';
  /** `partner` for a platform partner, `individual` for a key that comes with a Saturday account's paid plan. */
  plan: 'partner' | 'individual';
  rate_limits: {
    requests_per_second: number;
    burst_size: number;
    requests_per_minute: number;
    /** All calls a day; `null` when no daily ceiling applies. */
    requests_per_day: number | null;
    /** Calculation calls a day (nutrition, prep, product fit and compare, inference); `null` when none applies. */
    ip_requests_per_day: number | null;
    /** New athlete trials this key may start per UTC day; an athlete past it gets ranges with `trial_start_deferred`. `null` when the key has no such bound. */
    trial_starts_per_day: number | null;
    /** Distinct profiles one trial athlete's exact numbers cover over the trial; a further one gets ranges with `trial_profile_limit_reached`. `null` when the key has no such bound. */
    trial_profiles_per_athlete: number | null;
    /** Days an athlete's trial lasts from its first exact answer. */
    trial_days: number;
    /** Exact answers one athlete's trial gives in all, however the days fall; the next answer gets ranges with `trial_answers_used_up`. `null` when the key has no such bound. */
    trial_answers: number | null;
  };
  /** Unix seconds. */
  created_at: number;
  /** Where the hosted onboarding page sends athletes back to you. Absent when none is set. */
  return_url?: string;
  /**
   * Where an athlete who opens an expired onboarding link is sent, with `athlete_id` and `locale`
   * in the query, so your server can get a fresh link and send them on. Absent when none is set.
   */
  refresh_url?: string;
}

/** One UTC day of usage. */
export interface DailyUsage {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  total_calls: number;
  by_endpoint: Record<string, number>;
  /** Calculation calls, counted against `ip_requests_per_day`. */
  ip_calls: number;
  own_calls: number;
  unique_athletes: number;
  estimate_calculates: number;
}

/** `from` and `to` are `YYYY-MM-DD` (UTC). */
export interface UsageParams {
  from?: string;
  to?: string;
}

export interface UsageResponse {
  total_calls: number;
  by_endpoint: Record<string, number>;
  period: { from: string; to: string };
  daily: DailyUsage[];
  request_id: string;
}

export interface DailyUsageResponse {
  daily: DailyUsage[];
  period: { from: string; to: string };
  request_id: string;
}

export interface ApiKeyInfo {
  /** The key's id (a hash; never the key itself). */
  id: string;
  name: string;
  environment: 'live' | 'test';
  scopes: string[];
  /** Unix seconds. */
  created_at: number;
  /** The last authenticated call, Unix seconds; 0 when never used. */
  last_used_at: number;
  revoked: boolean;
}

export interface ApiKeyListResponse {
  api_keys: ApiKeyInfo[];
  total: number;
  request_id: string;
}

/** A new key. `key` is shown once: store it. */
export interface CreatedApiKey {
  id: string;
  key: string;
  name: string;
  environment: 'live' | 'test';
  scopes: string[];
  /** Unix seconds. */
  created_at: number;
  message: string;
  request_id: string;
}

/** A rotated key: the old key is revoked, `key` is the new one, shown once. */
export interface RotatedApiKey {
  id: string;
  key: string;
  name: string;
  environment: 'live' | 'test';
  scopes: string[];
  /** The id of the key this one replaced. */
  rotated_from: string;
  message: string;
  request_id: string;
}

// --- Webhooks ---

export interface Webhook {
  id: string;
  partner_id: string;
  url: string;
  events: WebhookEventType[];
  active: boolean;
  fail_count: number;
  /** Unix seconds; set when Saturday disabled the webhook after repeated failures. */
  disabled_at?: number;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds. */
  updated_at: number;
}

/** A new webhook with its signing secret, shown once. */
export interface WebhookFull extends Webhook {
  /** HMAC-SHA256 signing secret, 64 hex characters. Store it now: it is never returned again. */
  secret: string;
}

/** `webhooks.create`: the new webhook, with its signing secret, under `webhook`. */
export interface WebhookCreateResponse {
  webhook: WebhookFull;
  message: string;
  request_id: string;
}

export interface WebhookListResponse {
  webhooks: Webhook[];
  total: number;
  request_id: string;
}

export interface UpdateWebhookRequest {
  url?: string;
  events?: WebhookEventType[];
  active?: boolean;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  partner_id: string;
  event_id: string;
  event_type: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed' | 'exhausted';
  /** The status code your endpoint returned. */
  status_code: number;
  /** The first kilobyte of your endpoint's response body. */
  response_body?: string;
  /** The delivered event body, base64. */
  event_data?: string;
  attempts: number;
  /** Unix seconds. */
  next_retry_at?: number;
  /** Unix seconds. */
  completed_at?: number;
  /** Unix seconds. */
  created_at: number;
}

/** `webhooks.listDeliveries`: the 50 most recent attempts, newest first. */
export interface WebhookDeliveryList {
  deliveries: WebhookDelivery[];
  total: number;
  request_id: string;
}

/** `webhooks.test`: the record of the `webhook.test` delivery, with your endpoint's status code. */
export interface WebhookTestResponse {
  delivery: WebhookDelivery;
  request_id: string;
}

/** A webhook delivery's body. Verify the signature on the raw body before parsing it. */
export interface WebhookEvent<Type extends string = WebhookEventType, Data = unknown> {
  /** Drop a repeat by its id. */
  id: string;
  type: Type;
  /** When the event happened, Unix seconds. The signature header's `t` is Unix seconds too. */
  created_at: number;
  data: Data;
}

/** The athlete's sharing state changed: `data` is the athlete record, `profile_sharing` its new state. */
export type ProfileSharingChangedEvent = WebhookEvent<'athlete.profile_sharing_changed', Athlete & { profile_sharing: ProfileSharing }>;

/** A shared answer changed while sharing is on: the athlete record plus the names of the changed answers, never their values. */
export type FuelingProfileUpdatedEvent = WebhookEvent<'athlete.fueling_profile_updated', Athlete & { profile_sharing: ProfileSharing; changed_fields: FuelingProfileFieldName[] }>;

// --- Organizations ---

export interface Organization {
  id: string;
  partner_id: string;
  display_name: string;
  description?: string;
  sport?: string;
  member_count: number;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds. */
  updated_at: number;
}

export interface CreateOrganizationRequest {
  display_name: string;
  description?: string;
  sport?: string;
}

export interface OrganizationListResponse {
  organizations: Organization[];
  pagination: PaginationMeta;
  request_id: string;
}

export interface OrganizationMember {
  id: string;
  email: string;
  role: 'admin' | 'member';
  athlete_id?: string;
  /** Unix seconds. */
  joined_at: number;
}

export interface AddMemberRequest {
  email: string;
  role?: 'admin' | 'member';
  athlete_id?: string;
}

export interface OrganizationMembersResponse {
  members: OrganizationMember[];
  total: number;
  request_id: string;
}

/** A discount for the organization's athletes at their own Saturday checkout. */
export interface OrganizationOfferRequest {
  /** 1 to 30. */
  discount_percent: number;
  /** `12_month`, `1_month`, or omitted for every plan. */
  applies_to_plan?: string;
  negotiated_by?: string;
  /** Unix seconds. */
  starts_at?: number;
  /** Unix seconds. */
  ends_at?: number;
  note?: string;
}

export interface OrganizationOffer {
  id: string;
  org_id: string;
  discount_percent: number;
  applies_to_plan?: string;
  active: boolean;
  negotiated_by?: string;
  starts_at?: number;
  ends_at?: number;
  /** Unix seconds. */
  created_at: number;
  note?: string;
  /** The most the stacked discounts at checkout can reach, percent. */
  stack_cap_percent: number;
}

/** A seat subscription Saturday set up for the organization. */
export interface OrganizationSubscription {
  id: string;
  org_id: string;
  partner_id: string;
  type: 'team' | 'enterprise';
  seats: number;
  used_seats: number;
  status: 'active' | 'expired' | 'cancelled';
  /** Unix seconds. */
  start_date: number;
  /** Unix seconds. */
  end_date: number;
  /** Unix seconds. */
  created_at: number;
}

export interface CreateOrganizationSubscriptionRequest {
  type: 'team' | 'enterprise';
  seats: number;
  /** Unix seconds. */
  start_date: number;
  /** Unix seconds. */
  end_date: number;
}

/** Only these four fields; any other is refused with 400 `unsupported_field`. Dates in Unix seconds. */
export interface UpdateOrganizationSubscriptionRequest {
  seats?: number;
  status?: 'active' | 'expired' | 'cancelled';
  start_date?: number;
  end_date?: number;
}

export interface OrganizationSubscriptionListResponse {
  subscriptions: OrganizationSubscription[];
  total: number;
  request_id: string;
}

export interface LicenseInput {
  athlete_id: string;
  email?: string;
  name?: string;
}

export interface License {
  athlete_id?: string;
  email: string;
  name?: string;
  /** Unix seconds. */
  added_at: number;
  active: boolean;
}

export interface LicenseListResponse {
  licenses: License[];
  total: number;
  request_id: string;
}

// --- Privacy: export, erase, consent ---

export type ConsentType = 'data_processing' | 'marketing' | 'analytics';

export interface ConsentRecord {
  id: string;
  athlete_id: string;
  partner_id: string;
  consent_type: ConsentType;
  granted: boolean;
  /** Unix seconds. */
  granted_at: number;
  /** Unix seconds. */
  revoked_at?: number;
  ip_address?: string;
}

export interface ConsentListResponse {
  consent: ConsentRecord[];
  total: number;
  request_id: string;
}

/** Everything Saturday holds for the athlete under your account. */
export interface AthleteDataExport {
  athlete_id: string;
  partner_id: string;
  /** When the export was made, Unix seconds. */
  exported_at: number;
  /** The athlete record as stored, every stored field included. Every time in the export's records is Unix seconds. */
  profile: Record<string, unknown>;
  /** Each activity as stored, its stored prescription included. */
  activities?: Record<string, unknown>[];
  consent?: Record<string, unknown>[];
  [key: string]: unknown;
}

// --- Integrations ---

/** The providers `integrations.status` and `integrations.disconnect` take. */
export type IntegrationProvider = 'intervals_icu' | 'strava' | 'training_peaks';

/**
 * The provider `integrations.sync` takes. Strava and TrainingPeaks tokens are refused with a
 * `ValidationError` (`invalid_provider`); send TrainingPeaks workouts with
 * `activities.importActivities` once the athlete agrees to share them.
 */
export type SyncProvider = 'intervals_icu';

export interface IntegrationSyncRequest {
  /** Your athlete the activities are stored under. */
  athlete_id: string;
  /** The intervals.icu OAuth access token of the user whose activities to fetch, obtained by your intervals.icu app. */
  access_token: string;
  /** `['activities']`, which the client sends when you leave it out. */
  sync_types?: ['activities'];
  /** Both dates (`YYYY-MM-DD`) or neither; without them, the last 7 days. */
  date_range?: { start: string; end: string };
}

/** What a sync did. */
export interface IntegrationSyncResult {
  provider: SyncProvider;
  /** `partial` when some activities could not be stored, `failed` when none could or intervals.icu refused the token; `errors` says why. */
  status: 'completed' | 'partial' | 'failed';
  activities_found: number;
  activities_synced: number;
  /** Found but not stored: the activity's type names no sport the API supports. */
  activities_skipped: number;
  /** Whether the athlete's prescriptions for these activities are exact (`full`) or ranges (`teaser`). */
  prescription_tier?: SubscriptionTier;
  errors?: string[];
}

export interface IntegrationSyncResponse {
  result: IntegrationSyncResult;
  request_id: string;
}

export interface IntegrationStatusResponse {
  status: {
    provider: IntegrationProvider;
    connected: boolean;
    /** Unix seconds. */
    last_sync_at?: number;
    sync_count: number;
    errors?: string[];
  };
  request_id: string;
}

/** `integrations.disconnect`: the connection you supplied is ended. */
export interface IntegrationDisconnectResponse {
  /** For example `Successfully disconnected intervals_icu`. */
  message: string;
  provider: IntegrationProvider;
  request_id: string;
}

// --- Test project ---

export interface SimulateSubscriptionResponse {
  athlete_id: string;
  simulated_active: boolean;
  request_id: string;
}

// --- Knowledge (early access) ---

export interface KnowledgeSearchRequest {
  query: string;
  limit?: number;
  category?: string;
}

// --- Lists ---

export interface PaginationMeta {
  /** Records on this page. */
  total: number;
  has_more: boolean;
  /** Pass as `cursor` for the next page. */
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

// --- Errors ---

export interface SaturdayErrorDetail {
  type: string;
  code: string;
  message: string;
  param?: string;
  documentation_url?: string;
  request_id?: string;
  /** For `athlete_exists` (409): the athlete that holds the `external_id` you sent. */
  athlete_id?: string;
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
/** `'*'` subscribes to every coach event. `coach.message.sent` fires only for Enterprise coaches. */
export type CoachWebhookEvent = 'concern.detected' | 'athlete.needs_attention' | 'coach.message.sent' | 'athlete.deleted' | '*';

/**
 * On a Coach API answer about an athlete who connected an app whose data stays on Saturday:
 * some of their sessions, and that app's details on sessions other apps also recorded, are not
 * in the answer. Show `message`; treat a short session list as incomplete.
 */
export interface CoachWithheldNotice {
  kind: 'connected_app_sessions';
  message: string;
}

/** Per-athlete needs-attention summary on the roster. */
export interface RosterEntry {
  athlete_uid: string;
  flagged: boolean;
  flagged_count: number;
  /** Up to four reasons the sessions were flagged, most frequent first. `[]` when not flagged. */
  top_reasons: string[];
  /** Present when some of this athlete's sessions are not in the answer. */
  withheld?: CoachWithheldNotice;
  session_count: number;
  /** Credit the sources of the sessions behind these markers require. Absent when none is required. */
  source_attributions?: string[];
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
  /** Present when some of this athlete's sessions are not in the answer. */
  withheld?: CoachWithheldNotice;
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
  /** Present when some of this athlete's sessions are not in the answer. */
  withheld?: CoachWithheldNotice;
  from_cache: boolean;
  /** Credit the sources of the sessions the narrative was written from require. Absent when none is required. */
  source_attributions?: string[];
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

/**
 * Limit on the emails, and separately the pushes, one athlete's alerts send the coach in any
 * 60 minutes, urgent alerts included. Held alerts go out together when the hour frees. With no
 * scope setting it, the cap is on at 1 per hour. In-portal alerts and webhooks are never limited.
 */
export interface HourlyCap {
  enabled: boolean;
  per_hour?: number; // 1 to 12
}

/** The full alert rule set at one scope (PUT replaces the whole set — idempotent). */
/** Where the email and push channels deliver. A rules read always carries it. */
export interface ChannelConfig {
  email: { enabled: boolean; address?: string };
  push: { enabled: boolean; devices?: string[] };
}

/**
 * The full alert rule set at one scope. A PUT replaces the whole set, `channel_config` included:
 * send back the one a read returned. Left out at the overall scope, email and push alerts turn off.
 */
export interface AlertRulesDoc {
  channel_config?: ChannelConfig;
  notification_rules?: Record<string, TriggerRule>;
  combinators?: Combinator[];
  quiet_hours?: QuietHours;
  /** Absent means this scope inherits the cap; a PUT that leaves it out clears it here. */
  hourly_cap?: HourlyCap;
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
  /** Coach-paid athletes whose seat starts billing when the time they paid for on their own Monthly plan runs out; not in `coach_paid_count` until then. */
  pending_coach_paid_count: number;
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
  /** The least Saturday's fee takes from a charge. */
  platform_fee_minimum_cents: number;
  /** When the coach starts paying Stripe's processing fee (Unix ms); 0 while Saturday pays it. */
  coach_pays_stripe_fees_from: number;
  /** Stripe's processing fee on Saturday's account: a domestic and an international card rate, plus a fixed amount per charge. */
  stripe_fee_domestic_bps: number;
  stripe_fee_international_bps: number;
  stripe_fee_fixed_cents: number;
}

/** Fee totals across the coach's settled charges. */
export interface CoachEarningsSummary {
  coach_uid: string;
  total_gross_cents: number;
  total_stripe_fee_cents: number;
  total_platform_fee_cents: number;
  /** Refunded to athletes. */
  total_refunded_cents: number;
  /** Saturday's fee given back on refunds. */
  total_platform_fee_returned_cents: number;
  /** Taken for disputes and their fees, less what was paid back. */
  total_disputes_cents: number;
  /** The part of `total_disputes_cents` that repaid earlier disputes' costs. */
  total_dispute_costs_recovered_cents: number;
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
  /** The part of Stripe's processing fee the coach pays. */
  stripe_fees_cents: number;
  /** Who paid Stripe's processing fee; absent when no fee was recorded. */
  stripe_fee_paid_by?: 'coach' | 'saturday';
  platform_fee_cents: number;
  /** Refunded to the athlete. */
  refunded_cents: number;
  /** Saturday's fee given back on refunds. */
  platform_fee_returned_cents: number;
  /** Taken for disputes and their fees, less what was paid back. */
  disputes_cents: number;
  /** The part of `disputes_cents` that repaid earlier disputes' costs. */
  dispute_costs_recovered_cents: number;
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
  /** The part of Stripe's processing fee the coach pays. */
  stripe_fees_cents: number;
  net_to_coach_cents: number;
  currency: string;
  /** `refunded` once any part of the charge is refunded; `refund_amount_cents` says how much. */
  status: 'succeeded' | 'pending' | 'failed' | 'refunded' | 'disputed' | 'dispute_lost';
  /** Refunded to the athlete; absent while nothing is. */
  refund_amount_cents?: number;
  captured_at: number;
  stripe_webhook_event_id: string;
  /** Who paid Stripe's processing fee on a destination charge; absent on a direct charge, where the coach did. */
  stripe_fee_paid_by?: 'coach' | 'saturday';
  /** Saturday's fee given back on refunds; absent while none is. */
  platform_fee_returned_cents?: number;
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
