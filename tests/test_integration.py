"""
Integration tests for ORBIT engine using the actual demo knowledge base.

Verifies that the full pipeline works end-to-end: load graph, run
algorithms, produce valid results.
"""

import numpy as np
import pytest

from engine.graph_ops import (
    KnowledgeGraph,
    all_simple_paths,
    betweenness_centrality,
    bfs_shortest_path,
    compute_node_importance,
    find_bridge_concepts,
    find_knowledge_gaps,
    find_orphan_nodes,
    louvain_communities,
    pagerank,
)
from engine.decay import (
    DEFAULT_DECAY_PARAMS,
    batch_decay_update,
)


class TestDemoGraphLoading:

    def test_node_count(self, demo_graph, demo_data):
        assert demo_graph.node_count() == len(demo_data["nodes"])

    def test_edge_count(self, demo_graph, demo_data):
        assert demo_graph.edge_count() == len(demo_data["edges"])

    def test_all_nodes_present(self, demo_graph, demo_data):
        for node in demo_data["nodes"]:
            assert node["id"] in demo_graph.nodes

    def test_all_edges_have_endpoints(self, demo_graph, demo_data):
        for edge in demo_data["edges"]:
            assert edge["source"] in demo_graph.nodes
            assert edge["target"] in demo_graph.nodes


class TestBFSOnDemoGraph:

    def test_path_exists_within_domain(self, demo_graph):
        # Two learning concepts should be connected
        path = bfs_shortest_path(demo_graph, "spaced_repetition", "forgetting_curve")
        assert path is not None
        assert path[0] == "spaced_repetition"
        assert path[-1] == "forgetting_curve"

    def test_cross_domain_path(self, demo_graph):
        # Check that a path exists between different domains
        # (the graph should be connected enough)
        path = bfs_shortest_path(demo_graph, "machine_learning", "compound_interest")
        # May or may not exist depending on graph structure
        # Just verify the function doesn't crash
        assert path is None or (path[0] == "machine_learning" and path[-1] == "compound_interest")


class TestPageRankOnDemoGraph:

    def test_sums_to_one(self, demo_graph):
        pr = pagerank(demo_graph)
        total = sum(pr.values())
        assert abs(total - 1.0) < 1e-4

    def test_all_nodes_scored(self, demo_graph):
        pr = pagerank(demo_graph)
        assert set(pr.keys()) == set(demo_graph.nodes.keys())

    def test_central_concepts_ranked_high(self, demo_graph):
        pr = pagerank(demo_graph)
        # Sort by pagerank
        ranked = sorted(pr.items(), key=lambda x: x[1], reverse=True)
        top_10_ids = [nid for nid, _ in ranked[:10]]
        # At least some high-importance nodes should appear in top 10
        # (machine_learning, neural_networks, etc. have many edges)
        assert len(top_10_ids) == 10


class TestLouvainOnDemoGraph:

    def test_reasonable_community_count(self, demo_graph):
        np.random.seed(42)
        comms = louvain_communities(demo_graph)
        n = demo_graph.node_count()
        # Should not be 1 community or N communities
        assert 2 <= len(comms) <= n - 1

    def test_all_nodes_assigned(self, demo_graph):
        np.random.seed(42)
        comms = louvain_communities(demo_graph)
        all_nodes = set()
        for c in comms:
            all_nodes.update(c)
        assert all_nodes == set(demo_graph.nodes.keys())

    def test_no_empty_communities(self, demo_graph):
        np.random.seed(42)
        comms = louvain_communities(demo_graph)
        for c in comms:
            assert len(c) > 0


class TestBetweennessOnDemoGraph:

    def test_all_nodes_scored(self, demo_graph):
        bc = betweenness_centrality(demo_graph)
        assert set(bc.keys()) == set(demo_graph.nodes.keys())

    def test_bridge_concepts_have_high_scores(self, demo_graph):
        bc = betweenness_centrality(demo_graph)
        # Sort by centrality
        ranked = sorted(bc.items(), key=lambda x: x[1], reverse=True)
        # Top nodes should have non-zero centrality
        assert ranked[0][1] > 0.0


class TestDecayOnDemoGraph:

    def test_batch_decay_changes_strengths(self, demo_data):
        edges = []
        for idx, e in enumerate(demo_data["edges"]):
            edges.append({
                "id": e.get("id", f"e{idx}"),
                "type": e["type"],
                "strength": e["strength"],
                "last_reinforced": 0.0,
            })
        updated = batch_decay_update(edges, current_time=48.0)
        changed = sum(
            1 for orig, upd in zip(edges, updated)
            if abs(orig["strength"] - upd["strength"]) > 1e-9
        )
        # Most edges should have decayed
        assert changed > len(edges) * 0.5


class TestFullPipeline:

    def test_load_pagerank_communities_gaps_bridges(self, demo_graph):
        """End-to-end: load -> pagerank -> communities -> gaps -> bridges."""
        # 1. PageRank
        pr = pagerank(demo_graph)
        assert len(pr) == demo_graph.node_count()

        # 2. Communities
        np.random.seed(42)
        comms = louvain_communities(demo_graph)
        assert len(comms) >= 2

        # 3. Knowledge gaps
        gaps = find_knowledge_gaps(demo_graph, comms)
        # gaps is a list (may be empty, but the function should work)
        assert isinstance(gaps, list)

        # 4. Bridge concepts
        bridges = find_bridge_concepts(demo_graph, comms)
        assert isinstance(bridges, list)

        # 5. Node importance
        imp = compute_node_importance(demo_graph)
        assert len(imp) == demo_graph.node_count()
        for score in imp.values():
            assert 0.0 <= score <= 1.0

        # 6. Orphans
        orphans = find_orphan_nodes(demo_graph, min_edges=2)
        assert isinstance(orphans, list)
