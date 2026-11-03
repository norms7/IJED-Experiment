"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  academicScore,
  attendanceScore,
  betaCredibleInterval,
  betaPosterior,
  calculateBayesianEstimate,
  getImprovementProbability,
  getStudentsLikeYou,
  isMissingLeaderboardRpc,
  leaderboardFallback,
  moduleScore,
  mergeStudentScores,
  overallScore,
  percentileRank,
  probBetaAbove,
  ratingForScore,
  regularizedIncompleteBeta,
  subjectScores,
  transmute,
  weightedScore,
} = require("../lms-frontend/assets/js/analytics.engine.js");

let passed = 0;
const pendingTests = [];

function test(name, callback) {
  const result = callback();
  if (result && typeof result.then === "function") {
    pendingTests.push(result.then(() => {
      passed++;
      console.log(`PASS ${name}`);
    }));
    return;
  }
  passed++;
  console.log(`PASS ${name}`);
}

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);
}

function closePercentage(actual, expected, tolerance = 1) {
  close(actual * 100, expected, tolerance);
}

test("weighted score and component examples", () => {
  assert.equal(weightedScore(88, 92, 60), 85.8);
  assert.equal(weightedScore(88, null, 60), 84.71);
  assert.equal(weightedScore([
    { value: 88, weight: 0.75 },
    { value: 92, weight: 0.15 },
    { value: 60, weight: 0.10 },
  ]), 85.8);
  assert.equal(subjectScores({ academicEarned: 58, academicPossible: 80 }).academicPct, 72.5);
  assert.equal(attendanceScore(7, 2, 1).percentage, 80);
  assert.equal(moduleScore(6, 10), 60);
  close((72.5 * 0.75 + 80 * 0.15 + 60 * 0.10), 72.375);
  assert.equal(ratingForScore(72.375).rating, "Needs Improvement");
  assert.equal(attendanceScore(8, 0, 0, 2).percentage, 100);
});

test("Beta-Binomial posterior, exact intervals, and class-tail probabilities", () => {
  const examples = [
    { own: [3, 2], peer: [3, 7], params: [4.2727, 4.7273], mean: 47.5, interval: [22, 74], tail: 85, threshold: 0.30 },
    { own: [0, 0], peer: [3, 7], params: [1.2727, 2.7273], mean: 31.8, interval: [4, 71], tail: 48, threshold: 0.30 },
    { own: [2, 0], peer: [3, 7], params: [3.2727, 2.7273], mean: 54.5, interval: [23, 85], tail: 89, threshold: 0.30 },
    { own: [0, 3], peer: [6, 2], params: [2.8889, 4.1111], mean: 41.3, interval: [14, 71], tail: 3, threshold: 0.75 },
  ];
  for (const example of examples) {
    const posterior = betaPosterior(
      ...example.own,
      ...example.peer,
      4,
      0,
      example.own[0] + example.own[1],
    );
    close(posterior.alpha, example.params[0], 1e-3);
    close(posterior.beta, example.params[1], 1e-3);
    closePercentage(posterior.mean, example.mean);
    const interval = betaCredibleInterval(posterior.alpha, posterior.beta, 0.90);
    closePercentage(interval.low, example.interval[0]);
    closePercentage(interval.high, example.interval[1]);
    closePercentage(probBetaAbove(posterior.alpha, posterior.beta, example.threshold), example.tail, 2);
  }
  const scores = [95, 88, 92, 85, 91];
  const ownResults = scores.reduce(
    (counts, score) => {
      counts[score >= 90 ? 0 : 1]++;
      return counts;
    },
    [0, 0],
  );
  assert.deepEqual(ownResults, [3, 2]);
});

test("regularized incomplete beta identities", () => {
  close(regularizedIncompleteBeta(0.5, 1, 1), 0.5);
  for (const [x, a, b] of [
    [0.2, 1.2, 2.8],
    [0.3, 4.2, 4.8],
    [0.75, 3, 4],
    [0.61, 8.5, 2.25],
  ]) {
    close(
      regularizedIncompleteBeta(x, a, b) +
        regularizedIncompleteBeta(1 - x, b, a),
      1,
      1e-12,
    );
  }
});

