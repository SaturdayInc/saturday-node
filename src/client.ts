import type * as T from './types';
import type {
  AlertRulesDoc,
  AthleteReport,

  CoachConnectArrangements,
  CoachConnectChargesPage,
  CoachConnectEarnings,
  CoachConnectSummary,
  CoachFocus,
  CoachLedgerPage,
  CoachLedgerView,
  CoachPreset,
  CoachReportSettings,
  CoachScope,
  CoachSeatState,
  CoachTierStatus,
  CoachWebhookEndpoint,
  CoachWebhookEvent,
  CoachWebhookWithSecret,
  CoachWindow,
  FuelingRollup,
  Roster,
  RosterDigest,
  SessionDetail,
} from './types';
import {
  SaturdayError,
  AuthenticationError,
  PermissionError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  MAX_RETRY_WAIT_SECONDS,
} from './errors';

const DEFAULT_BASE_URL = 'https://api.saturday.fit';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * A 5xx is retried only where a repeat cannot make a second record: every GET, PUT, PATCH and
 * DELETE, and the POSTs that compute or read (calculations, product fit and compare, label
 * reading, inference, an activity's calculate and prep, export).
 */
function retrySafeOnServerError(method: string, path: string): boolean {
  if (method !== 'POST') return true;
  const bare = path.split('?')[0];
  return bare.startsWith('/v1/nutrition/') || bare.startsWith('/v1/infer/')
    || /^\/v1\/athletes\/[^/]+\/activities\/[^/]+\/(calculate|prep)$/.test(bare)
    || /^\/v1\/athletes\/[^/]+\/export$/.test(bare);
}
const SDK_VERSION = '0.8.0';

type Query = Record<string, string | number | boolean | undefined>;

/** Encode one path segment. */
const seg = (value: string) => encodeURIComponent(value);

function withQuery(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Saturday API client: fueling prescriptions (carbohydrate, sodium and fluid) for endurance
 * sessions, sized to each athlete.
 *
 * @example
 * ```typescript
 * const saturday = new Saturday({ apiKey: 'sk_test_...' });
 * const athlete = await saturday.athletes.create({ external_id: 'user-42', sex: 'female', year_of_birth: 1990, weight_kg: 62 });
 * const plan = await saturday.nutrition.calculate({
 *   athlete_id: athlete.id,
 *   activity_type: 'run',
 *   duration_min: 90,
 *   intensity_level: 5,
 *   thermal_stress_level: 6,
 *   meal_before_min: 120,
 *   is_race: false,
 * });
 * ```
 */
export class Saturday {
  private readonly config: Required<Omit<T.SaturdayConfig, 'bearerToken'>> & { bearerToken?: string };

  /** Calculations, product fit and compare, and nutrition label reading. */
  readonly nutrition: NutritionResource;
  /** Your athletes, their settings, shared Saturday answers, consent, export and erasure. */
  readonly athletes: AthletesResource;
  /** Sessions, their prescriptions, prep, import and feedback. */
  readonly activities: ActivitiesResource;
  /** The onboarding question schema, for collecting a profile in your own UI. */
  readonly onboarding: OnboardingResource;
  /** Activity types and the athlete settings schema. */
  readonly reference: ReferenceResource;
  /** Map a workout from your system to a Saturday activity type. */
  readonly infer: InferResource;
  /** Your partner account: limits, usage and API keys. */
  readonly partner: PartnerResource;
  /** Webhook endpoints and their deliveries. */
  readonly webhooks: WebhooksResource;
  /** Organizations, members, offers and seat subscriptions. */
  readonly organizations: OrganizationsResource;
  /** Activity sync from a provider such as Strava. */
  readonly integrations: IntegrationsResource;
  /** Test project only: simulate an athlete's Saturday subscription. */
  readonly testing: TestingResource;
  /** Discovery, the error catalog and health. */
  readonly meta: MetaResource;
  /** Knowledge base search (early access). */
  readonly knowledge: KnowledgeResource;
  /**
   * Coach API: roster fueling reads and the coach's alerting and report configuration.
   * Needs a coach key (`cp_live_` or `cp_test_`) or a coach-scoped OAuth2 token.
   */
  readonly coach: CoachResource;

  constructor(config: T.SaturdayConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeout: config.timeout || DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      bearerToken: config.bearerToken,
    };

    this.nutrition = new NutritionResource(this);
    this.athletes = new AthletesResource(this);
    this.activities = new ActivitiesResource(this);
    this.onboarding = new OnboardingResource(this);
    this.reference = new ReferenceResource(this);
    this.infer = new InferResource(this);
    this.partner = new PartnerResource(this);
    this.webhooks = new WebhooksResource(this);
    this.organizations = new OrganizationsResource(this);
    this.integrations = new IntegrationsResource(this);
    this.testing = new TestingResource(this);
    this.meta = new MetaResource(this);
    this.knowledge = new KnowledgeResource(this);
    this.coach = new CoachResource(this);
  }

  /**
   * Send an authenticated request, retrying up to `maxRetries` times where a retry can succeed:
   * a 429 throttle or short pacing wait (see `RateLimitError.retryable`), and a 5xx after its
   * `Retry-After` or 1, 2 and 4 seconds, except on a POST that creates or changes a record. Daily
   * ceilings, blocks, waits over 30 seconds and every other 4xx throw at once.
   */
  async request<R>(method: string, path: string, body?: unknown, responseType: 'json' | 'arrayBuffer' = 'json'): Promise<R> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: SaturdayError | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      let retryDelayMs = 0;
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': `saturday-node/${SDK_VERSION}`,
            'X-SDK-Version': SDK_VERSION,
            Authorization: `Bearer ${this.config.bearerToken || this.config.apiKey}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.ok) {
          if (response.status === 204) return undefined as R;
          if (responseType === 'arrayBuffer') return await response.arrayBuffer() as R;
          return await response.json() as R;
        }

        const errorBody: any = await response.json().catch((error: unknown) => {
          if ((error as Error)?.name === 'AbortError') throw error;
          return { error: { type: 'api_error', code: 'unknown', message: `HTTP ${response.status}` } };
        });
        const error = this.mapError(response.status, errorBody?.error || errorBody, response.headers);
        lastError = error;

        if (error instanceof RateLimitError) {
          if (!error.retryable) throw error;
          retryDelayMs = error.retryAfter! * 1000;
        } else if (response.status >= 500 && retrySafeOnServerError(method, path)) {
          if (error.retryAfter !== undefined && error.retryAfter > MAX_RETRY_WAIT_SECONDS) throw error;
          retryDelayMs = (error.retryAfter ?? Math.pow(2, attempt)) * 1000;
        } else {
          throw error;
        }
      } catch (e) {
        if (e instanceof SaturdayError) throw e;
        if ((e as Error).name === 'AbortError') {
          throw new SaturdayError(0, {
            type: 'api_error',
            code: 'timeout',
            message: `Request timed out after ${this.config.timeout}ms`,
          });
        }
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
      if (attempt < this.config.maxRetries) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }

    throw lastError!;
  }

  private mapError(status: number, detail: any, headers: Headers): SaturdayError {
    const header = headers.get('Retry-After');
    const parsed = header === null ? NaN : Number(header);
    const retryAfter = Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
    switch (status) {
      case 400:
      case 422:
        return new ValidationError(detail, status);
      case 401:
        return new AuthenticationError(detail);
      case 403:
        return new PermissionError(detail);
      case 404:
        return new NotFoundError(detail);
      case 429:
        return new RateLimitError(detail, retryAfter);
      default:
        return new SaturdayError(status, detail, retryAfter);
    }
  }
}

// --- Resources ---

class NutritionResource {
  constructor(private client: Saturday) {}

  /**
   * Calculate a prescription for one session. Send `athlete_id` to use a stored athlete, and
   * every session input (`intensity_level`, `thermal_stress_level`, `meal_before_min`, `is_race`)
   * for exact numbers. A brick or triathlon is one call with `legs`, each leg carrying its own
   * effort and heat; the answer's `legs` gives each leg's share.
   */
  calculate(req: T.NutritionCalculateRequest): Promise<T.NutritionCalculateResponse> {
    return this.client.request('POST', '/v1/nutrition/calculate', req);
  }

  /** Calculate up to 50 sessions in one call. Each scenario counts as one call against your limits. */
  batchCalculate(scenarios: T.NutritionCalculateRequest[]): Promise<T.BatchCalculateResponse> {
    return this.client.request('POST', '/v1/nutrition/calculate/batch', { scenarios });
  }

  /** Size one catalog product against the athlete's prescription for a session. */
  productFit(req: T.ProductFitRequest): Promise<T.ProductFitResponse> {
    return this.client.request('POST', '/v1/nutrition/products/fit', req);
  }

  /** Size two catalog products against the athlete's prescription and name the better fit. */
  compareProducts(req: T.ProductCompareRequest): Promise<T.ProductCompareResponse> {
    return this.client.request('POST', '/v1/nutrition/products/compare', req);
  }

  /** Read a nutrition label from one or more photos. */
  extract(req: T.NutritionExtractRequest): Promise<T.NutritionExtractResponse> {
    return this.client.request('POST', '/v1/nutrition/extract', req);
  }
}

class AthletesResource {
  constructor(private client: Saturday) {}

  create(athlete: T.CreateAthleteRequest): Promise<T.Athlete> {
    return this.client.request('POST', '/v1/athletes', athlete);
  }

  get(athleteId: string): Promise<T.Athlete> {
    return this.client.request('GET', `/v1/athletes/${seg(athleteId)}`);
  }

  /** One page of athletes. Pass `pagination.next_cursor` back as `cursor`. */
  list(params?: T.ListAthletesParams): Promise<T.AthleteListResponse> {
    return this.client.request('GET', withQuery('/v1/athletes', {
      limit: params?.limit, cursor: params?.cursor,
      external_id: params?.externalId, profile_complete: params?.profileComplete,
    }));
  }

  /** Update the fields you send. Settings sent here replace the stored settings. */
  update(athleteId: string, updates: Partial<T.CreateAthleteRequest>): Promise<T.Athlete> {
    return this.client.request('PATCH', `/v1/athletes/${seg(athleteId)}`, updates);
  }

  /**
   * Delete the athlete and everything stored under them in your account (activities,
   * prescriptions, consent records). For a data-subject erasure request use `erase`.
   */
  delete(athleteId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/athletes/${seg(athleteId)}`);
  }

  getSettings(athleteId: string): Promise<T.AthleteSettings> {
    return this.client.request('GET', `/v1/athletes/${seg(athleteId)}/settings`);
  }

  /** Replace the athlete's settings. Send every setting you want kept: omitted ones are cleared. */
  updateSettings(athleteId: string, settings: T.AthleteSettings): Promise<T.AthleteSettings> {
    return this.client.request('PATCH', `/v1/athletes/${seg(athleteId)}/settings`, settings);
  }

  /** The athlete's Saturday app answers while they share them with you. Narrow on `sharing`. */
  getFuelingProfile(athleteId: string): Promise<T.FuelingProfile> {
    return this.client.request('GET', `/v1/athletes/${seg(athleteId)}/fueling-profile`);
  }

  /** Create up to 100 athletes in one call. */
  batchCreate(athletes: T.CreateAthleteRequest[]): Promise<T.BatchAthleteResponse> {
    return this.client.request('POST', '/v1/athletes/batch', { athletes });
  }

  /** Everything Saturday holds for the athlete under your account (data portability). */
  export(athleteId: string): Promise<T.AthleteDataExport> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/export`);
  }

  /**
   * Erase the athlete for a right-to-erasure request: everything `delete` removes, plus ending the
   * athlete's connected-provider grants and erasing the data those providers sent, with an audit
   * record of the deletion.
   */
  erase(athleteId: string): Promise<void> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/delete`);
  }

  listConsent(athleteId: string): Promise<T.ConsentListResponse> {
    return this.client.request('GET', `/v1/athletes/${seg(athleteId)}/consent`);
  }

  recordConsent(athleteId: string, consent: { consent_type: T.ConsentType; granted: boolean }): Promise<T.ConsentRecord> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/consent`, consent);
  }

  revokeConsent(athleteId: string, consentId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/athletes/${seg(athleteId)}/consent/${seg(consentId)}`);
  }
}

