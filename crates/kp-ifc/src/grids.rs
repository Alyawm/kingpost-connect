//! Structural grids: every `IfcGrid` with its U, V and W axes as tagged line segments in
//! IFC world coordinates (metres), ready to be drawn over the model.

use std::collections::HashMap;

use serde::Serialize;

use crate::step::{StepFile, Value};

type Point = [f64; 3];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GridAxis {
    /// The label in the grid bubble, e.g. "A" or "3".
    pub tag: String,
    /// `u`, `v` or `w`.
    pub family: &'static str,
    pub start: Point,
    pub end: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Grid {
    pub global_id: String,
    pub name: Option<String>,
    pub axes: Vec<GridAxis>,
}

/// Rotation plus translation.
#[derive(Clone, Copy)]
struct Transform {
    m: [[f64; 3]; 3],
    t: Point,
}

impl Transform {
    const IDENTITY: Transform = Transform {
        m: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        t: [0.0; 3],
    };

    fn apply(&self, p: Point) -> Point {
        let m = &self.m;
        [
            m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + self.t[0],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + self.t[1],
            m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + self.t[2],
        ]
    }

    fn then(&self, local: &Transform) -> Transform {
        let mut m = [[0.0; 3]; 3];
        for (i, row) in m.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = (0..3).map(|k| self.m[i][k] * local.m[k][j]).sum();
            }
        }
        Transform {
            m,
            t: self.apply(local.t),
        }
    }
}

/// Every grid in the file, with axes in metres in IFC world coordinates.
pub fn read_grids(step: &StepFile) -> Vec<Grid> {
    let mut reader = Reader {
        step,
        placements: HashMap::new(),
        scale: length_scale(step),
    };
    step.instances_of("IFCGRID")
        .iter()
        .filter_map(|&id| reader.grid(id))
        .collect()
}

struct Reader<'s, 'a> {
    step: &'s StepFile<'a>,
    placements: HashMap<u32, Transform>,
    /// File length unit in metres (0.001 for millimetres).
    scale: f64,
}

impl Reader<'_, '_> {
    fn grid(&mut self, id: u32) -> Option<Grid> {
        let args = self.step.args(id)?;
        let global_id = args.first().and_then(Value::as_str)?.to_owned();
        let name = args.get(2).and_then(Value::as_str).map(str::to_owned);
        let placement = args
            .get(5)
            .and_then(Value::as_ref)
            .map(|p| self.placement(p, 0))
            .unwrap_or(Transform::IDENTITY);
        let mut axes = Vec::new();
        for (index, family) in [(7, "u"), (8, "v"), (9, "w")] {
            for axis in args.get(index).map(Value::ref_list).unwrap_or_default() {
                if let Some(a) = self.axis(axis, family, &placement) {
                    axes.push(a);
                }
            }
        }
        Some(Grid {
            global_id,
            name,
            axes,
        })
    }

    fn axis(&self, id: u32, family: &'static str, placement: &Transform) -> Option<GridAxis> {
        let args = self.step.args(id)?;
        let tag = args
            .first()
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let curve = args.get(1).and_then(Value::as_ref)?;
        let (a, b) = self.segment(curve, 0)?;
        let world = |p: Point| {
            let w = placement.apply(p);
            [w[0] * self.scale, w[1] * self.scale, w[2] * self.scale]
        };
        Some(GridAxis {
            tag,
            family,
            start: world(a),
            end: world(b),
        })
    }

    /// The two ends of an axis curve, in the grid's local (file-unit) coordinates.
    fn segment(&self, id: u32, depth: u8) -> Option<(Point, Point)> {
        if depth > 8 {
            return None;
        }
        let args = self.step.args(id)?;
        match self.step.entity_type(id)? {
            "IFCPOLYLINE" => {
                let points = args.first().map(Value::ref_list).unwrap_or_default();
                let first = self.point(*points.first()?)?;
                let last = self.point(*points.last()?)?;
                Some((first, last))
            }
            "IFCLINE" => {
                let (origin, direction) = self.line(&args)?;
                Some((origin, add(origin, direction, 1.0)))
            }
            "IFCTRIMMEDCURVE" => {
                let basis = args.first().and_then(Value::as_ref)?;
                let trim = |i: usize| -> Option<Point> {
                    let list = args.get(i)?.as_list()?;
                    for item in list {
                        if let Some(r) = item.as_ref()
                            && let Some(p) = self.point(r)
                        {
                            return Some(p);
                        }
                    }
                    let parameter = list.iter().find_map(Value::as_f64)?;
                    if self.step.entity_type(basis)? != "IFCLINE" {
                        return None;
                    }
                    let (origin, direction) = self.line(&self.step.args(basis)?)?;
                    Some(add(origin, direction, parameter))
                };
                match (trim(1), trim(2)) {
                    (Some(a), Some(b)) => Some((a, b)),
                    _ => self.segment(basis, depth + 1),
                }
            }
            _ => None,
        }
    }

