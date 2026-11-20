import asyncio
import json
import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from photogrammetry_lib.photogrammetry import PhotogrammetryModel, PhotogrammetryStep
from photogrammetry_lib.storage import STORAGE_DIR

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def safe_filename(name: str) -> str:
    cleaned = "".join(
        c if c.isalnum() or c in ("-", "_") else "_" for c in name.strip()
    )
    return cleaned or "model"


def format_step_label(step_name: str) -> str:
    return step_name.replace("_", " ").capitalize()


@app.post("/api/pipeline/start")
async def start_pipeline(
    object_name: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()],
):
    temp_dir = Path(tempfile.mkdtemp(prefix="photogrammetry_upload_"))

    for upload_file in files:
        if not upload_file.filename:
            continue
        file_dest = temp_dir / Path(upload_file.filename).name
        with open(file_dest, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)

    async def event_stream():
        try:
            models_dir = STORAGE_DIR.parent / "exported_models"
            output_ply = models_dir / f"{safe_filename(object_name)}.ply"

            yield f"data: {json.dumps({'step': 'INIT', 'label': 'Initializing model', 'progress': 5})}\n\n"
            model = await asyncio.to_thread(PhotogrammetryModel, temp_dir, output_ply)

            yield f"data: {json.dumps({'step': PhotogrammetryStep.LOADING.name, 'label': format_step_label(PhotogrammetryStep.LOADING.name), 'progress': 10})}\n\n"

            all_steps = list(model.steps.items())
            total_steps = len(all_steps)

            for idx, (step, step_func) in enumerate(all_steps):
                if model.step.value >= step.value:
                    continue

                progress = 15 + int((idx / max(total_steps, 1)) * 75)
                payload = {
                    "step": step.name,
                    "label": format_step_label(step.name),
                    "progress": progress,
                }
                yield f"data: {json.dumps(payload)}\n\n"

                await asyncio.to_thread(step_func)

                model.step = step
                await asyncio.to_thread(model.save_status)

            yield f"data: {json.dumps({'step': 'EXPORTING', 'label': 'Exporting model', 'progress': 95})}\n\n"
            await asyncio.to_thread(model.export_model)
            yield f"data: {json.dumps({'step': PhotogrammetryStep.FINISHED.name, 'label': 'Done', 'progress': 100})}\n\n"

        except Exception as exc:
            error_payload = {
                "step": "ERROR",
                "label": "Failed",
                "progress": 0,
                "error": str(exc),
            }
            yield f"data: {json.dumps(error_payload)}\n\n"

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