class ActivitiesResource {
  constructor(private client: Saturday) {}

  /** Store a session: one sport, or a brick or triathlon with `legs`. */
  create(athleteId: string, activity: T.CreateActivityRequest): Promise<T.Activity> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/activities`, activity);
  }

  get(athleteId: string, activityId: string): Promise<T.Activity> {
    return this.client.request('GET', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}`);
  }

  /** One page of the athlete's activities. Pass `pagination.next_cursor` back as `cursor`. */
  list(athleteId: string, params?: { limit?: number; cursor?: string }): Promise<T.ActivityListResponse> {
    return this.client.request('GET', withQuery(`/v1/athletes/${seg(athleteId)}/activities`, { ...params }));
  }

  update(athleteId: string, activityId: string, updates: T.UpdateActivityRequest): Promise<T.Activity> {
    return this.client.request('PATCH', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}`, updates);
  }

  delete(athleteId: string, activityId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}`);
  }

  /** Calculate the activity's prescription and store it. */
  calculatePrescription(athleteId: string, activityId: string): Promise<T.PrescriptionEnvelope> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}/calculate`);
  }

  /** The stored prescription. 404 `prescription_not_found` until the activity has been calculated. */
  getPrescription(athleteId: string, activityId: string): Promise<T.StoredPrescriptionResponse> {
    return this.client.request('GET', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}/prescription`);
  }

  /** Size catalog products against the activity's prescription and show the gap left. */
  prep(athleteId: string, activityId: string, req: T.PrepRequest = {}): Promise<T.PrepResponse> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}/prep`, req);
  }

  /**
   * Import up to 200 activities. `calculate: true` calculates every one; an item's own
   * `calculate: true` calculates that item even when the request-level option is false.
   */
  importActivities(athleteId: string, activities: T.ImportActivityRequest[], options?: { calculate?: boolean }): Promise<T.ActivityImportResponse> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/activities/import`, { activities, ...options });
  }

  submitFeedback(athleteId: string, activityId: string, feedback: T.ActivityFeedbackRequest): Promise<T.ActivityFeedback> {
    return this.client.request('POST', `/v1/athletes/${seg(athleteId)}/activities/${seg(activityId)}/feedback`, feedback);
  }
}

