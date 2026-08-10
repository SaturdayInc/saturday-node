import type {
  SaturdayConfig,
  NutritionCalculateRequest,
  NutritionCalculateResponse,
  Athlete,
  CreateAthleteRequest,
  Activity,
  CreateActivityRequest,
  AthleteSettings,
  ProductCategory,
  ProductLookupResponse,
  ProductSearchResponse,
  CuratedProductsResponse,
  AIConversation,
  AIMessage,
  Webhook,
  WebhookFull,
  Organization,
  GearItem,
  AthleteListResponse,
  ActivityListResponse,
  CoachWindow,
  CoachFocus,
  CoachScope,
  CoachPreset,
  Roster,
  RosterDigest,
  FuelingRollup,
  AthleteReport,
  SessionDetail,
  AlertRulesDoc,
  CoachReportSettings,
  CoachWebhookEndpoint,
  CoachWebhookWithSecret,
  CoachWebhookEvent,
  OnboardingQuestionsResponse,
} from './types';
import {
  SaturdayError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
} from './errors';

const DEFAULT_BASE_URL = 'https://api.saturday.fit';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const SDK_VERSION = '0.5.0';

/**
 * Saturday Nutrition Intelligence API client.
 *
 * Provides personalized fuel, hydration, and electrolyte prescriptions for
 * endurance athletes. Safety metadata is always included in responses —
 * athlete safety cannot be paywalled.
 *
 * @example
 * ```typescript
 * const saturday = new Saturday({ apiKey: 'sk_live_...' });
 * const rx = await saturday.nutrition.calculate({
 *   activity_type: 'run',
 *   duration_min: 90,
 *   thermal_stress_level: 8,
 * });
 * ```
 */
export class Saturday {
  private readonly config: Required<Omit<SaturdayConfig, 'bearerToken'>> & { bearerToken?: string };

  /** Nutrition intelligence endpoints — the crown jewel. */
  readonly nutrition: NutritionResource;

  /** Partner-scoped athlete management. */
  readonly athletes: AthletesResource;

  /** Activity management and prescription calculation. */
  readonly activities: ActivitiesResource;

  /** Product database search and lookup. */
  readonly products: ProductsResource;

  /** AI coaching conversations (feature-gated: ai_coach). */
  readonly ai: AIResource;

  /** Webhook event subscriptions. */
  readonly webhooks: WebhooksResource;

  /** Organization and team management. */
  readonly organizations: OrganizationsResource;

  /** Gear inventory management (feature-gated: gear). */
  readonly gear: GearResource;

  /** Knowledge base search. */
  readonly knowledge: KnowledgeResource;

  /** Athlete-onboarding question schema (the headless collection mechanism). */
  readonly onboarding: OnboardingResource;

  /**
   * Coach API — roster fueling reads + the coach's own alerting/report config
   * (Module 5). Requires a coach API key (`cp_live_`/`cp_test_`, passed as
   * `apiKey`) or an OAuth2 coach-scoped bearer token, and the Pro-Coach+ tier.
   */
  readonly coach: CoachResource;

  constructor(config: SaturdayConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      timeout: config.timeout || DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || DEFAULT_MAX_RETRIES,
      bearerToken: config.bearerToken,
    };

