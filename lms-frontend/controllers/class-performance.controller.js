"use strict";

const ClassPerformanceController = {
  _assignments: [],
  _rows: [],
  _filters: { subjectId: null, sectionId: "", term: "" },
  _requestId: 0,

  async load() {
    const role = DashboardController.currentUser?.role;
    if (!["admin", "teacher"].includes(role)) {
      document.getElementById("content-area").innerHTML = ClassPerformanceView.error("This page is available to teachers and administrators.", "load");
      return;
    }

    try {
      this._assignments = await api.getClassPerformanceAssignments();
      const subjectIds = [...new Set(this._assignments.map(row => row.subject_id))];
      this._filters.subjectId = this._filters.subjectId && subjectIds.includes(this._filters.subjectId)
        ? this._filters.subjectId
        : subjectIds[0] || null;
      const sectionOptions = this._assignments.filter(row => row.subject_id === this._filters.subjectId);
      this._filters.sectionId = sectionOptions.length === 1 ? String(sectionOptions[0].section_id) : "";

      document.getElementById("content-area").innerHTML = ClassPerformanceView.shell(this._assignments, this._filters);
      if (!this._filters.subjectId) {
        document.getElementById("cp-content").innerHTML = "<p>No authorized subject and section assignments were found.</p>";
        return;
      }
      await this.refresh();
    } catch (error) {
      document.getElementById("content-area").innerHTML = ClassPerformanceView.error(error.message, "load");
    }
  },

  async onSubjectChange(value) {
    this._filters.subjectId = Number(value) || null;
    const sections = this._assignments.filter(row => row.subject_id === this._filters.subjectId);
    this._filters.sectionId = sections.length === 1 ? String(sections[0].section_id) : "";
    const sectionSelect = document.getElementById("cp-section");
    if (sectionSelect) {
      sectionSelect.innerHTML = `<option value="">All assigned sections</option>${sections.map(row =>
        `<option value="${row.section_id}">${escHtml(row.section_name)}</option>`
      ).join("")}`;
      sectionSelect.value = this._filters.sectionId;
    }
    await this.refresh();
  },

  async onFilterChange() {
    this._filters.sectionId = document.getElementById("cp-section")?.value || "";
    this._filters.term = document.getElementById("cp-term")?.value || "";
    await this.refresh();
  },

  _prepareRow(row) {
    const academicPct = Number(row.academic_possible) > 0
      ? Number(row.academic_earned || 0) / Number(row.academic_possible) * 100
      : null;
    const attendancePct = Number(row.attendance_sessions) > 0
      ? Number(row.attendance_weighted || 0) / Number(row.attendance_sessions) * 100
      : null;
    const modulesPct = Number(row.modules_total) > 0
      ? Number(row.modules_read || 0) / Number(row.modules_total) * 100
      : null;
    const overall = AnalyticsEngine.weightedScore(academicPct, attendancePct, modulesPct);
    const { rating, color, emoji } = AnalyticsEngine.ratingForScore(overall);
    const ownSuccesses = Number(row.my_successes || 0);
    const ownFailures = Number(row.my_failures || 0);
    const peerSuccesses = Math.max(0, Number(row.class_successes || 0) - ownSuccesses);
    const peerFailures = Math.max(0, Number(row.class_failures || 0) - ownFailures);
    const mean = AnalyticsEngine.betaBinomialMean(
      peerSuccesses,
      peerFailures,
      ownSuccesses,
      ownFailures,
    );

    return {
      ...row,
      academic_pct: academicPct,
      attendance_pct: attendancePct,
      modules_pct: modulesPct,
      overall_score: overall,
      rating,
      rating_color: color,
      rating_emoji: emoji,
      missing_count: Number(row.missing_count || 0),
      graded_count: Number(row.graded_count || 0),
      low_confidence: Number(row.graded_count || 0) < 3,
      next_probability: mean === null ? null : Math.round(mean * 1000) / 10,
    };
  },

  async refresh() {
    const target = document.getElementById("cp-content");
    if (!target) return;
    const subjectId = this._filters.subjectId;
    if (!subjectId) {
      target.innerHTML = "<p>Select an authorized subject.</p>";
      return;
    }

    const requestId = ++this._requestId;
    target.innerHTML = ClassPerformanceView.loading();
    try {
      const data = await api.getClassPerformance(
        subjectId,
        this._filters.sectionId ? Number(this._filters.sectionId) : null,
        this._filters.term || null,
      );
      if (requestId !== this._requestId || !target.isConnected) return;
      this._rows = (Array.isArray(data) ? data : []).map(row => this._prepareRow(row));
      target.innerHTML = ClassPerformanceView.render(this._rows);
    } catch (error) {
      if (requestId === this._requestId && target.isConnected) {
        target.innerHTML = ClassPerformanceView.error(error.message);
      }
    }
  },

  async _loadDetails(studentId = null) {
    if (!this._filters.subjectId) throw new Error("Select an authorized subject first.");
    return api.getClassPerformanceDetails(
      this._filters.subjectId,
      this._filters.sectionId ? Number(this._filters.sectionId) : null,
      this._filters.term || null,
      studentId,
      null,
    );
  },

  async openStudent(studentId) {
    const student = this._rows.find(row => row.student_id === studentId);
    if (!student) return;
    Modal.show(`Performance details — ${escHtml(student.name)}`, ClassPerformanceView.loading(), "");
    try {
      const details = await this._loadDetails(studentId);
      Modal.show(
        `Performance details — ${escHtml(student.name)}`,
        ClassPerformanceView.studentDetails(student, details || {}),
        '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>',
        { wide: true },
      );
    } catch (error) {
      Modal.show(
        `Performance details — ${escHtml(student.name)}`,
        `<div class="empty-state-sub">${escHtml(error.message)}</div>`,
        '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>',
        { wide: true },
      );
    }
  },

  _formulaRows() {
    return [
      ["Formula", "Current rule"],
      ["Academic %", "Graded earned points plus due/undated unsubmitted work as 0, divided by applicable possible points; submitted ungraded work excluded."],
      ["Attendance %", "(Present + 0.5 × Late) / meetings × 100; excused sessions excluded from denominator."],
      ["Modules %", "Published modules read / published modules × 100."],
      ["Overall", "Academic × 75% + Attendance × 15% + Modules × 10%; weights for unavailable components are redistributed proportionally."],
      ["Rating bands", "90+ Excellent; 85–89 Very Good; 80–84 Good; 75–79 Fair; 70–74 Needs Improvement; below 70 At Risk."],
      ["Low confidence", "Fewer than 3 graded activities."],
      ["P(next activity ≥ 75%)", "Beta-Binomial posterior mean; prior strength 4 centered on the class peer success rate, or 50% if no peer evidence."],
    ];
  },

  async downloadReport() {
    if (!window.XLSX) {
      Toast.show("Excel export is unavailable because the spreadsheet library did not load.", "error");
      return;
    }
    try {
      const details = await this._loadDetails();
      const workbook = XLSX.utils.book_new();
      const summary = [
        ["Student", "Student number", "Academic %", "Attendance %", "Modules %", "Overall %", "Rating", "Missing / backlog", "Graded activities", "Low confidence", "P(next activity ≥75%)"],
        ...this._rows.map(row => [
          row.name, row.student_number || "", row.academic_pct, row.attendance_pct, row.modules_pct,
          row.overall_score, row.rating, row.missing_count, row.graded_count, row.low_confidence ? "Yes" : "No",
          row.next_probability,
        ]),
      ];
      const activities = [
        ["Student", "Student number", "Activity", "Score", "Max score", "Status", "Due date", "Submitted at"],
        ...(details.activities || []).map(row => [
          row.student_name, row.student_number || "", row.activity_name, row.score, row.max_score,
          row.status, row.due_date, row.submitted_at,
        ]),
      ];
      const attendance = [
        ["Student", "Student number", "Session date", "Status", "Subject"],
        ...(details.attendance || []).map(row => [
          row.student_name, row.student_number || "", row.session_date, row.status, row.subject_name,
        ]),
      ];
      const modules = [
        ["Student", "Student number", "Module", "Read", "First read", "Last read"],
        ...(details.modules || []).map(row => [
          row.student_name, row.student_number || "", row.module_name, row.is_read ? "Yes" : "No",
          row.first_read_at, row.last_read_at,
        ]),
      ];

      for (const [name, rows] of [
        ["Summary", summary],
        ["Activities", activities],
        ["Attendance", attendance],
        ["Modules", modules],
        ["Formulas", this._formulaRows()],
      ]) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
      }

      const assignment = this._assignments.find(row => row.subject_id === this._filters.subjectId);
      const sectionName = this._filters.sectionId
        ? this._assignments.find(row => String(row.section_id) === this._filters.sectionId)?.section_name
        : "all-sections";
      const slug = value => String(value || "all").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
      const date = new Date().toISOString().slice(0, 10);
      const filename = `Class-Performance_${slug(assignment?.subject_name)}_${slug(sectionName)}_${slug(this._filters.term || "all-terms")}_${date}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (error) {
      Toast.show(`Could not create Excel report: ${error.message}`, "error");
    }
  },
};
