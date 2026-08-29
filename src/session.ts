import {
  type LoginContext,
  completeOtpFlow,
  getBffToken,
  getCustomerProfile,
  getStoreIds,
  startOtpFlow,
  verifyUser,
} from "./api";
import { currentTenant } from "./context";
import { HttpError } from "./http";
import type { AuthState } from "./storage";

export const toLoginContext = (auth: AuthState): LoginContext => {
  if (
    !auth.customerId ||
    !auth.userId ||
    !auth.email ||
    !auth.userAccessToken ||
    !auth.storeIds
  ) {
    throw new Error("Auth context is incomplete. Run login first.");
  }

  return {
    phoneE164: auth.phoneE164,
    customerId: auth.customerId,
    userId: auth.userId,
    email: auth.email,
    accessToken: auth.userAccessToken,
    refreshToken: auth.refreshToken,
    storeIds: auth.storeIds,
  };
};

export const toAuthState = (
  context: LoginContext,
  bffToken: string,
  otpReference: string,
): AuthState => {
  return {
    phoneE164: context.phoneE164,
    bffToken,
    userAccessToken: context.accessToken,
    refreshToken: context.refreshToken,
    otpReference,
    customerId: context.customerId,
    userId: context.userId,
    email: context.email,
    storeIds: context.storeIds,
    savedAt: new Date().toISOString(),
  };
};

export const savePendingAuth = async (
  phoneE164: string,
  bffToken: string,
  customerId: string,
  reference: string,
): Promise<AuthState> => {
  const { store } = currentTenant();
  return store.lock("auth", async () => {
    const existing = await store.readAuth();
    const next: AuthState = {
      ...(existing ?? { phoneE164, savedAt: new Date().toISOString() }),
      phoneE164,
      bffToken,
      customerId,
      otpReference: reference,
      savedAt: new Date().toISOString(),
    };
    await store.writeAuth(next);
    return next;
  });
};

export const requestOtpForPhone = async (
  phoneRaw: string,
): Promise<{ phoneE164: string; reference: string }> => {
  const started = await startOtpFlow(phoneRaw);
  await savePendingAuth(
    started.phoneE164,
    started.bffToken,
    started.customerId,
    started.reference,
  );
  return { phoneE164: started.phoneE164, reference: started.reference };
};

export const completeOtpForPhone = async (
  phone: string,
  otpCode: string,
  reference?: string,
): Promise<AuthState> => {
  const { store } = currentTenant();
  return store.lock("auth", async () => {
    const existing = await store.readAuth();

    const phoneFromState = existing?.phoneE164;
    const bffToken = existing?.bffToken;
    const customerId = existing?.customerId;
    const otpReference = reference ?? existing?.otpReference;

    if (!phoneFromState || !bffToken || !customerId || !otpReference) {
      throw new Error(
        "Missing pending auth context. Run request-otp first (or pass --reference).",
      );
    }

    const login = await completeOtpFlow(
      phone,
      customerId,
      bffToken,
      otpReference,
      otpCode,
    );

    const state = toAuthState(login, bffToken, otpReference);
    await store.writeAuth(state);
    return state;
  });
};

const REAUTH_MESSAGE =
  "Access token expired or invalid. Re-authenticate with 'checkers-sixty60 login' (or request_otp/verify_otp).";

// Checkers rejects an expired/invalid access token with 401 or 403; there is
// no refresh-token exchange implemented upstream, so the only recovery path
// is running the OTP flow again. This turns that opaque HTTP failure into an
// actionable message for both the CLI and MCP callers.
export const withReauthHint = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw new Error(REAUTH_MESSAGE);
    }
    throw error;
  }
};

// Fills in any missing derived context (bff token, customer id, profile, store
// ids) and persists the result. Callers hold the tenant lock (see requireAuth).
export const hydrateAuth = async (auth: AuthState): Promise<AuthState> => {
  const { store } = currentTenant();
  const next = { ...auth };

  if (!next.bffToken) {
    next.bffToken = await getBffToken();
  }

  if (!next.customerId) {
    next.customerId = await verifyUser(next.phoneE164, next.bffToken);
  }

  if (!next.userAccessToken) {
    throw new Error("Missing user access token. Run login first.");
  }

  const accessToken = next.userAccessToken;
  const customerId = next.customerId;

  if (!next.userId || !next.email) {
    const profile = await withReauthHint(() =>
      getCustomerProfile(customerId, accessToken, next.phoneE164),
    );
    next.userId = profile.userId;
    next.email = profile.email;
  }

  if (!next.storeIds || next.storeIds.length === 0) {
    const userId = next.userId;
    const email = next.email;
    next.storeIds = await withReauthHint(() =>
      getStoreIds(accessToken, next.phoneE164, userId, customerId, email),
    );
  }

  next.savedAt = new Date().toISOString();
  await store.writeAuth(next);
  return next;
};

export const requireAuth = async (): Promise<AuthState> => {
  const { store } = currentTenant();
  return store.lock("auth", async () => {
    const auth = await store.readAuth();
    if (!auth) {
      throw new Error("No local auth found. Run login first.");
    }
    return hydrateAuth(auth);
  });
};