    this.nutrition = new NutritionResource(this);
    this.athletes = new AthletesResource(this);
    this.activities = new ActivitiesResource(this);
    this.products = new ProductsResource(this);
    this.ai = new AIResource(this);
    this.webhooks = new WebhooksResource(this);
    this.organizations = new OrganizationsResource(this);
    this.gear = new GearResource(this);
    this.knowledge = new KnowledgeResource(this);
    this.onboarding = new OnboardingResource(this);
    this.coach = new CoachResource(this);
  }

  /**
   * Make an authenticated API request with retry logic.
   * Retries on 429 (rate limit) and 5xx (server errors) with exponential backoff.
   */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: SaturdayError | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': `saturday-node/${SDK_VERSION}`,
        'X-SDK-Version': SDK_VERSION,
      };

      // Auth: Bearer token (OAuth2) takes priority over API key
      if (this.config.bearerToken) {
        headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
      } else {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          if (response.status === 204) return undefined as T;
          return await response.json() as T;
        }

        // Parse error response
        const errorBody: any = await response.json().catch(() => ({
          error: { type: 'api_error', code: 'unknown', message: 'Unknown error' }
        }));
        const errorDetail = errorBody.error || errorBody;

        // Map to typed errors
        const error = this.mapError(response.status, errorDetail, response.headers);
        lastError = error;

        // Only retry on rate limit or server errors
        if (response.status === 429 || response.status >= 500) {
          continue;
        }

        throw error;
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof SaturdayError) throw e;
        if ((e as Error).name === 'AbortError') {
          throw new SaturdayError(0, {
            type: 'api_error',
            code: 'timeout',
            message: `Request timed out after ${this.config.timeout}ms`,
          });
        }
        throw e;
      }
    }

    // All retries exhausted
    throw lastError || new SaturdayError(0, {
      type: 'api_error',
      code: 'max_retries_exceeded',
      message: 'Maximum retry attempts exceeded',
    });
  }

  private mapError(status: number, detail: any, headers: Headers): SaturdayError {
    switch (status) {
      case 401:
        return new AuthenticationError(detail);
      case 404:
        return new NotFoundError(detail);
      case 429: {
        const retryAfter = parseInt(headers.get('Retry-After') || '60', 10);
        return new RateLimitError(detail, retryAfter);
      }
      case 400:
      case 422:
        return new ValidationError(detail);
      default:
        return new SaturdayError(status, detail);
    }
  }
}

// --- Resource Classes ---

class NutritionResource {
  constructor(private client: Saturday) {}

  /** Calculate a personalized fuel/hydration/electrolyte prescription. */
  async calculate(req: NutritionCalculateRequest): Promise<NutritionCalculateResponse> {
    return this.client.request('POST', '/v1/nutrition/calculate', req);
  }

  /** Batch calculate prescriptions for multiple scenarios (max 50). */
  async batchCalculate(scenarios: NutritionCalculateRequest[]): Promise<{
    results: Array<{ index: number; prescription?: NutritionCalculateResponse; error?: any }>;
    succeeded: number;
    failed: number;
  }> {
    return this.client.request('POST', '/v1/nutrition/calculate/batch', { scenarios });
  }
}

class AthletesResource {
  constructor(private client: Saturday) {}

  async create(athlete: CreateAthleteRequest): Promise<Athlete> {
    return this.client.request('POST', '/v1/athletes', athlete);
  }

  async get(athleteId: string): Promise<Athlete> {
    return this.client.request('GET', `/v1/athletes/${athleteId}`);
  }

