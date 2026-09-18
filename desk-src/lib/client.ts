import { createClient, type Session } from "@supabase/supabase-js";
// Public browser key. Staff keep ad-auth; self-service sessions are independent.
export const sb = createClient(
  "https://rofyegirmgqjhekuxjat.supabase.co",
  "sb_publishable_4f6WR1sk2N9EUO2bU7dkyA_9TByUhTL",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "ad-selfserve-auth",
      detectSessionInUrl: true,
    },
  },
);
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    if (["PGRST202", "42P01", "42883"].includes(error.code))
      throw new WorkspaceError(
        "The self-service product has not been enabled yet. Your account cannot open a workspace until ApplyDesk completes setup.",
        "SETUP_REQUIRED",
      );
    throw new WorkspaceError(
      error.message || "Your request could not be completed. Try again.",
      error.code || "REQUEST_FAILED",
    );
  }
  if (data && data.ok === false)
    throw new WorkspaceError(
      data.error ||
        data.err ||
        data.message ||
        "The request could not be completed.",
      data.code || "ACCESS_DENIED",
    );
  return data;
}
export type SelfServiceMember = {
  session: Session;
  kind: "member" | "admin" | "legacy" | "unregistered";
  profile?: {
    user_id: string;
    full_name: string;
    email: string;
    status: "active" | "suspended";
  };
};
export async function getMember(): Promise<SelfServiceMember | null> {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  const identity = await rpc("fn_ss_identity");
  if (
    !identity?.ok ||
    !["member", "admin", "legacy", "unregistered"].includes(identity.kind)
  )
    throw new Error(
      "Your self-service account could not be verified. Please sign in again.",
    );
  return {
    session: data.session,
    kind: identity.kind,
    profile: identity.profile,
  };
}
export function validEmployerUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      (u.hostname === "job-boards.greenhouse.io" ||
        u.hostname === "boards.greenhouse.io" ||
        u.hostname === "jobs.ashbyhq.com" ||
        u.hostname === "jobs.lever.co")
      ? u.href
      : null;
  } catch {
    return null;
  }
}
