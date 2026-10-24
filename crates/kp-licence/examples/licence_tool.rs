//! Issuer's tool. Kept as an example so it ships with the source but not with the app.
//!
//!   cargo run -p kp-licence --example licence-tool -- keygen <dir>
//!       writes <dir>/licence.key (private, keep it out of the repository) and prints the
//!       public key to paste into `PUBLIC_KEY` in src/lib.rs.
//!
//!   cargo run -p kp-licence --example licence-tool -- issue <private key file> \
//!       --name "Maria Example" --org "Example Engineers" --seats 5 \
//!       --expires 2027-10-24 --reference INV-1001
//!       prints a licence key.
//!
//!   cargo run -p kp-licence --example licence-tool -- verify <key>
//!       checks a key against the embedded public key.

use std::{env, fs, path::PathBuf, process::exit};

use kp_licence::{Licence, generate_key_pair, issue, today, verify};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("keygen") => {
            let dir = PathBuf::from(args.get(1).cloned().unwrap_or_else(|| ".".into()));
            let (private, public) = generate_key_pair();
            if let Err(error) = fs::create_dir_all(&dir) {
                eprintln!("{}: {error}", dir.display());
                exit(1);
            }
            let path = dir.join("licence.key");
            if path.exists() {
                eprintln!("{} exists; not overwriting", path.display());
                exit(1);
            }
            if let Err(error) = fs::write(&path, &private) {
                eprintln!("{}: {error}", path.display());
                exit(1);
            }
            println!("private key written to {}", path.display());
            println!("public key (paste into kp_licence::PUBLIC_KEY):\n{public}");
        }
        Some("issue") => {
            let Some(key_file) = args.get(1) else {
                eprintln!(
                    "usage: issue <private key file> --name N [--org O] [--seats S] [--expires YYYY-MM-DD] [--reference R] [--edition E]"
                );
                exit(2);
            };
            let private = match fs::read_to_string(key_file) {
                Ok(k) => k,
                Err(error) => {
                    eprintln!("{key_file}: {error}");
                    exit(1);
                }
            };
            let option = |name: &str| {
                args.iter()
                    .position(|a| a == name)
                    .and_then(|i| args.get(i + 1))
                    .cloned()
            };
            let Some(name) = option("--name") else {
                eprintln!("--name is required");
                exit(2);
            };
            let licence = Licence {
                name,
                organisation: option("--org"),
                edition: option("--edition").unwrap_or_else(|| "standard".into()),
                seats: option("--seats").and_then(|s| s.parse().ok()).unwrap_or(1),
                issued: today(),
                expires: option("--expires"),
                reference: option("--reference").unwrap_or_default(),
            };
            match issue(&licence, &private) {
                Ok(key) => println!("{key}"),
                Err(error) => {
                    eprintln!("{error}");
                    exit(1);
                }
            }
        }
        Some("verify") => {
            let Some(key) = args.get(1) else {
                eprintln!("usage: verify <key>");
                exit(2);
            };
            match verify(key, &today()) {
                Ok(licence) => println!("valid: {licence:#?}"),
                Err(error) => {
                    eprintln!("{error}");
                    exit(1);
                }
            }
        }
        _ => {
            eprintln!("commands: keygen <dir> | issue <private key file> ... | verify <key>");
            exit(2);
        }
    }
}
