# Technology Stack

## Backend
Python and FastAPI are used to implement
the backend and REST API.

## Database
PostgreSQL stores application data,
including users, uploads, reconstruction jobs,
models and annotations.

## Background Processing
Redis is used as a task queue backend.
RQ workers execute long-running photogrammetry jobs.

## Containerization
Docker Compose is used to manage
the application services.

## Justification
The proposed stack provides:
- easy integration with the existing Python code,
- asynchronous background processing,
- scalable architecture,
- separation of application components,
- simple local development environment.