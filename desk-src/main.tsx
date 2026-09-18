import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Plane, ShieldCheck } from "lucide-react";
import Workspace from "./Workspace";
import Login from "./Login";
import { resetAccountCache } from "./lib/api";
import {
  getMember,
  rpc,
  sb,
  WorkspaceError,
  type SelfServiceMember,
} from "./lib/client";
import "./styles.css";
import "./access.css";
const initialUrl = new URL(window.location.href);
const callbackParams = new URLSearchParams(initialUrl.hash.slice(1));
const invalidCallback =
  callbackParams.has("error") ||
  callbackParams.has("error_description") ||
  initialUrl.searchParams.has("error");
const recoveryRequested =
  !invalidCallback &&
  (initialUrl.searchParams.has("recovery") ||
    callbackParams.get("type") === "recovery");
function AccessCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="access-page">
      <a className="brand" href="index.html">
        <span className="brand-icon">
          <Plane size={23} />
        </span>
        apply<span>desk</span>.
      </a>
      <section className="access-card">
        <ShieldCheck size={34} />
        <p className="eyebrow">APPLYDESK SELF-SERVICE</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
function App() {
  const [member, setMember] = useState<SelfServiceMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code?: string } | null>(
    null,
  );
  const [recovery, setRecovery] = useState(recoveryRequested);
  const [resetRequested, setResetRequested] = useState(
    initialUrl.searchParams.get("mode") === "forgot",
  );
  const [name, setName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const generation = useRef(0),
    recoveryRef = useRef(recoveryRequested),
    userRef = useRef<string | null>(null),
    invalidCallbackRef = useRef(invalidCallback);
  async function load(showLoading = true) {
    const request = ++generation.current;
    if (showLoading) setLoading(true);
    try {
      let current = await getMember();
      if (
        current?.kind === "unregistered" &&
        !recoveryRef.current &&
        current.session.user.user_metadata?.product === "selfserve"
      ) {
        const fullName = String(
          current.session.user.user_metadata.full_name || "",
        ).trim();
        if (fullName.length >= 2 && fullName.length <= 120) {
          await rpc("fn_ss_enroll", { p_full_name: fullName });
          current = await getMember();
        }
      }
      if (request !== generation.current) return;
      userRef.current = current?.session.user.id || null;
      setMember(current);
      setName(current?.session.user.user_metadata?.full_name || "");
      setError(null);
    } catch (e: any) {
      if (request === generation.current) {
        setMember(null);
        setError({
          message: e.message,
          code: e instanceof WorkspaceError ? e.code : undefined,
        });
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  async function signOut() {
    invalidCallbackRef.current = false;
    recoveryRef.current = false;
    setRecovery(false);
    window.history.replaceState({}, "", "/copilot.html");
    const { error } = await sb.auth.signOut({ scope: "local" });
    if (error) setError({ message: error.message });
    else {
      setMember(null);
      setError(null);
    }
  }
  useEffect(() => {
    if (invalidCallback) {
      setError({
        message:
          "This sign-in link has expired or is no longer valid. Request a new email to continue.",
        code: "AUTH_LINK_INVALID",
      });
      setLoading(false);
    } else if (resetRequested) setLoading(false);
    else void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (invalidCallbackRef.current && event !== "SIGNED_OUT") return;
      if (event === "PASSWORD_RECOVERY") {
        recoveryRef.current = true;
        setRecovery(true);
        setLoading(false);
      } else if (event === "SIGNED_OUT") {
        ++generation.current;
        userRef.current = null;
        resetAccountCache();
        setMember(null);
        setError(null);
        setLoading(false);
      } else if (event === "SIGNED_IN") {
        // Auth calls must run outside this callback to avoid the auth lock.
        const sameUser = !!session && session.user.id === userRef.current;
        // The SDK also emits SIGNED_IN when a tab regains focus. Keep drafts.
        if (sameUser) return;
        resetAccountCache();
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 0);
      }
    });
    return () => {
      clearTimeout(timer);
      data.subscription.unsubscribe();
      ++generation.current;
    };
  }, []);
  const afterLogin = () => {
    recoveryRef.current = false;
    setRecovery(false);
    setResetRequested(false);
    invalidCallbackRef.current = false;
    void load();
  };
  if (recovery) return <Login onLogin={afterLogin} recovery />;
  if (resetRequested)
    return <Login onLogin={afterLogin} initialMode="forgot" />;
  if (loading)
    return (
      <div className="boot-loading" role="status">
        <LoaderCircle className="spin" />
        <span>Opening ApplyDesk Self-service…</span>
      </div>
    );
  if (error)
    return (
      <AccessCard
        title={
          error.code === "SETUP_REQUIRED"
            ? "Self-service setup is pending"
            : error.code === "AUTH_LINK_INVALID"
              ? "This sign-in link can’t be used"
              : "We couldn’t open your workspace"
        }
      >
        <p role="alert">{error.message}</p>
        {error.code === "SETUP_REQUIRED" && import.meta.env.DEV && (
          <div className="access-setup">
            <strong>Local setup</strong>
            <p>
              Apply the supplied Supabase self-service migration (patch 10)
              after its prerequisites, then retry. See DEPLOYMENT.md in the
              upgraded project. No client data needs to be copied.
            </p>
          </div>
        )}
        <div className="button-row">
          {error.code === "AUTH_LINK_INVALID" ? (
            <a className="button primary" href="copilot.html?mode=forgot">
              Request a new reset link
            </a>
          ) : (
            <button className="button primary" onClick={() => void load()}>
              Try again
            </button>
          )}
          <button className="button secondary" onClick={() => void signOut()}>
            Back to sign in
          </button>
        </div>
        <a className="text-link" href="index.html">
          Back to ApplyDesk
        </a>
      </AccessCard>
    );
  if (!member)
    return (
      <Login
        onLogin={afterLogin}
        initialMode={
          initialUrl.searchParams.get("mode") === "signup" ? "signup" : "login"
        }
      />
    );
  if (member.kind === "admin" || member.kind === "legacy")
    return (
      <AccessCard
        title={
          member.kind === "admin"
            ? "Manage self-service from your admin portal"
            : "Your recruiter-managed portal is separate"
        }
      >
        <p>
          {member.kind === "admin"
            ? "Use your existing administrator account in the management portal to view and manage self-service members."
            : "This account belongs to the recruiter-managed ApplyDesk service. Your applications and recruiter conversations remain in Mission Control. Self-service uses a separate account and workspace."}
        </p>
        <a
          className="button primary"
          href={
            member.kind === "admin" ? "copilot-admin.html" : "portal-v2.html"
          }
        >
          {member.kind === "admin"
            ? "Open self-service management"
            : "Open Mission Control"}
        </a>
        <button className="text-link" onClick={() => void signOut()}>
          Use a different self-service account
        </button>
      </AccessCard>
    );
  if (member.kind === "unregistered")
    return (
      <AccessCard title="Create your self-service workspace">
        <p>
          You’re signed in as {member.session.user.email}. This workspace is for
          applying on your own. It does not add you to the recruiter-managed
          client service.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setEnrolling(true);
            try {
              await rpc("fn_ss_enroll", { p_full_name: name.trim() });
              await load();
            } catch (e: any) {
              setError({ message: e.message, code: e.code });
            } finally {
              setEnrolling(false);
            }
          }}
        >
          <label>
            Full name
            <input
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="button primary" disabled={enrolling}>
            {enrolling
              ? "Creating workspace…"
              : "Create self-service workspace"}
          </button>
        </form>
        <button className="text-link" onClick={() => void signOut()}>
          Sign out
        </button>
      </AccessCard>
    );
  if (member.profile?.status !== "active")
    return (
      <AccessCard title="Your self-service access is paused">
        <p>
          Your account is currently suspended. Contact ApplyDesk support to
          review your access. Your saved data remains retained.
        </p>
        <button className="button secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </AccessCard>
    );
  return <Workspace />;
}
createRoot(document.getElementById("root")!).render(<App />);
