"""add_analytics_cache_table

Revision ID: 005_analytics_cache
Revises: 2b727c506450
Create Date: 2025-06-16

Adds:
  analytics_cache — stores serialised Bayesian computation results per student
                    so expensive posterior calculations are not rerun on every
                    page load. Cache is invalidated whenever a new graded
                    submission arrives (handled at the service layer via
                    DELETE WHERE student_id = ?).

Column notes:
  cache_key   – dotted identifier, e.g. "bayesian.predicted_grade.all"
  payload     – JSON blob of the computed result
  computed_at – timestamp; callers check if stale (> 1 hour) and recompute
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "005_analytics_cache"
down_revision = "2b727c506450"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_cache",
        sa.Column("id",          sa.Integer(),     primary_key=True),
        sa.Column("student_id",  sa.Integer(),     sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cache_key",   sa.String(120),   nullable=False),
        sa.Column("payload",     sa.Text(),         nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("student_id", "cache_key", name="uq_analytics_cache_student_key"),
    )
    op.create_index("ix_analytics_cache_student_id", "analytics_cache", ["student_id"])
    op.create_index("ix_analytics_cache_computed_at", "analytics_cache", ["computed_at"])


def downgrade() -> None:
    op.drop_table("analytics_cache")
