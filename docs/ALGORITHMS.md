# Algorithms

Every formula as implemented, with its settings keys and tests. The specification is CLAUDE.md §8; this file records what the code actually does. Update it in the same commit as the code it describes.

All algorithms live in `packages/algorithms` and are pure: no I/O, no clock, no unseeded randomness. Settings values are passed in as arguments (CLAUDE.md §10.7).

## How to add an entry

```markdown
### <Name>

- Code: `packages/algorithms/src/<folder>/<file>.ts`
- Formula: …
- Settings: `<key>` (default …)
- Tests: `packages/algorithms/src/<folder>/<file>.test.ts`
- Spec: CLAUDE.md §8 F<n>
```

## Statistics

### Mean, deviation and percentiles

- Code: `packages/algorithms/src/stats/basic.ts`
- Formula: `mean = Σx / n` (0 for an empty list); `clamp(x, lo, hi) = min(hi, max(lo, x))` (NaN maps to `lo`); population standard deviation `σ = sqrt(Σ(x − mean)² / n)`; coefficient of variation `σ / mean` (0 when the mean is 0); `percentile(values, p)` interpolates linearly at rank `p·(n − 1)` of the sorted values; `percentileRank(samples, x) = (count below + half the count equal) / n`
- Settings: none
- Tests: `packages/algorithms/src/stats/basic.test.ts`
- Spec: CLAUDE.md §2.1

## Time

### Local clock