/**
 * The headless onboarding schema: the same questions the hosted page asks. Render them in your
 * UI, write the answers with `athletes.update` or `athletes.updateSettings`, and show the
 * response's `attribution` with them.
 */
class OnboardingResource {
  constructor(private client: Saturday) {}

  questions(): Promise<T.OnboardingQuestionsResponse> {
    return this.client.request('GET', '/v1/onboarding/questions');
  }
}

class ReferenceResource {
  constructor(private client: Saturday) {}

  /**
   * The single sports, and with a partner API key `linked_session_types`: `brick` and
   * `triathlon` with the rules for their legs. `activityType` narrows both lists to the one type named.
   */
  activityTypes(params?: { activityType?: T.SessionType }): Promise<T.ActivityTypesResponse> {
    return this.client.request('GET', withQuery('/v1/activity-types', { activity_type: params?.activityType }));
  }

  settingsSchema(): Promise<T.SettingsSchemaResponse> {
    return this.client.request('GET', '/v1/settings/schema');
  }
}

class InferResource {
  constructor(private client: Saturday) {}

  /** Map a workout from your system (name, tags, device) to a Saturday activity type. */
  activityType(req: T.InferActivityTypeRequest): Promise<T.InferActivityTypeResponse> {
    return this.client.request('POST', '/v1/infer/activity-type', req);
  }

