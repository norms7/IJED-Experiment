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
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { calendar: {}, summary: {} };

      const filterIds = subjectId ? [subjectId] : subjectIds;
      const { data: sessions, error } = await sb
        .from("attendance_sessions").select("*").in("subject_id", filterIds).order("session_date");
      if (error) throw new Error(error.message);
      if (!sessions?.length) {
        return { calendar: {}, summary: { present: 0, absent: 0, late: 0, excused: 0, no_class: 0 } };
      }

      const sessionIds = sessions.filter(s => s.has_class).map(s => s.id);
      const recordsBySession = {};
      if (sessionIds.length) {
        const { data: records } = await sb
          .from("attendance_records").select("session_id, status")
          .in("session_id", sessionIds).eq("student_id", studentId);
        for (const r of (records || [])) recordsBySession[r.session_id] = r.status;
      }

      const calendar = {};
      const summary = { present: 0, absent: 0, late: 0, excused: 0, no_class: 0 };
      for (const sess of sessions) {
        const d = new Date(sess.session_date + "T00:00:00");
        if (year && d.getFullYear() !== year) continue;
        if (month && (d.getMonth() + 1) !== month) continue;
        const key = sess.session_date;
        const status = !sess.has_class ? "no_class" : (recordsBySession[sess.id] || "absent");
        calendar[key] = status;
        summary[status] = (summary[status] || 0) + 1;
      }
      return { calendar, summary };
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
  // 6. BAYESIAN — Predicted Final Grade
  // ══════════════════════════════════════════════════════════════════════
  function emptyPrediction() {
    return { predicted_grade: null, range_low: null, range_high: null, confidence: "95%", n_observations: 0, current_avg: null };
  }

  async function getPredictedFinalGrade(sb, studentId, subjectId = null) {
    const cacheKey = `bayesian.predicted_grade.subject_${subjectId || "all"}`;
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return emptyPrediction();
      const filterIds = subjectId ? [subjectId] : subjectIds;
      const filterSet = new Set(filterIds);

      const { data: subs, error } = await sb
        .from("activity_submissions")
        .select("score, max_score, activities(subject_id)")
        .eq("student_id", studentId).eq("is_graded", true).not("score", "is", null);
      if (error) throw new Error(error.message);

      const observations = (subs || [])
        .filter(s => s.activities && filterSet.has(s.activities.subject_id) && s.max_score > 0)
        .map(s => (s.score / s.max_score) * 100);

      const n = observations.length;
      if (n === 0) return emptyPrediction();

      const MU_0 = 78.0, TAU_0 = 1.0 / (12.0 ** 2);
      const SIGMA_L = 15.0, TAU_L = 1.0 / (SIGMA_L ** 2);

      const tauN = TAU_0 + n * TAU_L;
      const muN = (TAU_0 * MU_0 + TAU_L * observations.reduce((a, b) => a + b, 0)) / tauN;
      const sigmaN = Math.sqrt(1 / tauN);

      const Z_95 = 1.96;
      const lo = Math.max(0, Math.round((muN - Z_95 * sigmaN) * 10) / 10);
      const hi = Math.min(100, Math.round((muN + Z_95 * sigmaN) * 10) / 10);

      return {
        predicted_grade: Math.round(muN * 10) / 10,
        range_low: lo, range_high: hi, confidence: "95%", n_observations: n,
        current_avg: Math.round((observations.reduce((a, b) => a + b, 0) / n) * 10) / 10,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 7. BAYESIAN — Improvement Probability
  // ══════════════════════════════════════════════════════════════════════
  async function getImprovementProbability(sb, studentId, targetGrade = 90.0, subjectId = null) {
    const cacheKey = `bayesian.improvement_prob.subject_${subjectId || "all"}.target_${Math.trunc(targetGrade)}`;
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { probability: null, target_grade: targetGrade, n_observations: 0 };
      const filterIds = subjectId ? [subjectId] : subjectIds;
      const filterSet = new Set(filterIds);

      const { data: subs, error } = await sb
        .from("activity_submissions")
        .select("score, max_score, activities(subject_id)")
        .eq("student_id", studentId).eq("is_graded", true).not("score", "is", null);
      if (error) throw new Error(error.message);

      const filtered = (subs || []).filter(s => s.activities && filterSet.has(s.activities.subject_id) && s.max_score > 0);
      if (!filtered.length) return { probability: null, target_grade: targetGrade, n_observations: 0 };

      const ALPHA_0 = 2.0, BETA_0 = 2.0;
      const successes = filtered.filter(s => (s.score / s.max_score) * 100 >= targetGrade).length;
      const failures = filtered.length - successes;

      const alphaN = ALPHA_0 + successes, betaN = BETA_0 + failures;
      const pPosterior = alphaN / (alphaN + betaN);
      const probPct = Math.round(pPosterior * 1000) / 10;

      const label = probPct >= 75 ? "Very likely" : probPct >= 55 ? "Likely" : probPct >= 35 ? "Possible" : "Challenging";

      const currentAvg = filtered.reduce((acc, s) => acc + (s.score / s.max_score) * 100, 0) / filtered.length;

      return {
        probability: probPct, target_grade: targetGrade, label,
        n_observations: filtered.length, successes,
        current_avg: Math.round(currentAvg * 10) / 10,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. BAYESIAN — "Students Like You"
  // ══════════════════════════════════════════════════════════════════════
  async function getStudentsLikeYou(sb, studentId) {
    const cacheKey = "bayesian.students_like_you";
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) return { percentile: null, message: "Not enough data yet." };

      const { data: enrollRows } = await sb
        .from("student_subject_enrollments").select("student_id").in("subject_id", subjectIds);
      const allStudentIds = [...new Set((enrollRows || []).map(r => r.student_id))];
      if (!allStudentIds.includes(studentId)) allStudentIds.push(studentId);

      const peerPoolIds = allStudentIds.filter(id => id !== studentId).slice(0, 200);
      const targetIds = [...peerPoolIds, studentId];

      // Attendance
      const { data: sessions } = await sb
        .from("attendance_sessions").select("id").in("subject_id", subjectIds).eq("has_class", true);
      const sessionIds = (sessions || []).map(s => s.id);
      const totalSessions = sessionIds.length;

      const presentByStudent = new Map();
      if (sessionIds.length) {
        const { data: presentRows } = await sb
          .from("attendance_records").select("student_id")
          .in("session_id", sessionIds).in("student_id", targetIds).eq("status", "present");
        for (const r of (presentRows || [])) presentByStudent.set(r.student_id, (presentByStudent.get(r.student_id) || 0) + 1);
      }

      // Module completion
      const { count: totalMods } = await sb
        .from("modules").select("id", { count: "exact", head: true }).in("subject_id", subjectIds).eq("is_published", true);

      const readsByStudent = new Map();
      if (totalMods) {
        const { data: readRows } = await sb
          .from("student_module_reads").select("student_id").in("student_id", targetIds);
        for (const r of (readRows || [])) readsByStudent.set(r.student_id, (readsByStudent.get(r.student_id) || 0) + 1);
      }

      // Average score (join via activities, filtered to these subjects)
      const { data: subRows } = await sb
        .from("activity_submissions")
        .select("student_id, score, max_score, activities!inner(subject_id)")
        .in("student_id", targetIds).eq("is_graded", true).not("score", "is", null).gt("max_score", 0)
        .in("activities.subject_id", subjectIds);
      const scoresByStudent = new Map();
      for (const r of (subRows || [])) {
        const pct = (r.score / r.max_score) * 100;
        if (!scoresByStudent.has(r.student_id)) scoresByStudent.set(r.student_id, []);
        scoresByStudent.get(r.student_id).push(pct);
      }

      const compositeFor = (sid) => {
        const attRate = totalSessions ? (presentByStudent.get(sid) || 0) / totalSessions * 100 : 0;
        const modRate = totalMods ? (readsByStudent.get(sid) || 0) / totalMods * 100 : 0;
        const scores = scoresByStudent.get(sid) || [];
        const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return (attRate + modRate + avgScore) / 3;
      };

      const myComposite = compositeFor(studentId);
      const peerComposites = peerPoolIds.map(compositeFor);
      const percentile = percentileRank(myComposite, peerComposites);

      let message;
      if (percentile >= 75) message = `You perform better than ${percentile}% of students with similar engagement patterns.`;
      else if (percentile >= 50) message = `You are performing above the median — better than ${percentile}% of similar students.`;
      else if (percentile >= 25) message = `There is room to grow. You are currently ahead of ${percentile}% of similar students.`;
      else message = `You are in the bottom ${100 - percentile}% of similar students — this is a great moment to step up!`;

      const myAttRate = totalSessions ? (presentByStudent.get(studentId) || 0) / totalSessions * 100 : 0;
      const myModRate = totalMods ? (readsByStudent.get(studentId) || 0) / totalMods * 100 : 0;
      const myScores = scoresByStudent.get(studentId) || [];
      const myAvgScore = myScores.length ? myScores.reduce((a, b) => a + b, 0) / myScores.length : 0;

      return {
        percentile, message,
        my_profile: {
          attendance_rate: Math.round(myAttRate * 10) / 10,
          module_completion: Math.round(myModRate * 10) / 10,
          avg_score: Math.round(myAvgScore * 10) / 10,
        },
        peer_count: peerComposites.length,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 9. PERFORMANCE RATING — Academic 60% / Attendance 20% / Modules 20%
  // ══════════════════════════════════════════════════════════════════════
  //
  // Replaces the old logistic-regression "risk assessment" (hardcoded
  // coefficients wAtt=-3.5, wMod=-1.5, wAct=-2.0, wAvg=-4.0, b=5.5 fed into
  // a sigmoid). That model was: (a) not explainable in plain language to
  // teachers/panelists, (b) dominated by avgScorePct's -4.0 weight so a
  // single weak quiz could swing the whole rating, and (c) penalized
  // "activity completion" against the count of ALL published activities in
  // every enrolled subject — including ones not yet due — so a student who
  // was perfectly on track early in the term still scored a low completion
  // rate and could be misclassified.
  //
  // This version is a plain weighted percentage average of three
  // components, each already expressed on the same 0–100 scale:
  //   Performance Score = Academic×0.60 + Attendance×0.20 + Modules×0.20
  //
  // Academic Performance only ever includes activities that are actually
  // "applicable" (published, and either due already or undated):
  //   - graded submission            → counts as score/max_score×100
  //   - past due, never submitted    → counts as 0 (missed work still
  //                                     counts against you, but only once
  //                                     it was actually due)
  //   - submitted but not yet graded → excluded (can't score what the
  //                                     teacher hasn't graded yet)
  //   - not yet due                  → excluded (doesn't unfairly drag the
  //                                     average down before it's assigned)
  // ══════════════════════════════════════════════════════════════════════
  function ratingForScore(score) {
    if (score >= 90) return { rating: "Excellent", color: "excellent", emoji: "🟢" };
    if (score >= 80) return { rating: "Good", color: "good", emoji: "🟢" };
    if (score >= 70) return { rating: "Fair", color: "fair", emoji: "🟡" };
    if (score >= 60) return { rating: "Needs Improvement", color: "needs_improvement", emoji: "🟠" };
    return { rating: "At Risk", color: "at_risk", emoji: "🔴" };
  }

  async function getRiskAssessment(sb, studentId) {
    const cacheKey = "performance.rating";
    return cacheOrCompute(sb, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId);
      if (!subjectIds.length) {
        return { risk_level: "Unknown", rating: "Unknown", explanation: "No enrollment data found.", performance_score: null };
      }

      const nowIso = new Date().toISOString();

      // ── Attendance (20%) ────────────────────────────────────────────
      const { data: sessions } = await sb
        .from("attendance_sessions").select("id").in("subject_id", subjectIds).eq("has_class", true);
      let attRate = 0.0;
      const totalSessions = sessions?.length || 0;
      if (totalSessions) {
        const { count: presentCount } = await sb
          .from("attendance_records").select("id", { count: "exact", head: true })
          .in("session_id", sessions.map(s => s.id)).eq("student_id", studentId).eq("status", "present");
        attRate = (presentCount || 0) / totalSessions;
      }

      // ── Module Reading Progress (20%) ───────────────────────────────
      const { count: totalMods } = await sb
        .from("modules").select("id", { count: "exact", head: true }).in("subject_id", subjectIds).eq("is_published", true);
      const { count: reads } = await sb
        .from("student_module_reads").select("id", { count: "exact", head: true }).eq("student_id", studentId);
      const modRate = totalMods ? Math.min(1, (reads || 0) / totalMods) : null;

      // ── Academic Performance (60%) ──────────────────────────────────
      // Only activities that are actually applicable right now: published,
      // and either already due or with no due date set.
      const { data: applicableActs } = await sb
        .from("activities").select("id, due_date")
        .in("subject_id", subjectIds).eq("is_published", true)
        .or(`due_date.is.null,due_date.lte.${nowIso}`);
      const applicableIds = new Set((applicableActs || []).map(a => a.id));

      const { data: subs } = await sb
        .from("activity_submissions")
        .select("activity_id, score, max_score, is_graded")
        .eq("student_id", studentId).in("activity_id", [...applicableIds]);
      const submittedById = new Map((subs || []).map(s => [s.activity_id, s]));

      const academicValues = [];
      for (const actId of applicableIds) {
        const sub = submittedById.get(actId);
        if (sub && sub.is_graded && sub.score !== null && sub.max_score > 0) {
          academicValues.push((sub.score / sub.max_score) * 100);
        } else if (sub && !sub.is_graded) {
          continue; // submitted, awaiting grading — don't penalize or credit yet
        } else {
          academicValues.push(0); // past due, never submitted — counts as missed
        }
      }
      const academicPct = academicValues.length
        ? academicValues.reduce((a, b) => a + b, 0) / academicValues.length
        : null;

      // Not enough data yet to produce a fair rating (brand-new enrollment,
      // nothing due, no attendance/module records).
      if (academicPct === null && !totalSessions && !totalMods) {
        return { risk_level: "Unknown", rating: "Unknown", explanation: "Not enough activity yet to compute a rating.", performance_score: null };
      }

      // If a component genuinely has no applicable data yet (e.g. no
      // modules published, or no activities due yet), redistribute its
      // weight proportionally across the remaining components rather than
      // silently treating "no data" as "zero" — that would unfairly punish
      // a student for something outside their control.
      const parts = [
        { key: "academic", value: academicPct, weight: 0.60 },
        { key: "attendance", value: totalSessions ? attRate * 100 : null, weight: 0.20 },
        { key: "modules", value: totalMods ? modRate * 100 : null, weight: 0.20 },
      ];
      const known = parts.filter(p => p.value !== null);
      const knownWeightSum = known.reduce((a, p) => a + p.weight, 0);
      const performanceScore = knownWeightSum
        ? Math.round(known.reduce((a, p) => a + p.value * (p.weight / knownWeightSum), 0) * 10) / 10
        : null;

      if (performanceScore === null) {
        return { risk_level: "Unknown", rating: "Unknown", explanation: "Not enough activity yet to compute a rating.", performance_score: null };
      }

      const { rating, color, emoji } = ratingForScore(performanceScore);

      const signals = {
        academic_performance: academicPct !== null ? Math.round(academicPct * 10) / 10 : null,
        attendance_rate: totalSessions ? Math.round(attRate * 1000) / 10 : null,
        module_completion: totalMods ? Math.round(modRate * 1000) / 10 : null,
      };

      const factors = [];
      if (signals.academic_performance !== null && signals.academic_performance < 75) {
        factors.push(`Academic performance is ${signals.academic_performance}% across ${academicValues.length} applicable activit${academicValues.length === 1 ? "y" : "ies"}.`);
      }
      if (signals.attendance_rate !== null && signals.attendance_rate < 80) {
        factors.push(`Attendance is ${signals.attendance_rate}% (below the 80% healthy threshold).`);
      }
      if (signals.module_completion !== null && signals.module_completion < 60) {
        factors.push(`Only ${signals.module_completion}% of modules have been read.`);
      }
      if (!factors.length) factors.push("All indicators are within healthy ranges.");

      return {
        // New, explainable fields:
        performance_score: performanceScore, rating, color, emoji, factors, signals,
        breakdown: {
          academic: { value: signals.academic_performance, weight: 0.60 },
          attendance: { value: signals.attendance_rate, weight: 0.20 },
          modules: { value: signals.module_completion, weight: 0.20 },
        },
        // Back-compat aliases so any older caller keyed on risk_level still gets something sane:
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
