"""Reusable digital MoCA cube trajectory scorer."""

import json
import math
import argparse
from dataclasses import dataclass

import numpy as np
import matplotlib.pyplot as plt


@dataclass
class Config:
    rdp_epsilon: float = 0.012
    min_segment_length: float = 0.035
    merge_angle_deg: float = 18.0
    endpoint_radius: float = 0.065
    orientation_tolerance_deg: float = 18.0
    min_stroke_length: float = 0.03


def dist(a, b):
    return float(np.linalg.norm(np.asarray(a) - np.asarray(b)))


def point_line_distance(p, a, b):
    p, a, b = map(lambda x: np.asarray(x, dtype=float), (p, a, b))
    ab = b - a
    denom = float(ab @ ab)
    if denom == 0:
        return float(np.linalg.norm(p - a))
    t = np.clip(float((p - a) @ ab) / denom, 0.0, 1.0)
    return float(np.linalg.norm(p - (a + t * ab)))


def rdp(points, epsilon):
    points = np.asarray(points, dtype=float)
    if len(points) < 3:
        return points.copy()
    a, b = points[0], points[-1]
    ds = np.array([point_line_distance(p, a, b) for p in points[1:-1]])
    if len(ds) == 0 or ds.max() <= epsilon:
        return np.vstack([a, b])
    idx = int(np.argmax(ds)) + 1
    left = rdp(points[:idx + 1], epsilon)
    right = rdp(points[idx:], epsilon)
    return np.vstack([left[:-1], right])


