//! Measures the reader and the database import on a real file.
//!
//!     cargo run -p kp-ifc --release --example bench -- path/to/model.ifc
//!
//! Prints scan, extract and store times with the counts behind them. Used for the
//! property-pipeline decision (ADR 003) and for performance budgets afterwards.

use std::{path::PathBuf, time::Instant};

use kp_store::Store;

fn main() {
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: bench <model.ifc>");
    let data = std::fs::read(&path).expect("read file");
    let mb = data.len() as f64 / 1_048_576.0;

    let started = Instant::now();
    let model = kp_ifc::parse_bytes(&data).expect("parse");
    let parse_ms = started.elapsed().as_millis();

    let store = Store::open_in_memory().expect("store");
    let file_id = store
        .upsert_file("bench.ifc", "ifc", None, Some(data.len() as i64), None)
        .expect("file");
    let (_, _, store_ms) = kp_ifc::import_model(&store, file_id, "bench", &model).expect("import");

    let s = &model.stats;
    println!(
        "file          {} ({mb:.1} MB, {})",
        path.display(),
        model.schema
    );
    println!("entities      {} across {} types", s.entities, s.types);
    println!(
        "elements      {} products, {} spatial",
        s.elements, s.spatial
    );
    println!(
        "property sets {} psets, {} quantity sets, {} property rows",
        s.property_sets, s.quantity_sets, s.properties
    );
    println!("units         {:?}", model.units);
    println!("scan          {} ms", s.scan_ms);
    println!("extract       {} ms", s.extract_ms);
    println!("parse total   {parse_ms} ms");
    println!("store         {store_ms} ms");
    println!("total         {} ms", parse_ms as u64 + store_ms);
}
