"""Node catalog for DAGBoard."""

from __future__ import annotations

from dag_studio.schemas import NodeField, NodePort, NodePreviewDefinition, NodeTypeDefinition


NODE_TYPES = [
    NodeTypeDefinition(
        id="structure_generator",
        label="Structure Generator",
        description="Generate a weighted causal DAG.",
        inputs=[],
        outputs=["graph"],
        output_ports=[NodePort(id="graph", label="Graph", kind="graph", required=False)],
        preview=NodePreviewDefinition(enabled_by_default=True, supported_outputs=["graph"]),
        inline_fields=["d", "s0", "graph_type", "seed"],
        fields=[
            NodeField(name="d", label="Variables", kind="integer", default=8),
            NodeField(name="s0", label="Edges", kind="integer", default=12),
            NodeField(name="graph_type", label="Graph Type", kind="select", default="ER", options=["ER", "SF", "BP", "Fully"]),
            NodeField(name="seed", label="Seed", kind="integer", default=42),
            NodeField(
                name="weight_ranges",
                label="Weight Ranges",
                kind="json",
                default=[[-2.0, -0.5], [0.5, 2.0]],
            ),
        ],
    ),
    NodeTypeDefinition(
        id="data_generator",
        label="Data Generator",
        description="Generate n by d samples from an input causal graph.",
        inputs=["graph"],
        outputs=["data"],
        input_ports=[NodePort(id="graph", label="Graph", kind="graph", required=True)],
        output_ports=[
            NodePort(id="data", label="Data", kind="data", required=False),
            NodePort(id="graph", label="Graph", kind="graph_like", required=False),
        ],
        preview=NodePreviewDefinition(enabled_by_default=True, supported_outputs=["data"]),
        inline_fields=["n_samples", "sem_type", "seed"],
        fields=[
            NodeField(name="n_samples", label="Samples", kind="integer", default=120),
            NodeField(
                name="sem_type",
                label="SEM",
                kind="select",
                default="gauss",
                options=["gauss", "exp", "gumbel", "uniform", "logistic", "poisson", "mlp", "mim"],
            ),
            NodeField(name="sem_noise", label="Noise", kind="number", default=1.0),
            NodeField(name="seed", label="Seed", kind="integer", default=42),
            NodeField(name="standardize", label="Standardize", kind="boolean", default=True),
        ],
    ),
    NodeTypeDefinition(
        id="algorithm",
        label="Algorithm",
        description="Run an official library-backed causal discovery algorithm.",
        inputs=["data"],
        outputs=["algorithm_result"],
        input_ports=[NodePort(id="data", label="Data", kind="data", required=True)],
        output_ports=[NodePort(id="graph", label="Graph", kind="graph_like", required=False)],
        preview=NodePreviewDefinition(enabled_by_default=False, supported_outputs=["algorithm_result"]),
        inline_fields=["algorithm_id", "w_threshold"],
        fields=[
            NodeField(name="algorithm_id", label="Algorithm", kind="select", default="PC"),
            NodeField(name="alpha", label="PC Alpha", kind="number", default=None, placeholder="0.05"),
            NodeField(name="variant", label="PC Variant", kind="select", default=None, options=["original", "stable", "parallel"], placeholder="original"),
            NodeField(name="criterion", label="GES Criterion", kind="select", default=None, options=["bic", "bdeu"], placeholder="bic"),
            NodeField(name="lambda1", label="lambda1", kind="number", default=None, placeholder="0.03"),
            NodeField(name="lambda2", label="lambda2", kind="number", default=None, placeholder="0.01"),
            NodeField(name="max_iter", label="Max Iter", kind="integer", default=None, placeholder="official default"),
            NodeField(name="warm_iter", label="Warm Iter", kind="integer", default=None, placeholder="30000"),
            NodeField(name="T", label="T", kind="integer", default=None, placeholder="5"),
            NodeField(name="rank", label="Low Rank", kind="integer", default=None, placeholder="2"),
            NodeField(name="w_threshold", label="Threshold", kind="number", default=None, placeholder="0.3"),
            NodeField(name="seed", label="Seed", kind="integer", default=None, placeholder="empty"),
            NodeField(name="library_params", label="Library Params", kind="json", default=None, placeholder='{"official_param": "value"}'),
        ],
    ),
    NodeTypeDefinition(
        id="graph_view",
        label="Graph View",
        description="Prepare graph JSON for frontend visualization.",
        inputs=["graph", "data", "algorithm_result", "evaluation"],
        outputs=["graph_view"],
        input_ports=[
            NodePort(id="graph", label="Graph", kind="graph_like", required=True),
            NodePort(id="data", label="Data", kind="data", required=False, min_count=0),
            NodePort(id="evaluation", label="Evaluation", kind="evaluation", required=False, min_count=0),
        ],
        output_ports=[NodePort(id="graph_view", label="Graph View", kind="graph_view", required=False)],
        preview=NodePreviewDefinition(enabled_by_default=True, supported_outputs=["graph_view"]),
        inline_fields=["compare_mode", "threshold", "top_k"],
        fields=[
            NodeField(name="compare_mode", label="Mode", kind="select", default="single", options=["single", "true_vs_pred", "overlay"]),
            NodeField(name="threshold", label="Threshold", kind="number", default=0.3),
            NodeField(name="top_k", label="Top-K Edges", kind="integer", default=200),
        ],
    ),
    NodeTypeDefinition(
        id="evaluation",
        label="Structure Evaluation",
        description="Compare two causal graphs, or score one causal graph with data using BIC.",
        inputs=["graph", "data", "algorithm_result"],
        outputs=["evaluation"],
        input_ports=[
            NodePort(id="graph", label="Graph", kind="graph_like", required=True, min_count=2, max_count=2),
            NodePort(id="data", label="Data", kind="data", required=False, min_count=0),
        ],
        output_ports=[NodePort(id="evaluation", label="Evaluation", kind="evaluation", required=False)],
        preview=NodePreviewDefinition(enabled_by_default=True, supported_outputs=["evaluation"]),
        inline_fields=["mode", "threshold", "graph_space"],
        fields=[
            NodeField(name="mode", label="Mode", kind="select", default="compare", options=["compare", "bic"]),
            NodeField(
                name="metrics",
                label="Metrics",
                kind="json",
                default=["shd", "f1", "tpr", "fdr", "fpr", "precision", "recall", "nnz", "aupr", "dag_error", "is_acyclic", "sid"],
            ),
            NodeField(name="threshold", label="Threshold", kind="number", default=0.3),
            NodeField(name="graph_space", label="Graph Space", kind="select", default="dag", options=["dag", "cpdag"]),
        ],
    ),
    NodeTypeDefinition(
        id="evaluation_summary",
        label="Evaluation Summary",
        description="Aggregate multiple structure evaluation outputs into one comparison table.",
        inputs=["evaluation"],
        outputs=["evaluation_summary"],
        input_ports=[
            NodePort(id="evaluation", label="Evaluations", kind="evaluation", required=True, min_count=1, max_count=None),
        ],
        output_ports=[NodePort(id="evaluation_summary", label="Summary", kind="evaluation_summary", required=False)],
        preview=NodePreviewDefinition(enabled_by_default=True, supported_outputs=["evaluation_summary"]),
        inline_fields=["primary_metric", "sort_order"],
        fields=[
            NodeField(
                name="primary_metric",
                label="Primary Metric",
                kind="select",
                default="f1",
                options=["f1", "shd", "precision", "recall", "tpr", "fdr", "fpr", "aupr", "bic", "sid"],
            ),
            NodeField(name="sort_order", label="Sort Order", kind="select", default="auto", options=["auto", "desc", "asc"]),
            NodeField(name="metrics", label="Metrics", kind="json", default=[]),
        ],
    ),
]


def list_node_types() -> list[dict]:
    return [item.model_dump() for item in NODE_TYPES]
