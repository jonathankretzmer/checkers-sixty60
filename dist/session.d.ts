import { type LoginContext } from "./api";
import type { AuthState } from "./storage";
export declare const toLoginContext: (auth: AuthState) => LoginContext;
export declare const toAuthState: (context: LoginContext, bffToken: string, otpReference: string) => AuthState;
export declare const savePendingAuth: (phoneE164: string, bffToken: string, customerId: string, reference: string) => Promise<AuthState>;
export declare const requestOtpForPhone: (phoneRaw: string) => Promise<{
    phoneE164: string;
    reference: string;
}>;
export declare const completeOtpForPhone: (phone: string, otpCode: string, reference?: string) => Promise<AuthState>;
export declare const withReauthHint: <T>(fn: () => Promise<T>) => Promise<T>;
export declare const hydrateAuth: (auth: AuthState) => Promise<AuthState>;
export declare const requireAuth: () => Promise<AuthState>;
