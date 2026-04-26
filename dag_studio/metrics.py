"""Standalone structure metrics used by the public DAGBoard package."""

from __future__ import annotations

from typing import Optional

import networkx as nx
import numpy as np
from sklearn.metrics import average_precision_score


def count_accuracy(B_true: np.ndarray, B_est: np.ndarray) -> dict[str, float]:
    B_true = (np.asarray(B_true) != 0).astype(int)
    B_est = (np.asarray(B_est) != 0).astype(int)
    np.fill_diagonal(B_true, 0)
    np.fill_diagonal(B_est, 0)
    d = B_true.shape[0]

    pred = np.flatnonzero(B_est)
    cond = np.flatnonzero(B_true)
    cond_reversed = np.flatnonzero(B_true.T)
    cond_skeleton = np.union1d(cond, cond_reversed)
    true_pos = np.intersect1d(pred, cond, assume_unique=False)
    false_pos = np.setdiff1d(pred, cond_skeleton, assume_unique=False)
    reverse = np.intersect1d(np.setdiff1d(pred, cond, assume_unique=False), cond_reversed, assume_unique=False)

    pred_size = len(pred)
    cond_neg_size = 0.5 * d * (d - 1) - len(cond)
    fdr = float(len(reverse) + len(false_pos)) / max(pred_size, 1)
    tpr = float(len(true_pos)) / max(len(cond), 1)
    fpr = float(len(reverse) + len(false_pos)) / max(cond_neg_size, 1)

    pred_lower = np.flatnonzero(np.tril(B_est + B_est.T))
    cond_lower = np.flatnonzero(np.tril(B_true + B_true.T))
    extra_lower = np.setdiff1d(pred_lower, cond_lower, assume_unique=False)
    missing_lower = np.setdiff1d(cond_lower, pred_lower, assume_unique=False)
    shd = len(extra_lower) + len(missing_lower) + len(reverse)

    precision = 1.0 - fdr
    recall = tpr
    f1 = 0.0 if precision + recall <= 0 else 2.0 * precision * recall / (precision + recall)
    return {
        "fdr": float(fdr),
        "tpr": float(tpr),
        "fpr": float(fpr),
        "shd": float(shd),
        "nnz": float(pred_size),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
    }


def dag_error(W: np.ndarray) -> float:
    B = (np.asarray(W) != 0).astype(int)
    np.fill_diagonal(B, 0)
    return 0.0 if nx.is_directed_acyclic_graph(nx.DiGraph(B)) else 1.0


def is_acyclic(W: np.ndarray) -> bool:
    return dag_error(W) == 0.0


def sid_score(B_true: np.ndarray, B_est: np.ndarray, double_for_dag: bool = True) -> float:
    B_true = (np.asarray(B_true) != 0).astype(int)
    B_est = (np.asarray(B_est) != 0).astype(int)
    G_true = nx.DiGraph(B_true)
    G_est = nx.DiGraph(B_est)
    n = B_true.shape[0]
    if not nx.is_directed_acyclic_graph(G_true) or not nx.is_directed_acyclic_graph(G_est):
        raise ValueError("SID requires acyclic true and estimated graphs.")
    total = 0
    all_nodes = set(range(n))
    ancestors = {node: nx.ancestors(G_est, node) for node in range(n)}
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            sid_ij = len(all_nodes - {i, j} - ancestors[i] - ancestors[j])
            total += sid_ij
            if double_for_dag:
                total += sid_ij
    return float(total)


class MetricsCalculator:
    def __init__(
        self,
        metrics: Optional[list[str]] = None,
        threshold: float = 0.0,
        graph_space: str = "dag",
    ) -> None:
        self.metrics = metrics or ["fdr", "tpr", "fpr", "shd", "nnz", "precision", "recall", "f1"]
        self.threshold = float(threshold)
        self.graph_space = graph_space

    def calculate(
        self,
        B_true: np.ndarray,
        W_est: np.ndarray,
        score_est: Optional[np.ndarray] = None,
        return_all: bool = False,
    ) -> dict[str, float]:
        B_est = (np.abs(np.asarray(W_est, dtype=float)) > self.threshold).astype(int)
        np.fill_diagonal(B_est, 0)
        results = count_accuracy(B_true, B_est)
        if score_est is not None or return_all or "aupr" in self.metrics:
            scores = np.asarray(score_est if score_est is not None else np.abs(W_est), dtype=float)
            mask = ~np.eye(scores.shape[0], dtype=bool)
            y_true = (np.asarray(B_true) != 0).astype(int)[mask].ravel()
            y_score = np.abs(scores)[mask].ravel()
            results["aupr"] = float(average_precision_score(y_true, y_score)) if y_true.size else 0.0
        results["dag_error"] = dag_error(W_est)
        results["is_acyclic"] = 1.0 if is_acyclic(W_est) else 0.0
        if return_all:
            return results
        return {key: value for key, value in results.items() if key in self.metrics}
