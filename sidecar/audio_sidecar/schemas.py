"""Request bodies (shared by the HTTP server and the CLI). Times are integer ms."""

from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel, Field

SpeakerLabel = Optional[Union[int, str]]


class SegmentIn(BaseModel):
    start_ms: int
    end_ms: int


class EmbedRequest(BaseModel):
    audio_path: str
    segments: list[SegmentIn]


class WordIn(BaseModel):
    start_ms: int
    end_ms: int
    speaker: SpeakerLabel = None


class ChunkIn(BaseModel):
    audio_path: str
    offset_ms: int = 0
    words: list[WordIn]


class LinkRequest(BaseModel):
    chunks: list[ChunkIn]
    # cosine DISTANCE threshold for average-linkage merging (default from config)
    threshold: Optional[float] = None
    # optional: force this many global speakers (threshold then ignored)
    num_speakers: Optional[int] = Field(default=None, ge=1)


class DiarizeRequest(BaseModel):
    audio_path: str
    num_speakers: Optional[int] = Field(default=None, ge=1)
    min_speakers: int = Field(default=1, ge=1)
    max_speakers: int = Field(default=10, ge=1)
    threshold: Optional[float] = None


class LabeledSegment(BaseModel):
    start_ms: int
    end_ms: int
    speaker: SpeakerLabel = None


class Utterance(BaseModel):
    uid: str
    start_ms: int
    end_ms: int
    speaker: SpeakerLabel = None


class DerRequest(BaseModel):
    reference: list[LabeledSegment]
    hypothesis: list[LabeledSegment]
    collar_ms: int = 250
    skip_overlap: bool = False
    utterances: Optional[list[Utterance]] = None


class ImageSimRequest(BaseModel):
    image_path: str
    reference_paths: list[str]
