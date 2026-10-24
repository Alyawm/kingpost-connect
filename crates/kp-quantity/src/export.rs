//! CSV and XLSX exports of an evaluated table, with the group rows and totals.

use std::path::Path;

use rust_xlsxwriter::{Format, Workbook};

use crate::{QuantityError, Result, Row, RowKind, Table};

pub fn to_csv(table: &Table) -> String {
    let mut out = String::new();
    let mut header = vec!["Row".to_owned(), "Count".to_owned()];
    header.extend(table.columns.iter().cloned());
    out.push_str(
        &header
            .iter()
            .map(|h| csv_cell(h))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push('\n');
    for row in &table.rows {
        let mut cells = vec![csv_cell(&row_label(row)), row.count.to_string()];
        cells.extend(row.cells.iter().map(|c| csv_cell(&c.text)));
        out.push_str(&cells.join(","));
        out.push('\n');
    }
    out
}

fn row_label(row: &Row) -> String {
    match row.kind {
        RowKind::Element => format!("{}{}", "  ".repeat(row.depth), row.label),
        RowKind::Group => format!("{}{}", "  ".repeat(row.depth), row.label),
        RowKind::Subtotal => format!("{}{}", "  ".repeat(row.depth), row.label),
        RowKind::Total => row.label.clone(),
    }
}

fn csv_cell(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// Writes the table as a workbook with one sheet, bold group and total rows, numbers as
/// numbers and the columns sized to their content.
pub fn write_xlsx(table: &Table, path: &Path) -> Result<()> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let name: String = table
        .definition
        .name
        .chars()
        .take(31)
        .filter(|c| !"[]:*?/\\".contains(*c))
        .collect();
    sheet
        .set_name(if name.is_empty() { "Schedule" } else { &name })
        .map_err(|e| QuantityError::Export(e.to_string()))?;
    let bold = Format::new().set_bold();
    let number = Format::new().set_num_format("#,##0.000");
    let bold_number = Format::new().set_bold().set_num_format("#,##0.000");

    let mut headers = vec!["Row".to_owned(), "Count".to_owned()];
    headers.extend(table.columns.iter().cloned());
    for (c, h) in headers.iter().enumerate() {
        sheet
            .write_string_with_format(0, c as u16, h, &bold)
            .map_err(|e| QuantityError::Export(e.to_string()))?;
    }
    let mut widths: Vec<usize> = headers.iter().map(|h| h.len()).collect();
    for (i, row) in table.rows.iter().enumerate() {
        let r = (i + 1) as u32;
        let emphasis = row.kind != RowKind::Element;
        let label = row_label(row);
        widths[0] = widths[0].max(label.len());
        if emphasis {
            sheet.write_string_with_format(r, 0, &label, &bold)
        } else {
            sheet.write_string(r, 0, &label)
        }
        .map_err(|e| QuantityError::Export(e.to_string()))?;
        sheet
            .write_number(r, 1, row.count as f64)
            .map_err(|e| QuantityError::Export(e.to_string()))?;
        for (c, cell) in row.cells.iter().enumerate() {
            let col = (c + 2) as u16;
            widths[c + 2] = widths[c + 2].max(cell.text.len());
            let result = match cell.num {
                Some(n) => sheet.write_number_with_format(
                    r,
                    col,
                    n,
                    if emphasis { &bold_number } else { &number },
                ),
                None if cell.text.is_empty() => Ok(&mut *sheet),
                None => {
                    if emphasis {
                        sheet.write_string_with_format(r, col, &cell.text, &bold)
                    } else {
                        sheet.write_string(r, col, &cell.text)
                    }
                }
            };
            result.map_err(|e| QuantityError::Export(e.to_string()))?;
        }
    }
    for (c, w) in widths.iter().enumerate() {
        sheet
            .set_column_width(c as u16, (*w as f64 + 2.0).clamp(8.0, 60.0))
            .map_err(|e| QuantityError::Export(e.to_string()))?;
    }
    sheet
        .set_freeze_panes(1, 0)
        .map_err(|e| QuantityError::Export(e.to_string()))?;
    workbook
        .save(path)
        .map_err(|e| QuantityError::Export(format!("{}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Aggregate, Cell, Column, ColumnKey, Definition, Filter};

    fn table() -> Table {
        let definition = Definition {
            name: "Steel, a test".into(),
            columns: vec![Column {
                key: ColumnKey::Derived {
                    quantity: "mass".into(),
                },
                label: "Mass (kg)".into(),
                aggregate: Aggregate::Sum,
            }],
            group_by: vec![],
            filter: Filter::default(),
            sort_by: None,
            sort_desc: false,
        };
        Table {
            definition,
            columns: vec!["Mass (kg)".into()],
            rows: vec![
                Row {
                    kind: RowKind::Element,
                    depth: 0,
                    label: "B1, main".into(),
                    express_id: Some(1),
                    global_id: None,
                    cells: vec![Cell {
                        text: "324.9".into(),
                        num: Some(324.9),
                    }],
                    count: 1,
                },
                Row {
                    kind: RowKind::Total,
                    depth: 0,
                    label: "Total".into(),
                    express_id: None,
                    global_id: None,
                    cells: vec![Cell {
                        text: "324.9".into(),
                        num: Some(324.9),
                    }],
                    count: 1,
                },
            ],
            element_count: 1,
            missing_densities: vec![],
        }
    }

    #[test]
    fn csv_quotes_commas_and_lists_totals() {
        let csv = to_csv(&table());
        assert_eq!(csv.lines().count(), 3);
        assert!(csv.contains("\"B1, main\",1,324.9"));
        assert!(csv.ends_with("Total,1,324.9\n"));
    }

    #[test]
    fn xlsx_is_written() {
        let dir = std::env::temp_dir().join(format!("kp-quantity-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("steel.xlsx");
        write_xlsx(&table(), &path).unwrap();
        assert!(std::fs::metadata(&path).unwrap().len() > 1000);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
