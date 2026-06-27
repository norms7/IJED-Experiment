"""add student_module_reads table

Revision ID: a1b2c3d4e5f6
Revises: 
Create Date: 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '004_activity_questions_submissions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'student_module_reads',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('student_id', sa.Integer(), sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=False),
        sa.Column('module_id', sa.Integer(), sa.ForeignKey('modules.id', ondelete='CASCADE'), nullable=False),
        sa.Column('first_read_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_read_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('student_id', 'module_id', name='uq_student_module_read'),
    )
    op.create_index('ix_student_module_reads_student_id', 'student_module_reads', ['student_id'])
    op.create_index('ix_student_module_reads_module_id', 'student_module_reads', ['module_id'])


def downgrade() -> None:
    op.drop_table('student_module_reads')