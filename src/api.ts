import {
  SIXTY60_API_KEY,
  SIXTY60_API_KEY_AUTH,
  SIXTY60_PROFILE_TOKEN,
} from "./config";
import { HttpError, http } from "./http";
import { log } from "./logger";
import { getOrCreateDeviceId, readSelectedAddressId } from "./tenant-state";

const BFF_BASE = "https://dc-app-backend-for-frontend.sixty60.co.za";
const DSL_BASE =
  "https://api.shopritegroup.co.za/dsl/brands/checkers/countries/ZA";
const AUTH_BASE = "https://auth.sixty60.co.za";
const CATALOG_BASE = "https://catalog.sixty60.co.za";
const ORDERS_BASE = "https://orders-api.sixty60.co.za";

// The Checkers Sixty60 app API credentials are not bundled. They are read from
// the environment (SIXTY60_API_KEY / SIXTY60_API_KEY_AUTH /
// SIXTY60_PROFILE_TOKEN via config.ts) and only the login/OTP/profile calls
// need them — `required` turns a missing value into an actionable error.
const required = (value: string | null, name: string): string => {
  if (!value) {
    throw new Error(
      `${name} is not set. The Checkers Sixty60 app API credentials are not bundled — provide them via environment or a local .env file (see .env.example and the README 'Configuration' section).`,
    );
  }
  return value;
};

const APP_VERSION = "iPadOS 2.0.99 (1769786479)";
const APP_BUILD = "1769786479";

// Everything that needs a delivery lat/lng resolves it from the addresses saved
// on the Checkers account (see `resolveDeliveryAddress`). `fetchAddresses` only
// needs the identity headers, not a resolved store context, so this narrower
// shape lets the login/hydrate path call it before store ids exist.
export type DeliveryContext = Pick<
  LoginContext,
  "phoneE164" | "customerId" | "userId" | "email" | "accessToken"
> & { storeIds?: string[] };

const getLocation = async (
  ctx: DeliveryContext,
): Promise<{ latitude: number; longitude: number }> => {
  const address = await resolveDeliveryAddress(ctx);
  return { latitude: address.latitude, longitude: address.longitude };
};

type BffTokenResponse = {
  access_token: string;
};

type VerifyUserResponse = {
  response?: {
    uid?: string;
  };
};

type OtpRequestResponse = {
  response?: {
    reference?: string;
    expiry?: unknown;
    expiresIn?: unknown;
    // If the request ever echoes the canonicalised number back, prefer it
    // verbatim on verify. In practice the observed response is just
    // `{ reference, expiry }`, so this is usually absent and `verifyOtp` falls
    // back to trying each number format (see `otpIdentifierCandidates`).
    identifier?: string;
    mobileNumber?: string;
    msisdn?: string;
    to?: string;
    target?: { identifier?: string };
  };
};

// The identifier the OTP request echoed back, if any. Returns undefined when
// nothing usable is present so `verifyOtp` knows to try the format candidates.
const pickOtpIdentifier = (
  response: OtpRequestResponse["response"],
): string | undefined => {
  const echoed =
    response?.identifier ??
    response?.target?.identifier ??
    response?.mobileNumber ??
    response?.msisdn ??
    response?.to;
  return typeof echoed === "string" && echoed.trim() ? echoed.trim() : undefined;
};

// Benign response fields that don't warrant the "unexpected extra field" hint.
const KNOWN_OTP_REQUEST_FIELDS = new Set([
  "reference",
  "expiry",
  "expiresIn",
  "ttl",
]);

type OtpVerifyResponse = {
  response?: {
    accessToken?: string;
    refreshToken?: string;
  };
};

type CustomerProfileResponse = {
  userProfile?: {
    id?: string;
    identifier?: string;
    email?: string;
  };
};

type StoreContextsResponse = {
  items?: Array<{
    storeId?: string;
  }>;
};

type CartsResponse = {
  carts?: Array<{
    item?: {
      id?: string;
      serviceOptionId?: string;
      deliveryAddress?: {
        identifier?: string;
      };
      lineItems?: Array<{
        id?: string;
        productId?: string;
        status?: string;
        price?: number;
        priceFactor?: number;
        previousPrice?: number;
        instruction?: string;
        quantity?: number;
        specialInstruction?: string;
        specialInstructions?: string;
        storeId?: string;
        replacementPreferenceId?: string;
        optionSelections?: unknown[];
        selectedWeightRange?: unknown;
        missionName?: string;
        missionType?: string;
        addToBasketType?: string;
        addToBasketJourney?: string;
        serviceOptionId?: string;
        isStockAvailable?: boolean;
        ranged?: boolean;
        requiresOver18?: boolean;
        isSponsoredProduct?: boolean;
        hasAlcohol?: boolean;
        product?: {
          id?: string;
        } | null;
      }>;
      [key: string]: unknown;
    };
  }>;
};

