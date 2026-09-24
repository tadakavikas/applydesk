import { createClient } from "@supabase/supabase-js";

// Staff sessions stay separate from the self-service product's browser session.
// This is ApplyDesk's public browser key. Access is enforced by SQL and RLS.
export const adminSb = createClient(
  "https://rofyegirmgqjhekuxjat.supabase.co",
  "sb_publishable_4f6WR1sk2N9EUO2bU7dkyA_9TByUhTL",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "ad-auth",
    },
  },
);
export async function adminRpc(
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await adminSb.rpc(name, args);
  if (error) {
    throw new Error(
      error.code === "PGRST202" || error.code === "42P01"
        ? "Self-service administration has not been set up in Supabase yet. Apply the self-service migration in the deployment guide, then retry."
        : error.message || "The request could not be completed.",
    );
  }
  if (data?.ok === false) {
    throw new Error(data.error || data.err || data.message || "Access denied.");
  }
  return data;
}
export async function getAdminIdentity() {
  const { data, error } = await adminSb.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  const identity = await adminRpc("fn_ss_identity");
  return { ...identity, sessionUserId: data.session.user.id };
}
export async function originalResumeUrl(path: string) {
  const { data, error } = await adminSb.storage
    .from("selfserve-resumes")
    .createSignedUrl(path, 60, { download: true });
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("The original file is unavailable.");
  return data.signedUrl;
}
