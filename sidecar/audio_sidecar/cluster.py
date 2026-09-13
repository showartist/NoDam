"""Clustering on cosine distance.

* constrained_ahc  - average-linkage agglomerative clustering with cannot-link groups
                     (used by /link-speakers: two local speakers of one chunk never merge).
* cluster_windows  - unconstrained AHC for /diarize sliding windows, followed by a few
                     spherical k-means passes to undo greedy AHC mistakes.
"""

from __future__ import annotations

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage


def cosine_matrix(E: np.ndarray) -> np.ndarray:
    E = E / np.maximum(np.linalg.norm(E, axis=1, keepdims=True), 1e-9)
    return np.clip(E @ E.T, -1.0, 1.0)


def constrained_ahc(
    E: np.ndarray,
    groups: list[int],
    threshold: float,
    num_clusters: int | None = None,
) -> list[int]:
    """Average-linkage AHC on cosine distance (1 - cos) with cannot-link groups.

    Items that share a `groups` value are never placed in one cluster. Merging stops
    when the closest mergeable pair is >= `threshold` apart, or, when `num_clusters`
    is given, as soon as that many clusters remain (threshold ignored).
    Returns a cluster index per item (0..k-1, first-item order).
    """
    n = len(E)
    if n == 0:
        return []
    D = 1.0 - cosine_matrix(E)
    g = np.asarray(groups)
    blocked = g[:, None] == g[None, :]
    size = np.ones(n)
    active = np.ones(n, dtype=bool)
    members: list[list[int]] = [[i] for i in range(n)]
    np.fill_diagonal(blocked, True)

    while active.sum() > 1:
        if num_clusters is not None and active.sum() <= num_clusters:
            break
        mask = blocked | ~active[:, None] | ~active[None, :]
        cand = np.where(mask, np.inf, D)
        flat = int(np.argmin(cand))
        a, b = divmod(flat, n)
        best = cand[a, b]
        if not np.isfinite(best):
            break  # every remaining pair is cannot-linked
        if num_clusters is None and best >= threshold:
            break
        # Lance-Williams update for average linkage
        na, nb = size[a], size[b]
        D[a, :] = (na * D[a, :] + nb * D[b, :]) / (na + nb)
        D[:, a] = D[a, :]
        D[a, a] = 0.0
        blocked[a, :] |= blocked[b, :]
        blocked[:, a] = blocked[a, :]
        blocked[a, a] = True
        size[a] = na + nb
        active[b] = False
        members[a].extend(members[b])
        members[b] = []

    clusters = sorted((m for i, m in enumerate(members) if active[i]), key=min)
    labels = [-1] * n
    for k, m in enumerate(clusters):
        for item in m:
            labels[item] = k
    return labels


def _refine(E: np.ndarray, labels: np.ndarray, iters: int = 10) -> np.ndarray:
    labels = labels.copy()
    k = labels.max() + 1
    for _ in range(iters):
        C = np.stack([E[labels == c].mean(0) if np.any(labels == c) else np.zeros(E.shape[1]) for c in range(k)])
        C /= np.maximum(np.linalg.norm(C, axis=1, keepdims=True), 1e-9)
        new = np.argmax(E @ C.T, axis=1)
        if np.array_equal(new, labels):
            break
        labels = new
    return labels


def _centroids(E: np.ndarray, labels: np.ndarray, ids) -> np.ndarray:
    C = np.stack([E[labels == c].mean(0) for c in ids])
    return C / np.maximum(np.linalg.norm(C, axis=1, keepdims=True), 1e-9)


def _split_two(X: np.ndarray, iters: int = 10) -> np.ndarray:
    """Spherical 2-means seeded with the two least similar members."""
    S = X @ X.T
    a, b = np.unravel_index(np.argmin(S), S.shape)
    C = X[[a, b]]
    lab = np.zeros(len(X), dtype=int)
    for _ in range(iters):
        lab = np.argmax(X @ C.T, axis=1)
        if lab.min() == lab.max():
            break
        C = _centroids(X, lab, (0, 1))
    return lab


def cluster_windows(
    E: np.ndarray,
    num_speakers: int | None = None,
    min_speakers: int = 1,
    max_speakers: int = 10,
    threshold: float = 0.6,
    min_cluster_frac: float = 0.02,
) -> tuple[np.ndarray, dict]:
    """Cluster L2-normalised window embeddings. Returns (labels, info).

    Plain AHC cut at k clusters fails on real data: a handful of outlier windows
    (speaker changes inside a window, breaths) stay as tiny clusters and two real
    speakers get merged instead. So:
      1. AHC (average linkage, cosine) cut at `threshold` -> pure but over-split clusters
      2. clusters smaller than max(3, min_cluster_frac * n) windows are outliers; every
         window is re-assigned to the nearest large-cluster centroid
      3. merge the closest centroids until the target count (num_speakers, or the
         number of large clusters clamped to [min_speakers, max_speakers]); split the
         most spread cluster with 2-means if there are too few
      4. a few spherical k-means passes.
    """
    n = len(E)
    if n == 0:
        return np.zeros(0, dtype=int), {"k": 0}
    if n == 1:
        return np.zeros(1, dtype=int), {"k": 1}
    Z = linkage(E, method="average", metric="cosine")
    _, labels = np.unique(fcluster(Z, threshold, criterion="distance"), return_inverse=True)
    sizes = np.bincount(labels)
    min_size = max(3, int(np.ceil(min_cluster_frac * n)))
    big = [c for c in range(len(sizes)) if sizes[c] >= min_size] or [int(np.argmax(sizes))]
    C = _centroids(E, labels, big)
    labels = np.argmax(E @ C.T, axis=1)
    found = len(big)

    if num_speakers:
        target = max(1, min(int(num_speakers), n))
    else:
        target = min(max(found, max(1, min_speakers)), max(1, min(max_speakers, n)))

    while True:
        ids = [c for c in range(labels.max() + 1) if np.any(labels == c)]
        _, labels = np.unique(labels, return_inverse=True)
        k = len(ids)
        if k > target:
            C = _centroids(E, labels, range(k))
            S = C @ C.T
            np.fill_diagonal(S, -np.inf)
            a, b = np.unravel_index(np.argmax(S), S.shape)
            labels[labels == b] = a
        elif k < target:
            C = _centroids(E, labels, range(k))
            spread = [np.sum(1.0 - E[labels == c] @ C[c]) for c in range(k)]
            c = int(np.argmax(spread))
            idx = np.where(labels == c)[0]
            if len(idx) < 2:
                break
            part = _split_two(E[idx])
            if part.min() == part.max():
                break
            labels[idx[part == 1]] = k
        else:
            break

    labels = _refine(E, labels)
    _, labels = np.unique(labels, return_inverse=True)
    how = "fixed" if num_speakers else "threshold"
    return labels, {"k": int(labels.max() + 1), "how": how, "large_clusters_found": found, "min_cluster_windows": min_size}
