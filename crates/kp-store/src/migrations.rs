//! Ordered schema migrations. Append only: never edit a migration that has shipped,
//! add a new numbered file and bump `LATEST`.

pub const LATEST: i64 = 2;

pub const ALL: &[(i64, &str)] = &[
    (1, include_str!("../migrations/001_initial.sql")),
    (2, include_str!("../migrations/002_import_metadata.sql")),
];
