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
          <div><h2>Class Performance</h2><p>Review current standing and recorded learning activity for your authorized classes.</p></div>
        </div>
      </section>
      <div class="analytics-filters" style="margin:12px 0 20px">
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
        <label>Report period
          <select id="cp-period" class="analytics-select" onchange="ClassPerformanceController.onPeriodChange(this.value)">
            <option value="term" ${filters.period !== "weekly" ? "selected" : ""}>Term / Quarterly</option>
            <option value="weekly" ${filters.period === "weekly" ? "selected" : ""}>Weekly (last 7 days)</option>
          </select>
        </label>
        <button class="btn btn-primary btn-sm" onclick="ClassPerformanceController.downloadReport()">Download report (Excel)</button>
      </div>
      <div id="cp-content">${ClassPerformanceView.loading()}</div>`;
  },

  loading() {
    return `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading class performance…</div></div>`;
  },

  error(message, retry = "refresh") {
    return `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.warning}</div><div class="empty-state-title">Could not load class performance</div><div class="empty-state-sub">${escHtml(message)}</div><button class="btn btn-primary mt-3" onclick="ClassPerformanceController.${retry}()">Retry</button></div>`;
  },

  _ratingClass(rating) {
    return ({
      "Excellent": "badge-green",
      "Very Good": "badge-green",
      "Good": "badge-blue",
      "Fair": "badge-gold",
      "Needs Improvement": "badge-gold",
      "At Risk": "badge-red",
    })[rating] || "badge-gray";
  },

  render(rows, period) {
    const bands = ["Excellent", "Very Good", "Good", "Fair", "Needs Improvement", "At Risk"];
    const counts = Object.fromEntries(bands.map(band => [band, rows.filter(row => row.rating === band).length]));
    const attention = rows.filter(row => ["Needs Improvement", "At Risk"].includes(row.rating));

    return `
      <p class="gauge-meta">${period === "weekly"
        ? "Weekly view: current standing is shown with activity and attendance records from the last 7 days."
        : "Term / quarterly view: current standing and records for the selected term are shown."}</p>
      <div class="teacher-dashboard-stat-grid">
        ${bands.map(band => `<article class="teacher-dashboard-stat-card"><span>${escHtml(band)}</span><strong>${counts[band]}</strong></article>`).join("")}
      </div>
      <section class="analytics-card" style="margin:16px 0;border-left:4px solid var(--orange)">
        <h3>Needs attention (${attention.length})</h3>
        ${attention.length
          ? `<ul>${attention.map(row => `<li><button class="btn btn-ghost btn-sm" onclick="ClassPerformanceController.openStudent(${row.student_id})">${escHtml(row.name)} — ${escHtml(row.rating)} (${row.overall_score}%)</button></li>`).join("")}</ul>`
          : "<p>No students are currently in the Needs Improvement or At Risk bands.</p>"}
      </section>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Student</th><th>Academic</th><th>Attendance</th><th>Modules</th><th>Overall</th><th>Rating</th><th>Missing / backlog</th><th>Graded activities</th><th>P(next ≥75%)</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(row => `
              <tr class="cp-student-row" tabindex="0" role="button" onclick="ClassPerformanceController.openStudent(${row.student_id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ClassPerformanceController.openStudent(${row.student_id})}">
                <td>${escHtml(row.name)}${row.student_number ? `<small style="display:block">${escHtml(row.student_number)}</small>` : ""}</td>
                <td>${row.academic_pct == null ? "—" : `${row.academic_pct.toFixed(1)}%`}</td>
                <td>${row.attendance_pct == null ? "—" : `${row.attendance_pct.toFixed(1)}%`}</td>
                <td>${row.modules_pct == null ? "—" : `${row.modules_pct.toFixed(1)}%`}</td>
                <td>${row.overall_score == null ? "—" : `${row.overall_score.toFixed(2)}%`}</td>
                <td><span class="badge ${ClassPerformanceView._ratingClass(row.rating)}">${escHtml(row.rating)}${row.low_confidence ? " · Low confidence" : ""}</span></td>
                <td>${row.missing_count}</td>
                <td>${row.graded_count}${row.low_confidence ? ' <span class="badge badge-gold" title="Fewer than 3 graded activities">Low confidence</span>' : ""}</td>
                <td>${row.next_probability == null ? "—" : `${row.next_probability.toFixed(1)}%`}</td>
              </tr>`).join("") : `<tr><td colspan="9">No active enrolled students found for these filters.</td></tr>`}
          </tbody>
        </table>
      </div>`;
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
