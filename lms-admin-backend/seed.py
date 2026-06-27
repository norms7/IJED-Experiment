"""
seed.py — Run once after migrations to bootstrap the database.

Usage:
    python seed.py

Creates:
  - Default admin account  (admin@lms.edu / Admin@1234)
  - Sample teacher account (teacher@lms.edu / Teacher@1234)
  - Sample student account (student@lms.edu / Student@1234)
  - One class, one section, one subject
"""
import asyncio
from app.db.session import AsyncSessionLocal, engine, Base
from app.models.models import Role, User, Class, Section, Subject
from app.core.security import hash_password


async def seed():
    async with AsyncSessionLocal() as db:
        # Roles (should already exist from migration, but idempotent insert)
        from sqlalchemy import select, text

        result = await db.execute(select(Role))
        if not result.scalars().first():
            db.add_all([
                Role(name="admin"),
                Role(name="teacher"),
                Role(name="student"),
            ])
            await db.flush()

        roles = {r.name: r for r in (await db.execute(select(Role))).scalars().all()}

        # Check admin not already seeded
        existing = await db.execute(select(User).where(User.email == "admin@lms.edu"))
        if not existing.scalar_one_or_none():
            admin = User(
                email="admin@lms.edu",
                hashed_password=hash_password("Admin@1234"),
                first_name="System",
                last_name="Admin",
                role_id=roles["admin"].id,
            )
            teacher_user = User(
                email="teacher@lms.edu",
                hashed_password=hash_password("Teacher@1234"),
                first_name="Juan",
                last_name="Dela Cruz",
                role_id=roles["teacher"].id,
            )
            student_user = User(
                email="student@lms.edu",
                hashed_password=hash_password("Student@1234"),
                first_name="Maria",
                last_name="Santos",
                role_id=roles["student"].id,
            )
            db.add_all([admin, teacher_user, student_user])
            await db.flush()
            print(f"✅  Created users: admin@lms.edu, teacher@lms.edu, student@lms.edu")

        # Sample class + section + subject
        existing_class = await db.execute(select(Class).where(Class.name == "Grade 10 - Rizal"))
        if not existing_class.scalar_one_or_none():
            cls = Class(name="Grade 10 - Rizal", grade_level="10", school_year="2024-2025")
            db.add(cls)
            await db.flush()

            section = Section(name="Section A", class_id=cls.id)
            db.add(section)

            subject = Subject(name="Mathematics", description="Core mathematics curriculum")
            db.add(subject)
            await db.flush()
            print(f"✅  Created class '{cls.name}', section '{section.name}', subject '{subject.name}'")

        await db.commit()
        print("🎉  Seed complete!")


if __name__ == "__main__":
    asyncio.run(seed())
