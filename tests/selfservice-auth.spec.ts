import { test, expect, type Page } from "@playwright/test";
const userId = "00000000-0000-4000-8000-000000000080";
const makeUser = (metadata: any = {}) => ({
  id: userId,
  email: "newmember@example.test",
  email_confirmed_at: new Date().toISOString(),
  aud: "authenticated",
  role: "authenticated",
  user_metadata: metadata,
});
function makeSession(metadata: any = {}) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp })).toString(
    "base64url",
  );
  return {
    access_token: `test.${payload}.test`,
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: makeUser(metadata),
  };
}
async function authMock(
  page: Page,
  {
    kind = "member",
    status = "active",
    seed = false,
    metadata = {},
    missing = false,
  }: any = {},
) {
  const calls: any[] = [];
  let identity = kind;
  const session = makeSession(metadata);
  if (seed)
    await page.addInitScript(
      (value) =>
        localStorage.setItem("ad-selfserve-auth", JSON.stringify(value)),
      session,
    );
  await page.route(
    "https://rofyegirmgqjhekuxjat.supabase.co/**",
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: any = {};
      try {
        body = route.request().postDataJSON() || {};
      } catch {}
      calls.push({ path, body });
      let result: any = {};
      if (path.endsWith("/token")) result = session;
      else if (path.endsWith("/signup"))
        result = { user: makeUser(body.data), session: null };
      else if (path.endsWith("/user"))
        result = { ...makeUser(metadata), ...body };
      else if (
        path.endsWith("/logout") ||
        path.endsWith("/recover") ||
        path.endsWith("/resend")
      )
        result = {};
      else if (path.endsWith("/fn_ss_identity")) {
        if (missing)
          return route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({
              code: "PGRST202",
              message: "Function not found",
            }),
          });
        result = {
          ok: true,
          kind: identity,
          profile:
            identity === "member"
              ? {
                  user_id: userId,
                  full_name: "New Member",
                  email: "newmember@example.test",
                  status,
                }
              : null,
        };
      } else if (path.endsWith("/fn_ss_enroll")) {
        identity = "member";
        result = { ok: true };
      } else if (path.endsWith("/fn_ss_get_my_workspace"))
        result = {
          ok: true,
          resumes: [],
          activity: [],
          applications: [],
          feed_status: [],
        };
      else if (path.endsWith("/fn_ss_discover_jobs"))
        result = { ok: true, jobs: [], feed_status: [] };
      else
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "Unexpected test request " + path }),
        });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    },
  );
  return { calls, session };
}
test("existing portal session does not sign in self-service, and login uses its own session", async ({
  page,
}) => {
  const original = JSON.stringify(makeSession({ staff: true }));
  await page.addInitScript((v) => localStorage.setItem("ad-auth", v), original);
  const state = await authMock(page);
  await page.goto("/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Welcome to your next chapter." }),
  ).toBeVisible();
  expect(state.calls.filter((c) => c.path.includes("/rpc/"))).toHaveLength(0);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("newmember@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Find your next opportunity." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Recruiter", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ad-auth"))).toBe(
    original,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to your next chapter." }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ad-auth"))).toBe(
    original,
  );
  expect(
    state.calls.some(
      (c) => c.path.includes("fn_a_") || c.path.includes("fn_whoami"),
    ),
  ).toBe(false);
});
test("signup waits for email confirmation without creating a managed client", async ({
  page,
}) => {
  const state = await authMock(page);
  await page.goto("/copilot.html?mode=signup");
  await page.getByLabel("Full name", { exact: true }).fill("New Member");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("newmember@example.test");
  await page.getByLabel("Password", { exact: true }).fill("new-password-123");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("new-password-123");
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email." }),
  ).toBeVisible();
  const signup = state.calls.find((c) => c.path.endsWith("/signup"));
  expect(signup.body.data).toMatchObject({
    product: "selfserve",
    full_name: "New Member",
  });
  expect(state.calls.some((c) => c.path.includes("/rpc/"))).toBe(false);
  await page.getByRole("button", { name: "Resend confirmation" }).click();
  await expect
    .poll(() => state.calls.some((c) => c.path.endsWith("/resend")))
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/private/tmp/applydesk-selfservice-confirmation-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("confirmed self-service signup enrolls in the separate product", async ({
  page,
}) => {
  const state = await authMock(page, {
    kind: "unregistered",
    seed: true,
    metadata: { product: "selfserve", full_name: "New Member" },
  });
  await page.goto("/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Find your next opportunity." }),
  ).toBeVisible();
  expect(
    state.calls.find((c) => c.path.endsWith("/fn_ss_enroll")).body,
  ).toEqual({ p_full_name: "New Member" });
  expect(state.calls.some((c) => c.path.includes("fn_a_"))).toBe(false);
});
test("unlinked accounts explicitly choose self-service enrollment", async ({
  page,
}) => {
  const state = await authMock(page, { kind: "unregistered", seed: true });
  await page.goto("/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Create your self-service workspace" }),
  ).toBeVisible();
  expect(state.calls.some((c) => c.path.endsWith("/fn_ss_enroll"))).toBe(false);
  await page.getByLabel("Full name", { exact: true }).fill("New Member");
  await page
    .getByRole("button", { name: "Create self-service workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find your next opportunity." }),
  ).toBeVisible();
});
test("managed clients are routed to their existing service without enrollment", async ({
  page,
}) => {
  const state = await authMock(page, {
    kind: "legacy",
    seed: true,
    metadata: { product: "selfserve", full_name: "Existing Client" },
  });
  await page.goto("/copilot.html");
  await expect(
    page.getByRole("heading", {
      name: "Your recruiter-managed portal is separate",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Mission Control" }),
  ).toHaveAttribute("href", "portal-v2.html");
  expect(
    state.calls.some((c) =>
      /fn_ss_(enroll|get_my_workspace|discover_jobs)/.test(c.path),
    ),
  ).toBe(false);
});
test("missing migration displays a setup screen rather than a broken job dashboard", async ({
  page,
}) => {
  await authMock(page, { seed: true, missing: true });
  await page.goto("/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Self-service setup is pending" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("has not been enabled");
  await expect(page.locator(".desk-sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to your next chapter." }),
  ).toBeVisible();
});
test("suspended members cannot open the workspace", async ({ page }) => {
  const state = await authMock(page, { seed: true, status: "suspended" });
  await page.goto("/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Your self-service access is paused" }),
  ).toBeVisible();
  expect(
    state.calls.some((c) =>
      /fn_ss_(get_my_workspace|discover_jobs)/.test(c.path),
    ),
  ).toBe(false);
});
test("password recovery requests a reset and saves the new password", async ({
  page,
}) => {
  const state = await authMock(page);
  await page.goto("/copilot.html");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("newmember@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect
    .poll(() => state.calls.some((c) => c.path.endsWith("/recover")))
    .toBe(true);
  await page.evaluate(
    (session) =>
      localStorage.setItem("ad-selfserve-auth", JSON.stringify(session)),
    state.session,
  );
  await page.goto("/copilot.html?recovery=1");
  await page
    .getByLabel("New password", { exact: true })
    .fill("changed-password-123");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("changed-password-123");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(
    page.getByRole("heading", { name: "Find your next opportunity." }),
  ).toBeVisible();
  expect(
    state.calls.find((c) => c.body.password === "changed-password-123")?.path,
  ).toBe("/auth/v1/user");
  await expect(page).not.toHaveURL(/recovery=1/);
});

test("refocusing the tab preserves an unsaved search and open resume dialog", async ({
  page,
}) => {
  await authMock(page, { seed: true });
  await page.goto("/copilot.html");
  const search = page.getByPlaceholder("Job title, skill, or company");
  await search.fill("keep this search");
  await page
    .getByRole("button", { name: "Upload resume", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(search).toHaveValue("keep this search");
});
test("expired reset links show an error even when another session exists", async ({
  page,
}) => {
  const state = await authMock(page, { seed: true });
  await page.goto(
    "/copilot.html?recovery=1#error=access_denied&error_code=otp_expired&error_description=Link%20has%20expired",
  );
  await expect(
    page.getByRole("heading", { name: "This sign-in link can’t be used" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Request a new reset link" }).click();
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toBeVisible();
  expect(state.calls.some((c) => c.body.password)).toBe(false);
});