test("DepEd transmutation anchors and intermediate initial grade", () => {
  for (const [initial, expected] of [
    [100, 100],
    [98.4, 99],
    [75, 84],
    [72.375, 82],
    [61.6, 76],
    [60, 75],
    [59.99, 74],
    [4, 61],
    [0, 60],
  ]) {
    assert.equal(transmute(initial), expected, `${initial} should transmute to ${expected}`);
  }
  assert.equal(transmute(null), null);
});

test("mid-rank percentiles handle ties and empty peer groups", () => {
  assert.equal(percentileRank(50, [50, 50, 50]), 50);
  assert.equal(percentileRank(100, [10, 20, 90]), 100);
  assert.equal(percentileRank(0, [10, 20, 90]), 0);
  assert.equal(percentileRank(50, [50, 10]), 75);
  assert.equal(percentileRank(50, []), 50);
});

test("student score chart merge restores own graded scores and keeps pending work unplotted", () => {
  const rows = [
    { activity_id: 1, activity_name: "Scored", class_avg_pct: 80, status: null, my_score_pct: null },
    { activity_id: 2, activity_name: "Pending", class_avg_pct: 70, status: "awaiting_grade", my_score_pct: null },
    { activity_id: 3, activity_name: "Missing", class_avg_pct: 60, status: "missing", my_score_pct: null },
  ];
  const submissions = [
    {
      activity_id: 1,
      score: 72,
      max_score: null,
      is_graded: true,
      activities: { title: "Scored", subject_id: 10, term: "1st Term", max_score: 80 },
    },
    {
      activity_id: 2,
      score: null,
      max_score: null,
      is_graded: false,
      activities: { title: "Pending", subject_id: 10, term: "1st", max_score: 100 },
    },
  ];
  const merged = mergeStudentScores(rows, submissions, [10], "first");
  assert.equal(merged[0].my_score_pct, 90);
  assert.equal(merged[0].diff_pct, 10);
  assert.equal(merged[0].status, "graded");
  assert.equal(merged[1].my_score_pct, null);
  assert.equal(merged[1].status, "awaiting_grade");
  assert.equal(merged[2].status, "missing");
  assert.equal(mergeStudentScores(rows, submissions, [11], "first")[0].my_score_pct, null);
});

