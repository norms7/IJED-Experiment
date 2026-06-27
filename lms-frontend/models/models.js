/* ============================================================
   models/models.js
   Data layer — localStorage as mock database (empty by default)
   Each model handles its own CRUD. No seed data.
   ============================================================ */

"use strict";

/* ── UserModel ──────────────────────────────────────────────
   Handles all user-related data operations.
   Roles: admin | teacher | student
   Soft-delete via isActive flag (never physically removed).
   ────────────────────────────────────────────────────────── */
class UserModel {
  constructor() {
    this.KEY = 'ijla_users';
    // No seed data – localStorage will be empty initially
  }

  _all()   { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); }

  /** Returns only active users */
  getAll()         { return this._all().filter(u => u.isActive); }
  /** Returns all users including soft-deleted (for admin views) */
  getAllIncluding() { return this._all(); }
  getById(id)      { return this._all().find(u => u.id === id) || null; }
  getByRole(role)  { return this._all().filter(u => u.role === role && u.isActive); }

  findByCredentials(email, password) {
    return this._all().find(u => u.email === email && u.password === password && u.isActive) || null;
  }

  add(userData) {
    const all = this._all();
    const user = {
      ...userData,
      id: 'u' + Date.now(),
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0],
    };
    all.push(user);
    this._save(all);
    return user;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(u => u.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }

  /** Soft delete — sets isActive:false */
  softDelete(id) { return this.update(id, { isActive: false }); }
}

/* ── SubjectModel ──────────────────────────────────────────
   Manages academic subjects assigned to teachers.
   ────────────────────────────────────────────────────────── */
class SubjectModel {
  constructor() {
    this.KEY = 'ijla_subjects';
  }

  _all()    { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d)  { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll()  { return this._all().filter(s => s.isActive); }
  getById(id)           { return this._all().find(s => s.id === id) || null; }
  getByTeacher(tid)     { return this._all().filter(s => s.teacherId === tid && s.isActive); }

  add(data) {
    const all = this._all();
    const subject = { ...data, id: 's' + Date.now(), isActive: true };
    all.push(subject);
    this._save(all);
    return subject;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }
}

/* ── ModuleModel ───────────────────────────────────────────
   Learning modules uploaded by teachers.
   Supports soft delete via isActive flag.
   ────────────────────────────────────────────────────────── */
class ModuleModel {
  constructor() {
    this.KEY = 'ijla_modules';
  }

  _all()    { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d)  { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll()  { return this._all().filter(m => m.isActive); }
  getById(id)           { return this._all().find(m => m.id === id) || null; }
  getBySubject(sid)     { return this._all().filter(m => m.subjectId === sid && m.isActive); }
  getByTeacher(tid)     { return this._all().filter(m => m.teacherId === tid && m.isActive); }

  add(data) {
    const all = this._all();
    const module = {
      ...data,
      id: 'm' + Date.now(),
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0],
    };
    all.push(module);
    this._save(all);
    return module;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(m => m.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }

  softDelete(id) { return this.update(id, { isActive: false }); }
}

/* ── ActivityModel ─────────────────────────────────────────
   Activities and quizzes created by teachers.
   Types: quiz | assignment | essay
   ────────────────────────────────────────────────────────── */
class ActivityModel {
  constructor() {
    this.KEY = 'ijla_activities';
  }

  _all()    { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d)  { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll()  { return this._all().filter(a => a.isActive); }
  getById(id)       { return this._all().find(a => a.id === id) || null; }
  getBySubject(sid) { return this._all().filter(a => a.subjectId === sid && a.isActive); }
  getByTeacher(tid) { return this._all().filter(a => a.teacherId === tid && a.isActive); }

  add(data) {
    const all = this._all();
    const activity = {
      ...data,
      id: 'a' + Date.now(),
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0],
    };
    all.push(activity);
    this._save(all);
    return activity;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(a => a.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }

  softDelete(id) { return this.update(id, { isActive: false }); }
}

/* ── GradeModel ────────────────────────────────────────────
   Grade records linking students → activities.
   score / maxScore used to compute percentage and letter grade.
   ────────────────────────────────────────────────────────── */
class GradeModel {
  constructor() {
    this.KEY = 'ijla_grades';
  }