  /** Split a multisport workout into its legs. */
  brickTypes(req: T.InferBrickRequest): Promise<T.InferBrickResponse> {
    return this.client.request('POST', '/v1/infer/brick-types', req);
  }
}

class PartnerResource {
  constructor(private client: Saturday) {}

  /** Your account and its limits. */
  get(): Promise<T.PartnerAccount> {
    return this.client.request('GET', '/v1/partner');
  }

  /** Calls over a period, 30 days by default. */
  usage(params?: T.UsageParams): Promise<T.UsageResponse> {
    return this.client.request('GET', withQuery('/v1/partner/usage', { ...params }));
  }

  /** Calls per UTC day, 7 days by default. */
  usageDaily(params?: T.UsageParams): Promise<T.DailyUsageResponse> {
    return this.client.request('GET', withQuery('/v1/partner/usage/daily', { ...params }));
  }

  listApiKeys(): Promise<T.ApiKeyListResponse> {
    return this.client.request('GET', '/v1/partner/api-keys');
  }

  /** Create a key. The response's `key` is shown once. */
  createApiKey(name: string, opts?: { scopes?: string[] }): Promise<T.CreatedApiKey> {
    return this.client.request('POST', '/v1/partner/api-keys', { name, ...opts });
  }

  revokeApiKey(keyId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/partner/api-keys/${seg(keyId)}`);
  }

  /** Replace a key with a new one and revoke the old one at once. */
  rotateApiKey(keyId: string): Promise<T.RotatedApiKey> {
    return this.client.request('POST', `/v1/partner/api-keys/${seg(keyId)}/rotate`);
  }
}

class WebhooksResource {
  constructor(private client: Saturday) {}

  /** Register an endpoint. Store `response.webhook.secret` now: it signs every delivery and is never returned again. */
  create(url: string, events: T.WebhookEventType[]): Promise<T.WebhookCreateResponse> {
    return this.client.request('POST', '/v1/webhooks', { url, events });
  }

  list(): Promise<T.WebhookListResponse> {
    return this.client.request('GET', '/v1/webhooks');
  }

  get(webhookId: string): Promise<T.Webhook> {
    return this.client.request('GET', `/v1/webhooks/${seg(webhookId)}`);
  }

  update(webhookId: string, updates: T.UpdateWebhookRequest): Promise<T.Webhook> {
    return this.client.request('PATCH', `/v1/webhooks/${seg(webhookId)}`, updates);
  }

  delete(webhookId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/webhooks/${seg(webhookId)}`);
  }

  /** Deliver a `webhook.test` event now and return the delivery record, with your endpoint's status code. */
  test(webhookId: string): Promise<T.WebhookTestResponse> {
    return this.client.request('POST', `/v1/webhooks/${seg(webhookId)}/test`);
  }

  /** The 50 most recent delivery attempts to the endpoint, newest first. */
  listDeliveries(webhookId: string): Promise<T.WebhookDeliveryList> {
    return this.client.request('GET', `/v1/webhooks/${seg(webhookId)}/deliveries`);
  }
}

