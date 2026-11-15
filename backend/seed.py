from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.connection import engine
from app.core.security import hash_password

from app.models import (
    User,
    Password,
    Object,
    Upload,
    Job,
    Model,
    Annotation,
    SavedView,
)


def seed_database():
    with Session(engine) as session:

        # Check if demo user already exists
        existing_user = session.scalar(
            select(User).where(User.login == "demo_user")
        )

        if existing_user:
            print("Seed data already exists.")
            return

        now = datetime.now(timezone.utc)

        # 1. Create user
        user = User(
            login="demo_user"
        )

        session.add(user)
        session.flush()

        # 2. Create hashed password
        password = Password(
            user_id=user.id,
            password_hash=hash_password("DemoPassword123!")
        )

        # 3. Create object
        obj = Object(
            title="Eagle 3D Model",
            description="Sample 3D object for testing.",
            created_by=user.id,
            is_published=True
        )

        session.add_all([password, obj])
        session.flush()

        # 4. Create upload
        upload = Upload(
            object_id=obj.id,
            uploaded_by=user.id,
            filename="sample_images.zip",
            file_path="uploads/sample_images.zip",
            file_size=1024000,
            content_type="application/zip"
        )

        # 5. Create reconstruction job
        job = Job(
            object_id=obj.id,
            created_by=user.id,
            status="completed",
            progress=100,
            started_at=now,
            completed_at=now
        )

        session.add_all([upload, job])
        session.flush()

        # 6. Create generated 3D model
        model = Model(
            object_id=obj.id,
            job_id=job.id,
            file_path="images/eagle/output/mvs/scene_textured.glb",
            lod=0,
            file_size=1048576,
            triangles=50000
        )

        # 7. Create annotation
        annotation = Annotation(
            object_id=obj.id,
            created_by=user.id,
            content="Example annotation on the 3D model.",
            position_x=1.5,
            position_y=2.0,
            position_z=0.5
        )

        # 8. Create saved view
        saved_view = SavedView(
            object_id=obj.id,
            user_id=user.id,
            name="Front view",
            camera_position={
                "x": 10.0,
                "y": 5.0,
                "z": 12.0
            },
            camera_target={
                "x": 0.0,
                "y": 0.0,
                "z": 0.0
            }
        )

        session.add_all([
            model,
            annotation,
            saved_view
        ])

        session.commit()

        print("Seed data successfully inserted!")


if __name__ == "__main__":
    seed_database()