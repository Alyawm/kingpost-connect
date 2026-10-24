//! Each reader on a small hand-written file: what comes out must be the model an
//! engineer would draw from it.

use kp_analysis::{MemberKind, read_bytes};

const E2K: &str = include_str!("fixtures/frame.e2k");
const S2K: &str = include_str!("fixtures/frame.s2k");
const IFC: &[u8] = include_bytes!("fixtures/frame-structural.ifc");

#[test]
fn etabs_storey_instances_become_members_with_elevations() {
    let model = read_bytes("e2k", E2K.as_bytes()).unwrap();
    assert_eq!(model.source, "e2k");
    assert_eq!(model.program.as_deref(), Some("ETABS 21.0.0"));
    assert_eq!(
        (model.units.length.as_str(), model.units.force.as_str()),
        ("m", "kN")
    );

    let elevations: Vec<(String, f64)> = model
        .storeys
        .iter()
        .map(|s| (s.name.clone(), s.elevation))
        .collect();
    assert_eq!(
        elevations,
        vec![
            ("Base".to_owned(), 0.0),
            ("Level 1".to_owned(), 4.0),
            ("Roof".to_owned(), 7.5)
        ]
    );

    // 2 columns × 2 storeys + 2 beams + 1 brace.
    assert_eq!(model.members.len(), 7);
    let c1 = model
        .member("C1@Level 1")
        .expect("column instance on level 1");
    assert_eq!(c1.kind, MemberKind::Column);
    assert_eq!(c1.section.as_deref(), Some("C800X800"));
    assert_eq!(c1.material.as_deref(), Some("C30/37"));
    let (top, bottom) = model.member_axis(c1).unwrap();
    assert_eq!(top, [0.0, 0.0, 4.0]);
    assert_eq!(bottom, [0.0, 0.0, 0.0]);

    let roof_beam = model.member("B1@Roof").unwrap();
    assert_eq!(roof_beam.kind, MemberKind::Beam);
    let (a, b) = model.member_axis(roof_beam).unwrap();
    assert_eq!((a, b), ([0.0, 0.0, 7.5], [6.0, 0.0, 7.5]));

    let brace = model.member("D1@Roof").unwrap();
    assert_eq!(brace.kind, MemberKind::Brace);
    let (a, b) = model.member_axis(brace).unwrap();
    assert_eq!((a, b), ([6.0, 0.0, 7.5], [0.0, 0.0, 4.0]));

    let slab = &model.surfaces[0];
    assert_eq!(slab.kind, "slab");
    assert_eq!(slab.nodes.len(), 4);
    assert!(slab.nodes.iter().all(|n| n.ends_with("@Level 1")));
    assert_eq!(model.section("Slab200").unwrap().thickness, Some(0.2));

    let section = model.section("UB406X178X54").unwrap();
    assert_eq!(section.material.as_deref(), Some("S355"));
    assert_eq!(section.dimensions.len(), 4);

    assert_eq!(model.supports.len(), 2);
    assert!(
        model
            .supports
            .iter()
            .any(|s| s.node == "1@Base" && s.is_fixed())
    );
    assert!(
        model
            .supports
            .iter()
            .any(|s| s.node == "2@Base" && s.is_pinned())
    );

    assert_eq!(model.load_cases.len(), 3);
    let uls = &model.combinations[0];
    assert_eq!(uls.name, "ULS1");
    assert_eq!(uls.factors.len(), 2);
    assert_eq!(uls.factors[0].factor, 1.35);

    assert_eq!(model.point_loads.len(), 1);
    assert_eq!(model.point_loads[0].node, "2@Roof");
    assert_eq!(model.point_loads[0].force, [12.0, 0.0, 0.0]);
    assert_eq!(model.line_loads.len(), 2);
    let trapezoid = model
        .line_loads
        .iter()
        .find(|l| l.member == "B1@Roof")
        .unwrap();
    assert_eq!((trapezoid.start, trapezoid.end), (5.0, 10.0));
    assert_eq!(trapezoid.direction, "gravity");
    assert_eq!(model.surface_loads.len(), 1);
    assert!(model.notes.is_empty(), "{:?}", model.notes);
}