class OrganizationsResource {
  constructor(private client: Saturday) {}

  create(org: T.CreateOrganizationRequest): Promise<T.Organization> {
    return this.client.request('POST', '/v1/organizations', org);
  }

  list(): Promise<T.OrganizationListResponse> {
    return this.client.request('GET', '/v1/organizations');
  }

  get(orgId: string): Promise<T.Organization> {
    return this.client.request('GET', `/v1/organizations/${seg(orgId)}`);
  }

  update(orgId: string, updates: Partial<T.CreateOrganizationRequest>): Promise<T.Organization> {
    return this.client.request('PATCH', `/v1/organizations/${seg(orgId)}`, updates);
  }

  addMember(orgId: string, member: T.AddMemberRequest): Promise<T.OrganizationMember> {
    return this.client.request('POST', `/v1/organizations/${seg(orgId)}/members`, member);
  }

  listMembers(orgId: string): Promise<T.OrganizationMembersResponse> {
    return this.client.request('GET', `/v1/organizations/${seg(orgId)}/members`);
  }

  removeMember(orgId: string, memberId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/organizations/${seg(orgId)}/members/${seg(memberId)}`);
  }

  /** Set the organization's checkout discount, replacing any active one. */
  setOffer(orgId: string, offer: T.OrganizationOfferRequest): Promise<T.OrganizationOffer> {
    return this.client.request('PUT', `/v1/organizations/${seg(orgId)}/offer`, offer);
  }

  /** The active offer. 404 `org_offer_not_found` when there is none. */
  getOffer(orgId: string): Promise<T.OrganizationOffer> {
    return this.client.request('GET', `/v1/organizations/${seg(orgId)}/offer`);
  }

  deleteOffer(orgId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/organizations/${seg(orgId)}/offer`);
  }

  /**
   * Create a seat subscription. Seat subscriptions are set up with Saturday: without an
   * allowance on your account this is refused with 403 `organization_subscription_restricted`.
   */
  createSubscription(orgId: string, sub: T.CreateOrganizationSubscriptionRequest): Promise<T.OrganizationSubscription> {
    return this.client.request('POST', `/v1/organizations/${seg(orgId)}/subscriptions`, sub);
  }

  listSubscriptions(orgId: string): Promise<T.OrganizationSubscriptionListResponse> {
    return this.client.request('GET', `/v1/organizations/${seg(orgId)}/subscriptions`);
  }

  updateSubscription(orgId: string, subId: string, updates: T.UpdateOrganizationSubscriptionRequest): Promise<T.OrganizationSubscription> {
    return this.client.request('PATCH', `/v1/organizations/${seg(orgId)}/subscriptions/${seg(subId)}`, updates);
  }

  /** License athletes on a seat subscription; each license gives that athlete the full tier. */
  addLicenses(orgId: string, subId: string, licenses: T.LicenseInput[]): Promise<T.LicenseListResponse> {
    return this.client.request('POST', `/v1/organizations/${seg(orgId)}/subscriptions/${seg(subId)}/licenses`, { licenses });
  }

  listLicenses(orgId: string, subId: string): Promise<T.LicenseListResponse> {
    return this.client.request('GET', `/v1/organizations/${seg(orgId)}/subscriptions/${seg(subId)}/licenses`);
  }

  removeLicense(orgId: string, subId: string, athleteId: string): Promise<void> {
    return this.client.request('DELETE', `/v1/organizations/${seg(orgId)}/subscriptions/${seg(subId)}/licenses/${seg(athleteId)}`);
  }
}

