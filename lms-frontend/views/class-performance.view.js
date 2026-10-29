"use strict";

const ClassPerformanceView = {
  shell(assignments, filters = {}) {
    const subjects = [...new Map(assignments.map(row => [
      row.subject_id,
      { id: row.subject_id, name: row.subject_name },
    ])).values()];
    const subjectId = filters.subjectId || subjects[0]?.id || "";
    const sections = assignments.filter(row => String(row.subject_id) === String(subjectId));
    const sectionId = filters.sectionId || "";

    return `
      <section class="section-header">
        <div class="section-header-left">
          <div><h2>Class Performance</h2><p>Compare students’ current performance and the recorded evidence behind each score.</p></div>
        </div>
      </section>
      <div class="class-performance-filters">
        <label>Subject
          <select id="cp-subject" class="analytics-select" onchange="ClassPerformanceController.onSubjectChange(this.value)">
            ${subjects.map(item => `<option value="${item.id}" ${String(item.id) === String(subjectId) ? "selected" : ""}>${escHtml(item.name)}</option>`).join("")}
          </select>
        </label>
        <label>Section
          <select id="cp-section" class="analytics-select" onchange="ClassPerformanceController.onFilterChange()">
            <option value="">All assigned sections</option>
            ${sections.map(item => `<option value="${item.section_id}" ${String(item.section_id) === String(sectionId) ? "selected" : ""}>${escHtml(item.section_name)}</option>`).join("")}
          </select>
        </label>
        <label>Term
          <select id="cp-term" class="analytics-select" onchange="ClassPerformanceController.onFilterChange()">
            <option value="">All terms</option>
            ${["1st", "2nd", "3rd", "4th"].map(term => `<option value="${term}" ${filters.term === term ? "selected" : ""}>${term} Term</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-primary btn-sm class-performance-download" onclick="ClassPerformanceController.downloadReport()">Download report (Excel)</button>
      </div>
      <div id="cp-content">${ClassPerformanceView.loading()}</div>`;
  },

  loading() {
    return `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading class performance…</div></div>`;
  },

  error(message, retry = "refresh") {
    return `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.warning}</div><div class="empty-state-title">Could not load class performance</div><div class="empty-state-sub">${escHtml(message)}</div><button class="btn btn-primary mt-3" onclick="ClassPerformanceController.${retry}()">Retry</button></div>`;
  },

  render(rows) {
    const sortedRows = [...rows].sort((a, b) => {
      const nameOrder = String(a.name || "").localeCompare(String(b.name || ""));
      if (a.overall_score == null) return b.overall_score == null ? nameOrder : 1;
      if (b.overall_score == null) return -1;
      return b.overall_score - a.overall_score || nameOrder;
    });
    let previousScore = null;
    let currentRank = 0;
    const rankedRows = sortedRows.map((row, index) => {
      if (row.overall_score !== previousScore) currentRank = index + 1;
      previousScore = row.overall_score;
      return { ...row, rank: row.overall_score == null ? null : currentRank };
    });

    return `
      <section class="analytics-card class-performance-card">
        <div class="class-performance-card-heading">
          <div>
            <h3>Class performance leaderboard</h3>
            <p>Ranked by current performance; each result uses the student’s available recorded evidence.</p>
          </div>
          <span>${rankedRows.length} student${rankedRows.length === 1 ? "" : "s"}</span>
        </div>
        <div class="class-performance-leaderboard-header" aria-hidden="true">
          <span>Rank</span><span>Student and evidence</span><span>Overall</span>
        </div>
        ${rankedRows.length ? `
          <div class="class-performance-list">
            ${rankedRows.map(row => {
              const name = String(row.name || "Student");
              const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
              const avatarUrl = /^https?:\/\//i.test(String(row.avatar_url || "")) ? String(row.avatar_url) : "";
              const score = row.overall_score;
              const scoreWidth = score == null ? 0 : Math.max(0, Math.min(100, score));
              const ratingText = row.rating === "Unknown" ? "Not enough data" : row.rating;
              return `
              <button class="class-performance-student" type="button" onclick="ClassPerformanceController.openStudent(${row.student_id})">
                <span class="class-performance-rank">${row.rank ?? "—"}</span>
                <span class="class-performance-identity">
                  <span class="class-performance-avatar">
                    <span>${escHtml(initials || "S")}</span>
                    ${avatarUrl ? `<img src="${escHtml(avatarUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}
                  </span>
                  <span class="class-performance-student-name">
                    <strong>${escHtml(name)}</strong>
                    ${row.student_number ? `<small>${escHtml(row.student_number)}</small>` : ""}
                    <span class="class-performance-factors">
                      <span>Academic <b>${row.academic_pct == null ? "—" : `${row.academic_pct.toFixed(1)}%`}</b><small>${row.graded_count} graded${row.low_confidence ? " · low confidence" : ""}${row.missing_count ? ` · ${row.missing_count} missing` : ""}</small></span>
                      <span>Attendance <b>${row.attendance_pct == null ? "—" : `${row.attendance_pct.toFixed(1)}%`}</b><small>${row.attendance_sessions} meetings</small></span>
                      <span>Modules <b>${row.modules_pct == null ? "—" : `${row.modules_pct.toFixed(1)}%`}</b><small>${row.modules_read}/${row.modules_total} read</small></span>
                    </span>
                  </span>
                </span>
                <span class="class-performance-rate-track" aria-hidden="true">
                  <span style="width:${scoreWidth}%"></span>
                </span>
                <span class="class-performance-result">
                  <strong class="class-performance-rate">${score == null ? "—" : `${score.toFixed(1)}%`}</strong>
                  <span class="class-performance-rating rating-${escHtml(row.rating_color || "unknown")}">${escHtml(ratingText)}</span>
                </span>
              </button>`;
            }).join("")}
          </div>` : `<p class="class-performance-empty">No active students found for these filters.</p>`}
        <div class="class-performance-formula">
          <strong>How the performance score is calculated</strong>
          <p><code>Academic × 75% + Attendance × 15% + Modules read × 10%</code></p>
          <p>Academic uses recorded graded points and counts overdue missing work as zero. Attendance uses recorded meetings; late counts as half and excused meetings are excluded. Modules use published modules read. If a factor has no records, the remaining weights are shared proportionally. Rankings use the available evidence; ties share a rank.</p>
        </div>
      </section>`;
  },

  studentDetails(student, details) {
    const activityRows = (details.activities || []).filter(row => row.student_id === student.student_id);
    const attendanceRows = (details.attendance || []).filter(row => row.student_id === student.student_id);
    const moduleRows = (details.modules || []).filter(row => row.student_id === student.student_id);
    const activityTable = activityRows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Activity</th><th>Score</th><th>Status</th><th>Due</th></tr></thead><tbody>${activityRows.map(row => `<tr><td>${escHtml(row.activity_name)}</td><td>${row.score == null ? "—" : `${row.score}/${row.max_score ?? "—"}`}</td><td>${escHtml(row.status)}</td><td>${row.due_date ? escHtml(new Date(row.due_date).toLocaleDateString()) : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : "<p>No activity records for this period.</p>";
    const attendanceTable = attendanceRows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${attendanceRows.map(row => `<tr><td>${escHtml(row.session_date)}</td><td>${escHtml(row.status)}</td></tr>`).join("")}</tbody></table></div>`
      : "<p>No attendance records for this period.</p>";
    const present = attendanceRows.filter(row => row.status === "present").length;
    const late = attendanceRows.filter(row => row.status === "late").length;
    const absent = attendanceRows.filter(row => row.status === "absent").length;
    const excused = attendanceRows.filter(row => row.status === "excused").length;
    const moduleTable = moduleRows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Module</th><th>Read</th><th>Last read</th></tr></thead><tbody>${moduleRows.map(row => `<tr><td>${escHtml(row.module_name)}</td><td>${row.is_read ? "Yes" : "No"}</td><td>${row.last_read_at ? escHtml(new Date(row.last_read_at).toLocaleDateString()) : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : "<p>No published modules for this term.</p>";

    return `<div>
      <p><strong>Attendance summary:</strong> ${present} present, ${late} late, ${absent} absent, ${excused} excused.</p>
      <h4>Activities</h4>${activityTable}
      <h4>Attendance</h4>${attendanceTable}
      <h4>Modules read</h4>${moduleTable}
    </div>`;
  },
};
