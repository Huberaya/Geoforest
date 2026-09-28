"""Versioned, source-linked EUDR reference data for risk and DDR workflows.

This is a human-assistance reference, not legal advice and not an official submission
schema. Exact ex-code qualifiers and factual product characteristics always require review.
"""
from __future__ import annotations

from datetime import date
from typing import Any

COUNTRY_BENCHMARK_VERSION = "EU-2025-1093-annex-2025-05-23"
COUNTRY_BENCHMARK_SOURCE = "https://eur-lex.europa.eu/eli/reg_impl/2025/1093/oj"
COUNTRY_BENCHMARK_CELEX = "32025R1093"

# ISO 3166-1 alpha-2 codes mapped from the Annex to Commission Implementing
# Regulation (EU) 2025/1093. Codes not present in the Annex are not silently
# assigned a level here: Article 1(2) provides a standard default, but an unknown
# or mistyped code must be verified before using that default.
LOW_RISK_COUNTRY_CODES = frozenset({
    "AF", "AL", "DZ", "AD", "AG", "AM", "AU", "AT", "AZ", "BS", "BH", "BD", "BB", "BE", "BT", "BA", "BN", "BG", "BI", "CV", "CA", "CF", "CL", "CN", "KM", "CG", "CR", "HR", "CU", "CY", "CZ", "DK", "DJ", "DM", "DO", "EG", "EE", "SZ", "FJ", "FI", "FR", "GA", "GE", "DE", "GH", "GR", "GD", "GY", "HU", "IS", "IN", "IR", "IQ", "IE", "IT", "JM", "JP", "JO", "KZ", "KE", "KI", "KW", "KG", "LA", "LV", "LB", "LS", "LY", "LI", "LT", "LU", "MG", "MV", "ML", "MT", "MH", "MU", "FM", "MC", "MN", "ME", "MA", "NR", "NP", "NL", "NZ", "MK", "NO", "OM", "PW", "PS", "PG", "PH", "PL", "PT", "QA", "KR", "MD", "RO", "RW", "KN", "LC", "VC", "WS", "SM", "ST", "SA", "RS", "SC", "SG", "SK", "SI", "SB", "ZA", "SS", "ES", "LK", "SR", "SE", "CH", "SY", "TJ", "TH", "TL", "TG", "TO", "TT", "TN", "TR", "TM", "TV", "UA", "AE", "GB", "US", "UY", "UZ", "VU", "VN", "YE",
})
HIGH_RISK_COUNTRY_CODES = frozenset({"BY", "KP", "MM", "RU"})
STANDARD_RISK_COUNTRY_CODES = frozenset({
    "AO", "AR", "BZ", "BJ", "BO", "BW", "BR", "BF", "KH", "CM", "TD", "CO", "CI", "CD", "EC", "SV", "GQ", "ER", "ET", "GM", "GT", "GN", "GW", "HT", "HN", "ID", "IL", "LR", "MW", "MY", "MR", "MX", "MZ", "NA", "NI", "NE", "NG", "PK", "PA", "PY", "PE", "SN", "SL", "SO", "SD", "TZ", "UG", "VE", "ZM", "ZW",
})

# This country-code set is intentionally limited to entries verified against the
# 2025/1093 Annex. A code absent from it is returned as "unknown", not presumed low.
VERIFIED_BENCHMARK_COUNTRY_CODES = (
    LOW_RISK_COUNTRY_CODES | HIGH_RISK_COUNTRY_CODES | STANDARD_RISK_COUNTRY_CODES
)