class IntegrationsResource {
  constructor(private client: Saturday) {}

  /** Pull the athlete's activities from the provider into Saturday. */
  sync(provider: T.IntegrationProvider, req: T.IntegrationSyncRequest): Promise<T.IntegrationSyncResponse> {
    return this.client.request('POST', `/v1/integrations/${seg(provider)}/sync`, req);
  }

  status(provider: T.IntegrationProvider, athleteId: string): Promise<T.IntegrationStatusResponse> {
    return this.client.request('GET', withQuery(`/v1/integrations/${seg(provider)}/status`, { athlete_id: athleteId }));
  }

  disconnect(provider: T.IntegrationProvider, athleteId: string): Promise<unknown> {
    return this.client.request('POST', `/v1/integrations/${seg(provider)}/disconnect`, { athlete_id: athleteId });
  }
}

/** Test project only (`sk_test_` keys). In production these routes answer 404. */
class TestingResource {
  constructor(private client: Saturday) {}

  /** Give the athlete a simulated Saturday subscription (`active: true`) or take it away. */
  simulateSubscription(athleteId: string, active = true): Promise<T.SimulateSubscriptionResponse> {
    return this.client.request('POST', `/v1/test/athletes/${seg(athleteId)}/simulate-subscription`, { active });
  }
}

