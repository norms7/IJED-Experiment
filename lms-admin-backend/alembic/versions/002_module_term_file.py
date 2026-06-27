"""Add term, file_url, file_name, teacher_id to modules

Revision ID: 002_module_term_file
Revises: 001_initial
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = '002_module_term_file'
down_revision = '001_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('modules', sa.Column('teacher_id', sa.Integer(), sa.ForeignKey('teachers.id'), nullable=True))
    op.add_column('modules', sa.Column('term', sa.String(20), nullable=True))
    op.add_column('modules', sa.Column('file_url', sa.String(500), nullable=True))
    op.add_column('modules', sa.Column('file_name', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('modules', 'teacher_id')
    op.drop_column('modules', 'term')
    op.drop_column('modules', 'file_url')
    op.drop_column('modules', 'file_name')