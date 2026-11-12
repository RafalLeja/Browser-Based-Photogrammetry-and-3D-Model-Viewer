# Browser based photogrammetry tool and 3D model viewer

# Browser Based Photogrammetry Tool

A browser-based photogrammetry application
for 3D reconstruction and model visualization.

## Project Structure

- backend/ - REST API and backend logic
- frontend/ - user interface
- viewer/ - 3D model visualization
- pipeline/ - photogrammetry processing
- photogrammetry-lib/ - photogrammetry library
- docs/ - project documentation

## Technologies

- Python
- FastAPI
- PostgreSQL
- Redis
- Docker

## Contributing

Please read our [Contributing Guidelines](docs/CONTRIBUTING.md)
before submitting changes

## GUI

The GUI is located in `./gui` directory.

## Lib

The photogrammetry library is located in `./photogrammetry-lib` directory.

## Viewer

The 3D web viewer (Three.js, WebGPU with WebGL 2 fallback) is located in `./viewer` directory. See `viewer/README.md`.