def classify_country(country_code: str | None) -> dict[str, Any]:
    code = (country_code or "").strip().upper()
    base = {
        "country_code": code or None,
        "benchmark_version": COUNTRY_BENCHMARK_VERSION,
        "source_celex": COUNTRY_BENCHMARK_CELEX,
        "source_url": COUNTRY_BENCHMARK_SOURCE,
        "is_legal_decision": False,
    }
    if len(code) != 2 or not code.isascii() or not code.isalpha():
        return {**base, "level": "unknown", "reason": "Code pays absent ou mal formé; vérifier le code ISO alpha-2."}
    if code in LOW_RISK_COUNTRY_CODES:
        return {**base, "level": "low", "reason": "Pays listé à faible risque dans l'annexe du règlement 2025/1093."}
    if code in HIGH_RISK_COUNTRY_CODES:
        return {**base, "level": "high", "reason": "Pays listé à risque élevé dans l'annexe du règlement 2025/1093."}
    if code in STANDARD_RISK_COUNTRY_CODES:
        return {**base, "level": "standard", "reason": "Pays listé au niveau de risque standard dans l'annexe du règlement 2025/1093."}
    return {**base, "level": "unknown", "reason": "Code absent du jeu de références vérifié; ne pas inférer un niveau standard sans vérification."}


PRODUCT_SCOPE_VERSION = "EUDR-ANNEX-I-2026-09-18"
PRODUCT_SCOPE_SOURCE_CELEX = "32026R2102"
PRODUCT_SCOPE_SOURCE_URL = "https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj"
BASE_EUDR_SOURCE_CELEX = "32023R1115"
BASE_EUDR_SOURCE_URL = "https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:02023R1115-20251226"
PRODUCT_SCOPE_NOTE = (
    "Catalogue indicatif de codes de l'annexe I. Un code marqué « ex » ne couvre qu'une partie "
    "de la position: espèce, composition, usage, état neuf/usagé, déchet, emballage et autres "
    "qualificateurs doivent être vérifiés sur le produit réel. Un code non trouvé n'établit pas "
    "une exclusion du champ. Référence de préparation interne uniquement, sans format ou envoi EUDR officiel."
)

