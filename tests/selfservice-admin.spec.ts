import { test, expect, type BrowserContext, type Page } from "@playwright/test";
const adminId = "00000000-0000-4000-8000-000000000099";
const candidateId = "00000000-0000-4000-8000-000000000001";
const supabase = "https://rofyegirmgqjhekuxjat.supabase.co";
const profile = {
  name: "Jordan Independent",
  email: "jordan@example.test",
  phone: "202-555-0100",
  location: "Boston, MA",
  linkedin: "",
  summary: "Builds reliable data tools.",
  experience: "Data Engineer | Fixture Employer\n- Built Python pipelines.",
  skills: "Python, SQL",
  certifications: "",
  education: "BS Computer Science",
  projects: "",
  achievements: "",
};
const member = {
  user_id: candidateId,
  full_name: "Jordan Independent",
  email: "jordan@example.test",
  status: "active",
  admin_notes: "",
  created_at: "2026-09-18T01:00:00Z",
  resume_count: 1,
  application_count: 1,
};
const job = {
  id: 123,
  title: "Data Engineer",
  company: "Fixture Employer",
  location: "Boston, MA",
  description: "Python data engineering with H-1B sponsorship.",
  url: "https://jobs.ashbyhq.com/fixture/job-123",
};
const currentResume = {
  id: 12,
  user_id: candidateId,
  file_name: "Jordan-current.docx",
  storage_path: `${candidateId}/original/Jordan-current.docx`,
  parsed_profile: profile,
  resume_text: "Jordan Independent\nCurrent original resume text",
  latex_text: "\\documentclass{article}",
  is_primary: true,
  archived_at: null,
  created_at: "2026-09-18T01:00:00Z",
};
const archivedResume = {
  ...currentResume,
  id: 11,
  file_name: "Jordan-original.pdf",
  storage_path: `${candidateId}/original/Jordan-original.pdf`,
  is_primary: false,
  archived_at: "2026-09-18T01:00:00Z",
};
async function session(page: Page, key: string, id: string) {
  await page.addInitScript(
    ({ key, id }) => {
      const payload = btoa(
        JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 }),
      );
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: `test.${payload}.test`,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user: {
            id,
            email: "fixture@example.test",
            aud: "authenticated",
            role: "authenticated",
          },
        }),
      );
    },
    { key, id },
  );
}
async function mockAdmin(
  context: BrowserContext,
  kind = "admin",
  customSnapshot = false,
) {
  const calls: { path: string; body: any; authorization: string }[] = [];
  const target = { ...member };
  await context.route(`${supabase}/**`, async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let body: any = {};
    try {
      body = req.postDataJSON() || {};
    } catch {}
    calls.push({
      path: url.pathname,
      body,
      authorization: req.headers().authorization || "",
    });
    if (
      req.method() === "GET" &&
      url.pathname.startsWith("/storage/v1/object/sign/")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "Original file fixture",
      });
      return;
    }
    let data: any;
    const fn = url.pathname.split("/").pop();
    if (fn === "user")
      data = {
        id: adminId,
        email: "admin@example.test",
        aud: "authenticated",
        role: "authenticated",
      };
    else if (fn === "fn_ss_identity") data = { ok: true, kind };
    else if (fn === "fn_ss_admin_list_members") {
      data = {
        ok: true,
        total: body.p_search ? 1 : 26,
        members: body.p_offset
          ? [
              {
                ...target,
                user_id: "00000000-0000-4000-8000-000000000026",
                full_name: "Last Member",
              },
            ]
          : [target],
      };
    } else if (fn === "fn_ss_admin_member_detail") {
      data = {
        ok: true,
        member: target,
        resumes: [currentResume, archivedResume],
        activity: [
          {
            job_id: 123,
            state: "saved",
            job,
            updated_at: "2026-09-18T01:00:00Z",
          },
        ],
        applications: [
          {
            id: 55,
            status: "interview",
            score: 75,
            created_at: "2026-09-18T01:00:00Z",
            job_snapshot: job,
            resume_snapshot: customSnapshot
              ? {
                  source: "custom",
                  resume_id: archivedResume.id,
                  file_name: archivedResume.file_name,
                  storage_path: archivedResume.storage_path,
                }
              : {
                  ...archivedResume,
                  parsed_profile: {
                    ...profile,
                    summary: "Immutable application summary",
                  },
                  resume_text: "Immutable application resume text",
                },
          },
        ],
        audit: [{ action: "view_member", actor_user_id: adminId }],
      };
    } else if (fn === "fn_ss_admin_update_member") {
      target.status = body.p_status;
      target.admin_notes = body.p_admin_notes;
      data = { ok: true };
    } else if (
      url.pathname.startsWith("/storage/v1/object/sign/selfserve-resumes/")
    )
      data = {
        signedURL: url.pathname.replace("/storage/v1", "") + "?token=test",
      };
    else data = { ok: false, err: `Unexpected RPC ${fn}` };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return { calls, target };
}

test("self-service session cannot unlock staff administration", async ({
  page,
  context,
}) => {
  const { calls } = await mockAdmin(context);
  await session(page, "ad-selfserve-auth", candidateId);
  await page.goto("/copilot-admin.html");
  await expect(
    page.getByRole("heading", { name: "Administrator access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Mission Control login" }),
  ).toBeVisible();
  expect(calls.filter((call) => call.path.includes("/rpc/")).length).toBe(0);
});

