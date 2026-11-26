# photogrammetry-lib

Turns a folder of photos into a web-ready 3D model.

1. **Reconstruction** (`photogrammetry.py`, `cli.py`): COLMAP through pycolmap: feature
   extraction, exhaustive matching, incremental mapping, undistortion, PatchMatch stereo,
   stereo fusion and Poisson meshing. Needs an NVIDIA GPU with CUDA. Progress and stage times
   are saved in `status.json`, so an interrupted run resumes.
2. **Post-processing** (`postprocess.py`): turns the raw Poisson mesh upright using the camera
   poses, stands it on the ground, crops it to the object around the point the cameras looked
   at, drops floating fragments, scales it to true size from a known height, reduces it to a
   triangle budget and writes a GLB with vertex colours and normals, plus a JSON manifest.

## Use

```bash
uv sync
uv run python cli.py --input photos/ --output raw.ply            # reconstruction (GPU)
uv run python -m photogrammetry_lib.postprocess raw.ply model.glb \
    --sparse ~/.bbpa3mv/storage/<hash>/sparse --height-mm 245 --json
```

Post-processing options: `--up X Y Z` (instead of `--sparse`), `--crop X Z RADIUS` (manual crop
in the upright frame), `--no-crop`, `--keep-fragments`, `--target-triangles N` (default 300 000).
The manifest reports triangles, vertices, dimensions in millimetres (when the height was given),
the crop used, the up vector and the file size.

The showcase eagle in `samples/models/eagle-web.glb` was made with:

```bash
uv run python -m photogrammetry_lib.postprocess ../samples/models/eagle-dense.ply eagle-crop.glb \
    --up 0.2014 -0.6971 -0.6881 --crop -1.7 0.67 2.3
node ../viewer/scripts/optimize-glb.mjs eagle-crop.glb ../samples/models/eagle-web.glb
```

`import photogrammetry_lib` does not load pycolmap; only the reconstruction step does, so the
post-processing and storage helpers also work on machines without CUDA.

## Test

```bash
uv run pytest
```