export type LoginContext = {
  phoneE164: string;
  customerId: string;
  userId: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  storeIds: string[];
};

// Canonical 11-digit SA mobile number, `27XXXXXXXXX` (no `+`). Every request
// shape is derived from this.
const phoneDigits = (value: string): string => {
  const digits = value.replace(/\D+/g, "");
  if (digits.startsWith("27") && digits.length === 11) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `27${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `27${digits}`;
  }

  throw new Error(
    "Invalid phone number. Use South African format like 0821234567 or +27821234567.",
  );
};

// E.164, `+27XXXXXXXXX` — what the OTP request query and every `mobileNumber`
// header use.
const normalizePhone = (value: string): string => `+${phoneDigits(value)}`;

// National, `0XXXXXXXXX`.
const toNationalPhone = (value: string): string =>
  `0${phoneDigits(value).slice(2)}`;

// Distinct identifier strings to try in the OTP verify `target.identifier`,
// most-likely first. The verify endpoint keys on the exact string the pending
// challenge was stored under, which is not necessarily the E.164 form.
const otpIdentifierCandidates = (phoneE164: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [
    phoneE164, // +27XXXXXXXXX
    phoneDigits(phoneE164), // 27XXXXXXXXX
    toNationalPhone(phoneE164), // 0XXXXXXXXX
  ]) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
};

const baseHeaders = async (
  token: string,
  phoneE164: string,
  storeIds: string[],
  userId?: string,
  customerId?: string,
  email?: string,
): Promise<Record<string, string>> => {
  const deviceId = await getOrCreateDeviceId();
  const storeIdsJson = JSON.stringify(storeIds);
  const storeIdsCsv = storeIds.join(",");

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    mobileNumber: phoneE164,
    "device-id": deviceId,
    channel: "super-app",
    "app-version": APP_VERSION,
    "channel-os": APP_VERSION,
    appversion: APP_BUILD,
    "istio-appVersion": APP_BUILD,
    storeids: storeIdsJson,
    "istio-storeIds": storeIdsJson,
    "aws-cf-cd-storeid": storeIdsCsv,
  };

  if (userId) {
    headers.UserId = userId;
  }

  if (customerId) {
    headers["customer-id"] = customerId;
  }

  if (email) {
    headers.email = email;
  }

  return headers;
};

const buildStoreContexts = (storeIds: string[]) => {
  return storeIds.map((storeId) => ({
    storeId,
    serviceOptionIds: ["sixty-min-delivery"],
    brandPriority: 1,
    hasCapacity: ["sixty-min-delivery"],
  }));
};

const toCartUpdateLineItem = (
  line: Record<string, unknown>,
): Record<string, unknown> => {
  const productId =
    (line.productId as string | undefined) ??
    ((line.product as { id?: string } | null | undefined)?.id as
      | string
      | undefined);

  return {
    id: (line.id as string | undefined) ?? "",
    productId: productId ?? "",
    storeId: (line.storeId as string | undefined) ?? "",
    price: (line.price as number | undefined) ?? 0,
    previousPrice: (line.previousPrice as number | undefined) ?? 0,
    priceFactor: (line.priceFactor as number | undefined) ?? 100,
    quantity: (line.quantity as number | undefined) ?? 1,
    instruction: (line.instruction as string | undefined) ?? "",
    specialInstruction:
      (line.specialInstruction as string | undefined) ??
      (line.specialInstructions as string | undefined) ??
      "",
    replacementPreferenceId:
      (line.replacementPreferenceId as string | undefined) ?? "",
    missionName: (line.missionName as string | undefined) ?? "",
    missionType: (line.missionType as string | undefined) ?? "",
    addToBasketType:
      (line.addToBasketType as string | undefined) ?? "quick_add",
    addToBasketJourney:
      (line.addToBasketJourney as string | undefined) ?? "main_search_results",
    isStockAvailable: (line.isStockAvailable as boolean | undefined) ?? true,
    status: (line.status as string | undefined) ?? "available",
    isSponsoredProduct:
      (line.isSponsoredProduct as boolean | undefined) ?? false,
    serviceOptionId:
      (line.serviceOptionId as string | undefined) ?? "sixty-min-delivery",
    hasAlcohol: (line.hasAlcohol as boolean | undefined) ?? false,
    requiresOver18: (line.requiresOver18 as boolean | undefined) ?? false,
    product: null,
  };
};

export const getBffToken = async (): Promise<string> => {
  const data = await http<BffTokenResponse>(`${BFF_BASE}/api/v1/token/dsl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!data.access_token) {
    throw new Error("No access_token from BFF /token/dsl");
  }

  return data.access_token;
};

