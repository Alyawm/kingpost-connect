//! BCF (BIM Collaboration Format) for KingPost Connect.
//!
//! Writes version 3.0 archives and reads 2.1 and 3.0. The data model in [`model`] is
//! deliberately plain: strings, points and byte buffers in BCF's own terms, so the
//! mapping to the project database lives in the application and this crate stays a
//! faithful, testable codec.

mod read;
mod write;
mod xml;

pub mod model;

pub use model::{
    BcfFile, Camera, ClippingPlane, Coloring, Comment, Extensions, Line, Point, Topic, Viewpoint,
};
pub use read::read_bcf;
pub use write::write_bcf;

#[derive(Debug, thiserror::Error)]
pub enum BcfError {
    #[error("archive error: {0}")]
    Zip(String),
    #[error("xml error: {0}")]
    Xml(String),
    #[error("malformed BCF: {0}")]
    Malformed(String),
}

pub type Result<T> = std::result::Result<T, BcfError>;
