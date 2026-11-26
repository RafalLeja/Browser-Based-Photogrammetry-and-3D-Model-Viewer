"""Runs reconstruction jobs one at a time in a background thread.

The real pipeline runs the photogrammetry CLI in a child process, as before, so a crash in
COLMAP's native code cannot take the API down, and cancelling a job can stop it at once.
Without a CUDA GPU the demo pipeline walks through the same stages and publishes a sample
scan. Such objects are flagged `is_demo`, and the UI says so.
"""

import json
import logging
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import REPO_ROOT, Settings
from app.database.base import utcnow
from app.models import CollectionObject, Job
from app.worker.stages import STAGE_KEYS, progress_at

logger = logging.getLogger(__name__)

CLI_PATH = REPO_ROOT / "photogrammetry-lib" / "cli.py"
OPTIMIZE_SCRIPT = REPO_ROOT / "viewer" / "scripts" / "optimize-glb.mjs"
MAX_LOG_CHARS = 64_000
# A child process's output is saved, and cancellation checked, at most this often: COLMAP prints
# thousands of lines, and one database write per line would hold up the API's own writes.
FLUSH_SECONDS = 1.0
STOP_TIMEOUT_SECONDS = 15

# PhotogrammetryStep names in pipeline order, and the UI stage that follows each one. The CLI
# reports a step after finishing it, so the next step's stage is what runs now.
COLMAP_STEPS: tuple[tuple[str, str], ...] = (
    ("LOADING", "features"),
    ("FEATURE_EXTRACTION", "matching"),
    ("FEATURE_MATCHING", "sparse"),
    ("SPARSE_RECONSTRUCTION", "sparse"),
    ("EXPORT_SPARSE_MODEL", "dense"),
    ("UNDISTORTION", "dense"),
    ("PATCH_MATCHING", "dense"),
    ("STEREO_FUSION", "mesh"),
    ("POISSON_MESHING", "optimize"),
    ("EXPORT_DENSE_MODEL", "optimize"),
)


class JobCancelled(Exception):
    pass