    /// An `IfcLine`'s point and its direction scaled by the vector magnitude.
    fn line(&self, args: &[Value]) -> Option<(Point, Point)> {
        let origin = self.point(args.first().and_then(Value::as_ref)?)?;
        let vector = self.step.args(args.get(1).and_then(Value::as_ref)?)?;
        let direction = self.point(vector.first().and_then(Value::as_ref)?)?;
        let magnitude = vector.get(1).and_then(Value::as_f64).unwrap_or(1.0);
        let d = normalise(direction);
        Some((
            origin,
            [d[0] * magnitude, d[1] * magnitude, d[2] * magnitude],
        ))
    }

    fn point(&self, id: u32) -> Option<Point> {
        let args = self.step.args(id)?;
        let list = args.first()?.as_list()?;
        let x = list.first().and_then(Value::as_f64)?;
        let y = list.get(1).and_then(Value::as_f64).unwrap_or(0.0);
        let z = list.get(2).and_then(Value::as_f64).unwrap_or(0.0);
        Some([x, y, z])
    }

    fn placement(&mut self, id: u32, depth: u8) -> Transform {
        if let Some(t) = self.placements.get(&id) {
            return *t;
        }
        if depth > 64 {
            return Transform::IDENTITY;
        }
        let Some(args) = self.step.args(id) else {
            return Transform::IDENTITY;
        };
        let local = match self.step.entity_type(id) {
            Some("IFCLOCALPLACEMENT") => {
                let parent = args
                    .first()
                    .and_then(Value::as_ref)
                    .map(|p| self.placement(p, depth + 1))
                    .unwrap_or(Transform::IDENTITY);
                let relative = args
                    .get(1)
                    .and_then(Value::as_ref)
                    .map(|a| self.axis_placement(a))
                    .unwrap_or(Transform::IDENTITY);
                parent.then(&relative)
            }
            Some("IFCAXIS2PLACEMENT3D") | Some("IFCAXIS2PLACEMENT2D") => self.axis_placement(id),
            _ => Transform::IDENTITY,
        };
        self.placements.insert(id, local);
        local
    }

    fn axis_placement(&self, id: u32) -> Transform {
        let Some(args) = self.step.args(id) else {
            return Transform::IDENTITY;
        };
        let location = args
            .first()
            .and_then(Value::as_ref)
            .and_then(|p| self.point(p))
            .unwrap_or([0.0; 3]);
        let direction = |i: usize| {
            args.get(i)
                .and_then(Value::as_ref)
                .and_then(|d| self.point(d))
        };
        let two_d = self.step.entity_type(id) == Some("IFCAXIS2PLACEMENT2D");
        let z = if two_d {
            [0.0, 0.0, 1.0]
        } else {
            normalise(direction(1).unwrap_or([0.0, 0.0, 1.0]))
        };
        let mut x = direction(if two_d { 1 } else { 2 }).unwrap_or([1.0, 0.0, 0.0]);
        let dot = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
        x = normalise([x[0] - dot * z[0], x[1] - dot * z[1], x[2] - dot * z[2]]);
        if x.iter().all(|v| v.abs() < 1e-12) {
            x = [1.0, 0.0, 0.0];
        }
        let y = cross(z, x);
        Transform {
            m: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]],
            t: location,
        }
    }
}

