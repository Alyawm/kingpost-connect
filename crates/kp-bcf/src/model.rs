//! BCF as data. Coordinates are IFC world coordinates in metres, Z up, exactly as BCF
//! defines them; converting to and from a viewer's space is the caller's job.

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BcfFile {
    /// "2.1" or "3.0" when reading; writing always produces 3.0.
    pub version: String,
    pub project_name: Option<String>,
    pub topics: Vec<Topic>,
    pub extensions: Extensions,
}

/// Allowed values advertised in `extensions.xml`. Empty lists are omitted on write.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Extensions {
    pub topic_types: Vec<String>,
    pub topic_statuses: Vec<String>,
    pub priorities: Vec<String>,
    pub users: Vec<String>,
    pub stages: Vec<String>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Topic {
    pub guid: String,
    pub topic_type: Option<String>,
    pub status: Option<String>,
    pub title: String,
    pub priority: Option<String>,
    pub index: Option<i64>,
    pub labels: Vec<String>,
    pub creation_date: String,
    pub creation_author: String,
    pub modified_date: Option<String>,
    pub modified_author: Option<String>,
    pub due_date: Option<String>,
    pub assigned_to: Option<String>,
    pub stage: Option<String>,
    pub description: Option<String>,
    pub comments: Vec<Comment>,
    pub viewpoints: Vec<Viewpoint>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Comment {
    pub guid: String,
    pub date: String,
    pub author: String,
    pub comment: String,
    pub viewpoint_guid: Option<String>,
    pub modified_date: Option<String>,
    pub modified_author: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Camera {
    Perspective {
        view_point: Point,
        direction: Point,
        up: Point,
        /// Vertical field of view in degrees.
        field_of_view: f64,
        aspect_ratio: f64,
    },
    Orthogonal {
        view_point: Point,
        direction: Point,
        up: Point,
        view_to_world_scale: f64,
        aspect_ratio: f64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub start: Point,
    pub end: Point,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClippingPlane {
    pub location: Point,
    pub direction: Point,
}

/// A colour as BCF writes it: ARGB or RGB hex without `#`, e.g. `FF00FF00`.
#[derive(Debug, Clone, PartialEq)]
pub struct Coloring {
    pub color: String,
    pub ifc_guids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Viewpoint {
    pub guid: String,
    pub index: Option<i64>,
    pub camera: Option<Camera>,
    /// IFC GlobalIds of selected components.
    pub selection: Vec<String>,
    /// When true, `visibility_exceptions` lists hidden components; when false, visible ones.
    pub default_visibility: bool,
    pub visibility_exceptions: Vec<String>,
    pub coloring: Vec<Coloring>,
    pub lines: Vec<Line>,
    pub clipping_planes: Vec<ClippingPlane>,
    /// File extension ("png" or "jpg") and bytes.
    pub snapshot: Option<(String, Vec<u8>)>,
}
