"""ORBIT — Edge Weight Decay Model"""

import math
from typing import Dict, List, Tuple
from dataclasses import dataclass


@dataclass
class DecayParams:
    """Decay parameters for a specific edge type."""
    lambda_rate: float          # decay rate per hour (higher = forget faster)
    s_base: float               # minimum residual strength (floor)
    reinforcement_bonus: float  # base bonus added on revisit
    prune_threshold: float      # below this, edge is candidate for removal


# Default decay parameters per edge type, tuned from spaced repetition research.
# Structural edges (builds_upon, contradicts, applied_in) decay slowly.
# Ephemeral edges (sourced_from, temporal) decay quickly.
DEFAULT_DECAY_PARAMS: Dict[str, DecayParams] = {
    "relates_to":   DecayParams(lambda_rate=0.04,  s_base=0.08, reinforcement_bonus=0.2,  prune_threshold=0.05),
    "builds_upon":  DecayParams(lambda_rate=0.01,  s_base=0.15, reinforcement_bonus=0.15, prune_threshold=0.08),
    "contradicts":  DecayParams(lambda_rate=0.005, s_base=0.15, reinforcement_bonus=0.1,  prune_threshold=0.08),
    "sourced_from": DecayParams(lambda_rate=0.07,  s_base=0.05, reinforcement_bonus=0.15, prune_threshold=0.03),
    "inspired_by":  DecayParams(lambda_rate=0.04,  s_base=0.05, reinforcement_bonus=0.25, prune_threshold=0.03),
    "applied_in":   DecayParams(lambda_rate=0.008, s_base=0.12, reinforcement_bonus=0.15, prune_threshold=0.06),
    "mentioned_by": DecayParams(lambda_rate=0.05,  s_base=0.05, reinforcement_bonus=0.2,  prune_threshold=0.03),
    "temporal":     DecayParams(lambda_rate=0.07,  s_base=0.02, reinforcement_bonus=0.1,  prune_threshold=0.02),
}


def compute_decayed_strength(
    s_0: float,
    t_hours: float,
    params: DecayParams
) -> float:
    """Compute current edge strength after t_hours of decay."""
    # Guard against negative time or negative decaying component
    if t_hours < 0:
        t_hours = 0.0
    if s_0 < 0:
        s_0 = 0.0

    decayed = s_0 * math.exp(-params.lambda_rate * t_hours)
    strength = decayed + params.s_base
    return max(0.0, min(1.0, strength))


def reinforce_edge(
    current_strength: float,
    params: DecayParams
) -> Tuple[float, float]:
    """Reinforce an edge when accessed or traversed by a walker."""
    current_strength = max(0.0, min(1.0, current_strength))

    # Diminishing returns: weaker edges benefit more
    bonus_effective = params.reinforcement_bonus * (1.0 - current_strength)

    new_strength = current_strength + bonus_effective
    new_strength = max(0.0, min(1.0, new_strength))

    # The new decaying component is everything above the floor
    new_s_0 = max(0.0, new_strength - params.s_base)

    return (new_strength, new_s_0)


def batch_decay_update(
    edges: List[dict],
    current_time: float,
    decay_params: Dict[str, DecayParams] = DEFAULT_DECAY_PARAMS
) -> List[dict]:
    """Update ALL edge strengths based on elapsed time since last reinforcement."""
    updated: List[dict] = []

    for edge in edges:
        edge_copy = dict(edge)
        edge_type = edge_copy.get("type", "")
        params = decay_params.get(edge_type)

        if params is None:
            # Unknown edge type — leave unchanged
            updated.append(edge_copy)
            continue

        t_hours = current_time - edge_copy.get("last_reinforced", current_time)
        s_0 = max(0.0, edge_copy["strength"] - params.s_base)
        new_strength = compute_decayed_strength(s_0, t_hours, params)
        edge_copy["strength"] = new_strength
        updated.append(edge_copy)

    return updated