/// Metres per file length unit, from the project's unit assignment (1 when unknown).
fn length_scale(step: &StepFile) -> f64 {
    for &id in step.instances_of("IFCSIUNIT") {
        let Some(args) = step.args(id) else { continue };
        if args.get(1).and_then(Value::as_enum) != Some("LENGTHUNIT") {
            continue;
        }
        return match args.get(2).and_then(Value::as_enum) {
            Some("MILLI") => 0.001,
            Some("CENTI") => 0.01,
            Some("DECI") => 0.1,
            Some("KILO") => 1000.0,
            _ => 1.0,
        };
    }
    for &id in step.instances_of("IFCCONVERSIONBASEDUNIT") {
        let Some(args) = step.args(id) else { continue };
        if args.get(1).and_then(Value::as_enum) == Some("LENGTHUNIT") {
            match args
                .get(2)
                .and_then(Value::as_str)
                .map(str::to_ascii_uppercase)
                .as_deref()
            {
                Some("FOOT") => return 0.3048,
                Some("INCH") => return 0.0254,
                _ => {}
            }
        }
    }
    1.0
}

fn add(p: Point, d: Point, t: f64) -> Point {
    [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]
}

fn normalise(v: Point) -> Point {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len <= f64::EPSILON {
        [0.0; 3]
    } else {
        [v[0] / len, v[1] / len, v[2] / len]
    }
}

fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRID: &str = "ISO-10303-21;
HEADER;FILE_DESCRIPTION((''),'2;1');FILE_NAME('','',(''),(''),'','','');FILE_SCHEMA(('IFC4'));ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCCARTESIANPOINT((0.,0.,3000.));
#12=IFCAXIS2PLACEMENT3D(#10,$,$);
#13=IFCAXIS2PLACEMENT3D(#11,$,$);
#14=IFCLOCALPLACEMENT($,#12);
#15=IFCLOCALPLACEMENT(#14,#13);
#20=IFCCARTESIANPOINT((0.,-1000.));
#21=IFCCARTESIANPOINT((0.,9000.));
#22=IFCPOLYLINE((#20,#21));
#23=IFCGRIDAXIS('1',#22,.T.);
#24=IFCCARTESIANPOINT((6000.,-1000.));
#25=IFCCARTESIANPOINT((6000.,9000.));
#26=IFCPOLYLINE((#24,#25));
#27=IFCGRIDAXIS('2',#26,.T.);
#30=IFCCARTESIANPOINT((-1000.,0.));
#31=IFCDIRECTION((1.,0.));
#32=IFCVECTOR(#31,1.);
#33=IFCLINE(#30,#32);
#34=IFCTRIMMEDCURVE(#33,(IFCPARAMETERVALUE(0.)),(IFCPARAMETERVALUE(8000.)),.T.,.PARAMETER.);
#35=IFCGRIDAXIS('A',#34,.T.);
#40=IFCGRID('2gridGlobalId0000000000',$,'Main grid',$,$,#15,$,(#23,#27),(#35),$,$);
ENDSEC;
END-ISO-10303-21;
";

    #[test]
    fn reads_axes_in_metres_at_the_grid_elevation() {
        let step = StepFile::parse(GRID.as_bytes()).unwrap();
        let grids = read_grids(&step);
        assert_eq!(grids.len(), 1);
        let grid = &grids[0];
        assert_eq!(grid.name.as_deref(), Some("Main grid"));
        let tags: Vec<_> = grid
            .axes
            .iter()
            .map(|a| (a.family, a.tag.as_str()))
            .collect();
        assert_eq!(tags, vec![("u", "1"), ("u", "2"), ("v", "A")]);
        let two = &grid.axes[1];
        assert_eq!(two.start, [6.0, -1.0, 3.0]);
        assert_eq!(two.end, [6.0, 9.0, 3.0]);
        // The trimmed line runs 8 m along X from (-1, 0).
        let a = &grid.axes[2];
        assert_eq!(a.start, [-1.0, 0.0, 3.0]);
        assert_eq!(a.end, [7.0, 0.0, 3.0]);
    }

    #[test]
    fn a_file_without_grids_has_none() {
        let step = StepFile::parse(
            b"ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCWALL('x',$,$,$,$,$,$,$,$);ENDSEC;END-ISO-10303-21;",
        )
        .unwrap();
        assert!(read_grids(&step).is_empty());
    }
}