class MetaResource {
  constructor(private client: Saturday) {}

  /** The routes and features this key can see. */
  discovery(): Promise<T.DiscoveryResponse> {
    return this.client.request('GET', '/v1/');
  }

  /** Every error code the API can return, with its HTTP status and whether a retry can succeed. */
  errors(): Promise<T.ErrorCatalogResponse> {
    return this.client.request('GET', '/v1/errors');
  }

  health(): Promise<T.HealthResponse> {
    return this.client.request('GET', '/v1/health');
  }
}

/** Early access: a key without access gets 403 `feature_alpha`. */
class KnowledgeResource {
  constructor(private client: Saturday) {}

  search(req: T.KnowledgeSearchRequest): Promise<unknown> {
    return this.client.request('POST', '/v1/knowledge/search', req);
  }

  listTopics(): Promise<unknown> {
    return this.client.request('GET', '/v1/knowledge/topics');
  }

  getArticle(articleId: string): Promise<unknown> {
    return this.client.request('GET', `/v1/knowledge/articles/${seg(articleId)}`);
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
    return this.client.request('GET', `/v1/coach/athletes/${athleteUid}/report?${q}`, undefined, 'arrayBuffer');
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

  // --- Billing (read-only; the key must carry billing:read) ---

  /** The live seat picture. Pass `orgId` to read the coach's organization as payer. */
  async seatState(params?: { orgId?: string }): Promise<CoachSeatState> {
    const qs = params?.orgId ? `?org_id=${encodeURIComponent(params.orgId)}` : '';
    return this.client.request('GET', `/v1/coach/billing/seat-state${qs}`);
  }

  /** One page of the coach's financial ledger, newest first. Pass `next_cursor` back as `cursor`. */
  async ledger(params?: { view?: CoachLedgerView; limit?: number; cursor?: string }): Promise<CoachLedgerPage> {
    const q = new URLSearchParams();
    if (params?.view) q.set('view', params.view);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return this.client.request('GET', `/v1/coach/billing/ledger${qs ? '?' + qs : ''}`);
  }

  /** The coach's active tier subscriptions and access status. */
  async tierStatus(): Promise<CoachTierStatus> {
    return this.client.request('GET', '/v1/coach/billing/tier-status');
  }

  /** Stripe Connect account status plus this month's and lifetime totals. */
  async connectSummary(): Promise<CoachConnectSummary> {
    return this.client.request('GET', '/v1/coach/billing/connect/summary');
  }

  /** Earnings totals across settled charges plus the most recent per-charge breakdowns. */
  async connectEarnings(): Promise<CoachConnectEarnings> {
    return this.client.request('GET', '/v1/coach/billing/connect/earnings');
  }

  /** One page of Connect charges, newest first. Pass `next_cursor` back as `cursor`. */
  async connectTransactions(params?: { limit?: number; cursor?: string }): Promise<CoachConnectChargesPage> {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return this.client.request('GET', `/v1/coach/billing/connect/transactions${qs ? '?' + qs : ''}`);
  }

  /** Every billing arrangement the coach has configured, in any status. */
  async connectArrangements(): Promise<CoachConnectArrangements> {
    return this.client.request('GET', '/v1/coach/billing/connect/arrangements');
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