export const verifyUser = async (
  phoneE164: string,
  bffToken: string,
): Promise<string> => {
  const data = await http<VerifyUserResponse>(`${DSL_BASE}/users/verify`, {
    method: "GET",
    headers: {
      ...(await baseHeaders(bffToken, phoneE164, [])),
      "x-api-key": required(SIXTY60_API_KEY, "SIXTY60_API_KEY"),
    },
  });

  const customerId = data.response?.uid;
  if (!customerId) {
    throw new Error(
      `No uid returned from /users/verify: ${JSON.stringify(data)}`,
    );
  }

  return customerId;
};

export const requestOtp = async (
  phoneRaw: string,
  bffToken: string,
  customerId: string,
): Promise<{
  phoneE164: string;
  reference: string;
  otpIdentifier?: string;
}> => {
  const phoneE164 = normalizePhone(phoneRaw);

  const data = await http<OtpRequestResponse>(
    `${DSL_BASE}/users/loginbymobile`,
    {
      method: "GET",
      query: {
        mobileNumber: phoneE164,
      },
      headers: {
        ...(await baseHeaders(bffToken, phoneE164, [], undefined, customerId)),
        "x-api-key": required(SIXTY60_API_KEY_AUTH, "SIXTY60_API_KEY_AUTH"),
      },
    },
  );

  const reference = data.response?.reference;
  if (!reference) {
    throw new Error(`No OTP reference returned: ${JSON.stringify(data)}`);
  }

  const otpIdentifier = pickOtpIdentifier(data.response);
  if (!otpIdentifier) {
    const unexpected = Object.keys(data.response ?? {}).filter(
      (key) => !KNOWN_OTP_REQUEST_FIELDS.has(key),
    );
    if (unexpected.length > 0) {
      // A new field here might be the identifier verify wants — surface it.
      log(
        `otp request response carried unrecognised field(s) [${unexpected.join(", ")}]`,
      );
    }
  }

  return { phoneE164, reference, otpIdentifier };
};

const OTP_ATTEMPT_RE = /\botp\b|expired|attempts?\b/i;

const verifyOtpWithIdentifier = (
  identifier: string,
  reference: string,
  otp: string,
  bffToken: string,
  phoneE164: string,
  customerId: string,
): Promise<OtpVerifyResponse> =>
  baseHeaders(bffToken, phoneE164, [], undefined, customerId).then((headers) =>
    http<OtpVerifyResponse>(`${DSL_BASE}/otp/loginbymobile/verify`, {
      method: "POST",
      headers: {
        ...headers,
        "x-api-key": required(SIXTY60_API_KEY_AUTH, "SIXTY60_API_KEY_AUTH"),
      },
      body: {
        target: { type: "SMS", identifier, reference },
        otp,
      },
    }),
  );

export const verifyOtp = async (
  phoneE164: string,
  reference: string,
  otp: string,
  bffToken: string,
  customerId: string,
  // The exact string the pending OTP challenge is stored under. When the
  // request echoed one back (rare), pass it and only it is tried. Otherwise the
  // verify endpoint is retried against each SA number format, since it keys on
  // that string and it is not necessarily the E.164 form we sent.
  identifier?: string,
): Promise<{ accessToken: string; refreshToken?: string }> => {
  const candidates = identifier
    ? [identifier]
    : otpIdentifierCandidates(phoneE164);
  const attempts: string[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      const data = await verifyOtpWithIdentifier(
        candidate,
        reference,
        otp,
        bffToken,
        phoneE164,
        customerId,
      );
      const accessToken = data.response?.accessToken;
      if (!accessToken) {
        throw new Error(
          `No accessToken from OTP verify: ${JSON.stringify(data)}`,
        );
      }
      if (i > 0) {
        // E.164 is the expected format; note it if a fallback was needed.
        log(
          `otp verify succeeded with identifier ${JSON.stringify(candidate)} after ${i} rejected format(s)`,
        );
      }
      return { accessToken, refreshToken: data.response?.refreshToken };
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      attempts.push(`${candidate} → HTTP ${error.status}: ${error.body}`);

      // If the server got far enough to complain about the OTP itself (wrong /
      // expired code, attempts exhausted), the identifier format was accepted —
      // trying other formats would only burn attempts. Stop and report.
      if (isLast || OTP_ATTEMPT_RE.test(error.body)) {
        throw new Error(
          `OTP verify failed for reference ${JSON.stringify(reference)}:\n${attempts.join("\n")}`,
        );
      }
    }
  }

  // Unreachable: the loop returns or throws on the last candidate.
  throw new Error("OTP verify: no identifier candidates to try");
};

