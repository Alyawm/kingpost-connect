//! Ordered schema migrations. Append only: never edit a migration that has shipped,
//! add a new numbered file and bump `LATEST`.

pub const LATEST: i64 = 9;

pub const ALL: &[(i64, &str)] = &[
    (1, include_str!("../migrations/001_initial.sql")),
    (2, include_str!("../migrations/002_import_metadata.sql")),
    (3, include_str!("../migrations/003_review.sql")),
    (4, include_str!("../migrations/004_analysis.sql")),
    (5, include_str!("../migrations/005_drawings.sql")),
    (6, include_str!("../migrations/006_clash.sql")),
    (7, include_str!("../migrations/007_quantities.sql")),
    (8, include_str!("../migrations/008_default_view.sql")),
    (9, include_str!("../migrations/009_notes_links.sql")),
];
