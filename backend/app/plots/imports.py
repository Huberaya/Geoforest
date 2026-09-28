"""Offline-only bounded import readers. No persistence and no URL resolution."""

import hashlib
import json
import math
from xml.etree.ElementTree import ParseError

from app.plots.geometry import MAX_POSITIONS, invalid, structure
from defusedxml import ElementTree as SafeXML
from defusedxml.common import DefusedXmlException

MAX_IMPORT_BYTES = 1024 * 1024
MAX_FEATURES = 100


def _pairs_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            invalid("DUPLICATE_JSON_KEY", "Clé JSON répétée : le fichier est ambigu")
        result[key] = value
    return result


def _json(raw):
    try:
        data = json.loads(
            raw.lstrip("\ufeff"),
            object_pairs_hook=_pairs_unique,
            parse_constant=lambda _: invalid(
                "NON_FINITE_COORDINATE", "Constante JSON non finie"
            ),
        )
    except (ValueError, RecursionError):
        invalid(
            "JSON_UNREADABLE", "Fichier JSON illisible ou trop profondément imbriqué"
        )
    if not isinstance(data, dict):
        invalid("GEOJSON_OBJECT_REQUIRED", "Un objet GeoJSON est attendu")
    if "crs" in data:
        invalid(
            "CRS_NOT_SUPPORTED",
            "Convertissez explicitement le fichier en WGS84 EPSG:4326",
        )
    if data.get("type") == "FeatureCollection":
        features = data.get("features")
        if not isinstance(features, list) or not features:
            invalid("FEATURES_REQUIRED", "La collection doit contenir des features")
    elif data.get("type") == "Feature":
        features = [data]
    else:
        features = [{"type": "Feature", "geometry": data, "properties": {}}]
    if len(features) > MAX_FEATURES:
        invalid("FEATURE_LIMIT", "Limite technique : 100 features par import")
    result = []
    for index, feature in enumerate(features, 1):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            invalid("FEATURE_INVALID", f"Feature {index} invalide")
        if "crs" in feature:
            invalid("CRS_NOT_SUPPORTED", f"Feature {index} : CRS non pris en charge")
        properties = feature.get("properties")
        if properties is None:
            properties = {}
        if not isinstance(properties, dict):
            invalid("PROPERTIES_INVALID", f"Feature {index} : propriétés invalides")
        # Metadata is declarative. Unknown fields are reported, not silently mapped
        # into internal identifiers, tenant IDs, legal status or compliance flags.
        known = {
            "name",
            "reference",
            "country",
            "ProductionPlace",
            "ProducerName",
            "ProducerCountry",
            "Area",
        }
        result.append(
            {
                "geometry": feature.get("geometry"),
                "source_properties": {
                    k: v for k, v in properties.items() if k in known
                },
                "ignored_properties": sorted(set(properties) - known),
                "warnings": [],
            }
        )
    return result


def _tag(node):
    return node.tag.rsplit("}", 1)[-1]


def _children(node, tag):
    return [n for n in node if _tag(n) == tag]


