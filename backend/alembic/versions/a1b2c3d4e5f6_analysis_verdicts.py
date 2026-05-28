"""analysis_verdicts table (Tab-4 Analysis Verdict Engine)

Revision ID: a1b2c3d4e5f6
Revises: d435f3eeb73d
Create Date: 2026-05-28 06:30:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "d435f3eeb73d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "analysis_verdicts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sqlmodel.sql.sqltypes.AutoString(length=128), nullable=False),
        sa.Column("test_type", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(length=16), nullable=False),
        sa.Column("clause_id", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column("clause_text", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("measured", sa.Float(), nullable=True),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("margin", sa.Float(), nullable=True),
        sa.Column("evidence_refs", sa.JSON(), nullable=True),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("analysis_verdicts", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_analysis_verdicts_run_id"), ["run_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("analysis_verdicts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_analysis_verdicts_run_id"))
    op.drop_table("analysis_verdicts")