- Code: `packages/algorithms/src/time/local.ts`
- Formula: the hour (0–23) and weekday of an instant as a wall clock in an IANA timezone shows them, daylight-saving shifts included, read through `Intl.DateTimeFormat` (the runtime's timezone database, no dependency). `weekdayOfDate` gives the weekday of a `YYYY-MM-DD` calendar date.
- Settings: none
- Tests: `packages/algorithms/src/time/local.test.ts` (offsets across midnight, both New York daylight-saving changes of 2026, unknown zones)
- Spec: CLAUDE.md §8 F1 steps 1–3, §10.9

## Persona (Dev Card)

### Rhythm metrics

- Code: `packages/algorithms/src/persona/metrics.ts`
- Formula:
  - event weight = commits of a push, capped at 20; 1 for any other event
  - `hourHist[h]` = weight at local hour `h` ÷ total weight (all zeros without events)
  - `nightShare` = sum over hours 22, 23, 0, 1, 2, 3; `morningShare` = sum over hours 5–8
  - `weekendShare` = contributions on Saturday and Sunday ÷ all contributions in the window
  - `activeDayShare` = days with a contribution ÷ days in the window
  - `cv` = coefficient of variation of the daily counts in the window
  - `longestStreak` = longest run of consecutive days with a contribution
- Settings: none; the windows (90 and 365 days) are chosen by the caller
- Tests: `packages/algorithms/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1 steps 2–4

### Labels, activity score and companion stage

- Code: `packages/algorithms/src/persona/labels.ts`
- Formula:
  - a label applies when its metric ≥ its threshold; strength = metric ÷ threshold; at most three labels, strongest first; nobody above a threshold is `balanced`. A threshold of zero or less disables its label.
  - activity score = percentile rank of the year's contributions among recorded samples; before enough samples exist, `min(1, log10(1 + x) / log10(1 + ref))`
  - stage = index of the first `companion.stageCuts` value above the activity score
- Settings: `persona.nightOwl.share` (0.35), `persona.earlyBird.share` (0.30), `persona.weekendWarrior.share` (0.40), `persona.sprinter.cv` (1.5), `persona.marathoner.activeDayShare` (0.5), `companion.activityRef` (1000), `companion.stageCuts` ([0.25, 0.5, 0.75, 0.9])
- Tests: `packages/algorithms/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1 steps 7–9

### Language shares and skill tags

- Code: `packages/algorithms/src/persona/skills.ts`
- Formula:
  - language share = bytes of the language across non-fork repositories ÷ all bytes; the top six are kept and the rest summed as `other`
  - tag weight = repositories whose dependencies carry the tag + repositories that list it as a topic, divided by the largest such weight; the top twelve are kept. Ties are broken by name.
- Settings: none
- Tests: `packages/algorithms/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1 steps 5–6

### Dev Card assembly

- Code: `packages/core/src/persona/service.ts` (`buildDevCard`, `resolveTimezone`, `recordPersonaSamples`), job `analyze_profile` in `packages/core/src/persona/jobs.ts`
- Formula, in order:
  1. Timezone: a member's profile timezone; else the timezone of their geocoded location once `geocode_cache` has resolved it; else UTC. The card states which one was used.
  2. Hour histogram over the public events (the last 90 days GitHub exposes), in that timezone.
  3. Rhythm metrics over the last 90 days of the contribution calendar; longest streak over 365 days.
  4. Labels only when the account has at least `persona.minEvents` events; thresholds from settings.
  5. Language shares with Linguist colors; skill tags from `package_meta.derived_tags` of the dependencies plus repository topics.
  6. Activity score: percentile rank of the yearly total among `contrib.total365` samples once that metric holds `min_sample` of `companion.stageCuts` samples; before that the logarithmic fallback.
  7. Companion: seed = GitHub id; species key = top skill tag, else top language, else the login (the species number is derived from the key where the companion is drawn); palette = the top language's color; stage from `companion.stageCuts`.
  8. Anonymous samples: `contrib.total365` always; the five `persona.*` shares only when step 4 had enough events. One person counts once per salt period.
- Settings: `persona.minEvents` (15), the label thresholds above, `companion.activityRef` (1000), `companion.stageCuts`, `cache.devCardTtlHours` (12), `privacy.nonUserRawTtlHours` (24), `persona.manifestRepos` (10), `github.maxReposPerProfile` (100)
- Tests: `packages/core/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1

### Member profiles: visibility and badges

- Code: `packages/core/src/profiles/visibility.ts`, `packages/core/src/profiles/badges.ts`, page `apps/web/src/app/u/[login]/page.tsx`
- Visibility: the member always sees their own page; `public` anyone; `university` verified members of the same university; `country` verified members of a university in the same country (the countries of the two universities compared; the same university always counts, a missing country never matches); `hidden` nobody else; suspended or hidden-for-review accounts nobody else. A page someone may not see answers 404, like a missing one.
- Badges: reviewer (at least one helpful review, with its reputation tier), reviver (taking part in a revived adoption as adopter or owner), streak (a shared streak whose longest run reached the first value of `streaks.companionStageDays`), open source (merged pull requests to other people's projects, from `oss_member_contribs`); each gives the companion trait of the same name on the member's Dev Card (`mentor` arrives with F20)
- Page: badges, revived projects and showcased projects (linking to Senior's Legacy for members of the same university), above the Dev Card
- Settings: `streaks.companionStageDays`, `reviews.reputationTierCuts`
- Tests: `packages/core/src/profiles/visibility.test.ts`, `packages/core/src/profiles/badges.test.ts`, `e2e/profile.spec.ts` (every visibility level against a classmate, a member in the same country, one abroad and a visitor)
- Spec: CLAUDE.md §8 F1 "Privacy", §9.5, P5-T10

## Similarity

### Cosine, Jaccard and histogram intersection

- Code: `packages/algorithms/src/similarity/similarity.ts`
- Formula: `cosine(a, b) = Σ a_k·b_k / (|a|·|b|)` over sparse vectors (0 when either is empty); `jaccard(A, B) = |A ∩ B| / |A ∪ B|` (0 when both are empty); `intersection(h, g) = Σ min(h_i, g_i)` for normalized histograms
- Settings: none
- Tests: `packages/algorithms/src/compat/compat.test.ts`
- Spec: CLAUDE.md §2.1, §8 F2

### Compatibility Check

- Code: `packages/algorithms/src/compat/compat.ts`; orchestration in `packages/core/src/compat/` (job `compat_check`)
- Formula:
  - skill = cosine of the two vectors `lang:<name> → share` ∪ `tag:<tag> → weight`
  - interest = Jaccard of (own repository topics ∪ topics of up to `matching.starCap` most recently starred repositories)
  - rhythm = histogram intersection of the two UTC hour histograms
  - complement = mean of `|a[t] − b[t]|` over the union of each person's top ten tags
  - a component is `null` when one side has nothing to compare (no languages or tags, no topics, no activity, no tags)
  - score = `round(100 × Σ w_k·c_k / Σ w_k)` over the non-null components (weights re-normalized); band = the highest `compat.bands` entry whose `min` ≤ score
  - explanations: up to three shared tags (by the smaller of the two weights), up to three repositories both starred, the longest run of hours (wrapping midnight) where both are above their own median hour, and the tag where each is strongest relative to the other
- Settings: `compat.weights` ({skill 0.3, interest 0.25, rhythm 0.2, complement 0.25}), `compat.bands`, `matching.starCap` (200), `cache.compatTtlHours` (12)
- Tests: `packages/algorithms/src/compat/compat.test.ts`, `packages/core/src/compat/compat.test.ts`
- Spec: CLAUDE.md §8 F2

## Recruiter-Ready Score

### Rules, credit and score

- Code: `packages/algorithms/src/recruiter/rules.ts` and `text.ts`; orchestration in `packages/core/src/recruiter/` (job `recruiter_report`)
- Formula:
  - showcase = the pinned repositories the person owns; when there are none, the top `recruiter.pinned.max` by stars (the report says so)
  - `profileReadme` 1 when the `<login>/<login>` README has at least `recruiter.profileReadme.minChars` characters; `pinnedCount` 1 inside [`recruiter.pinned.min`, `recruiter.pinned.max`], 0.5 for exactly one, else 0; `pinnedReadme`, `pinnedDemo` (homepage, or a README link outside GitHub — images and github.com links do not count, GitHub Pages does), `pinnedLicense`, `pinnedDescription`, `pinnedTopics` are shares of the showcase
  - `commitMessages` = share of push messages (subject line, lowercased, issue references removed) with at least `recruiter.minMessageTokens` words that are not among the `recruiter.genericMessageTopK` most frequent short messages in `generic_message_counts`
  - `unfinishedRatio` = 1 − share of showcased repositories whose unfinished score is at least 0.5; unfinished score = mean of the README signal (an unfinished term as a whole word, or an unchecked task) and the share of that repository's recent commit messages with an unfinished term. The issue and release signals of F7 join in P2-T14.
  - `languageMatch` (only with claimed skills) = share of claimed skills, normalized through topic aliases, found among the person's languages and skill tags
  - `activityConsistency` = min(1, activeDayShare ÷ `persona.marathoner.activeDayShare`)
  - score = round(100 × Σ weight·credit ÷ Σ weight) over the rules that apply and have a positive weight in `recruiter.weights`
- Short messages (at most `recruiter.minMessageTokens + 2` words) are counted once per analysis in `generic_message_counts`, with no link to any person.
- Settings: `recruiter.weights`, `recruiter.pinned.min` (2), `recruiter.pinned.max` (6), `recruiter.readme.minChars` (600), `recruiter.profileReadme.minChars` (200), `recruiter.minMessageTokens` (3), `recruiter.genericMessageTopK` (50), `graveyard.unfinishedTerms`, `persona.marathoner.activeDayShare`, `cache.recruiterTtlHours` (24)
- Tests: `packages/algorithms/src/recruiter/recruiter.test.ts`, `packages/core/src/recruiter/recruiter.test.ts`
- Spec: CLAUDE.md §8 F3

## Group Fairness Report

### People, lines and team metrics

- Code: `packages/algorithms/src/fairness/fairness.ts`; assembly in `packages/core/src/fairness/service.ts`, job `fairness_report` in `jobs.ts`
- Formula:
  - people: accounts from `/stats/contributors` (merge and empty commits already excluded by GitHub); people without an account from the latest `fairness.maxCommits` commits, keyed by a hash of their email (the address is never stored)
  - per-commit detail is read only where it changes the answer: every commit when the repository has excluded paths or no statistics (more than 10,000 commits), otherwise only commits by people without an account and co-authored commits; reading continues across runs
  - excluded paths: Linguist vendored and documentation rules, plus `.gitattributes` patterns that set `linguist-vendored`, `linguist-generated` or `linguist-documentation`; their lines are subtracted from statistics totals and left out of per-commit totals
  - each `Co-authored-by` trailer gives the co-author one commit credit and an equal share (1 ÷ (co-authors + 1)) of that commit's lines, taken from the author
  - Gini `G = Σ_i Σ_j |x_i − x_j| / (2 n² x̄)`; least-share ratio = smallest share ÷ (1 / n); flagged below `fairness.leastShareThreshold`; bots are left out unless included
  - late share = a person's commits in the final `fairness.lateWindowPct` of the team's active weeks (rounded up) ÷ their commits
  - identity merge (in the browser): counts, lines and weeks add up into the identity that stays; chains are followed, cycles ignored
- Settings: `fairness.leastShareThreshold` (0.14), `fairness.lateWindowPct` (0.15), `fairness.maxCommits` (500), `fairness.statsRetryMax` (6), `cache.fairnessTtlHours` (24)
- Known limits: statistics cover the whole history while per-commit detail covers the latest `fairness.maxCommits` commits, so exclusions and co-author shares apply to that window.
- Tests: `packages/algorithms/src/fairness/fairness.test.ts`, `packages/core/src/fairness/fairness.test.ts`
- Spec: CLAUDE.md §8 F4

## Taxonomy

### Term expansion

- Code: `packages/algorithms/src/taxonomy/taxonomy.ts`; orchestration in `packages/core/src/taxonomy/service.ts` (`computeExpansion`, `getCachedExpansion`), job `taxonomy_expand`
- Formula:
  - term: lowercase, trimmed, spaces collapsed; slug = spaces → hyphens; fewer than two characters is rejected
  - seeds from github/explore: the topic named by the slug or by one of its aliases (score 1), its aliases (1) and its related topics (0.5)
  - sample: GitHub repository search `<term> in:name,description,readme`, then `topic:<slug>` when the topic exists, up to `taxonomy.sampleSize` repositories; dependencies from the manifests of the top 30
  - `sampleFreq(x)` = share of sampled repositories with `x`; topics keep `sampleFreq ≥ taxonomy.minSampleFreq` and get GitHub's `topic:x` total (cached `cache.topicCountTtlDays`); dependencies use our own `repo_dependencies` once it covers `taxonomy.minCorpus` repositories, and the sample share alone before that
  - `score(x) = sampleFreq(x) × log(1 + maxGlobal / globalCount(x))`, with `maxGlobal` the largest count among this term's candidates of the same kind (topic totals and corpus counts are on different scales)
  - keep the top `taxonomy.maxExpansions` by score, after all seeds; cache for `cache.taxonomyTtlDays`
- Runs that reach the deadline return `partial`; topic counts and manifests already read are stored, so the follow-up finishes quickly.
- Tests: `packages/algorithms/src/taxonomy/taxonomy.test.ts`, `packages/core/src/taxonomy/taxonomy.test.ts`
- Spec: CLAUDE.md §8 F6

## Project Graveyard

### Unfinished score, revivability and difficulty

- Code: `packages/algorithms/src/graveyard/graveyard.ts` (with the text signals in `recruiter/text.ts`); pipeline in `packages/core/src/graveyard/` (job `graveyard_search`)
- Formula:
  - candidates (global scope): up to three GitHub searches — the term in name, description and README, the term's own topic, and the next expansion topic — each with `fork:false pushed:<cutoff` (cutoff = today − `graveyard.idleMonths.default` months), up to 100 repositories; relevance falls from 1 by search order
  - category = the first expansion topic the repository carries, else the term's slug; idle threshold = `graveyard.idleMonths.<category>` once the recompute job has created it, else the default
  - filters: not a fork, has a README, commit estimate (contributors list including anonymous authors) at least `graveyard.minCommits`, idle at least the category threshold
  - unfinished u = mean of: README unfinished term or unchecked task (0/1); share of the latest 10 open issues nobody has answered; share of the latest 10 commit messages with an unfinished term; no releases or tags (0/1); then −0.25 with releases or tags, −0.25 when all of more than 5 issues are closed, −0.15 with a usage or installation heading; clamped to [0, 1]
  - promise = log10(1 + stars + 2·forks); demand = log10(1 + open issues + stars since the last push, read only for the top `graveyard.deepScoreTopN`); both min–max normalized within the set; freshness 1 within `graveyard.freshMonths`, else 0.5; legal 1 with a license, else `graveyard.noLicenseFactor`
  - revivability = (wP·promise_n + wD·demand_n + wU·u + wF·freshness) × legal with `graveyard.weights`; rank = relevance × revivability
  - difficulty: "weekend fix" below the set's median size and open issues with u < 0.5; "needs a maintainer" above the set's 75th percentile of stars and of open issues; "half-built idea" u ≥ 0.5 below median size
- Repository signals are cached per repository for `cache.searchTtlHours`, so continuations and overlapping searches reuse them.
- Deviations: the open-issue signal counts issues with no comment at all (certainly none from the owner) instead of reading each issue's comments; push-gap samples for `graveyard.idleMonths.<category>` are recorded from the country index (P6-T03), since the global search only returns inactive repositories.
- Settings: `graveyard.idleMonths.default` (6), `graveyard.minCommits` (5), `graveyard.freshMonths` (24), `graveyard.noLicenseFactor` (0.3), `graveyard.deepScoreTopN` (50), `graveyard.weights`, `graveyard.unfinishedTerms`, `cache.searchTtlHours` (6)
- Tests: `packages/algorithms/src/graveyard/graveyard.test.ts`, `packages/core/src/graveyard/graveyard.test.ts`
- Spec: CLAUDE.md §8 F7

## Gap Finder

### Facets, peers and prevalence

- Code: `packages/algorithms/src/gap/gap.ts`; facets and the job in `packages/core/src/gap/` (job `gap_analysis`)
- Formula:
  - facets of a repository: every root entry as `dir:<name>` or `file:<name>` (lowercased), `dir:.github/workflows` when it has files, `tag:<t>` for each derived tag of its dependencies, and `meta:license`, `meta:homepage`, `meta:releases`, `meta:topics`, `meta:description`; stored in `repo_paths` and `repo_dependencies`, cached per repository for `cache.gapTtlHours`
  - peers: GitHub searches for the repository's topics (widened with the taxonomy of the first) and up to three dependency tags as topics, each with `stars:>=gap.minPeerStars`, pushed within a year, not a fork, and the same primary language; a repository without topics or tags is compared by its name; up to `gap.peerSampleSize`, never the repository itself
  - p(f) = share of peers with facet f; expected when p(f) ≥ `gap.minPrevalence`; gaps = expected facets the repository lacks, by p(f), top `gap.maxGaps`, each with three example peers by stars; shared = expected facets it already has
  - labels: a path shows itself, plus the GitHub topic whose slug or alias matches its name without extension (`dockerfile` → Docker); tags show the topic's display name
  - low confidence when fewer than a third of `gap.peerSampleSize` peers were found
- Settings: `gap.peerSampleSize` (30), `gap.minPrevalence` (0.5), `gap.maxGaps` (8), `gap.minPeerStars` (10), `cache.gapTtlHours` (24), `unlock.gapCampus.minMembers` (10, campus panel)
- Tests: `packages/algorithms/src/gap/gap.test.ts`, `packages/core/src/gap/gap.test.ts`
- Spec: CLAUDE.md §8 F5

### Who at your uni can help (campus layer)

- Code: `packages/core/src/gap/campus.ts`, panel in `apps/web/src/components/gap/GapCampusPanel.tsx`
- A gap's skill: a dependency tag's name, or the topic a path matches; repository properties have none
- Helpers: for a signed-in, verified member at a university with `unlock.gapCampus.minMembers` verified members, the members there whose teaching level in the skill (the Skill Swap's percentile rank of skill-vector weights within the university, everyone with a vector counted) reaches `swap.minTeachLevel`, best first, at most `gap.helpersPerGap`; never the member, never hidden or ghost-mode members, never across a block. Skills are matched in the vocabulary's spelling and returned under the spelling asked for.
- Ask: a message request with `context_kind = 'gap'` and the repository as `context_id`, allowed only to someone the member's own panel lists for that skill; the first message is prefilled from the gap and editable; the chat rules apply
- Settings: `unlock.gapCampus.minMembers` (10), `swap.minTeachLevel` (0.5), `gap.helpersPerGap` (3), `gap.maxGaps`
- Tests: `packages/core/src/gap/campus.test.ts`, `apps/web/src/components/gap/gap-campus.test.tsx`
- Spec: CLAUDE.md §8 F5 step 7

## Open-Source Starter

### Responsiveness, gates and rank

- Code: `packages/algorithms/src/oss/oss.ts`; job `oss_search` in `packages/core/src/oss/jobs.ts`
- Formula:
  - languages: picked (up to 3), or the top 3 of the person's Dev Card; topics: picked ones widened with the taxonomy, plus the person's skill tags
  - search per language: `is:issue is:open no:assignee archived:false -linked:pr language:"<L>" label:"<term>",…` with every `oss.beginnerLabelTerms`, two pages at most
  - per project (cached `cache.searchTtlHours`): pushed within `oss.maxRepoIdleDays`; beginner labels from its label list; responsiveness = median hours from creation to the first comment by an owner, member or collaborator over the latest `oss.responsivenessSample` issues opened by others (an unanswered issue counts as the hours it has waited); read from the repository's issue list and its latest 100 issue comments, two requests per project
  - gates: comments ≤ `oss.maxComments`, responsiveness ≤ `oss.maxResponseHours`; with nothing left, comments are relaxed first, then responsiveness, and the page says which
  - rank = 0.5·skillMatch + 0.3·exp(−ageDays/30) + 0.2·(1 − medianHours / `oss.maxResponseHours`), skillMatch = share of the person's languages and topics the project covers
  - each project's median is an anonymous `oss.responseHours` sample, counted once per project, for the computed `oss.maxResponseHours`
- Settings: `oss.beginnerLabelTerms`, `oss.maxRepoIdleDays` (60), `oss.maxResponseHours` (168), `oss.maxComments` (3), `oss.responsivenessSample` (20), `cache.searchTtlHours`
- Tests: `packages/algorithms/src/oss/oss.test.ts`, `packages/core/src/oss/oss.test.ts`
- Spec: CLAUDE.md §8 F8

### Members who contributed here (campus layer)

- Code: `packages/core/src/oss/campus.ts` (job `member_oss_contribs`, weekly on Tuesday 05:00 UTC, one refresh per verified member and week: `oss-contribs:<userId>:<week Monday>`), queries in `packages/db/src/queries/oss.ts`
- Refresh: a paced issue search `is:pr is:merged author:<login>` with the member's own token when valid, `oss.memberContribPages` pages of 100; pull requests to the member's own repositories are left out; per project the count and the latest merge time (merge time, else close time) replace the member's previous rows
- Panel: for a signed-in verified member, each project in the results lists the verified, active members of their university with merged pull requests there, most merged first (then most recent), at most `oss.campusContributorsPerRepo`; never the viewer, never hidden or ghost-mode members, never across a block. Projects are matched case-insensitively and returned under the names asked for.
- Ask: a message request with `context_kind = 'oss'` and the project as `context_id`, only to someone listed for that project; the first message is prefilled and editable; the chat rules apply
- Settings: `oss.memberContribPages` (1), `oss.campusContributorsPerRepo` (3)
- Tests: `packages/core/src/oss/campus.test.ts`, `apps/web/src/components/oss/oss-campus.test.tsx`
- Spec: CLAUDE.md §8 F8 step 5

## Senior's Legacy

### Library, search and refresh

- Code: `packages/core/src/legacy/service.ts` (job `legacy_refresh`, weekly on Wednesday 06:00 UTC, continuing across runs), queries in `packages/db/src/queries/legacy.ts`, excerpts by `markdownExcerpt` in `packages/algorithms/src/text/markdown.ts`
- Entries: a verified member showcases one of their own non-fork repositories with an optional blurb (at most `legacy.blurbMaxChars`) and whether they take questions; tags = the repository's topics plus its dependencies' derived tags, normalized; the graduation year is the member's. FYP projects join with F22 (P6-T07).
- Unlock: entries of active members whose profile is not hidden count toward `unlock.legacy.minProjects`
- Search: entries at the member's university from active, not hidden owners, never across a block. A query matches the repository's search text or the blurb (`websearch_to_tsquery`, `simple`), or entries whose tags share a topic of the query's cached taxonomy expansion (an uncached query is queued for expansion and searched by its words); relevance = text rank + shared topics. Filters: tag, graduation-year range, department. Sort: relevance (then stars) or stars.
- Labels: alumni by role; seniors when the graduation year is at most this year + `legacy.minGradYearsAgo`; others by year
- Detail: the README's start as plain text (fenced code, HTML, images and link targets removed), at most `legacy.excerptChars`; only members of the entry's university, never across a block
- Ask the author: a message request with `context_kind = 'legacy'` when the author takes questions; alumni with questions off are reached through Alumni Quick Asks once F20 exists (P6-T05)
- Page: `/legacy` (search form as URL parameters, cards with the owner's companion, a tag links to that tag's results) and `/legacy/<id>` (excerpt, language, tags, Ask); the excerpt is skipped when GitHub cannot be read
- Refresh: each entry's repository is read again by id; private, deleted, or transferred away from the owner → the entry leaves; otherwise its metadata and tags are updated
- Settings: `unlock.legacy.minProjects` (5), `legacy.minGradYearsAgo` (0), `legacy.blurbMaxChars` (280), `legacy.excerptChars` (600), `legacy.listLimit` (50)
- Tests: `packages/core/src/legacy/legacy.test.ts`, `packages/algorithms/src/text/markdown.test.ts`
- Spec: CLAUDE.md §8 F17

## Country crawler

### Seeds, cursors and the index

- Code: `packages/core/src/crawler/service.ts` (jobs `crawl_country`, every five minutes at priority CRAWL, and `crawl_repos` per new account, `crawl-repos:<githubId>:<month>`), queries in `packages/db/src/queries/crawler.ts`
- Seeds: the countries of universities with verified members, and the cities of members' resolved GitHub locations with at least `crawler.minCitySeedMembers` members; each seed is one cursor per country, `location:"<seed>"`
- Ranges: a seed's first cursor covers account creation from `crawler.earliestAccountDate` to today; when nothing waits, each seed gets one more cursor from the day after its latest covered day to today, so new accounts are found
- Splitting: a cursor's first page with a total above `crawler.searchCap` splits the range into two halves (the parent is done); a single day that is still too large is crawled up to the cap
- Paging: 100 accounts per search page; the cursor is done (with `crawled_at`) when the reachable results (the total, at most the cap) are read or a page comes back short
- Index: accounts are stored with only login and id, flagged `in_country_index` with the cursor's country; an opted-out login is never stored; tool analyses never give indexed rows an expiry
- Repositories: per new account, one page of its own public non-fork repositories (at most `crawler.reposPerUser`), metadata only; an account GitHub no longer has leaves the index with its repositories
- Storage guard: before each step and each repository fetch, at `crawler.maxUsers` accounts or `crawler.maxRepos` repositories the index is pruned to `crawler.pruneTargetPct` of both (repositories fetched longest ago with the fewest stars first, then accounts fetched longest ago with the fewest followers, with their repositories), and nothing is added in that step; members' rows are never pruned
- Refresh: a crawled cursor older than `crawler.refreshDays` is crawled again from its first page
- Opt-out: `/optout` (public, linked from the footer, rate-limited per hashed address like the tools) takes any GitHub login; the login is recorded and its index rows are deleted at once. It only removes data, so it needs no proof of ownership; members' own rows are never touched.
- Admin: `/admin/crawler` shows the index size against `crawler.maxUsers` and `crawler.maxRepos`, the date ranges by status, the number of seeds and opt-outs
- Settings: `crawler.searchCap` (1000), `crawler.maxUsers` (50000), `crawler.maxRepos` (200000), `crawler.reposPerUser` (30), `crawler.minCitySeedMembers` (2), `crawler.refreshDays` (30), `crawler.pruneTargetPct` (0.95), `crawler.earliestAccountDate` (2008-01-01)
- Tests: `packages/core/src/crawler/crawler.test.ts`
- Spec: CLAUDE.md §8 F18

## Information retrieval

### YAKE keyphrases

- Code: `packages/algorithms/src/ir/yake.ts`
- Formula (YAKE!, Campos et al. 2020, scoring as in the reference implementation 0.4.8):
  - word tags: `d` number, `u` unparsable (letters and digits mixed, or more than one punctuation mark), `a` all capitals, `n` capitalized and not first in its sentence, `p` otherwise; words ending in "s" longer than three letters are folded into their singular
  - a term is a stopword when it is in the language's stopword list or shorter than three characters without punctuation
  - per term: WCase = max(TF_a, TF_n) / (1 + ln TF); WPos = ln(ln(3 + median sentence index)); WFreq = TF / (mean + σ of non-stopword TFs); WRel = (0.5 + DL/WL · TF/maxTF) + (0.5 + DR/WR · TF/maxTF) over a one-word co-occurrence window (D distinct neighbours, W their counts); WSpread = sentences with the term / sentences; H = WPos·WRel / (WCase + WFreq/WRel + WSpread/WRel)
  - candidates: n-grams up to `fyp.yake.ngramMax` words within a punctuation-free run, not starting or ending with a stopword, never containing a `u` or `d` word in every occurrence; S = Π H / (TF · (1 + Σ H)), where a stopword inside contributes (2 − p) to the product and −(1 − p) to the sum, p = P(left→stop)·P(stop→right)
  - lower is better; candidates with normalized Levenshtein similarity above 0.8 to a kept one are dropped; top `fyp.yake.maxKeyphrases`
- Tokenization differs from the reference (simple rules instead of segtok); see ADR-005.
- Tests: `packages/algorithms/src/ir/yake.test.ts` against reference outputs in `__fixtures__/yake/reference.json`
- Spec: CLAUDE.md §8 F9 step 1

### BM25

- Code: `packages/algorithms/src/ir/bm25.ts`
- Formula: score(q, d) = Σ_t idf(t) · tf·(k1 + 1) / (tf + k1·(1 − b + b·|d|/avgdl)); idf(t) = ln(1 + (N − n(t) + 0.5)/(n(t) + 0.5)); tokens are lowercased words without stopwords
- Settings: `ir.bm25.k1` (1.2), `ir.bm25.b` (0.75)
- Tests: `packages/algorithms/src/ir/bm25.test.ts`
- Spec: CLAUDE.md §8 F9 step 3

### FYP idea similarity

- Code: job `fyp_check` in `packages/core/src/fyp/jobs.ts` (uses `yake` and `bm25`)
- Formula:
  - language: the synced stopword list that shares the most words with the idea (English when nothing overlaps)
  - keyphrases: YAKE over "title\ndescription", top `fyp.yake.maxKeyphrases`
  - searches (search pacer): the top 3 keyphrases quoted together, then the pairs (1, 2) and (1, 3), each `in:name,description,readme`; unique repositories in result order
  - for the first `fyp.searchTopN` results: repository name, description and raw README, truncated together to 20,000 characters
  - BM25 of the idea against each README, with the idea itself added to the corpus; similarity % = min(100, round(100 · score / score(idea, idea)))
  - bands from `fyp.bands` [40, 70]: below 40 loosely related, 40–69 related, 70 and above very similar
  - shared keyphrases = the idea's keyphrases that YAKE also finds in the README (case-insensitive); unique = the idea's keyphrases found in none of the 5 most similar READMEs
- Settings: `fyp.yake.maxKeyphrases` (10), `fyp.yake.ngramMax` (3), `fyp.searchTopN` (20), `fyp.bands`, `ir.bm25.k1`, `ir.bm25.b`, `cache.searchTtlHours`
- The university-first list (step 6) arrives with the FYP corpus in P6-T07.
- Tests: `packages/core/src/fyp/fyp.test.ts`
- Spec: CLAUDE.md §8 F9

TF-IDF arrives in P4-T02.

## Computed settings

### Nightly recompute

- Code: `packages/core/src/settings/recompute.ts` (registrations), `packages/db/src/settings/recompute.ts` (`metricPercentile`, `metricQuantiles`); job `recompute_settings`
- Formula: each key below is written as `computed_value` with its sample count; it takes effect once the count reaches the key's `min_sample` (200), and a history row is written when it moves by more than `settings.historyMinDelta`
  - `persona.nightOwl.share`, `persona.earlyBird.share`, `persona.weekendWarrior.share`, `persona.sprinter.cv`, `persona.marathoner.activeDayShare` = the `persona.percentile` (0.8) of `persona.nightShare`, `persona.morningShare`, `persona.weekendShare`, `persona.cv`, `persona.activeDayShare`
  - `companion.stageCuts` = quantiles of `companion.activityScore` at the seeded default cuts (0.25, 0.5, 0.75, 0.9), so each stage keeps the share of people the defaults describe
  - `oss.maxResponseHours` = p60 of `oss.responseHours` (one sample per project)
  - `recruiter.readme.minChars` = p40 of `recruiter.readmeChars`, rounded; a sample is the README length of a showcased repository with at least `recruiter.readme.sampleMinStars` stars, one per repository
  - not yet: `graveyard.idleMonths.<category>` (push-gap samples arrive with the country index, P6), `matching.weights` and `streaks.companionStageDays` (P4)
- Settings: `persona.percentile`, `recruiter.readme.sampleMinStars` (10), `settings.historyMinDelta`
- Tests: `packages/core/src/settings/recompute.test.ts`
- Spec: CLAUDE.md §5.5, §5.5.1

## Metrics

### Tool usage and conversion

- Code: `packages/db/src/queries/metrics.ts`, `packages/core/src/metrics/service.ts`; page `/admin/metrics`
- Formula: runs per tool in the last 7 and 30 days; conversion = anonymous runs 1–30 days old whose `converted_user_id` is set ÷ all such runs; a new member's first sign-in sets `converted_user_id` on anonymous runs of the previous 24 hours with the same daily IP hash; fairness reports per ISO week (Monday, UTC) for 8 weeks
- Tests: `packages/core/src/metrics/metrics.test.ts`
- Spec: CLAUDE.md §1.7

## Matching

### Skill vectors

- Code: `packages/algorithms/src/matching/tfidf.ts` (`tfidfVectors`, `l2Normalize`, `topTags`, `mergeMax`); `packages/core/src/matching/vectors.ts` (jobs `compute_skill_vector`, `refresh_skill_vectors`)
- Formula:
  - base tf(t): the member's Dev Card language shares and skill tags, normalized through topic aliases; when both name a tag, the larger weight
  - w(t) = tf(t) × ln(1 + N / df(t)), N = verified members of the university with a vector, df(t) = those whose base has t; then L2-normalized
  - `top_tags` = the 12 heaviest, ties alphabetical
  - interests = topics of owned repositories and of up to `matching.starCap` most recently starred ones, normalized
  - every member of the university is reweighted when one member's base changes, because df moves
- Triggers: verification (email or vouches), each sign-in (at most once a day per member), and weekly for vectors older than `matching.vectorRefreshDays`
- Settings: `matching.starCap`, `matching.vectorRefreshDays` (7)
- Tests: `packages/algorithms/src/matching/tfidf.test.ts` (hand-computed three-member university), `packages/core/src/matching/vectors.test.ts`
- Spec: CLAUDE.md §8 F11 "Vectors"

### Scoring and daily decks

- Code: `packages/algorithms/src/matching/match.ts`, `packages/algorithms/src/stats/random.ts`; job `match_daily` in `packages/core/src/matching/daily.ts`
- Formula:
  - sim = cosine of TF-IDF vectors; int = Jaccard of interest sets
  - comp = mean over the member's goals of min(1, candidate weight ÷ candidate's max weight); without learning goals, the university's 20 strongest tags (sum of members' vectors) minus the member's own top tags stand in
  - score = weights of the mode (`matching.weights`: study, teammate, explore) · (sim, int, comp)
  - only pairs sharing a tag, an interest or a covered goal are scored
  - decks (nightly, per university with at least `unlock.matching.minMembers` verified members): members are served in a seeded random order (mulberry32 seeded by FNV-1a of `day:university`); the three modes take turns picking their best remaining candidate up to `matching.deckSize` each; a candidate appears once per member per day and at most `matching.maxDailyImpressions` times across all decks
  - excluded: blocks either way, existing connections, ghost mode or hidden profiles (as candidates), suspended or hidden-pending-review accounts, unverified members
  - explanations: up to 3 shared top tags, up to 3 goals the candidate covers, the number of shared interests
- Rhythm overlap: computed when Discover shows a card, from both members' persona snapshots (below), not stored with the suggestion
- Settings: `matching.weights`, `matching.deckSize` (15), `matching.maxDailyImpressions` (20), `unlock.matching.minMembers` (10)
- Tests: `packages/algorithms/src/matching/match.test.ts`, `packages/algorithms/src/stats/random.test.ts`, `packages/core/src/matching/daily.test.ts`
- Spec: CLAUDE.md §8 F11 "Scoring", "Deck", "Explanations"

### Weight tuning and social metrics

- Code: `packages/algorithms/src/matching/tune.ts`; job `tune_match_weights` in `packages/core/src/matching/tune.ts` (nightly 02:00 UTC, before the decks); metrics in `packages/core/src/metrics/service.ts`
- Success: a suggestion that was requested, whose Discover request was accepted, and in whose direct thread each side sent at least `matching.successMessages` messages within `matching.successWindowDays` of acceptance
- Tuning, per mode, over suggestions acted on in the last `matching.tuneWindowDays`: only with at least `matching.tuneMinSuccesses` successes and some unsuccessful ones; diff = mean components of successes − of the rest; target = weights + step·diff/max|diff| (no negatives), renormalized; the move is scaled so no weight changes by more than `matching.weightStep`. Tuned weights are written as the computed value of `matching.weights` with the smallest success count among tuned modes as the sample size, so they apply once that reaches the key's min_sample.
- Stage thresholds: each streak that a missed day ends records an anonymous `streaks.endedLength` sample (one per pair and salt period); `streaks.companionStageDays` = quantiles of those lengths at k/(n+1) for its n thresholds, rounded, at least 1 and increasing, once min_sample is reached
- Metrics: match quality = successful ÷ accepted requests answered in the last 30 days; streak retention = median age in days of active pairs
- Settings: `matching.weights`, `matching.weightStep` (0.05), `matching.tuneMinSuccesses` (30), `matching.successMessages` (4), `matching.successWindowDays` (14), `matching.tuneWindowDays` (30), `streaks.companionStageDays`
- Tests: `packages/algorithms/src/matching/tune.test.ts`, `packages/core/src/matching/tune.test.ts`
- Spec: CLAUDE.md §8 F11 "Weight tuning", §1.7, §5.5.1

### Discover deck and message requests

- Code: `packages/core/src/matching/discover.ts`, `packages/core/src/chat/service.ts`, `packages/core/src/chat/threads.ts`, `packages/core/src/chat/icebreakers.ts`, `packages/algorithms/src/text/links.ts`
- Deck: today's (UTC) unanswered suggestions for the chosen mode, best score first, narrowed by department, graduation year range and tag (one of the candidate's top tags); people blocked since the deck was built, now in ghost mode or hidden, or no longer active are left out. Members without skill tags start in Explore.
- Card: up to 6 top tags, up to 3 Dev Card labels and the companion from the candidate's persona snapshot (`persona_snapshots`, written by `compute_skill_vector` from their latest Dev Card); without a snapshot the companion is seeded by their GitHub id with the species from their top tag, stage 0. Shared hours = `sharedActiveWindow` of both members' UTC hour histograms (the F2 rule), shown in the viewer's timezone.
- Request rules: both members verified, active and at the same university; neither blocked the other; recipient not in ghost mode; one pending request per direction; first message between `chat.minFirstMessageChars` and `chat.maxMessageChars` characters; accounts younger than `chat.newAccountDays` may include at most `chat.maxLinksNewAccount` links (an `http(s)://` URL or a `www.` host up to whitespace); at most `round(chat.newThreadsPerDay.base × trust multiplier)` requests in the last 24 hours, with a multiplier of 1 before the member's first trust score. The sender's user row is locked so concurrent requests are counted in turn; a request from a suggestion marks it `requested` in the same transaction.
- Icebreakers: a template key with one real signal from the suggestion: the first shared top tag (`sharedTag`), the first covered tag that is one of the member's learning goals (`learning`), or the number of shared topics (`interests`). Only openers the suggestion supports are accepted; the page's copy writes the text, and the minimum length does not apply to them.
- Answering: accepting opens a direct thread (or reuses the one the two share), posts the first message as the sender's at the request's time, records a connection (`discover` → `match`), accepts a crossing pending request, and notifies the sender; declining is silent and the sender sees "pending" until `chat.requestTtlDays` pass. A pending request older than that is expired when answered or when the same sender writes again.
- Messages: members of the thread only, active senders, no block either way in direct threads; same length and link rules as first messages; edits within `chat.editWindowMinutes`; deletion empties the body. Unread = messages from others after the member's `last_read_at`, deleted ones excluded; muted threads are left out of the total. Conversations load `chat.messagesPerPage` at a time, keyset-paged by `(created_at, id)`.
- Cold start: GitHub user search `language:"<member's most common own-repo language>" location:"<university country>" type:user`, `matching.coldStartListSize` people, the member left out; view-only.
- Settings: `chat.*` above, `chat.requestTtlDays` (14), `chat.editWindowMinutes` (10), `chat.messagesPerPage` (50), `matching.coldStartListSize` (10)
- Tests: `packages/core/src/matching/discover.test.ts`, `packages/core/src/chat/service.test.ts`, `packages/core/src/chat/threads.test.ts`, `packages/algorithms/src/text/links.test.ts`
- Spec: CLAUDE.md §8 F11 "UI", "Edge cases"; §8 F12 "Message requests"

### Trust score

- Code: `packages/algorithms/src/safety/trust.ts`; job `compute_trust` in `packages/core/src/safety/trust.ts` (nightly, 02:00 UTC)
- Formula: age = min(1, account days ÷ `trust.ageFullDays`); verified = 1 when the university is verified; acceptRate = accepted ÷ sent message requests in the last `trust.acceptRateWindowDays` (`trust.acceptRatePrior` when fewer than `trust.acceptRateMinSent` were sent); reports = min(distinct verified reporters in `safety.reportWindowDays`, `trust.reportCap`) ÷ `trust.reportCap`, counting each verified reporter once and leaving out dismissed reports; score = clamp(Σ `trust.weights`·component, 0, 1); multiplier = min + score·(max − min) over `trust.multiplierRange`
- Used by: the daily request limit, round(`chat.newThreadsPerDay.base` × multiplier); a member without a score yet gets 1
- Settings: `trust.weights`, `trust.multiplierRange` ([0.5, 3]), `trust.ageFullDays` (30), `trust.acceptRateWindowDays` (30), `trust.acceptRateMinSent` (3), `trust.acceptRatePrior` (0.5), `trust.reportCap` (3), `safety.reportWindowDays` (30)
- Tests: `packages/algorithms/src/safety/trust.test.ts`, `packages/core/src/safety/trust.test.ts`
- Spec: CLAUDE.md §8 F12 "Trust score"

### Reports and auto-hide

- Code: `packages/core/src/safety/service.ts`, `packages/db/src/queries/safety.ts`
- Rule: after each report, count distinct reporters of the member whose profile is verified, whose report is within `safety.reportWindowDays` and not dismissed; at `safety.autoHideReports` or more an active account becomes `hidden_pending_review` (one conditional update, so concurrent reports hide it once), the change is audited as `safety.auto_hidden` with no actor, and the member gets a neutral notice with an appeal link. The reporter is not told.
- Blocks: either direction stops requests and messages and removes the pair from each other's Discover; blocking declines pending requests between them silently.
- A report about a message is accepted only for a message in a thread the reporter belongs to, written by the reported member.
- Settings: `safety.autoHideReports` (3), `safety.reportWindowDays` (30), `safety.reportDetailsMaxChars` (1000), `feedback.maxChars` (2000)
- Tests: `packages/core/src/safety/service.test.ts`, `e2e/safety.spec.ts`
- Spec: CLAUDE.md §8 F12 "Reports and auto-hide"

### Moderation decisions

- Code: `packages/core/src/admin/moderation.ts`, `packages/db/src/queries/moderation.ts`; job `lift_suspensions` (hourly, :05)
- Scope: admins act on anyone; a university moderator on members of the universities they moderate, never on admins or themselves
- Decisions resolve every open report about the member: dismiss (dismissed; an account hidden by reports is restored), warn (actioned; the member is notified with the note; a hidden account is restored), suspend for 1 to `safety.maxSuspensionDays` days (`suspended_until` set), ban (suspended with no end). Each is audited as `moderation.<decision>` with the reports resolved, the end time, the note and the previous status.
- Context: the reported message with up to `safety.contextMessages` messages on each side, keyset by `(created_at, id)` within the thread; audited as `moderation.context_viewed`.
- Settings: `safety.contextMessages` (10), `safety.maxSuspensionDays` (365)
- Tests: `packages/core/src/admin/moderation.test.ts`, `e2e/safety.spec.ts`
- Spec: CLAUDE.md §8 F12 "Moderation queue", §5.11

### Notifications and daily digests

- Code: `packages/core/src/notifications/center.ts`, `packages/db/src/queries/notifications.ts`, words in `packages/email/src/notifications.ts`
- Dispatch (hourly, on the hour): members whose clock in their profile timezone reads `email.digestHourLocal`, who chose digests, are active, and have unread, not-yet-emailed notifications in kinds they did not mute; each gets one `digest_email` per local day (idempotency key `digest:<userId>:<local date>`). Timezones Postgres does not know are skipped.
- Digest: up to `email.digestMaxItems` such notifications, oldest first, described with the shared words; sent within `email.maxPerDay` (past the cap the job waits until the next UTC day without using an attempt); the notifications included are marked `emailed_at`.
- Center: the latest `notifications.listLimit` notifications; the unread badge leaves out muted kinds. Only social kinds can be muted; account and moderation notices cannot.
- Settings: `email.digestHourLocal` (18), `email.digestMaxItems` (20), `email.maxPerDay` (80), `notifications.listLimit` (50)
- Tests: `packages/core/src/notifications/center.test.ts`, `packages/email/src/notifications.test.ts`
- Spec: CLAUDE.md §7.5, §5.4 `digest_email`

### Shared streaks

- Code: `packages/algorithms/src/streaks/judge.ts`; job `streak_check` in `packages/core/src/streaks/judge.ts` (hourly at :15)
- Day boundaries: a pair's first day is the UTC date it was created; day D is judged once both members' local D+1 has begun in their profile timezones (computed with the runtime's timezone data, so daylight-saving changes, including skipped midnights, are handled) plus `streaks.graceHours`
- Dispatch: one per-pair run per ready day (idempotency key `streak:<pairId>:<day>`); the run judges every ready day in order with one contribution-calendar read per member over the range
- Outcome: both counts ≥ `streaks.minDailyContributions` → counted (streak + 1, longest updated, a freeze every `streaks.freezeEveryDays` counted days up to `streaks.maxFreezes`, misses in a row reset); else a held freeze → frozen (streak kept); else missed (streak 0, misses in a row + 1); `streaks.pauseAfterMissedDays` misses in a row pause the pair and notify both. Counts are recorded as GitHub's calendar reports them.
- Invalid token: a member whose stored token is missing or rejected makes the days skipped (no record, streak unchanged) and gets a sign-in-again notification
- Companion: stage = thresholds of `streaks.companionStageDays` reached by the current streak; mood happy / neutral / sad after counted / frozen / missed; seed = FNV-1a of the pair id
- Page: the pair companion is two-toned (each member's persona-snapshot color, the site's color before a member's first snapshot), drawn at min(stage, last drawable stage), wears the flame trait while the streak is above 0, and shows its mood as a hop (happy), rest (neutral) or slump (sad); the strip shows the last 30 UTC days ending yesterday; the partner's coded-today status is read in the partner's own day with their token, only when they allow it, and reused for `streaks.todayStatusCacheMinutes`; a share card exists only for a pair that has not ended between two public members
- Settings: `streaks.minDailyContributions` (1), `streaks.graceHours` (6), `streaks.freezeEveryDays` (7), `streaks.maxFreezes` (2), `streaks.pauseAfterMissedDays` (3), `streaks.companionStageDays`, `streaks.todayStatusCacheMinutes` (30)
- Tests: `packages/algorithms/src/streaks/judge.test.ts`, `packages/core/src/streaks/judge.test.ts`
- Spec: CLAUDE.md §8 F13 "Daily judgement", "Edge cases"

### Listing suggestions

- Code: `packages/core/src/adoptions/listings.ts` (job `suggest_listings`, weekly on Monday 04:00 UTC, one run per verified member and week: `listings:<userId>:<week Monday>`); scoring shared with the Graveyard in `packages/core/src/graveyard/signals.ts`
- Rule: a member's own repositories that are not forks, idle at least `graveyard.idleMonths.default`, with a README and at least `graveyard.minCommits` commits, whose adjusted unfinished score (F7 steps 5–6) is at least `adoptions.suggestMinUnfinished`, and that are not listed or dismissed. Read with the member's own token when valid. A dismissed repository is never suggested again.
- Settings: `adoptions.suggestMinUnfinished` (0.5), `adoptions.noteMaxChars` (280), `graveyard.idleMonths.default`, `graveyard.minCommits`, `graveyard.unfinishedTerms`
- Tests: `packages/core/src/adoptions/listings.test.ts`, `e2e/projects.spec.ts`
- Spec: CLAUDE.md §8 F14 "Private suggestions", "Listing"

### Graveyard uni scope and adoptions

- Code: `packages/core/src/graveyard/jobs.ts` (uni branch of `graveyard_search`), `packages/db/src/queries/adoptions.ts` (`uniListingCandidates`), `packages/core/src/adoptions/flow.ts`
- Candidates: listings with status `listed` at the searcher's university, never the searcher's own, never an owner either side has blocked, matched by full-text search (`simple` configuration, `websearch_to_tsquery`) on the repository or by topic overlap with the taxonomy expansion; relevance = `ts_rank_cd` plus topic overlap, divided by the best in the set. Listings are opted in by their owner, so the idle, README and history filters are skipped; scoring, labels and ranking are the global ones. The uni result is cached and queued per member (the tool's params and idempotency key include the member id), because blocks and the university differ by who asks.
- Adoption: "Adopt" creates an `adoptions` row (`requested`) and a message request with `context_kind = 'adoption'` in one transaction, under the chat rules; accepting the request sets the adoption `active`, the listing `adopted` and records an `adoption` connection. One open adoption per member and repository. The adopter links a fork in their own account (owner checked against their GitHub login). A verified member following a fork or ask link on a global result records a `requested` adoption without a listing, so a revival can be tracked.
- Settings: the Graveyard keys above, `chat.minFirstMessageChars`, `chat.newThreadsPerDay.base`
- Tests: `packages/core/src/adoptions/flow.test.ts`, `apps/web/src/components/graveyard/graveyard.test.tsx`, `e2e/projects.spec.ts`
- Spec: CLAUDE.md §8 F7 (uni scope, "Members"), §8 F14 "Adoption flow"

### Revival tracking

- Code: `packages/core/src/adoptions/revivals.ts` (job `track_revivals`, daily at 05:00 UTC: one check per adoption that is requested or active, `revival:<adoptionId>:<UTC day>`), queries in `packages/db/src/queries/adoptions.ts`; GitHub readers `listForks`, `listCommits` with `since`, `fetchRepositoryById`
- Identity: the adopter's own token when valid, else the server token (public reads only)
- Requested through a listing: dropped once the message request is declined or expired (quietly); only the owner's acceptance starts it
- Requested from a global result: the repository's current name is read by id when it is not cached; when a fork owned by the adopter (login compared case-insensitively) appears among the repository's forks (newest first, `github.maxPages.default` pages), the adoption becomes active with that fork; still without a fork after `adoptions.dropAfterDays` days it is dropped quietly
- Active: the fork is the linked one, or found the same way. Commits on the fork's default branch dated at or after the adoption's start (`since` = when it was asked for) are counted up to `adoptions.reviveMinCommits`; reaching it makes the adoption revived (`revived_at`), notifies adopter and owner (`adoption_revived`), and gives both the "Revived" badge. With fewer, the last activity is the newest such commit or the activation time, whichever is later; after `adoptions.dropAfterDays` days of none the adoption is dropped and both are notified (`adoption_dropped`). A deleted fork counts as no commits.
- Listing after a drop: stays adopted until its owner lists it again from `/settings/projects` (allowed only when no adoption of it is requested, active or revived)
- Badge and trait: a member who adopted, listed or owns a revived adoption's repository has the "Revived" badge; their Dev Card companion wears the `reviver` trait (§9.5) from its next refresh
- Metric: revivals in all and in the last 30 days on `/admin/metrics` (§1.7)
- Settings: `adoptions.reviveMinCommits` (3), `adoptions.dropAfterDays` (90), `github.maxPages.default`
- Tests: `packages/core/src/adoptions/revivals.test.ts`, `packages/github/src/queries/repos.test.ts`
- Spec: CLAUDE.md §8 F14 "Revival tracking"

### Credit ledger

- Code: `packages/core/src/reviews/ledger.ts`, queries in `packages/db/src/queries/ledger.ts`; table `credit_ledger` (append-only by trigger), view `credit_balances`, lock rows in `ledger_locks`
- Balance: the sum of a member's rows (`credit_balances`)
- Locking: every write first creates (if needed) and locks the member's `ledger_locks` row `for update` in its transaction; a write that touches two members locks both in sorted id order, so concurrent settlements cannot deadlock
- Starter: `reviews.starterCredits` credits once per member (`starter` row), granted after email or vouch verification; re-verifying grants nothing; 0 grants nothing
- Escrow: inside the review request's own transaction, under the author's lock: balance below 1 → "Review someone else's code to earn a credit."; otherwise a `-1 escrow` row tied to the request
- Settlement: a held escrow (an `escrow` row of the author for the request and no `release` or `refund` row for it) settles once: `+1 release` to the reviewer or `+1 refund` to the author; later attempts return false
- Admin adjustment: admins only, one `admin_adjust` row with an audit entry (`credits.adjusted`, delta and note), refused when it would leave the balance below 0
- Settings: `reviews.starterCredits` (1)
- Tests: `packages/core/src/reviews/ledger.test.ts` (50 concurrent escrows against 3 credits: exactly 3 succeed, the running balance never drops below 0), `packages/db/src/schema/collaboration.test.ts` (append-only)
- Spec: CLAUDE.md §8 F15 "Credits", §5.10 "Credit-ledger manipulation"

### Review requests and claims

- Code: `packages/core/src/reviews/requests.ts`, queries in `packages/db/src/queries/reviews.ts`, GitHub readers in `packages/github/src/queries/pulls.ts`
- Gate: verified members at a university where `unlock.reviews.minMembers` verified members have joined
- Request: the link must name a pull request (`parseGitHubUrl` with a number); the pull request must exist, be open and in a public repository, and the member must have opened it or own its repository (organization membership and collaborator status of others cannot be read without extra scopes, §2.7). One live request (open, claimed, submitted or disputed) per pull request. The request and a one-credit escrow are written in one transaction; it expires after `reviews.requestTtlDays`.
- Languages: extensions of changed files (`.ts`) matched case-insensitively against Linguist's `languages.extensions`; an extension several languages share counts for each; ranked by file count then name, at most `reviews.maxLanguages`
- Listing: open, unexpired requests at the member's university from active members, never their own, never across a block; sorted by language overlap = the sum of the member's skill-vector weights for each language as a tag (lowercase, spaces as hyphens), then newest; at most `reviews.listLimit`
- Claim: one conditional update (open, unexpired, not the author's), so concurrent claims leave one holder; nothing is read from GitHub, so claiming is instant, and a pull request that closed or vanished meanwhile is caught by `verify_review`, which refunds the author. The author is notified. A holder can give the claim back; an author can withdraw a request nobody has claimed (refunded, no notification).
- Settings: `unlock.reviews.minMembers`, `reviews.requestTtlDays` (14), `reviews.maxLanguages` (5), `reviews.listLimit` (50), `reviews.claimTtlHours` (72, shown with the claim)
- Tests: `packages/core/src/reviews/requests.test.ts`, `packages/github/src/queries/pulls.test.ts`
- Spec: CLAUDE.md §8 F15 "Request", "Claim and verify" steps 1–2, "Edge cases"

### Review verification, settlement and reputation

- Code: `packages/core/src/reviews/settlement.ts` (jobs `verify_review` and `expire_reviews`, hourly at :15), queries in `packages/db/src/queries/reviews.ts`
- Verification: "I've submitted my review" queues one `verify_review` per claim (`review:<requestId>:<claim time>`). It reads the pull request, its reviews and its line comments (the reviewer's own token when valid). Verified when the claimer (login compared case-insensitively) submitted a non-pending review at or after the claim time and wrote at least `reviews.minLineComments` line comments at or after it; the review ids and comment count are stored, the request becomes `submitted` and the author is asked to rate. A missing pull request, or one closed or private without such a review, ends the request with a refund. Otherwise the job waits (no attempt used) for `reviews.verifyRetryMinutes` or until the claim's end, whichever is sooner; at the end the request opens again and the reviewer is told.
- Rating: helpful → the escrow is released to the reviewer (`settled_helpful`); unhelpful → refunded to the author (`settled_unhelpful`); each settles once
- Dispute: the reviewer of an unhelpful rating may dispute it within `reviews.disputeWindowDays` with a note (at most `reviews.disputeNoteMaxChars`); the author keeps the refund meanwhile. Admins, or moderators of the request's university, decide: for the reviewer, they receive one credit as an audited `admin_adjust` and the request settles as helpful; for the author, it stays unhelpful. The decision is audited and both are told.
- Upkeep (hourly): claims older than `reviews.claimTtlHours`, or whose reviewer deleted their account, open again; open requests past their lifetime expire with a refund; verified reviews unrated after `reviews.autoSettleDays` settle as helpful; a submitted request whose review was deleted with its reviewer opens again
- Reputation: helpful reviews of the member as a percentile rank among the verified members of their university (members with none count as 0); tier = number of `reviews.reputationTierCuts` reached; no helpful review → no percentile, tier 0
- Settings: `reviews.minLineComments` (3), `reviews.claimTtlHours` (72), `reviews.autoSettleDays` (7), `reviews.verifyRetryMinutes` (60), `reviews.disputeWindowDays` (7), `reviews.disputeNoteMaxChars` (500), `reviews.reputationTierCuts` ([0.5, 0.75, 0.9])
- Tests: `packages/core/src/reviews/settlement.test.ts`
- Spec: CLAUDE.md §8 F15 "Claim and verify" step 3, "Rating and settlement", "Reputation", "Edge cases"

## Clustering, graphs and assignment

k-means with silhouette selection arrives in P6-T06.

### Skill swap cycles

- Code: `packages/algorithms/src/graph/cycles.ts` (`swapEdges`, `findSwapCycles`, `selectSwapCycles`), `packages/algorithms/src/matching/teach.ts` (`teachLevels`), orchestration in `packages/core/src/swaps/service.ts` (job `propose_swaps`, nightly at 03:30 UTC, one run per university where `unlock.swap.minMembers` verified members have joined: `swaps:<universityId>:<UTC day>`)
- Teaching level: a member's skill-vector weight for a tag as a percentile rank among all members of the university with a vector (those without the tag count as 0). Tags at or above `swap.minTeachLevel` are verified offers, rewritten into `swap_offers` every run. Self-declared offers are the member's own, from the tag vocabulary, at most `swap.maxSelfDeclared`, stored at level `swap.minTeachLevel`.
- Wants: the member's ranked wants (priority 1 to `swap.maxPriority`, at most `swap.maxWants`) plus their learning goals they did not rank, at `swap.goalPriority`; priority is normalized by `swap.maxPriority`
- Edges: A→B for each tag A offers and B wants; quality = level × normalized priority, × `swap.selfDeclaredFactor` for a self-declared offer; only the best edge per ordered pair is kept (ties by tag); no edge across a block either way
- Pool: verified, active members with a skill vector, not in ghost mode or hidden, and not already in a proposal that waits for answers
- Cycles: every simple cycle of 2 to `swap.maxCycleLength` members by depth-limited search from each member, visiting only members after the start so each cycle is found once; score = mean edge quality
- Selection: greedy by score, shorter cycles first on ties, then member order; no member in two proposals. Proposals expire after `swap.proposalTtlDays`.
- Answers: one decline ends the proposal (the others are told); when everyone accepts, a `swap` group thread opens with a system message saying who helps whom with what (stored as `swap:` plus the steps as JSON with the logins at that moment, worded by the chat view like the other system notes), and every pair is connected (`swap`)
- Page: `/swaps` shows proposals (accept or decline while open), verified offers with their level, self-declared offers (comma-separated) and wants (a skill and a priority per row, learning goals included)
- Settings: `unlock.swap.minMembers`, `swap.minTeachLevel` (0.5), `swap.maxCycleLength` (3), `swap.selfDeclaredFactor` (0.5), `swap.maxPriority` (3), `swap.goalPriority` (2), `swap.proposalTtlDays` (7), `swap.maxSelfDeclared` (10), `swap.maxWants` (10)
- Tests: `packages/algorithms/src/graph/cycles.test.ts`, `packages/core/src/swaps/swaps.test.ts`
- Spec: CLAUDE.md §8 F16

## Scoring

No entries yet. Each scoring rule is added by the task that implements its feature.