def angle_deg(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def angle_diff(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def polyline_length(points):
    if len(points) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())


def normalize_to_crop(data):
    c = data['cropBox']
    out = []
    for stroke in data['strokes']:
        pts = np.array([
            [(p['x'] - c['x']) / c['w'], (p['y'] - c['y']) / c['h']]
            for p in stroke['points']
        ], dtype=float)
        if len(pts) >= 2 and polyline_length(pts) >= 0.03:
            out.append(pts)
    return out


def merge_collinear_segments(points, cfg):
    """RDP points -> long, straight-ish segments.

    Consecutive RDP segments that form almost the same line are merged.
    This removes small reversals/overshoots caused by pen jitter.
    """
    if len(points) < 2:
        return []

    segs = []
    for a, b in zip(points[:-1], points[1:]):
        L = dist(a, b)
        if L >= cfg.min_segment_length:
            segs.append({'a': a.copy(), 'b': b.copy()})

    if not segs:
        return []

    merged = [segs[0]]
    for s in segs[1:]:
        prev = merged[-1]
        if angle_diff(angle_deg(prev['a'], prev['b']), angle_deg(s['a'], s['b'])) <= cfg.merge_angle_deg:
            # Preserve the overall span of the combined run.
            prev['b'] = s['b'].copy()
        else:
            merged.append(s)

    return [
        {
            'a': s['a'],
            'b': s['b'],
            'length': dist(s['a'], s['b']),
            'angle': angle_deg(s['a'], s['b'])
        }
        for s in merged if dist(s['a'], s['b']) >= cfg.min_segment_length
    ]


def extract_edges(strokes, cfg):
    edges = []
    for si, pts in enumerate(strokes):
        simplified = rdp(pts, cfg.rdp_epsilon)
        for ei, e in enumerate(merge_collinear_segments(simplified, cfg)):
            e = dict(e)
            e['stroke'] = si
            e['segment'] = ei
            edges.append(e)
    return edges


def circular_mean(angles):
    a = np.deg2rad(2.0 * np.asarray(angles))
    return (math.degrees(math.atan2(np.sin(a).mean(), np.cos(a).mean())) / 2.0) % 180.0


def cluster_orientations(edges, k=3):
    """Small deterministic circular k-means for unoriented line angles."""
    if not edges:
        return []
    angles = np.array([e['angle'] for e in edges], dtype=float)
    if len(angles) <= k:
        return [{'mean': float(a), 'edges': [i]} for i, a in enumerate(angles)]

    # Start from approximately evenly separated quantiles, then iterate.
    order = np.argsort(angles)
    centers = angles[order[np.linspace(0, len(angles)-1, k).astype(int)]].copy()

    for _ in range(50):
        labels = np.array([
            int(np.argmin([angle_diff(a, c) for c in centers]))
            for a in angles
        ])
        new_centers = np.array([
            circular_mean(angles[labels == j]) if np.any(labels == j) else centers[j]
            for j in range(k)
        ])
        if np.all([angle_diff(a, b) < 1e-4 for a, b in zip(centers, new_centers)]):
            break
        centers = new_centers

    groups = []
    for j in range(k):
        idx = np.where(labels == j)[0].tolist()
        if idx:
            groups.append({'mean': float(circular_mean(angles[idx])), 'edges': idx})
    groups.sort(key=lambda g: g['mean'])
    return groups


def cluster_vertices(edges, radius):
    """Cluster all edge endpoints with a scale-aware union-find."""
    points = []
    for i, e in enumerate(edges):
        points.extend([(i, 0, e['a']), (i, 1, e['b'])])

    n = len(points)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if dist(points[i][2], points[j][2]) <= radius:
                union(i, j)

    groups = {}
    for i, item in enumerate(points):
        groups.setdefault(find(i), []).append(item)

    vertices = []
    point_to_vertex = {}
    for vid, members in enumerate(groups.values()):
        center = np.mean([m[2] for m in members], axis=0)
        vertices.append({'id': vid, 'center': center, 'members': members})
        for m in members:
            point_to_vertex[(m[0], m[1])] = vid

    for i, e in enumerate(edges):
        e['v0'] = point_to_vertex[(i, 0)]
        e['v1'] = point_to_vertex[(i, 1)]

    return vertices


def degree_score(vertices, edges):
    deg = {v['id']: 0 for v in vertices}
    for e in edges:
        if e['v0'] != e['v1']:
            deg[e['v0']] += 1
            deg[e['v1']] += 1
    # Soft score: cube vertices ideally have degree 3, but hand drawings can
    # create degree-2 vertices because two edges miss each other slightly.
    vals = list(deg.values())
    if not vals:
        return 0.0, deg
    score = np.mean([1.0 if d == 3 else 0.65 if d == 2 else 0.15 for d in vals])
    return float(score), deg


def connectivity_score(vertices, edges):
    if not vertices:
        return 0.0
    adj = {v['id']: set() for v in vertices}
    for e in edges:
        if e['v0'] != e['v1']:
            adj[e['v0']].add(e['v1'])
            adj[e['v1']].add(e['v0'])
    seen = set()
    comps = 0
    for start in adj:
        if start in seen:
            continue
        comps += 1
        stack = [start]
        seen.add(start)
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
    return 1.0 if comps == 1 else 1.0 / comps


def score_cube(strokes, edges, vertices, cfg):
    # ==========================================
    # 1. EARLY HARD REJECTIONS
    # ==========================================
    if len(edges) < 6:
        return {'score': 0, 'confidence': 0.0, 'reason': 'Failed: Too few edges'}
    
    if len(vertices) < 4:
        return {'score': 0, 'confidence': 0.0, 'reason': 'Failed: Too few vertices'}

    # ==========================================
    # 2. FEATURE EXTRACTION
    # ==========================================
    groups = cluster_orientations(edges, k=3)
    
    # A. Orientation Concentration & Parallelism
    orient_errors = []
    for g in groups:
        for i in g['edges']:
            orient_errors.append(angle_diff(edges[i]['angle'], g['mean']))
            
    mean_orient_error = float(np.mean(orient_errors)) if orient_errors else 90.0
    
    # If the variance is huge, it's a circle/curve, not a cube.
    # A cube usually has < 12 degrees of error. A circle will have 15-30+.
    parallelism_score = max(0.0, 1.0 - (mean_orient_error / 20.0))

    # B. Family Balance (Parallel Pairs)
    # A perfect cube has 4 edges in each of the 3 directions.
    counts = [len(g['edges']) for g in groups]
    min_family_size = min(counts) if counts else 0
    
    # Calculate how close the families are to the ideal [4, 4, 4]
    counts_array = np.array(counts, dtype=float)
    family_balance_score = max(0.0, 1.0 - np.mean(np.abs(counts_array - 4)) / 4.0)

    # C. Topology / Vertex Degrees
    degree_score_val, degrees = degree_score(vertices, edges)
    connectivity = connectivity_score(vertices, edges)
    
    # Evaluate how many "Cube-like" degree-3 vertices exist
    degree_vals = list(degrees.values())
    degree_3_count = degree_vals.count(3)
    topology_score = min(1.0, degree_3_count / 8.0) # Ideal is 8

    # D. Straightness Estimation
    # (Assuming edges are relatively straight from RDP, but penalizing high segment counts)
    # If a drawing has 25 edges to form a simple shape, they aren't drawing straight lines.
    ideal_edge_count = 12.0
    straightness_score = 1.0 if len(edges) <= 14 else max(0.0, 1.0 - (len(edges) - 14) / 20.0)

    # ==========================================
    # 3. LATE HARD REJECTIONS (Structure gates)
    # ==========================================
    if mean_orient_error > 18.0:
        return {'score': 0, 'confidence': 0.0, 'reason': 'Failed: Continuous curves (Circle/Squiggle)'}
        
    if min_family_size < 2:
        return {'score': 0, 'confidence': 0.0, 'reason': 'Failed: Missing parallel structures (Triangle/Prism)'}
        
    if connectivity < 0.5:
        return {'score': 0, 'confidence': 0.0, 'reason': 'Failed: Severely disconnected components'}

    # ==========================================
    # 4. WEIGHTED SCORING
    # ==========================================
    final_score = (
        0.20 * straightness_score +
        0.20 * parallelism_score +       # Replaces raw orientation score
        0.20 * family_balance_score +    # Ensures it's a 3D box, not a flat shape
        0.15 * topology_score +          # Checks for degree-3 corners
        0.15 * connectivity +
        0.10 * degree_score_val          # Soft vertex evaluation
    )

    # The final gate using your proposed thresholds
    is_cube = int(
        final_score >= 0.70 and
        parallelism_score >= 0.60 and
        straightness_score >= 0.70
    )

    # ==========================================
    # 5. RETURN COMPREHENSIVE JSON
    # ==========================================
    return {
        'score': is_cube,
        'confidence': round(float(final_score), 3),
        'reason': 'Passed' if is_cube else 'Failed heuristic thresholds',
        'metrics': {
            'edgesDetected': len(edges),
            'verticesDetected': len(vertices),
            'degree3Vertices': degree_3_count,
            'orientationMeans': [round(float(g['mean']), 1) for g in groups],
            'orientationCounts': counts,
            'meanOrientationErrorDeg': round(mean_orient_error, 2),
        },
        'subScores': {
            'straightness': round(float(straightness_score), 3),
            'parallelism': round(float(parallelism_score), 3),
            'familyBalance': round(float(family_balance_score), 3),
            'topology': round(float(topology_score), 3),
            'connectivity': round(float(connectivity), 3)
        }
    }

