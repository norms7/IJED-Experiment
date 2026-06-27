"""add attendance tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── attendance_sessions ───────────────────────────────────────────────────
    # One row per class meeting (per section + subject + date).
    # has_class=False means "No Class" day — counts the meeting but no attendance taken.
    op.create_table(
        'attendance_sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('teacher_id', sa.Integer(),
                  sa.ForeignKey('teachers.id', ondelete='CASCADE'), nullable=False),
        sa.Column('class_id', sa.Integer(),
                  sa.ForeignKey('classes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('subject_id', sa.Integer(),
                  sa.ForeignKey('subjects.id', ondelete='SET NULL'), nullable=True),
        sa.Column('term', sa.String(20), nullable=False, server_default='1st'),
        sa.Column('session_date', sa.Date(), nullable=False),
        sa.Column('has_class', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('class_id', 'subject_id', 'session_date',
                            name='uq_attendance_session_class_subject_date'),
    )
    op.create_index('ix_att_sessions_class_id',   'attendance_sessions', ['class_id'])
    op.create_index('ix_att_sessions_teacher_id', 'attendance_sessions', ['teacher_id'])
    op.create_index('ix_att_sessions_date',       'attendance_sessions', ['session_date'])

    # ── attendance_records ────────────────────────────────────────────────────
    # One row per student per session. status: 'present' | 'absent' | 'late' | 'excused'
    op.create_table(
        'attendance_records',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_id', sa.Integer(),
                  sa.ForeignKey('attendance_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('student_id', sa.Integer(),
                  sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(10), nullable=False, server_default='absent'),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.UniqueConstraint('session_id', 'student_id', name='uq_att_record_session_student'),
    )
    op.create_index('ix_att_records_session_id', 'attendance_records', ['session_id'])
    op.create_index('ix_att_records_student_id', 'attendance_records', ['student_id'])


def downgrade() -> None:
    op.drop_table('attendance_records')
    op.drop_table('attendance_sessions')