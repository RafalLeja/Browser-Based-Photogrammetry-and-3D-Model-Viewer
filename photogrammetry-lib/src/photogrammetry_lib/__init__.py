"""Photogrammetry library for generating 3D models from photos."""

__all__ = [
    "PhotogrammetryProgress",
    "get_model_from_photos",
]


def __getattr__(name: str) -> object:
    # Imported on first use: the pipeline needs pycolmap (and CUDA), while `storage` and
    # `postprocess` must also work on machines without it, such as the API server.
    if name in __all__:
        from photogrammetry_lib import api

        return getattr(api, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
