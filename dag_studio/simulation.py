"""Public synthetic DAG and SEM helpers for the standalone DAGBoard app."""

from __future__ import annotations

from collections import deque
from typing import Iterable

import networkx as nx
import numpy as np


def set_random_seed(seed: int) -> None:
    np.random.seed(int(seed))


def is_dag(W: np.ndarray) -> bool:
    B = (np.asarray(W) != 0).astype(int)
    np.fill_diagonal(B, 0)
    return nx.is_directed_acyclic_graph(nx.DiGraph(B))


def simulate_dag(d: int, s0: int, graph_type: str = "ER", seed: int | None = None) -> np.ndarray:
    rng = np.random.default_rng(seed)
    graph_type = graph_type.upper()
    order = rng.permutation(d)
    B = np.zeros((d, d), dtype=int)

    if graph_type == "FULLY":
        candidates = [(order[i], order[j]) for i in range(d) for j in range(i + 1, d)]
    elif graph_type == "BP":
        split = max(1, d // 2)
        left = order[:split]
        right = order[split:]
        candidates = [(int(i), int(j)) for i in left for j in right if i != j]
    elif graph_type == "SF":
        candidates = _scale_free_candidates(d, order, rng)
    else:
        candidates = [(order[i], order[j]) for i in range(d) for j in range(i + 1, d)]

    if not candidates:
        return B
    rng.shuffle(candidates)
    for source, target in candidates[: min(int(s0), len(candidates))]:
        B[int(source), int(target)] = 1
    return B


def simulate_parameter(
    B: np.ndarray,
    weight_ranges: Iterable[Iterable[float]] = ((-2.0, -0.5), (0.5, 2.0)),
    seed: int | None = None,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    ranges = [(float(low), float(high)) for low, high in weight_ranges]
    if not ranges:
        ranges = [(-2.0, -0.5), (0.5, 2.0)]
    W = np.zeros_like(np.asarray(B, dtype=float))
    for i, j in zip(*np.where(np.asarray(B) != 0)):
        low, high = ranges[int(rng.integers(0, len(ranges)))]
        W[i, j] = rng.uniform(low, high)
    np.fill_diagonal(W, 0.0)
    return W


def simulate_sem(
    W: np.ndarray,
    n_samples: int,
    sem_type: str = "gauss",
    sem_noise: float = 1.0,
    seed: int | None = None,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    W = np.asarray(W, dtype=float)
    d = W.shape[0]
    X = np.zeros((int(n_samples), d), dtype=float)
    for j in _topological_order(W):
        parents = np.flatnonzero(W[:, j] != 0)
        signal = X[:, parents] @ W[parents, j] if parents.size else 0.0
        X[:, j] = _transform_signal(signal, sem_type, rng) + _noise(rng, int(n_samples), sem_type, float(sem_noise))
    return X


def _scale_free_candidates(d: int, order: np.ndarray, rng: np.random.Generator) -> list[tuple[int, int]]:
    candidates: list[tuple[int, int]] = []
    weights = np.ones(d, dtype=float)
    for child_pos in range(1, d):
        child = int(order[child_pos])
        parent_positions = np.arange(child_pos)
        probabilities = weights[parent_positions] / weights[parent_positions].sum()
        count = int(max(1, min(child_pos, rng.poisson(2))))
        parents = rng.choice(parent_positions, size=count, replace=False, p=probabilities)
        for parent_pos in parents:
            parent = int(order[int(parent_pos)])
            candidates.append((parent, child))
            weights[int(parent_pos)] += 1.0
    return candidates


def _topological_order(W: np.ndarray) -> list[int]:
    B = (np.asarray(W) != 0).astype(int)
    indegree = B.sum(axis=0).astype(int)
    queue = deque(int(i) for i in np.flatnonzero(indegree == 0))
    order: list[int] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for child in np.flatnonzero(B[node] != 0):
            indegree[int(child)] -= 1
            if indegree[int(child)] == 0:
                queue.append(int(child))
    if len(order) != W.shape[0]:
        raise ValueError("SEM simulation requires a DAG.")
    return order


def _transform_signal(signal: np.ndarray | float, sem_type: str, rng: np.random.Generator) -> np.ndarray | float:
    if sem_type == "mlp":
        return np.tanh(signal) + 0.25 * np.sin(signal)
    if sem_type == "mim":
        return np.tanh(signal) + np.cos(signal)
    if sem_type == "logistic":
        return 1.0 / (1.0 + np.exp(-np.asarray(signal)))
    if sem_type == "poisson":
        return np.log1p(np.exp(np.asarray(signal)))
    return signal


def _noise(rng: np.random.Generator, n_samples: int, sem_type: str, sem_noise: float) -> np.ndarray:
    scale = max(sem_noise, 1e-8)
    if sem_type == "exp":
        return rng.exponential(scale, size=n_samples) - scale
    if sem_type == "gumbel":
        return rng.gumbel(0.0, scale, size=n_samples)
    if sem_type == "uniform":
        return rng.uniform(-scale, scale, size=n_samples)
    if sem_type == "poisson":
        return rng.normal(0.0, scale, size=n_samples)
    return rng.normal(0.0, scale, size=n_samples)