test("non-admin staff are denied before the member directory is read", async ({
  page,
  context,
}) => {
  const { calls } = await mockAdmin(context, "legacy");
  await session(page, "ad-auth", adminId);
  await page.goto("/copilot-admin.html");
  await expect(
    page.getByText("This staff session does not have administrator access.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.includes("fn_ss_admin_"))).toBe(false);
});

test("administrator searches pages and saves account status with internal notes", async ({
  page,
  context,
}) => {
  const { calls, target } = await mockAdmin(context);
  await session(page, "ad-auth", adminId);
  await session(page, "ad-selfserve-auth", candidateId);
  await page.goto("/copilot-admin.html");
  await expect(
    page.getByRole("button", { name: "Jordan Independent", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByRole("button", { name: "Last Member", exact: true }),
  ).toBeVisible();
  expect(calls.some((call) => call.body.p_offset === 25)).toBe(true);
  await page.getByRole("searchbox").fill("Jordan");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Jordan Independent", exact: true }),
  ).toBeVisible();
  expect(
    calls.some(
      (call) => call.body.p_search === "Jordan" && call.body.p_offset === 0,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "View member", exact: false }).click();
  await expect(page.getByLabel("Internal admin notes")).toBeVisible();
  await page
    .getByLabel("Internal admin notes")
    .fill("Support review completed.");
  await page.getByLabel("Access status").selectOption("suspended");
  await page.getByRole("button", { name: "Save account changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Member settings saved.");
  await expect(page.getByLabel("Access status")).toHaveValue("suspended");
  expect(target).toMatchObject({
    status: "suspended",
    admin_notes: "Support review completed.",
  });
  await page.getByLabel("Access status").selectOption("active");
  await page.getByRole("button", { name: "Save account changes" }).click();
  await expect(page.getByLabel("Access status")).toHaveValue("active");
  expect(target.status).toBe("active");
  const staffRequest = calls.find((call) =>
    call.path.endsWith("fn_ss_identity"),
  )!;
  const payload = JSON.parse(
    Buffer.from(staffRequest.authorization.split(".")[1], "base64").toString(),
  );
  expect(payload.sub).toBe(adminId);
});

test("administrator reads archived originals and immutable application snapshots", async ({
  page,
  context,
}) => {
  const { calls } = await mockAdmin(context);
  await session(page, "ad-auth", adminId);
  await page.goto("/copilot-admin.html");
  await page.getByRole("button", { name: "View member", exact: false }).click();
  await page.getByRole("button", { name: "Resumes (2)", exact: true }).click();
  const archived = page
    .locator("details.ss-record")
    .filter({ hasText: "Jordan-original.pdf" });
  await archived.locator("summary").first().click();
  await expect(archived.getByText("Archived", { exact: true })).toBeVisible();
  await expect(
    archived.getByText("Python, SQL", { exact: true }),
  ).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await archived.getByRole("button", { name: "Original file" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("Original file fixture")).toBeVisible();
  expect(
    calls.some(
      (call) =>
        call.path.includes("/selfserve-resumes/") &&
        call.path.endsWith("Jordan-original.pdf"),
    ),
  ).toBe(true);
  await popup.close();
  await page
    .getByRole("button", { name: "Applications (1)", exact: true })
    .click();
  await page.locator("details.ss-record > summary").click();
  await expect(
    page.getByText("Immutable application summary", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("interview", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download application record" })
    .click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.resume_snapshot.parsed_profile.summary).toBe(
    "Immutable application summary",
  );
  expect(exported.status).toBe("interview");
  await page.screenshot({
    path: "/private/tmp/applydesk-selfservice-admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/private/tmp/applydesk-selfservice-admin-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("returning to the admin tab preserves the open record and unsaved notes", async ({
  page,
  context,
}) => {
  const { calls } = await mockAdmin(context);
  await session(page, "ad-auth", adminId);
  await page.goto("/copilot-admin.html");
  await page.getByRole("button", { name: "View member", exact: false }).click();
  await page.getByLabel("Internal admin notes").fill("Unsaved support draft");
  const readsBefore = calls.filter((call) =>
    call.path.endsWith("fn_ss_admin_member_detail"),
  ).length;
  await page.evaluate(async () => {
    const modulePath = "/desk-src/lib/admin-client.ts";
    const { adminSb } = await import(/* @vite-ignore */ modulePath);
    await new Promise<void>((resolve) => {
      const { data } = adminSb.auth.onAuthStateChange((event: string) => {
        if (event === "SIGNED_IN") {
          data.subscription.unsubscribe();
          resolve();
        }
      });
      window.dispatchEvent(new Event("visibilitychange"));
    });
  });
  await expect(page.getByLabel("Internal admin notes")).toHaveValue(
    "Unsaved support draft",
  );
  await expect(
    page.getByRole("region", { name: "Member details" }),
  ).toBeVisible();
  expect(
    calls.filter((call) => call.path.endsWith("fn_ss_admin_member_detail"))
      .length,
  ).toBe(readsBefore);
  expect(
    calls.some((call) => call.path.endsWith("fn_ss_admin_update_member")),
  ).toBe(false);
});

test("administrator sees the exact custom-original choice without generated export controls", async ({
  page,
  context,
}) => {
  await mockAdmin(context, "admin", true);
  await session(page, "ad-auth", adminId);
  await page.goto("/copilot-admin.html");
  await page.getByRole("button", { name: "View member", exact: false }).click();
  await page
    .getByRole("button", { name: "Applications (1)", exact: true })
    .click();
  await page.locator("details.ss-record > summary").click();
  await expect(
    page.getByRole("heading", {
      name: "Resume snapshot at handoff · Custom original",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Original file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Word", exact: true }),
  ).toHaveCount(0);
});
