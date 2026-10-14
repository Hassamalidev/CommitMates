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

## Information retrieval

No entries yet. YAKE and BM25 arrive in P2-T17; TF-IDF in P4-T02.

## Clustering, graphs and assignment

No entries yet. k-means with silhouette selection arrives in P6-T06; cycle search in P5-T06.

## Scoring

No entries yet. Each scoring rule is added by the task that implements its feature.
