"""FastAPI app. Run:  cd sidecar && uv run uvicorn audio_sidecar.server:app --port 8790

Endpoints are plain `def` (FastAPI runs them in a worker thread); the heavy part of
each is serialised by models.MODEL_LOCK, so concurrent requests queue instead of
running two inferences at once.
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import __version__, service
from .audio import AudioError
from .schemas import DerRequest, DiarizeRequest, EmbedRequest, ImageSimRequest, LinkRequest

log = logging.getLogger("audio_sidecar")

app = FastAPI(title="SceneNote audio sidecar", version=__version__)


@app.exception_handler(AudioError)
async def _audio_error(_req: Request, exc: AudioError):
    return JSONResponse(status_code=400, content={"error": "bad_input", "message": str(exc)})


@app.exception_handler(ValueError)
async def _value_error(_req: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"error": "bad_input", "message": str(exc)})


@app.middleware("http")
async def _timing(request: Request, call_next):
    t = time.perf_counter()
    response = await call_next(request)
    response.headers["x-elapsed-ms"] = str(int((time.perf_counter() - t) * 1000))
    return response


@app.get("/health")
def health():
    return service.health()


@app.post("/embed")
def embed(req: EmbedRequest):
    return service.embed(req)


@app.post("/link-speakers")
def link_speakers(req: LinkRequest):
    return service.link_speakers(req)


@app.post("/diarize")
def diarize(req: DiarizeRequest):
    return service.diarize(req)


@app.post("/der")
def der(req: DerRequest):
    return service.der(req)


@app.post("/image-sim")
def image_sim(req: ImageSimRequest):
    return service.image_sim(req)