  async list(params?: { limit?: number; cursor?: string; search?: string }): Promise<AthleteListResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return this.client.request('GET', `/v1/athletes${qs ? '?' + qs : ''}`);
  }

  async update(athleteId: string, updates: Partial<CreateAthleteRequest>): Promise<Athlete> {
    return this.client.request('PATCH', `/v1/athletes/${athleteId}`, updates);
  }

  async delete(athleteId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/athletes/${athleteId}`);
  }

  async getSettings(athleteId: string): Promise<AthleteSettings> {
    return this.client.request('GET', `/v1/athletes/${athleteId}/settings`);
  }

  async updateSettings(athleteId: string, settings: Partial<AthleteSettings>): Promise<AthleteSettings> {
    return this.client.request('PATCH', `/v1/athletes/${athleteId}/settings`, settings);
  }

  /** Batch create up to 100 athletes. */
  async batchCreate(athletes: CreateAthleteRequest[]): Promise<{
    athletes: Array<{ index: number; athlete?: Athlete; error?: string }>;
    succeeded: number;
    failed: number;
  }> {
    return this.client.request('POST', '/v1/athletes/batch', { athletes });
  }

  /** Export all athlete data (GDPR data portability). */
  async export(athleteId: string): Promise<any> {
    return this.client.request('POST', `/v1/athletes/${athleteId}/export`);
  }
}

class ActivitiesResource {
  constructor(private client: Saturday) {}

  async create(athleteId: string, activity: CreateActivityRequest): Promise<Activity> {
    return this.client.request('POST', `/v1/athletes/${athleteId}/activities`, activity);
  }

  async get(athleteId: string, activityId: string): Promise<Activity> {
    return this.client.request('GET', `/v1/athletes/${athleteId}/activities/${activityId}`);
  }

  async list(athleteId: string, params?: { limit?: number; cursor?: string; type?: string }): Promise<ActivityListResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.type) query.set('type', params.type);
    const qs = query.toString();
    return this.client.request('GET', `/v1/athletes/${athleteId}/activities${qs ? '?' + qs : ''}`);
  }

  async update(athleteId: string, activityId: string, updates: Partial<CreateActivityRequest>): Promise<Activity> {
    return this.client.request('PATCH', `/v1/athletes/${athleteId}/activities/${activityId}`, updates);
  }

  async delete(athleteId: string, activityId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/athletes/${athleteId}/activities/${activityId}`);
  }

  /** Calculate/recalculate a nutrition prescription for this activity. */
  async calculatePrescription(athleteId: string, activityId: string): Promise<NutritionCalculateResponse> {
    return this.client.request('POST', `/v1/athletes/${athleteId}/activities/${activityId}/calculate`);
  }

  /** Get the stored prescription for an activity. */
  async getPrescription(athleteId: string, activityId: string): Promise<NutritionCalculateResponse> {
    return this.client.request('GET', `/v1/athletes/${athleteId}/activities/${activityId}/prescription`);
  }

  /** Submit post-activity feedback on prescription quality. */
  async submitFeedback(athleteId: string, activityId: string, feedback: {
    /** Overall prescription quality, 1 (poor) to 5 (excellent). */
    rating: number;
    notes?: string;
  }): Promise<{ id: string; message: string }> {
    return this.client.request('POST', `/v1/athletes/${athleteId}/activities/${activityId}/feedback`, feedback);
  }
}

class ProductsResource {
  constructor(private client: Saturday) {}

  async getByBarcode(barcode: string, athleteId: string): Promise<ProductLookupResponse> {
    const qs = new URLSearchParams({ athlete_id: athleteId });
    return this.client.request('GET', `/v1/products/${barcode}?${qs}`);
  }

  async search(query: string, athleteId: string): Promise<ProductSearchResponse> {
    const qs = new URLSearchParams({ q: query, athlete_id: athleteId });
    return this.client.request('GET', `/v1/products/search?${qs}`);
  }

  /** Pass `next_cursor` from the previous response to advance (10 per page). */
  async listCurated(athleteId: string, cursor?: string): Promise<CuratedProductsResponse> {
    const qs = new URLSearchParams({ athlete_id: athleteId });
    if (cursor) qs.set('cursor', cursor);
    return this.client.request('GET', `/v1/products/curated?${qs}`);
  }

  /** The taxonomy is the free tier: every athlete gets the same answer. */
  async listCategories(athleteId: string): Promise<{ categories: ProductCategory[] }> {
    const qs = new URLSearchParams({ athlete_id: athleteId });
    return this.client.request('GET', `/v1/products/categories?${qs}`);
  }
}

class AIResource {
  constructor(private client: Saturday) {}

  /** Start a new AI coaching conversation for an athlete. */
  async createConversation(athleteId: string, initialMessage?: string): Promise<AIConversation> {
    return this.client.request('POST', '/v1/ai/conversations', {
      athlete_id: athleteId,
      initial_message: initialMessage,
    });
  }

  /** Send a message and receive the AI response (non-streaming). */
  async sendMessage(convId: string, message: string): Promise<AIMessage> {
    return this.client.request('POST', `/v1/ai/conversations/${convId}/messages`, { message });
  }

