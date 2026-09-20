# Connected employer sources

The catalog is configured for **57 employer boards**: 32 Greenhouse, 18 Ashby, and 7 Lever. It covers current US roles from those employers across technical and nontechnical departments; it does not represent every US employer or opening.

## Additional boards verified on 20 September 2026

The 30 additions below were checked through their public official ATS APIs between 04:56 and 04:57 UTC. Together they returned **2,887 public records and 2,290 eligible US listings** under the existing `normalizeJob` / `isEligibleJob` rules. These are point-in-time counts, not promised future availability. Board tokens came from the linked employer recruitment pages; none were inferred through an endpoint sweep.

Eligibility preserves all sponsorship categories, requires US location evidence and a fresh source verification, and excludes closed, expired, unlisted or future-dated roles. Missing publication dates remain unknown. The sponsorship parser classified 2,286 of these listings as unverified/unknown and four as sponsorship not offered; unknown does not establish sponsorship support.

| Employer | Adapter / board | Public records | Eligible US | Token evidence | Public feed |
|---|---|---:|---:|---|---|
| Clover Health | `greenhouse` / `cloverhealth` | 67 | 56 | [Recruitment page](https://job-boards.greenhouse.io/cloverhealth?error=true) | [API](https://boards-api.greenhouse.io/v1/boards/cloverhealth/jobs?content=true) |
| Oscar Health | `greenhouse` / `oscar` | 295 | 239 | [Recruitment page](https://job-boards.greenhouse.io/oscar?error=true) | [API](https://boards-api.greenhouse.io/v1/boards/oscar/jobs?content=true) |
| InductiveHealth | `lever` / `inductivehealth` | 1 | 1 | [Recruitment page](https://jobs.lever.co/inductivehealth?location=United+States) | [API](https://api.lever.co/v0/postings/inductivehealth?mode=json) |
| Centria Healthcare | `greenhouse` / `centriahealthcare` | 42 | 42 | [Recruitment page](https://job-boards.greenhouse.io/centriahealthcare/jobs/8550323002) | [API](https://boards-api.greenhouse.io/v1/boards/centriahealthcare/jobs?content=true) |
| HealthCare.com | `lever` / `healthcare` | 5 | 5 | [Recruitment page](https://jobs.lever.co/healthcare/) | [API](https://api.lever.co/v0/postings/healthcare?mode=json) |
| Avalere Health | `lever` / `avalerehealth` | 50 | 46 | [Recruitment page](https://jobs.lever.co/avalerehealth) | [API](https://api.lever.co/v0/postings/avalerehealth?mode=json) |
| Lewis County General Hospital | `greenhouse` / `lewiscountygeneralhospital` | 40 | 40 | [Recruitment page](https://job-boards.greenhouse.io/lewiscountygeneralhospital/jobs/4337773009) | [API](https://boards-api.greenhouse.io/v1/boards/lewiscountygeneralhospital/jobs?content=true) |
| Kolmac Integrated Behavioral Health | `greenhouse` / `kolmacintegratedbehavioralhealth` | 35 | 34 | [Recruitment page](https://job-boards.greenhouse.io/kolmacintegratedbehavioralhealth/jobs/4258924009) | [API](https://boards-api.greenhouse.io/v1/boards/kolmacintegratedbehavioralhealth/jobs?content=true) |
| Compass Surgical Partners | `ashby` / `compass-surgical-partners` | 27 | 27 | [Recruitment page](https://jobs.ashbyhq.com/compass-surgical-partners/ac75a77e-eea1-40c8-b83f-b4df1e51e315) | [API](https://api.ashbyhq.com/posting-api/job-board/compass-surgical-partners?includeCompensation=true) |
| Candid Health | `ashby` / `candidhealth` | 38 | 38 | [Recruitment page](https://jobs.ashbyhq.com/candidhealth/d5267ead-522a-43fc-8cb1-f75c5503e23c) | [API](https://api.ashbyhq.com/posting-api/job-board/candidhealth?includeCompensation=true) |
| Sprinter Health | `ashby` / `sprinter-health` | 72 | 72 | [Recruitment page](https://jobs.ashbyhq.com/sprinter-health/f458fbca-6922-4e87-b1df-7416d890061f) | [API](https://api.ashbyhq.com/posting-api/job-board/sprinter-health?includeCompensation=true) |
| Midstream Health | `ashby` / `midstream` | 5 | 5 | [Recruitment page](https://jobs.ashbyhq.com/midstream/64c86ee2-ac13-4091-8a22-fe9b4372bfb6) | [API](https://api.ashbyhq.com/posting-api/job-board/midstream?includeCompensation=true) |
| Datadog | `greenhouse` / `datadog` | 453 | 217 | [Recruitment page](https://job-boards.greenhouse.io/embed/job_app?for=datadog&token=6793408) | [API](https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true) |
| OpenAI | `ashby` / `openai` | 818 | 660 | [Recruitment page](https://jobs.ashbyhq.com/openai/5d1a6c05-e18b-43a2-8808-6498929ac253/) | [API](https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true) |
| Apollo.io | `greenhouse` / `apolloio` | 47 | 32 | [Recruitment page](https://job-boards.greenhouse.io/apolloio?error=true) | [API](https://boards-api.greenhouse.io/v1/boards/apolloio/jobs?content=true) |
| Enigma | `greenhouse` / `enigmaio` | 10 | 10 | [Recruitment page](https://job-boards.greenhouse.io/enigmaio) | [API](https://boards-api.greenhouse.io/v1/boards/enigmaio/jobs?content=true) |
| InstaLILY | `greenhouse` / `instalilyai` | 19 | 15 | [Recruitment page](https://job-boards.greenhouse.io/instalilyai/) | [API](https://boards-api.greenhouse.io/v1/boards/instalilyai/jobs?content=true) |
| Palantir Technologies | `lever` / `palantir` | 313 | 238 | [Recruitment page](https://jobs.lever.co/palantir) | [API](https://api.lever.co/v0/postings/palantir?mode=json) |
| The Trade Desk | `greenhouse` / `thetradedesk` | 113 | 77 | [Recruitment page](https://job-boards.greenhouse.io/thetradedesk?field_4744161007%5B%5D=7664415007) | [API](https://boards-api.greenhouse.io/v1/boards/thetradedesk/jobs?content=true) |
| Sixfold | `greenhouse` / `sixfold` | 3 | 3 | [Recruitment page](https://job-boards.greenhouse.io/sixfold) | [API](https://boards-api.greenhouse.io/v1/boards/sixfold/jobs?content=true) |
| Redwood Materials | `greenhouse` / `redwoodmaterials` | 140 | 140 | [Recruitment page](https://job-boards.greenhouse.io/redwoodmaterials/jobs/6122148004) | [API](https://boards-api.greenhouse.io/v1/boards/redwoodmaterials/jobs?content=true) |
| Hadrian Automation | `ashby` / `hadrian-automation` | 142 | 142 | [Recruitment page](https://jobs.ashbyhq.com/hadrian-automation/e2bcd307-fb10-4a38-a657-fa1aae09c6b5) | [API](https://api.ashbyhq.com/posting-api/job-board/hadrian-automation?includeCompensation=true) |
| Xcimer Energy | `lever` / `xcimer` | 42 | 42 | [Recruitment page](https://jobs.lever.co/xcimer?commitment=Full-Time) | [API](https://api.lever.co/v0/postings/xcimer?mode=json) |
| EnergyHub | `greenhouse` / `energyhub` | 19 | 18 | [Recruitment page](https://job-boards.greenhouse.io/energyhub) | [API](https://boards-api.greenhouse.io/v1/boards/energyhub/jobs?content=true) |
| Shinola Retail | `greenhouse` / `shinolaretail` | 11 | 11 | [Recruitment page](https://job-boards.greenhouse.io/shinolaretail) | [API](https://boards-api.greenhouse.io/v1/boards/shinolaretail/jobs?content=true) |
| Four Hands | `greenhouse` / `fourhands` | 27 | 27 | [Recruitment page](https://job-boards.greenhouse.io/fourhands) | [API](https://boards-api.greenhouse.io/v1/boards/fourhands/jobs?content=true) |
| R.W. Zant | `greenhouse` / `rwzant` | 9 | 9 | [Recruitment page](https://job-boards.greenhouse.io/rwzant) | [API](https://boards-api.greenhouse.io/v1/boards/rwzant/jobs?content=true) |
| Saltbox | `greenhouse` / `saltbox` | 10 | 10 | [Recruitment page](https://job-boards.greenhouse.io/saltbox) | [API](https://boards-api.greenhouse.io/v1/boards/saltbox/jobs?content=true) |
| Piermont Bank | `greenhouse` / `piermontbank` | 14 | 14 | [Recruitment page](https://job-boards.greenhouse.io/piermontbank?error=true) | [API](https://boards-api.greenhouse.io/v1/boards/piermontbank/jobs?content=true) |
| First National Bank of America | `greenhouse` / `firstnationalbankofamerica` | 20 | 20 | [Recruitment page](https://job-boards.greenhouse.io/firstnationalbankofamerica?error=true) | [API](https://boards-api.greenhouse.io/v1/boards/firstnationalbankofamerica/jobs?content=true) |

## Employer destinations

| Host | Eligible US listings in this verification |
|---|---:|
| `job-boards.greenhouse.io` | 657 |
| `boards.greenhouse.io` | 140 |
| `jobs.ashbyhq.com` | 944 |
| `jobs.lever.co` | 332 |
| `careers.datadoghq.com` | 217 |

Datadog uses its own careers host for all 217 eligible rows. That exact host is supported by the frontend allowlist and was verified against the [official careers homepage](https://careers.datadoghq.com/) and an [API-linked job page](https://careers.datadoghq.com/detail/6572669/?gh_jid=6572669). Parent domains, arbitrary subdomains, credential-bearing URLs and lookalike suffixes are not included by this addition.

## Refresh and release

Adding a board to `companies.json` changes the next job-sync run. It does not by itself import jobs, publish the frontend, configure scheduler credentials, or prove that recurring refresh is operating. Verify the selected scheduler and `app_job_feed_status` separately. Discovery requires source verification within 24 hours; stale listings disappear until a successful refresh. Role counts and sponsorship wording can change on every run.

These public-feed checks made no applicant submissions or production database writes. The source evidence and counts above document discovery, not production import status.