#[test]
fn sap2000_tables_become_members_results_and_loads() {
    let model = read_bytes("s2k", S2K.as_bytes()).unwrap();
    assert_eq!(model.source, "s2k");
    assert_eq!(model.program.as_deref(), Some("SAP2000 24.1.0"));
    assert_eq!(model.units.length, "m");
    assert_eq!(model.nodes.len(), 4);
    assert_eq!(model.members.len(), 3);

    let beam = model.member("2").unwrap();
    assert_eq!(beam.kind, MemberKind::Beam, "classified from its axis");
    assert_eq!(beam.section.as_deref(), Some("UB 406x178x54"));
    assert_eq!(beam.material.as_deref(), Some("S355"));
    assert_eq!(model.member("1").unwrap().kind, MemberKind::Column);

    let section = model.section("UC 203x203x46").unwrap();
    assert_eq!(section.shape.as_deref(), Some("I/Wide Flange"));
    assert_eq!(section.dimensions[0].value, 0.2032);

    assert_eq!(model.materials.len(), 2);
    let steel = model.materials.iter().find(|m| m.name == "S355").unwrap();
    assert_eq!(steel.kind, "steel");
    assert_eq!(steel.e_modulus, Some(210_000_000.0));

    assert_eq!(model.supports.len(), 2);
    assert!(
        model
            .supports
            .iter()
            .any(|s| s.node == "4" && s.is_pinned())
    );

    let names: Vec<&str> = model.load_cases.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["DEAD", "LIVE", "MODAL"]);
    assert_eq!(model.combinations[0].factors.len(), 2);
    assert_eq!(model.combinations[0].kind, "Linear Add");

    assert_eq!(model.point_loads[0].force, [10.0, 0.0, 0.0]);
    assert_eq!(model.line_loads[0].start, 8.0);

    assert_eq!(model.results.len(), 3);
    let mid = &model.results[1];
    assert_eq!(
        mid.station, 0.5,
        "station converted to a fraction of the length"
    );
    assert_eq!(mid.mz, 36.0);
}

#[test]
fn ifc_structural_view_places_members_through_the_placement_chain() {
    let model = read_bytes("ifc", IFC).unwrap();
    assert_eq!(model.source, "ifc");
    assert_eq!(model.units.length, "mm");
    assert_eq!(model.units.force, "kN");
    assert_eq!(model.program.as_deref(), Some("Structural test writer 1.0"));

    assert_eq!(model.members.len(), 3);
    let c1 = model.members.iter().find(|m| m.name == "C1").unwrap();
    assert_eq!(c1.kind, MemberKind::Column);
    // The placement shifts everything 1000 mm in X.
    let (a, b) = model.member_axis(c1).unwrap();
    assert_eq!((a, b), ([1000.0, 0.0, 0.0], [1000.0, 0.0, 4000.0]));
    assert_eq!(
        c1.start, "N1",
        "member end attached to its named connection"
    );
    assert_eq!(c1.end, "N2");
    assert_eq!(c1.section.as_deref(), Some("UC 203x203x46"));
    assert_eq!(c1.material.as_deref(), Some("S355"));

    let b1 = model.members.iter().find(|m| m.name == "B1").unwrap();
    assert_eq!(b1.kind, MemberKind::Beam);
    assert_eq!(b1.section.as_deref(), Some("UB 406x178x54"));

    let c2 = model.members.iter().find(|m| m.name == "C2").unwrap();
    assert_eq!(c2.start, "N4");
    assert!(
        c2.end.starts_with('N'),
        "an end without a connection gets a generated node"
    );

    assert_eq!(model.supports.len(), 2);
    assert!(
        model
            .supports
            .iter()
            .any(|s| s.node == "N1" && s.is_fixed())
    );
    assert!(
        model
            .supports
            .iter()
            .any(|s| s.node == "N4" && s.is_pinned())
    );

    let slab = &model.surfaces[0];
    assert_eq!(slab.name, "Slab L1");
    assert_eq!(slab.kind, "slab");
    assert_eq!(slab.nodes.len(), 4);
    assert_eq!(slab.section.as_deref(), Some("t=200"));

    let cases: Vec<(&str, &str)> = model
        .load_cases
        .iter()
        .map(|c| (c.name.as_str(), c.kind.as_str()))
        .collect();
    assert_eq!(cases, vec![("Dead", "dead"), ("Wind", "wind")]);
    let uls = &model.combinations[0];
    assert_eq!(uls.name, "ULS");
    assert_eq!(uls.factors.len(), 2);
    assert_eq!(uls.factors[1].factor, 1.5);

    assert_eq!(model.point_loads.len(), 1);
    assert_eq!(model.point_loads[0].node, "N2");
    assert_eq!(model.point_loads[0].case, "Wind");
    assert_eq!(model.line_loads.len(), 1);
    assert_eq!(model.line_loads[0].member, b1.uid);
    assert_eq!(model.line_loads[0].start, -8.0);
    assert_eq!(model.line_loads[0].direction, "z");
}

#[test]
fn an_ifc_without_structural_members_is_refused() {
    let plain = include_bytes!("../../kp-ifc/tests/fixtures/portal.ifc");
    assert!(matches!(
        read_bytes("ifc", plain),
        Err(kp_analysis::AnalysisError::NoStructuralView)
    ));
    assert!(kp_analysis::from_ifc_bytes(plain).unwrap().is_none());
}
