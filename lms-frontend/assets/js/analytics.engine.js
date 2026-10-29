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

const DESCRIPTIVE_TTL_SECONDS = 300;
const BAYESIAN_TTL_SECONDS = 600;

const AnalyticsEngine = (() => {

  function normalizeTerm(value) {
    const term = String(value || "").trim().toLowerCase();
    const match = term.match(/^(1st|first|1|2nd|second|2|3rd|third|3|4th|fourth|4)(?:\s+(?:term|quarter))?$/);
    if (!match) return term || null;
    if (["1st", "first", "1"].includes(match[1])) return "1st";
    if (["2nd", "second", "2"].includes(match[1])) return "2nd";
    if (["3rd", "third", "3"].includes(match[1])) return "3rd";
    return "4th";
  }

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
    const scopedKey = `analytics_scope_v2.student_${studentId}.${cacheKey}`;
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
    const equal = population.filter(v => v === value).length;
    return Math.round(((below + 0.5 * equal) / population.length) * 100);
  }

  function isMissingLeaderboardRpc(error) {
    return error?.code === "PGRST202"
      || /could not find the function[\s\S]*get_engagement_leaderboard/i.test(error?.message || "");
  }

  function leaderboardFallback(data) {
    return {
      percentile: data?.percentile ?? null,
      leaderboard: [],
      leaderboard_unavailable: true,
      message: "Leaderboard names are unavailable until the latest database migration is applied.",
      engagement_score: data?.engagement_score ?? null,
      my_rank: null,
      my_profile: {
        attendance_rate: data?.my_attendance_rate ?? null,
        module_completion: data?.my_module_completion ?? null,
      },
      peer_count: data?.peer_count ?? 0,
    };
  }

  function mergeStudentScores(scoreRows, submissionRows, subjectIds, term) {
    const subjects = new Set(subjectIds || []);
    const selectedTerm = normalizeTerm(term);
    const eligible = (submissionRows || []).filter(submission => {
      const activity = submission.activities;
      return activity
        && subjects.has(activity.subject_id)
        && (!selectedTerm || normalizeTerm(activity.term) === selectedTerm);
    });
    const byId = new Map(eligible.map(submission => [submission.activity_id, submission]));
    const byTitle = new Map();
    for (const submission of eligible) {
      const title = submission.activities.title;
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push(submission);
    }

    return (scoreRows || []).map(row => {
      const submission = row.activity_id != null
        ? byId.get(row.activity_id)
        : (byTitle.get(row.activity_name) || []).length === 1
          ? byTitle.get(row.activity_name)[0]
          : null;
      if (!submission) return row;

      if (!submission.is_graded || submission.score == null) {
        return { ...row, status: "awaiting_grade", my_score_pct: null, diff_pct: null };
      }

      const submissionMax = Number(submission.max_score);
      const activityMax = Number(submission.activities.max_score);
      const maxScore = submissionMax > 0 ? submissionMax : activityMax;
      if (!(maxScore > 0)) return row;

      const scorePct = Math.round((Number(submission.score) / maxScore * 100) * 10) / 10;
      const classAverage = Number(row.class_avg_pct);
      return {
        ...row,
        status: "graded",
        my_score_pct: scorePct,
        diff_pct: Number.isFinite(classAverage)
          ? Math.round((scorePct - classAverage) * 10) / 10
          : null,
      };
    });
  }

  const COMPONENT_WEIGHTS = Object.freeze({ academic: 0.75, attendance: 0.15, modules: 0.10 });

  function weightedScore(academic, attendance, modules) {
    const parts = Array.isArray(academic)
      ? academic
      : [
      { value: academic, weight: 0.75 },
      { value: attendance, weight: 0.15 },
      { value: modules, weight: 0.10 },
      ];
    const components = parts.filter(part =>
      part.value !== null && part.value !== undefined && Number.isFinite(part.value));
    const totalWeight = components.reduce((sum, part) => sum + part.weight, 0);
    if (!totalWeight) return null;
    return Math.round(components.reduce((sum, part) =>
      sum + part.value * (part.weight / totalWeight), 0) * 100) / 100;
  }

  function subjectScores(components = {}) {
    const percentage = (earned, possible) =>
      Number.isFinite(earned) && Number.isFinite(possible) && possible > 0
        ? earned / possible * 100
        : null;
    return {
      academicPct: components.academicPct ?? percentage(
        components.academicEarned ?? components.academic_earned,
        components.academicPossible ?? components.academic_possible,
      ),
      attendancePct: components.attendancePct ?? percentage(
        components.attendanceWeighted ?? components.attendance_weighted,
        components.attendanceSessions ?? components.attendance_sessions,
      ),
      modulePct: components.modulePct ?? percentage(
        components.modulesRead ?? components.modules_read,
        components.modulesTotal ?? components.modules_total,
      ),
    };
  }

  function overallScore(subjectsComponents = []) {
    const scores = subjectsComponents.map(subject => {
      const { academicPct, attendancePct, modulePct } = subjectScores(subject);
      return weightedScore(academicPct, attendancePct, modulePct);
    }).filter(score => score !== null);
    return scores.length
      ? Math.round((scores.reduce((total, score) => total + score, 0) / scores.length) * 100) / 100
      : null;
  }

  function academicScore(activities = [], now = new Date()) {
    let earned = 0;
    let possible = 0;
    let gradedCount = 0;
    let missingCount = 0;
    for (const activity of activities) {
      const submission = activity.submission ?? activity._submission ?? null;
      const maxScore = Number(submission?.max_score) > 0
        ? Number(submission.max_score)
        : Number(activity.max_score);
      if (submission?.is_graded && submission.score !== null && submission.score !== undefined &&
          Number.isFinite(maxScore) && maxScore > 0) {
        earned += Number(submission.score);
        possible += maxScore;
        gradedCount++;
      } else if (submission) {
        continue;
      } else if ((activity.due_date == null || new Date(activity.due_date) <= now) &&
          Number.isFinite(maxScore) && maxScore > 0) {
        possible += maxScore;
        missingCount++;
      }
    }
    return {
      earned,
      possible,
      gradedCount,
      missingCount,
      percentage: possible > 0 ? earned / possible * 100 : null,
    };
  }

  function attendanceScore(present = 0, late = 0, absent = 0, excused = 0) {
    const sessions = present + late + absent;
    return {
      sessions,
      percentage: sessions > 0 ? (present + late * 0.5) / sessions * 100 : null,
      excludedExcused: excused,
    };
  }

  function moduleScore(read, total) {
    return Number.isFinite(read) && Number.isFinite(total) && total > 0
      ? read / total * 100
      : null;
  }

  function betaPosterior(mySuccesses, myFailures, peerSuccesses, peerFailures, priorStrength = 4) {
    const peerTotal = peerSuccesses + peerFailures;
    const classRate = peerTotal ? peerSuccesses / peerTotal : 0.5;
    const priorAlpha = classRate * priorStrength;
    const priorBeta = (1 - classRate) * priorStrength;
    const alpha = priorAlpha + mySuccesses;
    const beta = priorBeta + myFailures;
    return {
      alpha,
      beta,
      mean: alpha + beta ? alpha / (alpha + beta) : null,
      classRate,
      priorAlpha,
      priorBeta,
    };
  }

  function logGamma(z) {
    const coefficients = [
      676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    const x = z - 1;
    let sum = 0.99999999999980993;
    for (let i = 0; i < coefficients.length; i++) sum += coefficients[i] / (x + i + 1);
    const t = x + coefficients.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
  }

  function betaContinuedFraction(a, b, x) {
    const maxIterations = 300;
    const epsilon = 3e-14;
    const tiny = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= maxIterations; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < epsilon) return h;
    }
    throw new Error("Incomplete beta continued fraction did not converge.");
  }

  function regularizedIncompleteBeta(x, a, b) {
    if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) {
      throw new RangeError("Beta parameters must be finite and positive.");
    }
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const factor = Math.exp(
      logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log1p(-x),
    );
    if (x < (a + 1) / (a + b + 2)) {
      return factor * betaContinuedFraction(a, b, x) / a;
    }
    return 1 - factor * betaContinuedFraction(b, a, 1 - x) / b;
  }

  function betaQuantile(probability, alpha, beta) {
    if (!(probability >= 0 && probability <= 1)) throw new RangeError("Probability must be in [0, 1].");
    if (probability === 0) return 0;
    if (probability === 1) return 1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 90; i++) {
      const middle = (low + high) / 2;
      if (regularizedIncompleteBeta(middle, alpha, beta) < probability) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function betaCredibleInterval(alpha, beta, level = 0.90) {
    const tail = (1 - level) / 2;
    return {
      low: betaQuantile(tail, alpha, beta),
      high: betaQuantile(1 - tail, alpha, beta),
    };
  }

  function probBetaAbove(alpha, beta, x) {
    return 1 - regularizedIncompleteBeta(x, alpha, beta);
  }

  function transmute(initialGrade) {
    if (initialGrade === null || initialGrade === undefined || !Number.isFinite(initialGrade)) return null;
    const rawGrade = initialGrade >= 60
      ? 75 + Math.floor((initialGrade - 60) / 1.6 + 1e-9)
      : 60 + Math.floor(initialGrade / 4 + 1e-9);
    return Math.min(100, rawGrade);
  }

  function ratingForScore(score) {
    if (score === null || score === undefined || !Number.isFinite(score)) return { rating: "Unknown", color: "unknown", emoji: "" };
    if (score >= 90) return { rating: "Excellent", color: "excellent", emoji: "🟢" };
    if (score >= 85) return { rating: "Very Good", color: "very_good", emoji: "🟩" };
    if (score >= 80) return { rating: "Good", color: "good", emoji: "🔵" };
    if (score >= 75) return { rating: "Fair", color: "fair", emoji: "🟡" };
    if (score >= 70) return { rating: "Needs Improvement", color: "needs_improvement", emoji: "🟠" };
    return { rating: "At Risk", color: "at_risk", emoji: "🔴" };
  }

  function betaBinomialMean(peerSuccesses, peerFailures, ownSuccesses, ownFailures) {
    const peerTotal = peerSuccesses + peerFailures;
    const classRate = peerTotal ? peerSuccesses / peerTotal : 0.5;
    const alpha = classRate * 4 + ownSuccesses;
    const beta = (1 - classRate) * 4 + ownFailures;
    return (alpha + beta) ? alpha / (alpha + beta) : null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 1. DESCRIPTIVE — Grade Progress
  // ══════════════════════════════════════════════════════════════════════
  async function getGradeProgress(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `descriptive.grade_progress.v6.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
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
    const cacheKey = `descriptive.attendance.v6.subject_${subjectId || "all"}.y${year || "x"}.m${month || "x"}.term_${term || "all"}.semester_${semester || "all"}`;
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
  //    engagement-percentile view (§8).
  // ══════════════════════════════════════════════════════════════════════
  async function getScoreVsClassAverage(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `descriptive.score_vs_avg.v8.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = subjectId ? [subjectId] : await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { data: [] };
      const { data, error } = await sb.rpc("get_score_vs_class_average", {
        p_student_id: studentId,
        p_subject_ids: subjectIds,
        p_term: term,
      });
      if (error) throw new Error(error.message);

      const { data: submissions, error: submissionError } = await sb
        .from("activity_submissions")
        .select("activity_id, score, max_score, is_graded, activities(id, title, subject_id, term, max_score)")
        .eq("student_id", studentId);
      if (submissionError) throw new Error(submissionError.message);

      return {
        data: mergeStudentScores(data?.data || [], submissions || [], subjectIds, term),
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. DESCRIPTIVE — Module Reading Progress
  // ══════════════════════════════════════════════════════════════════════
  async function getModuleReadingProgress(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `descriptive.module_progress.v6.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, DESCRIPTIVE_TTL_SECONDS, async () => {
      const subjectIds = await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) return { subjects: [], totals: { read: 0, total: 0, pct: 0 } };
      const filterIds = subjectId ? [subjectId] : subjectIds;

      const modQuery = sb
        .from("modules").select("*").in("subject_id", filterIds).eq("is_published", true)
        .order("subject_id").order("order");
      const { data: fetchedModules, error: mErr } = await modQuery;
      if (mErr) throw new Error(mErr.message);
      const selectedTerm = normalizeTerm(term);
      const modules = (fetchedModules || [])
        .filter(module => !selectedTerm || normalizeTerm(module.term) === selectedTerm);

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
    const cacheKey = `descriptive.subject_radar.v6.term_${term || "all"}.semester_${semester || "all"}`;
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
        if (term && normalizeTerm(sub.activities?.term) !== normalizeTerm(term)) continue;
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
    const cacheKey = `predicted_grade.v6.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const perf = await computePerformanceComponents(sb, studentId, subjectId, term, semester);
      if (!perf) return emptyPrediction();

      const { academicPct, attendancePct, modulePct, countedActivities, factors } = perf;

      const predicted = weightedScore(academicPct, attendancePct, modulePct);
      if (predicted === null) return emptyPrediction();

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
        graded_count: perf.gradedCount || 0,
        low_confidence: (perf.gradedCount || 0) < LOW_EVIDENCE_N,
        missing_count: perf.missingCount,
        current_avg: academicPct !== null ? Math.round(academicPct * 100) / 100 : null,
        components: {
          academic: academicPct,
          attendance: attendancePct,
          modules: modulePct,
        },
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
  const LOW_EVIDENCE_N = 3;

  async function getImprovementProbability(sb, studentId, targetGrade = 90.0, subjectId = null, term = null, semester = null) {
    const cacheKey = `improvement_prob.v6.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}.target_${Math.trunc(targetGrade)}`;
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
      const posterior = betaPosterior(mySucc, myFail, peerSucc, peerFail, PRIOR_STRENGTH);
      const { alpha, beta, mean } = posterior;
      const probability = Math.round(mean * 100);
      const credible = betaCredibleInterval(alpha, beta, 0.90);
      const credibleLow = Math.max(0, Math.round(credible.low * 100));
      const credibleHigh = Math.min(100, Math.round(credible.high * 100));
      const aboveClassAvgProbability = Math.round(
        probBetaAbove(alpha, beta, posterior.classRate) * 100,
      );

      const evidenceCount = mySucc + myFail;
      const label = probability >= 80 ? "Very likely" : probability >= 60 ? "Likely" : probability >= 40 ? "Possible" : "Challenging";

      const gap = targetGrade - predicted;
      let recommendation;
      if (evidenceCount === 0) {
        recommendation = `This estimate is currently based on your class's history at the ${targetGrade}% mark, since you don't have a graded activity of your own yet — it will sharpen as your results come in.`;
      } else if (gap <= 0) {
        recommendation = probability >= 60
          ? "You're already on track to meet or exceed this target grade."
          : "Your overall blended average already meets this target — but your individual graded activities haven't consistently hit it yet, since attendance and module progress are currently carrying some of the weight. Worth keeping an eye on, even though the big picture looks fine.";
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
        class_rate_at_target: Math.round(posterior.classRate * 100),
        class_rate_exact: posterior.classRate,
        class_successes: peerSucc,
        class_failures: peerFail,
        prior_alpha: posterior.priorAlpha,
        prior_beta: posterior.priorBeta,
        my_successes: mySucc,
        my_failures: myFail,
        posterior_alpha: alpha,
        posterior_beta: beta,
        posterior_mean: mean,
        missing_count: prediction.missing_count || 0,
        above_class_average_probability: aboveClassAvgProbability,
        low_confidence: (prediction.graded_count || 0) < LOW_EVIDENCE_N,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 8. Engagement index & peer percentile (§8)
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
    const cacheKey = `bayesian.engagement_leaderboard.v2.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
    return cacheOrCompute(sb, studentId, cacheKey, BAYESIAN_TTL_SECONDS, async () => {
      const subjectIds = subjectId ? [subjectId] : await resolveSubjectIds(sb, studentId, semester);
      if (!subjectIds.length) {
        return { percentile: null, leaderboard: [], my_rank: null, message: "No section performance data yet." };
      }

      const { data, error } = await sb.rpc("get_engagement_leaderboard", {
        p_student_id: studentId,
        p_subject_ids: subjectIds,
        p_term: term,
      });
      if (error) {
        if (!isMissingLeaderboardRpc(error)) throw new Error(error.message);
        console.warn("Engagement leaderboard RPC is missing; using the legacy percentile result until migration 08 is applied.");
        const { data: legacyData, error: legacyError } = await sb.rpc("get_engagement_percentile", {
          p_student_id: studentId,
          p_subject_ids: subjectIds,
          p_term: term,
        });
        if (legacyError) {
          console.error("Could not load legacy engagement percentile:", legacyError.message);
          return leaderboardFallback(null);
        }
        return leaderboardFallback(legacyData);
      }

      const percentile = data?.percentile ?? null;
      const peerCount = data?.peer_count || 0;
      const myRank = data?.my_rank ?? null;
      const message = myRank
        ? `You are ranked #${myRank} among ${peerCount + 1} section-mates with available engagement data.`
        : "Your engagement rank will appear when attendance or module-reading data is available.";

      return {
        percentile, message,
        engagement_score: data?.engagement_score ?? null,
        my_rank: myRank,
        leaderboard: data?.leaderboard || [],
        my_profile: {
          attendance_rate: data?.my_attendance_rate ?? null,
          module_completion: data?.my_module_completion ?? null,
        },
        peer_count: peerCount,
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
  // getRiskAssessment() (§4/§5) and getPredictedFinalGrade() (§6) both call
  // it, and both now use the same 75/15/10 Academic/Attendance/Module
  // weighting (see §6 comment above for why the two cards were unified), so
  // the Academic/Attendance/Module percentages shown on both cards are
  // always identical.
  // ══════════════════════════════════════════════════════════════════════
  async function computePerformanceComponents(sb, studentId, subjectId = null, term = null, semester = null) {
    const allSubjectIds = await resolveSubjectIds(sb, studentId, semester);
    if (!allSubjectIds.length) return null;
    const subjectIds = subjectId ? allSubjectIds.filter(id => id === subjectId) : allSubjectIds;
    if (!subjectIds.length) return null;

    const now = new Date();

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
    const modQuery = sb.from("modules").select("id, term").in("subject_id", subjectIds).eq("is_published", true);
    const { data: modsInScope, error: modErr } = await modQuery;
    if (modErr) throw new Error(modErr.message);
    const selectedTerm = normalizeTerm(term);
    const modIds = (modsInScope || [])
      .filter(module => !selectedTerm || normalizeTerm(module.term) === selectedTerm)
      .map(module => module.id);
    const totalMods = modIds.length;

    // ── §3 Module Score: Modules Read / Total Modules ─────────────────────
    // FIX: this used to count ALL of the student's module reads across
    // their entire account, uncorrelated to subject or term, and just
    // clamped it against totalMods — only "worked" by coincidence. Now
    // properly scoped to the modules actually in scope.
    const { data: readRows, error: readErr } = totalMods
      ? await sb.from("student_module_reads").select("module_id")
          .eq("student_id", studentId).in("module_id", modIds)
      : { data: [], error: null };
    if (readErr) throw new Error(readErr.message);
    const readModuleIds = new Set((readRows || []).map(read => read.module_id));
    const modulePct = totalMods
      ? (modIds.filter(moduleId => readModuleIds.has(moduleId)).length / totalMods) * 100
      : null;

    // ── §1 Academic Score: Total Earned / Total Possible ──────────────────
    // Graded submissions count as soon as they're graded, even if the due
    // date is still in the future. Unsubmitted activities count only once
    // due (or if undated), as 0 earned against their own max_score.
    // Term scoping: activities.term is a direct column, set explicitly when
    // the teacher creates the activity -- filtered straight, no join needed.
    const actQuery = sb
      .from("activities").select("id, max_score, due_date, term")
      .in("subject_id", subjectIds).eq("is_published", true);
    const { data: activities, error: actErr } = await actQuery;
    if (actErr) throw new Error(actErr.message);
    const applicableActs = (activities || [])
      .filter(activity => !selectedTerm || normalizeTerm(activity.term) === selectedTerm);

    const { data: subs, error: subsErr } = await sb
      .from("activity_submissions")
      .select("activity_id, score, max_score, is_graded")
      .eq("student_id", studentId)
      .in("activity_id", (applicableActs || []).map(a => a.id));
    if (subsErr) throw new Error(subsErr.message);
    const submittedById = new Map((subs || []).map(s => [s.activity_id, s]));

    let totalEarned = 0, totalPossible = 0, countedActivities = 0, gradedCount = 0, missingCount = 0;
    for (const act of (applicableActs || [])) {
      const sub = submittedById.get(act.id);
      const maxScore = sub?.max_score > 0 ? sub.max_score : act.max_score;
      if (sub && sub.is_graded && sub.score !== null && maxScore > 0) {
        totalEarned += sub.score;
        totalPossible += maxScore;
        countedActivities++;
        gradedCount++;
      } else if (sub && !sub.is_graded) {
        continue; // submitted, awaiting grading — can't score it yet, don't penalize
      } else if (!sub && (!act.due_date || new Date(act.due_date) <= now) && act.max_score > 0) {
        // due or undated, never submitted → missed work counts as 0/max_score
        totalPossible += act.max_score;
        countedActivities++;
        missingCount++;
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
      gradedCount,
      missingCount,
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
  async function getRiskAssessment(sb, studentId, subjectId = null, term = null, semester = null) {
    const cacheKey = `performance.rating.v6.subject_${subjectId || "all"}.term_${term || "all"}.semester_${semester || "all"}`;
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
      const performanceScore = weightedScore(academicPct, attendancePct, modulePct);

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
        missing_count: perf.missingCount,
        low_confidence: (perf.gradedCount || 0) < LOW_EVIDENCE_N,
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
    normalCdf, percentileRank, isMissingLeaderboardRpc, leaderboardFallback,
    mergeStudentScores, weightedScore, subjectScores, overallScore,
    academicScore, attendanceScore, moduleScore, transmute, ratingForScore,
    betaPosterior, regularizedIncompleteBeta, betaCredibleInterval, probBetaAbove,
    betaBinomialMean, LOW_EVIDENCE_N, COMPONENT_WEIGHTS,
    getGradeProgress, getAttendanceCalendar, getScoreVsClassAverage,
    getModuleReadingProgress, getSubjectRadar,
    getPredictedFinalGrade, getImprovementProbability, getStudentsLikeYou, getRiskAssessment,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = AnalyticsEngine;
}