  _all()    { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d)  { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll()  { return this._all(); }
  getByStudent(sid)  { return this._all().filter(g => g.studentId === sid); }
  getByActivity(aid) { return this._all().filter(g => g.activityId === aid); }
  getBySubject(sid)  { return this._all().filter(g => g.subjectId === sid); }

  add(data) {
    const all = this._all();
    const grade = {
      ...data,
      id: 'g' + Date.now(),
      gradedAt: new Date().toISOString().split('T')[0],
    };
    all.push(grade);
    this._save(all);
    return grade;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(g => g.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }
}

/* ── CalendarEventModel ────────────────────────────────────
   Stores calendar events per role.
   Types: announcement | class | activity-due | exam | holiday | meeting | todo
   visibility: 'all' | 'teacher' | 'student' | userId
   ────────────────────────────────────────────────────────── */
class CalendarEventModel {
  constructor() {
    this.KEY = 'ijed_calendar_events';
  }

  _all()   { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll() { return this._all(); }
  getById(id) { return this._all().find(e => e.id === id) || null; }

  /** Get events visible to a user based on role and userId */
  getForUser(userId, role) {
    return this._all().filter(e =>
      e.visibility === 'all' ||
      e.visibility === role ||
      e.visibility === userId
    );
  }

  getByDate(date, userId, role) {
    return this.getForUser(userId, role).filter(e => e.date === date);
  }

  add(data) {
    const all = this._all();
    const event = { ...data, id: 'ce' + Date.now() };
    all.push(event);
    this._save(all);
    return event;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(e => e.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }

  delete(id) {
    const all = this._all().filter(e => e.id !== id);
    this._save(all);
  }
}

/* ── TodoModel ─────────────────────────────────────────────
   Daily to-do items per user.
   ────────────────────────────────────────────────────────── */
class TodoModel {
  constructor() {
    this.KEY = 'ijed_todos';
  }

  _all()   { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); }

  getForUserDate(userId, date) {
    return this._all().filter(t => t.userId === userId && t.date === date);
  }

  add(userId, text, date) {
    const all = this._all();
    const todo = { id: 't' + Date.now(), userId, text, date, done: false };
    all.push(todo);
    this._save(all);
    return todo;
  }

  toggle(id) {
    const all = this._all();
    const idx = all.findIndex(t => t.id === id);
    if (idx === -1) return;
    all[idx].done = !all[idx].done;
    this._save(all);
  }

  delete(id) {
    this._save(this._all().filter(t => t.id !== id));
  }
}

/* ── Singleton Instances ───────────────────────────────────
   Instantiated once and shared across all controllers/views.
   ────────────────────────────────────────────────────────── */
const userModel     = new UserModel();
const subjectModel  = new SubjectModel();
const moduleModel   = new ModuleModel();
const activityModel = new ActivityModel();
const gradeModel    = new GradeModel();
const calendarModel = new CalendarEventModel();
const todoModel     = new TodoModel();

/* ── SectionModel ──────────────────────────────────────────
   Represents a class section (e.g. Grade 7 – Sampaguita).
   Sections have an adviser (teacher) and enrolled students.
   ────────────────────────────────────────────────────────── */
class SectionModel {
  constructor() {
    this.KEY = 'ijed_sections';
  }

  _all()   { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll() { return this._all().filter(s => s.isActive); }
  getById(id) { return this._all().find(s => s.id === id) || null; }
  getByAdviser(tid) { return this._all().filter(s => s.adviserId === tid && s.isActive); }

  add(data) {
    const all = this._all();
    const sec = { ...data, id: 'sec' + Date.now(), isActive: true };
    all.push(sec);
    this._save(all);
    return sec;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }

  softDelete(id) { return this.update(id, { isActive: false }); }
}

/* ── ScheduleModel ─────────────────────────────────────────
   Weekly schedule entries linking teacher → subject → section.
   day: 'Monday' | 'Tuesday' … | 'Friday'
   ────────────────────────────────────────────────────────── */
class ScheduleModel {
  constructor() {
    this.KEY = 'ijed_schedules';
  }

  _all()   { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); }
  getAll() { return this._all().filter(s => s.isActive); }
  getById(id) { return this._all().find(s => s.id === id) || null; }
  getByTeacher(tid) { return this._all().filter(s => s.teacherId === tid && s.isActive); }
  getBySection(sid) { return this._all().filter(s => s.sectionId === sid && s.isActive); }
  getBySubject(subId) { return this._all().filter(s => s.subjectId === subId && s.isActive); }

  /** Conflict check: same teacher/room/day/overlapping time */
  hasConflict(data, excludeId = null) {
    return this._all().filter(s => s.isActive && s.id !== excludeId).some(s => {
      if (s.day !== data.day) return false;
      const sameTeacher = s.teacherId === data.teacherId;
      const sameRoom    = s.room === data.room && data.room;
      if (!sameTeacher && !sameRoom) return false;
      // Overlap check
      return data.timeStart < s.timeEnd && data.timeEnd > s.timeStart;
    });
  }

  add(data) {
    const all = this._all();
    const sch = { ...data, id: 'sch' + Date.now(), isActive: true };
    all.push(sch);
    this._save(all);
    return sch;
  }

  update(id, updates) {
    const all = this._all();
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    this._save(all);
    return all[idx];
  }

  softDelete(id) { return this.update(id, { isActive: false }); }
}

/* ── AuditLogModel ─────────────────────────────────────────
   Immutable audit trail for all admin actions.
   ────────────────────────────────────────────────────────── */
class AuditLogModel {
  constructor() { this.KEY = 'ijed_audit_logs'; }

  _all()   { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
  _save(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); }

  log(action, entity, details, adminId) {
    const all = this._all();
    all.unshift({
      id:        'log' + Date.now(),
      action,    // 'CREATE' | 'UPDATE' | 'DELETE' | 'ASSIGN' | 'IMPORT'
      entity,    // 'user' | 'section' | 'schedule'
      details,   // human-readable string
      adminId,
      timestamp: new Date().toISOString(),
    });
    // Keep only last 200 logs
    this._save(all.slice(0, 200));
  }

  getAll()           { return this._all(); }
  getRecent(n = 50)  { return this._all().slice(0, n); }
  getByAdmin(id)     { return this._all().filter(l => l.adminId === id); }
}

/* ── Extend singleton instances with new models ─────────── */
const sectionModel  = new SectionModel();
const scheduleModel = new ScheduleModel();
const auditModel    = new AuditLogModel();