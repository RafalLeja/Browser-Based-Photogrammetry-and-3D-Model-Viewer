
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import Annotated

from app.database.session import get_db
from app.models import Job

router = APIRouter(
    prefix="/uploads",
    tags=["uploads"]
)

# Katalog przechowujący przesłane zdjęcia
BACKEND_ROOT = Path(__file__).resolve().parents[3]
UPLOADS_DIRECTORY = BACKEND_ROOT / "storage" / "uploads"


@router.post("/")
async def upload_photos(
    files: Annotated[list[UploadFile], File()],
    db: Session = Depends(get_db)
):
    # Tworzymy unikalny katalog dla danego uploadu
    upload_id = str(uuid4())
    upload_directory = UPLOADS_DIRECTORY / upload_id
    upload_directory.mkdir(parents=True, exist_ok=True)

    saved_files = []

    for file in files:
        if not file.filename:
            raise HTTPException(
                status_code=400,
                detail="File must have a name"
            )

        extension = Path(file.filename).suffix.lower()

        if extension not in [".jpg", ".jpeg", ".png"]:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {file.filename}"
            )

        file_path = upload_directory / f"{uuid4()}{extension}"

        content = await file.read()
        if not content:
            raise HTTPException(
                status_code=400,
                detail=f"Empty file: {file.filename}"
            )

        file_path.write_bytes(content)
        saved_files.append(file_path.name)

        await file.close()

    # Tworzymy zadanie w bazie danych
    job = Job(
        status="pending",
        current_stage="uploaded",
        input_path=str(upload_directory)
    )

    db.add(job)
    db.commit()
    db.refresh(job)

    return {
        "message": "Files uploaded successfully",
        "upload_id": upload_id,
        "job_id": job.id,
        "status": job.status,
        "files_count": len(saved_files),
        "filenames": saved_files
    }