export const getCustomerProfile = async (
  customerId: string,
  accessToken: string,
  phoneE164: string,
): Promise<{ userId: string; email: string }> => {
  const data = await http<CustomerProfileResponse>(
    `${AUTH_BASE}/customers/${customerId}/customer-profile/v2/${accessToken}`,
    {
      method: "GET",
      headers: {
        ...(await baseHeaders(accessToken, phoneE164, [])),
        Authorization: `Bearer ${required(SIXTY60_PROFILE_TOKEN, "SIXTY60_PROFILE_TOKEN")}`,
      },
    },
  );

  const userId = data.userProfile?.id ?? data.userProfile?.identifier;
  const email = data.userProfile?.email;

  if (!userId || !email) {
    throw new Error(
      `Could not resolve user profile context: ${JSON.stringify(data)}`,
    );
  }

  return { userId, email };
};

export const getStoreIds = async (
  accessToken: string,
  phoneE164: string,
  userId: string,
  customerId: string,
  email: string,
): Promise<string[]> => {
  const location = await getLocation({
    accessToken,
    phoneE164,
    userId,
    customerId,
    email,
  });

  const data = await http<StoreContextsResponse>(
    `${CATALOG_BASE}/api/v3/store-contexts`,
    {
      method: "POST",
      headers: await baseHeaders(
        accessToken,
        phoneE164,
        [],
        userId,
        customerId,
        email,
      ),
      body: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    },
  );

  const storeIds = (data.items ?? [])
    .map((item) => item.storeId)
    .filter((value): value is string => Boolean(value));

  if (storeIds.length === 0) {
    throw new Error(`No store contexts returned: ${JSON.stringify(data)}`);
  }

  return storeIds;
};

export const loginFlow = async (
  phoneRaw: string,
  otp: string,
  otpReference: string,
  otpIdentifier?: string,
): Promise<LoginContext> => {
  const phoneE164 = normalizePhone(phoneRaw);
  const bffToken = await getBffToken();
  const customerId = await verifyUser(phoneE164, bffToken);
  const otpResult = await verifyOtp(
    phoneE164,
    otpReference,
    otp,
    bffToken,
    customerId,
    otpIdentifier,
  );
  const profile = await getCustomerProfile(
    customerId,
    otpResult.accessToken,
    phoneE164,
  );
  const storeIds = await getStoreIds(
    otpResult.accessToken,
    phoneE164,
    profile.userId,
    customerId,
    profile.email,
  );

  return {
    phoneE164,
    customerId,
    userId: profile.userId,
    email: profile.email,
    accessToken: otpResult.accessToken,
    refreshToken: otpResult.refreshToken,
    storeIds,
  };
};

export const startOtpFlow = async (
  phoneRaw: string,
): Promise<{
  phoneE164: string;
  customerId: string;
  bffToken: string;
  reference: string;
  otpIdentifier?: string;
}> => {
  const phoneE164 = normalizePhone(phoneRaw);
  const bffToken = await getBffToken();
  const customerId = await verifyUser(phoneE164, bffToken);
  const otpRequest = await requestOtp(phoneE164, bffToken, customerId);

  return {
    phoneE164,
    customerId,
    bffToken,
    reference: otpRequest.reference,
    otpIdentifier: otpRequest.otpIdentifier,
  };
};

export const completeOtpFlow = async (
  phoneE164: string,
  customerId: string,
  bffToken: string,
  otpReference: string,
  otp: string,
  otpIdentifier?: string,
): Promise<LoginContext> => {
  const otpResult = await verifyOtp(
    phoneE164,
    otpReference,
    otp,
    bffToken,
    customerId,
    otpIdentifier,
  );
  const profile = await getCustomerProfile(
    customerId,
    otpResult.accessToken,
    phoneE164,
  );
  const storeIds = await getStoreIds(
    otpResult.accessToken,
    phoneE164,
    profile.userId,
    customerId,
    profile.email,
  );

  return {
    phoneE164,
    customerId,
    userId: profile.userId,
    email: profile.email,
    accessToken: otpResult.accessToken,
    refreshToken: otpResult.refreshToken,
    storeIds,
  };
};

// A saved delivery address on the Checkers account, as returned by
// GET /customers/{userId}/addresses. Only the fields this CLI reads are named;
// the upstream payload carries more (deliveryInstructions, googleMapsPlaceId,
// notifyWhenAddressServiced, ...) and has changed shape before, so the extra
// coordinate fallbacks in `normalizeAddress` are deliberate.
export type CheckersAddress = {
  _id?: string;
  identifier?: string;
  name?: string;
  type?: string;
  fullAddress?: string;
  complexName?: string;
  unitNumber?: string;
  streetNumber?: string;
  street?: string;
  suburb?: string;
  city?: string;
  postalCode?: string;
  coordinates?: { latitude?: number; longitude?: number };
  geoLocation?: { latitude?: number; longitude?: number };
  latitude?: number;
  longitude?: number;
  active?: boolean;
  lastUsedOn?: number;
  [key: string]: unknown;
};

