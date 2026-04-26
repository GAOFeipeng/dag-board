"""Graph helpers for workflow execution and visualization."""

from __future__ import annotations

from typing import Iterable, List, Sequence

import numpy as np


def binary_adjacency(W: np.ndarray, threshold: float = 0.0) -> np.ndarray:
    B = (np.abs(np.asarray(W, dtype=float)) > threshold).astype(int)
    np.fill_diagonal(B, 0)
    return B


def edge_list_from_matrix(
    matrix: np.ndarray,
    node_labels: Sequence[str] | None = None,
    threshold: float = 0.0,
    top_k: int | None = None,
    directed: bool = True,
) -> list[dict]:
    arr = np.asarray(matrix, dtype=float)
    d = arr.shape[0]
    labels = list(node_labels or [f"X{i + 1}" for i in range(d)])
    edges: List[dict] = []
    for i in range(d):
        for j in range(d):
            if i == j:
                continue
            weight = float(arr[i, j])
            if abs(weight) <= threshold:
                continue
            edges.append(
                {
                    "source": labels[i],
                    "target": labels[j],
                    "source_index": i,
                    "target_index": j,
                    "weight": weight,
                    "directed": directed,
                }
            )
    edges.sort(key=lambda item: abs(item["weight"]), reverse=True)
    if top_k is not None and top_k > 0:
        return edges[:top_k]
    return edges


def overlay_edges(
    B_true: np.ndarray,
    W_pred: np.ndarray,
    node_labels: Sequence[str] | None = None,
    threshold: float = 0.0,
    top_k: int | None = None,
) -> list[dict]:
    true = binary_adjacency(B_true, 0.0)
    pred = binary_adjacency(W_pred, threshold)
    labels = list(node_labels or [f"X{i + 1}" for i in range(true.shape[0])])
    pairs = set(zip(*np.where(true != 0))) | set(zip(*np.where(pred != 0)))
    edges = []
    for i, j in pairs:
        status = "tp" if true[i, j] and pred[i, j] else "fn" if true[i, j] else "fp"
        edges.append(
            {
                "source": labels[i],
                "target": labels[j],
                "source_index": int(i),
                "target_index": int(j),
                "weight": float(W_pred[i, j]) if pred[i, j] else float(true[i, j]),
                "directed": True,
                "status": status,
            }
        )
    edges.sort(key=lambda item: (item["status"], -abs(item["weight"])))
    if top_k is not None and top_k > 0:
        return edges[:top_k]
    return edges


def graph_nodes(labels: Iterable[str]) -> list[dict]:
    return [{"id": label, "label": label, "index": idx} for idx, label in enumerate(labels)]

