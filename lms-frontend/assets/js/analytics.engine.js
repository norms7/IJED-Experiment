/**
 * analytics.engine.js — Phase 2 port of analytics_service.py
 *
 * Faithful 1:1 port of the Python analytics service into client-side JS.
 * No scipy was ever used server-side (only the `math` module), so every
 * formula here is the exact same math, just in JS. RLS already restricts
 * each student to their own rows, so it's safe to compute this in the
 * browser instead of a backend service.
 *
 * Caching mirrors the original cache_or_compute() pattern, backed by the
 * `analytics_cache_get` / `analytics_cache_set` RPCs (analytics_cache table).
 *
 * Load this BEFORE lms-supabase-api.js:
 *   <script defer src="assets/js/analytics.engine.js"></script>
 *   <script defer src="assets/js/lms-supabase-api.js"></script>
 */

const DESCRIPTIVE_TTL_SECONDS = 300; // 5 minutes — same as Python
const BAYESIAN_TTL_SECONDS = 600;    // 10 minutes — same as Python

const AnalyticsEngine = (() => {

  // ── cache wrapper (mirrors cache_or_compute) ──────────────────────────────
  // CRITICAL: every cache key passed in by callers below was previously
  // built only from filter values (subject/term/semester) with no student_id
  // component at all — e.g. "descriptive.grade_progress.subject_all.term_all"
  // was IDENTICAL for every student viewing "All Subjects/All Terms". That
  // meant whichever student's request populated the cache first would have
  // their own grades/attendance/predictions served to every other student
  // who happened to pick the same filters, until the TTL expired. Scoping
  // every key by studentId here — once, centrally — closes that for every
  // caller without needing to edit each individual cache key string.
  async function cacheOrCompute(sb, studentId, cacheKey, ttlSeconds, computeFn) {
    const scopedKey = `student_${studentId}.${cacheKey}`;
    try {
      const { data: cached } = await sb.rpc("analytics_cache_get", {
        p_cache_key: scopedKey, p_ttl_seconds: ttlSeconds,
      });
      if (cached !== null && cached !== undefined) return cached;
    } catch (_) { /* cache miss/unreachable — fall through to fresh compute */ }

    const fresh = await computeFn();

    try {
      await sb.rpc("analytics_cache_set", { p_cache_key: scopedKey, p_payload: fresh });
    } catch (_) { /* best-effort — never block the response on a cache write */ }

    return fresh;
  }

  // ── _resolve_subject_ids ───────────────────────────────────────────────────
  // Optional `semester` param scopes the result to only that semester's
  // subjects. Centralized here so every descriptive/Bayesian function below
  // gets consistent semester filtering instead of each reimplementing it
  // (previously only getSubjectRadar did this — every other function pulled
  // every enrolled subject across BOTH semesters regardless of the UI's
  // semester selection).
  function normalizeSemester(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["1", "1st", "first", "1st semester"].includes(s)) return "1st";
    if (["2", "2nd", "second", "2nd semester"].includes(s)) return "2nd";
    return s || null;
  }

  async function resolveSubjectIds(sb, studentId, semester = null) {
    const { data, error } = await sb
      .from("student_subject_enrollments")
      .select("subject_id, subjects(semester)")
      .eq("student_id", studentId);
    if (error) throw new Error(error.message);
    const expected = semester ? normalizeSemester(semester) : null;
    return (data || [])
      .filter(r => !expected || normalizeSemester(r.subjects?.semester) === expected)
      .map(r => r.subject_id);
  }

  // ── Bayesian helpers ─────────────────────────────────────────────────────

  /** Abramowitz & Stegun approximation of the standard normal CDF. Defined
   *  for parity with the Python version — not currently used by any of the
   *  9 functions below (it wasn't used server-side either). */
  function normalCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const poly = t * (0.319381530
      + t * (-0.356563782
        + t * (1.781477937
          + t * (-1.821255978
            + t * 1.330274429))));
    const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly;
    return x >= 0 ? p : 1 - p;
  }

  function percentileRank(value, population) {
    if (!population.length) return 50;
    const below = population.filter(v => v < value).length;
    return Math.round((below / population.length) * 100);
  }

  /** Mean and standard deviation of a Beta(alpha, beta) distribution. */
  function betaStats(alpha, beta) {
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
    return { mean, sd: Math.sqrt(variance) };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 1. DESCRIPTIVE — Grade Progress
  // ══════════════════════════════════════════════════════════════════════
  async function getGradeProgress(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `descriptive.grade_progress.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { data: [], enrolled_subject_ids: [] };

      const { data: subs, error } = await sb
        .from("activity_submissions")
        .select("score, max_score, submitted_at, activities(id, title, activity_type, subject_id, term)")
        .eq("student_id", studentId).eq("is_graded", true).not("score", "is", null);
      if (error) throw new Error(error.message);

      const enrolledSet = new Set(subjectIds);
      const data = [];
      for (const sub of (subs || [])) {
        const act = sub.activities;
        if (!act || !enrolledSet.has(act.subject_id)) continue;
        if (subjectId && act.subject_id !== subjectId) continue;
        if (term && act.term !== term) continue;
        // Defensive: a graded row should always have a submitted_at, but if
        // one ever doesn't (bad data, manual grade with no timestamp), skip
        // it rather than crash the whole chart on a null .slice() call.
        if (!sub.submitted_at) continue;
        const pct = sub.max_score > 0 ? Math.round((sub.score / sub.max_score) * 1000) / 10 : null;
        data.push({
          date: sub.submitted_at.slice(0, 10),
          activity_id: act.id, activity_name: act.title, activity_type: act.activity_type,
          subject_id: act.subject_id, score: sub.score, max_score: sub.max_score, pct,
        });
      }
      data.sort((a, b) => a.date.localeCompare(b.date));
      return { data, enrolled_subject_ids: subjectIds };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. DESCRIPTIVE — Attendance Calendar
  // ══════════════════════════════════════════════════════════════════════
  async function getAttendanceCalendar(sb, studentId, subjectId = null, year = null, month = null, term = null, semester = null) {
    const cacheKey = `descriptive.attendance.subject_${subjectId || "all"}.y${year || "x"}.m${month || "x"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      // A specific subject was chosen — single call, untouched, no merge needed.
      if (subjectId) {
        const { data, error } = await sb.rpc('get_student_attendance_calendar', {
          p_student_id: studentId, p_subject_id: subjectId, p_year: year, p_month: month, p_term: term
        });
        if (error) throw new Error(error.message);
        return data;
      }

      // "All Subjects": the RPC only accepts one p_subject_id at a time (no
      // list param, unlike get_score_vs_class_average etc.), so semester
      // scoping has to happen client-side — call it once per subject in the
      // current semester and merge the results, rather than the previous
      // behavior of passing subjectId=null and pulling every subject the
      // student has ever been enrolled in, across both semesters.
      const subjectIds = await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { calendar: {}, summary: { present: 0, absent: 0, late: 0, excused: 0 } };

      const results = await Promise.all(subjectIds.map(sid =>
        sb.rpc('get_student_attendance_calendar', {
          p_student_id: studentId, p_subject_id: sid, p_year: year, p_month: month, p_term: term
        }).then(r => { if (r.error) throw new Error(r.error.message); return r.data; })
      ));

      // Merge day-by-day statuses: if the student had different subjects
      // with different statuses on the same date, show whichever is most
      // worth flagging (an absence anywhere that day outranks a present).
      const STATUS_PRIORITY = ['absent', 'late', 'excused', 'present', 'no_class'];
      const calendar = {};
      const summary = { present: 0, absent: 0, late: 0, excused: 0 };
      for (const result of results) {
        for (const [date, status] of Object.entries(result?.calendar || {})) {
          const existing = calendar[date];
          if (!existing || STATUS_PRIORITY.indexOf(status) < STATUS_PRIORITY.indexOf(existing)) {
            calendar[date] = status;
          }
        }
      }
      // Recompute summary counts from the merged (deduplicated-by-date)
      // calendar rather than summing each subject's summary, which would
      // double-count a student's attendance rate across their subjects.
      for (const status of Object.values(calendar)) {
        if (status in summary) summary[status] += 1;
      }
      return { calendar, summary };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. DESCRIPTIVE — Score vs Class Average
  //
  //    Computed server-side via get_score_vs_class_average(). The previous
  //    implementation queried activity_submissions for ALL students in the
  //    browser to build a class average — but RLS correctly restricts a
  //    student to reading only their own submission rows, so every "class
  //    average" silently collapsed to the requesting student's own score
  //    (class_size was always 1). Same bug class, same fix pattern, as
  //    "Students Like You" (§8).
  // ══════════════════════════════════════════════════════════════════════
  async function getScoreVsClassAverage(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `descriptive.score_vs_avg.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = subjectId ? [subjectId] : await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { data: [] };
      const { data, error } = await sb.rpc("get_score_vs_class_average", {
        p_student_id: studentId,
        p_subject_ids: subjectIds,
        p_term: term,
      });
      if (error) throw new Error(error.message);
      return { data: data?.data || [] };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. DESCRIPTIVE — Module Reading Progress
  // ══════════════════════════════════════════════════════════════════════
  async function getModuleReadingProgress(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `descriptive.module_progress.v2.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { subjects: [], totals: { read: 0, total: 0, pct: 0 } };
      const filterIds = subjectId ? [subjectId] : subjectIds;

      let modQuery = sb
        .from("modules").select("*").in("subject_id", filterIds).eq("is_published", true)
        .order("subject_id").order("order");
      if (term) modQuery = modQuery.eq("term", term);
      const { data: modules, error: mErr } = await modQuery;
      if (mErr) throw new Error(mErr.message);

      const { data: subjects } = await sb
        .from("subjects").select("id, name").in("id", filterIds);
      const subjectNames = new Map((subjects || []).map(subject => [subject.id, subject.name]));

      const { data: reads, error: rErr } = await sb
        .from("student_module_reads").select("*").eq("student_id", studentId);
      if (rErr) throw new Error(rErr.message);
      const readMap = new Map((reads || []).map(r => [r.module_id, r]));

      const bySubject = new Map();
      for (const mod of (modules || [])) {
        const sid = mod.subject_id;
        if (!bySubject.has(sid)) bySubject.set(sid, []);
        const read = readMap.get(mod.id);
        bySubject.get(sid).push({
          module_id: mod.id, title: mod.title, term: mod.term, is_read: !!read,
          first_read_at: read?.first_read_at || null, last_read_at: read?.last_read_at || null,
        });
      }

      const subjectsOut = [];
      let totalRead = 0, totalMods = 0;
      for (const [sid, mods] of bySubject.entries()) {
        const readCount = mods.filter(m => m.is_read).length;
        const total = mods.length;
        const pct = total ? Math.round((readCount / total) * 100) : 0;
        subjectsOut.push({
          subject_id: sid, modules_read: readCount, modules_total: total,
          completion_pct: pct, remaining: total - readCount,
          subject_name: subjectNames.get(sid) || `Subject ${sid}`, modules: mods,
        });
        totalRead += readCount; totalMods += total;
      }
      const overallPct = totalMods ? Math.round((totalRead / totalMods) * 100) : 0;
      return { subjects: subjectsOut, totals: { read: totalRead, total: totalMods, pct: overallPct } };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. DESCRIPTIVE — Subject Radar
  // ══════════════════════════════════════════════════════════════════════
  async function getSubjectRadar(sb, studentId, term = null, semester = '1st') {
    const cacheKey = `descriptive.subject_radar.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { axes: [] };

      const { data: subjects } = await sb
        .from("subjects").select("id, name").in("id", subjectIds);
      // resolveSubjectIds already scoped subjectIds to this semester, so no
      // further semester filtering is needed here (the previous inline
      // comparison duplicated that logic incompletely — it didn't recognize
      // a bare "1"/"2" the way the shared normalizeSemester() does, which
      // silently filtered out every subject when that's how the DB stores it).
      const subjectRows = subjects || [];
      const visibleSubjectIds = subjectRows.map(subject => subject.id);
      if (!visibleSubjectIds.length) return { axes: [] };

      const { data: subs, error } = await sb
        .from("activity_submissions")
        .select("score, max_score, activities(subject_id, term)")
        .eq("student_id", studentId).eq("is_graded", true).not("score", "is", null);
      if (error) throw new Error(error.message);

      const subjectSet = new Set(visibleSubjectIds);
      const perSubject = new Map();
      for (const sub of (subs || [])) {
        const sid = sub.activities?.subject_id;
        if (term && sub.activities?.term !== term) continue;
        if (sid && subjectSet.has(sid) && sub.max_score > 0) {
          if (!perSubject.has(sid)) perSubject.set(sid, []);
          perSubject.get(sid).push((sub.score / sub.max_score) * 100);
        }
      }

      const subjMap = new Map(subjectRows.map(subject => [subject.id, subject.name]));

      const axes = visibleSubjectIds.map(sid => {
        const scores = perSubject.get(sid) || [];
        const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
        return { subject_id: sid, subject_name: subjMap.get(sid) || `Subject ${sid}`, avg_pct: avg, activity_count: scores.length };
      });
      return { axes };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. PREDICTED FINAL GRADE
  //    Weights unified with Overall Performance Rating (§4) by school
  //    decision: Academic 75% / Attendance 15% / Module 10% — same weights,
  //    same formula, for both "all subjects" and any specific subject.
  //    (Originally this used 70/20/10 per a separate §6 weighting in the
  //    objective doc, but the school opted to make both cards agree.)
  //    Uses the exact same Academic/Attendance/Module component values as
  //    getRiskAssessment(), so the two cards can never show different
  //    Academic/Attendance/Module inputs for the same student+subject.
  // ══════════════════════════════════════════════════════════════════════
  function emptyPrediction() {
    return { predicted_grade: null, range_low: null, range_high: null, confidence: "n/a", n_observations: 0, current_avg: null, supporting_factors: [] };
  }

  async function getPredictedFinalGrade(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `predicted_grade.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const perf = await computePerformanceComponents(sb, studentId, subjectId, term, semester);
      if (!perf) return emptyPrediction();

      const { academicPct, attendancePct, modulePct, countedActivities, factors } = perf;

      const parts = [
        { value: academicPct,   weight: 0.75 },
        { value: attendancePct, weight: 0.15 },
        { value: modulePct,     weight: 0.10 },
      ].filter(p => p.value !== null);

      if (!parts.length) return emptyPrediction();

      const wSum = parts.reduce((a, p) => a + p.weight, 0);
      const raw = parts.reduce((a, p) => a + p.value * (p.weight / wSum), 0);
      const predicted = Math.min(100, Math.max(0, Math.round(raw * 100) / 100));

      // Confidence range: narrows as more graded activities accumulate, so the
      // prediction visibly firms up over the term (Objective §6 requirement
      // that the prediction "update dynamically" and "improve" with more data).
      // This is a stated heuristic (±15 / √n, floor of ±2), not part of the
      // school's formula — flagged here and in the UI as an estimate.
      const n = countedActivities || 0;
      const margin = n > 0 ? Math.max(2, Math.round((15 / Math.sqrt(n)) * 10) / 10) : 15;
      const lo = Math.max(0, Math.round((predicted - margin) * 10) / 10);
      const hi = Math.min(100, Math.round((predicted + margin) * 10) / 10);

      return {
        predicted_grade: predicted,
        range_low: lo, range_high: hi,
        confidence: "estimated range",
        n_observations: n,
        current_avg: academicPct !== null ? Math.round(academicPct * 100) / 100 : null,
        supporting_factors: factors,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. GRADE IMPROVEMENT PROBABILITY — real Beta-Binomial posterior.
  //
  //    "Success" on a graded activity = scored >= target%. We treat the
  //    student's own graded activities as Bernoulli evidence about their
  //    true long-run rate (theta) of hitting this target, and update a
  //    prior built from the class's own rate at that same target
  //    (empirical Bayes / "weakly informative prior").
  //
  //      Prior:      Beta(alpha0, beta0), centered on the class-wide rate,
  //                  weighted as PRIOR_STRENGTH pseudo-observations — small
  //                  enough that 3-4 of the student's own graded activities
  //                  start to dominate the estimate.
  //      Likelihood: the student's own successes/failures against target%.
  //      Posterior:  Beta(alpha0 + successes, beta0 + failures).
  //      Reported probability = posterior mean (the standard Beta-Binomial
  //      posterior-predictive probability of success on the next activity).
  //
  //    This replaces the old static gap-lookup table (Gap ≤2 → 95%, etc.),
  //    which had no way to express "not enough evidence yet" beyond one
  //    flat cutoff, and ignored the class context entirely.
  // ══════════════════════════════════════════════════════════════════════
  const PRIOR_STRENGTH = 4; // effective sample size of the class-wide prior

  async function getImprovementProbability(sb, studentId, targetGrade = 90.0, subjectId = null, term = null, semester = null) {
    const cacheKey = `improvement_prob.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}.target_${Math.trunc(targetGrade)}`;
    return cacheOrCompute(sb, studentId, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const prediction = await getPredictedFinalGrade(sb, studentId, subjectId, term, semester);
      const predicted = prediction.predicted_grade;
      if (predicted === null) {
        return { probability: null, target_grade: targetGrade, predicted_grade: null, n_observations: 0, recommendation: null };
      }

      const subjectIds = subjectId ? [subjectId] : await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) {
        return { probability: null, target_grade: targetGrade, predicted_grade: predicted, n_observations: 0, recommendation: null };
      }

      const { data: evidence, error } = await sb.rpc("get_beta_binomial_evidence", {
        p_student_id: studentId,
        p_subject_ids: subjectIds,
        p_target_pct: targetGrade,
        p_term: term,
      });
      if (error) throw new Error(error.message);

      const { my_successes: mySucc, my_failures: myFail, peer_successes: peerSucc, peer_failures: peerFail } = evidence;

      // Prior: class-wide rate at this target, or an uninformative 50/50
      // split if nobody else in the subject has a graded activity yet.
      const peerTotal = peerSucc + peerFail;
      const priorRate = peerTotal > 0 ? peerSucc / peerTotal : 0.5;
      const alpha0 = priorRate * PRIOR_STRENGTH;
      const beta0 = (1 - priorRate) * PRIOR_STRENGTH;

      const posterior = betaStats(alpha0 + mySucc, beta0 + myFail);
      const probability = Math.round(posterior.mean * 100);

      // 90% credible interval via the normal approximation to the Beta
      // posterior (accurate once alpha+beta isn't tiny, which the prior's
      // pseudo-count already guarantees even with zero of the student's
      // own graded activities).
      const Z90 = 1.645;
      const credibleLow = Math.max(0, Math.round((posterior.mean - Z90 * posterior.sd) * 100));
      const credibleHigh = Math.min(100, Math.round((posterior.mean + Z90 * posterior.sd) * 100));

      // A secondary, genuinely different question from the headline number:
      // "how likely is it that this student's true rate beats the class
      // average rate at this target?" — a one-sample z-test of the
      // posterior mean against the prior rate, via the normal CDF.
      const zVsClass = posterior.sd > 0 ? (posterior.mean - priorRate) / posterior.sd : 0;
      const aboveClassAvgProbability = Math.round(normalCdf(zVsClass) * 100);

      const evidenceCount = mySucc + myFail;
      const label = probability >= 80 ? "Very likely" : probability >= 60 ? "Likely" : probability >= 40 ? "Possible" : "Challenging";

      const gap = targetGrade - predicted;
      let recommendation;
      if (evidenceCount === 0) {
        recommendation = `This estimate is currently based on your class's history at the ${targetGrade}% mark, since you don't have a graded activity of your own yet — it will sharpen as your results come in.`;
      } else if (gap <= 0) {
        recommendation = "You're already on track to meet or exceed this target grade.";
      } else if (gap <= 5) {
        recommendation = "A small, consistent improvement on upcoming graded activities should close this gap.";
      } else if (gap <= 10) {
        recommendation = "Focus on your weakest activity type, and keep attendance and module reading up — academics carry 75% of the prediction.";
      } else {
        recommendation = "This is a stretch target. Prioritize catching up on missed or low-scoring graded work first, since it has the largest effect on your predicted grade.";
      }

      return {
        probability, target_grade: targetGrade, predicted_grade: predicted, label,
        n_observations: prediction.n_observations,
        recommendation,
        // New: real Bayesian detail the old lookup table couldn't provide.
        credible_low: credibleLow, credible_high: credibleHigh,
        evidence_count: evidenceCount,
        class_rate_at_target: Math.round(priorRate * 100),
        above_class_average_probability: aboveClassAvgProbability,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. "Students Like You" — Engagement Index & peer percentile (§8)
  //
  //    Computed entirely server-side via get_engagement_percentile().
  //    A client-side implementation is architecturally impossible to do
  //    correctly here: RLS correctly restricts a student to reading only
  //    their OWN attendance_records / student_module_reads rows, so any
  //    attempt to read other students' rows from the browser to build a
  //    peer comparison silently returns empty data for every peer. The
  //    SECURITY DEFINER RPC computes the full Engagement Index and
  //    percentile inside Postgres, where it can see the rows it needs, and
  //    returns only the requesting student's own numbers + an aggregate
  //    percentile — no peer identities or raw peer scores ever reach the
  //    client, preserving the spec's "Never expose student identities"
  //    requirement.
  // ══════════════════════════════════════════════════════════════════════
  async function getStudentsLikeYou(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `bayesian.students_like_you.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const subjectIds = subjectId ? [subjectId] : await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { percentile: null, message: "Not enough data yet." };

      const { data, error } = await sb.rpc("get_engagement_percentile", {
        p_student_id: studentId,
        p_subject_ids: subjectIds,
        p_term: term,
      });
      if (error) throw new Error(error.message);

      if (data?.percentile === null || data?.percentile === undefined) {
        return { percentile: null, message: "Not enough data yet." };
      }

      const percentile = data.percentile;
      let message;
      if (percentile >= 75) message = `You perform better than ${percentile}% of students with similar engagement patterns.`;
      else if (percentile >= 50) message = `You are performing above the median — better than ${percentile}% of similar students.`;
      else if (percentile >= 25) message = `There is room to grow. You are currently ahead of ${percentile}% of similar students.`;
      else message = `You are in the bottom ${100 - percentile}% of similar students — this is a great moment to step up!`;

      return {
        percentile, message,
        engagement_score: data.engagement_score,
        my_profile: {
          attendance_rate: data.my_attendance_rate,
          module_completion: data.my_module_completion,
        },
        peer_count: data.peer_count,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SHARED COMPONENT CALCULATOR — Academic / Attendance / Module scores
  //
  // Implements the school's three base formulas exactly as specified:
  //
  //   §1 Academic Score (%)   = (Total Earned Points / Total Possible Points) × 100
  //   §2 Attendance Score (%) = (Present + Late×0.5) / Total Meetings × 100
  //   §3 Module Score (%)     = (Modules Read / Total Modules) × 100
  //
  // This single function is the source of truth for these three numbers.
  // getRiskAssessment() (§4/§5, weights 75/15/10) and getPredictedFinalGrade()
  // (§6, weights 70/20/10) both call it, so the Academic/Attendance/Module
  // percentages shown on both cards are always identical — only the blend
  // weights differ, exactly as the spec defines two separate formulas that
  // share the same three inputs.
  // ══════════════════════════════════════════════════════════════════════
  async function computePerformanceComponents(sb, studentId, subjectId = null, term = null, semester = null) {
    const allSubjectIds = await resolveSubjectIds(sb, studentId, semester);
    if (!allSubjectIds.length) return null;
    const subjectIds = subjectId ? allSubjectIds.filter(id => id === subjectId) : allSubjectIds;
    if (!subjectIds.length) return null;

    const nowIso = new Date().toISOString();

    // ── §2 Attendance Score: Present = 100%, Late = 50%, Absent = 0% ──────
    const { data: attScore, error: attErr } = await sb.rpc("get_attendance_score", {
      p_student_id: studentId,
      p_subject_ids: subjectIds,
      p_term: term,
    });
    if (attErr) throw new Error(attErr.message);
    const totalSessions = attScore?.total_sessions || 0;
    const attendancePct = attScore?.attendance_pct ?? null;

    // ── Modules in scope (subject + term), shared by §3 and §1 below ──────
    let modQuery = sb.from("modules").select("id").in("subject_id", subjectIds).eq("is_published", true);
    if (term) modQuery = modQuery.eq("term", term);
    const { data: modsInScope, error: modErr } = await modQuery;
    if (modErr) throw new Error(modErr.message);
    const modIds = (modsInScope || []).map(m => m.id);
    const totalMods = modIds.length;

    // ── §3 Module Score: Modules Read / Total Modules ─────────────────────
    // FIX: this used to count ALL of the student's module reads across
    // their entire account, uncorrelated to subject or term, and just
    // clamped it against totalMods — only "worked" by coincidence. Now
    // properly scoped to the modules actually in scope.
    const { count: reads } = totalMods
      ? await sb.from("student_module_reads").select("id", { count: "exact", head: true })
          .eq("student_id", studentId).in("module_id", modIds)
      : { count: 0 };
    const modulePct = totalMods ? (Math.min(reads || 0, totalMods) / totalMods) * 100 : null;

    // ── §1 Academic Score: Total Earned / Total Possible ──────────────────
    // Only "applicable" activities count: published, and either already due
    // or undated. A past-due activity the student never submitted counts as
    // 0 earned against its own max_score (not a flat 100), so a missed
    // 10-point quiz doesn't get weighted the same as a missed 100-point exam.
    // Term scoping: activities.term is a direct column, set explicitly when
    // the teacher creates the activity -- filtered straight, no join needed.
    let actQuery = sb
      .from("activities").select("id, max_score, due_date")
      .in("subject_id", subjectIds).eq("is_published", true)
      .or(`due_date.is.null,due_date.lte.${nowIso}`);
    if (term) actQuery = actQuery.eq("term", term);
    const { data: applicableActs, error: actErr } = await actQuery;
    if (actErr) throw new Error(actErr.message);

    const { data: subs } = await sb
      .from("activity_submissions")
      .select("activity_id, score, max_score, is_graded")
      .eq("student_id", studentId)
      .in("activity_id", (applicableActs || []).map(a => a.id));
    const submittedById = new Map((subs || []).map(s => [s.activity_id, s]));

    let totalEarned = 0, totalPossible = 0, countedActivities = 0;
    for (const act of (applicableActs || [])) {
      const sub = submittedById.get(act.id);
      if (sub && sub.is_graded && sub.score !== null && sub.max_score > 0) {
        totalEarned += sub.score;
        totalPossible += sub.max_score;
        countedActivities++;
      } else if (sub && !sub.is_graded) {
        continue; // submitted, awaiting grading — can't score it yet, don't penalize
      } else if (act.max_score > 0) {
        // past due, never submitted → missed work counts as 0/max_score
        totalPossible += act.max_score;
        countedActivities++;
      }
      // activities with no max_score set are skipped entirely — can't be
      // graded fairly without a denominator.
    }
    const academicPct = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;

    if (academicPct === null && !totalSessions && !totalMods) return null;

    const factors = [];
    if (academicPct !== null && academicPct < 75) {
      factors.push(`Academic performance is ${Math.round(academicPct * 100) / 100}% (${totalEarned}/${totalPossible} points across ${countedActivities} applicable activit${countedActivities === 1 ? "y" : "ies"}).`);
    }
    if (attendancePct !== null && attendancePct < 80) {
      factors.push(`Attendance is ${Math.round(attendancePct * 100) / 100}% (below the 80% healthy threshold).`);
    }
    if (modulePct !== null && modulePct < 60) {
      factors.push(`Only ${Math.round(modulePct * 100) / 100}% of modules have been read.`);
    }
    if (!factors.length) factors.push("All indicators are within healthy ranges.");

    return {
      academicPct, attendancePct, modulePct,
      totalEarned, totalPossible, countedActivities,
      totalSessions, totalMods,
      factors,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4/5/9. OVERALL PERFORMANCE RATING
  //    School standard (Objective §4): Academic 75% / Attendance 15% / Module 10%
  //    Rating bands (Objective §5), 6 tiers:
  //      90–100 Excellent · 85–89 Very Good · 80–84 Good ·
  //      75–79 Fair · 70–74 Needs Improvement · <70 At Risk
  // ══════════════════════════════════════════════════════════════════════
  function ratingForScore(score) {
    if (score >= 90) return { rating: "Excellent",         color: "excellent",         emoji: "🟢" };
    if (score >= 85) return { rating: "Very Good",         color: "very_good",         emoji: "🟩" };
    if (score >= 80) return { rating: "Good",              color: "good",              emoji: "🔵" };
    if (score >= 75) return { rating: "Fair",              color: "fair",              emoji: "🟡" };
    if (score >= 70) return { rating: "Needs Improvement", color: "needs_improvement", emoji: "🟠" };
    return { rating: "At Risk", color: "at_risk", emoji: "🔴" };
  }

  async function getRiskAssessment(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `performance.rating.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const perf = await computePerformanceComponents(sb, studentId, subjectId, term, semester);
      if (!perf) {
        return { risk_level: "Unknown", rating: "Unknown", explanation: "Not enough activity yet to compute a rating.", performance_score: null };
      }

      const { academicPct, attendancePct, modulePct, totalSessions, totalMods, factors } = perf;

      // If a component genuinely has no applicable data yet (e.g. no modules
      // published, or no attendance sessions recorded), redistribute its
      // weight proportionally across the remaining components rather than
      // treating "no data" as "zero" — this is what stops a student from
      // being wrongly flagged At Risk purely for low module completion when
      // academics are strong (Objective §5's explicit fairness rule).
      const parts = [
        { key: "academic",   value: academicPct,   weight: 0.75 },
        { key: "attendance", value: attendancePct,  weight: 0.15 },
        { key: "modules",    value: modulePct,      weight: 0.10 },
      ];
      const known = parts.filter(p => p.value !== null);
      const knownWeightSum = known.reduce((a, p) => a + p.weight, 0);
      const performanceScore = knownWeightSum
        ? Math.round(known.reduce((a, p) => a + p.value * (p.weight / knownWeightSum), 0) * 100) / 100
        : null;

      if (performanceScore === null) {
        return { risk_level: "Unknown", rating: "Unknown", explanation: "Not enough activity yet to compute a rating.", performance_score: null };
      }

      const { rating, color, emoji } = ratingForScore(performanceScore);

      const signals = {
        academic_performance: academicPct !== null ? Math.round(academicPct * 100) / 100 : null,
        attendance_rate: attendancePct !== null ? Math.round(attendancePct * 100) / 100 : null,
        module_completion: modulePct !== null ? Math.round(modulePct * 100) / 100 : null,
      };

      return {
        performance_score: performanceScore, rating, color, emoji, factors, signals,
        breakdown: {
          academic:   { value: signals.academic_performance, weight: 0.75 },
          attendance: { value: signals.attendance_rate,       weight: 0.15 },
          modules:    { value: signals.module_completion,     weight: 0.10 },
        },
        // Back-compat alias so any older caller keyed on risk_level still gets something sane:
        risk_level: rating,
      };
    });
  }

  return {
    normalCdf, percentileRank,
    getGradeProgress, getAttendanceCalendar, getScoreVsClassAverage,
    getModuleReadingProgress, getSubjectRadar,
    getPredictedFinalGrade, getImprovementProbability, getStudentsLikeYou, getRiskAssessment,
  };
})();