type CustomerAddressesResponse = {
  items?: CheckersAddress[];
  success?: boolean;
};

export type NormalizedAddress = {
  id: string;
  label?: string;
  type?: string;
  fullAddress?: string;
  suburb?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  active: boolean;
  lastUsedOn?: number;
};

const pickCoord = (
  ...candidates: Array<number | undefined>
): number | undefined => {
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
};

export const normalizeAddress = (raw: CheckersAddress): NormalizedAddress => ({
  id: raw.identifier ?? raw._id ?? "",
  label: raw.name,
  type: raw.type,
  fullAddress: raw.fullAddress,
  suburb: raw.suburb,
  city: raw.city,
  latitude: pickCoord(
    raw.coordinates?.latitude,
    raw.geoLocation?.latitude,
    raw.latitude,
  ),
  longitude: pickCoord(
    raw.coordinates?.longitude,
    raw.geoLocation?.longitude,
    raw.longitude,
  ),
  active: raw.active !== false,
  lastUsedOn: typeof raw.lastUsedOn === "number" ? raw.lastUsedOn : undefined,
});

// Read-only: list the delivery addresses already saved on the Checkers account.
// The path takes the mongo profile id (context.userId), NOT the short
// customer-id, and authenticates with the ordinary user access token.
// Creating / editing addresses is intentionally left to the official app.
export const fetchAddresses = async (
  context: DeliveryContext,
): Promise<CheckersAddress[]> => {
  const data = await http<CustomerAddressesResponse>(
    `${AUTH_BASE}/customers/${context.userId}/addresses`,
    {
      method: "GET",
      headers: await baseHeaders(
        context.accessToken,
        context.phoneE164,
        context.storeIds ?? [],
        context.userId,
        context.customerId,
        context.email,
      ),
    },
  );

  return data.items ?? [];
};

export type ResolvedDeliveryAddress = NormalizedAddress & {
  latitude: number;
  longitude: number;
  selection: "pinned" | "last-used";
};

// The single source of delivery coordinates: whichever saved Checkers address
// is pinned (settings.json), else the account's most-recently-used one. Throws
// an actionable error if the account has no usable address — there is no
// coordinate fallback by design.
export const resolveDeliveryAddress = async (
  context: DeliveryContext,
): Promise<ResolvedDeliveryAddress> => {
  const pinnedId = await readSelectedAddressId();
  const usable = (await fetchAddresses(context))
    .map(normalizeAddress)
    .filter(
      (a): a is NormalizedAddress & { latitude: number; longitude: number } =>
        a.latitude !== undefined && a.longitude !== undefined,
    );

  if (usable.length === 0) {
    throw new Error(
      "No delivery address with coordinates is saved on this Checkers account. Add one in the Sixty60 app, then retry.",
    );
  }

  if (pinnedId) {
    const chosen = usable.find((a) => a.id === pinnedId);
    if (!chosen) {
      throw new Error(
        `Pinned delivery address ${JSON.stringify(pinnedId)} is no longer on the Checkers account. Run 'checkers-sixty60 addresses' to list current ones, then 'checkers-sixty60 set-location --address-id <id>' or '--last-used'.`,
      );
    }
    return { ...chosen, selection: "pinned" };
  }

  const mostRecent = [...usable].sort(
    (a, b) => (b.lastUsedOn ?? 0) - (a.lastUsedOn ?? 0),
  )[0];
  return { ...mostRecent, selection: "last-used" };
};

export const fetchOrders = async (context: LoginContext): Promise<unknown> => {
  return http(`${ORDERS_BASE}/api/v2/orders/history`, {
    method: "GET",
    headers: await baseHeaders(
      context.accessToken,
      context.phoneE164,
      context.storeIds,
      context.userId,
      context.customerId,
      context.email,
    ),
  });
};

export const searchProducts = async (
  context: LoginContext,
  query: string,
  page = 0,
  pageSize = 20,
): Promise<unknown> => {
  const url = `${CATALOG_BASE}/api/v3/products/product-list-page`;
  const headers = await baseHeaders(
    context.accessToken,
    context.phoneE164,
    context.storeIds,
    context.userId,
    context.customerId,
    context.email,
  );

  const storeIdsCsv = context.storeIds.join(",");
  headers.storeids = storeIdsCsv;
  headers["istio-storeIds"] = storeIdsCsv;

  return http(url, {
    method: "POST",
    query: {
      isCarousel: true,
      includePromotions: true,
      promotionChannel: "sixty60",
      isXtraSavingsMember: true,
      particularMemberBonusBuyIds: "",
      t: Date.now(),
    },
    headers,
    body: {
      filter: {
        productListSource: {
          search: query,
        },
        paginationOptions: {
          page,
          pageSize,
        },
        filterOptions: {
          dealsOnly: false,
          brandOptions: [],
          departmentOptions: [],
          facetOptions: [],
          serviceOptions: [],
          filterIds: [],
        },
        showNotRangedProducts: false,
      },
      userContext: {
        storeContexts: buildStoreContexts(context.storeIds),
        userId: context.userId,
      },
    },
  });
};

