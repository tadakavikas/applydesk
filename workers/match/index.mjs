import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rest } from "../lib/supabase.mjs";

function log(step, extra) {
  console.log(
    [new Date().toISOString(), "[match]", step, extra || ""]
      .filter(Boolean)
      .join(" "),
  );
}

function tokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) => w.length > 2 && !["and", "the", "for", "with", "this"].includes(w),
    );
}

function scoreJob(client, job) {
  const hay = tokens([job.title, job.location, job.description].join(" "));
  const haySet = new Set(hay);
  const want = [
    ...new Set(tokens([client.target_role, client.skills].join(" "))),
  ];
  if (!want.length) {
    return null;
  }
  const hits = want.filter((w) => haySet.has(w)).length;
  let pct = Math.round((hits / want.length) * 100);
  if (
    client.location &&
    String(job.location || "")
      .toLowerCase()
      .includes(
        String(client.location)
          .toLowerCase()
          .split(",")[0]
          .trim()
          .toLowerCase(),
      )
  ) {
    pct = Math.min(100, pct + 10);
  }
  if (
    String(job.title || "")
      .toLowerCase()
      .includes(
        String(client.target_role || "")
          .toLowerCase()
          .split(",")[0]
          .trim()
          .toLowerCase(),
      ) &&
    client.target_role
  ) {
    pct = Math.min(100, pct + 15);
  }
  return pct;
}

export async function matchJobs() {
  const settings = await rest(
    "app_auto_apply_settings?enabled=eq.true&select=client_code,min_match_pct",
  );
  if (!settings.length) {
    log("skip", "no enabled copilot members yet");
    return { written: 0, clients: 0 };
  }

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const verified = new Date(Date.now() - 24 * 3600000).toISOString();
  const jobs = await rest(
    `app_job_pool?select=id,title,location,description&status=eq.active&country_code=eq.US&sponsorship_status=eq.explicit_h1b&date_basis=neq.unknown&posted_at=gte.${since}&last_verified_at=gte.${verified}&order=posted_at.desc&limit=1000`,
  );
  const clients = await rest(
    "app_clients?select=code,name,location,target_role",
  );
  const profiles = await rest("app_copilot_profiles?select=client_code,skills");
  const skillMap = Object.fromEntries(
    (profiles || []).map((p) => [p.client_code, p.skills]),
  );
  for (const client of clients) client.skills = skillMap[client.code] || "";
  const byCode = Object.fromEntries((clients || []).map((c) => [c.code, c]));

  let written = 0;
  for (const setting of settings) {
    const client = byCode[setting.client_code];
    if (!client) {
      log("FAIL", `missing client row ${setting.client_code}`);
      continue;
    }
    const minPct = Number(setting.min_match_pct || 50);
    const rows = [];
    for (const job of jobs) {
      const match_pct = scoreJob(client, job);
      if (match_pct === null || match_pct < minPct) continue;
      rows.push({
        client_code: client.code,
        job_id: job.id,
        match_pct,
      });
    }
    if (!rows.length) {
      log("ok", `${client.code}: 0 matches above ${minPct}%`);
      continue;
    }
    try {
      await rest("app_job_matches?on_conflict=client_code,job_id", {
        method: "POST",
        body: rows,
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
      written += rows.length;
      log("ok", `${client.code}: ${rows.length} candidate matches`);
    } catch (err) {
      log("FAIL", `${client.code}: ${err.message}`);
    }
  }

  log(
    "done",
    `written=${written} clients=${settings.length} jobs=${jobs.length}`,
  );
  return { written, clients: settings.length };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  matchJobs().catch((err) => {
    console.error("[match] fatal", err);
    process.exit(1);
  });
}
