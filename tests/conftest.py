"""
Shared fixtures for ORBIT test suite.
"""

import json
import os
import sys
import time

import pytest

# ---------------------------------------------------------------------------
# Make src/engine importable
# ---------------------------------------------------------------------------

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_DIR = os.path.join(PROJECT_ROOT, "src")

if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

# Now we can import directly
from engine.graph_ops import KnowledgeGraph
from engine.decay import DecayParams, DEFAULT_DECAY_PARAMS
from engine.scoring import compute_cluster_density

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DEMO_DATA_PATH = os.path.join(PROJECT_ROOT, "data", "demo_knowledge.json")


# ---------------------------------------------------------------------------
# Graph fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def empty_graph() -> KnowledgeGraph:
    """An empty KnowledgeGraph with no nodes or edges."""
    return KnowledgeGraph()


@pytest.fixture
def single_node_graph() -> KnowledgeGraph:
    """Graph with exactly one node and no edges."""
    g = KnowledgeGraph()
    g.add_node("a", {"name": "Alpha", "type": "Concept"})
    return g


@pytest.fixture
def two_node_graph() -> KnowledgeGraph:
    """Graph: A --relates_to--> B."""
    g = KnowledgeGraph()
    g.add_node("a", {"name": "Alpha", "type": "Concept"})
    g.add_node("b", {"name": "Beta", "type": "Concept"})
    g.add_edge("e1", "a", "b", {"type": "relates_to", "strength": 0.8})
    return g


@pytest.fixture
def linear_graph() -> KnowledgeGraph:
    """A -- B -- C -- D -- E  (linear chain)."""
    g = KnowledgeGraph()
    for label in "abcde":
        g.add_node(label, {"name": label.upper(), "type": "Concept"})
    for i, (s, t) in enumerate([("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")]):
        g.add_edge(f"e{i}", s, t, {"type": "relates_to", "strength": 0.5})
    return g


@pytest.fixture
def star_graph() -> KnowledgeGraph:
    """
    Star topology with 'center' connected to s1..s5.
    No edges between satellite nodes.
    """
    g = KnowledgeGraph()
    g.add_node("center", {"name": "Center", "type": "Concept"})
    for i in range(1, 6):
        nid = f"s{i}"
        g.add_node(nid, {"name": f"Satellite {i}", "type": "Concept"})
        g.add_edge(f"e_c_{nid}", "center", nid, {"type": "relates_to", "strength": 0.7})
    return g


@pytest.fixture
def complete_graph_4() -> KnowledgeGraph:
    """K4 — fully connected 4-node graph (6 edges)."""
    g = KnowledgeGraph()
    nodes = ["n1", "n2", "n3", "n4"]
    for nid in nodes:
        g.add_node(nid, {"name": nid, "type": "Concept"})
    eid = 0
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            g.add_edge(f"e{eid}", nodes[i], nodes[j], {
                "type": "relates_to", "strength": 0.5,
            })
            eid += 1
    return g


@pytest.fixture
def two_cluster_graph() -> KnowledgeGraph:
    """
    Two well-separated clusters (A-B-C) and (D-E-F) joined by a single
    bridge edge C--D with low strength.
    """
    g = KnowledgeGraph()
    for nid in ["a", "b", "c", "d", "e", "f"]:
        g.add_node(nid, {"name": nid.upper(), "type": "Concept"})

    # Cluster 1 — fully connected
    g.add_edge("e_ab", "a", "b", {"type": "relates_to", "strength": 0.9})
    g.add_edge("e_ac", "a", "c", {"type": "relates_to", "strength": 0.85})
    g.add_edge("e_bc", "b", "c", {"type": "relates_to", "strength": 0.9})

    # Cluster 2 — fully connected
    g.add_edge("e_de", "d", "e", {"type": "relates_to", "strength": 0.9})
    g.add_edge("e_df", "d", "f", {"type": "relates_to", "strength": 0.85})
    g.add_edge("e_ef", "e", "f", {"type": "relates_to", "strength": 0.9})

    # Bridge
    g.add_edge("e_cd", "c", "d", {"type": "relates_to", "strength": 0.1})
    return g


@pytest.fixture
def graph_with_timestamps() -> KnowledgeGraph:
    """Graph where nodes have last_accessed and access_count attrs."""
    g = KnowledgeGraph()
    now = time.time()
    g.add_node("recent", {
        "name": "Recent", "type": "Concept",
        "last_accessed": now - 3600,       # 1 hour ago
        "access_count": 20,
        "created_at": now - 86400,
    })
    g.add_node("old", {
        "name": "Old", "type": "Concept",
        "last_accessed": now - 86400 * 30, # 30 days ago
        "access_count": 2,
        "created_at": now - 86400 * 60,
    })
    g.add_node("medium", {
        "name": "Medium", "type": "Concept",
        "last_accessed": now - 86400 * 3,  # 3 days ago
        "access_count": 8,
        "created_at": now - 86400 * 10,
    })
    g.add_edge("e1", "recent", "medium", {"type": "relates_to", "strength": 0.8})
    g.add_edge("e2", "medium", "old", {"type": "relates_to", "strength": 0.3})
    g.add_edge("e3", "recent", "old", {"type": "relates_to", "strength": 0.5})
    return g


@pytest.fixture
def disconnected_graph() -> KnowledgeGraph:
    """Two isolated nodes with no edges."""
    g = KnowledgeGraph()
    g.add_node("island1", {"name": "Island 1", "type": "Concept"})
    g.add_node("island2", {"name": "Island 2", "type": "Concept"})
    return g


# ---------------------------------------------------------------------------
# Decay fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def relates_to_params() -> DecayParams:
    return DEFAULT_DECAY_PARAMS["relates_to"]


@pytest.fixture
def builds_upon_params() -> DecayParams:
    return DEFAULT_DECAY_PARAMS["builds_upon"]


@pytest.fixture
def sample_edges() -> list:
    """A batch of edges for decay testing."""
    return [
        {"id": "e1", "type": "relates_to",  "strength": 0.9, "last_reinforced": 0.0},
        {"id": "e2", "type": "builds_upon", "strength": 0.7, "last_reinforced": 0.0},
        {"id": "e3", "type": "temporal",    "strength": 0.5, "last_reinforced": 0.0},
        {"id": "e4", "type": "contradicts", "strength": 0.6, "last_reinforced": 0.0},
        {"id": "e5", "type": "sourced_from","strength": 0.4, "last_reinforced": 0.0},
    ]


# ---------------------------------------------------------------------------
# Demo data fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def demo_data() -> dict:
    """Load and return the parsed demo_knowledge.json."""
    with open(DEMO_DATA_PATH, "r") as f:
        return json.load(f)


@pytest.fixture
def demo_graph(demo_data) -> KnowledgeGraph:
    """Load demo_knowledge.json into a KnowledgeGraph instance."""
    g = KnowledgeGraph()
    for node in demo_data["nodes"]:
        g.add_node(node["id"], node)
    for idx, edge in enumerate(demo_data["edges"]):
        edge_id = edge.get("id", f"auto_e{idx}")
        g.add_edge(edge_id, edge["source"], edge["target"], edge)
    return g
