//! End-to-end: parse the fixture, check what was understood, store it, read it back.

use kp_ifc::{IfcModel, parse_bytes};
use kp_store::Store;

const PORTAL: &[u8] = include_bytes!("fixtures/portal.ifc");

fn element(model: &IfcModel, express_id: u32) -> &kp_ifc::Element {
    model
        .elements
        .iter()
        .find(|e| e.express_id == express_id)
        .expect("element present")
}

#[test]
fn reads_elements_spatial_structure_types_and_materials() {
    let model = parse_bytes(PORTAL).unwrap();
    assert_eq!(model.schema, "IFC4");
    assert_eq!(
        model.stats.spatial, 5,
        "project, site, building, two storeys"
    );
    assert_eq!(model.stats.elements, 3, "one column, two beams");

    let column = element(&model, 50);
    assert_eq!(column.ifc_type, "IFCCOLUMN");
    assert_eq!(column.name.as_deref(), Some("C1"));
    assert_eq!(column.tag.as_deref(), Some("C1"));
    assert_eq!(column.storey.as_deref(), Some("Ground floor"));
    assert_eq!(column.material.as_deref(), Some("C30/37"));
    assert!(column.has_geometry);
    assert!(!column.is_spatial);

    let beam = element(&model, 60);
    assert_eq!(beam.storey.as_deref(), Some("Roof"));
    assert_eq!(beam.type_name.as_deref(), Some("UB 406x178x54"));
    assert_eq!(
        beam.material.as_deref(),
        Some("S355"),
        "resolved through the profile set usage"
    );

    let beam_without_geometry = element(&model, 62);
    assert!(!beam_without_geometry.has_geometry);
    assert_eq!(
        beam_without_geometry.type_name.as_deref(),
        Some("UB 406x178x54")
    );

    let storey = element(&model, 36);
    assert!(storey.is_spatial);
    assert_eq!(
        storey.parent,
        Some(32),
        "storey aggregated under the building"
    );
    assert_eq!(element(&model, 32).parent, Some(30));
    assert_eq!(element(&model, 30).parent, Some(1));
}

#[test]
fn reads_units_properties_and_quantities() {
    let model = parse_bytes(PORTAL).unwrap();
    assert_eq!(model.units.length.as_deref(), Some("mm"));
    assert_eq!(model.units.area.as_deref(), Some("m²"));
    assert_eq!(model.units.volume.as_deref(), Some("m³"));
    assert_eq!(model.units.mass.as_deref(), Some("kg"));

    let beam_props: Vec<_> = model
        .properties
        .iter()
        .filter(|p| p.element == 60)
        .collect();
    assert_eq!(
        beam_props.len(),
        6,
        "three single values and three quantities"
    );

    let find = |pset: &str, name: &str| {
        beam_props
            .iter()
            .find(|p| p.pset == pset && p.name == name)
            .expect("property present")
    };
    let reference = find("Pset_BeamCommon", "Reference");
    assert_eq!(reference.value_text.as_deref(), Some("UB406"));
    assert_eq!(reference.kind, "text");

    let load_bearing = find("Pset_BeamCommon", "LoadBearing");
    assert_eq!(load_bearing.value_text.as_deref(), Some("true"));
    assert_eq!(load_bearing.value_num, Some(1.0));
    assert_eq!(load_bearing.kind, "bool");

    let span = find("Pset_BeamCommon", "Span");
    assert_eq!(span.value_num, Some(6000.0));
    assert_eq!(span.kind, "length");
    assert_eq!(
        span.unit.as_deref(),
        Some("mm"),
        "project length unit applied"
    );

    let weight = find("Qto_BeamBaseQuantities", "NetWeight");
    assert_eq!(weight.kind, "mass");
    assert_eq!(weight.value_num, Some(325.0));
    assert_eq!(weight.unit.as_deref(), Some("kg"));

    let elevation = model
        .properties
        .iter()
        .find(|p| p.element == 36 && p.pset == "Storey" && p.name == "Elevation")
        .expect("storey elevation recorded");
    assert_eq!(elevation.value_num, Some(4000.0));
}

#[test]
fn imports_into_the_store_and_reads_back() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("models")).unwrap();
    std::fs::write(dir.path().join("models/portal.ifc"), PORTAL).unwrap();

    let store = Store::open_in_memory().unwrap();
    let summary = kp_ifc::import_file(&store, dir.path(), "models/portal.ifc").unwrap();
    assert_eq!(summary.revision_index, 1);
    assert_eq!(summary.schema, "IFC4");
    assert_eq!(summary.sha256.len(), 64);

    let files = store.files().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].rel_path, "models/portal.ifc");
    assert_eq!(files[0].kind, "ifc");

    let elements = store.elements(summary.revision_id).unwrap();
    assert_eq!(elements.len(), 8);
    let roof = elements.iter().find(|e| e.express_id == 36).unwrap();
    assert_eq!(
        roof.parent_express_id,
        Some(32),
        "parent resolved through row ids"
    );

    let props = store.element_properties(summary.revision_id, 60).unwrap();
    assert_eq!(props.len(), 6);
    assert!(
        props
            .iter()
            .any(|p| p.pset == "Qto_BeamBaseQuantities" && p.name == "NetVolume")
    );

    let hits = store
        .search_elements(summary.revision_id, "ub 406", 10)
        .unwrap();
    assert_eq!(hits.len(), 2, "both beams match through their type name");

    // Importing again creates a second revision of the same file.
    let again = kp_ifc::import_file(&store, dir.path(), "models/portal.ifc").unwrap();
    assert_eq!(again.file_id, summary.file_id);
    assert_eq!(again.revision_index, 2);
    assert_eq!(store.revisions(Some(summary.file_id)).unwrap().len(), 2);
    assert_eq!(store.revisions(None).unwrap()[1].element_count, 8);
}
