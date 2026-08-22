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
  async function cacheOrCompute(sb, cacheKey, ttlSeconds, computeFn) {
    try {
      const { data: cached } = await sb.rpc("analytics_cache_get", {
        p_cache_key: cacheKey, p_ttl_seconds: ttlSeconds,
      });
      if (cached !== null && cached !== undefined) return cached;
    } catch (_) { /* cache miss/unreachable — fall through to fresh compute */ }

    const fresh = await computeFn();

    try {
      await sb.rpc("analytics_cache_set", { p_cache_key: cacheKey, p_payload: fresh });
    } catch (_) { /* best-effort — never block the response on a cache write */ }

    return fresh;
  }

  // ── _resolve_subject_ids ───────────────────────────────────────────────────
  async function resolveSubjectIds(sb, studentId) {
    const { data, error } = await sb
      .from("student_subject_enrollments")
      .select("subject_id")
      .eq("student_id", studentId);
    if (error) throw new Error(error.message);
    return (data || []).map(r => r.subject_id);
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

  // ══════════════════════════════════════════════════════════════════════
  // 1. DESCRIPTIVE — Grade Progress
  // ══════════════════════════════════════════════════════════════════════
  async function getGradeProgress(sb, studentId, subjectId = null) {
    const cacheKey = `descriptive.grade_progress.subject_${subjectId || "all"}`;
    return cacheOrCompute(sb, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { data: [], enrolled_subject_ids: [] };

      const { data: subs, error } = await sb
        .from("activity_submissions")
        .select("score, max_score, submitted_at, activities(id, title, activity_type, subject_id)")
        .eq("student_id", studentId).eq("is_graded", true).not("score", "is", null);
      if (error) throw new Error(error.message);

      const enrolledSet = new Set(subjectIds);
      const data = [];
      for (const sub of (subs || [])) {
        const act = sub.activities;
        if (!act || !enrolledSet.has(act.subject_id)) continue;
        if (subjectId && act.subject_id !== subjectId) continue;
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
  async function getAttendanceCalendar(sb, studentId, subjectId = null, year = null, month = null) {
    const cacheKey = `descriptive.attendance.subject_${subjectId || "all"}.y${year || "x"}.m${month || "x"}`;
    return cacheOrCompute(sb, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const { data, error } = await sb.rpc('get_student_attendance_calendar', {
        p_student_id: studentId,
        p_subject_id: subjectId,
        p_year: year,
        p_month: month
      });
      if (error) throw new Error(error.message);
      return data;
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. DESCRIPTIVE — Score vs Class Average
  // ══════════════════════════════════════════════════════════════════════
  async function getScoreVsClassAverage(sb, studentId, subjectId = null) {
    const cacheKey = `descriptive.score_vs_avg.subject_${subjectId || "all"}`;
    return cacheOrCompute(sb, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { data: [] };
      const filterIds = subjectId ? [subjectId] : subjectIds;

      const { data: activities, error: aErr } = await sb
        .from("activities").select("*").in("subject_id", filterIds).eq("is_published", true).order("created_at");
      if (aErr) throw new Error(aErr.message);
      if (!activities?.length) return { data: [] };

      const actIds = activities.map(a => a.id);
      const actMap = new Map(activities.map(a => [a.id, a]));

      const { data: allSubs, error: sErr } = await sb
        .from("activity_submissions").select("activity_id, student_id, score, max_score")
        .in("activity_id", actIds).eq("is_graded", true).not("score", "is", null).gt("max_score", 0);
      if (sErr) throw new Error(sErr.message);

      const classScores = new Map();
      const studentScore = new Map();
      for (const sub of (allSubs || [])) {
        const pct = Math.round((sub.score / sub.max_score) * 1000) / 10;
        if (!classScores.has(sub.activity_id)) classScores.set(sub.activity_id, []);
        classScores.get(sub.activity_id).push(pct);
        if (sub.student_id === studentId) studentScore.set(sub.activity_id, pct);
      }

      const data = [];
      for (const [actId, pcts] of classScores.entries()) {
        if (!pcts.length) continue;
        const avg = Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10;
        const my = studentScore.has(actId) ? studentScore.get(actId) : null;
        const act = actMap.get(actId);
        const diff = my !== null ? Math.round((my - avg) * 10) / 10 : null;
        data.push({
          activity_id: actId, activity_name: act.title, activity_type: act.activity_type,
          subject_id: act.subject_id, my_score_pct: my, class_avg_pct: avg,
          diff_pct: diff, class_size: pcts.length,
        });
      }
      data.sort((a, b) => (a.subject_id - b.subject_id) || (a.activity_id - b.activity_id));
      return { data };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. DESCRIPTIVE — Module Reading Progress
  // ══════════════════════════════════════════════════════════════════════
  async function getModuleReadingProgress(sb, studentId, subjectId = null) {
    const cacheKey = `descriptive.module_progress.subject_${subjectId || "all"}`;
    return cacheOrCompute(sb, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { subjects: [], totals: { read: 0, total: 0, pct: 0 } };
      const filterIds = subjectId ? [subjectId] : subjectIds;

      const { data: modules, error: mErr } = await sb
        .from("modules").select("*").in("subject_id", filterIds).eq("is_published", true)
        .order("subject_id").order("order");
      if (mErr) throw new Error(mErr.message);

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
          completion_pct: pct, remaining: total - readCount, modules: mods,
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
  async function getSubjectRadar(sb, studentId) {
    const cacheKey = "descriptive.subject_radar";
    return cacheOrCompute(sb, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { axes: [] };

      const { data: subs, error } = await sb
        .from("activity_submissions")
        .select("score, max_score, activities(subject_id)")
        .eq("student_id", studentId).eq("is_graded", true).not("score", "is", null);
      if (error) throw new Error(error.message);

      const subjectSet = new Set(subjectIds);
      const perSubject = new Map();
      for (const sub of (subs || [])) {
        const sid = sub.activities?.subject_id;
        if (sid && subjectSet.has(sid) && sub.max_score > 0) {
          if (!perSubject.has(sid)) perSubject.set(sid, []);
          perSubject.get(sid).push((sub.score / sub.max_score) * 100);
        }
      }

      const { data: subjects } = await sb.from("subjects").select("id, name").in("id", subjectIds);
      const subjMap = new Map((subjects || []).map(s => [s.id, s.name]));

      const axes = subjectIds.map(sid => {
        const scores = perSubject.get(sid) || [];
        const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
        return { subject_id: sid, subject_name: subjMap.get(sid) || `Subject ${sid}`, avg_pct: avg, activity_count: scores.length };
      });
      return { axes };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. PREDICTED FINAL GRADE
  //    School standard (Objective §6): simple weighted average, NOT Bayesian.
  //      Predicted Grade = Academic×0.70 + Attendance×0.20 + Module×0.10
  //    Uses the exact same Academic/Attendance/Module component values as
  //    getRiskAssessment() (§1–§3 formulas), just recombined with the 70/20/10
  //    weights instead of 75/15/10, so the two cards never contradict each other.
  // ══════════════════════════════════════════════════════════════════════
  function emptyPrediction() {
    return { predicted_grade: null, range_low: null, range_high: null, confidence: "n/a", n_observations: 0, current_avg: null, supporting_factors: [] };
  }

  async function getPredictedFinalGrade(sb, studentId, subjectId = null) {
    const cacheKey = `predicted_grade.subject_${subjectId || "all"}`;
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const perf = await computePerformanceComponents(sb, studentId, subjectId);
      if (!perf) return emptyPrediction();

      const { academicPct, attendancePct, modulePct, countedActivities, factors } = perf;

      const parts = [
        { value: academicPct,   weight: 0.70 },
        { value: attendancePct, weight: 0.20 },
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
  // 7. GRADE IMPROVEMENT PROBABILITY
  //    School standard (Objective §7): gap-based lookup table against the
  //    Predicted Final Grade above — NOT a Bayesian Beta posterior.
  //      Gap = Target Grade − Predicted Grade
  //      Gap ≤ 2 → 95%, ≤5 → 80%, ≤10 → 60%, ≤15 → 40%, >15 → 20%
  // ══════════════════════════════════════════════════════════════════════
  async function getImprovementProbability(sb, studentId, targetGrade = 90.0, subjectId = null) {
    const cacheKey = `improvement_prob.subject_${subjectId || "all"}.target_${Math.trunc(targetGrade)}`;
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const prediction = await getPredictedFinalGrade(sb, studentId, subjectId);
      const predicted = prediction.predicted_grade;
      if (predicted === null) {
        return { probability: null, target_grade: targetGrade, predicted_grade: null, n_observations: 0, recommendation: null };
      }

      const gap = targetGrade - predicted;
      let probability;
      if (gap <= 2) probability = 95;
      else if (gap <= 5) probability = 80;
      else if (gap <= 10) probability = 60;
      else if (gap <= 15) probability = 40;
      else probability = 20;

      const label = probability >= 80 ? "Very likely" : probability >= 60 ? "Likely" : probability >= 40 ? "Possible" : "Challenging";

      const recommendation = gap <= 0
        ? "You're already on track to meet or exceed this target grade."
        : gap <= 5
          ? "A small, consistent improvement on upcoming graded activities should close this gap."
          : gap <= 10
            ? "Focus on your weakest activity type, and keep attendance and module reading up — academics carry 70% of the prediction."
            : "This is a stretch target. Prioritize catching up on missed or low-scoring graded work first, since it has the largest effect on your predicted grade.";

      return {
        probability, target_grade: targetGrade, predicted_grade: predicted, label,
        n_observations: prediction.n_observations,
        recommendation,
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
  async function getStudentsLikeYou(sb, studentId) {
    const cacheKey = "bayesian.students_like_you";
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const { data, error } = await sb.rpc("get_engagement_percentile", { p_student_id: studentId });
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
  async function computePerformanceComponents(sb, studentId, subjectId = null) {
    const allSubjectIds = await resolveSubjectIds(sb, studentId);
    if (!allSubjectIds.length) return null;
    const subjectIds = subjectId ? allSubjectIds.filter(id => id === subjectId) : allSubjectIds;
    if (!subjectIds.length) return null;

    const nowIso = new Date().toISOString();

    // ── §2 Attendance Score: Present = 100%, Late = 50%, Absent = 0% ──────
    // Computed server-side via get_attendance_score(). Direct client-side
    // queries against attendance_sessions/attendance_records were unreliable
    // for some students (returned 0 sessions even when the student's own
    // "My Attendance" page — powered by a separate, already-correct RPC —
    // showed real data). Routing through a SECURITY DEFINER RPC removes
    // that ambiguity and guarantees this number always matches what the
    // student sees on their Attendance page.
    const { data: attScore, error: attErr } = await sb.rpc("get_attendance_score", {
      p_student_id: studentId,
      p_subject_ids: subjectIds,
    });
    if (attErr) throw new Error(attErr.message);
    const totalSessions = attScore?.total_sessions || 0;
    const attendancePct = attScore?.attendance_pct ?? null;

    // ── §3 Module Score: Modules Read / Total Modules ─────────────────────
    const { count: totalMods } = await sb
      .from("modules").select("id", { count: "exact", head: true })
      .in("subject_id", subjectIds).eq("is_published", true);
    const { count: reads } = await sb
      .from("student_module_reads").select("id", { count: "exact", head: true }).eq("student_id", studentId);
    const modulePct = totalMods ? (Math.min(reads || 0, totalMods) / totalMods) * 100 : null;

    // ── §1 Academic Score: Total Earned / Total Possible ──────────────────
    // Only "applicable" activities count: published, and either already due
    // or undated. A past-due activity the student never submitted counts as
    // 0 earned against its own max_score (not a flat 100), so a missed
    // 10-point quiz doesn't get weighted the same as a missed 100-point exam.
    const { data: applicableActs } = await sb
      .from("activities").select("id, max_score, due_date")
      .in("subject_id", subjectIds).eq("is_published", true)
      .or(`due_date.is.null,due_date.lte.${nowIso}`);

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

  async function getRiskAssessment(sb, studentId) {
    const cacheKey = "performance.rating";
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const perf = await computePerformanceComponents(sb, studentId, null);
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