  /** Get conversation history. */
  async getMessages(convId: string, params?: { limit?: number }): Promise<{ messages: AIMessage[] }> {
    const qs = params?.limit ? `?limit=${params.limit}` : '';
    return this.client.request('GET', `/v1/ai/conversations/${convId}/messages${qs}`);
  }

  /** Get conversation metadata. */
  async getConversation(convId: string): Promise<AIConversation> {
    return this.client.request('GET', `/v1/ai/conversations/${convId}`);
  }

  /** Delete a conversation. */
  async deleteConversation(convId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/ai/conversations/${convId}`);
  }

  /** List conversations for an athlete. */
  async listConversations(athleteId: string, params?: { limit?: number }): Promise<{ conversations: AIConversation[] }> {
    const qs = params?.limit ? `?limit=${params.limit}` : '';
    return this.client.request('GET', `/v1/athletes/${athleteId}/ai/conversations${qs}`);
  }
}

class WebhooksResource {
  constructor(private client: Saturday) {}

  async create(url: string, events: string[], description?: string): Promise<WebhookFull> {
    return this.client.request('POST', '/v1/webhooks', { url, events, description });
  }

  async list(): Promise<{ webhooks: Webhook[] }> {
    return this.client.request('GET', '/v1/webhooks');
  }

  async get(webhookId: string): Promise<Webhook> {
    return this.client.request('GET', `/v1/webhooks/${webhookId}`);
  }

  async update(webhookId: string, updates: { url?: string; events?: string[]; active?: boolean }): Promise<Webhook> {
    return this.client.request('PATCH', `/v1/webhooks/${webhookId}`, updates);
  }

  async delete(webhookId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/webhooks/${webhookId}`);
  }

  async test(webhookId: string): Promise<any> {
    return this.client.request('POST', `/v1/webhooks/${webhookId}/test`);
  }
}

class OrganizationsResource {
  constructor(private client: Saturday) {}

  async create(displayName: string, opts?: { description?: string; sport?: string }): Promise<Organization> {
    return this.client.request('POST', '/v1/organizations', { display_name: displayName, ...opts });
  }

  async list(): Promise<{ organizations: Organization[] }> {
    return this.client.request('GET', '/v1/organizations');
  }

  async get(orgId: string): Promise<Organization> {
    return this.client.request('GET', `/v1/organizations/${orgId}`);
  }

  async addMember(orgId: string, email: string, role: 'admin' | 'member', athleteId?: string): Promise<any> {
    return this.client.request('POST', `/v1/organizations/${orgId}/members`, { email, role, athlete_id: athleteId });
  }

  async listMembers(orgId: string): Promise<{ members: any[] }> {
    return this.client.request('GET', `/v1/organizations/${orgId}/members`);
  }

  async removeMember(orgId: string, memberId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/organizations/${orgId}/members/${memberId}`);
  }
}

class GearResource {
  constructor(private client: Saturday) {}

  async list(athleteId: string): Promise<{ gear: GearItem[] }> {
    return this.client.request('GET', `/v1/athletes/${athleteId}/gear`);
  }

  async create(athleteId: string, gear: { name: string; type: string; capacity_ml: number; is_default?: boolean }): Promise<GearItem> {
    return this.client.request('POST', `/v1/athletes/${athleteId}/gear`, gear);
  }

  async update(athleteId: string, gearId: string, updates: Partial<GearItem>): Promise<GearItem> {
    return this.client.request('PATCH', `/v1/athletes/${athleteId}/gear/${gearId}`, updates);
  }

  async delete(athleteId: string, gearId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/athletes/${athleteId}/gear/${gearId}`);
  }
}

class KnowledgeResource {
  constructor(private client: Saturday) {}

  async search(query: string, params?: { limit?: number; category?: string }): Promise<any> {
    return this.client.request('POST', '/v1/knowledge/search', { query, ...params });
  }

  async listTopics(): Promise<{ topics: any[] }> {
    return this.client.request('GET', '/v1/knowledge/topics');
  }

