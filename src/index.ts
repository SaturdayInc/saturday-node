/**
 * Saturday Nutrition Intelligence API — Official TypeScript SDK
 *
 * Personalized fuel, hydration, and electrolyte prescriptions for endurance
 * athletes. Calculate carbohydrate, sodium, and fluid targets based on activity
 * type, duration, athlete profile, and environmental conditions.
 *
 * @example
 * ```typescript
 * import Saturday from '@saturdayinc/sdk';
 *
 * const saturday = new Saturday({ apiKey: 'sk_live_...' });
 *
 * const prescription = await saturday.nutrition.calculate({
 *   activity_type: 'bike',
 *   duration_min: 180,
 *   athlete_weight_kg: 75,
 *   thermal_stress_level: 7,
 * });
 *
 * // Safety metadata is ALWAYS included — athlete safety cannot be paywalled
 * console.log(prescription.safety.warnings);
 * console.log(`Carbs: ${prescription.carb_g_per_hr} g/hr`);
 * ```
 *
 * @packageDocumentation
 */

export { Saturday as default } from './client';
export { Saturday } from './client';
export { SaturdayError, AuthenticationError, RateLimitError, ValidationError, NotFoundError } from './errors';
export type {
  SaturdayConfig,
  NutritionCalculateRequest,
  NutritionCalculateResponse,
  SafetyMetadata,
  Athlete,
  CreateAthleteRequest,
  Activity,
  CreateActivityRequest,
  Product,
  AIConversation,
  Webhook,
  Organization,
  AthleteListResponse,
  ActivityListResponse,
} from './types';
