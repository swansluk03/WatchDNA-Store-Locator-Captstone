#!/usr/bin/env python3
"""Grid-based spatial index for finding stores within a distance tolerance."""

import math
from typing import Dict, List, Tuple, Optional

from coordinate_utils import EARTH_RADIUS_METERS


def _calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_METERS * c


_CELL_SIZE_DEGREES = 0.0005


class StoreIndex:

    def __init__(self, tolerance_meters: float = 50.0):
        self.tolerance_meters = tolerance_meters
        self._index: Dict[Tuple[int, int], List[Tuple[dict, int]]] = {}

    def add(self, store: dict, index: int) -> None:
        lat_str = store.get('Latitude', '').strip()
        lon_str = store.get('Longitude', '').strip()
        if not lat_str or not lon_str:
            return
        try:
            lat = float(lat_str)
            lon = float(lon_str)
        except (ValueError, TypeError):
            return
        key = (
            int(lat / _CELL_SIZE_DEGREES),
            int(lon / _CELL_SIZE_DEGREES)
        )
        if key not in self._index:
            self._index[key] = []
        self._index[key].append((store, index))

    def update_at(self, index: int, store: dict) -> None:
        for key in list(self._index.keys()):
            for i, (_, idx) in enumerate(self._index[key]):
                if idx == index:
                    self._index[key][i] = (store, index)
                    return

    def find_nearby(
        self,
        lat: float,
        lon: float,
        tolerance_meters: Optional[float] = None
    ) -> List[Tuple[dict, int]]:
        tol = tolerance_meters if tolerance_meters is not None else self.tolerance_meters
        center_key = (int(lat / _CELL_SIZE_DEGREES), int(lon / _CELL_SIZE_DEGREES))
        results = []

        for dlat in (-1, 0, 1):
            for dlon in (-1, 0, 1):
                key = (center_key[0] + dlat, center_key[1] + dlon)
                if key not in self._index:
                    continue
                for store, idx in self._index[key]:
                    lat_str = store.get('Latitude', '').strip()
                    lon_str = store.get('Longitude', '').strip()
                    if not lat_str or not lon_str:
                        continue
                    try:
                        s_lat = float(lat_str)
                        s_lon = float(lon_str)
                    except (ValueError, TypeError):
                        continue
                    dist = _calculate_distance(lat, lon, s_lat, s_lon)
                    if dist <= tol:
                        results.append((store, idx))

        return results


def build_store_index(stores: List[dict], tolerance_meters: float = 50.0) -> StoreIndex:
    index = StoreIndex(tolerance_meters=tolerance_meters)
    for i, store in enumerate(stores):
        index.add(store, i)
    return index


if __name__ == "__main__":
    test_stores = [
        {"Name": "A", "Latitude": "40.7128", "Longitude": "-74.0060"},
        {"Name": "B", "Latitude": "40.7129", "Longitude": "-74.0061"},
        {"Name": "C", "Latitude": "40.7200", "Longitude": "-74.0100"},
    ]
    idx = build_store_index(test_stores, tolerance_meters=50.0)
    nearby = idx.find_nearby(40.7128, -74.0060, 50.0)
    assert len(nearby) >= 2, f"Expected at least 2 nearby (A and B), got {len(nearby)}"
    names = {s[0]["Name"] for s in nearby}
    assert "A" in names and "B" in names
    print("spatial_index unit test passed")