def find_decaying_edges(
    edges: List[dict],
    current_time: float,
    warning_threshold: float = 0.2,
    decay_params: Dict[str, DecayParams] = DEFAULT_DECAY_PARAMS
) -> List[dict]:
    """Find edges approaching the danger zone (between prune threshold and"""
    warnings: List[dict] = []

    for edge in edges:
        edge_type = edge.get("type", "")
        params = decay_params.get(edge_type)
        if params is None:
            continue

        t_hours = current_time - edge.get("last_reinforced", current_time)
        s_0 = max(0.0, edge["strength"] - params.s_base)
        current_strength = compute_decayed_strength(s_0, t_hours, params)

        if params.prune_threshold < current_strength <= warning_threshold:
            # Compute hours from NOW until strength hits prune threshold
            # Current decayed component
            current_s_0_decayed = max(0.0, current_strength - params.s_base)
            hours_until_prune = compute_optimal_review_time(
                current_strength, params.prune_threshold, params
            )

            warnings.append({
                "edge_id": edge["id"],
                "current_strength": current_strength,
                "hours_until_prune": hours_until_prune,
                "edge_type": edge_type,
                "original_edge": edge,
            })

    # Sort by urgency: smallest hours_until_prune first
    warnings.sort(key=lambda w: w["hours_until_prune"])
    return warnings


def find_prunable_edges(
    edges: List[dict],
    current_time: float,
    decay_params: Dict[str, DecayParams] = DEFAULT_DECAY_PARAMS
) -> List[str]:
    """Find edges whose current strength has fallen below their type's prune"""
    prunable: List[str] = []

    for edge in edges:
        edge_type = edge.get("type", "")
        params = decay_params.get(edge_type)
        if params is None:
            continue

        t_hours = current_time - edge.get("last_reinforced", current_time)
        s_0 = max(0.0, edge["strength"] - params.s_base)
        current_strength = compute_decayed_strength(s_0, t_hours, params)

        if current_strength <= params.prune_threshold:
            prunable.append(edge["id"])

    return prunable


def compute_optimal_review_time(
    current_strength: float,
    target_strength: float,
    params: DecayParams
) -> float:
    """Compute how many hours from now until strength decays from current to"""
    s_0 = current_strength - params.s_base

    # If the target is at or below the floor, decay will never reach it
    if target_strength <= params.s_base:
        return float("inf")

    # If already at or below target, no waiting needed
    if current_strength <= target_strength:
        return 0.0

    # If no decaying component, strength is stuck at S_base
    if s_0 <= 0.0:
        return float("inf")

    # Guard against zero decay rate
    if params.lambda_rate <= 0.0:
        return float("inf")

    ratio = (target_strength - params.s_base) / s_0
    if ratio <= 0.0:
        return float("inf")

    t = -math.log(ratio) / params.lambda_rate
    return max(0.0, t)


def simulate_decay_curve(
    s_0: float,
    params: DecayParams,
    hours: float = 168.0,
    steps: int = 100
) -> List[Tuple[float, float]]:
    """Generate (time, strength) pairs showing the decay curve."""
    if steps < 1:
        steps = 1
    if hours < 0:
        hours = 0.0

    curve: List[Tuple[float, float]] = []
    dt = hours / steps

    for i in range(steps + 1):
        t = i * dt
        strength = compute_decayed_strength(s_0, t, params)
        curve.append((round(t, 4), round(strength, 6)))

    return curve


def get_reinforcement_schedule(
    edge_type: str,
    target_retention: float = 0.3,
    decay_params: Dict[str, DecayParams] = DEFAULT_DECAY_PARAMS
) -> float:
    """Compute the optimal interval between reinforcements to maintain"""
    params = decay_params.get(edge_type)
    if params is None:
        return float("inf")

    # Simulate a reinforcement from the target retention level
    # to find the post-reinforcement strength
    new_strength, new_s_0 = reinforce_edge(target_retention, params)

    # Now compute how long until it decays back to target
    return compute_optimal_review_time(new_strength, target_retention, params)


