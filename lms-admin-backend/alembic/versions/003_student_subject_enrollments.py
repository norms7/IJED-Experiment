"""student_subject_enrollments table

Revision ID: 003_student_subject_enrollments
Revises: 002_module_term_file
Create Date: 2026-04-19
"""
from alembic import op
import sqlalchemy as sa

revision = '003_student_subject_enrollments'
down_revision = '002_module_term_file'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'student_subject_enrollments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('student_id', sa.Integer(), sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=False),
        sa.Column('subject_id', sa.Integer(), sa.ForeignKey('subjects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('student_id', 'subject_id', name='uq_student_subject'),
    )
    op.create_index('ix_sse_student_id', 'student_subject_enrollments', ['student_id'])
    op.create_index('ix_sse_subject_id', 'student_subject_enrollments', ['subject_id'])


def downgrade() -> None:
    op.drop_index('ix_sse_subject_id', table_name='student_subject_enrollments')
    op.drop_index('ix_sse_student_id', table_name='student_subject_enrollments')
    op.drop_table('student_subject_enrollments')