"use strict";

const assert = require("node:assert/strict");
const {
  academicScore,
  attendanceScore,
  betaCredibleInterval,
  betaPosterior,
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

function closePercentage(actual, expected) {
  close(actual * 100, expected, 1);
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
    { own: [3, 2], peer: [3, 7], params: [4.2, 4.8], mean: 46.7, interval: [21, 73], tail: 84, threshold: 0.30 },
    { own: [0, 0], peer: [3, 7], params: [1.2, 2.8], mean: 30.0, interval: [3, 69], tail: 44, threshold: 0.30 },
    { own: [2, 0], peer: [3, 7], params: [3.2, 2.8], mean: 53.3, interval: [22, 84], tail: 88, threshold: 0.30 },
    { own: [0, 3], peer: [6, 2], params: [3, 4], mean: 42.9, interval: [15, 73], tail: 4, threshold: 0.75 },
  ];
  for (const example of examples) {
    const posterior = betaPosterior(...example.own, ...example.peer);
    close(posterior.alpha, example.params[0]);
    close(posterior.beta, example.params[1]);
    closePercentage(posterior.mean, example.mean);
    const interval = betaCredibleInterval(posterior.alpha, posterior.beta, 0.90);
    closePercentage(interval.low, example.interval[0]);
    closePercentage(interval.high, example.interval[1]);
    closePercentage(probBetaAbove(posterior.alpha, posterior.beta, example.threshold), example.tail);
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
  assert.equal(betaPosterior(0, 0, 0, 0).classRate, 0.5);
});

Promise.all(pendingTests)
  .then(() => {
    console.log(`\n${passed} performance test groups passed.`);
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
