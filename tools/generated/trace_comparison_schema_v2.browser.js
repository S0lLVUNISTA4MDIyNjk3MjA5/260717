/* AUTO-GENERATED from tools/design_notes/trace_comparison_schema_v2.json.
 * Run: node tools/design_notes/generate_trace_comparison_browser_schema.js
 */
(function(root, factory) {
  const schema = factory();
  if (typeof module === 'object' && module.exports) module.exports = schema;
  if (root) root.TraceComparisonSchemaV2 = schema;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  return {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "trace-comparison/1.0-rc2",
  "title": "trace-comparison/1.0-rc2",
  "description": "generateTraceComparisonRecordSet()(quantity_sidecar_binding_core.js Phase B-3b)が返す{ready,result_complete,diagnostics,record_set}のうち、record_setだけを検証対象にする(runtime envelope自体はSchema対象外、trace_comparison_record_set_validator.jsへ渡す前にrecord_setを取り出すこと)。設計根拠はshadow_mode_integration_design.md 3.4節を参照。$defs.analysis/quantityRecord/intervalBound/evidenceItem/ruleset_versionはquantity_annotation_schema_v1.jsonの同名定義を複製したもの(analysisはcontent_hash必須フィールドを追加、他は同一。乖離はtrace_comparison_schema_drift_check.jsが検査する)。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "generated_at",
    "generator",
    "source",
    "provenance",
    "display_context",
    "diagnostics",
    "not_analyzed",
    "comparisons"
  ],
  "properties": {
    "schema_version": {
      "const": "trace-comparison/1.0-rc2"
    },
    "generated_at": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
    },
    "generator": {
      "$ref": "#/$defs/generator"
    },
    "source": {
      "$ref": "#/$defs/source"
    },
    "provenance": {
      "$ref": "#/$defs/provenance"
    },
    "display_context": {
      "$ref": "#/$defs/displayContext"
    },
    "diagnostics": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/diagnosticItem"
      }
    },
    "not_analyzed": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/notAnalyzedItem"
      }
    },
    "comparisons": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/comparisonRecord"
      }
    }
  },
  "$defs": {
    "generator": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "version"
      ],
      "properties": {
        "tool": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirement_trace_file",
        "actual_trace_file"
      ],
      "properties": {
        "requirement_trace_file": {
          "type": "string",
          "minLength": 1
        },
        "actual_trace_file": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "idContracts": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "quantity_id",
        "quantity_pair_id",
        "comparison_id"
      ],
      "properties": {
        "quantity_id": {
          "const": "SHA-256/128"
        },
        "quantity_pair_id": {
          "const": "quantity-id-double-colon-v1"
        },
        "comparison_id": {
          "const": "utf8-netstring-v1"
        }
      }
    },
    "provenance": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "hash_algorithm",
        "id_hash_algorithm",
        "id_contracts",
        "normalization",
        "requirement_dataset_signature",
        "actual_dataset_signature",
        "ruleset_version"
      ],
      "properties": {
        "hash_algorithm": {
          "const": "SHA-256"
        },
        "id_hash_algorithm": {
          "const": "SHA-256/128"
        },
        "id_contracts": {
          "$ref": "#/$defs/idContracts"
        },
        "normalization": {
          "const": "v12-normalize-v1"
        },
        "requirement_dataset_signature": {
          "type": "string",
          "pattern": "^QA-SHA256:[0-9a-f]{64}$"
        },
        "actual_dataset_signature": {
          "type": "string",
          "pattern": "^QA-SHA256:[0-9a-f]{64}$"
        },
        "ruleset_version": {
          "$ref": "#/$defs/ruleset_version"
        }
      }
    },
    "displayContext": {
      "type": [
        "object",
        "null"
      ],
      "additionalProperties": false,
      "required": [
        "matching_dataset_signature"
      ],
      "properties": {
        "matching_dataset_signature": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "diagnosticItem": {
      "type": "object",
      "required": [
        "code",
        "severity"
      ]
    },
    "notAnalyzedItem": {
      "type": "object",
      "required": [
        "reason_code"
      ]
    },
    "comparisonRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "comparison_id",
        "quantity_pair_id",
        "requirement_ref",
        "actual_ref",
        "relationship",
        "requirement_analysis",
        "actual_analysis",
        "mapping",
        "comparison_input",
        "numeric_comparison",
        "auto_applicability",
        "automatic_judgement",
        "review"
      ],
      "properties": {
        "comparison_id": {
          "type": "string",
          "pattern": "^cmp-v1:"
        },
        "quantity_pair_id": {
          "type": "string",
          "pattern": "^q-[0-9a-f]{32}::q-[0-9a-f]{32}$"
        },
        "requirement_ref": {
          "$ref": "#/$defs/requirementRef"
        },
        "actual_ref": {
          "$ref": "#/$defs/actualRef"
        },
        "relationship": {
          "$ref": "#/$defs/relationship"
        },
        "requirement_analysis": {
          "$ref": "#/$defs/analysis"
        },
        "actual_analysis": {
          "$ref": "#/$defs/analysis"
        },
        "mapping": {
          "$ref": "#/$defs/mapping"
        },
        "comparison_input": {
          "$ref": "#/$defs/comparisonInput"
        },
        "numeric_comparison": {
          "$ref": "#/$defs/numericComparison"
        },
        "auto_applicability": {
          "$ref": "#/$defs/autoApplicability"
        },
        "automatic_judgement": {
          "$ref": "#/$defs/automaticJudgement"
        },
        "review": {
          "$ref": "#/$defs/review"
        }
      }
    },
    "requirementRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "trace_id",
        "matcher_id",
        "quantity_id"
      ],
      "properties": {
        "trace_id": {
          "type": "string",
          "minLength": 1
        },
        "matcher_id": {
          "type": "string",
          "minLength": 1
        },
        "quantity_id": {
          "type": "string",
          "pattern": "^q-[0-9a-f]{32}$"
        }
      }
    },
    "actualRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "trace_id",
        "matcher_id",
        "quantity_id"
      ],
      "properties": {
        "trace_id": {
          "type": "string",
          "minLength": 1
        },
        "matcher_id": {
          "type": "string",
          "minLength": 1
        },
        "quantity_id": {
          "type": "string",
          "pattern": "^q-[0-9a-f]{32}$"
        },
        "source_row": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "relationship": {
      "description": "sourceで判別可能な共用体。matching_engineはmatch_method/match_confidence/review_categoryが必須(非null)、manualはこの3項目がnull許容(reviewer確定方針)。linked_atはどちらのsourceでもnull許容。",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "source",
            "match_method",
            "match_confidence",
            "review_category",
            "linked_at"
          ],
          "properties": {
            "source": {
              "const": "matching_engine"
            },
            "match_method": {
              "type": "string",
              "minLength": 1
            },
            "match_confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "review_category": {
              "type": "string",
              "minLength": 1
            },
            "linked_at": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "source",
            "match_method",
            "match_confidence",
            "review_category",
            "linked_at"
          ],
          "properties": {
            "source": {
              "const": "manual"
            },
            "match_method": {
              "type": [
                "string",
                "null"
              ],
              "minLength": 1
            },
            "match_confidence": {
              "type": [
                "number",
                "null"
              ],
              "minimum": 0,
              "maximum": 1
            },
            "review_category": {
              "type": [
                "string",
                "null"
              ],
              "minLength": 1
            },
            "linked_at": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
            }
          }
        }
      ]
    },
    "mapping": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "selected_concept_id",
        "dimension",
        "requirement_resolution",
        "actual_resolution"
      ],
      "properties": {
        "status": {
          "const": "resolved"
        },
        "selected_concept_id": {
          "type": "string",
          "minLength": 1
        },
        "dimension": {
          "type": "string",
          "minLength": 1
        },
        "requirement_resolution": {
          "$ref": "#/$defs/propertyResolution"
        },
        "actual_resolution": {
          "$ref": "#/$defs/propertyResolution"
        }
      }
    },
    "propertyResolution": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "concept_id",
        "top_confidence",
        "margin",
        "candidates",
        "source"
      ],
      "properties": {
        "status": {
          "const": "resolved"
        },
        "concept_id": {
          "type": "string",
          "minLength": 1
        },
        "top_confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "margin": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "candidates": {
          "description": "非空・confidence降順・先頭がselected_concept_idと一致、という制約はminItems/順序検査に未対応の簡易validatorでは表現できないためsemantic validatorが検査する。",
          "type": "array",
          "items": {
            "$ref": "#/$defs/propertyCandidate"
          }
        },
        "source": {
          "const": "generatePropertyResolutions"
        }
      }
    },
    "propertyCandidate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "concept_id",
        "label",
        "confidence",
        "evidence"
      ],
      "properties": {
        "concept_id": {
          "type": "string",
          "minLength": 1
        },
        "label": {
          "type": "string",
          "minLength": 1
        },
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "evidence": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "comparisonInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirement_quantity_value",
        "actual_quantity_value_original",
        "actual_quantity_value_normalized",
        "unit_conversion_plan",
        "interval_semantics_resolution",
        "comparison_mode"
      ],
      "properties": {
        "requirement_quantity_value": {
          "$ref": "#/$defs/intervalOnlyQuantityValue"
        },
        "actual_quantity_value_original": {
          "$ref": "#/$defs/intervalOnlyQuantityValue"
        },
        "actual_quantity_value_normalized": {
          "$ref": "#/$defs/intervalOnlyQuantityValue"
        },
        "unit_conversion_plan": {
          "$ref": "#/$defs/unitConversionPlan"
        },
        "interval_semantics_resolution": {
          "$ref": "#/$defs/intervalSemanticsResolution"
        },
        "comparison_mode": {
          "$ref": "#/$defs/comparisonModeInput"
        }
      }
    },
    "intervalOnlyQuantityValue": {
      "description": "quantityRecord.quantityのinterval|alternatives共用体のうち、B-2.5がalternativesを常にnot_analyzedへ送るため、comparisons[]へ到達する数量値はinterval形のみ(reviewer確定方針)。quantityRecordとは別定義にし、interval以外を明示的に拒否する。",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "lower",
        "upper"
      ],
      "properties": {
        "kind": {
          "const": "interval"
        },
        "lower": {
          "$ref": "#/$defs/intervalBound"
        },
        "upper": {
          "$ref": "#/$defs/intervalBound"
        }
      }
    },
    "unitConversionPlan": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "conversion_required",
            "conversion_operation",
            "source_unit",
            "target_unit",
            "factor",
            "offset"
          ],
          "properties": {
            "conversion_required": {
              "const": false
            },
            "conversion_operation": {
              "const": "identity"
            },
            "source_unit": {
              "type": "string",
              "minLength": 1
            },
            "target_unit": {
              "type": "string",
              "minLength": 1
            },
            "factor": {
              "const": 1
            },
            "offset": {
              "const": 0
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "conversion_required",
            "conversion_operation",
            "source_side",
            "source_canonical_unit",
            "target_side",
            "target_canonical_unit",
            "dimension",
            "factor",
            "offset"
          ],
          "properties": {
            "conversion_required": {
              "const": true
            },
            "conversion_operation": {
              "const": "linear_scale"
            },
            "source_side": {
              "const": "actual"
            },
            "source_canonical_unit": {
              "type": "string",
              "minLength": 1
            },
            "target_side": {
              "const": "requirement"
            },
            "target_canonical_unit": {
              "type": "string",
              "minLength": 1
            },
            "dimension": {
              "type": "string",
              "minLength": 1
            },
            "factor": {
              "type": "number"
            },
            "offset": {
              "const": 0
            }
          }
        }
      ]
    },
    "intervalSemanticsResolution": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirement",
        "actual"
      ],
      "properties": {
        "requirement": {
          "$ref": "#/$defs/intervalSemanticsSide"
        },
        "actual": {
          "$ref": "#/$defs/intervalSemanticsSide"
        }
      }
    },
    "intervalSemanticsSide": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "value",
        "top_confidence",
        "margin",
        "has_opposing_evidence"
      ],
      "properties": {
        "status": {
          "const": "resolved"
        },
        "value": {
          "type": "string",
          "minLength": 1
        },
        "top_confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "margin": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "has_opposing_evidence": {
          "type": "boolean"
        }
      }
    },
    "comparisonModeInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "value",
        "confidence",
        "derived_from"
      ],
      "properties": {
        "value": {
          "enum": [
            "point_in_region",
            "actual_covers_requirement",
            "requirement_covers_actual"
          ]
        },
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "derived_from": {
          "$ref": "#/$defs/derivedFrom"
        }
      }
    },
    "derivedFrom": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirement_condition_value",
        "actual_condition_value"
      ],
      "properties": {
        "requirement_condition_value": {
          "type": "string",
          "minLength": 1
        },
        "actual_condition_value": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "numericComparison": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "comparison_mode",
        "relation_type",
        "outer_side",
        "inner_side",
        "geometric_relation_holds",
        "lower_check",
        "upper_check",
        "signed_boundary_deltas"
      ],
      "properties": {
        "comparison_mode": {
          "enum": [
            "point_in_region",
            "actual_covers_requirement",
            "requirement_covers_actual"
          ]
        },
        "relation_type": {
          "enum": [
            "point_in_region",
            "outer_covers_inner"
          ]
        },
        "outer_side": {
          "enum": [
            "requirement",
            "actual",
            null
          ]
        },
        "inner_side": {
          "enum": [
            "requirement",
            "actual",
            null
          ]
        },
        "geometric_relation_holds": {
          "type": "boolean"
        },
        "lower_check": {
          "$ref": "#/$defs/boundaryCheck"
        },
        "upper_check": {
          "$ref": "#/$defs/boundaryCheck"
        },
        "signed_boundary_deltas": {
          "$ref": "#/$defs/signedBoundaryDeltas"
        }
      }
    },
    "boundaryCheck": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "holds",
        "boundary_mismatch"
      ],
      "properties": {
        "holds": {
          "type": "boolean"
        },
        "boundary_mismatch": {
          "type": "boolean"
        }
      }
    },
    "signedBoundaryDeltas": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "lower_actual_minus_requirement",
        "upper_requirement_minus_actual"
      ],
      "properties": {
        "lower_actual_minus_requirement": {
          "type": [
            "number",
            "null"
          ]
        },
        "upper_requirement_minus_actual": {
          "type": [
            "number",
            "null"
          ]
        }
      }
    },
    "autoApplicability": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "auto_applicable",
        "basis"
      ],
      "properties": {
        "auto_applicable": {
          "type": "boolean"
        },
        "basis": {
          "$ref": "#/$defs/autoApplicabilityBasis"
        }
      }
    },
    "autoApplicabilityBasis": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirement_extraction_warnings_count",
        "actual_extraction_warnings_count",
        "extraction_warnings_count",
        "extraction_warnings_absent",
        "comparison_mode_confidence",
        "comparison_mode_confidence_meets_threshold",
        "requirement_condition_margin",
        "requirement_condition_margin_meets_threshold",
        "actual_condition_margin",
        "actual_condition_margin_meets_threshold",
        "requirement_condition_has_opposing_evidence",
        "actual_condition_has_opposing_evidence",
        "opposing_evidence_absent",
        "requirement_property_top_confidence",
        "actual_property_top_confidence",
        "property_confidence",
        "property_confidence_meets_threshold"
      ],
      "properties": {
        "requirement_extraction_warnings_count": {
          "type": "integer",
          "minimum": 0
        },
        "actual_extraction_warnings_count": {
          "type": "integer",
          "minimum": 0
        },
        "extraction_warnings_count": {
          "type": "integer",
          "minimum": 0
        },
        "extraction_warnings_absent": {
          "type": "boolean"
        },
        "comparison_mode_confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "comparison_mode_confidence_meets_threshold": {
          "type": "boolean"
        },
        "requirement_condition_margin": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "requirement_condition_margin_meets_threshold": {
          "type": "boolean"
        },
        "actual_condition_margin": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "actual_condition_margin_meets_threshold": {
          "type": "boolean"
        },
        "requirement_condition_has_opposing_evidence": {
          "type": "boolean"
        },
        "actual_condition_has_opposing_evidence": {
          "type": "boolean"
        },
        "opposing_evidence_absent": {
          "type": "boolean"
        },
        "requirement_property_top_confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "actual_property_top_confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "property_confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "property_confidence_meets_threshold": {
          "type": "boolean"
        }
      }
    },
    "automaticJudgement": {
      "description": "state/satisfied/judgement_source/human_confirmedの相関を、3状態排他のoneOf(各分岐additionalProperties:false・全4フィールドconst)で固定する(reviewer確定方針)。",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "state",
            "satisfied",
            "judgement_source",
            "human_confirmed"
          ],
          "properties": {
            "state": {
              "const": "satisfied"
            },
            "satisfied": {
              "const": true
            },
            "judgement_source": {
              "const": "automatic_pipeline"
            },
            "human_confirmed": {
              "const": false
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "state",
            "satisfied",
            "judgement_source",
            "human_confirmed"
          ],
          "properties": {
            "state": {
              "const": "not_satisfied"
            },
            "satisfied": {
              "const": false
            },
            "judgement_source": {
              "const": "automatic_pipeline"
            },
            "human_confirmed": {
              "const": false
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "state",
            "satisfied",
            "judgement_source",
            "human_confirmed"
          ],
          "properties": {
            "state": {
              "const": "needs_confirmation"
            },
            "satisfied": {
              "const": null
            },
            "judgement_source": {
              "const": "automatic_pipeline"
            },
            "human_confirmed": {
              "const": false
            }
          }
        }
      ]
    },
    "review": {
      "description": "B-3生成時点の初期状態のみを表す(B-4の人間確認後の状態は未設計。将来のreview状態拡張はrc3等の新schema versionまたは明示的な拡張機構で行い、rc2をここで暗黙に広げない、reviewer確定方針)。",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "quantity_extraction",
        "property_mapping",
        "interval_semantics",
        "comparison_mode",
        "satisfaction"
      ],
      "properties": {
        "quantity_extraction": {
          "$ref": "#/$defs/reviewTargetInitialUnreviewed"
        },
        "property_mapping": {
          "$ref": "#/$defs/reviewTargetInitialUnreviewed"
        },
        "interval_semantics": {
          "$ref": "#/$defs/reviewTargetInitialUnreviewed"
        },
        "comparison_mode": {
          "$ref": "#/$defs/reviewTargetInitialUnreviewed"
        },
        "satisfaction": {
          "$ref": "#/$defs/reviewTargetInitialNotEligible"
        }
      }
    },
    "reviewTargetInitialUnreviewed": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "reviewer",
        "reviewed_at",
        "verdict",
        "note"
      ],
      "properties": {
        "status": {
          "const": "unreviewed"
        },
        "reviewer": {
          "const": null
        },
        "reviewed_at": {
          "const": null
        },
        "verdict": {
          "const": null
        },
        "note": {
          "const": null
        }
      }
    },
    "reviewTargetInitialNotEligible": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "reviewer",
        "reviewed_at",
        "verdict",
        "note"
      ],
      "properties": {
        "status": {
          "const": "not_eligible"
        },
        "reviewer": {
          "const": null
        },
        "reviewed_at": {
          "const": null
        },
        "verdict": {
          "const": null
        },
        "note": {
          "const": null
        }
      }
    },
    "ruleset_version": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "quantity_extraction",
        "semantics_rules",
        "auto_applicable_thresholds"
      ],
      "properties": {
        "quantity_extraction": {
          "type": "string",
          "minLength": 1
        },
        "semantics_rules": {
          "type": "string",
          "minLength": 1
        },
        "auto_applicable_thresholds": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "modeConfidence",
            "margin",
            "propertyConfidence"
          ],
          "properties": {
            "modeConfidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "margin": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "propertyConfidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            }
          }
        }
      }
    },
    "analysis": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "quantity_id",
        "source_field",
        "occurrence_index",
        "source_span",
        "normalized_text",
        "quantity",
        "interval_semantics_candidates",
        "content_hash"
      ],
      "properties": {
        "quantity_id": {
          "type": "string",
          "pattern": "^q-[0-9a-f]{32}$"
        },
        "source_field": {
          "type": "string",
          "minLength": 1
        },
        "occurrence_index": {
          "type": "integer",
          "minimum": 0
        },
        "source_span": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "start",
            "end"
          ],
          "properties": {
            "start": {
              "type": "integer",
              "minimum": 0
            },
            "end": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "normalized_text": {
          "type": "string"
        },
        "quantity": {
          "description": "quantity_extraction_prototype.js(extractQuantities()の1件、またはcondition_candidatesをv12NormalizeConditionAsRecord()で正規化した1件)の出力オブジェクト。抽出ロジック自体の細部(単位表記の解釈等)の検証はquantity_extraction_prototype.js自身の回帰テスト(68件)が担うため、ここでは下流処理(比較エンジン)が直接依存する区間・単位・抽出信頼度の必須フィールドのみを検証する。",
          "$ref": "#/$defs/quantityRecord"
        },
        "interval_semantics_candidates": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "value",
              "confidence",
              "evidence"
            ],
            "properties": {
              "value": {
                "type": "string",
                "minLength": 1
              },
              "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "evidence": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/evidenceItem"
                }
              }
            }
          }
        },
        "is_condition_value": {
          "type": "boolean"
        },
        "source_representation": {
          "description": "Excel側のみが出力する任意フィールド。source_span/normalized_textが、セルの生値をそのまま文字列化したテキスト('raw_value')と、セルの表示形式(number format)を適用した表示文字列('formatted_display'、例: 単位付き書式を持つ数値セル)のどちらに対する位置・テキストなのかを明示する。PDF側の出力にはこのフィールド自体が存在しない。",
          "enum": [
            "raw_value",
            "formatted_display"
          ]
        },
        "source_value_text": {
          "description": "Excel側のみが出力する任意フィールド。source_representationが指すテキスト全体(抽出対象になったセルの値そのもの)。normalized_textは数量部分だけの正規化後テキストなので、それとは異なる。",
          "type": "string"
        },
        "content_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        }
      }
    },
    "quantityRecord": {
      "type": "object",
      "required": [
        "source_text",
        "quantity",
        "unit",
        "extraction"
      ],
      "properties": {
        "source_text": {
          "type": "string"
        },
        "source_span": {
          "type": "object",
          "required": [
            "start",
            "end"
          ],
          "properties": {
            "start": {
              "type": "integer",
              "minimum": 0
            },
            "end": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "normalized_text": {
          "type": "string"
        },
        "quantity": {
          "description": "kindによって形が変わる判別可能な共用体(quantity_extraction_prototype.jsの2種類の出力形、112〜452行目参照)。区間形式(kind:'interval')以外に、「12/15 kW」のような並列値(kind:'alternatives'、297行目。lower/upperを持たずoptions/selection_semanticsを持つ)も実際に生成される。レビューでconst:'interval'への変更を提案されたが、alternatives形を誤って拒否するため採用しなかった(修正時に実際に'12/15 kW'を抽出させ、alternatives形が生成されることを確認済み)。",
          "oneOf": [
            {
              "type": "object",
              "required": [
                "kind",
                "lower",
                "upper"
              ],
              "additionalProperties": false,
              "properties": {
                "kind": {
                  "const": "interval"
                },
                "lower": {
                  "$ref": "#/$defs/intervalBound"
                },
                "upper": {
                  "$ref": "#/$defs/intervalBound"
                }
              }
            },
            {
              "type": "object",
              "required": [
                "kind",
                "options",
                "selection_semantics"
              ],
              "additionalProperties": false,
              "properties": {
                "kind": {
                  "const": "alternatives"
                },
                "options": {
                  "type": "array"
                },
                "selection_semantics": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          ]
        },
        "unit": {
          "type": "object",
          "required": [
            "source",
            "canonical",
            "dimension"
          ],
          "properties": {
            "source": {
              "type": "string"
            },
            "canonical": {
              "type": "string"
            },
            "dimension": {
              "type": "string"
            },
            "standard_ref": {
              "type": [
                "object",
                "null"
              ]
            }
          }
        },
        "context": {
          "type": "object"
        },
        "extraction": {
          "type": "object",
          "required": [
            "confidence",
            "warnings"
          ],
          "properties": {
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "warnings": {
              "type": "array"
            }
          }
        },
        "condition_candidates": {
          "type": "array"
        }
      }
    },
    "intervalBound": {
      "type": [
        "object",
        "null"
      ],
      "required": [
        "value",
        "inclusive"
      ],
      "additionalProperties": false,
      "properties": {
        "value": {
          "type": "number"
        },
        "inclusive": {
          "type": "boolean"
        }
      }
    },
    "evidenceItem": {
      "type": "object",
      "required": [
        "type",
        "value",
        "source_text",
        "effect",
        "weight"
      ],
      "properties": {
        "type": {
          "type": "string",
          "minLength": 1
        },
        "value": {
          "type": "string",
          "minLength": 1
        },
        "source_text": {
          "type": "string"
        },
        "effect": {
          "enum": [
            "supports",
            "opposes"
          ]
        },
        "weight": {
          "type": "number"
        }
      }
    }
  }
};
});
