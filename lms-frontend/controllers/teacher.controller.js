/* ============================================================
   controllers/teacher.controller.js
   All teacher actions: modules, activity builder, grading.
   ============================================================ */

"use strict";

const TeacherController = {

  // ── Module methods ────────────────────────────────────────

  async openAddModule() {
    let subjectOpts = '<option value="">Loading...</option>';
    try {
      const subjects = await api.getMySubjects();
      if (!subjects.length) subjectOpts = '<option value="">No subjects assigned yet</option>';
      else subjectOpts = subjects.map(s =>
        `<option value="${s.subject_id}" data-class="${s.class_id}">${escHtml(s.subject_name)} — ${escHtml(s.class_name)}</option>`
      ).join('');
    } catch (err) {
      subjectOpts = '<option value="">Failed to load subjects</option>';
    }
    Modal.show('Upload New Module', `
      <div class="form-group"><label>Module Title *</label><input class="form-control" id="m-title" placeholder="e.g. Introduction to Algebra" /></div>
      <div class="form-group"><label>Subject *</label><select class="form-control" id="m-subject">${subjectOpts}</select></div>
      <div class="form-group"><label>Description</label><textarea class="form-control" id="m-desc" placeholder="Brief description of the module…"></textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Term</label><select class="form-control" id="m-term"><option value="">— Select Term —</option><option value="1st">1st Term</option><option value="2nd">2nd Term</option><option value="3rd">3rd Term</option><option value="4th">4th Term</option></select></div>
        <div class="form-group"><label>PDF File</label><input class="form-control" id="m-file" type="file" accept=".pdf" /><div id="m-file-status" style="font-size:12px;margin-top:4px;color:var(--gray-400)">No file selected</div></div>
      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="TeacherController.saveModule()">Upload Module</button>`,
      { closeOnBackdrop: false }
    );
    if (window._selectedSubjectId) {
      setTimeout(() => {
        const s = document.getElementById('m-subject');
        if (s) s.value = window._selectedSubjectId;
        delete window._selectedSubjectId;
      }, 100);
    }
    document.getElementById('m-file').addEventListener('change', function () {
      document.getElementById('m-file-status').textContent = this.files[0]
        ? `Selected: ${this.files[0].name}` : 'No file selected';
    });
  },

  async saveModule() {
    const title     = document.getElementById('m-title').value.trim();
    const subject   = document.getElementById('m-subject').value;
    const term      = document.getElementById('m-term').value;
    const fileInput = document.getElementById('m-file');
    const file      = fileInput?.files?.[0];
    if (!Validate.required(title, 'Module title')) return;
    if (!subject) { Toast.show('Please select a subject.', 'error'); return; }
    const submitBtn = document.querySelector('#modal-container .btn-primary');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading…'; }
    try {
      let file_url = null, file_name = null;
      if (file) {
        Toast.show('Uploading PDF…', 'info');
        const uploaded = await api.uploadModuleFile(file);
        file_url  = uploaded.file_url;
        file_name = uploaded.file_name;
      }
      await api.createMyModule({
        title,
        subject_id:   parseInt(subject),
        description:  document.getElementById('m-desc').value.trim(),
        term:         term || null,
        file_url,
        file_name,
        is_published: true,
      });
      Modal.close();
      Toast.show('Module uploaded successfully!', 'success');
      DashboardController.loadSection('modules');
    } catch (err) {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Upload Module'; }
      Toast.show(err.message || 'Failed to upload module.', 'error');
    }
  },

  async deleteModule(id) {
    if (!confirm('Delete this module? This cannot be undone.')) return;
    try {
      await api.deleteMyModule(id);
      Toast.show('Module deleted.', 'info');
      DashboardController.loadSection('modules');
    } catch (err) {
      Toast.show(err.message || 'Failed to delete module.', 'error');
    }
  },

  openAddModuleForSubject(subjectId, classId) {
    window._selectedSubjectId = subjectId;
    this.openAddModule();
  },

  async viewStudentsForSubject(subjectId, sectionId, subjectName) {
    Modal.show(`Students – ${escHtml(subjectName)}`, '<div class="text-center">Loading students…</div>', '');
    try {
      const students = await api.getSectionStudents(sectionId);
      if (!students.length) {
        Modal.show(`Students – ${escHtml(subjectName)}`, '<div class="text-muted">No students enrolled in this section.</div>', '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>');
        return;
      }
      const list = students.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee">
          <div><strong>${escHtml((s.user?.first_name || '') + ' ' + (s.user?.last_name || ''))}</strong><br>
          <span class="text-sm">${escHtml(s.user?.email || '')}</span></div>
          <span class="badge ${s.user?.is_active ? 'badge-green' : 'badge-red'}">${s.user?.is_active ? 'Active' : 'Inactive'}</span>
        </div>`).join('');
      Modal.show(`Students – ${escHtml(subjectName)}`, `<div>${list}</div>`, '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>');
    } catch (err) {
      Modal.show(`Students – ${escHtml(subjectName)}`, `<div class="text-danger">Could not load students: ${err.message}</div>`, '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>');
    }
  },

  // ── Activity type/format constants ────────────────────────

  _ACTIVITY_TYPES: [
    { value: 'quiz',             label: 'Quiz' },
    { value: 'long_quiz',        label: 'Long Quiz' },
    { value: 'task_performance', label: 'Task Performance' },
    { value: 'exam',             label: 'Exam' },
    { value: 'lab_exercise',     label: 'Laboratory Exercise' },
    { value: 'assignment',       label: 'Assignment / Homework' },
    { value: 'other',            label: 'Other (specify)' },
  ],

  _FORMAT_TYPES: [
    { value: 'multiple_choice', label: 'Multiple Choice',               grading: 'auto' },
    { value: 'checkbox',        label: 'Checkbox (multi-select)',       grading: 'auto' },
    { value: 'enumeration',     label: 'Fill in the Blank / Enumeration', grading: 'auto' },
    { value: 'freeform',        label: 'Freeform / Essay',              grading: 'manual' },
    { value: 'assignment',      label: 'Assignment / Homework',           grading: 'manual' },
    { value: 'hybrid',          label: 'Hybrid (mixed types)',            grading: 'manual' },
  ],

  /** Questions array held in memory while the modal is open */
  _questions: [],
  _editingActivityId: null,
  _editingActivityFilePath: null,

  _gradingBadge(mode) {
    return mode === 'auto'
      ? `<span class="badge badge-green" title="System will auto-check answers">${lmsIcon('check')} Auto-graded</span>`
      : `<span class="badge badge-gold"  title="You will manually enter grades">${lmsIcon('pen')} Manual grading</span>`;
  },

  // ── Create Activity Modal ─────────────────────────────────

  async openAddActivity(presetSubjectId = null, existingActivity = null) {
    this._questions = [];
    this._editingActivityId = existingActivity?.id || null;
    this._editingActivityFilePath = existingActivity?.file_path || null;
    let subjectOpts = '<option value="">Loading...</option>';
    let moduleMap   = {};

    try {
      const [subjects, modules] = await Promise.all([
        api.getMySubjects(),
        api.getMyModules(),
      ]);
      if (!subjects.length) subjectOpts = '<option value="">No subjects assigned</option>';
      else subjectOpts = subjects.map(s =>
        `<option value="${s.subject_id}" ${s.subject_id === (existingActivity?.subject_id || presetSubjectId) ? 'selected' : ''}>${escHtml(s.subject_name)} — ${escHtml(s.class_name)}</option>`
      ).join('');
      modules.forEach(m => {
        if (!moduleMap[m.subject_id]) moduleMap[m.subject_id] = [];
        moduleMap[m.subject_id].push(m);
      });
      window._activityModuleMap = moduleMap;
    } catch (err) {
      subjectOpts = '<option value="">Failed to load subjects</option>';
    }

    const typeOpts   = this._ACTIVITY_TYPES.map(t => `<option value="${t.value}" ${t.value === existingActivity?.activity_type ? 'selected' : ''}>${t.label}</option>`).join('');
    const formatOpts = this._FORMAT_TYPES.map(f => `<option value="${f.value}" ${f.value === existingActivity?.format_type ? 'selected' : ''}>${f.label}</option>`).join('');
    const toLocalInput = value => {
      if (!value) return '';
      const date = new Date(value);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      return date.toISOString().slice(0, 16);
    };
    const selectedTerm = existingActivity?.term || '';
    const termOptions = ['1st', '2nd', '3rd', '4th'].map(term => `<option value="${term}" ${term === selectedTerm ? 'selected' : ''}>${term} Term</option>`).join('');
    const activityClosed = Boolean(existingActivity && (
      existingActivity.is_published === false ||
      (existingActivity.due_date && new Date(existingActivity.due_date) < new Date())
    ));
    const reopenMinimum = existingActivity?.start_date && new Date(existingActivity.start_date) > new Date()
      ? existingActivity.start_date
      : new Date();

    Modal.show(existingActivity ? 'Edit Activity' : 'Create Activity', `
      <div class="activity-form">

        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label>Activity Title *</label>
            <input class="form-control" id="act-title" required value="${escHtml(existingActivity?.title || '')}" placeholder="e.g. Quiz 1 – Fractions" oninput="TeacherController._updateActivitySaveState()" />
          </div>
          <div class="form-group" style="flex:1">
            <label>Subject *</label>
            <select class="form-control" id="act-subject" onchange="TeacherController._onSubjectChange(this.value)">${subjectOpts}</select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Term *</label>
            <select class="form-control" id="act-term" onchange="TeacherController._onTermChange(this.value)">
              <option value="">— Select term —</option>${termOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Module *</label>
            <select class="form-control" id="act-module" onchange="TeacherController._updateActivitySaveState()"><option value="">— Select subject and term first —</option></select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Activity Type *</label>
            <select class="form-control" id="act-type" onchange="TeacherController._onTypeChange(this.value)">${typeOpts}</select>
          </div>
          <div class="form-group" id="act-custom-wrap" style="display:${existingActivity?.activity_type === 'other' ? '' : 'none'}">
            <label>Specify Type</label>
            <input class="form-control" id="act-type-custom" value="${escHtml(existingActivity?.activity_type_custom || '')}" placeholder="e.g. Performance Task" oninput="TeacherController._updateActivitySaveState()" />
          </div>
        </div>

        <div class="form-group">
          <label>Question Format *</label>
          <select class="form-control" id="act-format" onchange="TeacherController._onFormatChange(this.value)">${formatOpts}</select>
          <div id="act-grading-badge" style="margin-top:6px">${this._gradingBadge(existingActivity?.grading_mode || 'auto')}</div>
        </div>

        <div class="form-group" id="act-file-wrap" style="display:${existingActivity?.grading_mode === 'manual' ? '' : 'none'}">
          <label>Activity File <span class="text-muted">(optional, up to 50 MB)</span></label>
          ${existingActivity?.file_name ? `<div class="text-sm" style="margin-bottom:6px">Current file: ${escHtml(existingActivity.file_name)} (kept unless replaced)</div>` : ''}
          <input class="form-control" id="act-file" type="file" />
          <small class="text-muted">Students can view this file while completing the activity.</small>
        </div>

        <div class="form-group" id="act-points-wrap" style="display:none">
          <label>Total Points *</label>
          <input class="form-control" id="act-points" type="number" min="1" max="1000" step="1"
                 value="${existingActivity?.max_score ?? ''}" placeholder="e.g. 50" oninput="TeacherController._updateActivitySaveState()" />
          <small class="text-muted">Maximum score for this activity. You will grade each submission out of this number.</small>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Start Date / Time *</label>
            <input class="form-control" id="act-start" type="datetime-local" required value="${toLocalInput(existingActivity?.start_date)}" oninput="TeacherController._updateActivitySaveState();TeacherController._updateReopenState()" />
          </div>
          <div class="form-group">
            <label>Due Date / Time *</label>
            <input class="form-control" id="act-due" type="datetime-local" required value="${toLocalInput(existingActivity?.due_date)}" oninput="TeacherController._updateActivitySaveState()" />
          </div>
        </div>

        <div class="form-group">
          <label><input id="act-allow-late" type="checkbox" ${existingActivity?.allow_late_submission ? 'checked' : ''} onchange="TeacherController._onLateSubmissionChange(this.checked)" /> Allow late submissions</label>
          <div id="act-late-penalty-wrap" style="display:${existingActivity?.allow_late_submission ? '' : 'none'};margin-top:8px">
            <label for="act-late-penalty">Minus points for late submission *</label>
            <input class="form-control" id="act-late-penalty" type="number" min="0" max="1000" step="1" value="${existingActivity?.late_penalty_points ?? 0}" oninput="TeacherController._updateActivitySaveState()" />
            <small class="text-muted">This many points will be deducted from the final score. The deduction cannot reduce a score below zero.</small>
          </div>
        </div>

        <div class="form-group">
          <label>Instructions to Students *</label>
          <textarea class="form-control" id="act-instructions" rows="3" placeholder="Write any special instructions, reminders, or rules for this activity…" oninput="TeacherController._updateActivitySaveState()">${escHtml(existingActivity?.instructions || '')}</textarea>
        </div>

        ${activityClosed ? `
          <div class="form-group" style="padding:12px;border:1px solid var(--gray-200);border-radius:8px">
            <strong>This activity is closed.</strong>
            <label for="act-reopen-due" style="display:block;margin-top:8px">New due date / time *</label>
            <input class="form-control" id="act-reopen-due" type="datetime-local" min="${toLocalInput(reopenMinimum)}" oninput="TeacherController._updateReopenState()" />
            <small class="text-muted">Reopening makes the activity available again until this new deadline.</small>
          </div>` : ''}

        <div id="act-questions-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px">
            <strong>Questions</strong>
            <button class="btn btn-xs btn-outline" onclick="TeacherController._addQuestion()">${lmsIcon('plus')} Add Question</button>
          </div>
          <div id="act-questions-list">
            <div class="text-muted text-sm" style="padding:12px 0">No questions yet. Click "Add Question" to start.</div>
          </div>
        </div>

      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      ${activityClosed ? '<button class="btn btn-outline" id="act-reopen-btn" disabled onclick="TeacherController.reopenActivity()">Re-open Activity</button>' : ''}
      <button class="btn btn-primary" id="act-save-btn" disabled onclick="TeacherController.saveActivity()">${lmsIcon('save')} ${existingActivity ? 'Update Activity' : 'Save Activity'}</button>`,
      { closeOnBackdrop: false, wide: true }
    );

    setTimeout(() => {
      const subjectSel = document.getElementById('act-subject');
      if (subjectSel && subjectSel.value) this._onSubjectChange(subjectSel.value);
      if (existingActivity?.module_id) {
        const moduleSel = document.getElementById('act-module');
        if (moduleSel) moduleSel.value = String(existingActivity.module_id);
      }
      if (existingActivity?.activity_questions) {
        this._questions = existingActivity.activity_questions.map((question, index) => ({
          id: `q${question.id || index}`,
          question_id: question.id || null,
          type: question.question_type || 'multiple_choice',
          text: question.question_text || '',
          points: question.points || 1,
          correct: question.correct_answer || null,
          choices: (question.activity_question_choices || []).map((choice, choiceIndex) => ({ id: `c${choice.id || choiceIndex}`, text: choice.choice_text || '' })),
        }));
        this._renderQuestions();
      }
      this._onFormatChange(document.getElementById('act-format')?.value || 'multiple_choice');
      this._onLateSubmissionChange(Boolean(existingActivity?.allow_late_submission));
      this._updateReopenState();
      this._updateActivitySaveState();
    }, 80);
  },

  _onSubjectChange(subjectId) {
    this._refreshModuleOptions();
  },

  _onTermChange(term) {
    this._refreshModuleOptions();
  },

  _refreshModuleOptions() {
    const subjectId = document.getElementById('act-subject')?.value;
    const term      = document.getElementById('act-term')?.value;
    const moduleSel = document.getElementById('act-module');
    if (!moduleSel) return;

    if (!subjectId) {
      moduleSel.innerHTML = '<option value="">— Select subject and term first —</option>';
      return;
    }
    if (!term) {
      moduleSel.innerHTML = '<option value="">— Select a term first —</option>';
      return;
    }

    const moduleMap = window._activityModuleMap || {};
    const modules   = (moduleMap[parseInt(subjectId)] || []).filter(m => m.term === term);
    moduleSel.innerHTML = modules.length
      ? `<option value="">— Select module —</option>${modules.map(m => `<option value="${m.id}">${escHtml(m.title)}</option>`).join('')}`
      : `<option value="">No ${this._termLabel(term)} modules for this subject — create one first</option>`;
    this._updateActivitySaveState();
  },

  _termLabel(term) {
    return { '1st': '1st Term', '2nd': '2nd Term', '3rd': '3rd Term', '4th': '4th Term' }[term] || term;
  },

  _onTypeChange(val) {
    const wrap = document.getElementById('act-custom-wrap');
    if (wrap) wrap.style.display = val === 'other' ? '' : 'none';
    this._updateActivitySaveState();
  },

  _onFormatChange(val) {
    const fmt      = this._FORMAT_TYPES.find(f => f.value === val);
    const badgeEl  = document.getElementById('act-grading-badge');
    const qSection = document.getElementById('act-questions-section');
    const fileWrap = document.getElementById('act-file-wrap');
    if (badgeEl)  badgeEl.innerHTML  = this._gradingBadge(fmt?.grading || 'auto');
    if (fileWrap) fileWrap.style.display = fmt?.grading === 'manual' ? '' : 'none';
    const hideQ = this._isSinglePrompt(val);
    if (qSection) qSection.style.display = hideQ ? 'none' : '';
    // Freeform / Assignment have no question builder, so the teacher sets the
    // total points directly. (Hybrid keeps per-question points; max = their sum.)
    const pointsWrap = document.getElementById('act-points-wrap');
    if (pointsWrap) pointsWrap.style.display = hideQ ? '' : 'none';
    this._updateActivitySaveState();
  },

  _onLateSubmissionChange(checked) {
    const wrap = document.getElementById('act-late-penalty-wrap');
    if (wrap) wrap.style.display = checked ? '' : 'none';
    this._updateActivitySaveState();
  },

  _activityValidationMessage() {
    const value = id => document.getElementById(id)?.value?.trim() || '';
    const title = value('act-title');
    const subjectId = value('act-subject');
    const term = value('act-term');
    const moduleId = value('act-module');
    const activityType = value('act-type');
    const format = value('act-format');
    const start = value('act-start');
    const due = value('act-due');
    const instructions = value('act-instructions');

    if (!title) return 'Activity title is required.';
    if (!subjectId) return 'Please select a subject.';
    if (!term) return 'Please select a term.';
    if (!moduleId) return 'Please select a module.';
    if (!activityType) return 'Please select an activity type.';
    if (activityType === 'other' && !value('act-type-custom')) return 'Please specify the activity type.';
    if (!format) return 'Please select a question format.';
    if (!start || !due) return 'Please provide both the start date and due date.';
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(due))) return 'Please enter valid start and due dates.';
    if (new Date(start) > new Date(due)) return 'The start date must be before the due date.';
    if (!instructions) return 'Instructions to students are required.';

    if (document.getElementById('act-allow-late')?.checked) {
      const penalty = value('act-late-penalty');
      if (penalty === '' || !Number.isInteger(Number(penalty)) || Number(penalty) < 0 || Number(penalty) > 1000) {
        return 'Enter a whole-number late deduction from 0 to 1000 points.';
      }
    }

    if (this._isSinglePrompt(format)) {
      const points = value('act-points');
      if (!points || !Number.isInteger(Number(points)) || Number(points) < 1 || Number(points) > 1000) {
        return 'Enter total points as a whole number from 1 to 1000.';
      }
      return '';
    }
    if (!this._questions.length) return 'Please add at least one question.';
    for (const [index, question] of this._questions.entries()) {
      const points = Number(document.querySelector(`.activity-question-builder[data-q="${index}"] input[type="number"]`)?.value);
      if (!question.text.trim()) return `Question ${index + 1} is missing question text.`;
      if (!Number.isInteger(points) || points < 1 || points > 1000) return `Question ${index + 1} needs valid whole-number points.`;
      if (['multiple_choice', 'checkbox'].includes(question.type)) {
        if (question.choices.length < 2 || question.choices.some(choice => !choice.text.trim())) {
          return `Question ${index + 1} needs at least two completed choices.`;
        }
        if (question.type === 'multiple_choice') {
          const correctIndex = Number(question.correct);
          if (question.correct === null || question.correct === '' ||
              !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= question.choices.length) {
            return `Question ${index + 1} needs a valid correct answer selected.`;
          }
        }
        if (question.type === 'checkbox') {
          let correct = [];
          try { correct = JSON.parse(question.correct || '[]'); } catch { correct = []; }
          if (!correct.length || correct.some(choiceIndex =>
            !Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length
          )) {
            return `Question ${index + 1} needs valid correct choices selected.`;
          }
        }
      }
      if (['fill_blank', 'enumeration'].includes(question.type) && !String(question.correct || '').trim()) {
        return `Question ${index + 1} needs an expected answer.`;
      }
    }
    return '';
  },

  _updateActivitySaveState() {
    const button = document.getElementById('act-save-btn');
    if (button) button.disabled = Boolean(this._activityValidationMessage());
  },

  _updateReopenState() {
    const button = document.getElementById('act-reopen-btn');
    const dueInput = document.getElementById('act-reopen-due');
    if (!button || !dueInput) return;
    const dueDate = dueInput.value ? new Date(dueInput.value) : null;
    const start = document.getElementById('act-start')?.value;
    const startDate = start ? new Date(start) : null;
    button.disabled = !dueDate || Number.isNaN(dueDate.getTime()) ||
      dueDate <= new Date() || (startDate && dueDate < startDate);
  },

  async reopenActivity() {
    const dueInput = document.getElementById('act-reopen-due');
    const newDueDate = dueInput?.value ? new Date(dueInput.value) : null;
    const start = document.getElementById('act-start')?.value;
    const startDate = start ? new Date(start) : null;
    if (!this._editingActivityId || !newDueDate || Number.isNaN(newDueDate.getTime()) ||
        newDueDate <= new Date() || (startDate && newDueDate < startDate)) {
      Toast.show('Choose a new due date after the start date and in the future before reopening.', 'error');
      return;
    }
    const button = document.getElementById('act-reopen-btn');
    if (button) { button.disabled = true; button.textContent = 'Re-opening…'; }
    try {
      await api.updateTeacherActivity(this._editingActivityId, {
        due_date: newDueDate.toISOString(),
        is_published: true,
      });
      this._editingActivityId = null;
      this._editingActivityFilePath = null;
      Modal.close();
      Toast.show('Activity reopened with the new due date.', 'success');
      DashboardController.loadSection('activities');
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Re-open Activity'; }
      Toast.show(error.message || 'Could not reopen the activity.', 'error');
    }
  },

  /** Formats that are a single manually-graded prompt (no question builder). */
  _isSinglePrompt(format) {
    return format === 'freeform' || format === 'assignment';
  },

  // ── Question builder ──────────────────────────────────────

  _addQuestion() {
    const format = document.getElementById('act-format')?.value || 'multiple_choice';
    const defaultType = {
      multiple_choice: 'multiple_choice',
      checkbox:        'checkbox',
      enumeration:     'fill_blank',
      hybrid:          'multiple_choice',
    }[format] || 'multiple_choice';

    const idx = this._questions.length;
    this._questions.push({ id: `q${idx}`, question_id: null, type: defaultType, text: '', points: 1, correct: null, choices: [] });

    if (defaultType === 'multiple_choice' || defaultType === 'checkbox') {
      this._questions[idx].choices = ['', '', '', ''].map((_, i) => ({ id: `c${idx}_${i}`, text: '' }));
    }
    this._renderQuestions();
    this._updateActivitySaveState();
  },

  _removeQuestion(idx) {
    this._questions.splice(idx, 1);
    this._renderQuestions();
    this._updateActivitySaveState();
  },

  _renderQuestions() {
    const container = document.getElementById('act-questions-list');
    if (!container) return;
    if (!this._questions.length) {
      container.innerHTML = '<div class="text-muted text-sm" style="padding:12px 0">No questions yet.</div>';
      return;
    }
    container.innerHTML = this._questions.map((q, idx) => {
      const typeOpts = [
        { v: 'multiple_choice', l: 'Multiple Choice' },
        { v: 'checkbox',        l: 'Checkbox' },
        { v: 'fill_blank',      l: 'Fill in the Blank' },
        { v: 'essay',           l: 'Essay' },
      ].map(t => `<option value="${t.v}" ${q.type === t.v ? 'selected' : ''}>${t.l}</option>`).join('');

      return `
        <div class="activity-question-builder" data-q="${idx}" style="border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--gray-50)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="font-size:13px">Q${idx + 1}</strong>
            <div style="display:flex;gap:6px;align-items:center">
              <label style="font-size:12px;margin:0">Pts:</label>
              <input type="number" min="1" max="1000" step="1" value="${q.points}" style="width:52px" class="form-control form-control-sm" oninput="TeacherController._qSetPoints(${idx}, this.value)" />
              <button class="btn btn-xs btn-danger" onclick="TeacherController._removeQuestion(${idx})">${lmsIcon('trash')}</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:8px">
            <div class="form-group" style="flex:2;margin-bottom:0">
              <input class="form-control" placeholder="Question text *" value="${escHtml(q.text)}"
                oninput="TeacherController._qSetText(${idx}, this.value)" />
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0">
              <select class="form-control" onchange="TeacherController._qSetType(${idx}, this.value)">${typeOpts}</select>
            </div>
          </div>
          ${this._renderChoicesEditor(q, idx)}
        </div>`;
    }).join('') + `
      <div id="act-question-total" style="text-align:right;font-size:13px;font-weight:600;color:var(--maroon);padding:4px 0 8px">
        Total: ${this._questions.reduce((total, question) => total + (Number(question.points) || 0), 0)} points
      </div>`;
  },

  _renderChoicesEditor(q, idx) {
    if (q.type === 'multiple_choice') {
      const choices = q.choices.length
        ? q.choices
        : [{ id: 'c0', text: '' }, { id: 'c1', text: '' }, { id: 'c2', text: '' }, { id: 'c3', text: '' }];
      const rows = choices.map((c, ci) => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <input type="radio" name="correct_${idx}" value="${ci}" ${String(q.correct) === String(ci) ? 'checked' : ''}
            onchange="TeacherController._qSetCorrect(${idx}, '${ci}')" title="Mark as correct" />
          <input class="form-control form-control-sm" placeholder="Choice ${ci + 1}" value="${escHtml(c.text)}"
            oninput="TeacherController._qSetChoice(${idx}, ${ci}, this.value)" style="flex:1" />
          ${choices.length > 2 ? `<button class="btn btn-xs btn-ghost" onclick="TeacherController._qRemoveChoice(${idx}, ${ci})">✕</button>` : ''}
        </div>`).join('');
      return `<div style="margin-top:8px"><div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">Choices (select the correct one)</div>${rows}<button class="btn btn-xs btn-outline" onclick="TeacherController._qAddChoice(${idx})" style="margin-top:4px">${lmsIcon('plus')} Add Choice</button></div>`;
    }

    if (q.type === 'checkbox') {
      const choices = q.choices.length
        ? q.choices
        : [{ id: 'c0', text: '' }, { id: 'c1', text: '' }];
      let correctSet = [];
      try { correctSet = JSON.parse(q.correct || '[]'); } catch { correctSet = []; }
      const rows = choices.map((c, ci) => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <input type="checkbox" ${correctSet.includes(ci) ? 'checked' : ''}
            onchange="TeacherController._qToggleCheckbox(${idx}, ${ci}, this.checked)" title="Mark as correct" />
          <input class="form-control form-control-sm" placeholder="Choice ${ci + 1}" value="${escHtml(c.text)}"
            oninput="TeacherController._qSetChoice(${idx}, ${ci}, this.value)" style="flex:1" />
          ${choices.length > 2 ? `<button class="btn btn-xs btn-ghost" onclick="TeacherController._qRemoveChoice(${idx}, ${ci})">✕</button>` : ''}
        </div>`).join('');
      return `<div style="margin-top:8px"><div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">Choices (check all correct answers)</div>${rows}<button class="btn btn-xs btn-outline" onclick="TeacherController._qAddChoice(${idx})" style="margin-top:4px">${lmsIcon('plus')} Add Choice</button></div>`;
    }

    if (q.type === 'fill_blank') {
      return `<div style="margin-top:8px"><label style="font-size:12px;color:var(--gray-500)">Expected Answer (exact text match, case-insensitive)</label><input class="form-control form-control-sm" placeholder="e.g. Photosynthesis" value="${escHtml(q.correct || '')}" oninput="TeacherController._qSetCorrect(${idx}, this.value)" /></div>`;
    }
    return `<div style="font-size:12px;color:var(--gray-400);margin-top:8px;padding:6px;background:var(--gray-100);border-radius:4px">${lmsIcon('file')} Essay — teacher grades manually after submission.</div>`;
  },

  // ── Question mutation helpers ─────────────────────────────

  _qSetText(idx, val)   { this._questions[idx].text   = val; this._updateActivitySaveState(); },
  _qSetPoints(idx, val) {
    this._questions[idx].points = val === '' ? 0 : Number(val);
    const total = document.getElementById('act-question-total');
    if (total) {
      const points = this._questions.map(question => Number(question.points));
      total.textContent = points.every(Number.isInteger)
        ? `Total: ${points.reduce((sum, value) => sum + value, 0)} points`
        : 'Total: Enter valid whole-number points for every question';
    }
    this._updateActivitySaveState();
  },

  _qSetType(idx, val) {
    this._questions[idx].type    = val;
    this._questions[idx].correct = null;
    if (val === 'multiple_choice' || val === 'checkbox') {
      if (!this._questions[idx].choices.length)
        this._questions[idx].choices = [{ id: 'c0', text: '' }, { id: 'c1', text: '' }];
    } else {
      this._questions[idx].choices = [];
    }
    this._renderQuestions();
    this._updateActivitySaveState();
  },

  _qSetCorrect(idx, val) { this._questions[idx].correct = val; this._updateActivitySaveState(); },

  _qToggleCheckbox(idx, ci, checked) {
    let current = [];
    try { current = JSON.parse(this._questions[idx].correct || '[]'); } catch { current = []; }
    if (checked && !current.includes(ci)) current.push(ci);
    if (!checked) current = current.filter(x => x !== ci);
    this._questions[idx].correct = JSON.stringify(current.sort());
    this._updateActivitySaveState();
  },

  _qSetChoice(idx, ci, val) {
    if (!this._questions[idx].choices.length) {
      const count = this._questions[idx].type === 'multiple_choice' ? 4 : 2;
      this._questions[idx].choices = Array.from({ length: count }, (_, index) => ({
        id: `c${index}`,
        text: '',
      }));
    }
    this._questions[idx].choices[ci].text = val;
    this._updateActivitySaveState();
  },

  _qAddChoice(idx) {
    const ci = this._questions[idx].choices.length;
    this._questions[idx].choices.push({ id: `c${ci}`, text: '' });
    this._renderQuestions();
    this._updateActivitySaveState();
  },

  _qRemoveChoice(idx, ci) {
    const question = this._questions[idx];
    question.choices.splice(ci, 1);
    if (question.type === 'multiple_choice') {
      const correctIndex = Number(question.correct);
      question.correct = question.correct === null || question.correct === ''
        ? null
        : correctIndex === ci
          ? null
          : String(correctIndex > ci ? correctIndex - 1 : correctIndex);
    } else if (question.type === 'checkbox') {
      let correct = [];
      try { correct = JSON.parse(question.correct || '[]'); } catch { correct = []; }
      question.correct = JSON.stringify(correct
        .filter(choiceIndex => choiceIndex !== ci)
        .map(choiceIndex => choiceIndex > ci ? choiceIndex - 1 : choiceIndex));
    }
    this._renderQuestions();
    this._updateActivitySaveState();
  },

  // ── Save Activity ─────────────────────────────────────────

  async saveActivity() {
    const validationMessage = this._activityValidationMessage();
    if (validationMessage) {
      Toast.show(validationMessage, 'error');
      return;
    }

    const title        = document.getElementById('act-title')?.value.trim();
    const subjectId    = parseInt(document.getElementById('act-subject')?.value);
    const term         = document.getElementById('act-term')?.value;
    const moduleId     = parseInt(document.getElementById('act-module')?.value);
    const actType      = document.getElementById('act-type')?.value;
    const actCustom    = document.getElementById('act-type-custom')?.value.trim();
    const format       = document.getElementById('act-format')?.value;
    const selectedFile = document.getElementById('act-file')?.files?.[0] || null;
    const startRaw     = document.getElementById('act-start')?.value;
    const dueRaw       = document.getElementById('act-due')?.value;
    const instructions = document.getElementById('act-instructions')?.value.trim();
    const allowLate    = Boolean(document.getElementById('act-allow-late')?.checked);
    const latePenalty  = allowLate ? Number(document.getElementById('act-late-penalty')?.value) : 0;

    if (!title)     { Toast.show('Activity title is required.', 'error'); return; }
    if (!subjectId) { Toast.show('Please select a subject.', 'error'); return; }
    if (!term)      { Toast.show('Please select a term.', 'error'); return; }
    if (!moduleId)  { Toast.show('Please select a module.', 'error'); return; }

    const singlePrompt = this._isSinglePrompt(format);
    let manualPoints = null;
    if (singlePrompt) {
      const raw = document.getElementById('act-points')?.value;
      manualPoints = Number(raw);
      if (!raw || !Number.isInteger(manualPoints) || manualPoints < 1 || manualPoints > 1000) {
        Toast.show('Please enter the total points (a whole number from 1 to 1000).', 'error'); return;
      }
    }

    if (!singlePrompt && !this._questions.length) {
      Toast.show('Please add at least one question.', 'error'); return;
    }
    if (!singlePrompt) {
      for (const [i, question] of this._questions.entries()) {
        const pointsInput = document.querySelector(`.activity-question-builder[data-q="${i}"] input[type="number"]`);
        if (pointsInput) question.points = Number(pointsInput.value);
        if (!Number.isInteger(question.points) || question.points < 1 || question.points > 1000) {
          Toast.show(`Question ${i + 1} points must be a whole number from 1 to 1000.`, 'error'); return;
        }
      }
    }
    for (const [i, q] of (singlePrompt ? [] : this._questions).entries()) {
      if (!q.text.trim()) { Toast.show(`Question ${i + 1} is missing question text.`, 'error'); return; }
      if ((q.type === 'multiple_choice' || q.type === 'checkbox') && q.choices.filter(c => c.text.trim()).length < 2) {
        Toast.show(`Question ${i + 1} needs at least 2 choices.`, 'error'); return;
      }
      if (q.type === 'multiple_choice' && (q.correct === null || q.correct === '')) {
        Toast.show(`Question ${i + 1}: please select the correct answer.`, 'error'); return;
      }
      if (q.type === 'checkbox') {
        let correctSet = [];
        try { correctSet = JSON.parse(q.correct || '[]'); } catch { correctSet = []; }
        if (!correctSet.length) {
          Toast.show(`Question ${i + 1}: please select at least one correct choice.`, 'error'); return;
        }
      }
    }

    const fmt         = this._FORMAT_TYPES.find(f => f.value === format);
    const gradingMode = fmt?.grading || 'auto';
    const activityFile = gradingMode === 'manual' ? selectedFile : null;
    if (activityFile && activityFile.size > 50 * 1024 * 1024) {
      Toast.show('Activity files must be 50 MB or smaller.', 'error'); return;
    }
    // Freeform / Assignment: one essay prompt carrying the teacher-defined points.
    // This lets students answer + submit through the normal pipeline, and the
    // activity gets a real max_score so grading and analytics have a denominator.
    const singlePromptQuestion = singlePrompt ? {
      order:          0,
      question_text:  instructions || title,
      question_type:  'essay',
      points:         manualPoints,
      correct_answer: null,
      choices:        [],
    } : null;
    const questions   = singlePrompt ? [singlePromptQuestion] : this._questions.map((q, i) => ({
      question_id:    q.question_id ?? null,
      order:          i,
      question_text:  q.text.trim(),
      question_type:  q.type,
      points:         q.points,
      correct_answer: q.correct !== null ? String(q.correct) : null,
      choices:        q.choices.map((c, ci) => ({ order: ci, choice_text: c.text.trim() })).filter(c => c.choice_text),
    }));
    const max_score = singlePrompt
      ? manualPoints
      : (questions.reduce((s, q) => s + q.points, 0) || null);
    const payload = {
      title,
      subject_id:           subjectId,
      module_id:            moduleId,
      term,
      activity_type:        actType,
      activity_type_custom: actType === 'other' ? actCustom : null,
      format_type:          format,
      grading_mode:         gradingMode,
      instructions:         instructions || null,
      start_date:           startRaw ? new Date(startRaw).toISOString() : null,
      due_date:             dueRaw   ? new Date(dueRaw).toISOString()   : null,
      allow_late_submission: allowLate,
      late_penalty_points:   latePenalty,
      max_score,
      is_published:         true,
    };
    if (singlePrompt && this._editingActivityId) {
      // Editing: update the existing prompt in place instead of delete+recreate,
      // otherwise existing student answers would be cascade-deleted.
      payload.single_prompt = singlePromptQuestion;
    } else {
      payload.questions = questions;
    }

    const btn = document.querySelector('#modal-container .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const wasEditing = Boolean(this._editingActivityId);
    const activityId = this._editingActivityId;
    let createdActivityId = null;
    let uploadedFilePath = null;
    let uploadedFileName = null;
    let replacedFileCleanupFailed = false;
    try {
      if (wasEditing) {
        if (activityFile) {
          const uploaded = await api.uploadTeacherActivityFile(activityId, activityFile);
          uploadedFilePath = uploaded.file_path;
          uploadedFileName = uploaded.file_name;
        }
        await api.updateTeacherActivity(this._editingActivityId, payload);
        if (uploadedFilePath) {
          await api.updateTeacherActivity(activityId, {
            file_path: uploadedFilePath,
            file_name: uploadedFileName,
          });
        }
      } else {
        const created = await api.createTeacherActivity(payload);
        createdActivityId = created.id;
        if (activityFile) {
          const uploaded = await api.uploadTeacherActivityFile(created.id, activityFile);
          uploadedFilePath = uploaded.file_path;
          uploadedFileName = uploaded.file_name;
          await api.updateTeacherActivity(created.id, {
            file_path: uploaded.file_path,
            file_name: uploadedFileName,
          });
        }
      }
      if (wasEditing && uploadedFilePath && this._editingActivityFilePath) {
        try {
          await api.removeActivityFile(this._editingActivityFilePath);
        } catch (cleanupError) {
          console.error('Could not remove the replaced activity file:', cleanupError);
          replacedFileCleanupFailed = true;
        }
      }
      this._editingActivityId = null;
      this._editingActivityFilePath = null;
      Modal.close();
      Toast.show(
        replacedFileCleanupFailed
          ? 'Activity saved, but the previous file could not be removed.'
          : (wasEditing ? 'Activity updated successfully!' : 'Activity created successfully!'),
        replacedFileCleanupFailed ? 'error' : 'success',
      );
      DashboardController.loadSection('activities');
    } catch (err) {
      const cleanupErrors = [];
      if (uploadedFilePath) {
        try { await api.removeActivityFile(uploadedFilePath); }
        catch (cleanupError) { cleanupErrors.push(`uploaded file cleanup failed: ${cleanupError.message}`); }
      }
      if (createdActivityId) {
        try { await api.deleteTeacherActivity(createdActivityId); }
        catch (cleanupError) { cleanupErrors.push(`activity cleanup failed: ${cleanupError.message}`); }
      }
      if (btn) {
        btn.innerHTML = `${lmsIcon('save')} ${wasEditing ? 'Update Activity' : 'Save Activity'}`;
        this._updateActivitySaveState();
      }
      Toast.show(
        [err.message || 'Failed to save activity.', ...cleanupErrors].join(' — '),
        'error',
      );
    }
  },

  // ── Delete Activity ───────────────────────────────────────

  async deleteActivity(id) {
    if (!confirm('Delete this activity and all its submissions? This cannot be undone.')) return;
    try {
      await api.deleteTeacherActivity(id);
      Toast.show('Activity deleted.', 'info');
      DashboardController.loadSection('activities');
    } catch (err) {
      Toast.show(err.message || 'Failed to delete activity.', 'error');
    }
  },

  // ── Grade Submissions Modal ───────────────────────────────

  async openGradeActivity(activityId) {
    Modal.show(`${lmsIcon('chart')} Submissions`, '<div class="text-center">Loading submissions…</div>', '', { wide: true });
    try {
      const [activity, submissions] = await Promise.all([
        api.getTeacherActivity(activityId),
        api.getActivitySubmissions(activityId),
      ]);

      // Fetch enrolled students for this subject so we can show who hasn't submitted
      let enrolledStudents = [];
      if (activity.subject_id) {
        const { data: enrolled } = await api.sb
          .from("student_subject_enrollments")
          .select("students(id, student_number, users(first_name, last_name), student_section_assignments(sections(classes(id, name))))")
          .eq("subject_id", activity.subject_id);
        enrolledStudents = (enrolled || []).map(e => {
          const s   = e.students;
          const u   = s?.users;
          const cls = s?.student_section_assignments?.[0]?.sections?.classes;
          return {
            id:           s?.id,
            full_name:    u ? `${u.first_name} ${u.last_name}`.trim() : `Student #${s?.id}`,
            student_number: s?.student_number,
            class_name:   cls?.name || null,
            class_id:     cls?.id   || null,
          };
        }).filter(s => s.id);
      }

      const submittedIds = new Set(submissions.map(s => s.student_id));
      const notSubmitted = enrolledStudents.filter(s => !submittedIds.has(s.id));

      if (!submissions.length) {
        const nsList = notSubmitted.map(s =>
          `<li style="padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:13px">
            ${escHtml(s.full_name)}
            ${s.class_name ? `<span style="color:#9ca3af;font-size:11px;margin-left:6px">${escHtml(s.class_name)}</span>` : ''}
          </li>`).join('');
        Modal.show(`${lmsIcon('chart')} Submissions`,
          `<div class="empty-state" style="padding:24px 0">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-title">No submissions yet</div>
            ${notSubmitted.length ? `<div style="margin-top:16px;text-align:left;max-width:360px">
              <p style="font-size:13px;font-weight:600;margin-bottom:8px">🕐 Not yet answered (${notSubmitted.length}):</p>
              <ul style="list-style:none;padding:0;margin:0">${nsList}</ul>
            </div>` : ''}
          </div>`,
          '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>',
          { wide: true }
        );
        return;
      }

      const isManual = activity.grading_mode === 'manual';

      // ── Section map from submitted students ──────────────────────────────
      const sectionMap = new Map();
      submissions.forEach(s => {
        if (s.class_id && s.section_name) sectionMap.set(s.class_id, s.section_name);
      });

      // Section filter — always show if there's at least 1 section
      const sectionFilterHtml = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <span style="font-size:13px;color:#6b7280;font-weight:500;">${lmsIcon('school')} Section:</span>
          <select id="submission-section-filter"
            style="padding:5px 10px;border-radius:6px;border:1px solid #d1d5db;font-size:13px;cursor:pointer"
            onchange="TeacherController._filterSubmissionRows()">
            <option value="">All Sections (${submissions.length} submitted)</option>
            ${[...sectionMap.entries()].map(([id, name]) =>
              `<option value="${id}">${escHtml(name)} — ${submissions.filter(s => s.class_id === id).length} submitted</option>`
            ).join('')}
          </select>
        </div>`;

      // ── Summary stats ─────────────────────────────────────────────────────
      const submissionMaxScore = s => s.max_score > 0 ? s.max_score : activity.max_score;
      const gradedSubs   = submissions.filter(s => s.is_graded && s.score != null && submissionMaxScore(s) > 0);
      const passed       = gradedSubs.filter(s => (s.score / submissionMaxScore(s)) >= 0.75);
      const failed       = gradedSubs.filter(s => (s.score / submissionMaxScore(s)) <  0.75);
      const pendingGrade = submissions.filter(s => !s.is_graded);
      const avgScore     = gradedSubs.length
        ? Math.round(gradedSubs.reduce((acc, s) => acc + (s.score / submissionMaxScore(s) * 100), 0) / gradedSubs.length)
        : null;
      const passPct  = gradedSubs.length ? Math.round(passed.length / gradedSubs.length * 100) : null;
      const failPct  = gradedSubs.length ? Math.round(failed.length / gradedSubs.length * 100) : null;

      // Not yet submitted list
      const notSubmittedHtml = notSubmitted.length
        ? `<div style="margin-top:18px;padding:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px">
            <div style="font-size:13px;font-weight:700;color:#c2410c;margin-bottom:10px">
              🕐 Not Yet Submitted (${notSubmitted.length} of ${enrolledStudents.length} enrolled)
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${notSubmitted.map(s => `
                <span style="background:#fff;border:1px solid #fca5a5;border-radius:6px;padding:4px 10px;font-size:12px">
                  ${escHtml(s.full_name)}
                  ${s.class_name ? `<span style="color:#9ca3af;margin-left:4px">(${escHtml(s.class_name)})</span>` : ''}
                </span>`).join('')}
            </div>
          </div>`
        : `<div style="margin-top:10px;font-size:12px;color:#059669">${lmsIcon('check')} All enrolled students have submitted.</div>`;

      const statBox = (value, label, color) =>
        `<div style="text-align:center;min-width:90px;flex:1">
          <div style="font-size:24px;font-weight:700;color:${color}">${value}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:3px">${label}</div>
        </div>`;

      const summaryHtml =
        `<div style="margin-top:18px;padding:14px 10px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb">
          <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;align-items:flex-start">
            ${statBox(submissions.length, 'Submitted', '#7b1c1c')}
            ${statBox(passed.length, 'Passed' + (passPct !== null ? ' (' + passPct + '%)' : ''), '#059669')}
            ${statBox(failed.length, 'Failed' + (failPct !== null ? ' (' + failPct + '%)' : ''), '#dc2626')}
            ${statBox(pendingGrade.length, 'Pending Grade', '#d97706')}
            ${avgScore !== null ? statBox(avgScore + '%', 'Class Average', '#2563eb') : ''}
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:10px;text-align:center">
            Passing threshold: 75% &nbsp;|&nbsp; ${gradedSubs.length} graded &nbsp;|&nbsp; ${pendingGrade.length} pending
          </div>
        </div>`;

      const buildRows = (subs) => subs.map(s => {
        const studentLabel = escHtml(s.student_name || `Student #${s.student_id}`);
        const sectionBadge = s.section_name
          ? `<br><span style="font-size:11px;color:#6b7280">${escHtml(s.section_name)}</span>` : '';
        const submittedAt  = s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : '—';
        let scoreCell = '— Pending —', pctCell = '—', gradeCell = s.grade == null ? '—' : escHtml(String(s.grade));

        const maxScore = submissionMaxScore(s);
        if (s.is_graded && s.score != null && maxScore > 0) {
          const pct   = Math.round(s.score / maxScore * 100);
          scoreCell = `${s.score}/${maxScore}`;
          pctCell   = `${pct}%`;
          gradeCell = s.grade == null ? '—' : escHtml(String(s.grade));
        } else if (s.is_graded) {
          scoreCell = s.score != null ? `${s.score}/${maxScore ?? '—'}` : '—';
        }

        const gradeBtn = isManual && !s.is_graded
          ? `<button class="btn btn-xs btn-primary" onclick="TeacherController.openManualGrade(${activity.id}, ${s.id}, ${activity.max_score ?? 0}, ${Boolean(s.is_late)}, ${Number(s.late_penalty_points || 0)})">${lmsIcon('pen')} Grade</button>`
          : (s.is_graded ? `<span class="badge badge-green">✓ Graded</span>` : `<span class="badge badge-gray">Auto</span>`);

        return `<tr data-class-id="${s.class_id || ''}" data-searchable
          style="cursor:pointer"
          onclick="TeacherController.viewStudentAnswers(${activity.id}, ${s.id})"
          title="Click to view ${escHtml(s.student_name || 'student')}'s answers">
          <td><strong>${studentLabel}</strong>${sectionBadge}</td>
          <td>${submittedAt}</td>
          <td>${scoreCell}</td>
          <td>${pctCell}</td>
          <td>${gradeCell}</td>
          <td onclick="event.stopPropagation()">${gradeBtn}</td>
        </tr>`;
      }).join('');

      // Store submissions on controller for filter re-render
      TeacherController._submissionsCache = { activity, submissions, notSubmitted, isManual, buildRows };

      Modal.show(
        `${lmsIcon('chart')} ${escHtml(activity.title)} — Submissions`,
        `${sectionFilterHtml}
        <div class="table-wrap"><table class="data-table" id="submissions-table">
          <thead><tr><th>Student</th><th>Submitted</th><th>Score</th><th>%</th><th>Grade</th><th>Action</th></tr></thead>
          <tbody id="submissions-tbody">${buildRows(submissions)}</tbody>
        </table></div>
        ${summaryHtml}
        ${notSubmittedHtml}`,
        `<button class="btn btn-ghost" onclick="Modal.close()">Close</button>`,
        { wide: true }
      );
    } catch (err) {
      Modal.show(`${lmsIcon('chart')} Submissions`,
        `<div class="text-danger">Error: ${err.message}</div>`,
        '<button class="btn btn-ghost" onclick="Modal.close()">Close</button>',
        { wide: true }
      );
    }
  },

  // ── Manual Grade Modal ────────────────────────────────────

  // Section filter for submissions modal
  _submissionsCache: null,

  _filterSubmissionRows() {
    const sel     = document.getElementById('submission-section-filter');
    const classId = sel ? sel.value : '';
    const tbody   = document.getElementById('submissions-tbody');
    if (!tbody) return;
    const cache = TeacherController._submissionsCache;
    if (!cache) return;
    const filtered = classId
      ? cache.submissions.filter(s => String(s.class_id) === String(classId))
      : cache.submissions;
    tbody.innerHTML = cache.buildRows(filtered);
  },

  // ── View individual student answers ──────────────────────────────────
  async viewStudentAnswers(activityId, submissionId) {
    Modal.show(`${lmsIcon('clipboard')} Student Answers`, '<div class="text-center" style="padding:24px">Loading…</div>', '', { wide: true });
    try {
      const cache = TeacherController._submissionsCache;
      const submission = cache?.submissions.find(s => s.id === submissionId);
      if (!submission) throw new Error('Submission not found in cache');

      // Fetch activity with questions + correct answers (teacher can see correct_answer)
      const activity = await api.getTeacherActivity(activityId);
      const answers  = submission.activity_answers || [];
      const activityFileUrl = activity.file_path
        ? await api.getActivityFileSignedUrl(activity.file_path)
        : null;

      // Map answers by question_id for quick lookup
      const answerMap = new Map(answers.map(a => [a.question_id, a]));

      const studentName   = escHtml(submission.student_name || `Student #${submission.student_id}`);
      const submittedDate = submission.submitted_at
        ? new Date(submission.submitted_at).toLocaleString() : '—';
      const submissionMaxScore = submission.max_score > 0 ? submission.max_score : activity.max_score;
      const scoreLabel    = submission.is_graded && submission.score != null
        ? `${submission.score} / ${submissionMaxScore ?? '—'}`
        : 'Pending';

      // Normalize: getTeacherActivity returns activity_questions, not questions
      const questions = (activity.activity_questions || [])
        .sort((a, b) => a.order - b.order)
        .map(q => ({
          ...q,
          choices: (q.activity_question_choices || []).sort((a, b) => a.order - b.order),
        }));
      const questionRows = (await Promise.all(questions.map(async (q, idx) => {
        const ans      = answerMap.get(q.id);
        let answered   = ans?.answer_value ?? null;
        const type     = q.question_type;
        let attachment = null;
        if (answered) {
          let parsed;
          try { parsed = JSON.parse(answered); } catch (_) {}
          if (parsed && typeof parsed === 'object' && parsed.file_path) {
            attachment = {
              ...parsed,
              file_url: await api.getActivityFileSignedUrl(parsed.file_path),
            };
            answered = parsed.text || '';
          }
        }

        // ── Render the student's answer based on question type ──────────
        let answerDisplay = '<span style="color:#9ca3af;font-style:italic">No answer</span>';
        let resultBadge   = '';

        if (attachment) {
          answerDisplay = `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-top:4px;white-space:pre-wrap;font-size:13px;line-height:1.6">${answered ? `${escHtml(String(answered))}<br>` : ''}<a href="${escHtml(attachment.file_url)}" target="_blank" rel="noopener noreferrer">${escHtml(attachment.file_name || 'Download submitted file')}</a></div>`;
        } else if (answered !== null && answered !== undefined && answered !== '') {
          if (type === 'multiple_choice' || type === 'fill_blank') {
            const isCorrect = ans?.is_correct;
            answerDisplay   = `<span style="font-weight:600">${escHtml(String(answered))}</span>`;
            if (isCorrect === true)  resultBadge = '<span class="badge badge-green" style="margin-left:8px">✓ Correct</span>';
            if (isCorrect === false) resultBadge = '<span class="badge badge-danger" style="margin-left:8px">✗ Wrong</span>';

          } else if (type === 'checkbox' || type === 'enumeration') {
            let parsed = answered;
            try { parsed = JSON.parse(answered); } catch (_) {}
            const displayVal = Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
            answerDisplay   = `<span style="font-weight:600">${escHtml(displayVal)}</span>`;
            if (ans?.is_correct === true)  resultBadge = '<span class="badge badge-green" style="margin-left:8px">✓ Correct</span>';
            if (ans?.is_correct === false) resultBadge = '<span class="badge badge-danger" style="margin-left:8px">✗ Wrong</span>';

          } else {
            // essay / freeform / assignment — just show the text
            answerDisplay = `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-top:4px;white-space:pre-wrap;font-size:13px;line-height:1.6">${escHtml(String(answered))}</div>`;
          }
        }

        // Show correct answer for auto-graded types
        let correctDisplay = '';
        if (q.correct_answer && type !== 'essay' && type !== 'assignment' && type !== 'freeform') {
          let correctVal = q.correct_answer;
          try {
            const parsed = JSON.parse(q.correct_answer);
            if (Array.isArray(parsed)) correctVal = parsed.join(', ');
          } catch (_) {}
          correctDisplay = `
            <div style="margin-top:6px;font-size:12px;color:#6b7280">
              Correct answer: <strong style="color:#059669">${escHtml(String(correctVal))}</strong>
            </div>`;
        }

        // Points earned
        const pts = ans?.points_earned != null
          ? `<span style="float:right;font-size:12px;color:#6b7280">${ans.points_earned}/${q.points} pts</span>`
          : `<span style="float:right;font-size:12px;color:#9ca3af">${q.points} pts</span>`;

        return `
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#fff">
            <div style="font-size:13px;color:#6b7280;margin-bottom:4px">
              Question ${idx + 1} <span style="text-transform:uppercase;font-size:11px;background:#f3f4f6;padding:2px 7px;border-radius:4px;margin-left:6px">${type.replace('_', ' ')}</span>
              ${pts}
            </div>
            <div style="font-weight:600;font-size:15px;margin-bottom:10px;clear:both">${escHtml(q.question_text)}</div>
            <div style="font-size:14px">${answerDisplay}${resultBadge}</div>
            ${correctDisplay}
          </div>`;
      }))).join('');

      const gradeSection = submission.is_graded
        ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
            <span>${lmsIcon('check')} <strong>Graded</strong></span>
            <span>Score: <strong>${scoreLabel}</strong></span>
            ${submission.grade ? `<span>Grade: <strong>${escHtml(submission.grade)}</strong></span>` : ''}
            ${submission.remarks ? `<span style="color:#6b7280;font-size:13px">${escHtml(submission.remarks)}</span>` : ''}
          </div>`
        : `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 16px;margin-bottom:16px">
            ${lmsIcon('loading')} <strong>Pending grade</strong>
            ${activity.grading_mode === 'manual'
              ? `<button class="btn btn-xs btn-primary" style="margin-left:12px"
                   onclick="TeacherController.openManualGrade(${activityId}, ${submissionId}, ${activity.max_score ?? 0}, ${Boolean(submission.is_late)}, ${Number(submission.late_penalty_points || 0)})">
                   ${lmsIcon('pen')} Grade Now</button>`
              : ''}
          </div>`;

      Modal.show(
        `${lmsIcon('clipboard')} ${escHtml(studentName)} — Answers`,
        `<div style="font-size:13px;color:#6b7280;margin-bottom:6px">
          Submitted: ${submittedDate} &nbsp;|&nbsp; Activity: <strong>${escHtml(activity.title)}</strong>
        </div>
        ${activityFileUrl ? `<div style="margin-bottom:12px;font-size:13px">Activity file: <a href="${escHtml(activityFileUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(activity.file_name || 'Download activity file')}</a></div>` : ''}
        ${gradeSection}
        <div>${questionRows || '<p style="color:#9ca3af;text-align:center">No questions found.</p>'}</div>`,
        `<button class="btn btn-ghost" onclick="TeacherController.openGradeActivity(${activityId})">← Back to Submissions</button>
         <button class="btn btn-ghost" onclick="Modal.close()">Close</button>`,
        { wide: true }
      );
    } catch (err) {
      console.error('viewStudentAnswers error:', err);
      Modal.show('Error', `<p>Could not load answers: ${escHtml(err.message)}</p>`,
        `<button class="btn btn-ghost" onclick="Modal.close()">Close</button>`);
    }
  },

  openManualGrade(activityId, submissionId, maxScore, isLate = false, latePenalty = 0) {
    if (!maxScore || maxScore <= 0) {
      Toast.show('This activity has no total points yet. Click Edit on the activity and set the points first.', 'error');
      return;
    }
    Modal.show(`${lmsIcon('pen')} Enter Grade`, `
      ${isLate && latePenalty > 0 ? `<p class="text-sm" style="padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412">Late submission: ${latePenalty} point${latePenalty === 1 ? '' : 's'} will be deducted from the score entered here.</p>` : ''}
      <div class="form-group">
        <label>Score <span class="text-muted">/ ${maxScore}</span></label>
        <input class="form-control" id="mg-score" type="number" min="0" max="${maxScore}" placeholder="0–${maxScore}" />
      </div>
      <div class="form-group">
        <label>Letter Grade <span class="text-muted">(optional)</span></label>
        <select class="form-control" id="mg-grade">
          <option value="">— Select —</option>
          <option value="A">A</option><option value="B">B</option><option value="C">C</option>
          <option value="D">D</option><option value="F">F</option>
          <option value="Excellent">Excellent</option><option value="Very Good">Very Good</option>
          <option value="Good">Good</option><option value="Fair">Fair</option>
          <option value="Needs Improvement">Needs Improvement</option>
        </select>
      </div>
      <div class="form-group">
        <label>Remarks <span class="text-muted">(optional)</span></label>
        <textarea class="form-control" id="mg-remarks" rows="2" placeholder="e.g. Good effort! Work on your enumeration."></textarea>
      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" onclick="TeacherController.submitManualGrade(${activityId}, ${submissionId})">Submit Grade</button>`
    );
  },

  async submitManualGrade(activityId, submissionId) {
    const scoreInput = document.getElementById('mg-score');
    const score   = parseInt(scoreInput?.value);
    const maxScore = scoreInput?.max !== '' ? Number(scoreInput?.max) : null;
    const grade   = document.getElementById('mg-grade')?.value   || null;
    const remarks = document.getElementById('mg-remarks')?.value.trim() || null;
    if (isNaN(score) || score < 0) { Toast.show('Please enter a valid score.', 'error'); return; }
    if (maxScore !== null && score > maxScore) { Toast.show(`Score can't exceed ${maxScore}.`, 'error'); return; }
    const btn = document.querySelector('#modal-container .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await api.manualGradeSubmission(activityId, submissionId, { score, grade, remarks });
      Toast.show('Grade saved! The student has been notified.', 'success');
      await this.openGradeActivity(activityId);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Grade'; }
      Toast.show(err.message || 'Failed to save grade.', 'error');
    }
  },

  // ── Edit Activity ────────────────────────────────────────
  async openEditActivity(id) {
    try {
      const activity = await api.getTeacherActivity(id);
      await this.openAddActivity(activity.subject_id, activity);
    } catch (err) {
      Toast.show(err.message || 'Failed to load activity for editing.', 'error');
    }
  },
  updateActivity(id)   { return this.openEditActivity(id); },
  saveGrades(actId)    { /* legacy */ },
};
