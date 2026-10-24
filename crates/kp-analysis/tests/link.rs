//! Matching physical axes to analysis members and comparing their sections.

use kp_analysis::link::{compare_materials, compare_sections, section_numbers};
use kp_analysis::{LinkMethod, MatchSettings, PhysicalAxis, match_members, read_bytes};

const E2K: &str = include_str!("fixtures/frame.e2k");

fn axis(
    global_id: &str,
    name: &str,
    type_name: Option<&str>,
    start: [f64; 3],
    end: [f64; 3],
) -> PhysicalAxis {
    PhysicalAxis {
        global_id: global_id.into(),
        ifc_type: "IFCBEAM".into(),
        name: Some(name.into()),
        tag: None,
        type_name: type_name.map(str::to_owned),
        material: Some("C30/37".into()),
        storey: None,
        start,
        end,
    }
}

#[test]
fn matches_by_name_then_by_position_and_reports_the_rest() {
    let model = read_bytes("e2k", E2K.as_bytes()).unwrap();
    let physical = vec![
        // Same axis as C1@Level 1, slightly off, section agrees (800 x 800).
        axis(
            "g-col",
            "Concrete-Square-Column:800 x 800mm:1",
            Some("800 x 800mm"),
            [0.02, 0.0, 0.0],
            [0.0, 0.0, 3.98],
        ),
        // Beam on level 1, reversed direction, section differs (800 x 750 vs 800 x 700).
        axis(
            "g-beam",
            "Concrete-Rectangular Beam:800 x 750mm:2",
            Some("800 x 750mm"),
            [6.0, 0.0, 4.0],
            [0.0, 0.0, 4.0],
        ),
        // Named after the roof brace instance: name wins even though it sits elsewhere.
        axis(
            "g-named",
            "D1@Roof",
            None,
            [50.0, 50.0, 0.0],
            [51.0, 50.0, 0.0],
        ),
        // Nothing near this one.
        axis(
            "g-lonely",
            "Far beam",
            Some("300 x 300mm"),
            [20.0, 0.0, 4.0],
            [26.0, 0.0, 4.0],
        ),
    ];
    let report = match_members(&model, &physical, &MatchSettings::default());

    assert_eq!(report.links.len(), 3);
    let column = report.link_for("g-col").unwrap();
    assert_eq!(column.member_uid, "C1@Level 1");
    assert_eq!(column.method, LinkMethod::Position);
    assert!(column.distance < 0.05);
    assert_eq!(column.section_ok, Some(true));
    assert_eq!(column.material_ok, Some(true));

    let beam = report.link_for("g-beam").unwrap();
    assert_eq!(beam.member_uid, "B1@Level 1");
    assert_eq!(beam.section_ok, Some(false));
    assert_eq!(beam.analysis_section.as_deref(), Some("B800X700"));

    let named = report.link_for("g-named").unwrap();
    assert_eq!(named.method, LinkMethod::Name);
    assert_eq!(named.member_uid, "D1@Roof");

    assert_eq!(report.unmatched_physical, vec!["g-lonely".to_owned()]);
    assert_eq!(report.unmatched_members.len(), 7 - 3);
    assert_eq!(report.section_mismatches, 1);
    assert_eq!(report.physical_count, 4);
    assert_eq!(report.member_count, 7);
}

#[test]
fn offsets_and_tolerance_are_respected() {
    let model = read_bytes("e2k", E2K.as_bytes()).unwrap();
    let physical = vec![axis(
        "g-col",
        "Column",
        None,
        [10.0, 0.0, 0.0],
        [10.0, 0.0, 4.0],
    )];
    let none = match_members(&model, &physical, &MatchSettings::default());
    assert!(none.links.is_empty());
    let shifted = match_members(
        &model,
        &physical,
        &MatchSettings {
            offset: [10.0, 0.0, 0.0],
            ..Default::default()
        },
    );
    assert_eq!(shifted.links[0].member_uid, "C1@Level 1");
    assert_eq!(
        shifted.links[0].section_ok, None,
        "no physical section to compare"
    );
}

#[test]
fn manual_links_replace_automatic_ones() {
    let model = read_bytes("e2k", E2K.as_bytes()).unwrap();
    let physical = vec![axis(
        "g-col",
        "Column 800 x 800",
        None,
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 4.0],
    )];
    let mut report = match_members(&model, &physical, &MatchSettings::default());
    assert_eq!(report.links[0].member_uid, "C1@Level 1");
    report.set_manual(&model, physical.first(), "g-col", Some("C2@Level 1"));
    assert_eq!(report.links.len(), 1);
    assert_eq!(report.links[0].member_uid, "C2@Level 1");
    assert_eq!(report.links[0].method, LinkMethod::Manual);
    assert!(report.unmatched_members.contains(&"C1@Level 1".to_owned()));
    report.set_manual(&model, physical.first(), "g-col", None);
    assert!(report.links.is_empty());
}

#[test]
fn section_and_material_comparison_reads_the_numbers() {
    assert_eq!(section_numbers("UB 406x178x54"), vec![54, 178, 406]);
    assert_eq!(
        section_numbers("DF_Concrete-Rectangular Beam:800 x 700mm"),
        vec![700, 800]
    );
    assert_eq!(
        compare_sections(Some("800 x 700mm"), Some("B800X700"), None, 1.0),
        Some(true)
    );
    assert_eq!(
        compare_sections(Some("800 x 700mm"), Some("B800X750"), None, 1.0),
        Some(false)
    );
    assert_eq!(
        compare_sections(Some("UB 406x178x54"), Some("UB406X178"), None, 1.0),
        Some(true),
        "a mass per metre on one side only is not a difference"
    );
    assert_eq!(
        compare_sections(Some("Steel beam"), Some("W12X26"), None, 1.0),
        None
    );
    assert_eq!(compare_sections(None, Some("B800X700"), None, 1.0), None);
    assert_eq!(compare_materials(Some("C30/37"), Some("C30")), Some(true));
    assert_eq!(
        compare_materials(Some("Concrete C30/37"), Some("C30/37")),
        Some(true)
    );
    assert_eq!(
        compare_materials(Some("C30/37"), Some("C40/50")),
        Some(false)
    );
    assert_eq!(compare_materials(Some("S355"), None), None);
    assert_eq!(
        compare_materials(Some("Concrete - Cast-in-Place Concrete"), Some("C30/37")),
        None,
        "a material without a grade is not comparable with one"
    );
}
