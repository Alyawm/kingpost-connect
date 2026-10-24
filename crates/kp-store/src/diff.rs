//! Reading a revision's facts for comparison and caching comparison results.

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::{Result, Store};

/// One property row of a revision, keyed by the element's GlobalId.
#[derive(Debug, Clone, PartialEq)]
pub struct PropertyFact {
    pub global_id: String,
    pub pset: String,
    pub name: String,
    pub value_text: Option<String>,
    pub value_num: Option<f64>,
    pub unit: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiffResultRow {
    pub id: i64,
    pub from_revision_id: i64,
    pub to_revision_id: i64,
    pub computed_at: String,
    pub summary_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiffItemRow {
    pub global_id: String,
    pub change: String,
    pub detail_json: String,
}

impl Store {
    pub fn properties_of_revision(&self, revision_id: i64) -> Result<Vec<PropertyFact>> {
        let mut statement = self.conn.prepare(
            "SELECT e.global_id, p.pset, p.name, p.value_text, p.value_num, p.unit, p.kind
             FROM property p JOIN element e ON e.id = p.element_id
             WHERE e.revision_id = ?1",
        )?;
        let rows = statement.query_map([revision_id], |row| {
            Ok(PropertyFact {
                global_id: row.get(0)?,
                pset: row.get(1)?,
                name: row.get(2)?,
                value_text: row.get(3)?,
                value_num: row.get(4)?,
                unit: row.get(5)?,
                kind: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn find_diff(
        &self,
        from_revision_id: i64,
        to_revision_id: i64,
    ) -> Result<Option<DiffResultRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, from_revision_id, to_revision_id, computed_at, summary_json
                 FROM diff_result WHERE from_revision_id = ?1 AND to_revision_id = ?2",
                params![from_revision_id, to_revision_id],
                |row| {
                    Ok(DiffResultRow {
                        id: row.get(0)?,
                        from_revision_id: row.get(1)?,
                        to_revision_id: row.get(2)?,
                        computed_at: row.get(3)?,
                        summary_json: row.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    /// Replaces any earlier result for the same pair and stores the items in one transaction.
    pub fn save_diff(
        &self,
        from_revision_id: i64,
        to_revision_id: i64,
        summary_json: &str,
        items: &[DiffItemRow],
    ) -> Result<i64> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM diff_result WHERE from_revision_id = ?1 AND to_revision_id = ?2",
            params![from_revision_id, to_revision_id],
        )?;
        tx.execute(
            "INSERT INTO diff_result (from_revision_id, to_revision_id, summary_json) VALUES (?1, ?2, ?3)",
            params![from_revision_id, to_revision_id, summary_json],
        )?;
        let diff_id = tx.last_insert_rowid();
        {
            let mut insert = tx.prepare_cached(
                "INSERT OR REPLACE INTO diff_item (diff_result_id, global_id, change, detail_json)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for item in items {
                insert.execute(params![
                    diff_id,
                    item.global_id,
                    item.change,
                    item.detail_json
                ])?;
            }
        }
        tx.commit()?;
        Ok(diff_id)
    }

    pub fn diff_items(&self, diff_id: i64) -> Result<Vec<DiffItemRow>> {
        let mut statement = self.conn.prepare(
            "SELECT global_id, change, detail_json FROM diff_item WHERE diff_result_id = ?1 ORDER BY change, global_id",
        )?;
        let rows = statement.query_map([diff_id], |row| {
            Ok(DiffItemRow {
                global_id: row.get(0)?,
                change: row.get(1)?,
                detail_json: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}