  async getArticle(articleId: string): Promise<any> {
    return this.client.request('GET', `/v1/knowledge/articles/${articleId}`);
  }
}

/**
 * Onboarding resource — the headless mechanism for collecting an athlete's
 * fueling profile in your own UI. `questions()` returns the versioned schema
 * (the same definitions the hosted page renders); render it natively and write
 * answers via `athletes.updateSettings()` or athlete create/update. Exact
 * numbers require a complete profile — every calculate response's `precision`
 * object tells you what's still missing.
 *
 * **Attribution is required** when you render these questions in your UI — the
 * schema response carries the attribution object, same contract as calculations.
 *
 * @example
 * ```typescript
 * const { questions } = await saturday.onboarding.questions();
 * for (const q of questions) renderQuestion(q); // your UI
 * ```
 */
class OnboardingResource {
  constructor(private client: Saturday) {}

  /** Fetch the versioned onboarding question schema. */
  async questions(): Promise<OnboardingQuestionsResponse> {
    return this.client.request('GET', '/v1/onboarding/questions');
  }
}

/**
 * Coach API resource — `/v1/coach/*`.
 *
 * READS scope to the coach's own roster (every `athleteUid` is roster-confined;
 * a non-roster athlete returns a 404 NotFoundError). WRITES only ever touch the
 * coach's OWN config — athlete fueling data is read-only via this API. Requires
 * the Pro-Coach+ tier; a lapsed coach's reads/writes return 404.
 *
 * @example
 * ```typescript
 * // Coach API key (cp_live_...) is passed as apiKey:
 * const saturday = new Saturday({ apiKey: 'cp_live_...' });
 * const digest = await saturday.coach.rosterDigest({ window: 7 });
 * await saturday.coach.applyPreset({ scope: 'overall', preset: 'balanced' });
 * ```
 */
class CoachResource {
  constructor(private client: Saturday) {}

  // --- Reads ---

  /** List the roster with per-athlete needs-attention markers. */
  async roster(params?: { window?: CoachWindow }): Promise<Roster> {
    const qs = params?.window ? `?window=${params.window}` : '';
    return this.client.request('GET', `/v1/coach/roster${qs}`);
  }

  /** The flagged-only digest: only athletes who crossed a concern bar this window. */
  async rosterDigest(params?: { window?: CoachWindow }): Promise<RosterDigest> {
    const qs = params?.window ? `?window=${params.window}` : '';
    return this.client.request('GET', `/v1/coach/roster/digest${qs}`);
  }

  /** One athlete's in-window fueling rollup + concern summary (roster-confined). */
  async fuelingRollup(athleteUid: string, params?: { window?: CoachWindow; focus?: CoachFocus }): Promise<FuelingRollup> {
    return this.client.request('GET', `/v1/coach/athletes/${athleteUid}/fueling-rollup${coachQuery(params)}`);
  }

  /** The AI fueling report (narrative + structured). Pass `refresh: true` to force regeneration. */
  async report(athleteUid: string, params?: { window?: CoachWindow; focus?: CoachFocus; refresh?: boolean }): Promise<AthleteReport> {
    const q = new URLSearchParams();
    if (params?.window) q.set('window', String(params.window));
    if (params?.focus) q.set('focus', params.focus);
    if (params?.refresh) q.set('refresh', 'true');
    const qs = q.toString();
    return this.client.request('GET', `/v1/coach/athletes/${athleteUid}/report${qs ? '?' + qs : ''}`);
  }

  /** The report as a downloadable PDF (returns the raw bytes). */
  async reportPdf(athleteUid: string, params?: { window?: CoachWindow; focus?: CoachFocus }): Promise<ArrayBuffer> {
    const q = new URLSearchParams({ format: 'pdf' });
    if (params?.window) q.set('window', String(params.window));
    if (params?.focus) q.set('focus', params.focus);
    return this.client.request('GET', `/v1/coach/athletes/${athleteUid}/report?${q}`);
  }