test("missing leaderboard RPC falls back without blocking Bayesian analytics", async () => {
  assert.equal(isMissingLeaderboardRpc({
    code: "PGRST202",
    message: "Could not find the function public.get_engagement_leaderboard",
  }), true);
  assert.equal(isMissingLeaderboardRpc({ code: "42501", message: "Not authorized" }), false);

  const fallback = leaderboardFallback({
    percentile: 75,
    engagement_score: 82,
    my_attendance_rate: 80,
    my_module_completion: 84,
    peer_count: 4,
  });
  assert.equal(fallback.leaderboard_unavailable, true);
  assert.equal(fallback.percentile, 75);
  assert.equal(fallback.my_profile.attendance_rate, 80);

  const calls = [];
  const sb = {
    async rpc(name) {
      calls.push(name);
      if (name === "analytics_cache_get") return { data: null, error: null };
      if (name === "get_engagement_leaderboard") {
        return {
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.get_engagement_leaderboard",
          },
        };
      }
      if (name === "get_engagement_percentile") {
        return {
          data: {
            percentile: 75,
            engagement_score: 82,
            my_attendance_rate: 80,
            my_module_completion: 84,
            peer_count: 4,
          },
          error: null,
        };
      }
      if (name === "analytics_cache_set") return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  const originalWarn = console.warn;
  let result;
  try {
    console.warn = () => {};
    result = await getStudentsLikeYou(sb, 17, 5);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(calls, [
    "analytics_cache_get",
    "get_engagement_leaderboard",
    "get_engagement_percentile",
    "analytics_cache_set",
  ]);
  assert.equal(result.leaderboard_unavailable, true);
  assert.equal(result.percentile, 75);
});

test("shared Bayesian engine validates inputs and handles no-evidence cases", () => {
  const estimate = calculateBayesianEstimate(4, 1, 7, 3, 75, 4, 0, 5);
  assert.ok(estimate.probability > 0 && estimate.probability < 1);
  assert.ok(estimate.posteriorAlpha > 0 && estimate.posteriorBeta > 0);
  assert.ok(Number.isFinite(estimate.lower));
  assert.ok(Number.isFinite(estimate.upper));
  assert.ok(estimate.lower < estimate.upper);
  assert.equal(calculateBayesianEstimate(0, 0, 0, 0, 75, 4, 0, 0).probability, null);
  assert.throws(() => calculateBayesianEstimate(-1, 0, 0, 0, 75, 4, 0, 0), /non-negative/);
  assert.throws(() => calculateBayesianEstimate(0, 0, 0, 0, 101, 4, 0, 0), /between 0 and 100/);
});

test("Bayesian edge cohorts and missing evidence semantics", () => {
  const allSuccessfulPeers = calculateBayesianEstimate(0, 0, 5, 0, 75, 4, 0, 0);
  const allUnsuccessfulPeers = calculateBayesianEstimate(0, 0, 0, 5, 75, 4, 0, 0);
  const allSuccessfulOwn = calculateBayesianEstimate(4, 0, 0, 0, 75, 4, 0, 4);
  const allUnsuccessfulOwn = calculateBayesianEstimate(0, 4, 0, 0, 75, 4, 0, 4);
  const noEvidence = calculateBayesianEstimate(0, 0, 0, 0, 75, 4, 0, 0);

  assert.ok(allSuccessfulPeers.predictiveProbability > 0.9);
  assert.ok(allUnsuccessfulPeers.predictiveProbability < 0.1);
  close(allSuccessfulOwn.predictiveProbability, 0.75);
  close(allUnsuccessfulOwn.predictiveProbability, 0.25);
  assert.equal(noEvidence.predictiveProbability, null);

  const withMissing = calculateBayesianEstimate(1, 3, 0, 0, 75, 4, 2, 2);
  assert.equal(withMissing.evidenceCount, 4);
  assert.equal(withMissing.gradedActivityCount, 2);
  assert.equal(withMissing.missingActivityCount, 2);
  assert.equal(withMissing.ownFailures, 3);
  assert.equal(withMissing.posteriorBeta, 5);
  assert.equal(withMissing.lowEvidenceIndicator, true);

  const manyMissing = calculateBayesianEstimate(3, 10, 0, 0, 75, 4, 10, 3);
  assert.equal(manyMissing.evidenceCount, 13);
  assert.equal(manyMissing.gradedActivityCount, 3);
  assert.equal(manyMissing.lowEvidenceIndicator, false);

  const studentEstimate = calculateBayesianEstimate(2, 2, 7, 4, 85, 4, 1, 3);
  const teacherEstimate = calculateBayesianEstimate(2, 2, 7, 4, 85, 4, 1, 3);
  assert.deepEqual(teacherEstimate, studentEstimate);
});

test("teacher row uses the same Bayesian estimate as student analytics", () => {
  const context = { AnalyticsEngine: require("../lms-frontend/assets/js/analytics.engine.js") };
  const controllerSource = fs.readFileSync(
    require.resolve("../lms-frontend/controllers/class-performance.controller.js"),
    "utf8",
  );
  vm.runInNewContext(
    `${controllerSource}\nthis.ClassPerformanceController = ClassPerformanceController;`,
    context,
  );

  const row = context.ClassPerformanceController._prepareRow({
    student_id: 1,
    academic_earned: 80,
    academic_possible: 100,
    attendance_weighted: 0,
    attendance_sessions: 0,
    modules_read: 0,
    modules_total: 0,
    my_successes: 2,
    my_failures: 2,
    my_graded_count: 3,
    my_missing_count: 1,
    class_successes: 9,
    class_failures: 6,
  });
  const studentEstimate = calculateBayesianEstimate(2, 2, 7, 4, 75, 4, 1, 3);

  close(row.next_probability, Math.round(studentEstimate.predictiveProbability * 1000) / 10);
  close(row.credible_low, Math.round(studentEstimate.credibleInterval.low * 1000) / 10);
  close(row.credible_high, Math.round(studentEstimate.credibleInterval.high * 1000) / 10);
  close(row.probability_above_peers, Math.round(studentEstimate.probabilityAbovePeers * 1000) / 10);
  assert.equal(row.bayesian_graded_count, studentEstimate.gradedActivityCount);
  assert.equal(row.bayesian_missing_count, studentEstimate.missingActivityCount);
  assert.equal(row.low_confidence, studentEstimate.lowEvidenceIndicator);
});

test("Bayesian evidence counts reject invalid values", () => {
  const validCounts = [1, 1, 2, 2, 75, 4, 0, 2];
  const invalidCounts = [null, undefined, "", "   ", -1, 1.5, NaN, Infinity, -Infinity];
  for (const index of [0, 1, 2, 3, 6, 7]) {
    for (const invalid of invalidCounts) {
      const inputs = [...validCounts];
      inputs[index] = invalid;
      assert.throws(() => calculateBayesianEstimate(...inputs), /non-negative integer/);
    }
  }
});

test("Bayesian evidence remains available when descriptive prediction fails", async () => {
  const calls = [];
  const sb = {
    async rpc(name) {
      calls.push(name);
      if (name === "analytics_cache_get") return { data: null, error: null };
      if (name === "get_beta_binomial_evidence") {
        return {
          data: {
            my_successes: 2,
            my_failures: 2,
            my_graded_count: 3,
            my_missing_count: 1,
            peer_successes: 7,
            peer_failures: 4,
          },
          error: null,
        };
      }
      if (name === "analytics_cache_set") return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from() {
      throw new Error("Descriptive data unavailable");
    },
  };

  const result = await getImprovementProbability(sb, 17, 85, 5);

  assert.equal(result.probability, 56);
  assert.equal(result.predicted_grade, null);
  assert.equal(result.prediction_unavailable, true);
  assert.equal(result.prediction_error, true);
  assert.equal(result.prediction_status, "error");
  assert.equal(result.graded_activity_count, 3);
  assert.equal(result.missing_count, 1);
  assert.equal(result.graded_failure_count, 1);
  assert.equal(result.evidence_count, 4);
  assert.ok(calls.indexOf("get_beta_binomial_evidence") < calls.lastIndexOf("analytics_cache_get"));
});

test("zero-data, missing-score, due-date, and D2 edge cases", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.deepEqual(academicScore([], now), {
    earned: 0, possible: 0, gradedCount: 0, missingCount: 0, percentage: null,
  });
  assert.equal(attendanceScore(0, 0, 0, 0).percentage, null);
  assert.equal(moduleScore(0, 0), null);
  assert.equal(subjectScores({
    academicEarned: 0, academicPossible: 0,
    attendanceWeighted: 0, attendanceSessions: 0,
    modulesRead: 0, modulesTotal: 0,
  }).academicPct, null);

  const academic = academicScore([
    { max_score: 0, due_date: "2026-10-01T00:00:00Z" },
    { max_score: null, due_date: "2026-10-01T00:00:00Z" },
    { max_score: 20, due_date: "2026-11-01T00:00:00Z" },
    { max_score: 10, due_date: "2026-10-01T00:00:00Z", submission: { is_graded: false } },
    { max_score: 10, due_date: "2026-10-01T00:00:00Z", submission: { is_graded: true, score: 8, max_score: null } },
    { max_score: 0, due_date: "2026-10-01T00:00:00Z", submission: { is_graded: true, score: 6, max_score: null } },
  ], now);
  assert.deepEqual(academic, {
    earned: 8, possible: 10, gradedCount: 1, missingCount: 0, percentage: 80,
  });
  assert.deepEqual(academicScore([
    { max_score: 15, due_date: "2026-10-01T00:00:00Z" },
  ], now), {
    earned: 0, possible: 15, gradedCount: 0, missingCount: 1, percentage: 0,
  });

  const students = [
    { academicEarned: 50, academicPossible: 100 },
    { attendanceWeighted: 10, attendanceSessions: 10 },
    { academicEarned: 0, academicPossible: 0, attendanceWeighted: 0, attendanceSessions: 0, modulesRead: 0, modulesTotal: 0 },
  ];
  assert.equal(overallScore(students), 75);
  assert.equal(overallScore([students[2]]), null);
  assert.equal(ratingForScore(overallScore([students[2]])).rating, "Unknown");
  assert.equal(betaPosterior(0, 0, 0, 0, 4, 0, 0).classRate, 0.5);
});

Promise.all(pendingTests)
  .then(() => {
    console.log(`\n${passed} performance test groups passed.`);
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