def detect_colmap() -> tuple[bool, str]:
    """Asks a child process, so importing pycolmap (and CUDA) never happens in the API."""
    probe = "import pycolmap; print(pycolmap.get_num_cuda_devices())"
    try:
        result = subprocess.run(
            [sys.executable, "-c", probe], capture_output=True, text=True, timeout=120, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f"pycolmap could not be started ({error})"
    if result.returncode != 0:
        return False, "pycolmap is not installed or could not load"
    try:
        gpus = int(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return False, "pycolmap did not report its CUDA devices"
    if gpus < 1:
        return False, "pycolmap found no CUDA GPU"
    return True, f"COLMAP with {gpus} CUDA GPU(s)"


def resolve_mode(setting: str) -> tuple[str, str]:
    if setting == "demo":
        return "demo", "the demo pipeline was chosen (PIPELINE=demo)"
    available, reason = detect_colmap()
    if setting == "colmap" or available:
        return "colmap", reason
    return "demo", f"{reason}, so the demo pipeline runs instead"


class JobContext:
    def __init__(self, sessions: sessionmaker[Session], settings: Settings, job: Job) -> None:
        self.sessions = sessions
        self.settings = settings
        self.job_id = job.id
        self.object_id = job.object_id
        self.input_dir = Path(job.input_path)
        self.photo_count = job.photo_count
        self.options = dict(job.options or {})
        self._stage: str | None = None
        self._stage_started = 0.0
        self._times: dict[str, float] = {}

    def stage(self, key: str) -> None:
        if key == self._stage:
            return
        self._close_stage()
        self._stage, self._stage_started = key, time.perf_counter()
        self._update(current_stage=key, progress=progress_at(key), stage_times=dict(self._times))

    def finish(self) -> None:
        self._close_stage()
        self._update(stage_times=dict(self._times))

    def log(self, line: str) -> None:
        logger.info("[job %s] %s", self.job_id, line)
        with self.sessions() as db:
            job = db.get(Job, self.job_id)
            if job is None:
                return
            job.log = (job.log + line + "\n")[-MAX_LOG_CHARS:]
            db.commit()

    def cancelled(self) -> bool:
        with self.sessions() as db:
            job = db.get(Job, self.job_id)
            return job is None or job.cancel_requested

    def check_cancel(self) -> None:
        if self.cancelled():
            raise JobCancelled

    def sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while (left := end - time.monotonic()) > 0:
            self.check_cancel()
            time.sleep(min(left, 0.25))

    def remember(self, **values: object) -> None:
        """Adds values to the job's options, for example where its working files are."""
        self.options.update(values)
        self._update(options=dict(self.options))

    def publish(self, model_path: str, *, is_demo: bool, manifest: dict | None = None) -> None:
        manifest = manifest or {}
        with self.sessions() as db:
            obj = db.get(CollectionObject, self.object_id)
            if obj is None:
                raise JobCancelled  # The object was deleted while its job ran.
            obj.model_path = model_path
            obj.model_format = "gltf"
            obj.is_demo = is_demo
            obj.status = "ready"
            obj.up = None
            obj.triangles = manifest.get("triangles")
            obj.file_size = manifest.get("file_size")
            obj.dimensions_mm = manifest.get("dimensions_mm")
            db.commit()

    def _close_stage(self) -> None:
        if self._stage is not None:
            self._times[self._stage] = round(time.perf_counter() - self._stage_started, 3)

    def _update(self, **values: object) -> None:
        with self.sessions() as db:
            db.execute(update(Job).where(Job.id == self.job_id).values(**values))
            db.commit()


def run_demo(ctx: JobContext, reason: str) -> None:
    sample = ctx.settings.samples_dir / ctx.settings.demo_model
    if not sample.is_file():
        raise RuntimeError(f"The demo sample model is missing: {sample}")
    ctx.log(
        f"Demo pipeline: {reason}. Your {ctx.photo_count} photos are stored, but the published "
        f"model is the sample scan “{sample.name}”, not a reconstruction of them."
    )
    for key in STAGE_KEYS[:-1]:
        ctx.stage(key)
        ctx.log(f"[demo] {key}")
        ctx.sleep(ctx.settings.demo_stage_seconds)
    ctx.stage("publish")
    ctx.publish(f"samples:{ctx.settings.demo_model}", is_demo=True, manifest={"file_size": sample.stat().st_size})


def stop_process(process: subprocess.Popen) -> None:
    """Asks the process to stop, and kills it if it does not within the timeout."""
    process.terminate()
    try:
        process.wait(timeout=STOP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def run_process(ctx: JobContext, command: list[str], on_line=None) -> list[str]:  # noqa: ANN001
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    lines: queue.Queue[str | None] = queue.Queue()

    def pump() -> None:
        assert process.stdout is not None
        for raw in process.stdout:
            lines.put(raw)
        lines.put(None)

    threading.Thread(target=pump, daemon=True).start()
    output: list[str] = []
    batch: list[str] = []
    next_flush = time.monotonic() + FLUSH_SECONDS
    finished = False
    while not finished:
        try:
            raw = lines.get(timeout=max(0.0, next_flush - time.monotonic()))
        except queue.Empty:
            raw = ""  # Quiet for a moment: time to save and check.
        if raw is None:
            finished = True
        elif line := raw.rstrip():
            batch.append(line)
            output.append(line)
            if on_line:
                on_line(line)
        if finished or time.monotonic() >= next_flush:
            if batch:
                ctx.log("\n".join(batch))
                batch.clear()
            next_flush = time.monotonic() + FLUSH_SECONDS
            # Checked on a clock, not only when the output pauses, so a chatty run stops promptly too.
            if not finished and ctx.cancelled():
                stop_process(process)
                raise JobCancelled
    code = process.wait()
    if code != 0:
        last = output[-1] if output else "no output"
        program = command[2] if command[1] == "-m" else Path(command[1]).name
        raise RuntimeError(f"{program} exited with code {code}: {last}")
    return output


def run_colmap(ctx: JobContext) -> None:
    from photogrammetry_lib.storage import get_output_directory  # hashing only, no pycolmap

    out_dir = ctx.settings.storage_dir / "models" / str(ctx.object_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_ply, glb = out_dir / "raw.ply", out_dir / "model.glb"
    next_stage = dict(COLMAP_STEPS)

    def on_cli_line(line: str) -> None:
        # "[in_progress] step 3/12: Feature Extraction"
        if ": " not in line or not line.startswith("[in_progress]"):
            return
        name = line.rsplit(": ", 1)[1].strip().upper().replace(" ", "_")
        if name in next_stage:
            ctx.stage(next_stage[name])

    ctx.stage("upload")
    # COLMAP's workspace (depth maps, undistorted photos: gigabytes) is recorded, so deleting the
    # object can remove it, and removed after a successful run. A failed run keeps it to resume.
    workspace = get_output_directory(ctx.input_dir)
    ctx.remember(workspace=str(workspace))
    command = [sys.executable, str(CLI_PATH), "--input", str(ctx.input_dir), "--output", str(raw_ply)]
    output = run_process(ctx, command, on_cli_line)
    if any(line.startswith("[error]") for line in output) or not raw_ply.is_file():
        raise RuntimeError(next((l for l in reversed(output) if l.startswith("[error]")), "No mesh was produced"))

    ctx.stage("optimize")
    post = [sys.executable, "-m", "photogrammetry_lib.postprocess", str(raw_ply), str(glb), "--json"]
    sparse = workspace / "sparse"
    if sparse.is_dir():
        post += ["--sparse", str(sparse)]
    if height := ctx.options.get("real_height_mm"):
        post += ["--height-mm", str(height)]
    manifest = json.loads(run_process(ctx, post)[-1])

    node = shutil.which("node")
    if node and OPTIMIZE_SCRIPT.is_file() and (REPO_ROOT / "viewer" / "node_modules").is_dir():
        run_process(ctx, [node, str(OPTIMIZE_SCRIPT), str(glb), str(glb)])
        manifest["file_size"] = glb.stat().st_size
    else:
        ctx.log("Skipped meshopt compression: Node.js or the viewer's node_modules are missing.")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    raw_ply.unlink(missing_ok=True)

    ctx.stage("publish")
    ctx.publish(f"models/{ctx.object_id}/model.glb", is_demo=False, manifest=manifest)
    # shortcut: two uploads of the very same photos share one workspace (it is keyed by content);
    # removing it here makes the other one start over. Key workspaces by job if that ever matters.
    shutil.rmtree(workspace, ignore_errors=True)


class Worker:
    def __init__(self, sessions: sessionmaker[Session], settings: Settings) -> None:
        self.sessions = sessions
        self.settings = settings
        self.mode: str | None = None
        self.reason = "checking for a CUDA GPU"
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="reconstruction-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=10)

    def notify(self) -> None:
        self._wake.set()

    def run_once(self) -> bool:
        """Runs the oldest queued job, if any. Returns whether one ran."""
        if self.mode is None:
            self.mode, self.reason = resolve_mode(self.settings.pipeline)
            logger.info("Reconstruction pipeline: %s (%s)", self.mode, self.reason)
        job = self._claim()
        if job is None:
            return False
        ctx = JobContext(self.sessions, self.settings, job)
        try:
            if self.mode == "demo":
                run_demo(ctx, self.reason)
            else:
                run_colmap(ctx)
            ctx.finish()
            self._end(job.id, "done")
        except JobCancelled:
            ctx.finish()
            self._end(job.id, "cancelled")
        except Exception as error:  # noqa: BLE001 - any failure must end up on the job, not kill the worker
            logger.exception("Job %s failed", job.id)
            ctx.finish()
            self._end(job.id, "failed", str(error)[:2000])
        return True

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                ran = self.run_once()
            except Exception:  # noqa: BLE001 - e.g. the database is briefly unavailable
                logger.exception("Worker loop error")
                ran = False
            if not ran:
                self._wake.wait(timeout=2)
                self._wake.clear()

    def _claim(self) -> Job | None:
        with self.sessions() as db:
            job_id = db.scalar(select(Job.id).where(Job.status == "queued").order_by(Job.id).limit(1))
            if job_id is None:
                return None
            claimed = db.execute(
                update(Job)
                .where(Job.id == job_id, Job.status == "queued")
                .values(
                    status="running",
                    pipeline=self.mode,
                    started_at=utcnow(),
                    finished_at=None,
                    attempts=Job.attempts + 1,
                    error=None,
                    current_stage=None,
                    progress=0,
                    stage_times={},
                )
            )
            db.commit()
            if claimed.rowcount != 1:  # Another worker took it first.
                return None
            return db.get(Job, job_id)

    def _end(self, job_id: int, status: str, error: str | None = None) -> None:
        with self.sessions() as db:
            job = db.get(Job, job_id)
            if job is None:
                return
            job.status = status
            job.error = error
            job.finished_at = utcnow()
            if status == "done":
                job.progress = 100
            obj = db.get(CollectionObject, job.object_id)
            if obj is not None and status != "done" and obj.model_path is None:
                obj.status = "failed"
            db.commit()


def recover_interrupted(sessions: sessionmaker[Session]) -> int:
    """Jobs left 'running' by a stopped server can never finish; mark them failed so they can be retried."""
    with sessions() as db:
        jobs = db.scalars(select(Job).where(Job.status == "running")).all()
        for job in jobs:
            job.status = "failed"
            job.error = "The server stopped while this job was running. Retry to run it again."
            job.finished_at = utcnow()
            obj = db.get(CollectionObject, job.object_id)
            if obj is not None and obj.model_path is None:
                obj.status = "failed"
        db.commit()
        return len(jobs)