  /** Drill into one session by activity id (planned-vs-actual + markers). */
  async sessionDetail(athleteUid: string, activityId: string): Promise<SessionDetail> {
    return this.client.request('GET', `/v1/coach/athletes/${athleteUid}/sessions/${activityId}`);
  }

  // --- Config: alert rules ---

  /** Read the alert rules set at exactly one scope (not the merged resolution). */
  async getNotificationRules(params?: { scope?: CoachScope; scopeId?: string }): Promise<AlertRulesDoc> {
    return this.client.request('GET', `/v1/coach/config/notification-rules${scopeQuery(params)}`);
  }

  /** Replace the alert rules at a scope (idempotent upsert — re-running the same set is a no-op). */
  async setNotificationRules(scope: CoachScope, rules: AlertRulesDoc, scopeId?: string): Promise<{ ok: boolean; scope: string }> {
    return this.client.request('PUT', '/v1/coach/config/notification-rules', { scope, scope_id: scopeId, rules });
  }

  /** Apply a named preset (`hands_off` / `balanced` / `hands_on`) at a scope. */
  async applyPreset(opts: { scope: CoachScope; preset: CoachPreset; scopeId?: string }): Promise<{ ok: boolean; preset: string }> {
    return this.client.request('POST', '/v1/coach/config/preset', { scope: opts.scope, scope_id: opts.scopeId, preset: opts.preset });
  }

  // --- Config: AI report + concern settings ---

  /** Read the AI-report + concern-threshold settings at a scope. */
  async getReportSettings(params?: { scope?: CoachScope; scopeId?: string }): Promise<CoachReportSettings> {
    return this.client.request('GET', `/v1/coach/config/report-settings${scopeQuery(params)}`);
  }

  /** Upsert AI-report + concern-threshold settings at a scope (unset fields fall through). */
  async setReportSettings(scope: CoachScope, settings: CoachReportSettings, scopeId?: string): Promise<{ ok: boolean; scope: string }> {
    return this.client.request('PUT', '/v1/coach/config/report-settings', { scope, scope_id: scopeId, settings });
  }

  // --- Webhooks ---

  /** List the coach's webhook endpoints (secrets never returned). */
  async listWebhooks(): Promise<{ endpoints: CoachWebhookEndpoint[] }> {
    return this.client.request('GET', '/v1/coach/webhooks');
  }

  /** Register a webhook endpoint. The signing secret is returned ONCE — store it. */
  async registerWebhook(url: string, events?: CoachWebhookEvent[]): Promise<CoachWebhookWithSecret> {
    return this.client.request('POST', '/v1/coach/webhooks', { url, events });
  }

  /** Delete a webhook endpoint by id. */
  async deleteWebhook(id: string): Promise<{ ok: boolean }> {
    return this.client.request('DELETE', `/v1/coach/webhooks/${id}`);
  }

  /** Disable a webhook endpoint (stops delivery without deleting it). */
  async disableWebhook(id: string): Promise<{ ok: boolean; active: boolean }> {
    return this.client.request('POST', `/v1/coach/webhooks/${id}/disable`);
  }

  /** Re-enable a previously disabled webhook endpoint. */
  async enableWebhook(id: string): Promise<{ ok: boolean; active: boolean }> {
    return this.client.request('POST', `/v1/coach/webhooks/${id}/enable`);
  }
}

/** Build the ?window=&focus= query for a coach per-athlete read. */
function coachQuery(params?: { window?: CoachWindow; focus?: CoachFocus }): string {
  const q = new URLSearchParams();
  if (params?.window) q.set('window', String(params.window));
  if (params?.focus) q.set('focus', params.focus);
  const qs = q.toString();
  return qs ? '?' + qs : '';
}

/** Build the ?scope=&scope_id= query for a coach config read. */
function scopeQuery(params?: { scope?: CoachScope; scopeId?: string }): string {
  const q = new URLSearchParams();
  if (params?.scope) q.set('scope', params.scope);
  if (params?.scopeId) q.set('scope_id', params.scopeId);
  const qs = q.toString();
  return qs ? '?' + qs : '';
}
