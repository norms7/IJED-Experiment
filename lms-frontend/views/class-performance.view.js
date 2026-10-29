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
          <div><h2>Class Performance</h2><p>See each student’s estimated chance of meeting the 75% target on their next graded activity.</p></div>
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
      if (a.next_probability == null) return b.next_probability == null ? 0 : 1;
      if (b.next_probability == null) return -1;
      return b.next_probability - a.next_probability;
    });

    return `
      <section class="analytics-card class-performance-card">
        <div class="class-performance-card-heading">
          <div>
            <h3>Student success rate</h3>
            <p>Estimated chance of scoring at least 75% on the next graded activity.</p>
          </div>
          <span>${sortedRows.length} student${sortedRows.length === 1 ? "" : "s"}</span>
        </div>
        ${sortedRows.length ? `
          <div class="class-performance-list">
            ${sortedRows.map(row => `
              <button class="class-performance-student" type="button" onclick="ClassPerformanceController.openStudent(${row.student_id})">
                <span class="class-performance-student-name">
                  <strong>${escHtml(row.name)}</strong>
                  ${row.student_number ? `<small>${escHtml(row.student_number)}</small>` : ""}
                </span>
                <span class="class-performance-rate-track" aria-hidden="true">
                  <span style="width:${row.next_probability == null ? 0 : Math.max(0, Math.min(100, row.next_probability))}%"></span>
                </span>
                <strong class="class-performance-rate">${row.next_probability == null ? "Not enough data" : `${row.next_probability.toFixed(1)}%`}</strong>
              </button>`).join("")}
          </div>` : `<p class="class-performance-empty">No active students found for these filters.</p>`}
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