if __name__ == "__main__":
    print("=" * 70)
    print("ORBIT Edge Decay Engine — Verification")
    print("=" * 70)

    # --- 1. Show decay curves for each edge type ---
    print("\n--- Decay Curves (initial strength = 0.8, over 72 hours) ---\n")
    print(f"{'Edge Type':<15} {'t=0':>7} {'t=12h':>7} {'t=24h':>7} {'t=48h':>7} {'t=72h':>7}  {'Prune @':>7}")
    print("-" * 70)

    for edge_type, params in DEFAULT_DECAY_PARAMS.items():
        initial_strength = 0.8
        s_0 = initial_strength - params.s_base
        values = []
        for t in [0, 12, 24, 48, 72]:
            s = compute_decayed_strength(s_0, t, params)
            values.append(f"{s:7.4f}")
        prune_time = compute_optimal_review_time(initial_strength, params.prune_threshold, params)
        prune_str = f"{prune_time:6.1f}h" if prune_time < float("inf") else "  never"
        print(f"{edge_type:<15} {' '.join(values)}  {prune_str}")

    # --- 2. Reinforcement demo ---
    print("\n--- Reinforcement Demo (relates_to edge) ---\n")
    params = DEFAULT_DECAY_PARAMS["relates_to"]
    strength = 0.8
    print(f"Initial strength: {strength:.4f}")

    # Decay for 24 hours
    s_0 = strength - params.s_base
    strength = compute_decayed_strength(s_0, 24.0, params)
    print(f"After 24h decay:  {strength:.4f}")

    # Reinforce
    strength, new_s_0 = reinforce_edge(strength, params)
    print(f"After reinforce:  {strength:.4f} (new S_0 = {new_s_0:.4f})")

    # Decay another 24 hours
    strength = compute_decayed_strength(new_s_0, 24.0, params)
    print(f"After 24h more:   {strength:.4f}")

    # --- 3. Batch update demo ---
    print("\n--- Batch Decay Update ---\n")
    test_edges = [
        {"id": "e1", "type": "relates_to",  "strength": 0.9, "last_reinforced": 0.0},
        {"id": "e2", "type": "builds_upon", "strength": 0.7, "last_reinforced": 0.0},
        {"id": "e3", "type": "temporal",    "strength": 0.5, "last_reinforced": 0.0},
        {"id": "e4", "type": "contradicts", "strength": 0.6, "last_reinforced": 0.0},
    ]

    current_time = 48.0  # 48 hours later
    updated = batch_decay_update(test_edges, current_time)
    for orig, upd in zip(test_edges, updated):
        print(f"  {orig['id']} ({orig['type']:<14}): {orig['strength']:.4f} -> {upd['strength']:.4f}")

    # --- 4. Decaying / prunable edge detection ---
    print("\n--- Edge Health Check at t=48h ---\n")
    decaying = find_decaying_edges(test_edges, current_time, warning_threshold=0.3)
    if decaying:
        print("  Decaying edges (approaching danger zone):")
        for w in decaying:
            print(f"    {w['edge_id']}: strength={w['current_strength']:.4f}, "
                  f"prune in {w['hours_until_prune']:.1f}h")
    else:
        print("  No edges in danger zone.")

    prunable = find_prunable_edges(test_edges, current_time)
    if prunable:
        print(f"  Prunable edges: {prunable}")
    else:
        print("  No edges below prune threshold.")

    # --- 5. Reinforcement schedules ---
    print("\n--- Optimal Review Intervals (target retention = 0.3) ---\n")
    for edge_type in DEFAULT_DECAY_PARAMS:
        interval = get_reinforcement_schedule(edge_type, target_retention=0.3)
        if interval < float("inf"):
            print(f"  {edge_type:<15}: review every {interval:6.1f} hours ({interval/24:.1f} days)")
        else:
            print(f"  {edge_type:<15}: no review needed (floor above target)")

    # --- 6. Simulate a full curve ---
    print("\n--- Sample Decay Curve (relates_to, S_0=0.72, 48h, 8 steps) ---\n")
    curve = simulate_decay_curve(0.72, DEFAULT_DECAY_PARAMS["relates_to"], hours=48.0, steps=8)
    for t, s in curve:
        bar = "#" * int(s * 50)
        print(f"  t={t:5.1f}h  S={s:.4f}  |{bar}")
