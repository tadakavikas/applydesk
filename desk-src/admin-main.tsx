import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, ShieldCheck } from "lucide-react";
import Admin from "./Admin";
import { adminSb, getAdminIdentity } from "./lib/admin-client";
import "./styles.css";
import "./admin.css";

function AdminApp() {
  const currentUserId = useRef<string | null>(null);
  const [identity, setIdentity] =
    useState<Awaited<ReturnType<typeof getAdminIdentity>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setIdentity(null);
    setError("");
    getAdminIdentity()
      .then((value) => {
        if (active) {
          currentUserId.current = value?.sessionUserId || null;
          setIdentity(value);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const { data } = adminSb.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") {
        currentUserId.current = session?.user.id || null;
        return;
      }
      if (event === "SIGNED_OUT") {
        active = false;
        currentUserId.current = null;
        setIdentity(null);
        setError("");
        setLoading(false);
        return;
      }
      if (event === "SIGNED_IN" && session?.user.id !== currentUserId.current) {
        // The SDK repeats SIGNED_IN when the tab regains focus. Keep notes and
        // open records intact for the same user; re-check true account changes.
        active = false;
        currentUserId.current = session?.user.id || null;
        setIdentity(null);
        setLoading(true);
        setRevision((value) => value + 1);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [revision]);
  if (loading)
    return (
      <div className="boot-loading" role="status">
        <LoaderCircle className="spin" />
        <span>Checking administrator access…</span>
      </div>
    );
  if (identity?.kind === "admin" && !error) return <Admin />;
  return (
    <main className="ss-admin ss-admin-gate">
      <div className="ss-gate-card">
        <div className="ss-mark">
          <ShieldCheck size={30} />
        </div>
        <p className="ss-eyebrow">APPLYDESK · ADMINISTRATION</p>
        <h1>{error ? "Setup needs attention" : "Administrator access"}</h1>
        <p role={error ? "alert" : undefined}>
          {error ||
            (identity
              ? "This staff session does not have administrator access. Sign in to Mission Control with an ApplyDesk administrator account."
              : "Use your existing ApplyDesk administrator account in Mission Control to manage self-service members.")}
        </p>
        <a className="ss-button ss-primary" href="portal-v2.html">
          Open Mission Control login
        </a>
        {error && (
          <button
            className="ss-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry connection
          </button>
        )}
        <a className="ss-text-link" href="index.html">
          <ArrowLeft size={15} /> Back to ApplyDesk
        </a>
        <small>
          Self-service member accounts do not grant access to administration.
        </small>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<AdminApp />);
