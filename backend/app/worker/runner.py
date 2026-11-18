
import subprocess
import sys
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.connection import engine
from app.models import Job


BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

CLI_PATH = REPO_ROOT / "photogrammetry-lib" / "cli.py"
MODELS_DIRECTORY = BACKEND_ROOT / "storage" / "models"


def get_pending_job():
    with Session(engine) as db:
        statement = (
            select(Job)
            .where(Job.status == "pending")
            .order_by(Job.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )

        job = db.scalars(statement).first()

        if job is None:
            return None

        job.status = "processing"
        job.current_stage = "starting"
        db.commit()

        return {
            "id": job.id,
            "input_path": job.input_path,
        }


def update_job(job_id: int, status: str, stage: str):
    with Session(engine) as db:
        job = db.get(Job, job_id)

        if job is not None:
            job.status = status
            job.current_stage = stage
            db.commit()


def process_job(job: dict):
    job_id = job["id"]
    input_path = Path(job["input_path"])

    output_path = MODELS_DIRECTORY / f"job_{job_id}.ply"

    print(f"Processing job {job_id}")
    print(f"Input: {input_path}")
    print(f"Output: {output_path}")

    command = [
        sys.executable,
        str(CLI_PATH),
        "--input",
        str(input_path),
        "--output",
        str(output_path),
    ]

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if process.stdout is not None:
            for line in process.stdout:
                line = line.strip()

                if not line:
                    continue

                print(f"[Job {job_id}] {line}")

                if line.startswith("[") and "]" in line:
                    stage = line.split("]", 1)[1].strip()
                    update_job(job_id, "processing", stage[:100])

        return_code = process.wait()

        if return_code != 0:
            raise RuntimeError(
                f"Photogrammetry CLI exited with code {return_code}"
            )

        if not output_path.exists():
            raise RuntimeError("Photogrammetry did not generate the PLY file")

        update_job(job_id, "completed", "finished")
        print(f"Job {job_id} completed successfully")

    except Exception as error:
        update_job(job_id, "failed", str(error)[:100])
        print(f"Job {job_id} failed: {error}")


def run_worker():
    print("Worker started. Waiting for jobs...")

    while True:
        job = get_pending_job()

        if job is None:
            time.sleep(3)
            continue

        process_job(job)


if __name__ == "__main__":
    run_worker()