def _kml(raw):
    try:
        root = SafeXML.fromstring(
            raw, forbid_dtd=True, forbid_entities=True, forbid_external=True
        )
    except (ParseError, DefusedXmlException, RecursionError, ValueError):
        invalid(
            "KML_UNSAFE_OR_INVALID",
            "KML invalide ; DTD, entités et ressources externes interdites",
        )
    if _tag(root) != "kml":
        invalid("KML_ROOT_REQUIRED", "Racine kml attendue")
    nodes = list(root.iter())
    if len(nodes) > 50_000:
        invalid("XML_ELEMENT_LIMIT", "Trop d’éléments XML dans ce fichier")
    if any(_tag(n) in {"NetworkLink", "href", "ResourceMap"} for n in nodes):
        invalid(
            "KML_NETWORK_FORBIDDEN",
            "Les liens et ressources réseau KML ne sont jamais chargés",
        )
    marks = [n for n in nodes if _tag(n) == "Placemark"]
    if not marks or len(marks) > MAX_FEATURES:
        invalid("FEATURE_LIMIT", "Le KML doit contenir entre 1 et 100 Placemarks")
    result = []
    for mark in marks:
        altitude_dropped = False

        def positions(node):
            nonlocal altitude_dropped
            fields = _children(node, "coordinates")
            if len(fields) != 1:
                invalid(
                    "KML_COORDINATES_REQUIRED",
                    "Un élément coordinates est requis par géométrie/anneau",
                )
            text = fields[0].text or ""
            tokens = text.split()
            if not tokens or len(tokens) > MAX_POSITIONS:
                invalid(
                    "POSITION_LIMIT", "Coordonnées vides ou limite technique dépassée"
                )
            pairs = []
            for token in tokens:
                try:
                    values = [float(v) for v in token.split(",")]
                    if len(values) not in {2, 3} or not all(
                        math.isfinite(v) for v in values
                    ):
                        raise ValueError
                except ValueError:
                    invalid(
                        "KML_COORDINATE_INVALID",
                        "Position KML attendue : longitude,latitude[,altitude]",
                    )
                altitude_dropped |= len(values) == 3
                pairs.append(values[:2])
            return pairs

        def geometry(node, depth=0):
            if depth > 10:
                invalid(
                    "KML_NESTING_LIMIT", "MultiGeometry trop profondément imbriquée"
                )
            tag = _tag(node)
            if tag == "Point":
                pairs = positions(node)
                if len(pairs) != 1:
                    invalid("KML_POINT_INVALID", "Un Point exige une seule position")
                return {"type": "Point", "coordinates": pairs[0]}
            if tag == "Polygon":
                outside = _children(node, "outerBoundaryIs")
                if len(outside) != 1:
                    invalid(
                        "KML_OUTER_RING_REQUIRED",
                        "Un seul contour extérieur est requis",
                    )
                rings = []
                for boundary in outside + _children(node, "innerBoundaryIs"):
                    linear = _children(boundary, "LinearRing")
                    if len(linear) != 1:
                        invalid(
                            "KML_RING_REQUIRED", "Un LinearRing est requis par contour"
                        )
                    rings.append(positions(linear[0]))
                return {"type": "Polygon", "coordinates": rings}
            if tag == "MultiGeometry":
                if not len(node):
                    invalid("MULTIPOLYGON_EMPTY", "MultiGeometry vide")
                polygons = []
                for child in node:
                    item = geometry(child, depth + 1)
                    if item["type"] == "Polygon":
                        polygons.append(item["coordinates"])
                    elif item["type"] == "MultiPolygon":
                        polygons.extend(item["coordinates"])
                    else:
                        invalid(
                            "KML_MIXED_GEOMETRY",
                            "Séparez les points des polygones dans des Placemarks distincts",
                        )
                return {"type": "MultiPolygon", "coordinates": polygons}
            invalid(
                "KML_GEOMETRY_UNSUPPORTED",
                "Géométrie KML non prise en charge ; aucun élément n’a été importé",
            )

        shapes = [
            n
            for n in mark
            if _tag(n)
            in {
                "Point",
                "Polygon",
                "MultiGeometry",
                "LineString",
                "Model",
                "Track",
                "MultiTrack",
            }
        ]
        if len(shapes) != 1:
            invalid(
                "KML_SHAPE_REQUIRED",
                "Chaque Placemark doit contenir une géométrie prise en charge",
            )
        geom = geometry(shapes[0])
        names = _children(mark, "name")
        name = names[0].text if names else None
        result.append(
            {
                "geometry": geom,
                "source_properties": {"name": name} if name else {},
                "ignored_properties": [],
                "warnings": ["KML_ALTITUDE_NOT_USED_IN_2D"] if altitude_dropped else [],
            }
        )
    return result


def parse_import(raw, file_format):
    if not isinstance(raw, str) or not raw.strip():
        invalid("FILE_EMPTY", "Fichier texte vide")
    try:
        encoded = raw.encode("utf-8")
    except UnicodeEncodeError:
        invalid("FILE_ENCODING", "Encodage Unicode invalide")
    if len(encoded) > MAX_IMPORT_BYTES:
        invalid("FILE_LIMIT", "Limite technique : 1 Mio de texte UTF-8 par import")
    if file_format not in {"geojson", "kml"}:
        invalid(
            "FILE_FORMAT_UNSUPPORTED",
            "Formats acceptés : GeoJSON et KML texte ; pas de SHP/KMZ",
        )
    features = _json(raw) if file_format == "geojson" else _kml(raw)
    total = 0
    for index, feature in enumerate(features, 1):
        geom, positions = structure(feature["geometry"])
        total += len(positions)
        if total > MAX_POSITIONS:
            invalid(
                "IMPORT_POSITION_LIMIT",
                "Limite technique : 10 000 positions pour l’ensemble du fichier",
            )
        feature["geometry"] = geom
        feature["source_index"] = index
    return {
        "features": features,
        "position_count": total,
        "source_sha256": hashlib.sha256(encoded).hexdigest(),
        "format": file_format,
        "parser_version": "plots-import-v1-draft",
        "status": "STRUCTURE_PARSED_NOT_PERSISTED",
    }
