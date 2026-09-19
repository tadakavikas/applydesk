import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
const origin = "http://127.0.0.1:5173";
const userId = "00000000-0000-4000-8000-000000000001";
const profile = {
  name: "Jordan Candidate",
  email: "candidate@example.test",
  phone: "202-555-0147",
  location: "Chicago, IL",
  linkedin: "",
  summary: "Data engineer building reliable pipelines.",
  experience:
    "Data Engineer | Test Company | 2023 - Present\n- Built Python and SQL pipelines.\n- Improved reliability by 20%.",
  skills: "Python, SQL",
  certifications: "Cloud fundamentals",
  education: "MS Computer Science | Test University",
  projects: "Reporting pipeline using Python",
  achievements: "",
};
const makeJob = (id: number, title: string, company: string) => ({
  id,
  title,
  company,
  source: "greenhouse",
  source_board: "testboard",
  url: `https://job-boards.greenhouse.io/testboard/jobs/${id}`,
  posted_at: new Date(Date.now() - 3600000).toISOString(),
  date_basis: "first_published",
  last_verified_at: new Date().toISOString(),
  status: "active",
  country_code: "US",
  sponsorship_status: "explicit_h1b",
  sponsorship_evidence: "We sponsor H-1B visas for eligible candidates.",
  location: "Chicago, IL",
  employment_type: "Full-time",
  work_mode: "Hybrid",
  salary_text: "$100,000 - $140,000",
  years_required: "2+ years experience",
  description:
    "Build Python, SQL, AWS and Spark data pipelines. We sponsor H-1B visas for eligible candidates.",
});
async function mockWorkspace(page: any, { resume = true } = {}) {
  const jobs = [
    makeJob(101, "Data Engineer", "Test Company A"),
    makeJob(102, "Analytics Engineer", "Test Company B"),
    makeJob(103, "Software Engineer", "Test Company C"),
  ];
  let resumes = resume
    ? [
        {
          id: 1,
          file_name: "Jordan.pdf",
          storage_path: `${userId}/original/Jordan.pdf`,
          parsed_profile: profile,
          resume_text: "Jordan Candidate resume",
          latex_text: "",
          is_primary: true,
          created_at: new Date().toISOString(),
        },
      ]
    : [];
  let applicationResumeSource = "applydesk";
  const activity: any[] = [];
  const applications: any[] = [];
  const calls: any[] = [];
  const feed = [
    {
      source: "greenhouse",
      source_board: "testboard",
      company: "Test company feed",
      status: "ok",
      last_success_at: new Date().toISOString(),
      jobs_seen: 3,
      jobs_eligible: 3,
    },
  ];
  await page.addInitScript(
    ({ userId }: any) => {
      const payload = btoa(
        JSON.stringify({
          sub: userId,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      localStorage.setItem(
        "ad-selfserve-auth",
        JSON.stringify({
          access_token: `test.${payload}.test`,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user: {
            id: userId,
            email: "candidate@example.test",
            aud: "authenticated",
            role: "authenticated",
          },
        }),
      );
    },
    { userId },
  );
  await page.route(
    "https://rofyegirmgqjhekuxjat.supabase.co/**",
    async (route: any) => {
      const req = route.request(),
        url = new URL(req.url());
      let body: any = {};
      try {
        body = req.postDataJSON() || {};
      } catch {}
      calls.push({ path: url.pathname, body });
      let data: any = {};
      if (url.pathname === "/auth/v1/user")
        data = {
          id: userId,
          email: "candidate@example.test",
          aud: "authenticated",
          role: "authenticated",
        };
      else if (url.pathname.startsWith("/storage/v1/object/"))
        data = { Key: "saved", Id: "upload-test" };
      else {
        const fn = url.pathname.split("/").pop();
        if (fn === "fn_ss_identity")
          data = {
            ok: true,
            kind: "member",
            profile: {
              user_id: userId,
              full_name: "Jordan Candidate",
              email: "candidate@example.test",
              status: "active",
            },
          };
        else if (fn === "fn_ss_get_my_workspace")
          data = {
            ok: true,
            resumes,
            application_resume_source: applicationResumeSource,
            activity,
            applications,
            feed_status: feed,
          };
        else if (fn === "fn_ss_set_resume_preference") {
          applicationResumeSource = body.p_source;
          data = {
            ok: true,
            application_resume_source: applicationResumeSource,
          };
        } else if (fn === "fn_ss_discover_jobs")
          data = { ok: true, jobs, feed_status: feed };
        else if (fn === "fn_ss_set_job_activity") {
          const idx = activity.findIndex((a) => a.job_id === body.p_job_id);
          if (idx >= 0) activity.splice(idx, 1);
          if (body.p_state !== "none")
            activity.push({
              job_id: body.p_job_id,
              state: body.p_state,
              job: jobs.find((j) => j.id === body.p_job_id),
              updated_at: new Date().toISOString(),
            });
          data = { ok: true };
        } else if (fn === "fn_ss_save_my_resume") {
          const id = resumes.length + 1;
          const old = resumes.find((r) => r.id === body.p_replace_id);
          if (old) resumes = resumes.filter((r) => r.id !== old.id);
          const r = {
            id,
            file_name: body.p_file_name,
            storage_path: body.p_storage_path,
            parsed_profile: body.p_parsed_profile,
            resume_text: body.p_resume_text,
            latex_text: body.p_latex_text,
            is_primary: old?.is_primary || !resumes.length,
            created_at: new Date().toISOString(),
          };
          resumes.push(r);
          data = { ok: true, resume: r };
        } else if (fn === "fn_ss_set_primary_resume") {
          resumes.forEach((r) => (r.is_primary = r.id === body.p_resume_id));
          data = { ok: true };
        } else if (fn === "fn_ss_update_my_resume") {
          const r = resumes.find((r) => r.id === body.p_resume_id)!;
          r.parsed_profile = body.p_parsed_profile;
          data = { ok: true };
        } else if (fn === "fn_ss_log_application") {
          const job = jobs.find((j) => j.id === body.p_job_id);
          const existing = applications.find((a) => a.job_id === body.p_job_id);
          if (!existing)
            applications.push({
              id: 501,
              job_id: body.p_job_id,
              resume_id: body.p_resume_id,
              status: "opened",
              job_snapshot: job,
              resume_snapshot: {
                source: body.p_resume_source || applicationResumeSource,
                file_name: resumes.find((r) => r.id === body.p_resume_id)
                  ?.file_name,
                storage_path: resumes.find((r) => r.id === body.p_resume_id)
                  ?.storage_path,
                ...(applicationResumeSource === "applydesk"
                  ? { parsed_profile: body.p_parsed_profile }
                  : {}),
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          data = { ok: true, id: 501, url: job?.url, already: !!existing };
        } else if (fn === "fn_ss_update_application_status") {
          applications.find((a) => a.id === body.p_application_id).status =
            body.p_status;
          data = { ok: true };
        } else data = { ok: false, err: "Unexpected mock RPC " + fn };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    },
  );
  await page.route("https://job-boards.greenhouse.io/**", (route) =>
    route.fulfill({ body: "Employer application test destination" }),
  );
  return { calls, resumes, activity, applications, jobs, feed };
}
test("signed-out page and mobile layout", async ({ page }) => {
  await page.goto(origin + "/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Welcome to your next chapter." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Enter your workspace" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/applydesk-login-mobile.png",
    fullPage: true,
  });
});
test("jobs, save/skip persistence, tailoring, exports and employer handoff", async ({
  page,
  context,
}) => {
  const state = await mockWorkspace(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/copilot.html");
  await expect(
    page.getByRole("heading", { name: "Find your next opportunity." }),
  ).toBeVisible();
  await expect(page.locator(".job-card")).toHaveCount(3);
  await page.screenshot({
    path: "/private/tmp/applydesk-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save Data Engineer", exact: true })
    .click();
  await page.getByRole("button", { name: /Saved jobs/ }).click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: /Saved jobs/ }).click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Find jobs", exact: true }).click();
  await page
    .getByRole("button", { name: "Skip Analytics Engineer", exact: true })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(2);
  await page.getByRole("tab", { name: "Skipped" }).click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Restore Analytics Engineer" })
    .click();
  await page.getByRole("tab", { name: /All jobs/ }).click();
  await page
    .locator(".job-card")
    .filter({
      has: page.getByRole("button", { name: "Data Engineer", exact: true }),
    })
    .getByRole("button", { name: "Apply now" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Fix my resume" }).click();
  await expect(page.getByText("Skills you can confirm")).toBeVisible();
  await page.getByRole("checkbox", { name: "AWS", exact: true }).check();
  await page.getByRole("button", { name: "Prepare updated resume" }).click();
  await expect(page.locator(".tailor-preview")).toContainText("AWS");
  await expect(page.locator(".tailor-preview")).not.toContainText("Spark");
  await page.screenshot({
    path: "/private/tmp/applydesk-tailor.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Apply now", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/greenhouse\.io/);
  await expect(
    page.getByRole("heading", { name: "Keep your next move in view." }),
  ).toBeVisible();
  expect(state.applications[0].resume_snapshot.parsed_profile.skills).toContain(
    "AWS",
  );
  expect(
    state.applications[0].resume_snapshot.parsed_profile.skills,
  ).not.toContain("Spark");
  await popup.close();
  await expect(page.locator(".application-handoff")).toContainText(
    "ApplyDesk resume saved for this application",
  );
  const savedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved resume", exact: true })
    .click();
  expect((await savedDownload).suggestedFilename()).toMatch(
    /application-resume\.pdf$/,
  );
  await page
    .getByRole("combobox", { name: "Status for Data Engineer" })
    .click();
  await page.getByRole("option", { name: "Interview", exact: true }).click();
  expect(state.applications[0].status).toBe("interview");
  await page.getByRole("button", { name: "Find jobs", exact: true }).click();
  await page
    .locator(".job-card")
    .filter({
      has: page.getByRole("button", { name: "Data Engineer", exact: true }),
    })
    .getByRole("button", { name: "View job" })
    .click();
  await expect(page.getByText(/You already have an application/)).toBeVisible();
  const popup2 = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Apply now", exact: true }).click();
  await (await popup2).close();
  expect(state.applications[0].status).toBe("interview");
  expect(errors).toEqual([]);
  await context.close();
});
test("PDF upload, review, add and primary resume", async ({ page }) => {
  await mockWorkspace(page, { resume: false });
  await page.goto(origin + "/copilot.html");
  await page
    .getByRole("button", { name: "Upload resume", exact: true })
    .click();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage();
  let y = 750;
  for (const line of [
    "Jordan Candidate",
    "Chicago, IL",
    "candidate@example.test",
    "SUMMARY",
    "Data engineer with Python and SQL.",
    "EXPERIENCE",
    "Data Engineer | Test Company | 2023 - Present",
    "- Built Python pipelines for 20 reports.",
    "TECHNICAL SKILLS",
    "Python, SQL, AWS",
    "EDUCATION",
    "MS Computer Science | Test University",
  ]) {
    p.drawText(line, { x: 40, y, font, size: 11 });
    y -= 20;
  }
  await page.locator("input[type=file]").setInputFiles({
    name: "Jordan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel("Full name")).toHaveValue("Jordan Candidate");
  await expect(
    page.getByLabel("Technical skills", { exact: true }),
  ).toHaveValue(/Python/);
  await page.getByRole("button", { name: "Save reviewed profile" }).click();
  await expect(page.locator(".resume-tile")).toHaveCount(1);
  await expect(page.locator(".resume-paper")).toContainText("Jordan Candidate");
  await expect(page.locator(".primary-badge")).toBeVisible();
  await page.getByRole("button", { name: "Add resume", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Jordan-new.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel("Full name")).toHaveValue("Jordan Candidate");
  await page.getByRole("button", { name: "Save reviewed profile" }).click();
  await expect(page.locator(".resume-tile")).toHaveCount(2);
  await page.getByRole("button", { name: /Jordan-new.pdf/ }).click();
  await page.getByRole("button", { name: "Make primary" }).click();
  await expect(
    page.getByRole("button", { name: /Jordan-new.pdf/ }),
  ).toContainText("Primary");
  await page.getByRole("button", { name: "Replace original file" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Jordan-replaced.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel("Full name")).toHaveValue("Jordan Candidate");
  await page.getByRole("button", { name: "Save reviewed profile" }).click();
  await expect(page.locator(".resume-tile")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Jordan-replaced.pdf/ }),
  ).toContainText("Primary");
  await page.reload();
  await page
    .getByRole("button", { name: "My resumes", exact: true })
    .first()
    .click();
  await expect(page.locator(".resume-tile")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/applydesk-resume-mobile.png",
    fullPage: true,
  });
});

test("job filters compose and mobile cards stay within the viewport", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto(origin + "/copilot.html");
  await expect(page.locator(".job-card")).toHaveCount(3);
  await page.getByLabel("Search jobs", { exact: true }).fill("Analytics");
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Work arrangement" }).click();
  await page.getByRole("option", { name: "Remote", exact: true }).click();
  await expect(page.getByText("No roles match these filters")).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Location", exact: true }).click();
  await page.getByRole("option", { name: "California", exact: true }).click();
  await expect(page.getByText("No roles match these filters")).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".job-card")).toHaveCount(3);
  await page.screenshot({
    path: "/private/tmp/applydesk-jobs-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    items: [...document.querySelectorAll("*")]
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        rect: e.getBoundingClientRect().toJSON(),
      }))
      .filter((e) => e.rect.right > innerWidth + 1 && e.rect.width > 0)
      .slice(0, 20),
  }));
  if (overflow.scroll > overflow.width) console.log(JSON.stringify(overflow));
  expect(overflow.scroll <= overflow.width).toBe(true);
});

test("default ApplyDesk choice persists and explicit custom choice is visible in employer handoff", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto(origin + "/copilot.html");
  await page
    .getByRole("button", { name: "My resumes", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Default application resume" }),
  ).toContainText("ApplyDesk resume (default)");
  await page
    .getByRole("combobox", { name: "Default application resume" })
    .click();
  await page
    .getByRole("option", { name: "Use my custom original", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Default application resume" }),
  ).toContainText("Use my custom original");
  await page.reload();
  await page
    .locator(".job-card")
    .first()
    .getByRole("button", { name: "Apply now" })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Default application resume" }),
  ).toContainText("Use my custom original");
  await expect(
    page.getByRole("button", { name: "Fix my resume" }),
  ).toBeDisabled();
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply now", exact: true })
    .click();
  await (await popup).close();
  await expect(page.locator(".application-handoff")).toContainText(
    "Custom original saved for this application",
  );
  await expect(page.locator(".application-handoff")).toContainText(
    "does not attach files",
  );
  expect(state.applications[0].resume_snapshot.source).toBe("custom");
  expect(state.applications[0].resume_snapshot.parsed_profile).toBeUndefined();
  await page
    .getByRole("button", { name: "My resumes", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Default application resume" })
    .click();
  await page
    .getByRole("option", { name: "ApplyDesk resume (default)", exact: true })
    .click();
  await page.getByRole("button", { name: "Applications", exact: true }).click();
  await expect(page.locator(".application-row")).toContainText(
    "Custom original",
  );
  expect(state.applications[0].resume_snapshot.source).toBe("custom");
});

test("an unsynced feed explains why searching and resume matching have no jobs", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.jobs.length = 0;
  state.feed.length = 0;
  await page.goto(origin + "/copilot.html");
  await expect(
    page.getByText("The job feed is waiting for its first sync", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for the first employer sync", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0 of 0 employer boards current", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No roles match these filters", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search jobs", { exact: true }).fill("Python");
  await page.getByRole("tab", { name: "For you", exact: true }).click();
  await expect(
    page.getByText("The job feed is waiting for its first sync", {
      exact: true,
    }),
  ).toBeVisible();
});

test("healthy empty feed reports eligibility limits instead of failed search", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.jobs.length = 0;
  await page.goto(origin + "/copilot.html");
  await expect(
    page.getByText("No current roles meet the H-1B requirements", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No roles match these filters", { exact: true }),
  ).toHaveCount(0);
});

test("a failed latest sync does not hide jobs that are still verified and eligible", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.feed[0].status = "failed";
  await page.goto(origin + "/copilot.html");
  await expect(page.locator(".job-card")).toHaveCount(3);
  await expect(
    page.getByText("0 of 1 employer boards current", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".feed-line .status-dot")).toHaveClass(/offline/);
});

test("software developer search finds software engineers and keeps company/skill constraints", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto(origin + "/copilot.html");
  await expect(page.locator(".job-card")).toHaveCount(3);
  await page
    .getByLabel("Search jobs", { exact: true })
    .fill("Software, Developer");
  await page.getByRole("button", { name: "Search jobs", exact: true }).click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await expect(page.locator(".job-card")).toContainText("Software Engineer");
  await expect(page.locator(".scope-row")).toContainText(
    "1 match from 3 current H-1B listings",
  );
  await page
    .getByLabel("Search jobs", { exact: true })
    .fill("SWE SQL Company C");
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page
    .getByLabel("Search jobs", { exact: true })
    .fill("software developer Company A");
  await expect(page.locator(".job-card")).toHaveCount(0);
  await expect(page.locator(".scope-row")).toContainText(
    "0 matches from 3 current H-1B listings",
  );
  await expect(
    page.getByText("No roles match these filters", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search jobs", { exact: true })
    .fill("backend developer");
  await expect(page.locator(".job-card")).toHaveCount(0);
  await page
    .getByLabel("Search jobs", { exact: true })
    .fill("Python Company A");
  await expect(page.locator(".job-card")).toHaveCount(1);
  await expect(page.locator(".job-card")).toContainText("Data Engineer");
});
