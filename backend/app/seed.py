"""Creates the curator account and the showcase objects. Safe to run on every start."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.models import Annotation, CollectionObject, Password, User

logger = logging.getLogger(__name__)

# Bundled in samples/. `up` is only needed for the raw COLMAP mesh, which is not +Y up.
SHOWCASE: tuple[dict, ...] = (
    {
        "title": "Eagle",
        "description": (
            "An outdoor eagle sculpture reconstructed from handheld photos with our COLMAP pipeline: "
            "features, sparse and dense reconstruction, then a Poisson surface carrying the photographed "
            "colours. Cropped to the sculpture, turned upright and compressed for the web: "
            "3.2 million raw triangles became 300 thousand, in a 2.2 MB file."
        ),
        "tags": ["sculpture", "photogrammetry", "outdoor"],
        "model": "models/eagle-web.glb",
        "thumbnail": "thumbnails/eagle.webp",
        "notes": [
            {
                "title": "Head",
                "text": "Notes like this record condition, history or a question for a colleague. Click one to fly the camera to it.",
                "position": [0.2568, 2.8205, 0.1814],
                "normal": [0.6682, 0.6676, 0.3285],
            },
            {
                "title": "Raised wing",
                "text": "Switch the light to Key only and turn the key light: the feather grooves stand out in relief.",
                "position": [0.698, 3.0241, -0.6014],
                "normal": [0.3412, -0.0985, 0.9348],
            },
            {
                "title": "Base",
                "text": "The crop keeps a disc of ground around the plinth, so the sculpture keeps its setting.",
                "position": [1.1215, 0.8689, 0.7654],
                "normal": [0.0675, 0.8015, 0.5941],
            },
        ],
    },
    {
        "title": "Eagle (raw reconstruction)",
        "description": (
            "The same eagle straight out of COLMAP, before clean-up: 3.2 million triangles, the floating "
            "fragments still attached, and the first camera's axes, so the viewer turns it upright."
        ),
        "tags": ["photogrammetry", "raw-scan"],
        "model": "models/eagle-dense.ply",
        "format": "ply",
        "up": [0.2014, -0.6971, -0.6881],
        "thumbnail": "thumbnails/eagle-raw.webp",
    },
    {
        "title": "Damaged Helmet",
        "description": (
            "Reference model for checking materials and lighting, from the Khronos glTF sample assets: "
            "© 2018 ctxwing (CC BY 4.0), based on a model © 2016 theblueturtle_ (CC BY-NC 4.0). Not a scan."
        ),
        "tags": ["reference", "pbr"],
        "model": "models/DamagedHelmet.glb",
        "thumbnail": "thumbnails/helmet.webp",
    },
)


def ensure_curator(db: Session, settings: Settings) -> None:
    if not settings.curator_login or not settings.curator_password:
        if db.scalar(select(User.id).limit(1)) is None:
            logger.warning("No curator account: set CURATOR_LOGIN and CURATOR_PASSWORD (see .env.example).")
        return
    user = db.scalar(select(User).where(User.login == settings.curator_login))
    if user is None:
        user = User(login=settings.curator_login, display_name="Curator", role="curator")
        db.add(user)
        db.flush()
        db.add(Password(user_id=user.id, password_hash=hash_password(settings.curator_password)))
        logger.info("Created curator account %r", settings.curator_login)
    db.commit()


def ensure_showcase(db: Session, settings: Settings) -> None:
    if db.scalar(select(CollectionObject.id).limit(1)) is not None:
        return  # Only an empty collection is seeded, so deleted samples stay deleted.
    for item in SHOWCASE:
        model = item["model"]
        path = settings.samples_dir / model
        if not path.is_file():
            logger.warning("Showcase file missing, skipped: %s", path)
            continue
        thumbnail = item.get("thumbnail")
        obj = CollectionObject(
            title=item["title"],
            description=item["description"],
            tags=item["tags"],
            status="ready",
            model_path=f"samples:{model}",
            model_format=item.get("format", "gltf"),
            up=item.get("up"),
            file_size=path.stat().st_size,
            thumbnail_path=f"samples:{thumbnail}" if thumbnail and (settings.samples_dir / thumbnail).is_file() else None,
        )
        db.add(obj)
        db.flush()
        for note in item.get("notes", []):
            db.add(Annotation(object_id=obj.id, **note))
    db.commit()


def seed(db: Session, settings: Settings) -> None:
    ensure_curator(db, settings)
    if settings.seed_samples:
        ensure_showcase(db, settings)
