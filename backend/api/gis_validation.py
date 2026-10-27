"""Small GeoJSON validators for the existing cemetery boundary datasets.

Coordinates use GeoJSON order: longitude, latitude. This deliberately handles
only simple polygons, which is the only drawing mode enabled in CPDO.
"""
import math


class GeometryValidationError(ValueError):
    pass


def _point_on_segment(point, start, end, tolerance=1e-10):
    px, py = point
    ax, ay = start
    bx, by = end
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if abs(cross) > tolerance:
        return False
    return min(ax, bx) - tolerance <= px <= max(ax, bx) + tolerance and min(ay, by) - tolerance <= py <= max(ay, by) + tolerance


def _point_in_ring(point, ring):
    inside = False
    for index in range(len(ring) - 1):
        start, end = ring[index], ring[index + 1]
        if _point_on_segment(point, start, end):
            return True
        ax, ay = start
        bx, by = end
        if (ay > point[1]) != (by > point[1]):
            crossing_x = (bx - ax) * (point[1] - ay) / (by - ay) + ax
            if point[0] < crossing_x:
                inside = not inside
    return inside


def point_in_polygon(point, geometry):
    """Return whether a GeoJSON coordinate is inside a simple Polygon."""
    if not isinstance(geometry, dict) or geometry.get('type') != 'Polygon':
        return False
    rings = geometry.get('coordinates') or []
    if not rings or len(rings[0]) < 4:
        return False
    outer = rings[0]
    if outer[0] != outer[-1]:
        outer = [*outer, outer[0]]
    if not _point_in_ring(point, outer):
        return False
    for hole in rings[1:]:
        if hole:
            closed_hole = hole if hole[0] == hole[-1] else [*hole, hole[0]]
            if _point_in_ring(point, closed_hole):
                return False
    return True


def _orientation(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _proper_intersection(a, b, c, d):
    return (_orientation(a, b, c) * _orientation(a, b, d) < 0 and
            _orientation(c, d, a) * _orientation(c, d, b) < 0)


def validate_section_polygon(geometry, boundary_geometry):
    if not isinstance(geometry, dict) or geometry.get('type') != 'Polygon':
        raise GeometryValidationError('Section geometry must be a GeoJSON Polygon.')
    rings = geometry.get('coordinates')
    if not isinstance(rings, list) or not rings or not isinstance(rings[0], list):
        raise GeometryValidationError('Section polygon coordinates are missing or malformed.')
    ring = rings[0]
    if len(ring) < 4:
        raise GeometryValidationError('Section polygon requires at least three unique points.')
    clean_ring = []
    for point in ring:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise GeometryValidationError('Section polygon contains a malformed coordinate.')
        x, y = point[0], point[1]
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not math.isfinite(x) or not math.isfinite(y):
            raise GeometryValidationError('Section polygon coordinates must be finite numbers.')
        clean_ring.append([float(x), float(y)])
    if clean_ring[0] != clean_ring[-1]:
        raise GeometryValidationError('Section polygon must be closed.')
    if len({tuple(point) for point in clean_ring[:-1]}) < 3:
        raise GeometryValidationError('Section polygon requires at least three unique points.')
    edge_count = len(clean_ring) - 1
    for first in range(edge_count):
        for second in range(first + 1, edge_count):
            if second in (first, first + 1) or (first == 0 and second == edge_count - 1):
                continue
            if _proper_intersection(clean_ring[first], clean_ring[first + 1], clean_ring[second], clean_ring[second + 1]):
                raise GeometryValidationError('Section polygon cannot intersect itself.')
    boundary = boundary_geometry.get('coordinates') if isinstance(boundary_geometry, dict) else None
    if not boundary or len(boundary) < 4:
        raise GeometryValidationError('The selected cemetery does not have a configured boundary.')
    if boundary[0] != boundary[-1]:
        boundary = [*boundary, boundary[0]]
    points_to_check = clean_ring[:-1]
    points_to_check += [[(clean_ring[i][0] + clean_ring[i + 1][0]) / 2, (clean_ring[i][1] + clean_ring[i + 1][1]) / 2] for i in range(edge_count)]
    if not all(_point_in_ring(point, boundary) for point in points_to_check):
        raise GeometryValidationError('This section must be inside the selected cemetery boundary.')
    return geometry


def validate_pathway_line(geometry, boundary_geometry):
    if not isinstance(geometry, dict) or geometry.get('type') != 'LineString':
        raise GeometryValidationError('Pathway geometry must be a GeoJSON LineString.')
    coordinates = geometry.get('coordinates')
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise GeometryValidationError('A pathway requires at least two points.')
    clean_coordinates = []
    for point in coordinates:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise GeometryValidationError('Pathway contains a malformed coordinate.')
        x, y = point[0], point[1]
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not math.isfinite(x) or not math.isfinite(y):
            raise GeometryValidationError('Pathway coordinates must be finite numbers.')
        clean_coordinates.append([float(x), float(y)])
    if len({tuple(point) for point in clean_coordinates}) < 2:
        raise GeometryValidationError('A pathway requires at least two unique points.')
    boundary = boundary_geometry.get('coordinates') if isinstance(boundary_geometry, dict) else None
    if not boundary or len(boundary) < 4:
        raise GeometryValidationError('The selected cemetery does not have a configured boundary.')
    if boundary[0] != boundary[-1]:
        boundary = [*boundary, boundary[0]]
    points_to_check = [*clean_coordinates]
    points_to_check += [[(clean_coordinates[i][0] + clean_coordinates[i + 1][0]) / 2, (clean_coordinates[i][1] + clean_coordinates[i + 1][1]) / 2] for i in range(len(clean_coordinates) - 1)]
    if not all(_point_in_ring(point, boundary) for point in points_to_check):
        raise GeometryValidationError('This pathway must be inside the selected cemetery boundary.')
    return geometry
