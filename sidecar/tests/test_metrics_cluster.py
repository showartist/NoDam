"""Model-free tests: DER/JER, utterance accuracy, constrained clustering."""

import numpy as np

from audio_sidecar import service
from audio_sidecar.cluster import cluster_windows, constrained_ahc
from audio_sidecar.schemas import DerRequest

REF = [
    {"start_ms": 0, "end_ms": 4000, "speaker": "A"},
    {"start_ms": 4500, "end_ms": 8000, "speaker": "B"},
    {"start_ms": 8500, "end_ms": 10000, "speaker": "A"},
]


def _der(hyp, **kw):
    return service.der(DerRequest(reference=REF, hypothesis=hyp, **kw))


def test_der_perfect_and_label_permutation():
    hyp = [{**r, "speaker": {"A": 7, "B": "x"}[r["speaker"]]} for r in REF]
    out = _der(hyp)
    assert out["der"] == 0.0 and out["jer"] == 0.0
    # pyannote collar semantics: 250 ms = +/-125 ms around each of the 6 reference boundaries
    assert out["total_ms"] == 9000 - 6 * 125
    assert _der(hyp, collar_ms=0)["total_ms"] == 9000


def test_der_confusion_missed_false_alarm():
    hyp = [
        {"start_ms": 0, "end_ms": 4000, "speaker": "s1"},
        {"start_ms": 4500, "end_ms": 8000, "speaker": "s1"},  # B confused with A
        {"start_ms": 10000, "end_ms": 11000, "speaker": "s2"},  # false alarm, A's last turn missed
    ]
    out = _der(hyp, collar_ms=0)
    assert abs(out["confusion"] - 3500 / 9000) < 1e-3
    assert abs(out["missed_detection"] - 1500 / 9000) < 1e-3
    assert abs(out["false_alarm"] - 1000 / 9000) < 1e-3
    assert abs(out["der"] - 6000 / 9000) < 1e-3


def test_collar_forgives_boundary_jitter():
    hyp = [{**r, "start_ms": r["start_ms"] + 100, "end_ms": r["end_ms"] + 100} for r in REF]
    assert _der(hyp, collar_ms=0)["der"] > 0
    assert _der(hyp, collar_ms=250)["der"] == 0.0  # +/-125 ms around each boundary


def test_utterance_accuracy_hungarian():
    utts = [
        {"uid": "U1", "start_ms": 0, "end_ms": 4000, "speaker": "A"},
        {"uid": "U2", "start_ms": 4500, "end_ms": 8000, "speaker": "B"},
        {"uid": "U3", "start_ms": 8500, "end_ms": 10000, "speaker": "A"},
    ]
    hyp = [
        {"start_ms": 0, "end_ms": 4000, "speaker": "S2"},
        {"start_ms": 4500, "end_ms": 8000, "speaker": "S1"},
        {"start_ms": 8500, "end_ms": 10000, "speaker": "S1"},  # wrong: A's second turn labelled like B
    ]
    acc = service.der(DerRequest(reference=REF, hypothesis=hyp, utterances=utts))["utterance_speaker_accuracy"]
    assert acc["total"] == 3 and acc["correct"] == 2
    assert acc["mapping"] == {"S1": "B", "S2": "A"} or acc["mapping"] == {"S1": "A", "S2": "B"}
    assert [r["correct"] for r in acc["rows"]].count(True) == 2


def _unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def test_constrained_ahc_cannot_link_and_threshold():
    rng = np.random.default_rng(0)
    base = [_unit(rng.normal(size=16)) for _ in range(3)]
    noisy = lambda b: _unit(b + 0.05 * rng.normal(size=16))  # noqa: E731
    # chunk 0 has speakers 0,1,2; chunk 1 has 2,0; chunk 2 has 1
    E = np.stack([noisy(base[0]), noisy(base[1]), noisy(base[2]), noisy(base[2]), noisy(base[0]), noisy(base[1])])
    groups = [0, 0, 0, 1, 1, 2]
    labels = constrained_ahc(E, groups, threshold=0.3)
    assert labels[0] == labels[4] and labels[1] == labels[5] and labels[2] == labels[3]
    assert len(set(labels)) == 3
    # even with a threshold that would merge everything, one chunk's speakers stay apart
    loose = constrained_ahc(E, groups, threshold=5.0)
    assert len({loose[0], loose[1], loose[2]}) == 3
    # threshold 0 merges nothing
    assert len(set(constrained_ahc(E, groups, threshold=0.0))) == 6
    # forced count
    assert len(set(constrained_ahc(E, groups, threshold=0.0, num_clusters=3))) == 3


def test_cluster_windows_known_and_unknown_count():
    rng = np.random.default_rng(1)
    centers = [_unit(rng.normal(size=32)) for _ in range(3)]
    E = np.stack([_unit(centers[i % 3] + 0.1 * rng.normal(size=32)) for i in range(60)])
    labels, info = cluster_windows(E, num_speakers=3)
    assert info["k"] == 3
    for c in range(3):
        assert len(set(labels[c::3])) == 1
    labels2, info2 = cluster_windows(E, None, 1, 8, threshold=0.5)
    assert info2["k"] == 3