# Each entry is a candidate reference, not an automatic in/out-of-scope ruling.
# `code` contains digits only; `is_ex` preserves the crucial "ex" qualifier.
# Codes added by Regulation 2026/2102 with delayed application are dated 2027-12-30.
# The general EUDR application date depends on actor category; it is disclosed below,
# not used here to make an automated legal decision.
_RAW_SCOPE: tuple[tuple[str, str, bool, str, str | None], ...] = (
    # Cattle: Regulation 2026/2102, cattle species note; former leather headings 4101/4104/4107 removed.
    ("cattle", "0102", True, "Bovins vivants; seulement genre Bos et sous-genres visés (buffles et bisons exclus).", None),
    ("cattle", "0201", True, "Viandes de bovins, fraîches ou réfrigérées.", None),
    ("cattle", "0202", True, "Viandes de bovins, congelées.", None),
    ("cattle", "020610", True, "Abats comestibles de bovins, frais ou réfrigérés.", None),
    ("cattle", "02062100", True, "Langues de bovins congelées.", "2027-12-30"),
    ("cattle", "020622", True, "Foies comestibles de bovins, congelés.", None),
    ("cattle", "020629", True, "Autres abats comestibles de bovins, congelés (hors langues et foies).", None),
    ("cattle", "160250", True, "Préparations et conserves de viande, d'abats ou de sang de bovins.", None),
    # Cocoa / coffee.
    ("cocoa", "1801", False, "Fèves et brisures de fèves de cacao, brutes ou torréfiées.", None),
    ("cocoa", "1802", False, "Coques, pellicules et autres déchets de cacao; déchets au sens de la directive 2008/98 exclus.", None),
    ("cocoa", "1803", False, "Pâte de cacao, même dégraissée.", None),
    ("cocoa", "1804", False, "Beurre, graisse et huile de cacao.", None),
    ("cocoa", "1805", False, "Poudre de cacao sans sucre ni autre édulcorant.", None),
    ("cocoa", "1806", False, "Chocolat et autres préparations alimentaires contenant du cacao.", None),
    ("coffee", "0901", False, "Café, coques/pellicules et succédanés contenant du café.", None),
    ("coffee", "21011100", False, "Extraits, essences et concentrés de café (application différée).", "2027-12-30"),
    # Oil palm: species/medicinal/waste qualifications apply as stated in the Annex.
    ("palm_oil", "12071000", True, "Noix et amandes de palmiste; huile de palme Elaeis spp. uniquement.", None),
    ("palm_oil", "1511", True, "Huile de palme et fractions; hors déchets; huile issue d'Elaeis spp.", None),
    ("palm_oil", "151321", True, "Huiles brutes de palmiste/babassu et fractions; espèce/source à vérifier; hors déchets.", None),
    ("palm_oil", "151329", True, "Huiles de palmiste/babassu non brutes et fractions; espèce/source à vérifier; hors déchets.", None),
    ("palm_oil", "151620", True, "Huiles végétales hydrogénées/inter-estérifiées/ré-estérifiées/élaïdinisées; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "151800", True, "Huiles/fractions chimiquement modifiées ou mélanges contenant/utilisant de l'huile de palme; hors déchets; application différée.", "2027-12-30"),
    ("palm_oil", "152000", True, "Glycérol brut, eaux et lessives glycérineuses issus du palmier à huile; application différée.", "2027-12-30"),
    ("palm_oil", "23066000", True, "Tourteaux/résidus de noix ou amandes de palmiste; hors déchets; source botanique à vérifier.", None),
    ("palm_oil", "290516", True, "Octanol et isomères synthétisés à partir de palmier à huile; application différée.", "2027-12-30"),
    ("palm_oil", "29051700", True, "Alcools laurique, cétylique et stéarylique synthétisés à partir de palmier; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "29051900", True, "Autres alcools monohydriques saturés synthétisés à partir de palmier; application différée.", "2027-12-30"),
    ("palm_oil", "290545", True, "Glycérol ≥95 %, synthétisé à partir de palmier; exclusions médicinales.", None),
    ("palm_oil", "291539", True, "Esters d'acide acétique visés, synthétisés à partir de palmier; application différée.", "2027-12-30"),
    ("palm_oil", "291570", True, "Acides palmitique/stéarique, sels/esters synthétisés à partir de palmier; exclusions médicinales.", None),
    ("palm_oil", "291590", True, "Acides monocarboxyliques saturés et dérivés définis, synthétisés à partir de palmier; exclusions médicinales.", None),
    ("palm_oil", "291615", True, "Acides oléique/linoléique/linolénique, sels/esters issus du palmier; application différée.", "2027-12-30"),
    ("palm_oil", "29161910", True, "Acides undécyléniques, sels/esters issus du palmier; application différée.", "2027-12-30"),
    ("palm_oil", "292119", True, "Monoamines acycliques et dérivés visés, synthétisés à partir de palmier; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "29239000", True, "Sels d'ammonium quaternaire visés, issus du palmier; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "29241900", True, "Amides/carbamates acycliques visés, synthétisés à partir de palmier; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "34011100", True, "Savon en barres/formes pour toilette, contenant/produit avec huile de palme; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "340120", True, "Savon sous autres formes contenant/produit avec huile de palme; application différée.", "2027-12-30"),
    ("palm_oil", "38231100", True, "Acide stéarique industriel synthétisé à partir de palmier; exclusions médicinales.", None),
    ("palm_oil", "38231200", True, "Acide oléique industriel synthétisé à partir de palmier; exclusions médicinales.", None),
    ("palm_oil", "382319", True, "Acides gras industriels et huiles acides de raffinage visés, issus du palmier; hors déchets.", None),
    ("palm_oil", "38237000", True, "Alcools gras industriels synthétisés à partir de palmier.", None),
    ("palm_oil", "382499", True, "Produits/préparations chimiques contenant ou fabriqués avec huile de palme; exclusions médicinales; application différée.", "2027-12-30"),
    ("palm_oil", "390729", True, "Autres polyéthers visés, fabriqués avec huile de palme; exclusions médicinales; application différée.", "2027-12-30"),
    # Rubber: only Hevea brasiliensis; specified used/second-hand/waste exclusions apply.
    ("rubber", "4001", True, "Caoutchouc naturel; uniquement Hevea brasiliensis (autres gommes naturelles exclues).", None),
    ("rubber", "4005", True, "Caoutchouc mélangé non vulcanisé.", None),
    ("rubber", "4006", True, "Caoutchouc non vulcanisé sous autres formes et articles.", None),
    ("rubber", "4007", True, "Fils et cordes de caoutchouc vulcanisé.", None),
    ("rubber", "4008", True, "Plaques, feuilles, bandes, baguettes et profilés en caoutchouc vulcanisé non durci; exclusions usagé/seconde main.", None),
    ("rubber", "4011", True, "Pneumatiques neufs en caoutchouc.", None),
    ("rubber", "40129030", True, "Bandes de roulement neuves pour pneumatiques (rechapage); entrée remplacée par 4012 90 30.", None),
    ("rubber", "4013", True, "Chambres à air en caoutchouc.", None),
    ("rubber", "4015", True, "Vêtements et accessoires en caoutchouc vulcanisé non durci; exclusions usagé/seconde main.", None),
    ("rubber", "4017", True, "Caoutchouc durci et ouvrages; hors déchets/usagé/seconde main.", None),
    # Soy: sowing seeds excluded by narrowed CN code.
    ("soy", "12019000", False, "Fèves de soja: autres; le code remplacé limite le champ et ne comprend pas les semences destinées aux semis.", None),
    ("soy", "120810", False, "Farine de fèves de soja.", None),
    ("soy", "1507", False, "Huile de soja et fractions, non chimiquement modifiées.", None),
    ("soy", "2304", False, "Tourteaux et autres résidus solides de l'extraction de l'huile de soja.", None),
    # Wood: ex headings, with bamboo/rattan/other woody materials excluded by the species/material note.
    ("wood", "4401", True, "Bois de chauffage, plaquettes, sciures/déchets; hors déchets réglementaires et certains emballages à usage unique.", None),
    ("wood", "4402", True, "Charbon de bois.", None),
    ("wood", "4403", True, "Bois bruts; hors produits usagés/seconde main.", None),
    ("wood", "4404", True, "Bois feuillards, échalas, pieux, bois dégrossis et éclisses; exclusions usagé/seconde main.", None),
    ("wood", "4405", True, "Laine/farine de bois; exclusion de certains emballages à usage unique.", None),
    ("wood", "4406", True, "Traverses en bois; hors produits usagés/seconde main.", None),
    ("wood", "4407", True, "Bois sciés/tranchés/déroulés d'épaisseur > 6 mm; hors produits usagés/seconde main.", None),
    ("wood", "4408", True, "Feuilles pour placage et bois d'épaisseur ≤ 6 mm.", None),
    ("wood", "4409", True, "Bois profilés; hors produits usagés/seconde main.", None),
    ("wood", "4410", True, "Panneaux de particules/OSB; hors produits usagés/seconde main.", None),
    ("wood", "4411", True, "Panneaux de fibres; hors produits usagés/seconde main.", None),
    ("wood", "4412", True, "Contreplaqués et bois stratifiés; hors produits usagés/seconde main.", None),
    ("wood", "4413", True, "Bois densifiés; hors produits usagés/seconde main.", None),
    ("wood", "4414", True, "Cadres en bois; hors produits usagés/seconde main.", None),
    ("wood", "4415", True, "Emballages/palettes en bois; exclusions spécifiques aux emballages utilisés pour porter un autre produit.", None),
    ("wood", "4416", True, "Tonnellerie en bois; exclusions spécifiques aux emballages et produits usagés.", None),
    ("wood", "4417", True, "Outils/manches et articles similaires en bois; hors produits usagés/seconde main.", None),
    ("wood", "4418", True, "Menuiserie/charpente en bois; hors produits usagés/seconde main.", None),
    ("wood", "4419", True, "Articles de table/cuisine en bois; hors produits usagés/seconde main.", None),
    ("wood", "4420", True, "Marqueterie, coffrets, ornements et meubles en bois hors chap. 94; hors produits usagés/seconde main.", None),
    ("wood", "4421", True, "Autres ouvrages en bois; hors produits usagés/seconde main.", None),
    ("wood", "47", True, "Pâtes de bois; hors produits usagés, récupérés/recyclés et dérivés de matières récupérées.", None),
    ("wood", "48", True, "Papier/carton et articles; exclusions déchets, usagé, récupéré, emballages, correspondance et supports marketing prévues à l'annexe.", None),
    ("wood", "94013100", True, "Sièges pivotants réglables en hauteur, en bois; hors produits usagés/seconde main.", None),
    ("wood", "94014100", True, "Sièges convertibles en lits, en bois (hors sièges de jardin/camping); hors usagé/seconde main.", None),
    ("wood", "94016100", True, "Autres sièges à structure en bois, rembourrés; hors usagé/seconde main.", None),
    ("wood", "94016900", True, "Autres sièges à structure en bois, non rembourrés; hors usagé/seconde main.", None),
    ("wood", "94018000", True, "Autres sièges en bois; hors usagé/seconde main.", None),
    ("wood", "94019190", True, "Autres parties de sièges en bois; hors usagé/seconde main.", None),
    ("wood", "940330", True, "Meubles de bureau en bois et parties; hors usagé/seconde main.", None),
    ("wood", "940340", True, "Meubles de cuisine en bois et parties; hors usagé/seconde main.", None),
    ("wood", "940350", True, "Meubles de chambre à coucher en bois et parties; hors usagé/seconde main.", None),
    ("wood", "940360", True, "Autres meubles en bois et parties; hors usagé/seconde main.", None),
    ("wood", "940391", True, "Parties de meubles en bois; hors usagé/seconde main.", None),
    ("wood", "94061000", True, "Constructions préfabriquées en bois; hors usagé/seconde main.", None),
)

COMMODITY_ALIASES = {
    "cattle": "cattle",
    "cocoa": "cocoa",
    "cocoa_prep": "cocoa",
    "coffee": "coffee",
    "palm_oil": "palm_oil",
    "palm_kernel": "palm_oil",
    "rubber": "rubber",
    "rubber_products": "rubber",
    "soy": "soy",
    "wood": "wood",
    "wood_chips": "wood",
    "charcoal": "wood",
    "pulp": "wood",
    "paper": "wood",
    "furniture": "wood",
}

PRODUCT_SCOPE_CATALOG: tuple[dict[str, Any], ...] = tuple(
    {
        "commodity": commodity,
        "code": code,
        "code_system": "CN/HS (référence Annex I)",
        "is_ex": is_ex,
        "description": description,
        "applies_from": date.fromisoformat(applies_from) if applies_from else None,
        "source_celex": PRODUCT_SCOPE_SOURCE_CELEX,
        "review_required": True,
    }
    for commodity, code, is_ex, description, applies_from in _RAW_SCOPE
)


def product_scope_candidates(commodity: str | None, product_code: str | None) -> list[dict[str, Any]]:
    """Return candidate references only; never return an in/out-of-scope verdict."""
    normalized_commodity = COMMODITY_ALIASES.get((commodity or "").strip().lower())
    code = "".join(ch for ch in (product_code or "") if ch.isdigit())
    if not normalized_commodity or not code:
        return []
    rows: list[dict[str, Any]] = []
    for entry in PRODUCT_SCOPE_CATALOG:
        if entry["commodity"] != normalized_commodity:
            continue
        reference_code = entry["code"]
        if code == reference_code:
            match_kind = "exact"
        elif code.startswith(reference_code) or reference_code.startswith(code):
            match_kind = "prefix_candidate"
        else:
            continue
        rows.append({**entry, "applies_from": entry["applies_from"].isoformat() if entry["applies_from"] else None, "match_kind": match_kind})
    return rows


RISK_CRITERIA: tuple[dict[str, str], ...] = (
    {"code": "country_risk", "label": "Risque attribué au pays ou à la partie de pays de production (art. 29)."},
    {"code": "forest_presence", "label": "Présence de forêts dans le pays ou la partie de pays concerné(e)."},
    {"code": "indigenous_peoples", "label": "Présence et droits des peuples autochtones, le cas échéant."},
    {"code": "consultation_and_claims", "label": "Consultation, coopération de bonne foi, réclamations foncières et différends dûment motivés."},
    {"code": "deforestation_prevalence", "label": "Prévalence de la déforestation ou de la dégradation forestière dans la zone de production."},
    {"code": "source_reliability", "label": "Fiabilité, validité et cohérence des informations visées à l'article 9."},
    {"code": "corruption", "label": "Corruption et prévalence de la falsification de documents ou de données dans le secteur/pays concerné."},
    {"code": "law_enforcement", "label": "Application effective du droit, transparence et capacité de contrôle des autorités compétentes."},
    {"code": "human_rights", "label": "Violations des droits humains, des droits des peuples autochtones et des droits du travail liés à la production."},
    {"code": "armed_conflict", "label": "Présence de conflits armés ou de tensions susceptibles d'affecter la traçabilité ou la légalité."},
    {"code": "sanctions", "label": "Sanctions applicables et restrictions pertinentes pour l'origine, les acteurs ou la chaîne."},
    {"code": "supply_chain_complexity", "label": "Complexité de la chaîne et difficulté de relier le produit aux parcelles/établissements."},
    {"code": "mixing_and_circumvention", "label": "Risque de contournement ou de mélange avec des produits d'origine inconnue ou à risque."},
    {"code": "expert_group_conclusions", "label": "Conclusions pertinentes du groupe d'experts de la Commission et sources institutionnelles vérifiées."},
    {"code": "prior_non_compliance", "label": "Historique documenté de non-conformité ou d'irrégularités dans la chaîne concernée."},
    {"code": "substantiated_concerns", "label": "Informations disponibles sur des préoccupations dûment motivées et autres informations pertinentes."},
    {"code": "certification_and_assurance", "label": "Informations complémentaires, notamment certification ou autres vérifications tierces (sans substitution à la DDR)."},
    {"code": "legality_context", "label": "Contexte de légalité de la production dans le pays/zone concerné(e)."},
    {"code": "other", "label": "Autre facteur documenté, avec justification."},
)


def reference_manifest() -> dict[str, Any]:
    return {
        "country_benchmark": {
            "version": COUNTRY_BENCHMARK_VERSION,
            "source_celex": COUNTRY_BENCHMARK_CELEX,
            "source_url": COUNTRY_BENCHMARK_SOURCE,
            "low_risk_count": len(LOW_RISK_COUNTRY_CODES),
            "standard_risk_count": len(STANDARD_RISK_COUNTRY_CODES),
            "high_risk_count": len(HIGH_RISK_COUNTRY_CODES),
            "low_risk_codes": sorted(LOW_RISK_COUNTRY_CODES),
            "standard_risk_codes": sorted(STANDARD_RISK_COUNTRY_CODES),
            "high_risk_codes": sorted(HIGH_RISK_COUNTRY_CODES),
        },
        "product_scope": {
            "version": PRODUCT_SCOPE_VERSION,
            "base_source_celex": BASE_EUDR_SOURCE_CELEX,
            "base_source_url": BASE_EUDR_SOURCE_URL,
            "amendment_source_celex": PRODUCT_SCOPE_SOURCE_CELEX,
            "amendment_source_url": PRODUCT_SCOPE_SOURCE_URL,
            "entry_count": len(PRODUCT_SCOPE_CATALOG),
            "application_large_operators_from": "2026-12-30",
            "application_micro_small_operators_from": "2027-06-30",
            "scheduled_product_additions_from": "2027-12-30",
            "note": PRODUCT_SCOPE_NOTE,
        },
        "risk_criteria": list(RISK_CRITERIA),
        "due_diligence_route_note": "Une route simplifiée fondée sur l'article 13 n'est qu'une possibilité à confirmer par un humain; la complexité et le risque de contournement/mélange doivent rester appréciés. Une absence de signal ne vaut pas conformité.",
        "declaration_note": "La génération est une préparation interne de données; aucun connecteur EUDR-IS ni soumission officielle n'est implémenté. La voie de déclaration simplifiée distincte de l'article 4 bis et son éligibilité ne sont pas automatisées. Statut maximum: Préparé pour déclaration.",
    }