export const addToBasket = async (
  context: LoginContext,
  productId: string,
  quantity = 1,
  cartId?: string,
): Promise<unknown> => {
  const location = await getLocation(context);

  const storeContextResponse = await http<StoreContextsResponse>(
    `${CATALOG_BASE}/api/v3/store-contexts`,
    {
      method: "POST",
      headers: await baseHeaders(
        context.accessToken,
        context.phoneE164,
        [],
        context.userId,
        context.customerId,
        context.email,
      ),
      body: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    },
  );

  const storeContexts = (storeContextResponse.items ?? []).filter(
    (item): item is { storeId: string; [key: string]: unknown } =>
      Boolean(item.storeId),
  );
  const updateStoreIds = storeContexts.map((item) => item.storeId);

  const cartsResponse = await http<CartsResponse>(
    `${ORDERS_BASE}/api/v2/carts/user?useProductMinInfoAnnotation=true`,
    {
      method: "POST",
      headers: {
        ...(await baseHeaders(
          context.accessToken,
          context.phoneE164,
          updateStoreIds,
          context.userId,
          context.customerId,
          context.email,
        )),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: {
        storeContexts,
        includeV2ReplacementOptions: true,
      },
    },
  );

  const carts = (cartsResponse.carts ?? []).filter((cart) =>
    Boolean(cart.item?.id),
  );
  const selected = cartId
    ? carts.find((cart) => cart.item?.id === cartId)
    : (carts.find(
        (cart) => cart.item?.serviceOptionId === "sixty-min-delivery",
      ) ?? carts[0]);

  if (!selected?.item?.id || !selected.item.serviceOptionId) {
    throw new Error("Could not locate a cart to update");
  }

  const productLookupHeaders = await baseHeaders(
    context.accessToken,
    context.phoneE164,
    updateStoreIds,
    context.userId,
    context.customerId,
    context.email,
  );
  const storeIdsCsv = updateStoreIds.join(",");
  productLookupHeaders.storeids = storeIdsCsv;
  productLookupHeaders["istio-storeIds"] = storeIdsCsv;

  const productLookup = await http<{
    products?: Array<{
      id?: string;
      storeId?: string;
      priceWithoutDecimal?: number;
      oldPrice?: number;
      priceFactor?: number;
      serviceOptionId?: string;
      isStockAvailable?: boolean;
      requiresOver18?: boolean;
      isSponsored?: boolean;
      hasAlcohol?: boolean;
    }>;
  }>(`${CATALOG_BASE}/api/v3/products/product-list-page`, {
    method: "POST",
    query: {
      isCarousel: true,
      includePromotions: true,
      promotionChannel: "sixty60",
      isXtraSavingsMember: true,
      particularMemberBonusBuyIds: "",
      t: Date.now(),
    },
    headers: productLookupHeaders,
    body: {
      filter: {
        productListSource: {
          productIds: [productId],
        },
        paginationOptions: {
          page: 0,
          pageSize: 20,
        },
        filterOptions: {
          dealsOnly: false,
          brandOptions: [],
          departmentOptions: [],
          facetOptions: [],
          serviceOptions: [],
          filterIds: [],
        },
        showNotRangedProducts: false,
      },
      userContext: {
        storeContexts,
        userId: context.userId,
      },
    },
  });

  const productData = productLookup.products?.find(
    (product) => product.id === productId,
  );
  if (!productData) {
    throw new Error(`Product ${productId} not found in current store context`);
  }

  const currentLineItems = [...(selected.item.lineItems ?? [])];
  const existingIndex = currentLineItems.findIndex(
    (line) => line.productId === productId || line.product?.id === productId,
  );

  const nextLineItems = [...currentLineItems];
  const defaultStoreId = productData.storeId ?? updateStoreIds[0] ?? "";
  if (existingIndex >= 0) {
    const existing = nextLineItems[existingIndex];
    nextLineItems[existingIndex] = {
      ...existing,
      quantity: (existing.quantity ?? 0) + quantity,
    };
  } else {
    nextLineItems.push({
      id: "",
      productId,
      price: productData.priceWithoutDecimal ?? 0,
      priceFactor: productData.priceFactor ?? 100,
      previousPrice:
        productData.oldPrice ?? productData.priceWithoutDecimal ?? 0,
      quantity,
      specialInstructions: "",
      storeId: defaultStoreId,
      replacementPreferenceId: "",
      optionSelections: [],
      selectedWeightRange: null,
      missionName: "",
      missionType: "",
      addToBasketType: "quick_add",
      addToBasketJourney: "main_search_results",
      serviceOptionId:
        productData.serviceOptionId ?? selected.item.serviceOptionId,
      isStockAvailable: productData.isStockAvailable ?? true,
      ranged: false,
      requiresOver18: productData.requiresOver18 ?? false,
      isSponsoredProduct: productData.isSponsored ?? false,
      hasAlcohol: productData.hasAlcohol ?? false,
    });
  }

  const normalizedTargetLineItems = nextLineItems.map((line) =>
    toCartUpdateLineItem(line as Record<string, unknown>),
  );

  const cartsForUpdate: Array<{
    id: string;
    serviceOptionId: string;
    lineItems: Array<Record<string, unknown>>;
  }> = [];

  for (const cart of carts) {
    const item = cart.item;
    if (!item?.id || !item.serviceOptionId) {
      continue;
    }

    if (item.id === selected.item?.id) {
      cartsForUpdate.push({
        id: item.id,
        serviceOptionId: item.serviceOptionId,
        lineItems: normalizedTargetLineItems,
      });
      continue;
    }

    cartsForUpdate.push({
      id: item.id,
      serviceOptionId: item.serviceOptionId,
      lineItems: (item.lineItems ?? []) as Array<Record<string, unknown>>,
    });
  }

  const deliveryAddressId =
    selected.item.deliveryAddress?.identifier ??
    carts
      .map((cart) => cart.item?.deliveryAddress?.identifier)
      .find((identifier): identifier is string => Boolean(identifier)) ??
    "";

  const updateHeaders = await baseHeaders(
    context.accessToken,
    context.phoneE164,
    updateStoreIds,
    context.userId,
    context.customerId,
    context.email,
  );
  updateHeaders.storeids = storeIdsCsv;
  updateHeaders["istio-storeIds"] = storeIdsCsv;
  updateHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
  updateHeaders["Content-Type"] = "application/x-www-form-urlencoded";

  const updated = await http(
    `${ORDERS_BASE}/api/v3/carts/update?useProductMinInfoAnnotation=true`,
    {
      method: "POST",
      headers: updateHeaders,
      body: {
        carts: cartsForUpdate,
        deliveryAddressId,
        storeContexts,
      },
    },
  );

  for (const cart of cartsForUpdate) {
    const promotionHeaders = await baseHeaders(
      context.accessToken,
      context.phoneE164,
      updateStoreIds,
      context.userId,
      context.customerId,
      context.email,
    );
    promotionHeaders.storeids = JSON.stringify(updateStoreIds);
    promotionHeaders["istio-storeIds"] = JSON.stringify(updateStoreIds);
    promotionHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
    promotionHeaders["Content-Type"] = "application/x-www-form-urlencoded";

    await http(
      `${ORDERS_BASE}/api/v1/carts/${cart.id}/update-promotions?include_v2_replacement_preferences=true&useProductMinInfoAnnotation=true`,
      {
        method: "POST",
        headers: promotionHeaders,
        body: {
          storeContexts,
        },
      },
    );
  }

  return updated;
};

export const removeFromBasket = async (
  context: LoginContext,
  productId: string,
  quantity?: number,
  cartId?: string,
): Promise<unknown> => {
  const location = await getLocation(context);

  const storeContextResponse = await http<StoreContextsResponse>(
    `${CATALOG_BASE}/api/v3/store-contexts`,
    {
      method: "POST",
      headers: await baseHeaders(
        context.accessToken,
        context.phoneE164,
        [],
        context.userId,
        context.customerId,
        context.email,
      ),
      body: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    },
  );

  const storeContexts = (storeContextResponse.items ?? []).filter(
    (item): item is { storeId: string; [key: string]: unknown } =>
      Boolean(item.storeId),
  );
  const updateStoreIds = storeContexts.map((item) => item.storeId);

  const cartsResponse = await http<CartsResponse>(
    `${ORDERS_BASE}/api/v2/carts/user?useProductMinInfoAnnotation=true`,
    {
      method: "POST",
      headers: {
        ...(await baseHeaders(
          context.accessToken,
          context.phoneE164,
          updateStoreIds,
          context.userId,
          context.customerId,
          context.email,
        )),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: {
        storeContexts,
        includeV2ReplacementOptions: true,
      },
    },
  );

  const carts = (cartsResponse.carts ?? []).filter((cart) =>
    Boolean(cart.item?.id),
  );
  const selected = cartId
    ? carts.find((cart) => cart.item?.id === cartId)
    : (carts.find(
        (cart) => cart.item?.serviceOptionId === "sixty-min-delivery",
      ) ?? carts[0]);

  if (!selected?.item?.id || !selected.item.serviceOptionId) {
    throw new Error("Could not locate a cart to update");
  }

  const currentLineItems = [...(selected.item.lineItems ?? [])];
  const existingIndex = currentLineItems.findIndex(
    (line) => line.productId === productId || line.product?.id === productId,
  );
  if (existingIndex < 0) {
    throw new Error(`Product ${productId} not found in cart`);
  }

  const nextLineItems = [...currentLineItems];
  const existing = nextLineItems[existingIndex];
  const existingQty = existing.quantity ?? 0;

  if (quantity === undefined) {
    nextLineItems[existingIndex] = {
      ...existing,
      quantity: 0,
      status: "removed",
    };
  } else {
    const nextQty = existingQty - quantity;
    if (nextQty > 0) {
      nextLineItems[existingIndex] = {
        ...existing,
        quantity: nextQty,
      };
    } else {
      nextLineItems[existingIndex] = {
        ...existing,
        quantity: 0,
        status: "removed",
      };
    }
  }

  const normalizedTargetLineItems = nextLineItems.map((line) =>
    toCartUpdateLineItem(line as Record<string, unknown>),
  );

  const cartsForUpdate: Array<{
    id: string;
    serviceOptionId: string;
    lineItems: Array<Record<string, unknown>>;
  }> = [];

  for (const cart of carts) {
    const item = cart.item;
    if (!item?.id || !item.serviceOptionId) {
      continue;
    }

    if (item.id === selected.item?.id) {
      cartsForUpdate.push({
        id: item.id,
        serviceOptionId: item.serviceOptionId,
        lineItems: normalizedTargetLineItems,
      });
      continue;
    }

    cartsForUpdate.push({
      id: item.id,
      serviceOptionId: item.serviceOptionId,
      lineItems: (item.lineItems ?? []) as Array<Record<string, unknown>>,
    });
  }

  const deliveryAddressId =
    selected.item.deliveryAddress?.identifier ??
    carts
      .map((cart) => cart.item?.deliveryAddress?.identifier)
      .find((identifier): identifier is string => Boolean(identifier)) ??
    "";

  const updateHeaders = await baseHeaders(
    context.accessToken,
    context.phoneE164,
    updateStoreIds,
    context.userId,
    context.customerId,
    context.email,
  );
  const storeIdsCsv = updateStoreIds.join(",");
  updateHeaders.storeids = storeIdsCsv;
  updateHeaders["istio-storeIds"] = storeIdsCsv;
  updateHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
  updateHeaders["Content-Type"] = "application/x-www-form-urlencoded";

  const updated = await http(
    `${ORDERS_BASE}/api/v3/carts/update?useProductMinInfoAnnotation=true`,
    {
      method: "POST",
      headers: updateHeaders,
      body: {
        carts: cartsForUpdate,
        deliveryAddressId,
        storeContexts,
      },
    },
  );

  for (const cart of cartsForUpdate) {
    const promotionHeaders = await baseHeaders(
      context.accessToken,
      context.phoneE164,
      updateStoreIds,
      context.userId,
      context.customerId,
      context.email,
    );
    promotionHeaders.storeids = JSON.stringify(updateStoreIds);
    promotionHeaders["istio-storeIds"] = JSON.stringify(updateStoreIds);
    promotionHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
    promotionHeaders["Content-Type"] = "application/x-www-form-urlencoded";

    await http(
      `${ORDERS_BASE}/api/v1/carts/${cart.id}/update-promotions?include_v2_replacement_preferences=true&useProductMinInfoAnnotation=true`,
      {
        method: "POST",
        headers: promotionHeaders,
        body: {
          storeContexts,
        },
      },
    );
  }

  return updated;
};

export const viewCart = async (context: LoginContext): Promise<unknown> => {
  const location = await getLocation(context);

  const storeContextResponse = await http<StoreContextsResponse>(
    `${CATALOG_BASE}/api/v3/store-contexts`,
    {
      method: "POST",
      headers: await baseHeaders(
        context.accessToken,
        context.phoneE164,
        [],
        context.userId,
        context.customerId,
        context.email,
      ),
      body: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    },
  );

  const storeContexts = (storeContextResponse.items ?? []).filter(
    (item): item is { storeId: string; [key: string]: unknown } =>
      Boolean(item.storeId),
  );
  const updateStoreIds = storeContexts.map((item) => item.storeId);

  return http(
    `${ORDERS_BASE}/api/v2/carts/user?useProductMinInfoAnnotation=true`,
    {
      method: "POST",
      headers: {
        ...(await baseHeaders(
          context.accessToken,
          context.phoneE164,
          updateStoreIds,
          context.userId,
          context.customerId,
          context.email,
        )),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: {
        storeContexts,
        includeV2ReplacementOptions: true,
      },
    },
  );
};
