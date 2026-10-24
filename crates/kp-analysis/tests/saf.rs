//! SAF is a workbook, so the fixture is written here with the xlsx writer and read back.

use kp_analysis::{MemberKind, read_bytes};
use rust_xlsxwriter::Workbook;

fn sheet(workbook: &mut Workbook, name: &str, rows: &[&[&str]]) {
    let sheet = workbook.add_worksheet();
    sheet.set_name(name).unwrap();
    for (r, row) in rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            if let Ok(number) = cell.parse::<f64>() {
                sheet.write_number(r as u32, c as u16, number).unwrap();
            } else {
                sheet.write_string(r as u32, c as u16, *cell).unwrap();
            }
        }
    }
}

fn workbook() -> Vec<u8> {
    let mut wb = Workbook::new();
    sheet(
        &mut wb,
        "Project",
        &[&["Name", "Source software"], &["Frame", "SCIA Engineer 24"]],
    );
    sheet(
        &mut wb,
        "StructuralMaterial",
        &[
            &[
                "Name",
                "Type",
                "Quality",
                "Unit mass [kg/m3]",
                "E modulus [MPa]",
            ],
            &["S355", "Steel", "S 355", "7850", "210000"],
            &["C30/37", "Concrete", "C30/37", "2500", "33000"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralCrossSection",
        &[
            &[
                "Name",
                "Material",
                "Cross-section type",
                "Shape",
                "Parameters [mm]",
                "Profile",
            ],
            &["CS1", "S355", "Manufactured", "I section", "", "HEA300"],
            &["CS2", "C30/37", "Parametric", "Rectangle", "800; 700", ""],
        ],
    );
    sheet(
        &mut wb,
        "StructuralPointConnection",
        &[
            &[
                "Name",
                "Coordinate X [m]",
                "Coordinate Y [m]",
                "Coordinate Z [m]",
            ],
            &["N1", "0", "0", "0"],
            &["N2", "0", "0", "4"],
            &["N3", "6", "0", "4"],
            &["N4", "6", "0", "0"],
            &["N5", "6", "5", "4"],
            &["N6", "0", "5", "4"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralCurveMember",
        &[
            &[
                "Name",
                "Type",
                "Cross section",
                "Beg. node",
                "End node",
                "Layer",
            ],
            &["B1", "Beam", "CS2", "N2", "N3", "Level 1"],
            &["C1", "Column", "CS1", "N1", "N2", "Level 1"],
            &["C2", "Column", "CS1", "N4", "N3", "Level 1"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralSurfaceMember",
        &[
            &[
                "Name",
                "Type",
                "Material",
                "Thickness [mm]",
                "Nodes",
                "Layer",
            ],
            &["S1", "Plate", "C30/37", "0.2", "N2; N3; N5; N6", "Level 1"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralPointSupport",
        &[
            &["Name", "Type", "Node", "X", "Y", "Z", "Rx", "Ry", "Rz"],
            &[
                "Sn1", "Standard", "N1", "Rigid", "Rigid", "Rigid", "Rigid", "Rigid", "Rigid",
            ],
            &[
                "Sn4", "Standard", "N4", "Rigid", "Rigid", "Rigid", "Free", "Free", "Free",
            ],
        ],
    );
    sheet(
        &mut wb,
        "StructuralLoadCase",
        &[
            &[
                "Name",
                "Description",
                "Action type",
                "Load group",
                "Load type",
            ],
            &["LC1", "Self weight", "Permanent", "LG1", "Self weight"],
            &["LC2", "Imposed", "Variable", "LG2", "Standard"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralLoadCombination",
        &[
            &[
                "Name",
                "Description",
                "Category",
                "Load cases",
                "Load factors",
            ],
            &["CO1", "ULS", "ULS", "LC1; LC2", "1.35; 1.5"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralPointAction",
        &[
            &[
                "Name",
                "Direction",
                "Force action",
                "Value [kN]",
                "Load case",
                "Reference node",
                "Type",
            ],
            &["F1", "X", "In node", "12", "LC2", "N2", "Force"],
        ],
    );
    sheet(
        &mut wb,
        "StructuralCurveAction",
        &[
            &[
                "Name",
                "Distribution",
                "Direction",
                "Value 1 [kN/m]",
                "Value 2 [kN/m]",
                "Load case",
                "Member",
            ],
            &["LL1", "Uniform", "Z", "-8", "", "LC1", "B1"],
        ],
    );
    sheet(
        &mut wb,
        "ResultInternalForce1D",
        &[
            &[
                "Result on",
                "Member",
                "Load case",
                "Section at",
                "Index",
                "N",
                "Vy",
                "Vz",
                "Mx",
                "My",
                "Mz",
            ],
            &[
                "Member", "B1", "LC1", "0", "1", "-1.2", "0", "24", "0", "0", "0",
            ],
            &[
                "Member", "B1", "LC1", "0.5", "2", "-1.2", "0", "0", "0", "36", "0",
            ],
        ],
    );
    wb.save_to_buffer().unwrap()
}

#[test]
fn saf_sheets_become_a_model() {
    let bytes = workbook();
    let model = read_bytes("saf", &bytes).unwrap();
    assert_eq!(model.source, "saf");
    assert_eq!(model.program.as_deref(), Some("SCIA Engineer 24"));
    assert_eq!(model.nodes.len(), 6);
    assert_eq!(model.members.len(), 3);

    let b1 = model.member("B1").unwrap();
    assert_eq!(b1.kind, MemberKind::Beam);
    assert_eq!(b1.section.as_deref(), Some("CS2"));
    assert_eq!(
        b1.material.as_deref(),
        Some("C30/37"),
        "through the cross section"
    );
    assert_eq!(b1.storey.as_deref(), Some("Level 1"));
    assert_eq!(model.member("C1").unwrap().kind, MemberKind::Column);

    let cs2 = model.section("CS2").unwrap();
    assert_eq!(cs2.dimensions.len(), 2);
    assert_eq!(cs2.dimensions[0].value, 800.0);
    assert_eq!(
        model.section("CS1").unwrap().shape.as_deref(),
        Some("HEA300")
    );

    assert_eq!(model.surfaces[0].nodes, vec!["N2", "N3", "N5", "N6"]);
    assert_eq!(model.surfaces[0].kind, "slab");

    assert_eq!(model.supports.len(), 2);
    assert!(
        model
            .supports
            .iter()
            .any(|s| s.node == "N4" && s.is_pinned())
    );

    assert_eq!(model.load_cases[0].kind, "permanent");
    let co1 = &model.combinations[0];
    assert_eq!(co1.factors.len(), 2);
    assert_eq!(co1.factors[1].case, "LC2");
    assert_eq!(co1.factors[1].factor, 1.5);

    assert_eq!(model.point_loads[0].force, [12.0, 0.0, 0.0]);
    assert_eq!(model.point_loads[0].node, "N2");
    assert_eq!(model.line_loads[0].member, "B1");
    assert_eq!(
        (model.line_loads[0].start, model.line_loads[0].end),
        (-8.0, -8.0)
    );

    assert_eq!(model.results.len(), 2);
    assert_eq!(model.results[1].station, 0.5);
    assert_eq!(model.results[1].my, 36.0);
}
