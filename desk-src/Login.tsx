import { useEffect, useState } from "react";
import {
  Plane,
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  ShieldCheck,
  FileText,
  BriefcaseBusiness,
  LoaderCircle,
  MailCheck,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import { sb } from "./lib/client";
import "./auth.css";

type AuthMode =
  "login" | "signup" | "forgot" | "check-email" | "reset-sent" | "recovery";

function authError(error: unknown): string {
  const item = error as { code?: string; message?: string; status?: number };
  const message = item?.message?.toLowerCase() || "";
  if (item?.code === "invalid_credentials" || message.includes("invalid login"))
    return "That email and password did not match. Try again or reset your password.";
  if (
    item?.code === "email_not_confirmed" ||
    message.includes("email not confirmed")
  )
    return "Confirm your email address using the link in your email, then sign in.";
  if (
    item?.status === 429 ||
    item?.code?.includes("rate_limit") ||
    message.includes("too many")
  )
    return "Please wait a little before trying again. Too many requests were made recently.";
  if (item?.code === "weak_password")
    return "Choose a stronger password with at least 10 characters and a mix of letters, numbers, and symbols.";
  if (item?.code === "same_password")
    return "Choose a new password that is different from your current password.";
  if (
    item?.code === "signup_disabled" ||
    message.includes("signups not allowed")
  )
    return "New account registration is not available yet. Please contact the ApplyDesk team.";
  if (
    item?.code === "user_already_exists" ||
    message.includes("already registered")
  )
    return "This email already has an account. Sign in or reset your password.";
  if (
    item?.code === "email_address_invalid" ||
    message.includes("invalid email")
  )
    return "Enter a valid email address and try again.";
  if (message.includes("fetch") || message.includes("network"))
    return "We could not connect. Check your internet connection and try again.";
  if (
    item?.code === "otp_expired" ||
    item?.code === "session_not_found" ||
    message.includes("session missing")
  )
    return "This link has expired or is no longer valid. Request a new password-reset email.";
  return "We could not complete that request. Please try again. If it continues, contact the ApplyDesk team.";
}

export default function Login({
  onLogin,
  initialMode = "login",
  recovery = false,
}: {
  onLogin: () => void;
  initialMode?: "login" | "signup" | "forgot";
  recovery?: boolean;
}) {
  const [mode, setMode] = useState<AuthMode>(
    recovery ? "recovery" : initialMode,
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (recovery) {
      setMode("recovery");
      setError("");
      setNotice("");
    }
  }, [recovery]);

  function changeMode(next: AuthMode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmation("");
    setShowPassword(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if ((mode === "signup" || mode === "recovery") && password.length < 10) {
      setError("Choose a password with at least 10 characters.");
      return;
    }
    if (
      (mode === "signup" || mode === "recovery") &&
      password !== confirmation
    ) {
      setError(
        "The passwords do not match. Enter the same password in both fields.",
      );
      return;
    }
    if (mode === "signup" && !fullName.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (mode === "signup" && fullName.trim().length < 2) {
      setError("Enter your full name (at least 2 characters).");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const result = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
        setPassword("");
        onLogin();
      } else if (mode === "signup") {
        const result = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { product: "selfserve", full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}/copilot.html`,
          },
        });
        if (result.error) throw result.error;
        setPassword("");
        setConfirmation("");
        if (result.data.session) onLogin();
        else setMode("check-email");
      } else if (mode === "forgot") {
        const result = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/copilot.html?recovery=1`,
        });
        if (result.error) throw result.error;
        setMode("reset-sent");
      } else if (mode === "recovery") {
        const result = await sb.auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword("");
        setConfirmation("");
        const url = new URL(window.location.href);
        url.searchParams.delete("recovery");
        window.history.replaceState(
          {},
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
        onLogin();
      }
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await sb.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/copilot.html` },
      });
      if (result.error) throw result.error;
      setNotice(
        "Confirmation requested. Check your inbox and spam folder for the latest link.",
      );
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  const signup = mode === "signup";
  const recoveryMode = mode === "recovery";
  const emailScreen = mode === "check-email" || mode === "reset-sent";
  const title = {
    login: "Welcome to your next chapter.",
    signup: "Your next move starts here.",
    forgot: "Let's get you back in.",
    "check-email": "Check your email.",
    "reset-sent": "Look for your reset link.",
    recovery: "Choose a new password.",
  }[mode];
  const intro = {
    login: "Sign in to your self-service job search workspace.",
    signup:
      "Create your own account to find roles, prepare your resume, and track your applications.",
    forgot: "Enter your account email to request a password-reset link.",
    "check-email":
      "You're not signed in yet. Look for a confirmation email to finish setting up your account.",
    "reset-sent":
      "If an account exists for this email, use the link in the password-reset email to choose a new password.",
    recovery: "Use at least 10 characters to secure your account.",
  }[mode];

  return (
    <main className="login-page selfserve-auth">
      <section className="login-story">
        <a className="brand" href="index.html" aria-label="ApplyDesk home">
          <span className="brand-icon">
            <Plane size={23} />
          </span>
          apply<span>desk</span>.
        </a>
        <div className="login-story-content">
          <p className="eyebrow">APPLYDESK · SELF-SERVICE</p>
          <h1>
            A new chapter.
            <br />
            On your terms.
          </h1>
          <p>
            Find your next opportunity, bring your best experience forward, and
            keep every application in view.
          </p>
          <div className="login-benefit">
            <ShieldCheck />
            <span>Explore roles with explicit H-1B sponsorship</span>
          </div>
          <div className="login-benefit">
            <FileText />
            <span>Prepare resumes that reflect your experience</span>
          </div>
          <div className="login-benefit">
            <BriefcaseBusiness />
            <span>Manage your job search in one place</span>
          </div>
          <div className="auth-service-note">
            <span className="auth-service-dot" />
            <p>
              Your own job search workspace.
              <br />
              <strong>You decide where and when to apply.</strong>
            </p>
          </div>
        </div>
        <footer>YOUR CAREER. IN MOTION.</footer>
      </section>
      <section className="login-form-panel">
        <a className="text-link auth-existing-link" href="portal-v2.html">
          Recruiter-managed client portal <ArrowUpRight size={14} />
        </a>
        <div className="login-form-wrap">
          <span className="login-icon">
            {emailScreen ? (
              <MailCheck size={27} />
            ) : mode === "forgot" || recoveryMode ? (
              <KeyRound size={27} />
            ) : (
              <Plane size={27} />
            )}
          </span>
          <p className="eyebrow">YOUR SELF-SERVICE WORKSPACE</p>
          <h2>{title}</h2>
          <p>{intro}</p>
          {(mode === "login" || signup) && (
            <div
              className="auth-mode-switch"
              role="group"
              aria-label="Account access"
            >
              <button
                type="button"
                aria-pressed={!signup}
                disabled={busy}
                onClick={() => changeMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                aria-pressed={signup}
                disabled={busy}
                onClick={() => changeMode("signup")}
              >
                Create account
              </button>
            </div>
          )}
          {emailScreen ? (
            <div className="auth-email-content">
              <div className="auth-email-address">
                <MailCheck size={18} />
                <strong>{email.trim()}</strong>
              </div>
              <p>
                Check your spam folder too. Keep this page open or return after
                following the email link.
              </p>
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              {notice && (
                <div className="auth-notice" role="status">
                  {notice}
                </div>
              )}
              {mode === "check-email" && (
                <button
                  type="button"
                  className="button primary full"
                  disabled={busy}
                  onClick={resendConfirmation}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="spin" size={17} /> Requesting
                      email…
                    </>
                  ) : (
                    <>
                      Resend confirmation <ArrowRight size={17} />
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                className="auth-back-link"
                disabled={busy}
                onClick={() =>
                  changeMode(mode === "reset-sent" ? "forgot" : "signup")
                }
              >
                <ArrowLeft size={14} /> Use a different email
              </button>
              <button
                type="button"
                className="auth-back-link"
                disabled={busy}
                onClick={() => changeMode("login")}
              >
                Already confirmed or have an account? Sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <fieldset disabled={busy} className="auth-fields">
                {signup && (
                  <label htmlFor="auth-full-name">
                    Full name
                    <input
                      id="auth-full-name"
                      name="fullName"
                      autoComplete="name"
                      value={fullName}
                      minLength={2}
                      maxLength={120}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Your full name"
                      required
                    />
                  </label>
                )}
                {!recoveryMode && (
                  <label htmlFor="auth-email">
                    Email address
                    <input
                      id="auth-email"
                      name="email"
                      type="email"
                      autoComplete={signup ? "email" : "username"}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </label>
                )}
                {mode !== "forgot" && (
                  <>
                    <label htmlFor="auth-password">
                      {recoveryMode ? "New password" : "Password"}
                      <div className="auth-password-field">
                        <input
                          id="auth-password"
                          aria-label={
                            recoveryMode ? "New password" : "Password"
                          }
                          name="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete={
                            signup || recoveryMode
                              ? "new-password"
                              : "current-password"
                          }
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          required
                          minLength={signup || recoveryMode ? 10 : undefined}
                          aria-describedby={
                            signup || recoveryMode
                              ? "auth-password-hint"
                              : undefined
                          }
                        />
                        <button
                          type="button"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff size={18} />
                          ) : (
                            <Eye size={18} />
                          )}
                        </button>
                      </div>
                      {(signup || recoveryMode) && (
                        <span
                          id="auth-password-hint"
                          className="auth-field-hint"
                        >
                          At least 10 characters.
                        </span>
                      )}
                    </label>
                    {(signup || recoveryMode) && (
                      <label htmlFor="auth-password-confirm">
                        Confirm {recoveryMode ? "new " : ""}password
                        <input
                          id="auth-password-confirm"
                          name="passwordConfirmation"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          value={confirmation}
                          onChange={(event) =>
                            setConfirmation(event.target.value)
                          }
                          required
                          minLength={10}
                        />
                      </label>
                    )}
                  </>
                )}
                {mode === "login" && (
                  <button
                    type="button"
                    className="auth-forgot"
                    onClick={() => changeMode("forgot")}
                  >
                    Forgot password?
                  </button>
                )}
                {error && (
                  <div className="notice error" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="button primary full"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="spin" size={17} /> Please wait…
                    </>
                  ) : (
                    <>
                      {signup
                        ? "Create my account"
                        : recoveryMode
                          ? "Save new password"
                          : mode === "forgot"
                            ? "Send reset link"
                            : "Enter your workspace"}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </fieldset>
              {recoveryMode && (
                <a className="auth-back-link" href="copilot.html?mode=forgot">
                  Request another reset link
                </a>
              )}
              {mode === "forgot" && (
                <button
                  type="button"
                  className="auth-back-link"
                  disabled={busy}
                  onClick={() => changeMode("login")}
                >
                  <ArrowLeft size={14} /> Back to sign in
                </button>
              )}
            </form>
          )}
          <div className="login-footnote auth-product-note">
            <ShieldCheck size={17} />
            <span>
              This account is for self-service job search. Creating an account
              does not enroll you in ApplyDesk's recruiter service.
            </span>
          </div>
          <a className="auth-admin-link" href="copilot-admin.html">
            ApplyDesk admin access <ArrowUpRight size={12} />
          </a>
        </div>
        <p className="copyright">© {new Date().getFullYear()} ApplyDesk</p>
      </section>
    </main>
  );
}
