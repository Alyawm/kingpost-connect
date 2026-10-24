//! Saved views: a camera, what was hidden, the section plane and colouring, plus a
//! small thumbnail. The JSON payloads are owned by the interface; the store keeps them
//! opaque so a new view property never needs a migration.

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::{Result, Store};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SavedViewRow {
    pub id: String,
    pub name: String,
    pub camera_json: String,
    pub visibility_json: String,
    pub section_planes_json: String,
    pub has_thumbnail: bool,
    pub created_at: String,
}

impl Store {
    pub fn saved_views(&self) -> Result<Vec<SavedViewRow>> {
        let mut statement = self.conn.prepare(
            "SELECT id, name, camera_json, visibility_json, section_planes_json,
                    thumbnail IS NOT NULL, created_at
             FROM saved_view ORDER BY created_at, name",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(SavedViewRow {
                id: row.get(0)?,
                name: row.get(1)?,
                camera_json: row.get(2)?,
                visibility_json: row.get(3)?,
                section_planes_json: row.get(4)?,
                has_thumbnail: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn saved_view_thumbnail(&self, id: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .query_row(
                "SELECT thumbnail FROM saved_view WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .flatten())
    }

    pub fn insert_saved_view(
        &self,
        id: &str,
        name: &str,
        camera_json: &str,
        visibility_json: &str,
        section_planes_json: &str,
        thumbnail: Option<&[u8]>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO saved_view (id, name, camera_json, visibility_json, section_planes_json, thumbnail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, camera_json, visibility_json, section_planes_json, thumbnail],
        )?;
        Ok(())
    }

    pub fn rename_saved_view(&self, id: &str, name: &str) -> Result<bool> {
        Ok(self.conn.execute(
            "UPDATE saved_view SET name = ?2 WHERE id = ?1",
            params![id, name],
        )? > 0)
    }

    pub fn delete_saved_view(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM saved_view WHERE id = ?1", [id])?
            > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_views_round_trip() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert_saved_view(
                "v1",
                "North elevation",
                "{\"p\":1}",
                "{}",
                "[]",
                Some(&[1, 2, 3]),
            )
            .unwrap();
        store
            .insert_saved_view("v2", "Plan L2", "{}", "{}", "[]", None)
            .unwrap();

        let views = store.saved_views().unwrap();
        assert_eq!(views.len(), 2);
        assert_eq!(views[0].name, "North elevation");
        assert!(views[0].has_thumbnail);
        assert!(!views[1].has_thumbnail);
        assert_eq!(
            store.saved_view_thumbnail("v1").unwrap(),
            Some(vec![1, 2, 3])
        );
        assert_eq!(store.saved_view_thumbnail("v2").unwrap(), None);
        assert_eq!(store.saved_view_thumbnail("missing").unwrap(), None);

        assert!(store.rename_saved_view("v2", "Plan level 2").unwrap());
        assert!(store.delete_saved_view("v1").unwrap());
        assert!(!store.delete_saved_view("v1").unwrap());
        let views = store.saved_views().unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].name, "Plan level 2");
    }
}
