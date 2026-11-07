# Performance Analysis

This document describes the final performance analysis behavior implemented in the LMS front end and the Supabase SQL RPCs used to produce the student and class performance reports.

## 1. System overview and architecture

The analytics layer keeps descriptive and Bayesian metrics separate:

- Descriptive analytics compute grade progress, attendance, module completion, and weighted performance using the school rules.
- Bayesian analytics estimate the probability that a student reaches a selected target on the next activity.
- Student and teacher reports share the same JavaScript calculation engine, `lms-frontend/assets/js/analytics.engine.js`.
- Supabase RPCs provide the student and peer evidence aggregates while preserving RLS and authorization rules.

The important distinction is that the weighted final-grade prediction is a heuristic descriptive score, while the Beta-Binomial estimate is a separate Bayesian predictive probability.

## 2. Descriptive analytics definitions and formulas

### Academic score

For a selected subject and term, the academic percentage is calculated as:

`academic_pct = earned_points / possible_points * 100`

Published activities contribute to the denominator when their valid maximum score is greater than zero. Submitted activities awaiting manual grading are excluded from the grade calculation until they are graded. Unsubmitted activities count as zero only when they are published and due or undated; future unsubmitted activities are excluded.

### Attendance score

`attendance_pct = ((present + 0.5 * late) / non_excused_meetings) * 100`

Excused sessions are excluded from the denominator.

### Module completion score

`modules_pct = (modules_read / published_modules) * 100`

## 3. 75/15/10 weighted score

The weighted score uses the same formula for both student analytics and teacher aggregate performance reporting:

`weighted_score = academic_pct * 0.75 + attendance_pct * 0.15 + modules_pct * 0.10`

When a component is missing, its weight is redistributed proportionally across the components that remain available instead of being treated as zero.

### Performance rating bands

- 90+ = Excellent
- 85-89 = Very Good
- 80-84 = Good
- 75-79 = Fair
- 70-74 = Needs Improvement
- Below 70 = At Risk

## 4. DepEd grade transmutation distinction

The DepEd transmutation function is intentionally separate from the Bayesian probability. It converts a weighted score into a school grade band and is not a probability distribution or uncertainty interval. The Bayesian result is the probability of success on the next activity at the selected target.

## 5. Beta-Binomial model

Each graded activity is treated as a Bernoulli trial for the event “the student reaches the selected target,” and the prior is centered on the peer cohort success rate. An eligible past-due or undated published activity with no submission is also a failure observation. It is included once in `own_failures` and separately reported in `my_missing_count`; it is not an additional failure on top of that count.

### Jeffreys-smoothed peer rate

If the peer cohort has observations,

`peer_rate = (peer_successes + 0.5) / (peer_successes + peer_failures + 1)`

Otherwise,

`peer_rate = 0.5`

### Prior parameters

`prior_alpha = 4 * peer_rate`

`prior_beta = 4 * (1 - peer_rate)`

The prior strength is 4 pseudo-observations, which keeps the prior weakly informative while allowing the student’s evidence to dominate as more observations accumulate.

### Likelihood and posterior

`posterior_alpha = prior_alpha + own_successes`

`posterior_beta = prior_beta + own_failures`

`own_failures` includes graded failures and eligible missing activities exactly once. `my_graded_count` counts graded successes plus graded failures only. `my_missing_count` reports the missing subset separately.

### Predictive probability

`P(next activity reaches target) = posterior_alpha / (posterior_alpha + posterior_beta)`

### 90% credible interval

The 90% central credible interval is computed using the exact Beta quantile function:

`lower = betaQuantile(0.05, posterior_alpha, posterior_beta)`

`upper = betaQuantile(0.95, posterior_alpha, posterior_beta)`

### Probability above peer performance

When peer evidence exists, the model also reports the posterior probability that the student’s underlying success rate exceeds the observed peer success rate:

`P(theta > peer_rate) = I_(1 - peer_rate)(posterior_beta, posterior_alpha)`

This uses the regularized incomplete Beta function.

## 6. Evidence rules for success, failure, missing, pending, and exclusion

A single activity is one Bernoulli observation. Success and failure are determined using the selected target grade.

- Success: `score / effective_max_score * 100 >= targetGrade`
- Failure: percentage is below the target
- Missing: published activity with no submission and due date is now or earlier counts as a failure
- Undated, published, unsubmitted activities count as failures
- Future unsubmitted activities are excluded
- Submitted activities awaiting manual grading are excluded
- Unpublished activities are excluded
- Activities without a valid maximum score are excluded

The effective maximum score is:

`COALESCE(NULLIF(submission.max_score, 0), activity.max_score)`

This ensures legacy rows with null or zero submission max scores still count correctly.

## 7. Student peer cohort and teacher section cohort definitions

Student analytics use the selected subject and term filters, exclude the requesting student from the peer pool, and include only active students enrolled in the corresponding subject. Duplicate enrollment rows cannot multiply evidence. Missing peer activities use these same activity and eligibility filters.

Teacher and administrator class reports compute per-student outputs using the section and subject scope authorized for the current user. Their peer totals include only active students enrolled in the subject and in the report's authorized section scope; duplicate enrollments cannot multiply evidence. The teacher report's class totals include the current student, which is subtracted before the shared engine calculates peer evidence.

- `peer_successes = class_successes - own_successes`
- `peer_failures = class_failures - own_failures`

Student reports currently use all active enrolled peers in the selected subject(s) and term because their RPC has no section filter. Teacher reports use the authorized selected section, or all sections assigned to that teacher when no section is selected. Therefore, student and teacher probabilities match when their subject, term, and eligible peer populations match; a section-scoped teacher report can intentionally have a different peer population. Both use the same Beta-Binomial formula, and neither exposes peer identities or raw peer grades.

## 8. Insufficient evidence behavior

The system marks estimates with fewer than three graded activities as low evidence; missing activities are failures but do not count as graded observations for this threshold. If neither personal nor peer evidence exists, the estimate is returned as null rather than as a misleading 50% evidence-based prediction.

## 9. Relevant functions and RPCs

- `lms-frontend/assets/js/analytics.engine.js`
  - `calculateBayesianEstimate()`
  - `betaPosterior()`
  - `betaBinomialMean()`
  - `getImprovementProbability()`
  - `getPredictedFinalGrade()`
- `supabase-migration/08_performance_overview.sql`
  - `public.get_beta_binomial_evidence()`
  - `public.get_class_performance()`
- `supabase-migration/15_bayesian_evidence_alignment.sql`
  - Forward migration aligning student and teacher evidence eligibility and counts

## 10. RLS and privacy protections

Specific protections are preserved:

- Students can only fetch their own Bayesian evidence for the selected scope.
- Peer data is aggregated before being returned and never exposed as raw peer records.
- Teacher and administrative access is still controlled by the same subject/section authorization rules.
- The RPCs remain security-definer functions with restricted execution rights and subject to the existing row-level security model.

## 11. Limitations and interpretation

The Bayesian estimate indicates the probability that the student reaches the selected activity target next, given the current evidence. It does not prove mastery of a standard, establish causation, or replace teacher judgment. It is a decision-support estimate that becomes more stable as more successful and unsuccessful observations accumulate.
