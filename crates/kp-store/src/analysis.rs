//! Analysis models stored per revision and the link reports between a physical revision
//! and an analysis revision.

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::{Result, Store};

/// What an import hands over; the JSON is the serialised `kp_analysis::AnalysisModel`.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysisModelRow {
    pub source: String,
    pub program: Option<String>,
    pub length_unit: String,
    pub force_unit: String,
    pub node_count: i64,
    pub member_count: i64,
    pub surface_count: i64,
    pub load_count: i64,
    pub result_count: i64,
    pub model_json: String,
}

/// An analysis model as listed, with the file and revision it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AnalysisModelSummary {
    pub revision_id: i64,
    pub file_id: i64,
    pub rel_path: String,
    pub revision_idx: i64,
    pub imported_at: String,
    pub source: String,
    pub program: Option<String>,
    pub length_unit: String,
    pub force_unit: String,
    pub node_count: i64,
    pub member_count: i64,
    pub surface_count: i64,
    pub load_count: i64,
    pub result_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LinkSetRow {
    pub id: i64,
    pub physical_revision_id: i64,
    pub analysis_revision_id: i64,
    pub computed_at: String,
    pub settings_json: String,
    pub report_json: String,
}

impl Store {
    pub fn save_analysis_model(&self, revision_id: i64, row: &AnalysisModelRow) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO analysis_model (revision_id, source, program, length_unit,
               force_unit, node_count, member_count, surface_count, load_count, result_count,
               model_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                revision_id,
                row.source,
                row.program,
                row.length_unit,
                row.force_unit,
                row.node_count,
                row.member_count,
                row.surface_count,
                row.load_count,
                row.result_count,
                row.model_json
            ],
        )?;
        self.conn.execute(
            "UPDATE revision SET element_count = MAX(element_count, ?1) WHERE id = ?2",
            params![row.member_count, revision_id],
        )?;
        Ok(())
    }

    pub fn analysis_model_json(&self, revision_id: i64) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT model_json FROM analysis_model WHERE revision_id = ?1",
                [revision_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn analysis_models(&self) -> Result<Vec<AnalysisModelSummary>> {
        let mut statement = self.conn.prepare(
            "SELECT a.revision_id, f.id, f.rel_path, r.idx, r.imported_at, a.source, a.program,
                    a.length_unit, a.force_unit, a.node_count, a.member_count, a.surface_count,
                    a.load_count, a.result_count
             FROM analysis_model a
             JOIN revision r ON r.id = a.revision_id
             JOIN file f ON f.id = r.file_id
             ORDER BY f.rel_path, r.idx",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(AnalysisModelSummary {
                revision_id: row.get(0)?,
                file_id: row.get(1)?,
                rel_path: row.get(2)?,
                revision_idx: row.get(3)?,
                imported_at: row.get(4)?,
                source: row.get(5)?,
                program: row.get(6)?,
                length_unit: row.get(7)?,
                force_unit: row.get(8)?,
                node_count: row.get(9)?,
                member_count: row.get(10)?,
                surface_count: row.get(11)?,
                load_count: row.get(12)?,
                result_count: row.get(13)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Stores (or replaces) the link report for a revision pair.
    pub fn save_link_set(
        &self,
        physical_revision_id: i64,
        analysis_revision_id: i64,
        settings_json: &str,
        report_json: &str,
    ) -> Result<LinkSetRow> {
        self.conn.execute(
            "INSERT INTO analysis_link_set (physical_revision_id, analysis_revision_id,
               settings_json, report_json)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(physical_revision_id, analysis_revision_id) DO UPDATE SET
               settings_json = excluded.settings_json,
               report_json = excluded.report_json,
               computed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![
                physical_revision_id,
                analysis_revision_id,
                settings_json,
                report_json
            ],
        )?;
        self.link_set(physical_revision_id, analysis_revision_id)?
            .ok_or(crate::StoreError::Sqlite(
                rusqlite::Error::QueryReturnedNoRows,
            ))
    }

    pub fn link_set(
        &self,
        physical_revision_id: i64,
        analysis_revision_id: i64,
    ) -> Result<Option<LinkSetRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, physical_revision_id, analysis_revision_id, computed_at, settings_json,
                        report_json
                 FROM analysis_link_set
                 WHERE physical_revision_id = ?1 AND analysis_revision_id = ?2",
                params![physical_revision_id, analysis_revision_id],
                |row| {
                    Ok(LinkSetRow {
                        id: row.get(0)?,
                        physical_revision_id: row.get(1)?,
                        analysis_revision_id: row.get(2)?,
                        computed_at: row.get(3)?,
                        settings_json: row.get(4)?,
                        report_json: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    /// Replaces the stored report of a pair without touching its settings.
    pub fn update_link_report(&self, id: i64, report_json: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE analysis_link_set SET report_json = ?1 WHERE id = ?2",
            params![report_json, id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analysis_models_and_link_sets_round_trip() {
        let store = Store::open_in_memory().unwrap();
        let ifc = store.upsert_file("a.ifc", "ifc", None, None, None).unwrap();
        let (physical, _) = store.create_revision(ifc, "s1", None, "{}", None).unwrap();
        let e2k = store.upsert_file("a.e2k", "e2k", None, None, None).unwrap();
        let (analysis, _) = store.create_revision(e2k, "s2", None, "{}", None).unwrap();
        store
            .save_analysis_model(
                analysis,
                &AnalysisModelRow {
                    source: "e2k".into(),
                    program: Some("ETABS".into()),
                    length_unit: "m".into(),
                    force_unit: "kN".into(),
                    node_count: 4,
                    member_count: 3,
                    surface_count: 0,
                    load_count: 1,
                    result_count: 0,
                    model_json: "{\"members\":[]}".into(),
                },
            )
            .unwrap();
        let listed = store.analysis_models().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].rel_path, "a.e2k");
        assert_eq!(listed[0].member_count, 3);
        assert_eq!(
            store.analysis_model_json(analysis).unwrap().as_deref(),
            Some("{\"members\":[]}")
        );
        assert!(store.analysis_model_json(physical).unwrap().is_none());
        let revision = store
            .revisions(Some(e2k))
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(
            revision.element_count, 3,
            "member count doubles as element count"
        );

        let set = store
            .save_link_set(physical, analysis, "{\"tolerance\":0.5}", "{\"links\":[]}")
            .unwrap();
        assert_eq!(set.report_json, "{\"links\":[]}");
        let again = store
            .save_link_set(physical, analysis, "{\"tolerance\":0.2}", "{\"links\":[1]}")
            .unwrap();
        assert_eq!(again.id, set.id, "one row per pair");
        assert_eq!(again.settings_json, "{\"tolerance\":0.2}");
        store
            .update_link_report(set.id, "{\"links\":[1,2]}")
            .unwrap();
        assert_eq!(
            store
                .link_set(physical, analysis)
                .unwrap()
                .unwrap()
                .report_json,
            "{\"links\":[1,2]}"
        );
        assert!(store.link_set(analysis, physical).unwrap().is_none());
    }
}
