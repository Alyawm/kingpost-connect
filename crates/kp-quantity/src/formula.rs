//! Formulas between schedule columns: `+ - * /`, `^`, parentheses, numbers, and column
//! references by letter (`A`, `B`, … in column order) or by label in brackets (`[Mass]`).
//! Evaluated per element row; a reference to an empty or non-numeric cell gives no value.

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(f64),
    /// Index of the referenced column.
    Column(usize),
    Neg(Box<Expr>),
    Binary(Box<Expr>, Op, Box<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormulaError(pub String);

impl fmt::Display for FormulaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Spreadsheet-style letter of a column index: 0 → A, 25 → Z, 26 → AA.
pub fn column_letter(mut index: usize) -> String {
    let mut out = Vec::new();
    loop {
        out.push(b'A' + (index % 26) as u8);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn letter_index(letters: &str) -> Option<usize> {
    let mut index = 0usize;
    for c in letters.chars() {
        if !c.is_ascii_uppercase() {
            return None;
        }
        index = index * 26 + (c as usize - 'A' as usize + 1);
    }
    index.checked_sub(1)
}

/// Parses a formula against the schedule's column labels.
pub fn parse(source: &str, labels: &[String]) -> Result<Expr, FormulaError> {
    let mut parser = Parser {
        chars: source.chars().collect(),
        pos: 0,
        labels,
    };
    let expr = parser.expression()?;
    parser.skip_space();
    if parser.pos < parser.chars.len() {
        return Err(FormulaError(format!(
            "unexpected '{}' at position {}",
            parser.chars[parser.pos],
            parser.pos + 1
        )));
    }
    Ok(expr)
}

/// Every column the expression reads.
pub fn references(expr: &Expr, out: &mut Vec<usize>) {
    match expr {
        Expr::Number(_) => {}
        Expr::Column(i) => out.push(*i),
        Expr::Neg(e) => references(e, out),
        Expr::Binary(a, _, b) => {
            references(a, out);
            references(b, out);
        }
    }
}

/// Evaluates with a lookup for column values; `None` when a value is missing or the
/// result is not a finite number (division by zero, for example).
pub fn evaluate(expr: &Expr, value: &dyn Fn(usize) -> Option<f64>) -> Option<f64> {
    let result = match expr {
        Expr::Number(n) => *n,
        Expr::Column(i) => value(*i)?,
        Expr::Neg(e) => -evaluate(e, value)?,
        Expr::Binary(a, op, b) => {
            let (x, y) = (evaluate(a, value)?, evaluate(b, value)?);
            match op {
                Op::Add => x + y,
                Op::Sub => x - y,
                Op::Mul => x * y,
                Op::Div => x / y,
                Op::Pow => x.powf(y),
            }
        }
    };
    result.is_finite().then_some(result)
}

struct Parser<'a> {
    chars: Vec<char>,
    pos: usize,
    labels: &'a [String],
}

impl Parser<'_> {
    fn skip_space(&mut self) {
        while self.chars.get(self.pos).is_some_and(|c| c.is_whitespace()) {
            self.pos += 1;
        }
    }

    fn peek(&mut self) -> Option<char> {
        self.skip_space();
        self.chars.get(self.pos).copied()
    }

    // expression := term (('+' | '-') term)*
    fn expression(&mut self) -> Result<Expr, FormulaError> {
        let mut left = self.term()?;
        while let Some(c @ ('+' | '-')) = self.peek() {
            self.pos += 1;
            let right = self.term()?;
            let op = if c == '+' { Op::Add } else { Op::Sub };
            left = Expr::Binary(Box::new(left), op, Box::new(right));
        }
        Ok(left)
    }

    // term := power (('*' | '/') power)*
    fn term(&mut self) -> Result<Expr, FormulaError> {
        let mut left = self.power()?;
        while let Some(c @ ('*' | '/')) = self.peek() {
            self.pos += 1;
            let right = self.power()?;
            let op = if c == '*' { Op::Mul } else { Op::Div };
            left = Expr::Binary(Box::new(left), op, Box::new(right));
        }
        Ok(left)
    }

    // power := unary ('^' power)?   (right-associative)
    fn power(&mut self) -> Result<Expr, FormulaError> {
        let base = self.unary()?;
        if self.peek() == Some('^') {
            self.pos += 1;
            let exponent = self.power()?;
            return Ok(Expr::Binary(Box::new(base), Op::Pow, Box::new(exponent)));
        }
        Ok(base)
    }

    fn unary(&mut self) -> Result<Expr, FormulaError> {
        if self.peek() == Some('-') {
            self.pos += 1;
            return Ok(Expr::Neg(Box::new(self.unary()?)));
        }
        if self.peek() == Some('+') {
            self.pos += 1;
            return self.unary();
        }
        self.atom()
    }

    fn atom(&mut self) -> Result<Expr, FormulaError> {
        match self.peek() {
            Some('(') => {
                self.pos += 1;
                let inner = self.expression()?;
                if self.peek() != Some(')') {
                    return Err(FormulaError("missing ')'".into()));
                }
                self.pos += 1;
                Ok(inner)
            }
            Some('[') => {
                self.pos += 1;
                let start = self.pos;
                while self.chars.get(self.pos).is_some_and(|c| *c != ']') {
                    self.pos += 1;
                }
                if self.pos >= self.chars.len() {
                    return Err(FormulaError("missing ']'".into()));
                }
                let label: String = self.chars[start..self.pos].iter().collect();
                self.pos += 1;
                let label = label.trim();
                self.labels
                    .iter()
                    .position(|l| l.trim().eq_ignore_ascii_case(label))
                    .map(Expr::Column)
                    .ok_or_else(|| FormulaError(format!("no column named [{label}]")))
            }
            Some(c) if c.is_ascii_digit() || c == '.' => {
                let start = self.pos;
                while self
                    .chars
                    .get(self.pos)
                    .is_some_and(|c| c.is_ascii_digit() || *c == '.')
                {
                    self.pos += 1;
                }
                // Optional exponent: 1.5e3, 2E-4.
                if self
                    .chars
                    .get(self.pos)
                    .is_some_and(|c| *c == 'e' || *c == 'E')
                {
                    let save = self.pos;
                    self.pos += 1;
                    if self
                        .chars
                        .get(self.pos)
                        .is_some_and(|c| *c == '+' || *c == '-')
                    {
                        self.pos += 1;
                    }
                    if self.chars.get(self.pos).is_some_and(char::is_ascii_digit) {
                        while self.chars.get(self.pos).is_some_and(char::is_ascii_digit) {
                            self.pos += 1;
                        }
                    } else {
                        self.pos = save;
                    }
                }
                let text: String = self.chars[start..self.pos].iter().collect();
                text.parse()
                    .map(Expr::Number)
                    .map_err(|_| FormulaError(format!("'{text}' is not a number")))
            }
            Some(c) if c.is_ascii_alphabetic() => {
                let start = self.pos;
                while self
                    .chars
                    .get(self.pos)
                    .is_some_and(char::is_ascii_alphabetic)
                {
                    self.pos += 1;
                }
                let word: String = self.chars[start..self.pos].iter().collect();
                let index = letter_index(&word.to_ascii_uppercase())
                    .filter(|i| *i < self.labels.len())
                    .ok_or_else(|| {
                        FormulaError(format!(
                            "'{word}' is not a column letter (A–{}) — use [name] for names",
                            column_letter(self.labels.len().saturating_sub(1))
                        ))
                    })?;
                Ok(Expr::Column(index))
            }
            Some(c) => Err(FormulaError(format!("unexpected '{c}'"))),
            None => Err(FormulaError("the formula ends too early".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels() -> Vec<String> {
        ["Name", "Length", "Mass", "Count"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    fn eval(source: &str, values: &[Option<f64>]) -> Option<f64> {
        let expr = parse(source, &labels()).unwrap();
        evaluate(&expr, &|i| values.get(i).copied().flatten())
    }

    #[test]
    fn letters_names_precedence_and_powers() {
        let row = [None, Some(6.0), Some(325.0), Some(1.0)];
        assert_eq!(eval("C / B", &row), Some(325.0 / 6.0));
        assert_eq!(eval("[mass] / [Length]", &row), Some(325.0 / 6.0));
        assert_eq!(eval("1 + 2 * 3", &row), Some(7.0));
        assert_eq!(eval("(1 + 2) * 3", &row), Some(9.0));
        assert_eq!(eval("2 ^ 3 ^ 2", &row), Some(512.0));
        assert_eq!(eval("-B + 10", &row), Some(4.0));
        assert_eq!(eval("1.5e3 / 1000", &row), Some(1.5));
    }

    #[test]
    fn missing_values_and_division_by_zero_give_no_value() {
        assert_eq!(eval("A * 2", &[None, Some(1.0)]), None);
        assert_eq!(eval("B / 0", &[None, Some(1.0)]), None);
    }

    #[test]
    fn reports_bad_formulas() {
        let l = labels();
        assert!(parse("B +", &l).is_err());
        assert!(parse("(B", &l).is_err());
        assert!(parse("[Width]", &l).unwrap_err().0.contains("Width"));
        assert!(parse("Z", &l).unwrap_err().0.contains("A–D"));
        assert!(parse("B $ C", &l).is_err());
    }

    #[test]
    fn letters_round_trip() {
        assert_eq!(column_letter(0), "A");
        assert_eq!(column_letter(25), "Z");
        assert_eq!(column_letter(26), "AA");
        assert_eq!(letter_index("AA"), Some(26));
        let mut refs = Vec::new();
        references(&parse("C / B + [Count]", &labels()).unwrap(), &mut refs);
        assert_eq!(refs, vec![2, 1, 3]);
    }
}
